import { createEffect, createSignal, For, Show } from "solid-js"
import { agentClient, type ScheduleRunRecord } from "@services/chat/AgentService"
import { errorMessage, formatTime } from "@/components/chat/settings/schedules/scheduleModel"
import { createUiLocale, createUiText } from "../../shell/uiText"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"

const statuses = {
  queued: { label: "queued_d6f766f2", variant: "warning" },
  running: { label: "running_1f0eb99b", variant: "default" },
  success: { label: "successful_053461ce", variant: "success" },
  failed: { label: "failed_28384d7a", variant: "destructive" },
  skipped: { label: "skipped_71e95b28", variant: "secondary" },
  missed: { label: "missed_67330e9d", variant: "secondary" },
  cancelled: { label: "cancelled_a37778f1", variant: "destructive" },
} as const satisfies Record<ScheduleRunRecord["status"], { label: string; variant: string }>

function formatDuration(ms: number | null | undefined) {
  if (ms == null) return null
  return ms < 1000 ? ms + "ms" : (ms / 1000).toFixed(1) + "s"
}

export function ScheduleRuns(props: { scheduleId: string; revision: number }) {
  const text = createUiText()
  const locale = createUiLocale()
  const time = (value: string | null | undefined) => { locale(); return formatTime(value) }
  const [runs, setRuns] = createSignal<ScheduleRunRecord[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [retry, setRetry] = createSignal(0)

  createEffect(() => [props.scheduleId, props.revision, retry()] as const, ([id]) => {
    let current = true
    setLoading(true)
    setError(null)
    void agentClient.listScheduleRuns(id).then((response) => {
      if (current) setRuns(response.runs ?? [])
    }).catch((failure: unknown) => {
      if (current) setError(errorMessage(failure))
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  })

  return <Show when={!loading()} fallback={<p role="status" class="px-1 py-2 text-xs text-muted-foreground">{text("loading_run_history_0ea0960f")}</p>}>
    <Show when={!error()} fallback={
      <div class="flex items-center justify-between gap-2 px-1 py-2">
        <p role="alert" class="text-xs text-destructive">{text("could_not_load_run_history_1bebf89d", { v0: error() })}</p>
        <Button type="button" size="sm" variant="secondary" onClick={() => setRetry((value) => value + 1)}>{text("retry_b8784c8d")}</Button>
      </div>
    }>
      <Show when={runs().length} fallback={<p class="px-1 py-2 text-xs text-muted-foreground">{text("no_runs_yet_6c3df58b")}</p>}>
        <ul class="divide-y">
          <For each={runs()} keyed={(run) => run.run_id}>{(run) => {
            const status = () => Object.hasOwn(statuses, run().status) ? statuses[run().status] : undefined
            const duration = () => formatDuration(run().execution_duration_ms)
            return <li class="space-y-1 px-1 py-2">
              <div class="flex flex-wrap items-center gap-1.5">
                <Badge variant={status()?.variant ?? "secondary"}>{status() ? text(status()!.label) : run().status}</Badge>
                <span class="text-xs text-muted-foreground">{text("scheduled_0f6b1949")} {time(run().scheduled_for)}</span>
                <Show when={run().was_catch_up}><Badge variant="outline">{text("catch_up_1ce0743a")}</Badge></Show>
              </div>
              <div class="text-xs text-muted-foreground">
                {text("started_d2bb025a")} {time(run().started_at)} {text("ended_66d5238f")} {time(run().completed_at)}
                {duration() ? text("duration_dd4a49ef", { v0: duration() }) : ""}
              </div>
              <Show when={run().session_id}><div class="truncate text-xs text-muted-foreground">{text("session_a6328025")} {run().session_id}</div></Show>
              <Show when={run().outcome_reason}><div class="text-xs text-muted-foreground">{text("reason_0a38db58")}{run().outcome_reason}</div></Show>
            </li>
          }}</For>
        </ul>
      </Show>
    </Show>
  </Show>
}
