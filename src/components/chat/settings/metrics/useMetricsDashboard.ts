import { useCallback, useEffect, useRef, useState } from "react"
import { metricsService } from "@services/metrics"
import type {
  MetricsUsageBreakdownResponse,
  ModelMetrics,
  SessionMetrics,
  UnifiedSummary,
  UnifiedTimelinePoint,
} from "@services/metrics"

export interface MetricsDashboardFilters {
  startDate?: string
  endDate?: string
  /** Timeline window length (backend clamps 1..365). */
  days: number
}

export interface MetricsDashboardData {
  summary: UnifiedSummary | null
  timeline: UnifiedTimelinePoint[]
  models: ModelMetrics[]
  usage: MetricsUsageBreakdownResponse | null
  sessions: SessionMetrics[]
}

const EMPTY_DATA: MetricsDashboardData = {
  summary: null,
  timeline: [],
  models: [],
  usage: null,
  sessions: [],
}

const POLL_INTERVAL_MS = 30_000
const SECTION_LABELS = ["总览", "趋势", "模型分布", "用量构成", "会话列表"] as const

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  return String(reason)
}

/**
 * Loads all metrics dashboard slices and keeps them fresh with a 30s poll that
 * only runs while the document is visible (the component itself only mounts
 * while the 指标 tab is open, so mounted ⇒ panel shown).
 */
export function useMetricsDashboard(filters: MetricsDashboardFilters) {
  const [data, setData] = useState<MetricsDashboardData>(EMPTY_DATA)
  const [errors, setErrors] = useState<string[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  const inFlightRef = useRef(false)
  const generationRef = useRef(0)
  const mountedRef = useRef(true)
  const lastUpdatedRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(
    async (options?: { skipIfBusy?: boolean }) => {
      // Polling ticks skip while a request is in flight; explicit loads (filter
      // change, retry button) always run — a newer generation supersedes older
      // responses so stale data never clobbers the fresh range.
      if (options?.skipIfBusy && inFlightRef.current) return
      const generation = ++generationRef.current
      inFlightRef.current = true
      setRefreshing(true)

      const range = { startDate: filters.startDate, endDate: filters.endDate }
      const results = await Promise.allSettled([
        metricsService.getUnifiedSummary(range),
        metricsService.getUnifiedTimeline({ days: filters.days, endDate: filters.endDate }),
        metricsService.getByModel(range),
        metricsService.getUsageBreakdown(range),
        metricsService.getSessions({ ...range, limit: 20 }),
      ])

      if (generation !== generationRef.current) return
      inFlightRef.current = false
      if (!mountedRef.current) return

      const [summary, timeline, models, usage, sessions] = results
      setData((prev) => ({
        summary: summary.status === "fulfilled" ? summary.value : prev.summary,
        timeline: timeline.status === "fulfilled" ? timeline.value : prev.timeline,
        models: models.status === "fulfilled" ? models.value : prev.models,
        usage: usage.status === "fulfilled" ? usage.value : prev.usage,
        sessions: sessions.status === "fulfilled" ? sessions.value : prev.sessions,
      }))
      setErrors(
        results.flatMap((result, index) =>
          result.status === "rejected"
            ? [`${SECTION_LABELS[index]}: ${errorMessage(result.reason)}`]
            : [],
        ),
      )
      lastUpdatedRef.current = Date.now()
      setLastUpdated(lastUpdatedRef.current)
      setInitialLoading(false)
      setRefreshing(false)
    },
    [filters.startDate, filters.endDate, filters.days],
  )

  useEffect(() => {
    void load()

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load({ skipIfBusy: true })
    }, POLL_INTERVAL_MS)

    // Coming back from a hidden tab: refresh immediately if the data is stale.
    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastUpdatedRef.current > POLL_INTERVAL_MS
      ) {
        void load()
      }
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [load])

  return { data, errors, initialLoading, refreshing, lastUpdated, refresh: load }
}
