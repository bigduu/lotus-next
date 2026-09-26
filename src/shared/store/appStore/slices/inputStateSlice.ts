import { StateCreator } from "zustand";
import type { AppState } from "../";
import {
  isReasoningEffortSelection,
  type ReasoningEffortSelection,
} from "@shared/utils/reasoningEffort";
import { StorageManager, INPUT_THINKING_MODE_BY_DRAFT_STORAGE_KEY } from "@services/storage/StorageManager";
import { isThinkingMode, type ThinkingMode } from "@services/chat/AgentService";

// Attachment type (same as in InputContainer)
export interface Attachment {
  id: string;
  base64: string;
  name: string;
  size: number;
  type: string;
}

// Input state for a single chat session
export interface InputState {
  content: string;
  /** Runtime-only CAS token. Every content mutation receives a unique value. */
  contentRevision: number;
  referenceText: string | null;
  attachments: Attachment[];
  /** Explicit picker state. Missing means follow the configured/session value. */
  reasoningEffort?: ReasoningEffortSelection;
  /** Unsubmitted Root choice; existing-session mode authority comes from Bamboo. */
  thinkingMode?: ThinkingMode;
  thinkingModeRevision?: number;
}

export interface InputStateSliceState {
  // Map of sessionId to input state
  inputStates: Record<string, InputState>;
}

export interface InputStateSliceActions {
  // Set input content for a chat
  setInputContent: (sessionId: string, content: string) => void;
  // Replace content only if no writer has changed it since expectedRevision
  setInputContentIfRevision: (
    sessionId: string,
    expectedRevision: number,
    content: string,
  ) => boolean;
  // Atomically move a revision-owned draft into an empty target session
  moveInputContentIfRevision: (
    sourceSessionId: string,
    expectedRevision: number,
    targetSessionId: string,
  ) => boolean;
  // Set reference text for a chat
  setReferenceText: (sessionId: string, referenceText: string | null) => void;
  // Set attachments for a chat
  setAttachments: (sessionId: string, attachments: Attachment[]) => void;
  // Set reasoning effort for a chat
  setInputReasoningEffort: (
    sessionId: string,
    reasoningEffort: ReasoningEffortSelection,
  ) => void;
  // Remove a draft/session-local picker override.
  clearInputReasoningEffort: (sessionId: string) => void;
  setInputThinkingMode: (draftKey: string, mode: ThinkingMode) => boolean;
  clearInputThinkingModeIfRevision: (draftKey: string, revision: number) => boolean;
  // Clear all input state for a chat
  clearInputState: (sessionId: string) => void;
  // Get input state for a chat (returns default if not found)
  getInputState: (sessionId: string) => InputState;
}

export type InputStateSlice = InputStateSliceState & InputStateSliceActions;

const INPUT_REASONING_BY_SESSION_LS_KEY = "chat_input_reasoning_by_session_v1";

const DEFAULT_INPUT_STATE: InputState = {
  content: "",
  contentRevision: 0,
  referenceText: null,
  attachments: [],
};

// A module-lifetime sequence avoids same-value ABA across panes and component
// remounts. In-flight browser requests cannot survive a full JavaScript runtime
// restart, so this token intentionally does not need persistence.
let inputContentRevisionSequence = 0;

const nextInputContentRevision = (): number => {
  inputContentRevisionSequence += 1;
  return inputContentRevisionSequence;
};

const readReasoningBySession = (): Record<string, ReasoningEffortSelection> => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = localStorage.getItem(INPUT_REASONING_BY_SESSION_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, ReasoningEffortSelection> = {};
    for (const [sessionId, value] of Object.entries(parsed || {})) {
      if (isReasoningEffortSelection(value)) {
        next[sessionId] = value;
      }
    }
    return next;
  } catch {
    return {};
  }
};

const writeReasoningBySession = (value: Record<string, ReasoningEffortSelection>) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(INPUT_REASONING_BY_SESSION_LS_KEY, JSON.stringify(value));
  } catch {
    // ignore localStorage quota/security errors
  }
};

export const readPersistedInputReasoningEffort = (
  sessionId: string,
): ReasoningEffortSelection | undefined => {
  // New-session sentinels are ephemeral. Their initial value must come from
  // Provider Settings, never a stale previous draft or legacy "last used" key.
  if (sessionId === "" || sessionId === "__new_chat_pane2__") return undefined;
  const bySession = readReasoningBySession();
  if (isReasoningEffortSelection(bySession[sessionId])) {
    return bySession[sessionId];
  }
  return undefined;
};

const defaultInputStateForSession = (sessionId: string): InputState => {
  const reasoningEffort = readPersistedInputReasoningEffort(sessionId);
  const thinkingMode = readThinkingModes()[sessionId];
  return {
    ...DEFAULT_INPUT_STATE,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(thinkingMode ? { thinkingMode, thinkingModeRevision: nextInputContentRevision() } : {}),
  };
};

const readThinkingModes = (): Record<string, ThinkingMode> => {
  const modes: Record<string, ThinkingMode> = Object.create(null);
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(INPUT_THINKING_MODE_BY_DRAFT_STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return modes;
    for (const [key, value] of Object.entries(parsed)) {
      if (isThinkingMode(value)) modes[key] = value;
    }
  } catch { /* No persisted choice is safer than accepting malformed data. */ }
  return modes;
};

const writeThinkingModes = (modes: Record<string, ThinkingMode>): boolean => {
  try {
    const raw = JSON.stringify(modes);
    localStorage.setItem(INPUT_THINKING_MODE_BY_DRAFT_STORAGE_KEY, raw);
    return localStorage.getItem(INPUT_THINKING_MODE_BY_DRAFT_STORAGE_KEY) === raw;
  } catch { return false; }
};

export const createInputStateSlice: StateCreator<AppState, [], [], InputStateSlice> = (
  set,
  get,
) => ({
  // State
  inputStates: {},

  // Set input content for a chat
  setInputContent: (sessionId, content) =>
    set((state) => ({
      inputStates: {
        ...state.inputStates,
        [sessionId]: {
          ...(state.inputStates[sessionId] || defaultInputStateForSession(sessionId)),
          content,
          contentRevision: nextInputContentRevision(),
        },
      },
    })),

  setInputContentIfRevision: (sessionId, expectedRevision, content) => {
    let replaced = false;
    set((state) => {
      const current = state.inputStates[sessionId] || defaultInputStateForSession(sessionId);
      if (current.contentRevision !== expectedRevision) return state;
      replaced = true;
      return {
        inputStates: {
          ...state.inputStates,
          [sessionId]: {
            ...current,
            content,
            contentRevision: nextInputContentRevision(),
          },
        },
      };
    });
    return replaced;
  },

  moveInputContentIfRevision: (sourceSessionId, expectedRevision, targetSessionId) => {
    let moved = false;
    set((state) => {
      const source = state.inputStates[sourceSessionId] ||
        defaultInputStateForSession(sourceSessionId);
      const target = state.inputStates[targetSessionId] ||
        defaultInputStateForSession(targetSessionId);
      if (source.contentRevision !== expectedRevision || target.content) return state;
      moved = true;
      return {
        inputStates: {
          ...state.inputStates,
          [sourceSessionId]: {
            ...source,
            content: "",
            contentRevision: nextInputContentRevision(),
          },
          [targetSessionId]: {
            ...target,
            content: source.content,
            contentRevision: nextInputContentRevision(),
          },
        },
      };
    });
    return moved;
  },

  // Set reference text for a chat
  setReferenceText: (sessionId, referenceText) =>
    set((state) => ({
      inputStates: {
        ...state.inputStates,
        [sessionId]: {
          ...(state.inputStates[sessionId] || defaultInputStateForSession(sessionId)),
          referenceText,
        },
      },
    })),

  // Set attachments for a chat
  setAttachments: (sessionId, attachments) =>
    set((state) => ({
      inputStates: {
        ...state.inputStates,
        [sessionId]: {
          ...(state.inputStates[sessionId] || defaultInputStateForSession(sessionId)),
          attachments,
        },
      },
    })),

  // Set reasoning effort for a chat
  setInputReasoningEffort: (sessionId, reasoningEffort) => {
    set((state) => ({
      inputStates: {
        ...state.inputStates,
        [sessionId]: {
          ...(state.inputStates[sessionId] || defaultInputStateForSession(sessionId)),
          reasoningEffort,
        },
      },
    }));

    // New-session picks are one-shot and stay in memory. Once the server
    // acknowledges the new session, ChatPane clears the sentinel selection.
    if (sessionId !== "" && sessionId !== "__new_chat_pane2__") {
      const bySession = readReasoningBySession();
      bySession[sessionId] = reasoningEffort;
      writeReasoningBySession(bySession);

      // Also persist session-local picker state to IndexedDB.
      const manager = StorageManager.getInstance();
      manager.saveInputReasoning(sessionId, reasoningEffort).catch(() => {});
    }
  },

  clearInputReasoningEffort: (sessionId) => {
    set((state) => {
      const current = state.inputStates[sessionId];
      if (!current || current.reasoningEffort === undefined) return state;
      const { reasoningEffort: _reasoningEffort, ...rest } = current;
      return {
        inputStates: {
          ...state.inputStates,
          [sessionId]: rest,
        },
      };
    });

    const bySession = readReasoningBySession();
    if (Object.prototype.hasOwnProperty.call(bySession, sessionId)) {
      delete bySession[sessionId];
      writeReasoningBySession(bySession);
    }
    StorageManager.getInstance().saveInputReasoning(sessionId, null).catch(() => {});
  },

  setInputThinkingMode: (draftKey, mode) => {
    if (!isThinkingMode(mode)) return false;
    const modes = readThinkingModes();
    modes[draftKey] = mode;
    if (!writeThinkingModes(modes)) return false;
    set((state) => ({
      inputStates: {
        ...state.inputStates,
        [draftKey]: {
          ...(state.inputStates[draftKey] || defaultInputStateForSession(draftKey)),
          thinkingMode: mode,
          thinkingModeRevision: nextInputContentRevision(),
        },
      },
    }));
    StorageManager.getInstance().saveInputThinkingMode(draftKey, mode).catch(() => {});
    return true;
  },

  clearInputThinkingModeIfRevision: (draftKey, revision) => {
    const current = get().inputStates[draftKey];
    if (!current || current.thinkingMode === undefined || current.thinkingModeRevision !== revision) return false;
    const modes = readThinkingModes();
    // Another tab's differing choice must not be cleared by this ACK either.
    if (modes[draftKey] !== current.thinkingMode) return false;
    delete modes[draftKey];
    if (!writeThinkingModes(modes)) return false;
    const { thinkingMode: _mode, ...rest } = current;
    set((state) => ({ inputStates: {
      ...state.inputStates, [draftKey]: { ...rest, thinkingModeRevision: nextInputContentRevision() },
    } }));
    StorageManager.getInstance().saveInputThinkingMode(draftKey, null).catch(() => {});
    return true;
  },

  // Clear all input state for a chat
  clearInputState: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...remainingInputStates } = state.inputStates;
      return {
        inputStates: remainingInputStates,
      };
    }),

  // Get input state for a chat (returns default if not found)
  getInputState: (sessionId) => {
    return get().inputStates[sessionId] || defaultInputStateForSession(sessionId);
  },
});
