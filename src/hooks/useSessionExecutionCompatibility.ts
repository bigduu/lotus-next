import { useCallback, useEffect, useSyncExternalStore } from "react"
import { onReconnected } from "@services/chat/v2Stream"
import { getSessionCompatibilitySnapshot, readSessionExecutionDetail,
  subscribeSessionCompatibility } from "@services/chat/sessionExecutionCompatibility"

export function useSessionExecutionCompatibility(sessionId: string | null) {
  const snapshot = useSyncExternalStore(subscribeSessionCompatibility,
    () => getSessionCompatibilitySnapshot(sessionId), () => getSessionCompatibilitySnapshot(null))
  const refresh = useCallback(async () => {
    if (!sessionId) return
    await readSessionExecutionDetail(sessionId).catch(() => undefined)
  }, [sessionId])
  useEffect(() => {
    void refresh()
    if (!sessionId) return
    return onReconnected(() => { void refresh() })
  }, [refresh, sessionId])
  return { ...snapshot, blocked: snapshot.report?.status === "conflict", refresh }
}
export type SessionExecutionCompatibilityView = ReturnType<typeof useSessionExecutionCompatibility>
