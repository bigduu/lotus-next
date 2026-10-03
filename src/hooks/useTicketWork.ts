import { useCallback, useEffect, useRef, useState } from "react"
import { getErrorMessage, isApiError } from "@services/api"
import { ticketClient } from "@services/tickets/client"
import { applyTicketSnapshot, responseCommand, type TicketState } from "@services/tickets/state"
import type { Decision, PendingRequest, ResponseCommand } from "@services/tickets/types"
import { clearDecisionReceipt, readDecisionReceipts, saveDecisionReceipt } from "@services/tickets/decisionReceipts"

export function useTicketWork(sessionId: string | null | undefined) {
  const [state, setState] = useState<TicketState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [uncertain, setUncertain] = useState<Record<string, ResponseCommand>>({})
  const current = useRef<TicketState | null>(null)
  const scope = useRef(sessionId)
  const epoch = useRef(0)
  const activeRequests = useRef(new Set<string>())
  if (scope.current !== sessionId) epoch.current += 1
  scope.current = sessionId
  const refreshRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    current.current = null; setState(null); setConnected(false); setError(null); setBusy({}); setUncertain({})
    setDecisionError(null)
    activeRequests.current.clear()
    if (!sessionId) return
    try { setUncertain(readDecisionReceipts(sessionId)) }
    catch (failure) { setDecisionError(getErrorMessage(failure)) }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let refreshing = false
    const refresh = async (full = true) => {
      if (refreshing || controller.signal.aborted) return
      refreshing = true
      try {
        if (!full && current.current) {
          try {
            const changes = await ticketClient.changes(current.current.current.snapshot.seq, controller.signal)
            if (changes.snapshot.seq === current.current.current.snapshot.seq
              && changes.snapshot.authority_epoch === current.current.current.snapshot.authority_epoch) { setConnected(true); setError(null); return }
          } catch (failure) { if (!isApiError(failure) || failure.status !== 409) throw failure }
        }
        const result = await ticketClient.load(sessionId, controller.signal)
        if (controller.signal.aborted) return
        current.current = result ? applyTicketSnapshot(current.current, result) : null
        setUncertain(readDecisionReceipts(sessionId))
        setState(current.current); setConnected(true); setError(null)
      } catch (failure) {
        if (!controller.signal.aborted) { setConnected(false); setError(getErrorMessage(failure)) }
      } finally { refreshing = false }
    }
    refreshRef.current = () => refresh()
    const poll = async () => {
      if (!document.hidden) await refresh(false)
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2500)
    }
    const reconnect = () => { void refresh() }
    window.addEventListener("online", reconnect); window.addEventListener("focus", reconnect)
    void poll()
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener("online", reconnect); window.removeEventListener("focus", reconnect) }
  }, [sessionId])

  const respond = useCallback(async (request: PendingRequest, decision: Decision) => {
    const captured = sessionId
    const capturedEpoch = epoch.current
    if (!current.current || current.current.current.scope.binding.supervisor_session_id !== captured
      || !connected || !current.current.current.complete || !current.current.current.scope.mutation_enabled || current.current.current.scope.health !== "writable"
      || activeRequests.current.has(request.id)) return false
    let retry: ResponseCommand | undefined
    try { retry = readDecisionReceipts(captured!)[request.id] }
    catch (failure) { setDecisionError(getErrorMessage(failure)); return false }
    if (retry && JSON.stringify(retry.decision) !== JSON.stringify(decision)) {
      setDecisionError("上次发送尚未确认，请先确认同一请求的发送结果。"); return false
    }
    let command: ResponseCommand
    try {
      command = retry ?? responseCommand(current.current, request, decision, crypto.randomUUID())
      saveDecisionReceipt(captured!, command)
    }
    catch (failure) { setDecisionError(getErrorMessage(failure)); return false }
    activeRequests.current.add(request.id)
    setDecisionError(null)
    setBusy((old) => ({ ...old, [request.id]: true }))
    try {
      try { await ticketClient.respond(command) }
      catch (failure) {
        // A known pre-commit conflict can rebase one ordinary answer after a
        // full snapshot confirms the same exact request. Approval and unknown
        // acknowledgements still require explicit confirmation.
        if (retry || decision.kind !== "question" || !isApiError(failure) || failure.status !== 409
          || failure.message !== "revision_conflict") throw failure
        await refreshRef.current()
        if (scope.current !== captured || epoch.current !== capturedEpoch || !current.current
          || current.current.current.snapshot.seq <= command.expected_seq) throw failure
        command = responseCommand(current.current, request, decision, crypto.randomUUID())
        saveDecisionReceipt(captured!, command)
        await ticketClient.respond(command)
      }
      clearDecisionReceipt(captured!, command)
      if (scope.current !== captured || epoch.current !== capturedEpoch) return false
      setUncertain((old) => { const next = { ...old }; delete next[request.id]; return next })
      await refreshRef.current(); return true
    } catch (failure) {
      const unknown = !!retry || !isApiError(failure) || failure.status >= 500
      if (!unknown) clearDecisionReceipt(captured!, command)
      if (scope.current !== captured || epoch.current !== capturedEpoch) return false
      if (unknown) {
        setUncertain((old) => ({ ...old, [request.id]: command }))
        setDecisionError("发送结果尚未确认；重试会使用同一请求和原操作 ID。");
      } else {
        setUncertain((old) => { const next = { ...old }; delete next[request.id]; return next })
        setDecisionError(failure.message === "revision_conflict"
          ? "工作已更新，请核对当前问题后再次提交。" : getErrorMessage(failure)); await refreshRef.current()
      }
      return false
    } finally { if (scope.current === captured && epoch.current === capturedEpoch) { activeRequests.current.delete(request.id); setBusy((old) => ({ ...old, [request.id]: false })) } }
  }, [sessionId, connected])

  return { state, error: decisionError ?? error, connected, busy, uncertain, respond, refresh: () => refreshRef.current(),
    canRespond: connected && state !== null && state.current.scope.binding.supervisor_session_id === sessionId
      && state.current.complete && state.current.scope.health === "writable" && state.current.scope.mutation_enabled === true }
}
