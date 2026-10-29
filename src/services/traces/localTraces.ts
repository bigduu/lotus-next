import { apiClient } from "@services/api"

/** A strict projection of the versioned local trace contract, not arbitrary span attributes. */
export type TraceStatus = "ok" | "error" | "cancelled" | "unset"
export type SpanKind = "agent" | "model" | "tool" | "other"
export type TraceFilter = "all" | TraceStatus

export type TraceUsage = {
  input: number | null
  output: number | null
  reasoning: number | null
  cacheRead: number | null
  cacheCreation: number | null
  cacheWrite: number | null
}

export type TraceSummary = {
  traceId: string
  startedAt: string | null
  durationMs: number | null
  status: TraceStatus
  spanCount: number | null
  partial: boolean
}

export type TraceSpan = {
  spanId: string
  parentSpanId: string | null
  kind: SpanKind
  startedAt: string | null
  durationMs: number | null
  status: TraceStatus
  model: string | null
  provider: string | null
  usage: TraceUsage | null
}

export type TraceDetail = { traceId: string; partial: boolean; spans: TraceSpan[] }
export type TracePage = {
  availability: "enabled" | "disabled" | "unsupported"
  coverage: "best_effort" | "unknown"
  traces: TraceSummary[]
  nextCursor: string | null
  retention: { maxSpans: number | null; evictedSpans: number | null } | null
}

/** An adapter must enforce session authority and project allowlisted metadata only. */
export type LocalTraceSource = {
  list(sessionId: string, filter: TraceFilter, cursor: string | null, signal: AbortSignal): Promise<TracePage>
  detail(sessionId: string, traceId: string, signal: AbortSignal): Promise<TraceDetail>
}

function invalid(): never { throw new Error("Invalid local trace response") }
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid()
}
function id(value: unknown, length: number): string {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`).test(value) ? value : invalid()
}
function numberOrNull(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null
}
function identifier(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9_.-]{1,128}$/.test(value) ? value : null
}
function timestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null
}
function duration(startedAt: string | null, endedAt: string | null): number | null {
  if (!startedAt || !endedAt) return null
  const value = Date.parse(endedAt) - Date.parse(startedAt)
  return Number.isFinite(value) && value >= 0 ? value : null
}
function status(value: unknown): TraceStatus {
  return value === "success" ? "ok" : value === "error" || value === "cancelled" ? value : "unset"
}
function partial(value: unknown): boolean { return typeof value === "boolean" ? value : invalid() }
function sessionEnvelope(value: unknown, sessionId: string): Record<string, unknown> {
  const raw = record(value)
  if (raw.schema_version !== 1 || raw.session_id !== sessionId) invalid()
  return raw
}
function parseSummary(value: unknown): TraceSummary {
  const raw = record(value), startedAt = timestamp(raw.started_at)
  return { traceId: id(raw.trace_id, 32), startedAt, durationMs: duration(startedAt, timestamp(raw.ended_at)),
    status: status(raw.status), spanCount: numberOrNull(raw.span_count), partial: partial(raw.partial) }
}
function parseUsage(value: unknown): TraceUsage | null {
  if (value === null || value === undefined) return null
  const raw = record(value)
  return { input: numberOrNull(raw.input_tokens), output: numberOrNull(raw.output_tokens),
    reasoning: numberOrNull(raw.reasoning_tokens), cacheRead: numberOrNull(raw.cache_read_input_tokens),
    cacheCreation: numberOrNull(raw.cache_creation_input_tokens), cacheWrite: numberOrNull(raw.cache_write_input_tokens) }
}
function parseSpan(value: unknown): TraceSpan {
  const raw = record(value), startedAt = timestamp(raw.started_at)
  const kind: SpanKind = raw.kind === "llm" ? "model" : raw.kind === "agent" || raw.kind === "tool" ? raw.kind : "other"
  return { spanId: id(raw.span_id, 16), parentSpanId: raw.parent_span_id === null ? null : id(raw.parent_span_id, 16),
    kind, startedAt, durationMs: duration(startedAt, timestamp(raw.ended_at)), status: status(raw.status),
    model: identifier(raw.model), provider: identifier(raw.provider), usage: parseUsage(raw.usage) }
}
export function parseTracePage(value: unknown, sessionId: string, filter: TraceFilter): TracePage {
  const raw = sessionEnvelope(value, sessionId)
  if ((raw.collection_state !== "enabled" && raw.collection_state !== "disabled") || !Array.isArray(raw.traces) || raw.traces.length > 50) invalid()
  const traces = raw.traces.map(parseSummary)
  if (new Set(traces.map((trace) => trace.traceId)).size !== traces.length) invalid()
  const nextCursor = raw.next_cursor === null ? null : typeof raw.next_cursor === "string" && raw.next_cursor.length > 0 && raw.next_cursor.length <= 2048 ? raw.next_cursor : invalid()
  const retention = record(raw.retention)
  return { availability: raw.collection_state, coverage: raw.coverage === "best_effort" ? "best_effort" : "unknown",
    traces: filter === "all" ? traces : traces.filter((trace) => trace.status === filter), nextCursor,
    retention: { maxSpans: numberOrNull(retention.max_spans), evictedSpans: numberOrNull(retention.evicted_spans) } }
}
export function parseTraceDetail(value: unknown, sessionId: string, traceId: string): TraceDetail {
  const raw = sessionEnvelope(value, sessionId), trace = record(raw.trace)
  if (trace.trace_id !== traceId || !Array.isArray(trace.spans) || trace.spans.length > 2048) invalid()
  const spans = trace.spans.map(parseSpan)
  if (new Set(spans.map((span) => span.spanId)).size !== spans.length) invalid()
  return { traceId, partial: partial(trace.partial), spans }
}
function route(sessionId: string, traceId?: string): string {
  if (!sessionId.trim()) invalid()
  return `sessions/${encodeURIComponent(sessionId)}/traces${traceId === undefined ? "" : `/${id(traceId, 32)}`}`
}

/** Uses the existing authenticated client. The status filter applies to this page only. */
export const localTraces: LocalTraceSource = {
  async list(sessionId, filter, cursor, signal) {
    const query = new URLSearchParams({ limit: "50" })
    if (cursor !== null) query.set("cursor", cursor)
    return parseTracePage(await apiClient.get<unknown>(`${route(sessionId)}?${query}`, { signal }), sessionId, filter)
  },
  async detail(sessionId, traceId, signal) {
    return parseTraceDetail(await apiClient.get<unknown>(route(sessionId, traceId), { signal }), sessionId, traceId)
  },
}
