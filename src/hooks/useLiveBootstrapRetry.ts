import { useCallback, useEffect, useRef, useState } from "react"
import { getBackendStorageScope } from "@services/api"
import { agentClient } from "@services/chat/AgentService"
import { readContinuousRetryFence } from "@/lib/continuousRetryFence"
import {
  beginLiveBootstrapConfirmation, confirmLiveBootstrapOffer, finishLiveBootstrapConfirmation,
  isLiveBootstrapNotPrepared, readLiveBootstrapCapability, readLiveBootstrapConfirmation, readLiveBootstrapOffer,
  type LiveBootstrapCapability,
} from "@services/chat/liveBootstrapRetry"

type LiveStatus = "waiting" | "confirming" | "continued" | "expired" | "unavailable" | "unconfirmed"
  | "identity_unavailable" | "stopping" | "stop_requested" | "stop_unconfirmed"
export type LiveBootstrapView = { sessionId: string; runId: string; status: LiveStatus; secondsRemaining: number; deadline: number }
const pollMs = 5000

/** Observe one live offer; never create or infer a run from an error history. */
export function useLiveBootstrapRetry(sessionId: string | null, running: boolean, root: boolean) {
  const [capability, setCapability] = useState<{ scope: string; value: LiveBootstrapCapability } | null>(null)
  const [view, setView] = useState<LiveBootstrapView | null>(null)
  const viewRef = useRef<LiveBootstrapView | null>(null)
  const pendingCapabilityRef = useRef<{ scope: string; promise: Promise<LiveBootstrapCapability | null> } | null>(null)
  const actionRef = useRef<{ epoch: number; runId: string } | null>(null)
  const stopRef = useRef<string | null>(null)
  const mountedRef = useRef(false)
  const contextRef = useRef({ sessionId, running, root, epoch: 0 })
  if (contextRef.current.sessionId !== sessionId || contextRef.current.running !== running || contextRef.current.root !== root) {
    contextRef.current = { sessionId, running, root, epoch: contextRef.current.epoch + 1 }
    actionRef.current = null
    stopRef.current = null
  }
  const update = useCallback((next: LiveBootstrapView | null) => { viewRef.current = next; setView(next) }, [])
  const scope = getBackendStorageScope()
  const canPrepare = root && capability?.scope === scope

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; actionRef.current = null }
  }, [])

  useEffect(() => {
    const current = viewRef.current
    if (current && (!root || current.sessionId !== sessionId || (!running && current.status !== "expired"))) update(null)
  }, [sessionId, running, root, update])

  useEffect(() => {
    if (!root) { setCapability(null); return }
    let active = true
    const initialScope = getBackendStorageScope()
    const pending = { scope: initialScope, promise: readLiveBootstrapCapability() }
    pendingCapabilityRef.current = pending
    void pending.promise.then((value) => {
      if (pendingCapabilityRef.current === pending) pendingCapabilityRef.current = null
      if (active && initialScope === getBackendStorageScope()) setCapability(value ? { scope: initialScope, value } : null)
    })
    return () => { active = false; if (pendingCapabilityRef.current === pending) pendingCapabilityRef.current = null }
  }, [root])

  // Allow a short in-flight negotiation on the first send, without holding normal chat indefinitely.
  const prepareInitial = useCallback((): boolean | Promise<boolean> => {
    const current = contextRef.current
    const initialScope = getBackendStorageScope()
    if (!mountedRef.current || !root || !current.root) return false
    if (capability?.scope === initialScope) return true
    const pending = pendingCapabilityRef.current
    if (!pending || pending.scope !== initialScope) return false
    return new Promise((resolve) => {
      let settled = false
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      const timer = setTimeout(() => finish(false), 750)
      void pending.promise.then((value) => finish(!!value && mountedRef.current
        && contextRef.current.epoch === current.epoch && contextRef.current.root
        && initialScope === getBackendStorageScope()), () => finish(false))
    })
  }, [capability, root])

  useEffect(() => {
    if (!sessionId || !running || !root || !capability || capability.scope !== getBackendStorageScope()) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const epoch = contextRef.current.epoch
    const poll = async () => {
      const started = performance.now()
      try {
        const observation = await readLiveBootstrapOffer(sessionId, capability.value.offerTimeoutMs)
        if (!active || contextRef.current.epoch !== epoch || capability.scope !== getBackendStorageScope()) return
        const previous = viewRef.current
        if (observation.kind === "unavailable") {
          if (previous?.sessionId === sessionId && !["continued", "unconfirmed", "stopping", "stop_requested", "stop_unconfirmed"].includes(previous.status))
            update({ ...previous, status: performance.now() >= previous.deadline ? "expired" : "unavailable", secondsRemaining: 0 })
        } else if (stopRef.current !== JSON.stringify([sessionId, observation.runId])) {
          const calculated = started + observation.expiresInMs
          const deadline = previous?.sessionId === sessionId && previous.runId === observation.runId
            ? Math.min(previous.deadline, calculated) : calculated
          const secondsRemaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000))
          const fence = readContinuousRetryFence(capability.scope, sessionId)
          const record = readLiveBootstrapConfirmation(sessionId, observation.runId)
          const status: LiveStatus = secondsRemaining === 0 ? "expired"
            : record === "pending" ? "unconfirmed" : record === "accepted" ? "continued"
              : record === "unavailable" || fence.kind !== "confirmed" || fence.runId !== observation.runId ? "identity_unavailable"
                : observation.confirming ? "confirming" : "waiting"
          if (!(actionRef.current?.epoch === epoch && actionRef.current.runId === observation.runId))
            update({ sessionId, runId: observation.runId, status, secondsRemaining, deadline })
        }
      } catch {
        if (active && contextRef.current.epoch === epoch && viewRef.current?.sessionId === sessionId
            && viewRef.current.status === "waiting") update({ ...viewRef.current, status: "unavailable" })
      }
      if (active && contextRef.current.epoch === epoch) timer = setTimeout(poll, pollMs)
    }
    void poll()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [capability, root, running, sessionId, update])

  const viewSessionId = view?.sessionId, viewRunId = view?.runId, viewStatus = view?.status
  useEffect(() => {
    if (viewStatus !== "waiting" || viewSessionId !== sessionId) return
    const timer = setInterval(() => {
      const current = viewRef.current
      if (!current || current.sessionId !== sessionId || current.runId !== viewRunId || current.status !== "waiting") return
      const secondsRemaining = Math.max(0, Math.ceil((current.deadline - performance.now()) / 1000))
      if (secondsRemaining !== current.secondsRemaining)
        update({ ...current, secondsRemaining, status: secondsRemaining === 0 ? "expired" : "waiting" })
    }, 1000)
    return () => clearInterval(timer)
  }, [viewSessionId, viewRunId, viewStatus, sessionId, update])

  const confirm = useCallback(async () => {
    const selected = viewRef.current, current = contextRef.current
    if (!selected || selected.status !== "waiting" || selected.sessionId !== current.sessionId || !current.running || !current.root
        || !capability || capability.scope !== getBackendStorageScope() || actionRef.current) return
    const action = { epoch: current.epoch, runId: selected.runId }
    actionRef.current = action
    update({ ...selected, status: "confirming" })
    const owns = () => mountedRef.current && contextRef.current.epoch === action.epoch && actionRef.current === action
      && capability.scope === getBackendStorageScope()
    try {
      const currentCapability = await readLiveBootstrapCapability()
      if (!owns()) return
      if (!currentCapability) { update({ ...selected, status: "unavailable" }); return }
      const started = performance.now()
      const fresh = await readLiveBootstrapOffer(selected.sessionId, currentCapability.offerTimeoutMs)
      if (!owns()) return
      const fence = readContinuousRetryFence(capability.scope, selected.sessionId)
      if (fresh.kind !== "waiting" || fresh.runId !== selected.runId || fresh.confirming
          || fresh.expiresInMs <= 0 || performance.now() >= Math.min(selected.deadline, started + fresh.expiresInMs)
          || fence.kind !== "confirmed" || fence.runId !== selected.runId) {
        update({ ...selected, status: performance.now() >= selected.deadline ? "expired" : "unavailable", secondsRemaining: 0 })
        return
      }
      const reservation = beginLiveBootstrapConfirmation(selected.sessionId, selected.runId)
      if (!reservation) { update({ ...selected, status: "unconfirmed" }); return }
      try {
        await confirmLiveBootstrapOffer(selected.sessionId, selected.runId)
        finishLiveBootstrapConfirmation(reservation, "accepted")
        if (owns()) update({ ...selected, status: "continued" })
      } catch (error) {
        const refused = isLiveBootstrapNotPrepared(error, selected.sessionId)
        finishLiveBootstrapConfirmation(reservation, refused ? "refused" : "unknown")
        if (owns()) update({ ...selected, status: refused ? "unavailable" : "unconfirmed" })
      }
    } catch { if (owns()) update({ ...selected, status: "unavailable" }) }
    finally { if (actionRef.current === action) actionRef.current = null }
  }, [capability, update])

  const cancelForStop = useCallback(() => {
    actionRef.current = null
    const selected = viewRef.current
    if (!selected || selected.sessionId !== contextRef.current.sessionId) return
    stopRef.current = JSON.stringify([selected.sessionId, selected.runId])
    update({ ...selected, status: "stopping" })
  }, [update])

  const stop = useCallback(async () => {
    const selected = viewRef.current, current = contextRef.current
    if (!selected || selected.sessionId !== current.sessionId || !current.running || !current.root
        || ["stopping", "stop_requested", "stop_unconfirmed", "identity_unavailable", "expired", "unavailable"].includes(selected.status)) return
    const fence = readContinuousRetryFence(getBackendStorageScope(), selected.sessionId)
    if (fence.kind !== "confirmed" || fence.runId !== selected.runId) {
      update({ ...selected, status: "identity_unavailable" }); return
    }
    const scope = getBackendStorageScope()
    cancelForStop()
    try {
      const currentCapability = await readLiveBootstrapCapability()
      if (!mountedRef.current || contextRef.current.epoch !== current.epoch || scope !== getBackendStorageScope()) return
      const currentFence = readContinuousRetryFence(scope, selected.sessionId)
      if (!currentCapability || currentFence.kind !== "confirmed" || currentFence.runId !== selected.runId) {
        update({ ...selected, status: "stop_unconfirmed" }); return
      }
      await agentClient.stopGeneration(selected.sessionId, selected.runId)
      if (mountedRef.current && contextRef.current.epoch === current.epoch) update({ ...selected, status: "stop_requested" })
    } catch {
      if (mountedRef.current && contextRef.current.epoch === current.epoch) update({ ...selected, status: "stop_unconfirmed" })
    }
  }, [cancelForStop, update])

  return { canPrepare: !!canPrepare, prepareInitial, offer: root && view?.sessionId === sessionId ? view : null, confirm, stop, cancelForStop }
}
