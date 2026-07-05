import { StateCreator } from "zustand";
import type { AppState } from "../";

/**
 * Background/async shell (bash) completion tracking.
 *
 * A background tool call returns a normal `tool_complete` whose result JSON
 * carries `{ bash_id, status: "running", ... }`. Later, a distinct
 * `bash_completed` event arrives on the same session stream. This slice records
 * those terminal outcomes keyed by `bash_id` so an already-rendered tool card
 * can flip from "Running in background" to its final state reactively — no
 * history reload required.
 */

export type BashStatus = "completed" | "killed" | "error";

/** Terminal outcome of a background shell. A missing map entry = still running. */
export type BashDone = {
  status: BashStatus;
  exitCode: number | null;
};

/** Latest completion, for surfacing a one-shot toast / desktop notification. */
export type BashCompletion = {
  bashId: string;
  command: string;
  status: BashStatus;
  exitCode: number | null;
  /** Monotonic discriminator so a consumer fires its side effect exactly once. */
  seq: number;
};

export interface BackgroundBashSlice {
  /** bash_id → terminal outcome. Absence of an entry means "still running". */
  backgroundBash: Record<string, BashDone>;
  /** Most recent completion, bumped each time so consumers can de-dup by seq. */
  lastBashCompletion: BashCompletion | null;
  /**
   * Record a background shell's terminal outcome (called from the
   * `onBashCompleted` handler). Keyed on `bash_id` so cards flip reactively.
   */
  setBashCompleted: (
    bashId: string,
    status: string,
    exitCode: number | null,
    command?: string,
  ) => void;
}

const normalizeStatus = (status: string): BashStatus =>
  status === "killed" ? "killed" : status === "error" ? "error" : "completed";

export const createBackgroundBashSlice: StateCreator<AppState, [], [], BackgroundBashSlice> = (
  set,
) => ({
  backgroundBash: {},
  lastBashCompletion: null,
  setBashCompleted: (bashId, status, exitCode, command) => {
    if (!bashId) return;
    const normalized = normalizeStatus(status);
    const done: BashDone = { status: normalized, exitCode };
    set((state) => {
      // `bash_completed` is a cached CRITICAL backend event, replayed to every
      // (re)subscriber on reconnect / resume / app boot. The card flip is
      // idempotent and always applied, but the notifiable-completion signal must
      // fire exactly once — so bump `lastBashCompletion` ONLY the first time we
      // see this bash_id. (Keying the one-shot on a per-delivery seq instead
      // would mint a fresh value on each replay and re-fire the toast.)
      const firstSeen = state.backgroundBash[bashId] === undefined;
      // Idempotent replay: an already-seen shell with an unchanged terminal
      // outcome is a no-op — return the SAME state reference so subscribed cards
      // don't re-render on every replayed bash_completed.
      const prev = state.backgroundBash[bashId];
      if (!firstSeen && prev && prev.status === normalized && prev.exitCode === exitCode) {
        return state;
      }
      return {
        backgroundBash: { ...state.backgroundBash, [bashId]: done },
        lastBashCompletion: firstSeen
          ? {
              bashId,
              command: command ?? "",
              status: normalized,
              exitCode,
              seq: (state.lastBashCompletion?.seq ?? 0) + 1,
            }
          : state.lastBashCompletion,
      };
    });
  },
});
