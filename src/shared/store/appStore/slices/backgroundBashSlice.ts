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
 *
 * NOTE: this slice is card-state ONLY. The completion NOTIFICATION (toast / OS
 * ping) is NOT driven from here — it is emitted by the backend as a deduped,
 * preference-gated `notification` event (category `background_task_completed`)
 * and surfaced via `onNotification`, so it fires once, live, and never on the
 * critical-event replay that re-delivers `bash_completed` on every resubscribe.
 */

export type BashStatus = "completed" | "killed" | "error";

/** Terminal outcome of a background shell. A missing map entry = still running. */
export type BashDone = {
  status: BashStatus;
  exitCode: number | null;
};

export interface BackgroundBashSlice {
  /** bash_id → terminal outcome. Absence of an entry means "still running". */
  backgroundBash: Record<string, BashDone>;
  /**
   * Record a background shell's terminal outcome (called from the
   * `onBashCompleted` handler). Keyed on `bash_id` so cards flip reactively.
   */
  setBashCompleted: (bashId: string, status: string, exitCode: number | null) => void;
}

const normalizeStatus = (status: string): BashStatus =>
  status === "killed" ? "killed" : status === "error" ? "error" : "completed";

export const createBackgroundBashSlice: StateCreator<AppState, [], [], BackgroundBashSlice> = (
  set,
) => ({
  backgroundBash: {},
  setBashCompleted: (bashId, status, exitCode) => {
    if (!bashId) return;
    const normalized = normalizeStatus(status);
    set((state) => {
      // Idempotent: `bash_completed` is a cached CRITICAL event replayed on every
      // (re)subscribe with the same terminal outcome. An already-seen shell whose
      // status + exitCode are unchanged is a no-op — return the SAME state
      // reference so subscribed cards don't re-render on each replay.
      const prev = state.backgroundBash[bashId];
      if (prev && prev.status === normalized && prev.exitCode === exitCode) {
        return state;
      }
      return {
        backgroundBash: { ...state.backgroundBash, [bashId]: { status: normalized, exitCode } },
      };
    });
  },
});
