import { bindReactStore } from "../bindReactStore"
import { appStore } from "./state"
import type { BashDone } from "./slices/backgroundBashSlice"

export * from "./state"
export const useAppStore = bindReactStore(appStore)

/**
 * Reactive selector for a background shell's terminal outcome by `bash_id`.
 * Returns `undefined` while the shell is still running, then the {@link BashDone}
 * outcome once its `bash_completed` event has been recorded — letting an
 * already-rendered tool card flip without a history reload.
 */
export const useBackgroundBash = (bashId: string): BashDone | undefined =>
  useAppStore((state) => state.backgroundBash[bashId]);
