import { Switch, Match, Show } from "solid-js"
import { createUiText } from "../../../shell/uiText"
import { Button } from "../../../ui/button"
import type { LiveBootstrapView } from "./createLiveBootstrapRetry"

const statusText = {
  confirming: "live_retry_confirming",
  continued: "live_retry_continued",
  expired: "live_retry_expired",
  unavailable: "live_retry_unavailable",
  unconfirmed: "live_retry_unconfirmed",
  identity_unavailable: "live_retry_identity_unavailable",
  stopping: "live_retry_stopping",
  stop_requested: "upstream_retry_stop_requested",
  stop_unconfirmed: "upstream_retry_stop_unconfirmed",
} as const satisfies Record<Exclude<LiveBootstrapView["status"], "waiting">, string>

const canStop = new Set<LiveBootstrapView["status"]>(["waiting", "confirming", "continued", "unconfirmed"])
const canRefresh = new Set<LiveBootstrapView["status"]>(["stop_unconfirmed", "identity_unavailable"])

export function LiveBootstrapRetryNotice(props: {
  offer: LiveBootstrapView | null
  disabled: boolean
  stopDisabled?: boolean
  refreshDisabled?: boolean
  onConfirm: () => void
  onStop: () => void
  onRefresh: () => void
}) {
  const text = createUiText()
  const message = (offer: LiveBootstrapView) => offer.status === "waiting"
    ? text("live_retry_waiting", { seconds: offer.secondsRemaining })
    : text(statusText[offer.status])
  return <Show when={props.offer}>{(offer) =>
    <div role="status" aria-live="polite" class="mx-4 mb-2 text-xs text-muted-foreground">
      <p>{message(offer())}</p>
      <Show when={canStop.has(offer().status) || canRefresh.has(offer().status)}>
        <div class="flex flex-wrap items-center gap-2">
          <Show when={offer().status === "waiting"}>
            <Button type="button" size="sm" variant="outline" disabled={props.disabled} onClick={props.onConfirm}>
              {text("upstream_retry_until_stopped")}
            </Button>
          </Show>
          <Switch>
            <Match when={canStop.has(offer().status)}>
              <Button type="button" size="sm" variant="outline" disabled={props.stopDisabled} onClick={props.onStop}>
                {text("stop_generation_9ad0aac3")}
              </Button>
            </Match>
            <Match when={canRefresh.has(offer().status)}>
              <Button type="button" size="sm" variant="outline" disabled={props.refreshDisabled} onClick={props.onRefresh}>
                {text("live_retry_refresh")}
              </Button>
            </Match>
          </Switch>
        </div>
      </Show>
    </div>
  }</Show>
}
