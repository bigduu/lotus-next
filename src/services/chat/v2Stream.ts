/**
 * Unified v2 WebSocket client (`GET {origin}/v2/stream`) — THE live transport.
 *
 * A module-level singleton managing ONE WebSocket shared by the account feed
 * and every per-session agent subscription. lotus-next is WSS-only: there is
 * no SSE transport and no fallback — a backend without `/v2/stream` is not
 * supported.
 *
 * Protocol (JSON text frames by default):
 *  - Client to server: {type:"hello"} (optional; no token on loopback/local),
 *    {type:"subscribe", ch:"feed", since}, {type:"subscribe", ch:"agent.<sid>"},
 *    {type:"unsubscribe", ch}, {type:"stop", session_id}.
 *  - Server to client: event envelope {ch, seq, event} and control envelope
 *    {ch, seq, control:{type:"terminal"|"feed_reset", ...}}.
 *
 * Wire encoding (opt-in MessagePack): by default the socket speaks JSON text
 * frames. When `isApiV2MsgpackEnabled()` is on, the socket is opened offering
 * the `bamboo.v2.msgpack` subprotocol via `Sec-WebSocket-Protocol`; the SAME
 * envelope schema is then carried as MessagePack binary frames. The active
 * encoding is decided from the NEGOTIATED `ws.protocol` after open: if the
 * backend echoes `bamboo.v2.msgpack` we encode/decode msgpack, otherwise (an
 * older JSON-only backend leaves `ws.protocol` empty) we stay on JSON even
 * though we offered msgpack. JSON remains the default and is byte-for-byte
 * unchanged when the flag is off.
 *
 * Reconnect: a single bounded-backoff reconnect loop owns the socket — for
 * initial connect failures AND post-open drops alike (there is no fallback to
 * degrade to, so the loop simply keeps trying while subscriptions exist; the
 * UI reflects unavailability via `onError`). On every (re)connect a `hello` is
 * sent and ALL live channels are re-subscribed (feed with its latest cursor,
 * agents with their sid). A `feed_reset` control clears the feed cursor so the
 * next (re)subscribe resyncs from scratch.
 *
 * Lifetime: the socket is opened lazily on the first subscribe and closed once
 * no subscriptions (feed or agent) remain.
 */
import type {
  AccountStreamHandlers,
  AgentEvent,
  AgentEventHandlers,
  ChangeEvent,
} from "./AgentService";
import { getV2StreamUrl } from "@shared/utils/backendBaseUrl";
import { debugLog, isApiV2MsgpackEnabled } from "@shared/utils/debugFlags";
import { decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack";

/** Subscription handle returned by {@link subscribeFeed}. */
export interface FeedSubscription {
  close(): void;
}

/**
 * Dispatch a fully-parsed AgentEvent to the appropriate AgentEventHandlers
 * callback. Injected by AgentService so the WS path reuses its single
 * event-to-handler mapping (no logic fork).
 */
export type AgentEventDispatch = (event: AgentEvent, handlers: AgentEventHandlers) => void;

const MAX_BACKOFF_MS = 15_000;
const BASE_BACKOFF_MS = 500;

/**
 * The MessagePack subprotocol token offered via `Sec-WebSocket-Protocol` when
 * `isApiV2MsgpackEnabled()` is on, and echoed by the backend on the handshake
 * response when it supports binary frames. Must match the bamboo backend.
 */
const MSGPACK_SUBPROTOCOL = "bamboo.v2.msgpack";

interface FeedChannel {
  handlers: AccountStreamHandlers;
  /** Latest cursor to (re)subscribe with; updated as ChangeEvents arrive. */
  since: number;
}

interface AgentChannel {
  sessionId: string;
  handlers: AgentEventHandlers;
  dispatch: AgentEventDispatch;
  /** Resolves the subscribe Promise on a `terminal` control (or unsubscribe). */
  resolve: () => void;
}

type ServerFrame = {
  ch?: string;
  seq?: number;
  event?: unknown;
  control?: { type?: string; [key: string]: unknown };
};

let socket: WebSocket | null = null;
let connecting = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;
/** True once a non-intentional drop happened; cleared when the socket reopens. */
let droppedSinceOpen = false;

/**
 * Listeners fired when the socket REOPENS after a non-intentional drop (never
 * on the first open). Agent-channel events emitted during the gap are lost
 * (replay covers critical state only, not token deltas), so consumers use this
 * to reconcile the open conversation immediately instead of waiting for the
 * terminal frame.
 */
const reconnectedListeners = new Set<() => void>();

/** Register a reconnected listener; returns an unsubscribe function. */
export const onReconnected = (listener: () => void): (() => void) => {
  reconnectedListeners.add(listener);
  return () => reconnectedListeners.delete(listener);
};

let feedChannel: FeedChannel | null = null;
const agentChannels = new Map<string, AgentChannel>();

const agentCh = (sessionId: string): string => `agent.${sessionId}`;

const hasSubscriptions = (): boolean => feedChannel !== null || agentChannels.size > 0;

/**
 * Whether the LIVE socket negotiated the MessagePack subprotocol. Decided from
 * the post-handshake `ws.protocol`: only when the backend echoes
 * `bamboo.v2.msgpack` do we encode/decode binary. If we offered msgpack but the
 * backend did not echo it (older JSON-only backend → empty `ws.protocol`), this
 * is false and we stay on JSON. Safe to call any time; defaults to JSON.
 */
const isMsgpackActive = (): boolean => socket !== null && socket.protocol === MSGPACK_SUBPROTOCOL;

const send = (payload: Record<string, unknown>): void => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      // Encoding is chosen from the post-open `ws.protocol`, so frames queued
      // before open (flushed here on open via resubscribeAll) get the correct
      // negotiated encoding — the handshake has completed by the time we send.
      socket.send(isMsgpackActive() ? msgpackEncode(payload) : JSON.stringify(payload));
    } catch (error) {
      debugLog("[v2Stream]", "send.error", { payload, error });
    }
  }
};

/** (Re)send the subscribe frames for every live channel after a (re)connect. */
const resubscribeAll = (): void => {
  send({ type: "hello" });
  if (feedChannel) {
    send({ type: "subscribe", ch: "feed", since: feedChannel.since });
  }
  for (const channel of agentChannels.values()) {
    send({ type: "subscribe", ch: agentCh(channel.sessionId) });
  }
};

const clearReconnectTimer = (): void => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

const scheduleReconnect = (): void => {
  if (!hasSubscriptions() || intentionalClose) return;
  if (reconnectTimer) return;
  const delay = Math.min(BASE_BACKOFF_MS * 2 ** reconnectAttempts, MAX_BACKOFF_MS);
  reconnectAttempts += 1;
  debugLog("[v2Stream]", "reconnect.schedule", { attempt: reconnectAttempts, delay });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
};

const teardownSocket = (): void => {
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      /* ignore */
    }
    socket = null;
  }
};

const closeIfIdle = (): void => {
  if (hasSubscriptions()) return;
  intentionalClose = true;
  clearReconnectTimer();
  teardownSocket();
  connecting = false;
  reconnectAttempts = 0;
};

/**
 * Decode a raw inbound WS frame into a {@link ServerFrame}, picking the codec
 * from the frame shape: an `ArrayBuffer`/binary payload is MessagePack (msgpack
 * mode), a string is JSON (default). Returns `undefined` on an undecodable
 * frame; the caller logs + ignores (never throws out of `onmessage`).
 */
const decodeFrame = (data: unknown): ServerFrame | undefined => {
  try {
    if (typeof data === "string") {
      return JSON.parse(data) as ServerFrame;
    }
    if (data instanceof ArrayBuffer) {
      return msgpackDecode(new Uint8Array(data)) as ServerFrame;
    }
    if (ArrayBuffer.isView(data)) {
      const view = data as ArrayBufferView;
      return msgpackDecode(
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
      ) as ServerFrame;
    }
    debugLog("[v2Stream]", "frame.unknown_data_type", {});
    return undefined;
  } catch (error) {
    console.warn("Failed to parse v2 stream frame:", data, error);
    return undefined;
  }
};

const handleFrame = (frame: ServerFrame | undefined): void => {
  if (!frame || typeof frame.ch !== "string") {
    debugLog("[v2Stream]", "frame.unknown", {});
    return;
  }

  const { ch, control, event } = frame;

  if (ch === "feed") {
    if (!feedChannel) return;
    if (control) {
      if (control.type === "feed_reset") {
        debugLog("[v2Stream]", "feed.reset", {});
        feedChannel.since = 0;
        feedChannel.handlers.onReset?.();
      }
      return;
    }
    if (event === undefined) {
      debugLog("[v2Stream]", "feed.frame.no_event", {});
      return;
    }
    const change = event as ChangeEvent;
    if (typeof change.seq === "number" && change.seq > feedChannel.since) {
      feedChannel.since = change.seq;
    }
    feedChannel.handlers.onChange(change);
    return;
  }

  if (ch.startsWith("agent.")) {
    const channel = agentChannels.get(ch);
    if (!channel) return;
    if (control) {
      if (control.type === "terminal") {
        debugLog("[v2Stream]", "agent.terminal", { ch });
        channel.resolve();
      }
      return;
    }
    if (event === undefined) {
      debugLog("[v2Stream]", "agent.frame.no_event", {});
      return;
    }
    try {
      channel.dispatch(event as AgentEvent, channel.handlers);
    } catch (error) {
      console.warn("Failed to dispatch v2 agent event:", event, error);
    }
    return;
  }

  debugLog("[v2Stream]", "frame.unknown_channel", { ch });
};

const connect = (): void => {
  if (!hasSubscriptions()) return;
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  if (connecting) return;
  if (typeof WebSocket === "undefined") {
    debugLog("[v2Stream]", "connect.no_websocket", {});
    return;
  }

  connecting = true;
  intentionalClose = false;
  const url = getV2StreamUrl();
  debugLog("[v2Stream]", "connect", { url });

  // Opt-in: offer the msgpack subprotocol so the backend can negotiate binary
  // frames. Safe against a JSON-only backend — if it does not echo the protocol
  // on the handshake, `ws.protocol` stays empty and we decode JSON (see
  // `isMsgpackActive`). Default (flag off) opens exactly as before: no
  // protocols arg, JSON text.
  const offerMsgpack = isApiV2MsgpackEnabled();
  let ws: WebSocket;
  try {
    ws = offerMsgpack ? new WebSocket(url, [MSGPACK_SUBPROTOCOL]) : new WebSocket(url);
    if (offerMsgpack) {
      // Receive binary frames as ArrayBuffer (the default `Blob` is async to
      // read); decoding in `onmessage` needs synchronous access to the bytes.
      ws.binaryType = "arraybuffer";
    }
  } catch (error) {
    connecting = false;
    debugLog("[v2Stream]", "connect.error", { error });
    feedChannel?.handlers.onError?.();
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    connecting = false;
    reconnectAttempts = 0;
    const wasDropped = droppedSinceOpen;
    droppedSinceOpen = false;
    debugLog("[v2Stream]", "open", { afterDrop: wasDropped });
    resubscribeAll();
    feedChannel?.handlers.onOpen?.();
    if (wasDropped) {
      for (const listener of [...reconnectedListeners]) {
        try {
          listener();
        } catch (error) {
          debugLog("[v2Stream]", "reconnected.listener_error", { error });
        }
      }
    }
  };

  ws.onmessage = (messageEvent: MessageEvent) => {
    // Decode by frame shape: string → JSON, ArrayBuffer/binary → msgpack. A
    // malformed/undecodable frame is logged + ignored inside decodeFrame, so
    // this never throws out of onmessage (same discipline as the JSON path).
    handleFrame(decodeFrame(messageEvent.data));
  };

  ws.onerror = () => {
    debugLog("[v2Stream]", "error", {});
    feedChannel?.handlers.onError?.();
  };

  ws.onclose = () => {
    connecting = false;
    debugLog("[v2Stream]", "close", { intentional: intentionalClose });
    if (socket === ws) socket = null;
    if (intentionalClose) return;
    // Any non-intentional close — including a close before the socket ever
    // opened — feeds the same bounded-backoff reconnect loop. There is no
    // other transport to degrade to; the UI reflects unavailability via
    // `onError` until a reconnect succeeds.
    droppedSinceOpen = true;
    feedChannel?.handlers.onError?.();
    scheduleReconnect();
  };
};

/**
 * Subscribe to the account change feed over the shared v2 WebSocket.
 *
 * Mirrors `AgentClient.subscribeToAccountStream`: routes feed `event`
 * envelopes (full ChangeEvent) to `handlers.onChange`, a `feed_reset` control
 * to `handlers.onReset`, WS open to `handlers.onOpen`, and close/error to
 * `handlers.onError`. The caller owns the cursor (localStorage) and passes the
 * resume point as `since`; the client tracks the max seq seen for reconnects.
 */
export const subscribeFeed = (
  handlers: AccountStreamHandlers,
  since: number,
): FeedSubscription => {
  feedChannel = { handlers, since: since > 0 ? since : 0 };
  if (socket && socket.readyState === WebSocket.OPEN) {
    send({ type: "subscribe", ch: "feed", since: feedChannel.since });
  } else {
    connect();
  }

  let closed = false;
  return {
    close() {
      if (closed) return;
      closed = true;
      feedChannel = null;
      send({ type: "unsubscribe", ch: "feed" });
      closeIfIdle();
    },
  };
};

/**
 * Subscribe to a single session's agent event channel over the shared v2 WS.
 *
 * Mirrors the SSE `subscribeToEvents` semantics so callers need no change:
 *  - Each `event` envelope is dispatched through the injected `dispatch` (the
 *    same AgentEventHandlers mapping the SSE path used).
 *  - A `terminal` control resolves the returned Promise.
 *  - Calling `close()` unsubscribes the channel and resolves the Promise
 *    (mirrors the abort-closes behavior).
 *  - A transient WS disconnect does NOT reject — this client reconnects and
 *    re-subscribes internally, so the Promise stays pending until terminal or
 *    abort (the WS owns reconnection).
 *
 * Returns the Promise plus a `close()` to unsubscribe.
 */
export const subscribeAgent = (
  sessionId: string,
  handlers: AgentEventHandlers,
  dispatch: AgentEventDispatch,
): { promise: Promise<void>; close: () => void } => {
  const ch = agentCh(sessionId);
  let settled = false;
  let resolveFn: () => void = () => {};

  const promise = new Promise<void>((resolve) => {
    resolveFn = () => {
      if (settled) return;
      settled = true;
      agentChannels.delete(ch);
      send({ type: "unsubscribe", ch });
      closeIfIdle();
      resolve();
    };
  });

  agentChannels.set(ch, { sessionId, handlers, dispatch, resolve: resolveFn });

  if (socket && socket.readyState === WebSocket.OPEN) {
    send({ type: "subscribe", ch });
  } else {
    connect();
  }

  return { promise, close: resolveFn };
};

/** Test-only: reset the singleton state between cases. */
export const __resetV2StreamForTests = (): void => {
  clearReconnectTimer();
  intentionalClose = true;
  teardownSocket();
  connecting = false;
  reconnectAttempts = 0;
  feedChannel = null;
  agentChannels.clear();
};
