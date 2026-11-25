/**
 * Account change-feed runner.
 *
 * Owns the long-lived `feed` channel on the shared v2 WebSocket and applies
 * durable change events to the Zustand store. This replaces the former
 * timer-based polling (10s agent-health + 15s session-index): the feed
 * subscribes once, the WS client auto-reconnects and re-subscribes with the
 * latest cursor, and the backend replays only what was missed. Availability is
 * derived from the feed connection state rather than a health poll.
 *
 * Most change events trigger a debounced `refreshChats()` so all existing,
 * tested session-list reconciliation logic is reused. Title/pinned events also
 * apply directly for snappier UX. Live token streaming of the *currently open*
 * session still flows through the per-session `agent.<sid>` channel
 * (`agentSubscriptionRunner`); this feed is the cross-session sync channel.
 */
import { AgentClient, readTaskListDelta, type ChangeEvent, type FeedSubscription } from "./AgentService";
import { isFeedOpen, onReconnected } from "./v2Stream";
import { stopAllBackgroundShellObservations, stopObservingBackgroundShells } from "./backgroundShellObservation";
import { appStore, selectShouldObserve } from "@shared/store/appStore/state";
import { notify } from "@/lib/notify";

const CURSOR_STORAGE_KEY = "lotus_account_feed_cursor_v1";
const REFRESH_DEBOUNCE_MS = 400;
const CANONICAL_CURSOR_PATTERN = /^[1-9][0-9]*$/;

// The live v2 WS feed subscription handle (null while stopped).
let feedSubscription: FeedSubscription | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let offReconnected: (() => void) | null = null;

// Only observed sessions need Task updates and snapshots from the account-wide feed.
const taskListViewers = new Map<string, number>();

export const observeSessionTaskList = (sessionId: string): (() => void) => {
  taskListViewers.set(sessionId, (taskListViewers.get(sessionId) ?? 0) + 1);
  return () => {
    const viewers = taskListViewers.get(sessionId) ?? 0;
    if (viewers > 1) taskListViewers.set(sessionId, viewers - 1);
    else taskListViewers.delete(sessionId);
  };
};

const refreshTaskSnapshot = (sessionId: string): void => {
  void appStore.getState().loadTaskList(sessionId).catch(() => {});
};

/**
 * True while the account feed is RUNNING but unavailable: either the shared
 * WebSocket is down or this feed was isolated after a synchronous delivery
 * failure. False when the feed was never started (tests / SSR / no WebSocket),
 * so the HTTP health poll keeps full authority over availability there.
 */
export const isAccountFeedDisconnected = (): boolean =>
  feedSubscription !== null && !isFeedOpen();

const parseCursor = (raw: string | null): number => {
  if (!raw || !CANONICAL_CURSOR_PATTERN.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 && String(parsed) === raw
    ? parsed
    : 0;
};

const readCursor = (): number => {
  try {
    return parseCursor(localStorage.getItem(CURSOR_STORAGE_KEY));
  } catch {
    return 0;
  }
};

const writeCursor = (seq: number): void => {
  if (!Number.isSafeInteger(seq) || seq <= 0) return;
  try {
    // Storage is shared with other page lifetimes. Re-read immediately before
    // writing so a replay can never move a valid durable cursor backwards. If
    // reading fails, skip the write rather than guessing that the cursor is 0.
    const current = parseCursor(localStorage.getItem(CURSOR_STORAGE_KEY));
    if (seq <= current) return;
    localStorage.setItem(CURSOR_STORAGE_KEY, String(seq));
  } catch {
    // Best-effort: a private-mode storage failure must not break the feed.
  }
};

const clearCursor = (): void => {
  try {
    localStorage.removeItem(CURSOR_STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

const cancelScheduledRefresh = (): void => {
  if (!refreshTimer) return;
  clearTimeout(refreshTimer);
  refreshTimer = null;
};

const refreshSessionsNowAfterReset = (): void => {
  try {
    void appStore
      .getState()
      .refreshChatsNow()
      .catch((error) =>
        console.warn(
          "[AccountFeed] Failed to resync sessions after reset:",
          error,
        ),
      );
  } catch (error) {
    console.warn("[AccountFeed] Failed to resync sessions after reset:", error);
  }
};

const scheduleRefresh = (): void => {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void appStore.getState().refreshSessionsIndex();
  }, REFRESH_DEBOUNCE_MS);
};

// Change types that alter a session's CONTENT or interaction state — when one
// arrives for the currently-open session (driven on ANOTHER device), reconcile
// that session's messages + pending question so a passive viewer stays in sync,
// not just the session list. (Driven locally, the reconcile is a monotonic
// no-op — see `reconcileOpenSession`.)
const OPEN_SESSION_RECONCILE_TYPES = new Set<string>([
  "message_appended",
  "session_history_committed",
  "task_list_updated",
  "task_list_item_progress",
  "task_list_completed",
  "complete",
  "cancelled",
  "error",
  "execution_started",
  "need_clarification",
]);

const applyChange = (change: ChangeEvent, delivery?: "live"): void => {
  const { event } = change;
  const store = appStore.getState();
  const sessionId = change.session_id ?? event.session_id;

  if (sessionId && (event.type === "session_cleared" || event.type === "session_deleted")) {
    stopObservingBackgroundShells(sessionId);
  }
  if (event.type === "session_cleared" && sessionId) {
    store.reconcileClearedConversation(sessionId);
  }
  if (event.type === "session_deleted") store.invalidateSessionNavigation(sessionId);

  if (sessionId && taskListViewers.has(sessionId)) {
    if (event.type === "task_list_updated" && event.task_list?.session_id === sessionId) {
      const version = event.version ?? event.task_list.version;
      if (version === undefined) refreshTaskSnapshot(sessionId);
      else store.setTaskList(sessionId, { ...event.task_list, version });
    } else if (event.type === "task_list_item_progress") {
      const delta = readTaskListDelta(event);
      if (delta?.session_id === sessionId) store.updateTaskListDelta(sessionId, delta);
    } else if (event.type === "session_history_committed") {
      // Final task progress can be saved after the last full Task event.
      refreshTaskSnapshot(sessionId);
    }
  }

  // Server-side preference-gated notifications → surface as a browser
  // notification when the user isn't actively watching that session.
  if (event.type === "notification") {
    const e = event as { title?: string; body?: string };
    if (typeof document === "undefined" || document.hidden || sessionId !== store.currentSessionId) {
      notify(e.title || "Bodhi", e.body);
    }
    return;
  }

  // Multi-device: keep the OPEN conversation live (not just the list) when it
  // changes elsewhere. A history-commit barrier also reconciles any locally
  // loaded session (for example a bound split pane), because the per-session
  // channel has already closed after Complete and cannot carry this later event.
  const isLoadedHistoryCommit = event.type === "session_history_committed"
    && Boolean(sessionId && store.chats.some((chat) => chat.id === sessionId));
  if (
    sessionId &&
    (sessionId === store.currentSessionId || isLoadedHistoryCommit) &&
    OPEN_SESSION_RECONCILE_TYPES.has(event.type)
  ) {
    store.reconcileOpenSession(sessionId, event.type);
  }

  // Passive per-token streaming: when a run STARTS on the OPEN session on another
  // device and this device is not already observing it, refresh now (un-debounced)
  // so the session's `is_running` summary flips its execution phase to `running`
  // -> `selectShouldObserve` becomes true -> the agent-event subscription engages
  // and live tokens stream in. (`execution_started` itself can't promote an `idle`
  // entry to `running`; the summary path can — hence a refresh, not a synthetic
  // event.) On the device DRIVING the run, `selectShouldObserve` is already true,
  // so this is skipped.
  if (
    sessionId &&
    sessionId === store.currentSessionId &&
    event.type === "execution_started" &&
    !selectShouldObserve(sessionId)(store)
  ) {
    void store.refreshChatsNow();
  }

  switch (event.type) {
    case "session_title_updated":
      if (sessionId && typeof event.title === "string") {
        store.applyServerTitle(sessionId, event.title, event.title_version ?? 0,
          delivery === "live" && event.source === "auto" && event.title_generated !== false);
      }
      // Title also affects the list ordering/labels of non-open sessions.
      scheduleRefresh();
      break;
    case "session_pinned_updated":
      if (sessionId && typeof event.pinned === "boolean") {
        store.applyServerPinned(sessionId, event.pinned, event.updated_at ?? change.ts);
      }
      scheduleRefresh();
      break;
    // Coarse list/state changes — reuse the existing reconciliation path.
    case "session_created":
    case "session_deleted":
    case "session_cleared":
    case "message_appended":
    case "session_history_committed":
    case "task_list_updated":
    case "task_list_item_progress":
    case "task_list_completed":
    case "complete":
    case "cancelled":
    case "error":
    case "execution_started":
    case "need_clarification":
    default:
      scheduleRefresh();
      break;
  }
};

/**
 * Start the account feed. Idempotent — a second call is a no-op while a
 * connection is live.
 */
export const startAccountFeed = (): void => {
  if (feedSubscription) return;
  // The feed requires a browser/webview WebSocket. In SSR/node/test
  // environments it may be absent — skip rather than throw.
  if (typeof WebSocket === "undefined") return;
  const client = AgentClient.getInstance();

  // Agent-channel token deltas emitted during a WS gap are lost (replay covers
  // critical state only) — on reconnect, refresh summaries and reconcile the
  // open conversation immediately instead of waiting for the terminal frame.
  offReconnected = onReconnected(() => {
    const store = appStore.getState();
    void store.refreshChatsNow();
    const cur = store.currentSessionId;
    if (cur) store.reconcileOpenSession(cur, "ws_reconnected");
    for (const sessionId of taskListViewers.keys()) refreshTaskSnapshot(sessionId);
  });

  feedSubscription = client.subscribeToAccountStream(
    {
      onOpen: () => {
        appStore.getState().setAgentAvailability(true);
      },
      onError: () => {
        // Transient: the WS client auto-reconnects (resubscribing with the
        // latest cursor).
        appStore.getState().setAgentAvailability(false);
      },
      onReset: () => {
        // Cursor predated the retained window. Clear durable progress first,
        // cancel any stale trailing refresh, then force one authoritative list
        // fetch instead of entering the ordinary throttled refresh path.
        clearCursor();
        cancelScheduledRefresh();
        refreshSessionsNowAfterReset();
        for (const sessionId of taskListViewers.keys()) refreshTaskSnapshot(sessionId);
      },
      onChange: (change, delivery) => {
        appStore.getState().setAgentAvailability(true);
        applyChange(change, delivery);
        writeCursor(change.seq);
      },
    },
    { since: readCursor() },
  );
};

/** Stop the account feed and tear down the connection. */
export const stopAccountFeed = (): void => {
  stopAllBackgroundShellObservations();
  cancelScheduledRefresh();
  if (offReconnected) {
    offReconnected();
    offReconnected = null;
  }
  if (feedSubscription) {
    feedSubscription.close();
    feedSubscription = null;
  }
};
