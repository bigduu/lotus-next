import { createEffect, createMemo, createSignal, onSettled, type Accessor } from "solid-js"
import { onReconnected } from "@services/chat/v2Stream"
import {
  getSessionCompatibilitySnapshot,
  readSessionExecutionDetail,
  subscribeSessionCompatibility,
} from "@services/chat/sessionExecutionCompatibility"
import { OutputRateTracker } from "@/lib/outputRate"
import { renderProbe } from "@/lib/renderProbe"

export function createSessionExecutionCompatibility(sessionId: Accessor<string | null>) {
  const [version, setVersion] = createSignal(0)
  onSettled(() => {
    const update = () => setVersion((value) => value + 1)
    const unsubscribe = subscribeSessionCompatibility(update)
    update()
    return unsubscribe
  })
  const snapshot = createMemo(() => {
    version()
    return getSessionCompatibilitySnapshot(sessionId())
  })
  const refresh = async () => {
    const id = sessionId()
    if (id) await readSessionExecutionDetail(id).catch(() => undefined)
  }
  createEffect(sessionId, (id) => {
    if (!id) return
    const reconcile = () => { void readSessionExecutionDetail(id).catch(() => undefined) }
    reconcile()
    return onReconnected(reconcile)
  })
  return {
    get report() { return snapshot().report },
    get loading() { return snapshot().loading },
    get blocked() { return snapshot().report?.status === "conflict" },
    refresh,
  }
}

export function createOutputRate(sessionId: Accessor<string | null>, active: Accessor<boolean>) {
  const tracker = new OutputRateTracker()
  const [snapshot, setSnapshot] = createSignal<{ sessionId: string; rate: number | null } | null>(null)
  const record = (text: string) => tracker.record(text)
  const reset = () => {
    tracker.reset()
    setSnapshot(null)
  }
  createEffect(
    () => active() ? sessionId() : null,
    (id) => {
      if (!id) return
      const timer = window.setInterval(() => {
        const rate = tracker.rate()
        renderProbe.count("outputRate.tick")
        setSnapshot((previous) => {
          if (previous?.sessionId === id && previous.rate === rate) return previous
          renderProbe.count("outputRate.commit")
          return { sessionId: id, rate }
        })
      }, 500)
      return () => window.clearInterval(timer)
    },
  )
  const rate = createMemo(() => {
    const current = snapshot()
    return active() && current?.sessionId === sessionId() ? current.rate : null
  })
  return { record, reset, rate }
}
