import { useEffect, useState } from "react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { Button } from "@/components/ui/button"
import { supportsContinuousUpstreamRetry } from "@services/chat/upstreamRetry"

/** Mount for one failed run only. No polling, execution, or message writes here. */
export function RetryUpstreamAction({ disabled, onRetry }: { disabled: boolean; onRetry: () => void }) {
  useUiLocale()
  const [supported, setSupported] = useState(false)
  useEffect(() => {
    let current = true
    void supportsContinuousUpstreamRetry().then((value) => { if (current) setSupported(value) }, () => {})
    return () => { current = false }
  }, [])
  return supported ? <Button size="sm" variant="outline" disabled={disabled} onClick={onRetry}>
    {uiText("upstream_retry_until_stopped")}
  </Button> : null
}
