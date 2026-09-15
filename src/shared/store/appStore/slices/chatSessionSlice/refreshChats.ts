import { StateCreator } from "zustand";
import {
  AgentClient,
  type ListSessionsQuery,
  type SessionSummary,
} from "@services/chat/AgentService";
import { debugLog } from "@shared/utils/debugFlags";
import { ChatItem } from "@shared/types/chat";
import type { AppState } from "../../";
import { applyExecutionEvent } from "../executionStateSlice";
import { parseTimestampMs, canReuseSessionListChat } from "./equality";
import { sessionSummaryToChatItem } from "./messageMapping";
import type { ChatSlice } from "./types";

const agentClient = AgentClient.getInstance();
const SESSION_INDEX_PAGE_SIZE = 200;
const SESSION_INDEX_SNAPSHOT_ATTEMPTS = 3;

export type SessionListScope =
  | { kind: "all" }
  | { kind: "roots" }
  | { kind: "children"; rootSessionId: string }
  | { kind: "upsert" };

interface SubagentTreeRequest {
  requestedRevision: number;
  promise: Promise<void>;
}

const subagentTreeRequests = new Map<string, SubagentTreeRequest>();

/**
 * Follow the backend's opaque `next_offset` cursor until the filtered result is
 * exhausted. Each request remains bounded even when the complete root/tree set
 * spans multiple pages.
 */
export async function listAllSessionPages(
  query: Omit<ListSessionsQuery, "offset">,
  client: Pick<AgentClient, "listSessions"> = agentClient,
): Promise<SessionSummary[]> {
  let previousCandidateIds: string[] | null = null;

  for (let attempt = 0; attempt < SESSION_INDEX_SNAPSHOT_ATTEMPTS; attempt += 1) {
    const sessionsById = new Map<string, SessionSummary>();
    const seenOffsets = new Set<number>();
    let expectedTotal: number | null = null;
    let snapshotChanged = false;
    let offset = 0;

    while (true) {
      if (seenOffsets.has(offset)) {
        throw new Error(`Session pagination repeated offset ${offset}`);
      }
      seenOffsets.add(offset);

      const page = await client.listSessions({
        ...query,
        limit: query.limit ?? SESSION_INDEX_PAGE_SIZE,
        offset,
      });
      if (!Number.isSafeInteger(page.total) || page.total < 0) {
        throw new Error(`Session pagination returned invalid total ${page.total}`);
      }
      if (expectedTotal === null) {
        expectedTotal = page.total;
      } else if (page.total !== expectedTotal) {
        snapshotChanged = true;
      }

      for (const session of page.sessions) {
        if (query.kind && session.kind !== query.kind) {
          throw new Error(`Session list returned ${session.kind} for ${query.kind} query`);
        }
        if (query.root_session_id && session.root_session_id !== query.root_session_id) {
          throw new Error("Session list returned a row from another root tree");
        }
        if (sessionsById.has(session.id)) {
          snapshotChanged = true;
        } else {
          sessionsById.set(session.id, session);
        }
      }

      const nextOffset = page.next_offset;
      if (typeof nextOffset === "number") {
        if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) {
          throw new Error(`Session pagination did not advance from offset ${offset}`);
        }
        offset = nextOffset;
        continue;
      }

      if (!snapshotChanged && sessionsById.size === page.total) {
        const sessions = [...sessionsById.values()];
        if (seenOffsets.size === 1) {
          return sessions;
        }

        // Offset pagination has no server snapshot token. Even a read with a
        // stable total and no duplicates can mix two same-cardinality index
        // versions, so accept a multi-page result only after the next complete
        // read confirms the same ordered membership.
        const candidateIds = sessions.map((session) => session.id);
        if (
          previousCandidateIds?.length === candidateIds.length &&
          previousCandidateIds.every((id, index) => id === candidateIds[index])
        ) {
          return sessions;
        }
        previousCandidateIds = candidateIds;
      } else {
        previousCandidateIds = null;
      }
      break;
    }
  }

  throw new Error("Session pagination changed while reading; retry the refresh");
}

/**
 * Zustand `set` for the chat slice. Matches the type produced by the slice's
 * `StateCreator`, so the refresh helpers can mutate the store directly.
 */
export type ChatSliceSet = Parameters<StateCreator<AppState, [], [], ChatSlice>>[0];

// === REFRESH CHATS DEDUPLICATION ===
const REFRESH_CHATS_THROTTLE_MS = 750;

interface RefreshChatsState {
  inFlight: Promise<void> | null;
  forcedPromise: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
  trailingPromise: Promise<void> | null;
  trailingResolve: (() => void) | null;
  trailingReject: ((error: unknown) => void) | null;
}

export const refreshChatsState: RefreshChatsState = {
  inFlight: null,
  forcedPromise: null,
  timer: null,
  trailingPromise: null,
  trailingResolve: null,
  trailingReject: null,
};

export function consumeTrailingRefreshCallbacks(): {
  resolve: (() => void) | null;
  reject: ((error: unknown) => void) | null;
} {
  const callbacks = {
    resolve: refreshChatsState.trailingResolve,
    reject: refreshChatsState.trailingReject,
  };
  refreshChatsState.trailingPromise = null;
  refreshChatsState.trailingResolve = null;
  refreshChatsState.trailingReject = null;
  return callbacks;
}

export function settleTrailingRefreshCallbacks(
  promise: Promise<void>,
  callbacks: { resolve: (() => void) | null; reject: ((error: unknown) => void) | null },
): void {
  if (!callbacks.resolve && !callbacks.reject) {
    return;
  }
  void promise.then(
    () => callbacks.resolve?.(),
    (error) => callbacks.reject?.(error),
  );
}

export function clearRefreshChatsThrottleWindow(): {
  resolve: (() => void) | null;
  reject: ((error: unknown) => void) | null;
} {
  if (refreshChatsState.timer) {
    clearTimeout(refreshChatsState.timer);
    refreshChatsState.timer = null;
  }
  return consumeTrailingRefreshCallbacks();
}

/**
 * Apply a fetched session list to the store.
 * Preserves in-memory messages and merges local state.
 */
export function applySessionsList(
  sessions: SessionSummary[],
  set: ChatSliceSet,
  scope: SessionListScope = { kind: "all" },
): void {
  const next = sessions.map(sessionSummaryToChatItem);

  set((state) => {
    // Reconcile executionBySession against every summary.
    let executionBySession = state.executionBySession;
    for (const summary of sessions) {
      executionBySession = applyExecutionEvent(executionBySession, {
        type: "applySessionSummary",
        sessionId: summary.id,
        summary,
      });
    }

    // Preserve in-memory messages when possible.
    const prevById = new Map(state.chats.map((c) => [c.id, c]));
    const mergedIncoming = next.map((c) => {
      const prev = prevById.get(c.id);
      if (!prev) {
        return c;
      }

      const prevUpdatedAtMs = parseTimestampMs(prev.updatedAt);
      const remoteUpdatedAtMs = parseTimestampMs(c.updatedAt);
      const preferLocalSessionFields =
        prevUpdatedAtMs !== null &&
        remoteUpdatedAtMs !== null &&
        prevUpdatedAtMs > remoteUpdatedAtMs;

      const prevConfig = prev.config || {};
      const nextConfig = c.config || {};
      const hasLocalModel = Object.prototype.hasOwnProperty.call(prevConfig, "model");
      const hasLocalModelRef = Object.prototype.hasOwnProperty.call(prevConfig, "model_ref");
      const hasLocalReasoning = Object.prototype.hasOwnProperty.call(prevConfig, "reasoningEffort");
      const hasLocalGoldConfig = Object.prototype.hasOwnProperty.call(prevConfig, "goldConfig");

      // Ensure messageCount stays monotonic, as listSessions summary might briefly lag
      const effectiveMessageCount = Math.max(prev.messageCount ?? 0, c.messageCount ?? 0);

      // Title precedence is governed by `title_version`, NOT `updatedAt`.
      // The backend bumps `title_version` on every authoritative title change
      // (manual PATCH or auto-title generation), so the highest version always wins.
      const remoteTitleVersion = c.titleVersion ?? 0;
      const localTitleVersion = prev.titleVersion ?? 0;
      const titleFields =
        remoteTitleVersion > localTitleVersion
          ? { title: c.title, titleVersion: remoteTitleVersion }
          : { title: prev.title, titleVersion: localTitleVersion };

      const mergedConfig = {
        ...prevConfig,
        ...nextConfig,
        model: preferLocalSessionFields
          ? hasLocalModel
            ? prevConfig.model
            : nextConfig.model
          : nextConfig.model,
        model_ref: preferLocalSessionFields
          ? hasLocalModelRef
            ? prevConfig.model_ref
            : nextConfig.model_ref
          : nextConfig.model_ref,
        reasoningEffort: preferLocalSessionFields
          ? hasLocalReasoning
            ? prevConfig.reasoningEffort
            : nextConfig.reasoningEffort
          : nextConfig.reasoningEffort,
        goldConfig: preferLocalSessionFields
          ? hasLocalGoldConfig
            ? prevConfig.goldConfig
            : nextConfig.goldConfig
          : nextConfig.goldConfig,
        // Index rows have no metadata ETag. Once detail has confirmed a mode,
        // only another revisioned detail/PATCH response may replace it.
        permissionMode: prevConfig.permissionModeEtag ? prevConfig.permissionMode : nextConfig.permissionMode,
        permissionModeEtag: prevConfig.permissionModeEtag,
        bypassPermissions: prevConfig.permissionModeEtag
          ? prevConfig.bypassPermissions
          : nextConfig.bypassPermissions,
        compressionEvents: prev.config?.compressionEvents ?? c.config?.compressionEvents,
        syncCursor: prev.config?.syncCursor ?? c.config?.syncCursor,
      };

      const mergedChat: ChatItem = {
        ...c,
        // `title` and `titleVersion` are deliberately omitted here —
        // version-based precedence below (`...titleFields`) is the source of truth
        // for those two fields, overriding the `updatedAt`-based logic.
        pinned: preferLocalSessionFields ? prev.pinned : c.pinned,
        updatedAt: preferLocalSessionFields ? prev.updatedAt : c.updatedAt,
        messages: prev.messages,
        messageCount: effectiveMessageCount,
        planMode: c.planMode,
        config: mergedConfig,
        // Override title/titleVersion with version-based precedence,
        // overriding the `updatedAt`-based decision for these fields specifically.
        ...titleFields,
      };

      if (canReuseSessionListChat(prev, mergedChat)) {
        return prev;
      }

      return mergedChat;
    });

    let merged: ChatItem[];
    switch (scope.kind) {
      case "all":
        merged = mergedIncoming;
        break;
      case "roots":
        // Root refreshes are authoritative only for roots. Hydrated child trees
        // stay resident until their own scoped refresh completes. Children of a
        // deleted root are no longer a valid tree and are removed here.
        {
          const liveRootIds = new Set(mergedIncoming.map((chat) => chat.id));
          merged = [
            ...mergedIncoming,
            ...state.chats.filter((chat) => {
              const rootSessionId = chat.rootSessionId;
              return chat.kind === "child" &&
                typeof rootSessionId === "string" &&
                liveRootIds.has(rootSessionId);
            }),
          ];
          break;
        }
      case "children":
        // Replace exactly one flattened tree. This removes deleted children
        // without dropping roots or another root's already-hydrated children.
        merged = [
          ...state.chats.filter(
            (chat) => !(chat.kind === "child" && chat.rootSessionId === scope.rootSessionId),
          ),
          ...mergedIncoming,
        ];
        break;
      case "upsert": {
        const incomingById = new Map(mergedIncoming.map((chat) => [chat.id, chat]));
        merged = state.chats.map((chat) => incomingById.get(chat.id) ?? chat);
        merged.push(...mergedIncoming.filter((chat) => !prevById.has(chat.id)));
        break;
      }
    }

    // Filter accidental duplicates defensively. They can otherwise arise if a
    // mutable index shifts while an offset-based multi-page read is in flight.
    const seen = new Set<string>();
    merged = merged.filter((chat) => {
      if (seen.has(chat.id)) return false;
      seen.add(chat.id);
      return true;
    });

    const chatsChanged =
      merged.length !== state.chats.length ||
      merged.some((chat, index) => chat !== state.chats[index]);
    const sessionIndexRevision = scope.kind === "roots"
      ? state.sessionIndexRevision + 1
      : state.sessionIndexRevision;

    if (
      !chatsChanged &&
      executionBySession === state.executionBySession &&
      sessionIndexRevision === state.sessionIndexRevision
    ) {
      return state;
    }

    return {
      ...state,
      chats: chatsChanged ? merged : state.chats,
      executionBySession,
      sessionIndexRevision,
    };
  });
}

export function executeLoadSubagentSessions(
  sessionId: string,
  set: ChatSliceSet,
  get: () => AppState,
  options: { force?: boolean } = {},
): Promise<void> {
  const selected = get().chats.find((chat) => chat.id === sessionId);
  if (!selected) return Promise.resolve();

  const rootSessionId = selected.kind === "child"
    ? selected.rootSessionId
    : selected.id;
  if (!rootSessionId) return Promise.resolve();

  const root = get().chats.find((chat) => chat.id === rootSessionId);
  if (!root || root.kind === "child") return Promise.resolve();

  const existingRequest = subagentTreeRequests.get(rootSessionId);
  if (existingRequest) {
    // All panes targeting the same root share one worker. If the root index
    // advanced after its current read began, the worker makes exactly one more
    // pass before settling, regardless of how many panes requested it.
    if (options.force) {
      existingRequest.requestedRevision = Math.max(
        existingRequest.requestedRevision,
        get().sessionIndexRevision,
      );
    }
    return existingRequest.promise;
  }

  const currentChildren = get().chats.filter(
    (chat) => chat.kind === "child" && chat.rootSessionId === rootSessionId,
  );
  const expectedChildren = root.subagentCount ?? 0;
  if (!options.force && currentChildren.length === expectedChildren) {
    return Promise.resolve();
  }

  const request: SubagentTreeRequest = {
    requestedRevision: get().sessionIndexRevision,
    promise: Promise.resolve(),
  };
  request.promise = (async () => {
    let completedRevision = -1;
    while (completedRevision < request.requestedRevision) {
      const fetchRevision = request.requestedRevision;
      const latestRoot = get().chats.find((chat) => chat.id === rootSessionId);
      const latestExpectedChildren = latestRoot?.kind === "root"
        ? (latestRoot.subagentCount ?? 0)
        : 0;

      debugLog("[ChatSlice]", "subagents.load.start", {
        rootSessionId,
        expectedChildren: latestExpectedChildren,
        sessionIndexRevision: fetchRevision,
      });
      const sessions = latestExpectedChildren === 0
        ? []
        : await listAllSessionPages({
            kind: "child",
            root_session_id: rootSessionId,
            limit: SESSION_INDEX_PAGE_SIZE,
          });
      const liveRoot = get().chats.find((chat) => chat.id === rootSessionId);
      if (!liveRoot || liveRoot.kind !== "root") {
        debugLog("[ChatSlice]", "subagents.load.discarded", {
          rootSessionId,
          reason: "root_removed",
          sessionIndexRevision: fetchRevision,
        });
        return;
      }
      applySessionsList(sessions, set, { kind: "children", rootSessionId });
      get().reconcileSessionPermissionModes(sessions);
      completedRevision = fetchRevision;
      debugLog("[ChatSlice]", "subagents.load.applied", {
        rootSessionId,
        count: sessions.length,
        sessionIndexRevision: fetchRevision,
      });
    }
  })().finally(() => {
    if (subagentTreeRequests.get(rootSessionId) === request) {
      subagentTreeRequests.delete(rootSessionId);
    }
  });
  subagentTreeRequests.set(rootSessionId, request);
  return request.promise;
}

export async function executeRefreshChats(set: ChatSliceSet, get: () => AppState): Promise<void> {
  if (refreshChatsState.inFlight) {
    debugLog("[ChatSlice]", "refreshChats.inFlight.reuse", {});
    return refreshChatsState.inFlight;
  }

  debugLog("[ChatSlice]", "refreshChats.start", {});
  refreshChatsState.inFlight = (async () => {
    try {
      const sessions = await listAllSessionPages({
        kind: "root",
        limit: SESSION_INDEX_PAGE_SIZE,
      });
      debugLog("[ChatSlice]", "refreshChats.response", {
        count: sessions.length,
        runningCount: sessions.filter((session) => session.is_running).length,
      });
      applySessionsList(sessions, set, { kind: "roots" });
      get().reconcileSessionPermissionModes(sessions);
    } catch (error) {
      console.error("[ChatSlice] Failed to refresh sessions:", error);
      debugLog("[ChatSlice]", "refreshChats.error", { error });
      throw error;
    }
  })().finally(() => {
    debugLog("[ChatSlice]", "refreshChats.finally", {});
    refreshChatsState.inFlight = null;
  });

  return refreshChatsState.inFlight;
}

export function executeForcedRefreshChats(set: ChatSliceSet, get: () => AppState): Promise<void> {
  if (refreshChatsState.forcedPromise) {
    debugLog("[ChatSlice]", "refreshChatsNow.forced.reuse", {});
    return refreshChatsState.forcedPromise;
  }

  debugLog("[ChatSlice]", "refreshChatsNow.forced.start", {
    hasInflight: Boolean(refreshChatsState.inFlight),
  });
  refreshChatsState.forcedPromise = (async () => {
    if (refreshChatsState.inFlight) {
      await refreshChatsState.inFlight;
    }
    await executeRefreshChats(set, get);
  })().finally(() => {
    debugLog("[ChatSlice]", "refreshChatsNow.forced.finally", {});
    refreshChatsState.forcedPromise = null;
  });

  return refreshChatsState.forcedPromise;
}

export { REFRESH_CHATS_THROTTLE_MS };
