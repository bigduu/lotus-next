import { Clock3 } from "@lucide/solid"
import { For, Show } from "solid-js"
import { guidanceService, type PendingGuidance } from "@services/chat/guidance"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import type { createGuidanceQueue } from "./createGuidanceQueue"

type Queue = ReturnType<typeof createGuidanceQueue>

export function GuidanceTimingControl(props: {
  queue: Queue
  compact?: boolean
  disabled?: boolean
}) {
  const text = createUiText()
  return (
    <div class="relative h-8 shrink-0" style={{ width: props.compact ? "32px" : "96px" }}>
      <Show when={props.compact}>
        <Clock3 aria-hidden="true" class="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground" />
      </Show>
      <select aria-label={text("send_timing_22388dde")} value={props.queue.mode} disabled={props.disabled || props.queue.busy}
        onChange={(event) => {
          const mode = event.currentTarget.value
          if (mode === "after_round" || mode === "after_run") props.queue.setMode(mode)
        }}
        title={props.queue.mode === "after_run" ? text("send_when_the_run_finishes_1525b79a")
          : text("send_after_the_current_tool_call_before_the_next_model__ce3a9c75")}
        class="h-full w-full rounded-md border-0 bg-transparent text-sm text-muted-foreground"
        style={{ appearance: props.compact ? "none" : "auto", color: props.compact ? "transparent" : undefined }}>
        <option class="text-foreground" value="after_round">{text("after_tool_call_252b019e")}</option>
        <option class="text-foreground" value="after_run">{text("after_run_81638e07")}</option>
      </select>
    </div>
  )
}

export function GuidanceQueueControls(props: {
  sessionId: string | null
  queue: Queue
  onPreview?: (url: string) => void
}) {
  const text = createUiText()
  return <>
    <Show when={props.queue.error}>
      <div role="alert" class="mx-auto mb-1 w-[calc(100%-1.5rem)] max-w-full rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive">
        {props.queue.error}
      </div>
    </Show>
    <Show when={props.sessionId} keyed>
      {(sessionId) => (
        <Show when={props.queue.pending.length > 0}>
          <details aria-label={text("message_queue_9dc5a845")} class="group mx-auto mb-2 w-full max-w-6xl rounded-lg border bg-card text-xs">
            <summary aria-label={text("queued_messages_daa57141", { v0: props.queue.pending.length, count: props.queue.pending.length })}
              class="cursor-pointer whitespace-nowrap rounded px-3 py-2 tabular-nums text-muted-foreground hover:bg-accent">
              {text("queued_f9e719c6")} {props.queue.pending.length}
            </summary>
            <div class="max-h-[min(12rem,25dvh)] overflow-y-auto overscroll-contain border-t px-3 py-1">
              <For each={props.queue.pending} keyed={(item: PendingGuidance) => item.id}>
                {(item) => (
                  <div class="flex items-start gap-2 border-b py-2 last:border-0">
                    <div class="min-w-0 flex-1">
                      <div class="mb-1 whitespace-pre-wrap break-words text-muted-foreground">
                        {text(item().mode === "after_run" ? "message_queue_after_run" : "message_queue_interject")}
                      </div>
                      <Show when={item().text}>
                        <div class="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item().text}</div>
                      </Show>
                      <Show when={item().images?.length}>
                        <div class="mt-1 flex flex-wrap gap-1">
                          <For each={item().images}>
                            {(id, index) => {
                              const url = guidanceService.imageUrl(sessionId, id)
                              return (
                                <Show when={props.onPreview} fallback={<img src={url} alt={text("queued_image_009dcc09", { v0: index() + 1 })}
                                  class="size-12 rounded border object-cover" />}>
                                  {(preview) => <button type="button" onClick={() => preview()(url)}
                                    aria-label={text("view_queued_image_81c3b7ba", { v0: index() + 1 })}>
                                    <img src={url} alt={text("queued_image_009dcc09", { v0: index() + 1 })}
                                      class="size-12 rounded border object-cover" />
                                  </button>}
                                </Show>
                              )
                            }}
                          </For>
                        </div>
                      </Show>
                    </div>
                    <Button type="button" class="shrink-0" size="sm" variant="ghost" disabled={props.queue.busy}
                      onClick={() => {
                        if (sessionId === props.sessionId) void props.queue.cancel(item().id)
                      }}>
                      {text("withdraw_6b581989")}
                    </Button>
                  </div>
                )}
              </For>
            </div>
          </details>
        </Show>
      )}
    </Show>
  </>
}
