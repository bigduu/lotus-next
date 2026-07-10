import { useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  addDays,
  formatCompact,
  formatExact,
  formatPercent,
  inclusiveDayCount,
  todayString,
} from "./metrics/format"
import { useMetricsDashboard } from "./metrics/useMetricsDashboard"
import { TimelineChart } from "./metrics/TimelineChart"
import { BarList, type BarListItem } from "./metrics/BarList"
import { SessionsTable } from "./metrics/SessionsTable"
import { UsageBreakdown } from "./metrics/UsageBreakdown"
import { ForwardEndpointsList } from "./metrics/ForwardEndpointsList"
import { ForwardRequestsTable } from "./metrics/ForwardRequestsTable"
import { SyncMismatchBreakdown } from "./metrics/SyncMismatchBreakdown"
import { MemoryTrendChart } from "./metrics/MemoryTrendChart"

type PresetId = "today" | "7d" | "30d" | "custom"

const PRESETS: { id: Exclude<PresetId, "custom">; label: string; days: number }[] = [
  { id: "today", label: "今天", days: 1 },
  { id: "7d", label: "7 天", days: 7 },
  { id: "30d", label: "30 天", days: 30 },
]

/* Chart series colors (validated for both surfaces): chat = blue, forward = aqua, memory = violet.
   --mx-ok is the success-STATUS color (emerald, matches SessionsTable's completed dot), distinct
   from --mx-fwd which identifies the forward SERIES in charts. */
const SERIES_CSS =
  ".lnx-metrics{--mx-chat:#2a78d6;--mx-fwd:#1baf7a;--mx-mem:#8a5cd8;--mx-ok:#059669}.dark .lnx-metrics{--mx-chat:#3987e5;--mx-fwd:#199e70;--mx-mem:#9a74e3;--mx-ok:#10b981}"

function StatTile({
  label,
  value,
  sub,
  title,
}: {
  label: string
  value: string
  sub?: string
  title?: string
}) {
  return (
    <div className="rounded-lg border p-2.5" title={title}>
      <div className="text-lg font-semibold leading-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted-foreground/80">{sub}</div> : null}
    </div>
  )
}

export function SettingsMetrics() {
  const [preset, setPreset] = useState<PresetId>("30d")
  const [startDate, setStartDate] = useState<string>(() => addDays(todayString(), -29))
  const [endDate, setEndDate] = useState<string>(() => todayString())

  const applyPreset = (id: Exclude<PresetId, "custom">, presetDays: number) => {
    const today = todayString()
    setPreset(id)
    setStartDate(addDays(today, -(presetDays - 1)))
    setEndDate(today)
  }

  const days = useMemo(() => {
    if (startDate && endDate) return Math.min(inclusiveDayCount(startDate, endDate), 365)
    if (startDate) return Math.min(inclusiveDayCount(startDate, todayString()), 365)
    return 30
  }, [startDate, endDate])

  const filters = useMemo(
    () => ({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      days,
    }),
    [startDate, endDate, days],
  )

  const { data, errors, initialLoading, refreshing, lastUpdated, refresh } =
    useMetricsDashboard(filters)

  const summary = data.summary

  const tiles = useMemo(() => {
    if (!summary) return []
    const { chat, forward, combined, memory } = summary
    return [
      {
        label: "总请求",
        value: formatCompact(combined.total_requests),
        sub: `会话 ${formatCompact(chat.total_sessions)} · 转发 ${formatCompact(forward.total_requests)}`,
        title: formatExact(combined.total_requests),
      },
      {
        label: "总 Tokens",
        value: formatCompact(combined.total_tokens),
        title: formatExact(combined.total_tokens),
      },
      {
        label: "成功率",
        value: formatPercent(combined.success_rate),
        sub: `失败/取消 ${formatCompact(combined.total_errors)}`,
      },
      {
        label: "进行中会话",
        value: formatCompact(chat.active_sessions),
        sub: `已完成 ${formatCompact(chat.completed_sessions ?? 0)}`,
        title: formatExact(chat.active_sessions),
      },
      {
        label: "工具调用",
        value: formatCompact(chat.total_tool_calls),
        title: formatExact(chat.total_tool_calls),
      },
      {
        label: "压缩节省 Tokens",
        value: formatCompact(chat.total_tokens_saved ?? 0),
        sub: `压缩事件 ${formatCompact(chat.total_compression_events ?? 0)}`,
        title: formatExact(chat.total_tokens_saved ?? 0),
      },
      {
        label: "Forward 请求",
        value: formatCompact(forward.total_requests),
        sub: `失败 ${formatCompact(forward.failed_requests)}`,
        title: formatExact(forward.total_requests),
      },
      {
        label: "记忆条目",
        value: formatCompact(memory.total_memories),
        sub: `待清理 ${formatCompact(memory.stale_candidate_count)}`,
        title: formatExact(memory.total_memories),
      },
    ]
  }, [summary])

  const modelItems = useMemo<BarListItem[]>(() => {
    const sorted = [...data.models].sort(
      (a, b) => b.tokens.total_tokens - a.tokens.total_tokens,
    )
    const top = sorted.slice(0, 8)
    const rest = sorted.slice(8)
    const items: BarListItem[] = top.map((m) => ({
      key: m.model,
      label: m.model,
      value: m.tokens.total_tokens,
      meta: `${formatExact(m.sessions)} 会话`,
    }))
    if (rest.length > 0) {
      items.push({
        key: "__other__",
        label: `其他(${rest.length} 个模型)`,
        value: rest.reduce((sum, m) => sum + m.tokens.total_tokens, 0),
        meta: `${formatExact(rest.reduce((sum, m) => sum + m.sessions, 0))} 会话`,
      })
    }
    return items
  }, [data.models])

  return (
    <div className="lnx-metrics space-y-4">
      <style>{SERIES_CSS}</style>

      {/* Filter row — one row above everything it scopes */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={preset === p.id ? "default" : "secondary"}
              className="h-7 px-2.5 text-xs"
              onClick={() => applyPreset(p.id, p.days)}
            >
              {p.label}
            </Button>
          ))}
          <div className="flex items-center gap-1">
            <Input
              type="date"
              value={startDate}
              max={endDate || undefined}
              onChange={(e) => {
                setStartDate(e.target.value)
                setPreset("custom")
              }}
              aria-label="开始日期"
              className="h-7 w-[8.75rem] px-2 text-xs"
            />
            <span className="text-xs text-muted-foreground">至</span>
            <Input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => {
                setEndDate(e.target.value)
                setPreset("custom")
              }}
              aria-label="结束日期"
              className="h-7 w-[8.75rem] px-2 text-xs"
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label="刷新"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          面板可见时每 30 秒自动刷新
          {lastUpdated
            ? ` · 上次更新 ${new Date(lastUpdated).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
            : ""}
        </p>
      </div>

      {errors.length > 0 ? (
        <div className="space-y-1 rounded-lg border border-destructive/50 bg-destructive/10 p-2.5 text-xs text-destructive">
          {errors.map((message) => (
            <div key={message}>加载失败 — {message}</div>
          ))}
          <button className="underline underline-offset-2" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      ) : null}

      {/* Refetch keeps the frame: previous render held at reduced opacity */}
      <div
        className={cn(
          "space-y-4 transition-opacity duration-300",
          refreshing && !initialLoading && "opacity-60",
        )}
      >
        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">总览</div>
          {initialLoading ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : summary ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {tiles.map((tile) => (
                <StatTile key={tile.label} {...tile} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">暂无数据</p>
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Token 趋势(近 {days} 天)
          </div>
          {initialLoading ? (
            <Skeleton className="h-40 rounded-lg" />
          ) : (
            <TimelineChart points={data.timeline} />
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">模型分布(按 Tokens)</div>
          {initialLoading ? (
            <Skeleton className="h-24 rounded-lg" />
          ) : (
            <BarList items={modelItems} emptyText="此范围内暂无模型用量" />
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">用量构成</div>
          {initialLoading ? (
            <Skeleton className="h-32 rounded-lg" />
          ) : data.usage ? (
            <UsageBreakdown usage={data.usage} />
          ) : (
            <p className="text-xs text-muted-foreground">暂无数据</p>
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Forward 端点分布(按请求数)
          </div>
          {initialLoading ? (
            <Skeleton className="h-24 rounded-lg" />
          ) : (
            <ForwardEndpointsList endpoints={data.forwardEndpoints} />
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            同步不一致分布(按原因)
          </div>
          {initialLoading ? (
            <Skeleton className="h-24 rounded-lg" />
          ) : (
            <SyncMismatchBreakdown breakdown={summary?.chat.sync_mismatch_breakdown} />
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            记忆趋势(近 {days} 天)
          </div>
          {initialLoading ? (
            <Skeleton className="h-40 rounded-lg" />
          ) : (
            <MemoryTrendChart points={data.memoryTimeline} />
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">最近会话(最多 20 条)</div>
          {initialLoading ? (
            <Skeleton className="h-40 rounded-lg" />
          ) : (
            <SessionsTable sessions={data.sessions} />
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            最近 Forward 请求(最多 50 条)
          </div>
          {initialLoading ? (
            <Skeleton className="h-40 rounded-lg" />
          ) : (
            <ForwardRequestsTable requests={data.forwardRequests} />
          )}
        </section>
      </div>
    </div>
  )
}
