import { createEffect, createMemo, createSignal, onSettled, type Accessor } from "solid-js"
import { getBackendStorageScope } from "@services/api"
import { agentClient } from "@services/chat/AgentService"
import { readContinuousRetryFence } from "@/lib/continuousRetryFence"
import {
  beginLiveBootstrapConfirmation, confirmLiveBootstrapOffer, finishLiveBootstrapConfirmation,
  isLiveBootstrapNotPrepared, readLiveBootstrapCapability, readLiveBootstrapConfirmation, readLiveBootstrapOffer,
  type LiveBootstrapCapability, type LiveBootstrapOffer,
} from "@services/chat/liveBootstrapRetry"

type LiveStatus = "waiting" | "confirming" | "continued" | "expired" | "unavailable" | "unconfirmed"
  | "identity_unavailable" | "stopping" | "stop_requested" | "stop_unconfirmed"
export type LiveBootstrapView = { sessionId: string; runId: string; status: LiveStatus; secondsRemaining: number; deadline: number }

interface Options {
  sessionId: Accessor<string | null>
  running: Accessor<boolean>
  root: Accessor<boolean>
}

type Context = { sessionId: string | null; running: boolean; root: boolean; scope: string }
type Action = { context: Context; runId: string }
type Capability = { scope: string; value: LiveBootstrapCapability }

const POLL_MS = 5_000
const NEGOTIATION_MS = 750
const keepWhenOfferWithdrawn: readonly LiveStatus[] = ["continued", "unconfirmed", "stopping", "stop_requested", "stop_unconfirmed"]
const unavailableForStop: readonly LiveStatus[] = ["stopping", "stop_requested", "identity_unavailable", "expired", "unavailable"]

function timeRemaining(deadline: number) {
  return Math.max(0, Math.ceil((deadline - performance.now()) / 1000))
}

function waitingView(
  sessionId: string, scope: string, offer: Extract<LiveBootstrapOffer, { kind: "waiting" }>, deadline: number,
): LiveBootstrapView {
  const { runId } = offer
  const secondsRemaining = timeRemaining(deadline)
  const fence = readContinuousRetryFence(scope, sessionId)
  const record = readLiveBootstrapConfirmation(sessionId, runId)
  const status: LiveStatus = secondsRemaining === 0 ? "expired"
    : record === "pending" ? "unconfirmed" : record === "accepted" ? "continued"
      : record === "unavailable" || fence.kind !== "confirmed" || fence.runId !== runId ? "identity_unavailable"
        : offer.confirming ? "confirming" : "waiting"
  return { sessionId, runId, status, secondsRemaining, deadline }
}

export function createLiveBootstrapRetry(options: Options) {
  const context = createMemo<Context>(() => ({
    sessionId: options.sessionId(), running: options.running(), root: options.root(), scope: getBackendStorageScope(),
  }), {
    equals: (previous, next) => previous.sessionId === next.sessionId && previous.running === next.running
      && previous.root === next.root && previous.scope === next.scope,
  })
  const capabilityScope = createMemo(() => context().root ? context().scope : null)
  const [capability, setCapability] = createSignal<Capability | null>(null)
  const [view, setView] = createSignal<(LiveBootstrapView & { scope: string }) | null>(null)
  let latestView: (LiveBootstrapView & { scope: string }) | null = null
  let pendingCapability: { scope: string; promise: Promise<LiveBootstrapCapability | null> } | null = null
  let confirmation: Action | null = null
  let stopping: Action | null = null
  let stopFence: Action | null = null
  let mounted = true

  const update = (next: LiveBootstrapView | null, scope: string) => {
    latestView = next ? { ...next, scope } : null
    setView(latestView)
  }

  const isCurrent = (origin: Context) => mounted && context() === origin && getBackendStorageScope() === origin.scope
  const ownsRun = (origin: Context, runId: string) => latestView?.scope === origin.scope
    && latestView.sessionId === origin.sessionId && latestView.runId === runId
  const usableCapability = (scope: string) => {
    const current = capability()
    return current?.scope === scope ? current.value : null
  }

  onSettled(() => () => {
    mounted = false
    confirmation = null
    stopping = null
    pendingCapability = null
  })

  createEffect(context, (current) => {
    if (confirmation?.context !== current) confirmation = null
    if (stopping?.context !== current) stopping = null
    if (stopFence?.context !== current) stopFence = null
    if (latestView && (!current.root || latestView.scope !== current.scope || latestView.sessionId !== current.sessionId
      || (!current.running && latestView.status !== "expired"))) update(null, current.scope)
  })

  function requestCapability(scope: string) {
    const request = { scope, promise: readLiveBootstrapCapability() }
    pendingCapability = request
    void request.promise.then((value) => {
      if (pendingCapability !== request) return
      pendingCapability = null
      if (mounted && capabilityScope() === scope && getBackendStorageScope() === scope) {
        setCapability(value ? { scope, value } : null)
      }
    })
    return request
  }

  createEffect(capabilityScope, (scope) => {
    if (scope === null) {
      pendingCapability = null
      setCapability(null)
      return
    }
    const request = requestCapability(scope)
    return () => { if (pendingCapability === request) pendingCapability = null }
  })

  // A late capability reply must not hold an ordinary send indefinitely.
  function prepareInitial(): boolean | Promise<boolean> {
    const origin = context()
    if (!origin.root || !isCurrent(origin)) return false
    if (usableCapability(origin.scope)) return true
    const request = pendingCapability?.scope === origin.scope ? pendingCapability : requestCapability(origin.scope)
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), NEGOTIATION_MS)
      void request.promise.then((value) => {
        clearTimeout(timer)
        resolve(!!value && isCurrent(origin))
      }, () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
  }

  function settleOwnedView(scope: string, selected: LiveBootstrapView, status: LiveStatus, secondsRemaining?: number) {
    const fence = readContinuousRetryFence(scope, selected.sessionId)
    if (fence.kind === "confirmed" && fence.runId !== selected.runId) { update(null, scope); return }
    if (fence.kind !== "confirmed") {
      update({ ...selected, status: "identity_unavailable", secondsRemaining: 0 }, scope)
      return
    }
    update({ ...selected, status, secondsRemaining: secondsRemaining ?? selected.secondsRemaining }, scope)
  }

  createEffect(
    () => {
      const current = context()
      return { current, capability: usableCapability(current.scope) }
    },
    ({ current, capability }) => {
      const { sessionId, running, scope, root } = current
      if (!sessionId || !running || !root || !capability) return
      const selectedId = sessionId
      const { offerTimeoutMs } = capability
      let active = true
      let timer: ReturnType<typeof setTimeout> | undefined
      const owns = () => active && isCurrent(current)
      async function poll() {
        const started = performance.now()
        try {
          const offer = await readLiveBootstrapOffer(selectedId, offerTimeoutMs)
          if (!owns()) return
          const previous = latestView?.scope === scope ? latestView : null
          if (offer.kind === "unavailable") {
            if (previous?.sessionId === sessionId && !keepWhenOfferWithdrawn.includes(previous.status)) {
              update({ ...previous, status: timeRemaining(previous.deadline) === 0 ? "expired" : "unavailable", secondsRemaining: 0 }, scope)
            }
          } else if (!(stopFence?.context === current && stopFence.runId === offer.runId)) {
            if (confirmation?.context === current && confirmation.runId !== offer.runId) confirmation = null
            if (stopping?.context === current && stopping.runId !== offer.runId) stopping = null
            const calculated = started + offer.expiresInMs
            const deadline = previous?.sessionId === sessionId && previous.runId === offer.runId
              ? Math.min(previous.deadline, calculated) : calculated
            if (!(confirmation?.context === current && confirmation.runId === offer.runId)) {
              update(waitingView(selectedId, scope, offer, deadline), scope)
            }
          }
        } catch {
          if (owns() && latestView?.sessionId === sessionId && latestView.status === "waiting") {
            update({ ...latestView, status: "unavailable" }, scope)
          }
        }
        if (owns()) timer = setTimeout(() => void poll(), POLL_MS)
      }
      void poll()
      return () => {
        active = false
        if (timer !== undefined) clearTimeout(timer)
      }
    },
  )

  const countdown = createMemo(() => {
    const current = context()
    const offer = view()
    return offer?.sessionId === current.sessionId && offer.scope === current.scope && offer.status === "waiting"
      ? offer.runId : null
  })
  createEffect(countdown, (runId) => {
    if (!runId) return
    const origin = context()
    const timer = setInterval(() => {
      const current = latestView
      if (!current || !isCurrent(origin) || !ownsRun(origin, runId) || current.status !== "waiting") return
      const secondsRemaining = timeRemaining(current.deadline)
      if (secondsRemaining !== current.secondsRemaining) {
        update({ ...current, secondsRemaining, status: secondsRemaining === 0 ? "expired" : "waiting" }, origin.scope)
      }
    }, 1_000)
    return () => clearInterval(timer)
  })

  async function confirm() {
    const selected = latestView
    const origin = context()
    const { scope } = origin
    if (!selected || selected.status !== "waiting" || !origin.running || !origin.root
      || !isCurrent(origin) || !ownsRun(origin, selected.runId) || !usableCapability(scope)
      || confirmation?.context === origin) return

    const action = { context: origin, runId: selected.runId }
    confirmation = action
    update({ ...selected, status: "confirming" }, scope)
    const owns = () => isCurrent(origin) && confirmation === action && ownsRun(origin, action.runId)
    const settle = (status: LiveStatus, secondsRemaining?: number) => {
      if (owns()) settleOwnedView(scope, selected, status, secondsRemaining)
    }

    try {
      const admission = await readLiveBootstrapCapability()
      if (!owns()) return
      if (!admission) { settle("unavailable"); return }
      const started = performance.now()
      const fresh = await readLiveBootstrapOffer(selected.sessionId, admission.offerTimeoutMs)
      if (!owns()) return
      const fence = readContinuousRetryFence(scope, selected.sessionId)
      if (fresh.kind !== "waiting" || fresh.runId !== selected.runId || fresh.confirming
        || fresh.expiresInMs <= 0 || performance.now() >= Math.min(selected.deadline, started + fresh.expiresInMs)
        || fence.kind !== "confirmed" || fence.runId !== selected.runId) {
        settle(timeRemaining(selected.deadline) === 0 ? "expired" : "unavailable", 0)
        return
      }
      const reservation = beginLiveBootstrapConfirmation(selected.sessionId, selected.runId)
      if (!reservation) { settle("unconfirmed"); return }
      try {
        await confirmLiveBootstrapOffer(selected.sessionId, selected.runId)
        finishLiveBootstrapConfirmation(reservation, "accepted")
        settle("continued")
      } catch (error) {
        const refused = isLiveBootstrapNotPrepared(error, selected.sessionId)
        finishLiveBootstrapConfirmation(reservation, refused ? "refused" : "unknown")
        settle(refused ? "unavailable" : "unconfirmed")
      }
    } catch {
      settle("unavailable")
    } finally {
      if (confirmation === action) confirmation = null
    }
  }

  function cancelForStop() {
    confirmation = null
    stopping = null
    const selected = latestView
    const origin = context()
    if (!selected || !isCurrent(origin) || !ownsRun(origin, selected.runId)) return
    stopFence = { context: origin, runId: selected.runId }
    update({ ...selected, status: "stopping" }, origin.scope)
  }

  async function stop() {
    const selected = latestView
    const origin = context()
    const { scope } = origin
    if (!selected || !origin.running || !origin.root || !isCurrent(origin) || !ownsRun(origin, selected.runId)
      || unavailableForStop.includes(selected.status) || stopping?.context === origin) return
    const fence = readContinuousRetryFence(scope, selected.sessionId)
    if (fence.kind !== "confirmed" || fence.runId !== selected.runId) {
      update({ ...selected, status: "identity_unavailable" }, scope)
      return
    }

    cancelForStop()
    const action = { context: origin, runId: selected.runId }
    stopping = action
    const active = () => isCurrent(origin) && stopping === action && latestView?.sessionId === selected.sessionId
    const owns = () => active() && ownsRun(origin, action.runId)
    const settle = (status: LiveStatus) => { if (owns()) settleOwnedView(scope, selected, status) }

    // Re-observe after a refused or lost exact Stop. A successor can only be
    // adopted when its own run identity is already confirmed in this tab.
    const stopSelection = selected
    async function recover(): Promise<boolean> {
      const admission = await readLiveBootstrapCapability()
      if (!admission || !active()) return false
      const offer = await readLiveBootstrapOffer(stopSelection.sessionId, admission.offerTimeoutMs)
      if (!active() || offer.kind !== "waiting") return false
      const saved = readContinuousRetryFence(scope, stopSelection.sessionId)
      if (saved.kind !== "confirmed" || saved.runId !== offer.runId) return false

      const adopted = { context: origin, runId: offer.runId }
      stopping = adopted
      stopFence = adopted
      let status: LiveStatus = "stop_requested"
      try {
        await agentClient.stopGeneration(stopSelection.sessionId, offer.runId)
      } catch {
        status = "stop_unconfirmed"
      }
      if (isCurrent(origin) && stopping === adopted) {
        settleOwnedView(scope, { ...stopSelection, runId: offer.runId }, status)
        stopping = null
      }
      return true
    }

    try {
      const admission = await readLiveBootstrapCapability()
      if (!owns()) return
      const saved = readContinuousRetryFence(scope, selected.sessionId)
      if (!admission || saved.kind !== "confirmed" || saved.runId !== selected.runId) {
        try { if (await recover()) return } catch { /* Keep the current Stop unconfirmed. */ }
        settle("stop_unconfirmed")
        return
      }
      await agentClient.stopGeneration(selected.sessionId, selected.runId)
      settle("stop_requested")
    } catch {
      try { if (await recover()) return } catch { /* Keep the current Stop unconfirmed. */ }
      settle("stop_unconfirmed")
    } finally {
      if (stopping === action) stopping = null
    }
  }

  async function refresh() {
    const selected = latestView
    const origin = context()
    const { scope } = origin
    if (!selected || !origin.root || !isCurrent(origin) || !ownsRun(origin, selected.runId)) return
    try {
      const admission = await readLiveBootstrapCapability()
      if (!admission || !isCurrent(origin)) return
      const started = performance.now()
      const offer = await readLiveBootstrapOffer(selected.sessionId, admission.offerTimeoutMs)
      if (!isCurrent(origin) || confirmation?.context === origin || stopping?.context === origin) return
      if (offer.kind === "unavailable") { update(null, scope); return }
      if (stopFence?.context === origin && stopFence.runId === offer.runId && latestView?.status !== "stop_unconfirmed") return
      stopFence = null
      update(waitingView(selected.sessionId, scope, offer, started + offer.expiresInMs), scope)
    } catch {
      // A failed observation preserves the last established state.
    }
  }

  return {
    get canPrepare() {
      const current = context()
      return current.root && isCurrent(current) && !!usableCapability(current.scope)
    },
    get offer(): LiveBootstrapView | null {
      const current = context()
      const offer = view()
      return current.root && isCurrent(current) && offer?.scope === current.scope && offer.sessionId === current.sessionId
        && (current.running || offer.status === "expired") ? offer : null
    },
    prepareInitial, confirm, stop, refresh, cancelForStop,
  }
}
