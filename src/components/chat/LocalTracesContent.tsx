import { useEffect, useMemo, useState } from "react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { localTraces, type LocalTraceSource, type TraceDetail, type TraceFilter, type TracePage,
  type TraceSpan, type TraceStatus, type TraceSummary, type TraceUsage } from "@services/traces/localTraces"
import "./LocalTracesContent.css"

const statusText = (status: TraceStatus) => uiText(`local_trace_status_${status}`)
const kindText = (kind: TraceSpan["kind"]) => uiText(`local_trace_kind_${kind}`)
const statusColor: Record<TraceStatus, string> = {
  ok: "bg-emerald-600 dark:bg-emerald-500", error: "bg-destructive", cancelled: "bg-amber-500", unset: "bg-muted-foreground",
}
const unknown = () => uiText("local_trace_unknown")

function duration(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value) || value < 0) return unknown()
  if (value < 1000) return uiText("local_trace_milliseconds", { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value) })
  return uiText("local_trace_seconds", { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1000) })
}
function dateTime(value: string | null, locale: string): string {
  const date = value === null ? NaN : Date.parse(value)
  return Number.isFinite(date) ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(date) : unknown()
}
function count(value: number | null, locale: string): string {
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? new Intl.NumberFormat(locale).format(value) : unknown()
}

type Row = { span: TraceSpan; depth: number; missingParent: boolean }
/** Render roots, orphans and malformed cycles once each, without inventing parents. */
function orderSpans(spans: TraceSpan[]): Row[] {
  const ids = new Set(spans.map((span) => span.spanId))
  const children = new Map<string | null, TraceSpan[]>()
  for (const span of spans) {
    const parent = span.parentSpanId && ids.has(span.parentSpanId) ? span.parentSpanId : null
    const bucket = children.get(parent) ?? []
    bucket.push(span)
    children.set(parent, bucket)
  }
  const rows: Row[] = [], seen = new Set<string>()
  const visit = (root: TraceSpan, missingParent: boolean) => {
    const pending: Row[] = [{ span: root, depth: 0, missingParent }]
    while (pending.length) {
      const row = pending.pop()!
      if (seen.has(row.span.spanId)) continue
      seen.add(row.span.spanId)
      rows.push(row)
      for (const child of [...(children.get(row.span.spanId) ?? [])].reverse()) {
        pending.push({ span: child, depth: row.depth + 1, missingParent: false })
      }
    }
  }
  for (const span of children.get(null) ?? []) visit(span, span.parentSpanId !== null)
  for (const span of spans) if (!seen.has(span.spanId)) visit(span, true)
  return rows
}

function Status({ status }: { status: TraceStatus }) {
  return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
    <span aria-hidden className={cn("size-1.5 rounded-full", statusColor[status])} />{statusText(status)}
  </span>
}

function TraceListItem({ trace, selected, onSelect, locale }: { trace: TraceSummary; selected: boolean; onSelect: () => void; locale: string }) {
  return <button type="button" aria-pressed={selected} onClick={onSelect}
    className={cn("local-trace-item w-full rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-accent",
      selected && "border-primary bg-accent")}>
    <span className="flex items-start justify-between gap-2">
      <span className="text-xs font-medium">{dateTime(trace.startedAt, locale)}</span><Status status={trace.status} />
    </span>
    <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>{uiText("local_trace_duration")}: {duration(trace.durationMs, locale)}</span>
      <span>{uiText("local_trace_spans")}: {count(trace.spanCount, locale)}</span>
      {trace.partial ? <span>{uiText("local_trace_partial")}</span> : null}
    </span>
  </button>
}

function Waterfall({ trace, detail, selectedSpan, onSelect, locale }: {
  trace: TraceSummary; detail: TraceDetail; selectedSpan: string | null; onSelect: (id: string) => void; locale: string
}) {
  const rows = useMemo(() => orderSpans(detail.spans), [detail.spans])
  const traceStart = trace.startedAt === null ? NaN : Date.parse(trace.startedAt)
  const traceDuration = trace.durationMs
  return <section aria-label={uiText("local_trace_waterfall")} className="min-w-0 space-y-2">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{uiText("local_trace_waterfall")}</h3>
      <span className="text-xs text-muted-foreground">{duration(traceDuration, locale)}</span></div>
    {!rows.length ? <p className="rounded-lg border p-3 text-xs text-muted-foreground">{uiText("local_trace_no_spans")}</p> : null}
    <div className="space-y-1">
      {rows.map(({ span, depth, missingParent }) => {
        const start = span.startedAt === null ? NaN : Date.parse(span.startedAt)
        const canPlace = Number.isFinite(traceStart) && Number.isFinite(start) && traceDuration !== null && traceDuration > 0
          && span.durationMs !== null && Number.isFinite(span.durationMs) && span.durationMs >= 0
        const left = canPlace ? Math.min(100, Math.max(0, (start - traceStart) / traceDuration * 100)) : 0
        const width = canPlace ? Math.min(100 - left, Math.max(1, span.durationMs! / traceDuration! * 100)) : 0
        return <button key={span.spanId} type="button" aria-pressed={selectedSpan === span.spanId}
          onClick={() => onSelect(span.spanId)} className={cn("local-trace-item w-full rounded-lg border px-3 py-2 text-left hover:bg-accent",
            selectedSpan === span.spanId && "border-primary bg-accent")}>
          <span className="flex items-center justify-between gap-2" style={{ paddingInlineStart: `${Math.min(depth, 5) * 12}px` }}>
            <span className="min-w-0 text-xs font-medium">{depth > 0 ? <span aria-hidden className="mr-1 text-muted-foreground">↳</span> : null}
              {kindText(span.kind)}{missingParent ? <span className="ml-1.5 font-normal text-muted-foreground">{uiText("local_trace_parent_unavailable")}</span> : null}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{duration(span.durationMs, locale)}</span>
          </span>
          <span aria-hidden className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted">
            {canPlace ? <span className={cn("block h-full rounded-full", statusColor[span.status])} style={{ marginInlineStart: `${left}%`, width: `${width}%` }} /> : null}
          </span>
        </button>
      })}
    </div>
  </section>
}

function Usage({ usage, locale }: { usage: TraceUsage | null; locale: string }) {
  const fields: [keyof TraceUsage, string][] = [
    ["input", uiText("local_trace_input")], ["output", uiText("local_trace_output")], ["reasoning", uiText("local_trace_reasoning")],
    ["cacheRead", uiText("local_trace_cache_read")], ["cacheCreation", uiText("local_trace_cache_creation")],
    ["cacheWrite", uiText("local_trace_cache_write")],
  ]
  return <section className="space-y-2" aria-label={uiText("local_trace_usage")}>
    <h4 className="text-xs font-semibold">{uiText("local_trace_usage")}</h4>
    <dl className="grid grid-cols-2 gap-2 text-xs">
      {fields.map(([key, label]) => <div key={key}><dt className="text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 tabular-nums">{count(usage?.[key] ?? null, locale)}</dd></div>)}
    </dl>
    <p className="text-xs leading-relaxed text-muted-foreground">{uiText("local_trace_usage_hint")}</p>
  </section>
}

function SpanDetails({ span, locale }: { span: TraceSpan; locale: string }) {
  return <section aria-label={uiText("local_trace_span_details")} className="space-y-4 rounded-xl border bg-muted/20 p-3">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{uiText("local_trace_span_details")}</h3><Status status={span.status} /></div>
    <dl className="grid grid-cols-2 gap-3 text-xs">
      <div><dt className="text-muted-foreground">{uiText("local_trace_kind")}</dt><dd className="mt-0.5">{kindText(span.kind)}</dd></div>
      <div><dt className="text-muted-foreground">{uiText("local_trace_duration")}</dt><dd className="mt-0.5">{duration(span.durationMs, locale)}</dd></div>
      <div style={{ gridColumn: "span 2 / span 2" }}><dt className="text-muted-foreground">{uiText("local_trace_started")}</dt><dd className="mt-0.5">{dateTime(span.startedAt, locale)}</dd></div>
      <div><dt className="text-muted-foreground">{uiText("local_trace_model")}</dt><dd className="mt-0.5 break-words">{span.model ?? unknown()}</dd></div>
      <div><dt className="text-muted-foreground">{uiText("local_trace_provider")}</dt><dd className="mt-0.5 break-words">{span.provider ?? unknown()}</dd></div>
    </dl>
    <div className="border-t pt-3"><Usage usage={span.usage} locale={locale} /></div>
  </section>
}

type PageState = { key: string; page?: TracePage; error?: true }
type DetailState = { id: string; detail?: TraceDetail; error?: true }

export function LocalTracesContent({ sessionId, source = localTraces }: { sessionId: string; source?: LocalTraceSource }) {
  // A fresh session component also fences state before effects run after navigation.
  return <TraceSession key={sessionId} sessionId={sessionId} source={source} />
}

function TraceSession({ sessionId, source }: { sessionId: string; source: LocalTraceSource }) {
  const locale = useUiLocale()
  const [filter, setFilter] = useState<TraceFilter>("all")
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [pageIndex, setPageIndex] = useState(0)
  const [revision, setRevision] = useState(0)
  const [pageState, setPageState] = useState<PageState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailState, setDetailState] = useState<DetailState | null>(null)
  const [selectedSpan, setSelectedSpan] = useState<string | null>(null)
  const cursor = cursors[pageIndex]
  const key = JSON.stringify([filter, cursor, revision])
  const page = pageState?.key === key ? pageState.page : undefined
  const loading = pageState?.key !== key || (!pageState.page && !pageState.error)
  const selectedTrace = page?.traces.find((trace) => trace.traceId === selectedId)
  const detail = selectedTrace && detailState?.id === selectedTrace.traceId ? detailState.detail : undefined
  const selected = detail?.spans.find((span) => span.spanId === selectedSpan)

  useEffect(() => {
    const controller = new AbortController()
    setPageState({ key })
    setSelectedId(null)
    setDetailState(null)
    setSelectedSpan(null)
    void source.list(sessionId, filter, cursor, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setPageState({ key, page: result })
      setSelectedId(result.availability === "enabled" ? result.traces[0]?.traceId ?? null : null)
    }).catch(() => { if (!controller.signal.aborted) setPageState({ key, error: true }) })
    return () => controller.abort()
  }, [source, sessionId, filter, cursor, key])

  useEffect(() => {
    if (!selectedTrace) return
    const controller = new AbortController(), id = selectedTrace.traceId
    setDetailState({ id })
    setSelectedSpan(null)
    void source.detail(sessionId, id, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.traceId !== id) { setDetailState({ id, error: true }); return }
      setDetailState({ id, detail: result })
      setSelectedSpan(result.spans[0]?.spanId ?? null)
    }).catch(() => { if (!controller.signal.aborted) setDetailState({ id, error: true }) })
    return () => controller.abort()
  }, [source, sessionId, selectedTrace])

  const changeFilter = (value: TraceFilter) => { setFilter(value); setCursors([null]); setPageIndex(0) }
  const refresh = () => { setCursors([null]); setPageIndex(0); setRevision((value) => value + 1) }
  return <div className="min-h-0 overflow-y-auto px-5 py-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">{uiText("local_trace_hint")}</p>
      <Button size="sm" variant="outline" disabled={loading} onClick={refresh}>{uiText("local_trace_refresh")}</Button>
    </div>
    <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
      <label className="space-y-1 text-xs"><span className="block font-medium">{uiText("local_trace_filter")}</span>
        <select value={filter} onChange={(event) => changeFilter(event.target.value as TraceFilter)}
          className="h-9 rounded-md border bg-background px-2 text-sm" style={{ minWidth: "9rem" }}>
          <option value="all">{uiText("local_trace_filter_all")}</option>
          <option value="ok">{statusText("ok")}</option><option value="error">{statusText("error")}</option>
          <option value="cancelled">{statusText("cancelled")}</option>
          <option value="unset">{statusText("unset")}</option>
        </select>
      </label>
      {page?.availability === "enabled" ? <p className="text-xs text-muted-foreground">
        {page.retention?.maxSpans !== null && page.retention?.maxSpans !== undefined
          ? uiText("local_trace_retention", { max: count(page.retention.maxSpans, locale), evicted: count(page.retention.evictedSpans, locale) })
          : uiText("local_trace_retention_unknown")}
      </p> : null}
    </div>
    {loading ? <p role="status" className="py-6 text-sm text-muted-foreground">{uiText("local_trace_loading")}</p> : null}
    {pageState?.key === key && pageState.error ? <p role="alert" className="py-6 text-sm text-destructive">{uiText("local_trace_error")}</p> : null}
    {page?.availability === "unsupported" ? <p className="py-6 text-sm text-muted-foreground">{uiText("local_trace_unsupported")}</p> : null}
    {page?.availability === "disabled" ? <p className="py-6 text-sm text-muted-foreground">{uiText("local_trace_disabled")}</p> : null}
    {page?.availability === "enabled" ? <p className="mt-3 text-xs text-muted-foreground">{uiText(page.coverage === "best_effort" ? "local_trace_coverage_best_effort" : "local_trace_coverage_unknown")}</p> : null}
    {page?.availability === "enabled" && !page.traces.length ? <p className="py-6 text-sm text-muted-foreground">{uiText("local_trace_empty")}</p> : null}
    {page?.availability === "enabled" && page.traces.length > 0 ? <div className="local-trace-grid mt-4 grid min-w-0 gap-4">
      <section aria-label={uiText("local_trace_list")} className="min-w-0 space-y-2">
        <h3 className="text-sm font-semibold">{uiText("local_trace_list")}</h3>
        {page.traces.map((trace) => <TraceListItem key={trace.traceId} trace={trace} selected={selectedId === trace.traceId}
          onSelect={() => setSelectedId(trace.traceId)} locale={locale} />)}
      </section>
      {selectedTrace ? <div className="min-w-0">
        {!detail && (detailState?.id !== selectedTrace.traceId || !detailState.error) ? <p role="status" className="text-sm text-muted-foreground">{uiText("local_trace_detail_loading")}</p> : null}
        {detailState?.id === selectedTrace.traceId && detailState.error ? <p role="alert" className="text-sm text-destructive">{uiText("local_trace_detail_error")}</p> : null}
        {detail?.partial ? <p className="mb-2 text-xs text-muted-foreground">{uiText("local_trace_partial_hint")}</p> : null}
        {detail ? <div className="local-span-grid grid min-w-0 gap-4">
          <Waterfall trace={selectedTrace} detail={detail} selectedSpan={selectedSpan} onSelect={setSelectedSpan} locale={locale} />
          {selected ? <SpanDetails span={selected} locale={locale} /> : null}
        </div> : null}
      </div> : null}
    </div> : null}
    {page?.availability === "enabled" && (pageIndex > 0 || page.nextCursor) ? <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
      <Button size="sm" variant="outline" disabled={pageIndex === 0} onClick={() => setPageIndex((value) => value - 1)}>{uiText("local_trace_previous")}</Button>
      <span className="text-xs text-muted-foreground">{uiText("local_trace_page", { page: pageIndex + 1 })}</span>
      <Button size="sm" variant="outline" disabled={!page.nextCursor} onClick={() => {
        if (page.nextCursor) { setCursors((current) => [...current.slice(0, pageIndex + 1), page.nextCursor]); setPageIndex((value) => value + 1) }
      }}>{uiText("local_trace_next")}</Button>
    </div> : null}
  </div>
}
