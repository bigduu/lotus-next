import { useCallback, useEffect, useRef, useState } from "react"
import { OutputRateTracker } from "@/lib/outputRate"

export function useOutputRate(sessionId: string | null | undefined, active: boolean) {
  const tracker = useRef(new OutputRateTracker())
  const [snapshot, setSnapshot] = useState<{ sessionId: string; rate: number | null } | null>(null)
  const record = useCallback((text: string) => tracker.current.record(text), [])
  const reset = useCallback(() => { tracker.current.reset(); setSnapshot(null) }, [])
  useEffect(() => {
    if (!active || !sessionId) return
    const timer = window.setInterval(() => {
      const rate = tracker.current.rate()
      setSnapshot((previous) => previous?.sessionId === sessionId && previous.rate === rate
        ? previous : { sessionId, rate })
    }, 500)
    return () => window.clearInterval(timer)
  }, [active, sessionId])
  return { record, reset, rate: active && snapshot && snapshot.sessionId === sessionId ? snapshot.rate : null }
}
