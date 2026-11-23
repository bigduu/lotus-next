import { createMemo, For, Show } from "solid-js"
import { createUiText } from "../../shell/uiText"
import type { ForwardEndpointMetrics } from "@services/metrics"
import { formatDuration } from "@/components/chat/settings/metrics/format"
import { createMetricFormatters, shortEndpoint } from "./format"

/* Success-STATUS color (shared with ForwardRequestsTable's success dot), not
   the forward-SERIES color --mx-fwd — these bars encode outcome, not series. */
const SUCCESS_COLOR = "var(--mx-ok)"
const FAILED_COLOR = "var(--destructive)"

export function ForwardEndpointsList(props: { entries: ForwardEndpointMetrics[] }) {
  const uiText = createUiText()
  const { compact, exact } = createMetricFormatters()
  const sorted = createMemo(() => [...props.entries].sort((a, b) => b.requests - a.requests))
  const max = createMemo(() => sorted().reduce((acc, item) => Math.max(acc, item.requests), 0))

  const share = (part: number) => max() > 0 ? (part / max()) * 100 : 0

  return (
    <Show when={sorted().length} fallback={
      <p class="text-xs text-muted-foreground">{uiText("no_forward_requests_in_this_range_78b60c7c")}</p>
    }>
      <div class="space-y-2">
        {/* Legend: 2 segment colors → always present */}
        <div class="flex items-center gap-3 text-xs text-muted-foreground">
          <span class="flex items-center gap-1.5">
            <span class="h-0.5 w-3 rounded-full" style={{ background: SUCCESS_COLOR }} />
            {uiText("successful_053461ce")}</span>
          <span class="flex items-center gap-1.5">
            <span class="h-0.5 w-3 rounded-full" style={{ background: FAILED_COLOR }} />
            {uiText("failed_28384d7a")}</span>
        </div>

        <ul class="space-y-2">
          <For each={sorted()}>{(item) => (
              <li
                title={uiText("requests_successful_failed_3994db44", { v0: item.endpoint, v1: exact(item.requests), v2: exact(item.successful), v3: exact(item.failed) })}
              >
                <div class="flex items-baseline justify-between gap-2">
                  <span class="min-w-0 truncate text-xs">
                    {shortEndpoint(item.endpoint)}
                    <span class="ml-1.5 text-muted-foreground">
                      {uiText("successful_053461ce")} {compact(item.successful)} {uiText("failed_89661a55")} {compact(item.failed)}
                      {item.avg_duration_ms != null && item.avg_duration_ms > 0
                        ? uiText("average_847b8976", { v0: formatDuration(item.avg_duration_ms) })
                        : ""}
                    </span>
                  </span>
                  <span class="shrink-0 text-xs font-medium tabular-nums">
                    {compact(item.requests)}
                  </span>
                </div>
                <div
                  class="mt-1 flex h-1.5 w-full overflow-hidden rounded-full"
                  style={{ background: `color-mix(in srgb, ${SUCCESS_COLOR} 14%, transparent)` }}
                >
                  <div
                    class="h-full"
                    style={{
                      width: `${Math.max(share(item.successful), item.successful > 0 ? 1.5 : 0)}%`,
                      background: SUCCESS_COLOR,
                    }}
                  />
                  <div
                    class="h-full"
                    style={{
                      width: `${Math.max(share(item.failed), item.failed > 0 ? 1.5 : 0)}%`,
                      background: FAILED_COLOR,
                    }}
                  />
                </div>
              </li>
          )}</For>
        </ul>
      </div>
    </Show>
  )
}
