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
 *    {type:"unsubscribe", ch}, {type:"stop", session_id}, {type:"ping"}.
 *  - Server to client: event envelope {ch, seq, event} and control envelope
 *    {ch, seq, control:{type:"terminal"|"feed_reset"|"keepalive", ...}}, or
 *    {type:"pong"}.
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
import { getRuntimeConfig } from "@/runtime/runtimeConfig";
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
/** Browser-visible heartbeat interval; protocol Ping/Pong is hidden from JS. */
const HEARTBEAT_INTERVAL_MS = 15_000;
/** An acknowledged connection is half-open after this much inbound silence. */
const HEARTBEAT_STALE_MS = 40_000;
/** Check often enough to recover close to the documented stale threshold. */
const WATCHDOG_TICK_MS = 1_000;

/**
 * The MessagePack subprotocol token offered via `Sec-WebSocket-Protocol` when
 * `isApiV2MsgpackEnabled()` is on, and echoed by the backend on the handshake
 * response when it supports binary frames. Must match the bamboo backend.
 */
const MSGPACK_SUBPROTOCOL = "bamboo.v2.msgpack";

interface FeedChannel {
  handlers: AccountStreamHandlers;
  /** Latest accepted cursor to (re)subscribe with. */
  since: number;
  /** A synchronous application failure stops this feed until explicit restart. */
  deliveryFailed: boolean;
  /** Cursor sent for this socket's exact subscribe epoch. */
  subscribedSince: number | null;
  /** Once an event is accepted, a later reset cannot belong to this subscribe. */
  acceptedInSubscription: boolean;
  /** At most one reset transition is valid for one subscribe epoch. */
  resetHandledInSubscription: boolean;
  /** Reset clears the resume cursor, but live events must still exceed its old floor. */
  postResetFloor: number | null;
}

interface AgentChannel {
  sessionId: string;
  handlers: AgentEventHandlers;
  dispatch: AgentEventDispatch;
  /** Resolves the subscribe Promise on a `terminal` control (or unsubscribe). */
  resolve: () => void;
}

type ServerFrame = {
  type?: string;
  ch?: string;
  seq?: number;
  event?: unknown;
  control?: { type?: string; [key: string]: unknown };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Feed cursors cross a JSON/MessagePack boundary before becoming JavaScript
 * numbers. Values outside the positive safe-integer range cannot be compared
 * losslessly and must never be acknowledged as durable progress.
 */
const isFeedCursor = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/**
 * Validate the stable outer-envelope/inner-change contract before domain code
 * sees a feed event. Bamboo deliberately repeats the same durable cursor in
 * both places; disagreement is protocol corruption, not a compatibility path.
 */
const feedChangeFromFrame = (frame: ServerFrame): ChangeEvent | null => {
  if (
    !isFeedCursor(frame.seq) ||
    frame.control !== undefined ||
    !isRecord(frame.event)
  ) {
    return null;
  }

  const change = frame.event;
  if (
    !isFeedCursor(change.seq) ||
    change.seq !== frame.seq ||
    typeof change.ts !== "string" ||
    (change.session_id !== undefined && typeof change.session_id !== "string") ||
    !isRecord(change.event) ||
    typeof change.event.type !== "string"
  ) {
    return null;
  }

  return change as unknown as ChangeEvent;
};

const feedResetCursorFromFrame = (frame: ServerFrame): number | null => {
  if (
    frame.seq !== 0 ||
    frame.event !== undefined ||
    !isRecord(frame.control) ||
    frame.control.type !== "feed_reset" ||
    !isFeedCursor(frame.control.from_seq)
  ) {
    return null;
  }
  return frame.control.from_seq;
};

/**
 * Liveness state belongs to one exact WebSocket epoch. Timers and document
 * callbacks capture this object and must prove it is still current before they
 * may send, mutate state, or tear anything down.
 */
interface SocketLiveness {
  socket: WebSocket;
  lastFrameAt: number;
  pingSent: boolean;
  heartbeatAckSeen: boolean;
  recoveryStarted: boolean;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  watchdogTimer: ReturnType<typeof setInterval> | null;
  visibilityListener: (() => void) | null;
}

let socket: WebSocket | null = null;
let connecting = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;
/** True once a non-intentional drop happened; cleared when the socket reopens. */
let droppedSinceOpen = false;
/** The liveness epoch for the currently-open socket, if any. */
let socketLiveness: SocketLiveness | null = null;

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

/**
 * Whether the shared v2 socket is currently OPEN (post-handshake). This is the
 * same state that drives the feed's `onOpen`/`onError` callbacks; exposed so
 * availability consumers (the HTTP health poll) can defer to the live channel
 * instead of masking a WS-only outage.
 */
export const isSocketOpen = (): boolean =>
  socket !== null && socket.readyState === WebSocket.OPEN;

let feedChannel: FeedChannel | null = null;

/** Whether the account feed itself is usable on the shared socket. */
export const isFeedOpen = (): boolean =>
  isSocketOpen() &&
  feedChannel !== null &&
  !feedChannel.deliveryFailed &&
  feedChannel.subscribedSince !== null;
// Multiple local subscribers may watch the SAME session (e.g. the main pane
// and a bound split pane), so each channel holds a SET of subscribers. One
// subscribe/unsubscribe frame per channel; events fan out to every subscriber.
const agentChannels = new Map<string, Set<AgentChannel>>();

const agentCh = (sessionId: string): string => `agent.${sessionId}`;

const hasSubscriptions = (): boolean =>
  (feedChannel !== null && !feedChannel.deliveryFailed) || agentChannels.size > 0;

/**
 * Whether the LIVE socket negotiated the MessagePack subprotocol. Decided from
 * the post-handshake `ws.protocol`: only when the backend echoes
 * `bamboo.v2.msgpack` do we encode/decode binary. If we offered msgpack but the
 * backend did not echo it (older JSON-only backend → empty `ws.protocol`), this
 * is false and we stay on JSON. Safe to call any time; defaults to JSON.
 */
const isMsgpackActive = (): boolean => socket !== null && socket.protocol === MSGPACK_SUBPROTOCOL;

const send = (payload: Record<string, unknown>): boolean => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      // Encoding is chosen from the post-open `ws.protocol`, so frames queued
      // before open (flushed here on open via resubscribeAll) get the correct
      // negotiated encoding — the handshake has completed by the time we send.
      socket.send(isMsgpackActive() ? msgpackEncode(payload) : JSON.stringify(payload));
      return true;
    } catch (error) {
      debugLog("[v2Stream]", "send.error", { payload, error });
    }
  }
  return false;
};

const sendFeedSubscribe = (channel: FeedChannel): boolean => {
  const subscribedSince = channel.since;
  channel.subscribedSince = null;
  channel.acceptedInSubscription = false;
  channel.resetHandledInSubscription = false;
  if (!send({ type: "subscribe", ch: "feed", since: subscribedSince })) return false;
  channel.subscribedSince = subscribedSince;
  return true;
};

/**
 * Isolate only the durable feed when its subscription or acknowledgement
 * boundary fails. The shared socket and agent channels remain live; recovery
 * requires the feed owner to close and create a fresh subscription explicitly.
 */
const failFeedDelivery = (
  channel: FeedChannel,
  operation: "subscribe" | "apply event" | "apply reset",
  error: unknown,
): void => {
  console.warn(`Failed to ${operation} v2 feed:`, error);
  if (feedChannel !== channel || channel.deliveryFailed) return;

  channel.deliveryFailed = true;
  channel.subscribedSince = null;
  send({ type: "unsubscribe", ch: "feed" });
  try {
    channel.handlers.onError?.();
  } catch (onErrorFailure) {
    console.warn("Failed to report v2 feed handler error:", onErrorFailure);
  }
  closeIfIdle();
};

/** (Re)send the subscribe frames for every live channel after a (re)connect. */
const resubscribeAll = (): void => {
  send({ type: "hello" });
  if (feedChannel && !feedChannel.deliveryFailed) {
    const channel = feedChannel;
    if (!sendFeedSubscribe(channel)) {
      failFeedDelivery(channel, "subscribe", new Error("WebSocket send failed"));
    }
  }
  for (const ch of agentChannels.keys()) {
    send({ type: "subscribe", ch });
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

const clearSocketLiveness = (expectedSocket?: WebSocket): void => {
  const liveness = socketLiveness;
  if (!liveness || (expectedSocket && liveness.socket !== expectedSocket)) return;

  if (liveness.heartbeatTimer !== null) {
    clearInterval(liveness.heartbeatTimer);
    liveness.heartbeatTimer = null;
  }
  if (liveness.watchdogTimer !== null) {
    clearInterval(liveness.watchdogTimer);
    liveness.watchdogTimer = null;
  }
  if (liveness.visibilityListener && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", liveness.visibilityListener);
    liveness.visibilityListener = null;
  }
  if (socketLiveness === liveness) socketLiveness = null;
};

/**
 * Close only the expected socket epoch. This identity check keeps a late timer
 * or browser callback from an old connection from tearing down its replacement.
 */
const teardownSocket = (expectedSocket?: WebSocket): boolean => {
  const current = socket;
  if (!current || (expectedSocket && current !== expectedSocket)) return false;

  clearSocketLiveness(current);
  current.onopen = null;
  current.onmessage = null;
  current.onerror = null;
  current.onclose = null;
  try {
    current.close();
  } catch {
    /* ignore */
  }
  if (socket === current) socket = null;
  return true;
};

const forceReconnectStaleSocket = (liveness: SocketLiveness): void => {
  if (
    socketLiveness !== liveness ||
    socket !== liveness.socket ||
    liveness.recoveryStarted
  ) {
    return;
  }

  liveness.recoveryStarted = true;
  debugLog("[v2Stream]", "watchdog.stale_socket", {
    silentForMs: Date.now() - liveness.lastFrameAt,
  });
  // Match a non-intentional onclose exactly, but do not wait for a half-open
  // browser socket to emit one: signal availability once, then reconnect WSS.
  droppedSinceOpen = true;
  feedChannel?.handlers.onError?.();
  teardownSocket(liveness.socket);
  connecting = false;
  scheduleReconnect();
};

const watchdogTick = (liveness: SocketLiveness): void => {
  if (
    socketLiveness !== liveness ||
    socket !== liveness.socket ||
    liveness.socket.readyState !== WebSocket.OPEN ||
    !liveness.heartbeatAckSeen
  ) {
    return;
  }
  if (Date.now() - liveness.lastFrameAt >= HEARTBEAT_STALE_MS) {
    forceReconnectStaleSocket(liveness);
  }
};

const startSocketLiveness = (ws: WebSocket): void => {
  clearSocketLiveness();
  const liveness: SocketLiveness = {
    socket: ws,
    lastFrameAt: Date.now(),
    pingSent: false,
    heartbeatAckSeen: false,
    recoveryStarted: false,
    heartbeatTimer: null,
    watchdogTimer: null,
    visibilityListener: null,
  };
  socketLiveness = liveness;

  liveness.heartbeatTimer = setInterval(() => {
    if (socketLiveness !== liveness || socket !== ws || ws.readyState !== WebSocket.OPEN) return;
    if (send({ type: "ping" })) liveness.pingSent = true;
  }, HEARTBEAT_INTERVAL_MS);

  liveness.watchdogTimer = setInterval(() => watchdogTick(liveness), WATCHDOG_TICK_MS);

  if (typeof document !== "undefined") {
    liveness.visibilityListener = () => {
      if (document.visibilityState === "visible") watchdogTick(liveness);
    };
    document.addEventListener("visibilitychange", liveness.visibilityListener);
  }
};

const markInboundFrame = (ws: WebSocket): SocketLiveness | null => {
  const liveness = socketLiveness;
  if (!liveness || liveness.socket !== ws || socket !== ws) return null;
  liveness.lastFrameAt = Date.now();
  return liveness;
};

const acknowledgeHeartbeat = (liveness: SocketLiveness | null): void => {
  // A server may send unrelated/legacy sys keepalives, but only a pong after
  // this epoch sent a ping proves support for the round-trip heartbeat contract.
  if (!liveness || !liveness.pingSent || liveness.heartbeatAckSeen) return;
  liveness.heartbeatAckSeen = true;
  debugLog("[v2Stream]", "heartbeat.acknowledged", {});
};

const closeIfIdle = (): void => {
  if (hasSubscriptions()) return;
  intentionalClose = true;
  clearReconnectTimer();
  teardownSocket();
  // `teardownSocket` normally owns this cleanup; the explicit call keeps test
  // reset/idle teardown safe even if no WebSocket object remains.
  clearSocketLiveness();
  connecting = false;
  reconnectAttempts = 0;
  // A drop from a previous subscription epoch must not make the next epoch's
  // very first open fire the reconnected listeners.
  droppedSinceOpen = false;
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

const handleFrame = (
  frame: ServerFrame | undefined,
  liveness: SocketLiveness | null,
): void => {
  if (frame?.type === "pong" && frame.ch === undefined) {
    acknowledgeHeartbeat(liveness);
    return;
  }
  if (!frame || typeof frame.ch !== "string") {
    debugLog("[v2Stream]", "frame.unknown", {});
    return;
  }

  const { ch, control, event } = frame;

  // Connection-level keepalive data is intentionally not a domain event. Its
  // arrival already refreshed `lastFrameAt` in the exact socket's onmessage.
  if (ch === "sys") return;

  if (ch === "feed") {
    const channel = feedChannel;
    if (!channel || channel.deliveryFailed || channel.subscribedSince === null) return;
    if (control) {
      const resetFrom = feedResetCursorFromFrame(frame);
      if (
        resetFrom !== null &&
        resetFrom === channel.subscribedSince &&
        !channel.acceptedInSubscription &&
        !channel.resetHandledInSubscription
      ) {
        debugLog("[v2Stream]", "feed.reset", {});
        const onReset = channel.handlers.onReset;
        if (!onReset) {
          failFeedDelivery(
            channel,
            "apply reset",
            new Error("feed_reset requires an application reset handler"),
          );
          return;
        }
        const previousSince = channel.since;
        channel.since = 0;
        try {
          onReset();
        } catch (error) {
          channel.since = previousSince;
          failFeedDelivery(channel, "apply reset", error);
          return;
        }
        if (feedChannel === channel && !channel.deliveryFailed) {
          channel.resetHandledInSubscription = true;
          channel.postResetFloor = resetFrom;
        }
      } else {
        debugLog("[v2Stream]", "feed.control.invalid", {});
      }
      return;
    }
    const change = feedChangeFromFrame(frame);
    if (!change) {
      debugLog("[v2Stream]", "feed.frame.invalid_event", {});
      return;
    }
    const acceptanceFloor = Math.max(channel.since, channel.postResetFloor ?? 0);
    if (change.seq <= acceptanceFloor) {
      debugLog("[v2Stream]", "feed.frame.stale", {
        seq: change.seq,
        since: acceptanceFloor,
      });
      return;
    }
    try {
      channel.handlers.onChange(change);
    } catch (error) {
      failFeedDelivery(channel, "apply event", error);
      return;
    }
    if (feedChannel === channel) {
      channel.since = change.seq;
      channel.acceptedInSubscription = true;
      channel.postResetFloor = null;
    }
    return;
  }

  if (ch.startsWith("agent.")) {
    const subscribers = agentChannels.get(ch);
    if (!subscribers || subscribers.size === 0) return;
    if (control) {
      if (control.type === "terminal") {
        debugLog("[v2Stream]", "agent.terminal", { ch, subscribers: subscribers.size });
        // resolve() mutates the set (removes the subscriber) — snapshot first.
        for (const channel of [...subscribers]) {
          channel.resolve();
        }
      }
      return;
    }
    if (event === undefined) {
      debugLog("[v2Stream]", "agent.frame.no_event", {});
      return;
    }
    for (const channel of [...subscribers]) {
      try {
        channel.dispatch(event as AgentEvent, channel.handlers);
      } catch (error) {
        console.warn("Failed to dispatch v2 agent event:", event, error);
      }
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
  const url = getRuntimeConfig().endpoints.v2Stream;
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
    if (socket !== ws) return;
    connecting = false;
    reconnectAttempts = 0;
    const wasDropped = droppedSinceOpen;
    droppedSinceOpen = false;
    startSocketLiveness(ws);
    debugLog("[v2Stream]", "open", { afterDrop: wasDropped });
    resubscribeAll();
    if (feedChannel && !feedChannel.deliveryFailed && feedChannel.subscribedSince !== null) {
      feedChannel.handlers.onOpen?.();
    }
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
    if (socket !== ws) return;
    const liveness = markInboundFrame(ws);
    // Decode by frame shape: string → JSON, ArrayBuffer/binary → msgpack. A
    // malformed/undecodable frame is logged + ignored inside decodeFrame, so
    // this never throws out of onmessage (same discipline as the JSON path).
    handleFrame(decodeFrame(messageEvent.data), liveness);
  };

  ws.onerror = () => {
    if (socket !== ws) return;
    debugLog("[v2Stream]", "error", {});
    feedChannel?.handlers.onError?.();
  };

  ws.onclose = () => {
    // A late close from an old socket epoch must not affect its replacement.
    if (socket !== ws) return;
    connecting = false;
    clearSocketLiveness(ws);
    debugLog("[v2Stream]", "close", { intentional: intentionalClose });
    socket = null;
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
 * resume point as `since`; the client tracks only validated, successfully
 * delivered cursors for reconnects.
 */
export const subscribeFeed = (
  handlers: AccountStreamHandlers,
  since: number,
): FeedSubscription => {
  feedChannel = {
    handlers,
    since: isFeedCursor(since) ? since : 0,
    deliveryFailed: false,
    subscribedSince: null,
    acceptedInSubscription: false,
    resetHandledInSubscription: false,
    postResetFloor: null,
  };
  const channel = feedChannel;
  if (socket && socket.readyState === WebSocket.OPEN) {
    if (!sendFeedSubscribe(channel)) {
      failFeedDelivery(channel, "subscribe", new Error("WebSocket send failed"));
    }
  } else {
    connect();
  }

  let closed = false;
  return {
    close() {
      if (closed) return;
      closed = true;
      if (feedChannel !== channel) return;
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

  const subscriber: AgentChannel = { sessionId, handlers, dispatch, resolve: () => resolveFn() };

  const promise = new Promise<void>((resolve) => {
    resolveFn = () => {
      if (settled) return;
      settled = true;
      const subscribers = agentChannels.get(ch);
      subscribers?.delete(subscriber);
      // Only the LAST local subscriber leaving unsubscribes the wire channel —
      // another pane may still be watching the same session.
      if (!subscribers || subscribers.size === 0) {
        agentChannels.delete(ch);
        send({ type: "unsubscribe", ch });
        closeIfIdle();
      }
      resolve();
    };
  });

  const existing = agentChannels.get(ch);
  const isFirstSubscriber = !existing || existing.size === 0;
  if (existing) existing.add(subscriber);
  else agentChannels.set(ch, new Set([subscriber]));

  if (socket && socket.readyState === WebSocket.OPEN) {
    // One subscribe frame per channel; later subscribers piggyback on it.
    if (isFirstSubscriber) send({ type: "subscribe", ch });
  } else {
    connect();
  }

  return { promise, close: () => resolveFn() };
};

/** Test-only: reset the singleton state between cases. */
export const __resetV2StreamForTests = (): void => {
  clearReconnectTimer();
  intentionalClose = true;
  teardownSocket();
  clearSocketLiveness();
  connecting = false;
  reconnectAttempts = 0;
  droppedSinceOpen = false;
  reconnectedListeners.clear();
  feedChannel = null;
  agentChannels.clear();
};
