import { createMemo, For, Show } from "solid-js"
import type { UnifiedSummary } from "@services/metrics"
import { createUiText } from "../../shell/uiText"
import { createMetricFormatters } from "./format"

export function MetricOverview(props: { summary: UnifiedSummary }) {
  const uiText = createUiText()
  const { compact, exact, percent } = createMetricFormatters()
  const tiles = createMemo(() => {
    const { chat, forward, combined, memory } = props.summary
    return [
      {
        label: uiText("total_requests_ddde16f8"),
        value: compact(combined.total_requests),
        sub: uiText("sessions_forward_292dc01e", { v0: compact(chat.total_sessions), v1: compact(forward.total_requests) }),
        title: exact(combined.total_requests),
      },
      {
        label: uiText("total_tokens_660bf040"),
        value: compact(combined.total_tokens),
        title: exact(combined.total_tokens),
      },
      {
        label: uiText("success_rate_47d2ca13"),
        value: percent(combined.success_rate),
        sub: uiText("failed_canceled_e9608c9f", { v0: compact(combined.total_errors) }),
      },
      {
        label: uiText("active_sessions_1bd6d27c"),
        value: compact(chat.active_sessions),
        sub: uiText("completed_e0dae796", { v0: compact(chat.completed_sessions ?? 0) }),
        title: exact(chat.active_sessions),
      },
      {
        label: uiText("tool_calls_a8ca3c13"),
        value: compact(chat.total_tool_calls),
        title: exact(chat.total_tool_calls),
      },
      {
        label: uiText("tokens_saved_by_compression_78843369"),
        value: compact(chat.total_tokens_saved ?? 0),
        sub: uiText("compression_events_400e2333", { v0: compact(chat.total_compression_events ?? 0) }),
        title: exact(chat.total_tokens_saved ?? 0),
      },
      {
        label: uiText("forward_requests_549199b5"),
        value: compact(forward.total_requests),
        sub: uiText("failed_233d8a20", { v0: compact(forward.failed_requests) }),
        title: exact(forward.total_requests),
      },
      {
        label: uiText("memory_entries_1c21bf72"),
        value: compact(memory.total_memories),
        sub: uiText("pending_cleanup_7af3da03", { v0: compact(memory.stale_candidate_count) }),
        title: exact(memory.total_memories),
      },
    ]
  })

  return (
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <For each={tiles()}>{(tile) => (
        <div class="rounded-lg border p-2.5" title={tile.title}>
          <div class="text-lg font-semibold leading-tight">{tile.value}</div>
          <div class="text-xs text-muted-foreground">{tile.label}</div>
          <Show when={tile.sub}>
            <div class="mt-0.5 text-[11px] text-muted-foreground/80">{tile.sub}</div>
          </Show>
        </div>
      )}</For>
    </div>
  )
}
