import { For, Show } from "solid-js"
import { createUiText } from "../../shell/uiText"
import type { SessionMetrics, SessionStatus } from "@services/metrics"
import { cn } from "@/lib/utils"
import { formatDuration } from "@/components/chat/settings/metrics/format"
import { createMetricFormatters } from "./format"

const STATUS_META: Record<SessionStatus, { label: Parameters<ReturnType<typeof createUiText>>[0]; dotClass: string }> = {
  running: { label: "active_dc9591e5", dotClass: "bg-[#2a78d6] dark:bg-[#3987e5]" },
  awaiting_response: { label: "awaiting_response_bf0b6179", dotClass: "bg-amber-500" },
  completed: { label: "completed_f28461bb", dotClass: "bg-emerald-600 dark:bg-emerald-500" },
  error: { label: "errors_01ad2bc5", dotClass: "bg-destructive" },
  cancelled: { label: "cancelled_a37778f1", dotClass: "bg-muted-foreground" },
}

function StatusCell(props: { status: SessionStatus; text: ReturnType<typeof createUiText> }) {
  const meta = () => props.status ? STATUS_META[props.status] : undefined
  const label = () => {
    const current = meta()
    return current ? props.text(current.label) : props.status
  }
  return (
    <Show when={props.status} fallback={<span class="text-muted-foreground">-</span>}>
      <span class="flex items-center gap-1.5 whitespace-nowrap">
        <span class={cn("inline-block size-1.5 shrink-0 rounded-full", meta()?.dotClass ?? "bg-muted-foreground")} />
        {label()}
      </span>
    </Show>
  )
}

export function SessionsTable(props: { sessions: SessionMetrics[] }) {
  const uiText = createUiText()
  const { compact, exact, dateTime } = createMetricFormatters()
  return (
    <Show when={props.sessions.length} fallback={<p class="text-xs text-muted-foreground">{uiText("no_session_records_yet_8fae1d55")}</p>}>
      <div class="max-h-72 overflow-auto rounded-md border">
        <table class="w-full min-w-[620px] text-xs">
          <thead class="sticky top-0 z-10 bg-background text-muted-foreground">
            <tr class="[&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
              <th class="text-left">{uiText("session_a6328025")}</th>
              <th class="text-left">{uiText("model_c98e118e")}</th>
              <th class="text-left">{uiText("status_6320b4a8")}</th>
              <th class="text-right">{uiText("round_4890584b")}</th>
              <th class="text-right">Tokens</th>
              <th class="text-right">{uiText("tool_5ca6730d")}</th>
              <th class="text-right">{uiText("duration_04a95e06")}</th>
              <th class="text-right">{uiText("started_6a9906c7")}</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.sessions}>{(s) => (
              <tr class="border-t [&>td]:px-2 [&>td]:py-1.5">
                <td class="font-mono" title={s.session_id}>
                  {s.session_id.slice(0, 8)}
                </td>
                <td class="max-w-40 truncate" title={s.model}>
                  {s.model || "-"}
                </td>
                <td>
                  <StatusCell text={uiText} status={s.status} />
                </td>
                <td class="text-right tabular-nums">{exact(s.total_rounds)}</td>
                <td
                  class="text-right tabular-nums"
                  title={exact(s.total_token_usage.total_tokens)}
                >
                  {compact(s.total_token_usage.total_tokens)}
                </td>
                <td class="text-right tabular-nums">{exact(s.tool_call_count)}</td>
                <td class="text-right tabular-nums">{formatDuration(s.duration_ms)}</td>
                <td class="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                  {dateTime(s.started_at)}
                </td>
              </tr>
            )}</For>
          </tbody>
        </table>
      </div>
    </Show>
  )
}
