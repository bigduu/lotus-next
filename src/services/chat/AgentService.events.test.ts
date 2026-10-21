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

describe("AgentClient session event routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stream.event = {
      type: "message_appended",
      session_id: "session-1",
      message_id: "queued-user",
      role: "user",
      content: "apply this next",
      created_at: "2026-09-21T00:00:00Z",
    }
  })

  it("routes an admitted queued message instead of treating it as unknown", async () => {
    const onMessageAppended = vi.fn()

    await new AgentClient().subscribeToEvents("session-1", { onMessageAppended })

    expect(onMessageAppended).toHaveBeenCalledExactlyOnceWith(
      "session-1",
      "queued-user",
    )
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
