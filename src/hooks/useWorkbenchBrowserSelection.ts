import { useEffect, useRef, type RefObject } from "react"
import type { BrowserState } from "@services/browser/types"

/** Restore a surviving page selection, without navigating or replaying browser actions. */
export function useWorkbenchBrowserSelection({ scope, state, savedId, selectionVersion, activateTab, save }: {
  scope: string | null
  state: BrowserState | null
  savedId: string | null
  selectionVersion: RefObject<number>
  activateTab: (id: string) => Promise<BrowserState | null>
  save: (id: string | null) => void
}) {
  const restoration = useRef<{
    scope: string | null
    version: number
    status: "pending" | "activating" | "complete"
    attemptedState?: BrowserState
  } | null>(null)

  useEffect(() => {
    if (restoration.current?.scope !== scope) {
      restoration.current = { scope, version: selectionVersion.current, status: "pending" }
    }
    const attempt = restoration.current!
    if (!state) return
    // Explicit user selection always supersedes an unfinished restoration.
    if (attempt.version !== selectionVersion.current) attempt.status = "complete"
    if (attempt.status === "activating") return
    if (attempt.status === "pending" && savedId && savedId !== state.active_tab_id
      && state.tabs?.some((tab) => tab.tab_id === savedId)) {
      // Do not lose the saved selection when a native dialog temporarily blocks activation.
      if (state.pending_dialog || attempt.attemptedState === state) return
      attempt.status = "activating"
      attempt.attemptedState = state
      void activateTab(savedId).then((result) => {
        if (restoration.current !== attempt || attempt.version !== selectionVersion.current) return
        attempt.status = result ? "complete" : "pending"
        if (result) save(result.active_tab_id ?? null)
      })
      return
    }
    attempt.status = "complete"
    save(state.active_tab_id ?? null)
  }, [scope, state, savedId, selectionVersion, activateTab, save])
}
