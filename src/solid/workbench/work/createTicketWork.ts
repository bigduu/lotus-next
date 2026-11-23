import { createEffect, createMemo, createSignal, onSettled, type Accessor } from "solid-js"
import { uiText } from "@shared/i18n/text"
import { getErrorMessage, isApiError } from "@services/api"
import {
  initializationDenial, initializationRefusal, ticketAvailabilityFailure,
  TicketScopeUnavailableError, type TicketAvailability,
} from "@services/tickets/availability"
import { ticketClient } from "@services/tickets/client"
import { clearDecisionReceipt, readDecisionReceipts, saveDecisionReceipt } from "@services/tickets/decisionReceipts"
import { applyTicketSnapshot, effectiveStatus, responseCommand, type TicketState } from "@services/tickets/state"
import type { Decision, PendingRequest, ResponseCommand, ScopeBinding } from "@services/tickets/types"

// Panels may share request admission for one Supervisor, never scope data or an initialization offer.
const initializingSessions = new Set<string>()
const initializationListeners = new Set<() => void>()
function notifyInitialization() {
  for (const listener of initializationListeners) listener()
}

async function sendDecision(command: ResponseCommand) {
  const acknowledgement = await ticketClient.respond(command)
  if (!acknowledgement || acknowledgement.operation_id !== command.operation_id
    || !Number.isSafeInteger(acknowledgement.committed_seq) || acknowledgement.committed_seq <= command.expected_seq) {
    throw new Error(uiText("ticket_the_decision_receipt_is_not_confirmed_retry_t_42a54511"))
  }
}

interface TicketWorkOptions {
  sessionId: Accessor<string | null | undefined>
  ownerAccess: Accessor<boolean>
  authorityKey?: Accessor<string>
  authorityBlocked?: Accessor<boolean>
  deferRead?: Accessor<boolean>
}

const LOADING: TicketAvailability = { kind: "loading" }
const FORBIDDEN: TicketAvailability = { kind: "forbidden" }
const UNBOUND: TicketAvailability = { kind: "unbound" }
const EMPTY = {}

const draftKey = (binding: ScopeBinding, request: PendingRequest) =>
  JSON.stringify([binding.scope_id, binding.binding_revision, request.id, request.generation, request.prompt_revision])

export function createTicketWork(options: TicketWorkOptions) {
  const identity = createMemo(() => ({
    sessionId: options.sessionId() ?? null,
    ownerAccess: options.ownerAccess(),
    authorityKey: options.authorityKey?.() ?? "",
    blocked: options.authorityBlocked?.() ?? false,
    deferRead: options.deferRead?.() ?? false,
  }), { equals: (a, b) => a.sessionId === b.sessionId && a.ownerAccess === b.ownerAccess
    && a.authorityKey === b.authorityKey && a.blocked === b.blocked && a.deferRead === b.deferRead })

  type ReadIdentity = ReturnType<typeof identity>
  const [availability, setAvailability] = createSignal<TicketAvailability>(LOADING)
  const [refreshing, setRefreshing] = createSignal(false)
  const [initVersion, setInitVersion] = createSignal(0)
  const [initializationError, setInitializationError] = createSignal<string | null>(null)
  const [settled, setSettled] = createSignal<ReadIdentity | null>(null)
  const [state, setState] = createSignal<TicketState | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [decisionError, setDecisionError] = createSignal<string | null>(null)
  const [connected, setConnected] = createSignal(false)
  const [negotiatedSession, setNegotiatedSession] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal<Record<string, boolean>>({})
  const [uncertain, setUncertain] = createSignal<Record<string, ResponseCommand>>({})
  const [answerDrafts, setAnswerDrafts] = createSignal<ReadonlyMap<string, string>>(new Map())
  const activeRequests = new Set<string>()
  let read: { identity: ReadIdentity; refresh: (full?: boolean, afterInitialization?: boolean) => Promise<TicketState | null | undefined> } | undefined

  const initializing = createMemo(() => {
    initVersion()
    const { sessionId } = identity()
    return !!sessionId && initializingSessions.has(sessionId)
  })
  onSettled(() => {
    const update = () => setInitVersion((version) => version + 1)
    initializationListeners.add(update)
    update()
    return () => { initializationListeners.delete(update) }
  })

  const visible = () => settled() === identity()
  const readableState = createMemo(() => {
    const { ownerAccess, sessionId } = identity()
    const result = state()
    return ownerAccess && visible() && result?.current.scope.binding.supervisor_session_id === sessionId ? result : null
  })
  const mutableState = () => {
    const context = identity()
    const result = readableState()
    return result && !context.blocked && !context.deferRead && connected()
      && result.current.scope.mutation_enabled === true && result.current.scope.health === "writable" ? result : null
  }
  const refreshCurrent = async (afterInitialization = false) => {
    if (read?.identity === identity()) return read.refresh(true, afterInitialization)
  }

  createEffect(identity, (context) => {
    const { sessionId, ownerAccess, deferRead } = context
    setState(null)
    setConnected(false)
    setNegotiatedSession(null)
    setError(null)
    setBusy({})
    setUncertain({})
    setAnswerDrafts(new Map())
    setInitializationError(null)
    setSettled(null)
    setDecisionError(null)
    setAvailability(LOADING)
    setRefreshing(false)
    activeRequests.clear()
    read = undefined

    if (!sessionId || !ownerAccess) {
      setSettled(context)
      setNegotiatedSession(sessionId)
      setAvailability(!ownerAccess ? FORBIDDEN : UNBOUND)
      return
    }
    if (deferRead) return
    try { setUncertain(readDecisionReceipts(sessionId)) }
    catch (failure) { setDecisionError(getErrorMessage(failure)) }

    const controller = new AbortController()
    const stillCurrent = () => !controller.signal.aborted && identity() === context
    let timer: ReturnType<typeof setTimeout> | undefined
    let reading = false

    const accept = (next: TicketState | null) => {
      setState(next)
      setConnected(true)
      setNegotiatedSession(sessionId)
      setError(null)
      setAvailability(next ? { kind: "ready" } : UNBOUND)
      setSettled(context)
      setAnswerDrafts((previous) => {
        if (!previous.size) return previous
        if (!next) return new Map()
        if (!next.current.complete) return previous
        const binding = next.current.scope.binding
        const valid = new Set(Object.values(next.requests)
          .filter((request) => request.kind.kind === "question" && effectiveStatus(next, request) === "open")
          .map((request) => draftKey(binding, request)))
        const retained = new Map([...previous].filter(([key]) => valid.has(key)))
        return retained.size === previous.size ? previous : retained
      })
      return next
    }
    const refresh = async (full = true, afterInitialization = false) => {
      if (reading || !stillCurrent() || (initializingSessions.has(sessionId) && !afterInitialization)) return
      reading = true
      setRefreshing(true)
      try {
        const cached = state()
        if (!full && cached) {
          try {
            const previous = cached.current
            const changes = await ticketClient.changes(previous.snapshot.seq, controller.signal)
            if (!stillCurrent()) return
            if (changes.snapshot.seq === previous.snapshot.seq
              && changes.snapshot.authority_epoch === previous.snapshot.authority_epoch) {
              const negotiated = await ticketClient.scope(sessionId, controller.signal)
              if (!stillCurrent()) return
              if (!negotiated) return accept(null)
              if (negotiated.binding.scope_id === previous.scope.binding.scope_id
                && negotiated.binding.binding_revision === previous.scope.binding.binding_revision
                && negotiated.overview.snapshot.commit === previous.snapshot.commit
                && negotiated.overview.snapshot.seq === previous.snapshot.seq
                && negotiated.overview.snapshot.authority_epoch === previous.snapshot.authority_epoch) {
                return accept({ ...cached, current: { ...previous, scope: negotiated } })
              }
            }
          } catch (failure) {
            if (!isApiError(failure) || ![409, 410].includes(failure.status)) throw failure
          }
        }
        if (!stillCurrent()) return
        const result = await ticketClient.load(sessionId, controller.signal)
        if (!stillCurrent()) return
        const next = result ? applyTicketSnapshot(state(), result) : null
        setUncertain(readDecisionReceipts(sessionId))
        return accept(next)
      } catch (failure) {
        if (!stillCurrent()) return
        const next = ticketAvailabilityFailure(failure)
        setSettled(context)
        setConnected(false)
        setAvailability(next)
        setError(getErrorMessage(failure))
        if (failure instanceof TicketScopeUnavailableError || next.kind === "forbidden") setState(null)
        if (failure instanceof TicketScopeUnavailableError) setNegotiatedSession(sessionId)
      } finally {
        reading = false
        if (stillCurrent()) setRefreshing(false)
      }
    }

    read = { identity: context, refresh }
    const poll = async () => {
      if (!document.hidden) await refresh(false)
      if (stillCurrent()) timer = setTimeout(() => void poll(), 2500)
    }
    const reconnect = () => { void refresh() }
    window.addEventListener("online", reconnect)
    window.addEventListener("focus", reconnect)
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
      if (read?.identity === context) read = undefined
      window.removeEventListener("online", reconnect)
      window.removeEventListener("focus", reconnect)
    }
  })

  function removeUncertain(requestId: string) {
    setUncertain((previous) => {
      const next = { ...previous }
      delete next[requestId]
      return next
    })
  }

  let mounted = true
  onSettled(() => () => { mounted = false })
  async function respond(request: PendingRequest, decision: Decision) {
    const context = identity()
    const { sessionId } = context
    const initial = mutableState()
    if (!mounted || !sessionId || !initial?.current.complete || activeRequests.has(request.id)) return false
    const stillCurrent = () => mounted && identity() === context

    let retry: ResponseCommand | undefined
    try { retry = readDecisionReceipts(sessionId)[request.id] }
    catch (failure) { setDecisionError(getErrorMessage(failure)); return false }
    if (retry && JSON.stringify(retry.decision) !== JSON.stringify(decision)) {
      setDecisionError(uiText("ticket_the_previous_send_is_not_confirmed_confirm_th_1c3020b9"))
      return false
    }
    let command: ResponseCommand
    try {
      command = retry ?? responseCommand(initial, request, decision, crypto.randomUUID())
      saveDecisionReceipt(sessionId, command)
    } catch (failure) {
      setDecisionError(getErrorMessage(failure))
      return false
    }

    activeRequests.add(request.id)
    setDecisionError(null)
    setBusy((old) => ({ ...old, [request.id]: true }))
    try {
      try { await sendDecision(command) }
      catch (failure) {
        // Rebase an ordinary answer only after a known pre-commit conflict and
        // successful canonical read of the same exact request.
        if (!stillCurrent() || retry || decision.kind !== "question" || !isApiError(failure) || failure.status !== 409
          || failure.message !== "revision_conflict") throw failure
        await refreshCurrent()
        if (!stillCurrent()) throw failure
        const latest = mutableState()
        if (!latest?.current.complete
          || latest.current.scope.binding.scope_id !== command.binding.scope_id
          || latest.current.scope.binding.binding_revision !== command.binding.binding_revision
          || latest.current.snapshot.seq <= command.expected_seq) throw failure
        try { command = responseCommand(latest, request, decision, crypto.randomUUID()) }
        catch { throw failure }
        saveDecisionReceipt(sessionId, command)
        await sendDecision(command)
      }
      clearDecisionReceipt(sessionId, command)
      if (!stillCurrent()) return false
      removeUncertain(request.id)
      await refreshCurrent()
      return stillCurrent()
    } catch (failure) {
      const unknown = !!retry || !isApiError(failure) || failure.status >= 500
      if (!unknown) clearDecisionReceipt(sessionId, command)
      if (!stillCurrent()) return false
      if (unknown) {
        setUncertain((old) => ({ ...old, [request.id]: command }))
        setDecisionError(uiText("ticket_the_send_outcome_is_not_confirmed_retrying_wi_25b2c47f"))
      } else {
        removeUncertain(request.id)
        setDecisionError(failure.message === "revision_conflict"
          ? uiText("ticket_work_has_changed_check_the_current_question_a_d216c46f") : getErrorMessage(failure))
        await refreshCurrent()
      }
      return false
    } finally {
      if (stillCurrent()) {
        activeRequests.delete(request.id)
        setBusy((old) => ({ ...old, [request.id]: false }))
      }
    }
  }

  const canInitialize = () => {
    const { ownerAccess, blocked, deferRead } = identity()
    return mounted && ownerAccess && visible() && !blocked && !deferRead
      && !!availability().initialization && !initializing() && !refreshing()
  }
  async function initialize() {
    const context = identity()
    const sessionId = context.sessionId
    const confirmation = availability().initialization
    if (!sessionId || !confirmation || !canInitialize() || initializingSessions.has(sessionId)) return false
    initializingSessions.add(sessionId)
    notifyInitialization()
    setInitializationError(null)

    const stillCurrent = () => mounted && identity() === context
    let confirmed = false
    let conflictDetail: string | undefined
    try {
      try {
        await ticketClient.initialize(confirmation)
        if (!stillCurrent()) return false
        confirmed = true
      } catch (failure) {
        if (!stillCurrent()) return false
        if (isApiError(failure) && [401, 403].includes(failure.status)) {
          setState(null)
          setConnected(false)
          const denial = initializationDenial(failure, sessionId)
          setAvailability(denial ?? ticketAvailabilityFailure(failure))
          setSettled(context)
          setError(null)
          setInitializationError(denial?.detail ?? getErrorMessage(failure))
          return false
        }
        const code = initializationRefusal(failure)
        if (isApiError(failure) && failure.status === 409 && code) conflictDetail = getErrorMessage(failure)
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
      // Even a refused write can expose a canonical scope. Never replay the POST.
      if (!stillCurrent()) return false
      const canonical = await refreshCurrent(true)
      if (!stillCurrent()) return false
      const binding = canonical?.current.scope.binding
      const ready = binding?.supervisor_session_id === confirmation.supervisor_session_id
        && binding.scope_id === "supervisor/" + confirmation.incarnation_id && binding.binding_revision === confirmation.binding_revision
      if (conflictDetail && canonical) {
        setInitializationError(uiText("supervisor_work_initialization_conflict") + " " + conflictDetail)
      }
      if (confirmed && !ready) setInitializationError(uiText("supervisor_work_initialization_unconfirmed"))
      return confirmed && ready
    } finally {
      initializingSessions.delete(sessionId)
      notifyInitialization()
    }
  }

  const currentDraftKey = (request: PendingRequest) => {
    const current = readableState()
    const actual = current?.requests[request.id]
    if (!current || !actual || actual.kind.kind !== "question" || effectiveStatus(current, actual) !== "open"
      || actual.work_id !== request.work_id || actual.generation !== request.generation
      || actual.prompt_revision !== request.prompt_revision) return null
    return draftKey(current.current.scope.binding, actual)
  }

  return {
    get state() { return readableState() },
    get availability() { return !identity().ownerAccess ? FORBIDDEN : visible() ? availability() : LOADING },
    get refreshing() { return refreshing() },
    get initializing() { return initializing() },
    get initializationError() { return visible() ? initializationError() : null },
    get canInitialize() { return canInitialize() },
    get canRefresh() {
      const { ownerAccess, sessionId, deferRead } = identity()
      return ownerAccess && !!sessionId && !deferRead && !initializing()
    },
    get error() {
      if (!visible()) return null
      return decisionError() ?? (initializationError() ? initializationError() + (error() ? " " + error() : "") : error())
    },
    get connected() { return identity().ownerAccess && visible() && connected() },
    get negotiated() {
      const { sessionId, ownerAccess } = identity()
      return !sessionId || !ownerAccess || (visible() && negotiatedSession() === sessionId)
    },
    get busy(): Record<string, boolean> { return visible() ? busy() : EMPTY },
    get uncertain(): Record<string, ResponseCommand> { return visible() ? uncertain() : EMPTY },
    get canSendIngress() { return mutableState()?.current.scope.capabilities?.semantic_messages_v1 === true },
    get canRespond() { return mutableState()?.current.complete === true },
    answerDraft(request: PendingRequest) {
      const key = currentDraftKey(request)
      return key ? answerDrafts().get(key) ?? "" : ""
    },
    setAnswerDraft(request: PendingRequest, answer: string) {
      const key = currentDraftKey(request)
      if (!key) return
      setAnswerDrafts((previous) => {
        const next = new Map(previous)
        if (answer) next.set(key, answer)
        else next.delete(key)
        return next
      })
    },
    initialize,
    respond,
    refresh: async () => { await refreshCurrent() },
  }
}

export type TicketWorkController = ReturnType<typeof createTicketWork>
