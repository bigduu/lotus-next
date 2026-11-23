import { useSyncExternalStore } from "react"
import { getDraftCompletionEnabled, subscribeDraftCompletionEnabled } from "./draftCompletionPreferenceState"

export { setDraftCompletionEnabled } from "./draftCompletionPreferenceState"

export function useDraftCompletionEnabled(): boolean {
  return useSyncExternalStore(subscribeDraftCompletionEnabled, getDraftCompletionEnabled, () => false)
}
