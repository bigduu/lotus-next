import { Show } from "solid-js"
import { CircleAlert, RefreshCw } from "@lucide/solid"

import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover"
import type { ActorSnapshotGapReason } from "./createActorSnapshot"

export function ActorSnapshotNotice(props: {
  reason: ActorSnapshotGapReason | null
  actorId: string | null
  error: string | null
  onRetry?: () => void
}) {
  const text = createUiText()
  const gapMessage = () => {
    if (!props.reason) return null
    if (props.reason === "snapshot_regression") return text("an_older_agent_structure_was_returned_the_last_confirme_15ec0d29")
    return props.actorId ? text("actor_event_gap_origin", { actorId: props.actorId })
      : text("there_is_a_gap_in_agent_events_state_was_reloaded_but_e_0c545fcb")
  }
  const label = () => text("agent_structure_cannot_be_confirmed_right_now_reload_st_2ba610a7")

  return (
    <div class="size-8 shrink-0" data-actor-gap={props.reason ?? undefined} data-actor-gap-origin={props.actorId ?? undefined}>
      <span role="status" class="sr-only">{[gapMessage(), props.error].filter(Boolean).join(" ")}</span>
      <Show when={props.reason || props.error}>
        <Popover placement="bottom-end">
          <PopoverTrigger as={Button} size="icon" variant="ghost" class="size-8 text-muted-foreground" aria-label={label()}>
            <CircleAlert aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent aria-label={label()} data-actor-notice-details="" clipToViewport
            class="max-w-[calc(100vw-2rem)] space-y-2 p-3 text-xs [overflow-wrap:anywhere]">
            <Show when={gapMessage()}>{(message) => <p>{message()}</p>}</Show>
            <Show when={props.error}>{(message) => <p>{message()}</p>}</Show>
            <Show when={props.error && props.onRetry}>
              <Button size="sm" variant="outline" onClick={() => props.onRetry?.()}>
                <RefreshCw />{text("retry_b8784c8d")}
              </Button>
            </Show>
          </PopoverContent>
        </Popover>
      </Show>
    </div>
  )
}
