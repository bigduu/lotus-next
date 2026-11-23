import { useCallback, useSyncExternalStore } from "react"
import { getRootModeFenceState, subscribeRootModeFence, type RootModeFenceState } from "./rootModeTransitionState"

export * from "./rootModeTransitionState"

export function useRootModeFenceState(sessionId: string | null): RootModeFenceState {
  const subscribe = useCallback((onChange: () => void) => subscribeRootModeFence(sessionId, onChange), [sessionId])
  const getSnapshot = useCallback(() => sessionId ? getRootModeFenceState(sessionId) : "clear", [sessionId])
  return useSyncExternalStore(subscribe, getSnapshot, () => "clear")
}
