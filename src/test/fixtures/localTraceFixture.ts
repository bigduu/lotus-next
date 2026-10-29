import type { LocalTraceSource, TraceDetail, TracePage, TraceSummary } from "@services/traces/localTraces"

/** Synthetic presentation fixture only; it is not an OTLP or Bamboo response. */
export const fixtureTrace: TraceSummary = {
  traceId: "fixture-trace-1", startedAt: "2026-10-29T10:00:00Z", durationMs: 2400, status: "ok", spanCount: 3, partial: false,
}
export const fixtureTraceDetail: TraceDetail = {
  traceId: fixtureTrace.traceId,
  partial: false,
  spans: [
    { spanId: "agent", parentSpanId: null, kind: "agent", startedAt: "2026-10-29T10:00:00Z", durationMs: 2400,
      status: "ok", model: null, provider: null, usage: null },
    { spanId: "model", parentSpanId: "agent", kind: "model", startedAt: "2026-10-29T10:00:00.150Z", durationMs: 1650,
      status: "ok", model: "fixture-model", provider: "fixture-provider",
      usage: { input: 1250, output: null, reasoning: null, cacheRead: 0, cacheCreation: null, cacheWrite: 24 } },
    { spanId: "tool", parentSpanId: "agent", kind: "tool", startedAt: "2026-10-29T10:00:01.850Z", durationMs: 350,
      status: "ok", model: null, provider: null, usage: null },
  ],
}
export const fixturePage: TracePage = {
  availability: "enabled", traces: [fixtureTrace], nextCursor: null,
  retention: { maxSpans: 2048, evictedSpans: 0 },
}
export const fixtureTraceSource: LocalTraceSource = {
  async list(_sessionId, filter) {
    return { ...fixturePage, traces: filter === "all" || filter === "ok" ? fixturePage.traces : [] }
  },
  async detail() { return fixtureTraceDetail },
}
