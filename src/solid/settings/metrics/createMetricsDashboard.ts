import { createEffect, createSignal, onSettled, untrack } from "solid-js"
import { metricsService } from "@services/metrics"
import type {
  ForwardEndpointMetrics,
  ForwardRequestMetrics,
  MemoryTimelinePoint,
  MetricsDateRange,
  MetricsUsageBreakdownResponse,
  ModelMetrics,
  SessionMetrics,
  UnifiedSummary,
  UnifiedTimelinePoint,
} from "@services/metrics"

interface MetricsFilters extends MetricsDateRange {
  days: number
}

const POLL_INTERVAL_MS = 30_000

function fetchSections({ days, startDate, endDate }: MetricsFilters) {
  const range = { startDate, endDate }
  const trend = { days, endDate }
  return [
    metricsService.getUnifiedSummary(range),
    metricsService.getUnifiedTimeline(trend),
    metricsService.getByModel(range),
    metricsService.getUsageBreakdown(range),
    metricsService.getSessions({ ...range, limit: 20 }),
    metricsService.getForwardByEndpoint(range),
    metricsService.getForwardRequests({ ...range, limit: 50 }),
    metricsService.getMemoryTimeline(trend),
  ] as const
}

function settledValue<T>(result: PromiseSettledResult<T>, previous: T): T {
  return result.status === "fulfilled" ? result.value : previous
}

const EMPTY_DATA: DashboardData = {
  summary: null,
  timeline: [],
  models: [],
  usage: null,
  sessions: [],
  forwardEndpoints: [],
  forwardRequests: [],
  memoryTimeline: [],
}

function mergeSections(
  [summary, timeline, models, usage, sessions, forwardEndpoints, forwardRequests, memoryTimeline]:
    Awaited<ReturnType<typeof settleSections>>,
  previous: DashboardData,
): DashboardData {
  return {
    summary: settledValue(summary, previous.summary),
    timeline: settledValue(timeline, previous.timeline),
    models: settledValue(models, previous.models),
    usage: settledValue(usage, previous.usage),
    sessions: settledValue(sessions, previous.sessions),
    forwardEndpoints: settledValue(forwardEndpoints, previous.forwardEndpoints),
    forwardRequests: settledValue(forwardRequests, previous.forwardRequests),
    memoryTimeline: settledValue(memoryTimeline, previous.memoryTimeline),
  }
}

interface DashboardData {
  summary: UnifiedSummary | null
  timeline: UnifiedTimelinePoint[]
  models: ModelMetrics[]
  usage: MetricsUsageBreakdownResponse | null
  sessions: SessionMetrics[]
  forwardEndpoints: ForwardEndpointMetrics[]
  forwardRequests: ForwardRequestMetrics[]
  memoryTimeline: MemoryTimelinePoint[]
}

function settleSections(filters: MetricsFilters) {
  return Promise.allSettled(fetchSections(filters))
}

const SECTION_LABELS = [
  "overview_a33db573",
  "trend_9b59e637",
  "model_distribution_39f1a54a",
  "usage_breakdown_38f4c70c",
  "sessions_c980de33",
  "forward_endpoints_3e1263a7",
  "forward_requests_549199b5",
  "memory_trend_73d9cf2f",
] as const

interface SectionError {
  label: (typeof SECTION_LABELS)[number]
  message: string
}

export function createMetricsDashboard(filters: () => MetricsFilters) {
  const [data, setData] = createSignal<DashboardData>(EMPTY_DATA)
  const [errors, setErrors] = createSignal<SectionError[]>([])
  const [refreshing, setRefreshing] = createSignal(true)
  const [lastUpdated, setLastUpdated] = createSignal<number | null>(null)

  let generation = 0
  let inFlight = false
  let updatedAt = 0

  async function load(range: MetricsFilters) {
    const request = ++generation
    inFlight = true
    setRefreshing(true)
    const results = await settleSections(range)
    if (request !== generation) return

    inFlight = false
    setData((previous) => mergeSections(results, previous))
    setErrors(results.flatMap((result, index) => {
      if (result.status === "fulfilled") return []
      const reason: unknown = result.reason
      return [{
        label: SECTION_LABELS[index],
        message: reason instanceof Error ? reason.message : String(reason),
      }]
    }))
    updatedAt = Date.now()
    setLastUpdated(updatedAt)
    setRefreshing(false)
  }

  const refresh = () => load(untrack(filters))
  createEffect(filters, (range) => {
    void load(range)
    return () => { generation += 1 }
  })

  onSettled(() => {
    const timer = window.setInterval(() => {
      if (!inFlight && document.visibilityState === "visible") void refresh()
    }, POLL_INTERVAL_MS)
    const onVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - updatedAt > POLL_INTERVAL_MS) {
        void refresh()
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  })

  return { data, errors, refreshing, lastUpdated, refresh }
}
