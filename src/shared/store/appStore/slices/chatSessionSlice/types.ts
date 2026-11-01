import { ChatItem, Message } from "@shared/types/chat";
import type { HistoryResponse, ReasoningEffort, SessionSummary } from "@services/chat/AgentService";
import type { ConversationClearFailure } from "@services/chat/conversationClear";
import type { ManagedSessionSelection } from "@services/supervisorScope/managedSessions";

export interface ConversationClearState {
  busy: boolean;
  confirmed?: boolean;
  error?: ConversationClearFailure;
  readbackConfirmed?: boolean;
  refreshFailed?: boolean;
}

export type DeleteMessageFailureReason =
  | "session_not_found"
  | "message_not_found"
  | "backend_not_found"
  | "session_running"
  | "backend_error";

export type DeleteMessageResult =
  | {
      success: true;
      sessionId: string;
      messageId: string;
    }
  | {
      success: false;
      sessionId: string;
      messageId: string;
      reason: DeleteMessageFailureReason;
      statusCode?: number;
      errorMessage?: string;
    };

export interface ChatSlice {
  // State (backend session list)
  chats: ChatItem[];
  currentSessionId: string | null;
  latestActiveSessionId: string | null;
  /** Advances after each authoritative root-index refresh. */
  sessionIndexRevision: number;
  conversationClears: Record<string, ConversationClearState>;
  /** Identity retained for every subsequent history read of a managed view. */
  managedHistoryBindings: Record<string, { selection: ManagedSessionSelection; status: "active" | "stale" }>;

  // Actions
  addChat: (chat: Omit<ChatItem, "id">) => Promise<string>;
  selectSession: (sessionId: string | null) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  getSessionNavigationRevision: () => number;
  invalidateSessionNavigation: (sessionId?: string) => void;
  deleteSessions: (sessionIds: string[]) => Promise<void>;
  updateSession: (
    sessionId: string,
    updates: Partial<ChatItem>,
    options?: { skipBackendPatch?: boolean },
  ) => void;
  /** Persist a model choice before showing it as the session's active model. */
  changeSessionModel: (sessionId: string, model: string) => Promise<void>;
  /** Persist a session reasoning override; null restores inherited/Auto mode. */
  changeSessionReasoningEffort: (
    sessionId: string,
    reasoningEffort: ReasoningEffort | null,
  ) => Promise<void>;
  persistSessionTitle: (sessionId: string, title: string) => Promise<void>;
  /**
   * Apply an authoritative server title (from a `session_title_updated` SSE event).
   * Updates `title` + `titleVersion` only when `titleVersion > current.titleVersion`.
   * Does NOT call `patchSession` — the backend has already persisted the change
   * (the SSE event implies persistence).
   */
  applyServerTitle: (sessionId: string, title: string, titleVersion: number) => void;
  /**
   * Apply an authoritative server pinned flag (from a `session_pinned_updated`
   * SSE event). Suppresses replays whose `updatedAt` is older than the local
   * `updatedAt`, and skips writes when the flag already matches. Does NOT call
   * `patchSession` — the SSE event implies persistence.
   */
  applyServerPinned: (sessionId: string, pinned: boolean, updatedAt: string) => void;
  pinSession: (sessionId: string) => void;
  unpinSession: (sessionId: string) => void;

  addMessage: (sessionId: string, message: Message) => Promise<void>;
  setMessages: (sessionId: string, messages: Message[]) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  deleteMessage: (sessionId: string, messageId: string) => Promise<DeleteMessageResult>;

  loadChats: () => Promise<void>;
  refreshChats: () => Promise<void>;
  refreshChatsNow: () => Promise<void>;
  /** Hydrate the flattened child tree for the selected root/child session. */
  loadSubagentSessions: (
    sessionId: string,
    options?: { force?: boolean },
  ) => Promise<void>;
  /** Restore a persisted session id that may refer to an unloaded child. */
  restoreSession: (sessionId: string) => Promise<boolean>;
  clearConversation: (sessionId: string) => Promise<void>;
  verifyConversationClear: (sessionId: string, options?: { tokenRevision?: { usage: number; truncation: number } }) => Promise<void>;
  dismissConversationClear: (sessionId: string) => void;
  refreshConversationClear: (sessionId: string) => Promise<void>;
  /** Fence old reads immediately on a cross-client clear event, then refetch. */
  reconcileClearedConversation: (sessionId: string) => void;
  /** Read a cold target's root tree without changing the session cache. */
  stageSessionForNavigation: (target: SessionSummary) => Promise<SessionSummary[] | null>;
  loadChatHistory: (
    sessionId: string,
    options?: {
      mode?: "replace" | "monotonic";
      retries?: number;
      retryDelayMs?: number;
      waitForAssistant?: boolean;
      /** Opt-in read UI must distinguish failure from empty history. */
      throwOnError?: boolean;
      /** Fence abandoned read results; does not cancel backend execution. */
      signal?: AbortSignal;
      /** A bound history reader is allowed only in a guarded navigation. */
      readHistory?: () => Promise<HistoryResponse>;
      /** Bind this guarded navigation and all later refreshes to its target. */
      managedSelection?: ManagedSessionSelection;
      /** Revalidate an observed target before committing any history fields. */
      beforeApply?: () => Promise<boolean>;
      /** Synchronously fence local navigation after the asynchronous check. */
      canApply?: () => boolean;
      /** Cold summaries remain private until this guarded history read commits. */
      stagedSessions?: SessionSummary[];
      /** Select in the same guarded store update as the history commit. */
      selectOnApply?: boolean;
    },
  ) => Promise<void>;
  /**
   * Multi-device sync: reconcile the CURRENTLY-OPEN session against the server
   * when an account-feed change event for it arrives (a message appended / run
   * completed / clarification raised on ANOTHER device). Debounced per session.
   *
   * Safe to call during a live local stream: it loads history in `monotonic`
   * mode, so it only catches a *behind* (passive-viewer) device up and is a
   * no-op on the device that is driving the run (whose local state is ahead).
   * Also re-pulls the pending question so a clarification answered on another
   * device clears here (and a new one appears). No-op unless `sessionId` is the
   * open session.
   */
  reconcileOpenSession: (sessionId: string, reason?: string) => void;
}
