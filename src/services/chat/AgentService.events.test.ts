import { beforeEach, describe, expect, it, vi } from "vitest"

const stream = vi.hoisted(() => ({
  event: {} as Record<string, unknown>,
}))

vi.mock("./v2Stream", () => ({
  subscribeAgent: vi.fn((_sessionId, handlers, dispatch) => {
    dispatch(stream.event, handlers)
    return { promise: Promise.resolve(), close: vi.fn() }
  }),
  stopAgent: vi.fn(() => false),
}))

import { AgentClient } from "./AgentService"
import { diagnosticFixture, diagnosticFixtureError, timeoutDiagnosticFixture, timeoutDiagnosticFixtureError } from "./runDiagnostic.testFixtures"

describe("AgentClient session event routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stream.event = {
      type: "message_appended",
      session_id: "session-1",
      message_id: "queued-user",
      role: "user",
      correlation_id: "session-guidance",
      content: "apply this next",
      created_at: "2026-09-21T00:00:00Z",
    }
  })

  it.each([
    { role: "user", correlationId: "session-guidance", interjection: true },
    { role: "user", correlationId: "session-guidance-after-run:run-1", interjection: false },
    { role: "user", correlationId: undefined, interjection: false },
    { role: "assistant", correlationId: "session-guidance", interjection: false },
  ])("routes $role appends with correlation $correlationId", async ({ role, correlationId, interjection }) => {
    stream.event = { ...stream.event, role, correlation_id: correlationId }
    const onMessageAppended = vi.fn()

    await new AgentClient().subscribeToEvents("session-1", { onMessageAppended })

    expect(onMessageAppended).toHaveBeenCalledExactlyOnceWith(
      "session-1",
      "queued-user",
      interjection,
    )
  })

  it("retains the version on a full Task event for reconnect reconciliation", async () => {
    const taskList = {
      session_id: "work-child",
      title: "Worker handoff",
      items: [],
      created_at: "2026-11-07T02:39:39Z",
      updated_at: "2026-11-07T02:45:11Z",
    }
    stream.event = { type: "task_list_updated", task_list: taskList, version: 48 }
    const onTaskListUpdated = vi.fn()

    await new AgentClient().subscribeToEvents("work-child", { onTaskListUpdated })

    expect(onTaskListUpdated).toHaveBeenCalledExactlyOnceWith({ ...taskList, version: 48 })
  })

  it.each([
    { summary: "compressed context", messages_summarized: 8, tokens_saved: 1024 },
    { summary: "", messages_summarized: 0, tokens_saved: 0 },
  ])("routes a flat context summary receipt %j", async (expected) => {
    stream.event = {
      type: "context_summarized",
      ...expected,
      usage_before_percent: 82,
      usage_after_percent: 41,
      trigger_type: "manual",
      error: "private backend detail",
    }
    const onContextSummarized = vi.fn()
    const onTokenBudgetUpdated = vi.fn()
    const onContextCompressionStatus = vi.fn()
    const onError = vi.fn()

    await new AgentClient().subscribeToEvents("session-1", {
      onContextSummarized,
      onTokenBudgetUpdated,
      onContextCompressionStatus,
      onError,
    })

    expect(onContextSummarized).toHaveBeenCalledExactlyOnceWith(expected)
    expect(onTokenBudgetUpdated).not.toHaveBeenCalled()
    expect(onContextCompressionStatus).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it("retains the legacy nested receipt without forwarding extra fields", async () => {
    const expected = { summary: "legacy context", messages_summarized: 4, tokens_saved: 0 }
    stream.event = {
      type: "context_summarized",
      summary_info: { ...expected, usage_after_percent: 40, error: "private detail" },
    }
    const onContextSummarized = vi.fn()

    await new AgentClient().subscribeToEvents("session-1", { onContextSummarized })

    expect(onContextSummarized).toHaveBeenCalledExactlyOnceWith(expected)
  })

  it("delivers one legacy receipt when both payload forms are present", async () => {
    const expected = { summary: "legacy context", messages_summarized: 4, tokens_saved: 16 }
    stream.event = {
      type: "context_summarized",
      summary_info: expected,
      summary: "flat context",
      messages_summarized: 8,
      tokens_saved: 32,
    }
    const onContextSummarized = vi.fn()

    await new AgentClient().subscribeToEvents("session-1", { onContextSummarized })

    expect(onContextSummarized).toHaveBeenCalledExactlyOnceWith(expected)
  })

  const validSummary = { summary: "context", messages_summarized: 1, tokens_saved: 1 }
  const malformedPayloads: Array<[string, Record<string, unknown>]> = [
    ["missing summary", { messages_summarized: 1, tokens_saved: 1 }],
    ["non-string summary", { ...validSummary, summary: false }],
    ["missing message count", { summary: "context", tokens_saved: 1 }],
    ["missing token count", { summary: "context", messages_summarized: 1 }],
    ["negative message count", { ...validSummary, messages_summarized: -1 }],
    ["fractional message count", { ...validSummary, messages_summarized: 1.5 }],
    ["unsafe message count", { ...validSummary, messages_summarized: Number.MAX_SAFE_INTEGER + 1 }],
    ["negative token count", { ...validSummary, tokens_saved: -1 }],
    ["fractional token count", { ...validSummary, tokens_saved: 0.5 }],
    ["infinite token count", { ...validSummary, tokens_saved: Infinity }],
    ["NaN token count", { ...validSummary, tokens_saved: NaN }],
    ["string token count", { ...validSummary, tokens_saved: "1" }],
    ["null nested payload", { summary_info: null }],
    ["array nested payload", { summary_info: [] }],
    ["malformed nested counter", { summary_info: { ...validSummary, messages_summarized: "1" } }],
    ["invalid nested payload with otherwise valid flat fields", { ...validSummary, summary_info: {} }],
  ]

  it.each(malformedPayloads)("ignores malformed context summary: %s", async (_name, payload) => {
    stream.event = { type: "context_summarized", ...payload }
    const onContextSummarized = vi.fn()
    const onError = vi.fn()

    await new AgentClient().subscribeToEvents("session-1", { onContextSummarized, onError })

    expect(onContextSummarized).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})

describe("public v2 error diagnostics", () => {
  it("forwards a bound timeout receipt and rejects a timeout from another session", async () => {
    const onError = vi.fn()
    stream.event = { type:"error",message:timeoutDiagnosticFixtureError,diagnostic:timeoutDiagnosticFixture("session-1") }
    await new AgentClient().subscribeToEvents("session-1",{ onError })
    expect(onError).toHaveBeenCalledExactlyOnceWith(timeoutDiagnosticFixtureError,timeoutDiagnosticFixture("session-1"))
    onError.mockClear()
    stream.event = { ...stream.event,diagnostic:timeoutDiagnosticFixture("foreign") }
    await new AgentClient().subscribeToEvents("session-1",{ onError })
    expect(onError).toHaveBeenCalledExactlyOnceWith(timeoutDiagnosticFixtureError)
  })

  it("forwards exact scoped finite diagnostics while preserving the legacy one-argument callback", async () => {
    const onError = vi.fn()
    stream.event = { type:"error",message:diagnosticFixtureError,diagnostic:diagnosticFixture("session-1") }
    await new AgentClient().subscribeToEvents("session-1",{ onError })
    expect(onError).toHaveBeenLastCalledWith(diagnosticFixtureError,diagnosticFixture("session-1"))
    onError.mockClear(); stream.event = { type:"error",message:"legacy upstream timeout" }
    await new AgentClient().subscribeToEvents("session-1",{ onError })
    expect(onError).toHaveBeenCalledExactlyOnceWith("legacy upstream timeout")
  })
  it("rejects a foreign diagnostic and never routes an explicitly foreign error", async () => {
    const onError = vi.fn()
    stream.event = { type:"error",message:diagnosticFixtureError,diagnostic:diagnosticFixture("foreign") }
    await new AgentClient().subscribeToEvents("session-1",{ onError })
    expect(onError).toHaveBeenCalledExactlyOnceWith(diagnosticFixtureError)
    onError.mockClear(); stream.event = { type:"error",session_id:"foreign",message:diagnosticFixtureError,diagnostic:diagnosticFixture("foreign") }
    await new AgentClient().subscribeToEvents("session-1",{ onError })
    expect(onError).not.toHaveBeenCalled()
  })
})
