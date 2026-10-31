import { Button } from "@/components/ui/button"
import type { LiveBootstrapView } from "@/hooks/useLiveBootstrapRetry"
import { uiText, useUiLocale } from "@shared/i18n/ui"

/** Presents only a backend-observed offer for the currently owned run. */
export function LiveBootstrapRetryNotice({ offer, disabled, stopDisabled = false, refreshDisabled = false, onConfirm, onStop, onRefresh }: {
  offer: LiveBootstrapView | null; disabled: boolean; stopDisabled?: boolean; refreshDisabled?: boolean
  onConfirm: () => void; onStop: () => void; onRefresh: () => void
}) {
  useUiLocale()
  if (!offer) return null
  const message = offer.status === "waiting" ? uiText("live_retry_waiting", { seconds: offer.secondsRemaining })
    : offer.status === "confirming" ? uiText("live_retry_confirming")
      : offer.status === "continued" ? uiText("live_retry_continued")
        : offer.status === "expired" ? uiText("live_retry_expired")
          : offer.status === "unavailable" ? uiText("live_retry_unavailable")
            : offer.status === "unconfirmed" ? uiText("live_retry_unconfirmed")
              : offer.status === "identity_unavailable" ? uiText("live_retry_identity_unavailable")
                : offer.status === "stopping" ? uiText("live_retry_stopping")
                  : offer.status === "stop_requested" ? uiText("upstream_retry_stop_requested")
                    : uiText("upstream_retry_stop_unconfirmed")
  const canStop = ["waiting", "confirming", "continued", "unconfirmed"].includes(offer.status)
  // The exact-run Stop refused the remembered identity; only re-observing the
  // backend can resolve these terminal diagnostics, so offer an explicit Refresh.
  const canRefresh = ["stop_unconfirmed", "identity_unavailable"].includes(offer.status)
  return <div role="status" aria-live="polite" className="mx-4 mb-2 text-xs text-muted-foreground">
    <p>{message}</p>
    {offer.status === "waiting" || canStop || canRefresh ? <div className="flex flex-wrap items-center gap-2">
      {offer.status === "waiting" ? <Button size="sm" variant="outline" disabled={disabled} onClick={onConfirm}>
        {uiText("upstream_retry_until_stopped")}</Button> : null}
      {canStop ? <Button size="sm" variant="outline" disabled={stopDisabled} onClick={onStop}>
        {uiText("stop_generation_9ad0aac3")}</Button> : null}
      {canRefresh ? <Button size="sm" variant="outline" disabled={refreshDisabled} onClick={onRefresh}>
        {uiText("live_retry_refresh")}</Button> : null}
    </div> : null}
  </div>
}
