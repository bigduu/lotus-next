import { uiLanguage, uiText, useUiText, useUiLocale } from "@shared/i18n/ui"
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
  { id: "today", get label() { return uiText("today_d5f5a7a0") }, days: 1 },
  { id: "7d", get label() { return uiText("7_days_38eefacb") }, days: 7 },
  { id: "30d", get label() { return uiText("30_days_84ad2952") }, days: 30 },
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
  useUiLocale()
  return (
    <div className="rounded-lg border p-2.5" title={title}>
      <div className="text-lg font-semibold leading-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted-foreground/80">{sub}</div> : null}
    </div>
  )
}

export function SettingsMetrics() {
  const uiText = useUiText()
  const [preset, setPreset] = useState<PresetId>("7d")
  const [startDate, setStartDate] = useState<string>(() => addDays(todayString(), -6))
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
    return 7
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
        label: uiText("total_requests_ddde16f8"),
        value: formatCompact(combined.total_requests),
        sub: uiText("sessions_forward_292dc01e", { v0: formatCompact(chat.total_sessions), v1: formatCompact(forward.total_requests) }),
        title: formatExact(combined.total_requests),
      },
      {
        label: uiText("total_tokens_660bf040"),
        value: formatCompact(combined.total_tokens),
        title: formatExact(combined.total_tokens),
      },
      {
        label: uiText("success_rate_47d2ca13"),
        value: formatPercent(combined.success_rate),
        sub: uiText("failed_canceled_e9608c9f", { v0: formatCompact(combined.total_errors) }),
      },
      {
        label: uiText("active_sessions_1bd6d27c"),
        value: formatCompact(chat.active_sessions),
        sub: uiText("completed_e0dae796", { v0: formatCompact(chat.completed_sessions ?? 0) }),
        title: formatExact(chat.active_sessions),
      },
      {
        label: uiText("tool_calls_a8ca3c13"),
        value: formatCompact(chat.total_tool_calls),
        title: formatExact(chat.total_tool_calls),
      },
      {
        label: uiText("tokens_saved_by_compression_78843369"),
        value: formatCompact(chat.total_tokens_saved ?? 0),
        sub: uiText("compression_events_400e2333", { v0: formatCompact(chat.total_compression_events ?? 0) }),
        title: formatExact(chat.total_tokens_saved ?? 0),
      },
      {
        label: uiText("forward_requests_549199b5"),
        value: formatCompact(forward.total_requests),
        sub: uiText("failed_233d8a20", { v0: formatCompact(forward.failed_requests) }),
        title: formatExact(forward.total_requests),
      },
      {
        label: uiText("memory_entries_1c21bf72"),
        value: formatCompact(memory.total_memories),
        sub: uiText("pending_cleanup_7af3da03", { v0: formatCompact(memory.stale_candidate_count) }),
        title: formatExact(memory.total_memories),
      },
    ]
  }, [summary, uiText])

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
      meta: uiText("sessions_4e5cc041", { v0: formatExact(m.sessions), count: m.sessions }),
    }))
    if (rest.length > 0) {
      items.push({
        key: "__other__",
        label: uiText("other_models_dfe4953e", { v0: rest.length , count: rest.length }),
        value: rest.reduce((sum, m) => sum + m.tokens.total_tokens, 0),
        meta: uiText("sessions_4e5cc041", { v0: formatExact(rest.reduce((sum, m) => sum + m.sessions, 0)), count: rest.reduce((sum, m) => sum + m.sessions, 0) }),
      })
    }
    return items
  }, [data.models, uiText])

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
              aria-label={uiText("start_date_76050649")}
              className="h-7 w-[8.75rem] px-2 text-xs"
            />
            <span className="text-xs text-muted-foreground">{uiText("to_65edbf9f")}</span>
            <Input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => {
                setEndDate(e.target.value)
                setPreset("custom")
              }}
              aria-label={uiText("end_date_895cd52f")}
              className="h-7 w-[8.75rem] px-2 text-xs"
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label={uiText("refresh_aee88743")}
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {uiText("refreshes_every_30_seconds_while_visible_e02cda1f")} {lastUpdated
            ? uiText("last_updated_5d5c7605", { v0: new Date(lastUpdated).toLocaleTimeString(uiLanguage(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }) })
            : ""}
        </p>
      </div>

      {errors.length > 0 ? (
        <div className="space-y-1 rounded-lg border border-destructive/50 bg-destructive/10 p-2.5 text-xs text-destructive">
          {errors.map((message) => (
            <div key={message}>{uiText("could_not_load_ca2335da")} {message}</div>
          ))}
          <button className="underline underline-offset-2" onClick={() => void refresh()}>
            {uiText("retry_b8784c8d")}</button>
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
          <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("overview_a33db573")}</div>
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
            <p className="text-xs text-muted-foreground">{uiText("no_data_yet_497c8569")}</p>
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {uiText("token_trend_last_1cbf2e73")} {days} {uiText("days_6ef2fddf")}</div>
          {initialLoading ? (
            <Skeleton className="h-40 rounded-lg" />
          ) : (
            <TimelineChart points={data.timeline} />
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("model_distribution_by_tokens_f7a6674f")}</div>
          {initialLoading ? (
            <Skeleton className="h-24 rounded-lg" />
          ) : (
            <BarList items={modelItems} emptyText={uiText("no_model_usage_in_this_range_2b5f1863")} />
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("usage_breakdown_38f4c70c")}</div>
          {initialLoading ? (
            <Skeleton className="h-32 rounded-lg" />
          ) : data.usage ? (
            <UsageBreakdown usage={data.usage} />
          ) : (
            <p className="text-xs text-muted-foreground">{uiText("no_data_yet_497c8569")}</p>
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {uiText("forward_endpoint_distribution_by_requests_afb001e2")}</div>
          {initialLoading ? (
            <Skeleton className="h-24 rounded-lg" />
          ) : (
            <ForwardEndpointsList endpoints={data.forwardEndpoints} />
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {uiText("sync_mismatch_distribution_by_reason_4fc1c9b5")}</div>
          {initialLoading ? (
            <Skeleton className="h-24 rounded-lg" />
          ) : (
            <SyncMismatchBreakdown breakdown={summary?.chat.sync_mismatch_breakdown} />
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {uiText("memory_trend_last_26d2aa43")} {days} {uiText("days_6ef2fddf")}</div>
          {initialLoading ? (
            <Skeleton className="h-40 rounded-lg" />
          ) : (
            <MemoryTrendChart points={data.memoryTimeline} />
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("recent_sessions_up_to_20_77b385e9")}</div>
          {initialLoading ? (
            <Skeleton className="h-40 rounded-lg" />
          ) : (
            <SessionsTable sessions={data.sessions} />
          )}
        </section>

        <section className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {uiText("recent_forward_requests_up_to_50_f23834e1")}</div>
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
