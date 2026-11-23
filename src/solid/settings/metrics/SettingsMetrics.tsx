import { createMemo, createSignal, For, Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import { RefreshCw } from "@lucide/solid"
import { cn } from "@/lib/utils"
import { addDays, inclusiveDayCount, todayString } from "@/components/chat/settings/metrics/format"
import { createUiLocale, createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Skeleton } from "../../ui/skeleton"
import { BarList, type BarListItem } from "./BarList"
import { createMetricsDashboard } from "./createMetricsDashboard"
import { ForwardEndpointsList } from "./ForwardEndpointsList"
import { ForwardRequestsTable } from "./ForwardRequestsTable"
import { createMetricFormatters } from "./format"
import { MetricOverview } from "./MetricOverview"
import { MemoryTrend, TokenTrend } from "./MetricTimeline"
import { SessionsTable } from "./SessionsTable"
import { SyncMismatchBreakdown } from "./SyncMismatchBreakdown"
import { UsageBreakdown } from "./UsageBreakdown"

const PRESETS = [
  { id: "today", label: "today_d5f5a7a0", days: 1 },
  { id: "7d", label: "7_days_38eefacb", days: 7 },
  { id: "30d", label: "30_days_84ad2952", days: 30 },
] as const

type DateRange = { preset: (typeof PRESETS)[number]["id"] | "custom"; start: string; end: string }

// The forward series and the success status have separate colors.
const SERIES_CSS =
  ".lnx-metrics{--mx-chat:#2a78d6;--mx-fwd:#1baf7a;--mx-mem:#8a5cd8;--mx-ok:#059669}.dark .lnx-metrics{--mx-chat:#3987e5;--mx-fwd:#199e70;--mx-mem:#9a74e3;--mx-ok:#10b981}"

function MetricPanel(props: { title: string; loading: boolean; placeholder: JSX.Element; children: JSX.Element }) {
  return (
    <section class="min-w-0 rounded-lg border p-3" aria-label={props.title}>
      <h3 class="mb-2 text-xs font-medium text-muted-foreground">{props.title}</h3>
      <Show when={!props.loading} fallback={props.placeholder}>
        {props.children}
      </Show>
    </section>
  )
}

export function SettingsMetrics() {
  const uiText = createUiText()
  const locale = createUiLocale()
  const { exact } = createMetricFormatters()
  const today = todayString()
  const [range, setRange] = createSignal<DateRange>({ preset: "7d", start: addDays(today, -6), end: today })

  const filters = createMemo(() => {
    const { start, end } = range()
    return {
      startDate: start || undefined,
      endDate: end || undefined,
      days: start ? Math.min(inclusiveDayCount(start, end || todayString()), 365) : 7,
    }
  })
  const { data, errors, refreshing, lastUpdated, refresh } = createMetricsDashboard(filters)
  const loading = () => lastUpdated() === null
  const noData = () => <p class="text-xs text-muted-foreground">{uiText("no_data_yet_497c8569")}</p>

  const modelItems = createMemo<BarListItem[]>(() => {
    const sorted = [...data().models].sort((a, b) => b.tokens.total_tokens - a.tokens.total_tokens)
    const sessionCount = (count: number) => uiText("sessions_4e5cc041", { v0: exact(count), count })
    const items = sorted.slice(0, 8).map((model) => ({
      label: model.model,
      value: model.tokens.total_tokens,
      meta: sessionCount(model.sessions),
    }))
    const rest = sorted.slice(8)
    if (rest.length > 0) {
      items.push({
        label: uiText("other_models_dfe4953e", { v0: rest.length, count: rest.length }),
        value: rest.reduce((sum, model) => sum + model.tokens.total_tokens, 0),
        meta: sessionCount(rest.reduce((sum, model) => sum + model.sessions, 0)),
      })
    }
    return items
  })
  const updatedTime = createMemo(() => {
    const time = lastUpdated()
    return time === null ? "" : uiText("last_updated_5d5c7605", {
      v0: new Date(time).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    })
  })

  return (
    <div class="lnx-metrics min-w-0 space-y-4">
      <style>{SERIES_CSS}</style>
      <div class="space-y-1.5">
        <div class="flex flex-wrap items-center gap-2">
          <For each={PRESETS}>{(preset) => (
            <Button
              type="button"
              size="sm"
              variant={range().preset === preset.id ? "default" : "secondary"}
              aria-pressed={range().preset === preset.id ? "true" : "false"}
              class="h-7 px-2.5 text-xs"
              onClick={() => {
                const end = todayString()
                setRange({ preset: preset.id, start: addDays(end, 1 - preset.days), end })
              }}
            >
              {uiText(preset.label)}
            </Button>
          )}</For>
          <div class="flex max-w-full items-center gap-1">
            <Input
              type="date"
              value={range().start}
              max={range().end || undefined}
              onChange={(event) => setRange({ ...range(), preset: "custom", start: event.currentTarget.value })}
              aria-label={uiText("start_date_76050649")}
              class="h-7 w-[8.75rem] px-2 text-xs"
            />
            <span class="text-xs text-muted-foreground">{uiText("to_65edbf9f")}</span>
            <Input
              type="date"
              value={range().end}
              min={range().start || undefined}
              onChange={(event) => setRange({ ...range(), preset: "custom", end: event.currentTarget.value })}
              aria-label={uiText("end_date_895cd52f")}
              class="h-7 w-[8.75rem] px-2 text-xs"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            class="h-7 px-2"
            onClick={() => void refresh()}
            disabled={refreshing()}
            aria-label={uiText("refresh_aee88743")}
          >
            <RefreshCw class={cn("size-3.5", refreshing() && "animate-spin")} />
          </Button>
        </div>
        <p class="text-xs text-muted-foreground">
          {uiText("refreshes_every_30_seconds_while_visible_e02cda1f")} {updatedTime()}
        </p>
      </div>

      <Show when={errors().length}>
        <div role="alert" class="space-y-1 rounded-lg border border-destructive/50 bg-destructive/10 p-2.5 text-xs text-destructive">
          <For each={errors()}>{(error) => (
            <div>{uiText("could_not_load_ca2335da")} {uiText(error.label)}: {error.message}</div>
          )}</For>
          <button type="button" class="underline underline-offset-2" onClick={() => void refresh()}>
            {uiText("retry_b8784c8d")}
          </button>
        </div>
      </Show>

      <div
        aria-busy={refreshing() ? "true" : "false"}
        class={cn("space-y-4 transition-opacity duration-300", refreshing() && !loading() && "opacity-60")}
      >
        <MetricPanel title={uiText("overview_a33db573")} loading={loading()} placeholder={
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <For each={Array.from({ length: 8 }, (_, index) => index)}>{() => <Skeleton class="h-16 rounded-lg" />}</For>
          </div>
        }>
          <Show when={data().summary} fallback={noData()}>{(summary) => <MetricOverview summary={summary()} />}</Show>
        </MetricPanel>

        <MetricPanel
          title={`${uiText("token_trend_last_1cbf2e73")} ${filters().days} ${uiText("days_6ef2fddf")}`}
          loading={loading()}
          placeholder={<Skeleton class="h-40 rounded-lg" />}
        >
          <TokenTrend points={data().timeline} />
        </MetricPanel>

        <MetricPanel title={uiText("model_distribution_by_tokens_f7a6674f")} loading={loading()} placeholder={<Skeleton class="h-24 rounded-lg" />}>
          <BarList items={modelItems()} emptyText={uiText("no_model_usage_in_this_range_2b5f1863")} />
        </MetricPanel>

        <MetricPanel title={uiText("usage_breakdown_38f4c70c")} loading={loading()} placeholder={<Skeleton class="h-32 rounded-lg" />}>
          <Show when={data().usage} fallback={noData()}>{(usage) => <UsageBreakdown usage={usage()} />}</Show>
        </MetricPanel>

        <MetricPanel title={uiText("forward_endpoint_distribution_by_requests_afb001e2")} loading={loading()} placeholder={<Skeleton class="h-24 rounded-lg" />}>
          <ForwardEndpointsList entries={data().forwardEndpoints} />
        </MetricPanel>

        <MetricPanel title={uiText("sync_mismatch_distribution_by_reason_4fc1c9b5")} loading={loading()} placeholder={<Skeleton class="h-24 rounded-lg" />}>
          <SyncMismatchBreakdown breakdown={data().summary?.chat.sync_mismatch_breakdown} />
        </MetricPanel>

        <MetricPanel
          title={`${uiText("memory_trend_last_26d2aa43")} ${filters().days} ${uiText("days_6ef2fddf")}`}
          loading={loading()}
          placeholder={<Skeleton class="h-40 rounded-lg" />}
        >
          <MemoryTrend points={data().memoryTimeline} />
        </MetricPanel>

        <MetricPanel title={uiText("recent_sessions_up_to_20_77b385e9")} loading={loading()} placeholder={<Skeleton class="h-40 rounded-lg" />}>
          <SessionsTable sessions={data().sessions} />
        </MetricPanel>

        <MetricPanel title={uiText("recent_forward_requests_up_to_50_f23834e1")} loading={loading()} placeholder={<Skeleton class="h-40 rounded-lg" />}>
          <ForwardRequestsTable requests={data().forwardRequests} />
        </MetricPanel>
      </div>
    </div>
  )
}
