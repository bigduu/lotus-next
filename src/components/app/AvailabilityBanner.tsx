import { useEffect, useState } from "react"
import { WifiOff } from "lucide-react"
import { useAppStore } from "@shared/store/appStore"

/**
 * Grace period before surfacing a disconnect. The v2 WS reconnect loop often
 * recovers within a couple of backoff steps — a quick blip should never flash
 * the banner.
 */
const SHOW_DELAY_MS = 3_000

/**
 * Slim fixed banner shown while the backend is unreachable.
 *
 * lotus-next is WSS-only (no SSE fallback), so a dropped `/v2/stream` socket
 * silently freezes every live update. `agentAvailability` is already driven by
 * the account feed's WS callbacks (`onOpen`/`onError` in accountFeed.ts) plus
 * the low-frequency HTTP health-check fallback — this component simply renders
 * that existing store signal. It appears only after {@link SHOW_DELAY_MS} of
 * sustained unavailability and dismisses itself the moment the connection is
 * back (`onOpen`/`onChange` flip the flag to true).
 */
export function AvailabilityBanner() {
  const available = useAppStore((s) => s.agentAvailability)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // `null` = not yet determined (startup) — only a confirmed `false` counts.
    if (available === false) {
      const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS)
      return () => window.clearTimeout(timer)
    }
    setVisible(false)
    return undefined
  }, [available])

  if (!visible) return null

  return (
    // Above dialogs (z-[130]): a dead connection matters everywhere. The
    // safe-area padding keeps the text clear of the notch in standalone mode
    // while the bar itself extends to the very top edge.
    <div role="status" aria-live="polite" className="fixed inset-x-0 top-0 z-[140]">
      <div className="flex items-center justify-center gap-2 bg-destructive px-3 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-xs font-medium text-white">
        <WifiOff className="size-3.5 shrink-0" />
        <span>连接已断开,正在重连…</span>
      </div>
    </div>
  )
}
