import type { ForwardEndpointMetrics } from "@services/metrics"
import { formatCompact, formatDuration, formatExact } from "./format"

const SUCCESS_COLOR = "var(--mx-fwd)"
const FAILED_COLOR = "var(--destructive)"

/** "chat.completions" → "completions" (mirrors legacy's endpoint shortening). */
function shortEndpoint(endpoint: string): string {
  return endpoint.split(".").pop() || endpoint
}

/**
 * Per-endpoint forward request share: one row per endpoint, stacked
 * success/failure segments over a shared max so widths compare across rows.
 * Ported from legacy ForwardEndpointDistribution (grouped bar chart) into
 * next's BarList idiom — every row carries exact values as text.
 */
export function ForwardEndpointsList({ endpoints }: { endpoints: ForwardEndpointMetrics[] }) {
  if (endpoints.length === 0) {
    return <p className="text-xs text-muted-foreground">此范围内暂无 Forward 请求</p>
  }

  const sorted = [...endpoints].sort((a, b) => b.requests - a.requests)
  const max = sorted.reduce((acc, item) => Math.max(acc, item.requests), 0)

  return (
    <div className="space-y-2">
      {/* Legend: 2 segment colors → always present */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full" style={{ background: SUCCESS_COLOR }} />
          成功
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full" style={{ background: FAILED_COLOR }} />
          失败
        </span>
      </div>

      <ul className="space-y-2">
        {sorted.map((item) => {
          const successPct = max > 0 ? (item.successful / max) * 100 : 0
          const failedPct = max > 0 ? (item.failed / max) * 100 : 0
          return (
            <li
              key={item.endpoint}
              title={`${item.endpoint}: ${formatExact(item.requests)} 次请求(成功 ${formatExact(item.successful)} · 失败 ${formatExact(item.failed)})`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-xs">
                  {shortEndpoint(item.endpoint)}
                  <span className="ml-1.5 text-muted-foreground">
                    成功 {formatCompact(item.successful)} · 失败 {formatCompact(item.failed)}
                    {item.avg_duration_ms != null && item.avg_duration_ms > 0
                      ? ` · 平均 ${formatDuration(item.avg_duration_ms)}`
                      : ""}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-medium tabular-nums">
                  {formatCompact(item.requests)}
                </span>
              </div>
              <div
                className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: `color-mix(in srgb, ${SUCCESS_COLOR} 14%, transparent)` }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${Math.max(successPct, item.successful > 0 ? 1.5 : 0)}%`,
                    background: SUCCESS_COLOR,
                  }}
                />
                <div
                  className="h-full"
                  style={{
                    width: `${Math.max(failedPct, item.failed > 0 ? 1.5 : 0)}%`,
                    background: FAILED_COLOR,
                  }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
