import { beforeEach, describe, expect, it, vi } from "vitest"
import { localTraces, parseTraceDetail, parseTracePage } from "./localTraces"

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock("@services/api", () => ({ apiClient: { get: mocks.get } }))

const traceId = "a".repeat(32), otherId = "c".repeat(32), spanId = "b".repeat(16)
const summary = { trace_id: traceId, started_at: "2026-10-29T10:00:00Z", ended_at: "2026-10-29T10:00:02Z",
  status: "success", span_count: 1, partial: false }
const page = { schema_version: 1, session_id: "session/a", collection_state: "enabled", traces: [summary],
  next_cursor: "opaque+next=?", retention: { max_spans: 2048, evicted_spans: null }, prompt: "PROMPT_SENTINEL" }
const span = { span_id: spanId, parent_span_id: null, kind: "llm", started_at: summary.started_at, ended_at: summary.ended_at,
  status: "success", model: "fixture-model", provider: "openai", name: "TOOL_BODY_SENTINEL", error_type: "KEY_SENTINEL",
  path: "/PRIVATE/PATH", usage: { input_tokens: 1200, output_tokens: null, reasoning_tokens: 0,
    cache_read_input_tokens: 0, cache_creation_input_tokens: null, cache_write_input_tokens: 24 } }
const detail = { schema_version: 1, session_id: "session/a", trace: { trace_id: traceId, partial: false, spans: [span] } }

beforeEach(() => mocks.get.mockReset())
describe("local trace v1 adapter", () => {
  it("uses the authenticated session route, encodes opaque cursors, and filters only the returned page", async () => {
    mocks.get.mockResolvedValue({ ...page, traces: [summary, { ...summary, trace_id: otherId, status: "cancelled" }] })
    const signal = new AbortController().signal
    const result = await localTraces.list("session/a", "cancelled", "opaque+next=?", signal)
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith("sessions/session%2Fa/traces?limit=50&cursor=opaque%2Bnext%3D%3F", { signal })
    expect(result.traces).toEqual([{ traceId: otherId, startedAt: summary.started_at, durationMs: 2000,
      status: "cancelled", spanCount: 1, partial: false }])
    expect(result.nextCursor).toBe("opaque+next=?")
    expect(result.retention).toEqual({ maxSpans: 2048, evictedSpans: null })
    expect(JSON.stringify(result)).not.toContain("PROMPT_SENTINEL")
  })

  it("projects allowlisted detail, keeps null distinct from zero, and omits content and paths", async () => {
    mocks.get.mockResolvedValue(detail)
    const signal = new AbortController().signal
    const result = await localTraces.detail("session/a", traceId, signal)
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(`sessions/session%2Fa/traces/${traceId}`, { signal })
    expect(result.spans[0]).toEqual({ spanId, parentSpanId: null, kind: "model", startedAt: summary.started_at,
      durationMs: 2000, status: "ok", model: "fixture-model", provider: "openai",
      usage: { input: 1200, output: null, reasoning: 0, cacheRead: 0, cacheCreation: null, cacheWrite: 24 } })
    const serialized = JSON.stringify(result)
    for (const secret of ["TOOL_BODY_SENTINEL", "KEY_SENTINEL", "/PRIVATE/PATH"]) expect(serialized).not.toContain(secret)
  })

  it("keeps malformed or absent measurements unknown and rejects unsafe model identifiers", () => {
    const response = { ...detail, trace: { ...detail.trace, partial: true, spans: [{ ...span, model: "/private/path",
      status: "future-status", ended_at: "not a date", usage: { input_tokens: -1, output_tokens: 0 } }] } }
    const parsed = parseTraceDetail(response, "session/a", traceId)
    expect(parsed.partial).toBe(true)
    expect(parsed.spans[0]).toMatchObject({ model: null, status: "unset", durationMs: null,
      usage: { input: null, output: 0, reasoning: null, cacheRead: null, cacheCreation: null, cacheWrite: null } })
  })

  it("rejects unsupported schemas, foreign sessions, malformed identifiers, duplicate spans and foreign detail", () => {
    expect(() => parseTracePage({ ...page, schema_version: 2 }, "session/a", "all")).toThrow()
    expect(() => parseTracePage({ ...page, session_id: "another" }, "session/a", "all")).toThrow()
    expect(() => parseTracePage({ ...page, traces: [{ ...summary, trace_id: "../../private" }] }, "session/a", "all")).toThrow()
    expect(() => parseTraceDetail({ ...detail, session_id: "another" }, "session/a", traceId)).toThrow()
    expect(() => parseTraceDetail({ ...detail, trace: { ...detail.trace, trace_id: otherId } }, "session/a", traceId)).toThrow()
    expect(() => parseTraceDetail({ ...detail, trace: { ...detail.trace, spans: [span, span] } }, "session/a", traceId)).toThrow()
  })
})
