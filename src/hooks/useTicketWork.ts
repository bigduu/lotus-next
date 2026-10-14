import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { getErrorMessage, isApiError } from "@services/api"
import { initializationRefusal, ticketAvailabilityFailure, TicketScopeUnavailableError, type TicketAvailability } from "@services/tickets/availability"
import { ticketClient } from "@services/tickets/client"
import { OwnerAccessContext } from "./ownerAccessContext"
import { applyTicketSnapshot, responseCommand, type TicketState } from "@services/tickets/state"
import type { Decision, PendingRequest, ResponseCommand } from "@services/tickets/types"
import { clearDecisionReceipt, readDecisionReceipts, saveDecisionReceipt } from "@services/tickets/decisionReceipts"

// Both panes can show the same Supervisor. Share only a request admission lock,
// never scope data, permission, or an initialization command.
const initializingSessions = new Set<string>()
const initializationListeners = new Set<() => void>()
const subscribeInitialization = (listener: () => void) => {
  initializationListeners.add(listener)
  return () => { initializationListeners.delete(listener) }
}
const notifyInitialization = () => { for (const listener of initializationListeners) listener() }

async function sendDecision(command: ResponseCommand) {
  const acknowledgement = await ticketClient.respond(command)
  if (!acknowledgement || acknowledgement.operation_id !== command.operation_id
    || !Number.isSafeInteger(acknowledgement.committed_seq) || acknowledgement.committed_seq <= command.expected_seq) {
    throw new Error(uiText("ticket_the_decision_receipt_is_not_confirmed_retry_t_42a54511"))
  }
}

export function useTicketWork(sessionId: string | null | undefined, authorityKey = "", authorityBlocked = false, deferRead = false) {
  useUiLocale()
  const ownerAccess = useContext(OwnerAccessContext)
  const [availability, setAvailability] = useState<TicketAvailability>({ kind: "loading" })
  const [refreshing, setRefreshing] = useState(false)
  const initializing = useSyncExternalStore(subscribeInitialization, () => !!sessionId && initializingSessions.has(sessionId), () => false)
  const [initializationError, setInitializationError] = useState<string | null>(null)
  const initializationFlight = useRef<object | null>(null)
  const [settledEpoch, setSettledEpoch] = useState(-1)
  const [state, setState] = useState<TicketState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const connection = useRef(false)
  const [negotiatedSession, setNegotiatedSession] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [uncertain, setUncertain] = useState<Record<string, ResponseCommand>>({})
  const current = useRef<TicketState | null>(null)
  const scope = useRef(sessionId)
  const access = useRef(ownerAccess)
  const epoch = useRef(0)
  const authority = useRef({ key: authorityKey, blocked: authorityBlocked, deferRead })
  const activeRequests = useRef(new Set<string>())
  if (scope.current !== sessionId || access.current !== ownerAccess
    || authority.current.key !== authorityKey || authority.current.blocked !== authorityBlocked || authority.current.deferRead !== deferRead) epoch.current += 1
  scope.current = sessionId
  access.current = ownerAccess
  authority.current = { key: authorityKey, blocked: authorityBlocked, deferRead }
  const refreshRef = useRef<(afterInitialization?: boolean) => Promise<void>>(async () => {})

  useEffect(() => {
    current.current = null; connection.current = false; setState(null); setConnected(false); setNegotiatedSession(null); setError(null); setBusy({}); setUncertain({})
    const capturedEpoch = epoch.current
    setInitializationError(null); setSettledEpoch(-1)
    setDecisionError(null); setAvailability({ kind: "loading" }); setRefreshing(false)
    activeRequests.current.clear()
    refreshRef.current = async () => {}
    if (!sessionId || !ownerAccess) {
      setSettledEpoch(capturedEpoch); setNegotiatedSession(sessionId ?? null)
      setAvailability({ kind: !ownerAccess ? "forbidden" : "unbound" })
      return
    }
    if (deferRead) return
    try { setUncertain(readDecisionReceipts(sessionId)) }
    catch (failure) { setDecisionError(getErrorMessage(failure)) }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let refreshing = false
    const refresh = async (full = true, afterInitialization = false) => {
      if (refreshing || controller.signal.aborted || epoch.current !== capturedEpoch
        || initializingSessions.has(sessionId) && !afterInitialization) return
      refreshing = true; setRefreshing(true)
      try {
        if (!full && current.current) {
          try {
            const changes = await ticketClient.changes(current.current.current.snapshot.seq, controller.signal)
            if (changes.snapshot.seq === current.current.current.snapshot.seq
              && changes.snapshot.authority_epoch === current.current.current.snapshot.authority_epoch) {
              const negotiated = await ticketClient.scope(sessionId, controller.signal)
              if (controller.signal.aborted || epoch.current !== capturedEpoch) return
              if (!negotiated) {
                current.current = null; connection.current = true; setState(null); setConnected(true); setNegotiatedSession(sessionId); setError(null); setAvailability({ kind: "unbound" }); setSettledEpoch(capturedEpoch); return
              }
              const previous = current.current.current
              if (negotiated.binding.scope_id === previous.scope.binding.scope_id
                && negotiated.binding.binding_revision === previous.scope.binding.binding_revision
                && negotiated.overview.snapshot.commit === previous.snapshot.commit
                && negotiated.overview.snapshot.seq === previous.snapshot.seq
                && negotiated.overview.snapshot.authority_epoch === previous.snapshot.authority_epoch) {
                current.current = { ...current.current, current: { ...previous, scope: negotiated } }
                connection.current = true; setState(current.current); setConnected(true); setNegotiatedSession(sessionId); setError(null); setAvailability({ kind: "ready" }); setSettledEpoch(capturedEpoch); return
              }
            }
          } catch (failure) { if (!isApiError(failure) || ![409, 410].includes(failure.status)) throw failure }
        }
        const result = await ticketClient.load(sessionId, controller.signal)
        if (controller.signal.aborted || epoch.current !== capturedEpoch) return
        current.current = result ? applyTicketSnapshot(current.current, result) : null
        setUncertain(readDecisionReceipts(sessionId))
        connection.current = true; setState(current.current); setConnected(true); setNegotiatedSession(sessionId); setError(null); setAvailability({ kind: result ? "ready" : "unbound" }); setSettledEpoch(capturedEpoch)
      } catch (failure) {
        if (!controller.signal.aborted && epoch.current === capturedEpoch) {
          setSettledEpoch(capturedEpoch)
          const next = ticketAvailabilityFailure(failure)
          connection.current = false; setConnected(false); setAvailability(next); setError(getErrorMessage(failure))
          if (failure instanceof TicketScopeUnavailableError || next.kind === "forbidden") {
            current.current = null; setState(null)
          }
          if (failure instanceof TicketScopeUnavailableError) setNegotiatedSession(sessionId)
        }
      } finally { refreshing = false; if (!controller.signal.aborted && epoch.current === capturedEpoch) setRefreshing(false) }
    }
    refreshRef.current = (afterInitialization) => refresh(true, afterInitialization)
    const poll = async () => {
      if (!document.hidden) await refresh(false)
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2500)
    }
    const reconnect = () => { void refresh() }
    window.addEventListener("online", reconnect); window.addEventListener("focus", reconnect)
    void poll()
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener("online", reconnect); window.removeEventListener("focus", reconnect) }
  }, [sessionId, ownerAccess, authorityKey, authorityBlocked, deferRead])

  const respond = useCallback(async (request: PendingRequest, decision: Decision) => {
    const captured = sessionId
    const capturedEpoch = epoch.current
    if (settledEpoch !== capturedEpoch || authorityBlocked || deferRead || !ownerAccess || !current.current || current.current.current.scope.binding.supervisor_session_id !== captured
      || !connection.current || !current.current.current.complete || !current.current.current.scope.mutation_enabled || current.current.current.scope.health !== "writable"
      || activeRequests.current.has(request.id)) return false
    let retry: ResponseCommand | undefined
    try { retry = readDecisionReceipts(captured!)[request.id] }
    catch (failure) { setDecisionError(getErrorMessage(failure)); return false }
    if (retry && JSON.stringify(retry.decision) !== JSON.stringify(decision)) {
      setDecisionError(uiText("ticket_the_previous_send_is_not_confirmed_confirm_th_1c3020b9")); return false
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
      try { await sendDecision(command) }
      catch (failure) {
        // A known pre-commit conflict can rebase one ordinary answer after a
        // full snapshot confirms the same exact request. Approval and unknown
        // acknowledgements still require explicit confirmation.
        if (retry || decision.kind !== "question" || !isApiError(failure) || failure.status !== 409
          || failure.message !== "revision_conflict") throw failure
        await refreshRef.current()
        if (scope.current !== captured || epoch.current !== capturedEpoch || !current.current
          || !connection.current || !current.current.current.complete
          || !current.current.current.scope.mutation_enabled || current.current.current.scope.health !== "writable"
          || current.current.current.scope.binding.supervisor_session_id !== captured
          || current.current.current.scope.binding.scope_id !== command.binding.scope_id
          || current.current.current.scope.binding.binding_revision !== command.binding.binding_revision
          || current.current.current.snapshot.seq <= command.expected_seq) throw failure
        try { command = responseCommand(current.current, request, decision, crypto.randomUUID()) }
        catch { throw failure }
        saveDecisionReceipt(captured!, command)
        await sendDecision(command)
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
        setDecisionError(uiText("ticket_the_send_outcome_is_not_confirmed_retrying_wi_25b2c47f"));
      } else {
        setUncertain((old) => { const next = { ...old }; delete next[request.id]; return next })
        setDecisionError(failure.message === "revision_conflict"
          ? uiText("ticket_work_has_changed_check_the_current_question_a_d216c46f") : getErrorMessage(failure)); await refreshRef.current()
      }
      return false
    } finally { if (scope.current === captured && epoch.current === capturedEpoch) { activeRequests.current.delete(request.id); setBusy((old) => ({ ...old, [request.id]: false })) } }
  }, [sessionId, ownerAccess, settledEpoch, authorityBlocked, deferRead])

  const initialize = useCallback(async () => {
    const confirmation = availability.initialization
    const capturedEpoch = epoch.current
    const capturedSession = sessionId
    if (!ownerAccess || !capturedSession || authorityBlocked || deferRead || settledEpoch !== capturedEpoch
      || !confirmation || refreshing || initializationFlight.current || initializingSessions.has(capturedSession)) return false
    const flight = {}; initializationFlight.current = flight
    initializingSessions.add(capturedSession); notifyInitialization(); setInitializationError(null)
    const stillCurrent = () => scope.current === capturedSession && access.current && epoch.current === capturedEpoch
    let confirmed = false
    try {
      try {
        await ticketClient.initialize(confirmation)
        if (!stillCurrent()) return false
        confirmed = true
      } catch (failure) {
        if (!stillCurrent()) return false
        if (isApiError(failure) && [401, 403].includes(failure.status)) {
          current.current = null; connection.current = false; setState(null); setConnected(false)
          setAvailability(ticketAvailabilityFailure(failure)); setSettledEpoch(capturedEpoch)
          setError(null); setInitializationError(getErrorMessage(failure)); return false
        }
        const code = initializationRefusal(failure)
        const message = code === "scope_requires_recovery" ? uiText("supervisor_work_recovery_guidance")
          : code === "scope_binding_mismatch" ? uiText("supervisor_work_binding_guidance")
          : code === "ticket_mutation_disabled" ? uiText("supervisor_work_disabled_guidance")
          : code === "supervisor_mode_required" ? uiText("supervisor_work_mode_guidance")
          : code === "supervisor_identity_mismatch" ? uiText("supervisor_work_identity_guidance")
          : code === "scope_io_error" ? uiText("supervisor_work_storage_guidance")
          : code === "initialization_conflict" ? uiText("supervisor_work_initialization_conflict")
          : uiText("supervisor_work_initialization_unconfirmed")
        setInitializationError(message + " " + getErrorMessage(failure))
      }
      // Every non-denial outcome needs a fresh canonical read, including a 409
      // whose owner-only scope is already readable. Never replay the POST.
      if (!stillCurrent()) return false
      await refreshRef.current(true)
      if (!stillCurrent()) return false
      const binding = current.current?.current.scope.binding
      const ready = connection.current && binding?.supervisor_session_id === confirmation.supervisor_session_id
        && binding.scope_id === "supervisor/" + confirmation.incarnation_id && binding.binding_revision === confirmation.binding_revision
      if (confirmed && !ready) setInitializationError(uiText("supervisor_work_initialization_unconfirmed"))
      return confirmed && ready
    } finally {
      if (initializationFlight.current === flight) { initializationFlight.current = null; initializingSessions.delete(capturedSession); notifyInitialization() }
    }
  }, [sessionId, ownerAccess, availability, refreshing, settledEpoch, authorityBlocked, deferRead])

  const visible = settledEpoch === epoch.current
  const readableState = ownerAccess && visible && state?.current.scope.binding.supervisor_session_id === sessionId ? state : null
  return { state: readableState,
    availability: !ownerAccess ? { kind: "forbidden" as const } : visible ? availability : { kind: "loading" as const },
    refreshing, initializing, initializationError: visible ? initializationError : null,
    canInitialize: ownerAccess && visible && !authorityBlocked && !deferRead && !!availability.initialization && !initializing && !refreshing,
    initialize, canRefresh: ownerAccess && !!sessionId && !deferRead && !initializing,
    error: decisionError ?? (initializationError ? initializationError + (error ? " " + error : "") : error), connected: ownerAccess && visible && connected, negotiated: !sessionId || !ownerAccess || visible && negotiatedSession === sessionId,
    busy, uncertain, respond, refresh: () => refreshRef.current(),
    canSendIngress: ownerAccess && visible && !authorityBlocked && !deferRead && connected && state !== null && state.current.scope.binding.supervisor_session_id === sessionId
      && state.current.scope.health === "writable" && state.current.scope.mutation_enabled === true
      && state.current.scope.capabilities?.semantic_messages_v1 === true,
    canRespond: ownerAccess && visible && !authorityBlocked && !deferRead && connected && state !== null && state.current.scope.binding.supervisor_session_id === sessionId
      && state.current.complete && state.current.scope.health === "writable" && state.current.scope.mutation_enabled === true }
}
