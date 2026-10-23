import { useCallback, useEffect, useSyncExternalStore } from "react"
import { agentClient } from "@services/chat/AgentService"
import { onReconnected } from "@services/chat/v2Stream"
import { beginSessionCompatibilityRead, completeSessionCompatibilityRead, failSessionCompatibilityRead,
  getSessionCompatibilitySnapshot, subscribeSessionCompatibility } from "@services/chat/sessionExecutionCompatibility"

export function useSessionExecutionCompatibility(sessionId: string | null) {
  const snapshot = useSyncExternalStore(subscribeSessionCompatibility,
    () => getSessionCompatibilitySnapshot(sessionId), () => getSessionCompatibilitySnapshot(null))
  const refresh = useCallback(async () => {
    if (!sessionId) return
    const generation = beginSessionCompatibilityRead(sessionId)
    try { completeSessionCompatibilityRead(sessionId, generation, await agentClient.getSession(sessionId)) }
    catch { failSessionCompatibilityRead(sessionId, generation) }
  }, [sessionId])
  useEffect(() => {
    void refresh()
    if (!sessionId) return
    return onReconnected(() => { void refresh() })
  }, [refresh, sessionId])
  return { ...snapshot, blocked: snapshot.report?.status === "conflict", refresh }
}
export type SessionExecutionCompatibilityView = ReturnType<typeof useSessionExecutionCompatibility>
