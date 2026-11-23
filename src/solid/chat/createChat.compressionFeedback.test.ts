import { createEffect } from "solid-js"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { agentClient, type ContextSummaryInfo, type TokenBudgetUsage } from "@services/chat/AgentService"
import { appStore } from "@shared/store/appStore/state"
import { providerStore } from "@shared/store/appStore/slices/providerState"
import type { ContextCompressionFeedback } from "@/lib/contextCompression"
import { settleChat } from "./chatInteractionTestHarness"
import { deferred, feedSessions, history, queueStream, savedSession, session, useChatStreamFixture,
  type Chat } from "./chatStreamTestHarness"

const mount = useChatStreamFixture()

const summary: ContextSummaryInfo = {
  summary: "Synthetic summary receipt; not a replacement token budget",
  messages_summarized: 14,
  tokens_saved: 270_000,
}
const budget = (totalTokens = 288_000): TokenBudgetUsage => ({
  system_tokens: 8_000,
  summary_tokens: 0,
  window_tokens: totalTokens - 8_000,
  total_tokens: totalTokens,
  max_context_tokens: 320_000,
  budget_limit: 300_000,
  truncation_occurred: false,
  segments_removed: 0,
})
const storedUsage = (id: string) => appStore.getState().tokenUsages[id]

function send(chat: Chat, text: string) {
  return settleChat(async () => { await expect(chat.send(text)).resolves.toMatchObject({ kind: "accepted" }) })
}

async function mountCompressionRun(observe?: (chat: Chat) => void) {
  const sessionId = "synthetic-compression-session"
  feedSessions([session(sessionId)])
  const stream = queueStream(sessionId, null)
  const pane = await mount(sessionId, { observe })
  await send(pane.chat, "synthetic compression lifecycle")
  return { pane, stream, sessionId }
}

beforeEach(() => {
  const modelRef = { provider: "test-provider", model: "test-model" }
  appStore.setState({ selectedModel: modelRef })
  providerStore.setState({ ...providerStore.getInitialState(), providerSnapshot: {
    default_provider_instance_id: modelRef.provider,
    instances: [{ id: modelRef.provider, type: "openai", label: "Test", enabled: true, config: { runtime_models: [modelRef.model] } }],
    defaults: { chat: modelRef },
  } }, true)
  vi.spyOn(appStore.getState(), "updateTokenUsage")
  vi.spyOn(appStore.getState(), "setTruncationInfo")
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("Solid context compression feedback", () => {
  it.each([
    { status: "failed_candidate_plan:synthetic candidate diagnostic", expected: { status: "failed", reason: "candidate_plan" } },
    { status: "deferred_tool_protocol", expected: { status: "deferred", reason: "tool_protocol" } },
  ])("retains pre-start $status without claiming a running compressor", async ({ status, expected }) => {
    const rendered: Array<ContextCompressionFeedback | null> = []
    const { pane, stream } = await mountCompressionRun((chat) => {
      createEffect(() => chat.contextCompression, (feedback) => { rendered.push(feedback) })
    })
    expect(pane.chat.contextCompression).toBeNull()
    await settleChat(() => { stream.handlers.onContextCompressionStatus("preflight", status) })
    expect(pane.chat.contextCompression).toEqual(expected)
    expect(pane.chat.streamStatus).toBeNull()
    await settleChat(() => {
      stream.handlers.onContextCompressionStatus("preflight", "map:1/3 input=180000 output=4000 safe=200000 model_limit=320000")
      stream.handlers.onToken("ordinary assistant text")
    })
    expect(pane.chat.contextCompression).toEqual(expected)
    expect(rendered.some((feedback) => feedback?.status === "running")).toBe(false)
    expect(appStore.getState().updateTokenUsage).not.toHaveBeenCalled()
    expect(appStore.getState().setTruncationInfo).not.toHaveBeenCalled()
  })

  it("retains a started compressor through map/reduce progress and ordinary tokens", async () => {
    const { pane, stream } = await mountCompressionRun()
    await settleChat(() => { stream.handlers.onContextCompressionStatus("preflight", "started") })
    expect(pane.chat.contextCompression).toEqual({ status: "running" })
    for (const progress of [
      "map:1/3 input=180000 output=4000 safe=200000 model_limit=320000",
      "reduce:1/1 input=12000 output=4000 safe=200000 model_limit=320000",
    ]) {
      await settleChat(() => {
        stream.handlers.onContextCompressionStatus("preflight", progress)
        stream.handlers.onToken("more ordinary text")
      })
      expect(pane.chat.contextCompression).toEqual({ status: "running" })
    }
    expect(appStore.getState().updateTokenUsage).not.toHaveBeenCalled()
  })

  it.each(["status", "summary"] as const)("waits for actual budget usage after a paired %s receipt without changing the meter", async (receipt) => {
    const { pane, stream, sessionId } = await mountCompressionRun()
    await settleChat(() => { stream.handlers.onTokenBudgetUpdated(budget()) })
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 288_000, maxContextTokens: 320_000, budgetLimit: 300_000 })
    const originalUsage = structuredClone(storedUsage(sessionId))
    await settleChat(() => {
      stream.handlers.onContextCompressionStatus("preflight", "started")
      if (receipt === "status") stream.handlers.onContextCompressionStatus("preflight", "completed")
      else stream.handlers.onContextSummarized(summary)
    })
    expect(pane.chat.contextCompression).toEqual({ status: "completed", awaitingUsage: true })
    expect(storedUsage(sessionId)).toEqual(originalUsage)
    expect(appStore.getState().updateTokenUsage).toHaveBeenCalledTimes(1)
    expect(appStore.getState().setTruncationInfo).toHaveBeenCalledExactlyOnceWith(sessionId, false, 0)
    await settleChat(() => { stream.handlers.onToken("the answer continues before a new budget") })
    expect(pane.chat.contextCompression).toEqual({ status: "completed", awaitingUsage: true })
    await settleChat(() => { stream.handlers.onTokenBudgetUpdated(budget(256_000)) })
    expect(pane.chat.contextCompression).toEqual({ status: "completed", awaitingUsage: false })
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 256_000, maxContextTokens: 320_000, budgetLimit: 300_000 })
    expect(appStore.getState().updateTokenUsage).toHaveBeenCalledTimes(2)
    await settleChat(() => {
      stream.handlers.onContextSummarized(summary)
      stream.handlers.onContextCompressionStatus("preflight", "completed")
    })
    expect(pane.chat.contextCompression).toEqual({ status: "completed", awaitingUsage: false })
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 256_000, maxContextTokens: 320_000, budgetLimit: 300_000 })
    expect(appStore.getState().updateTokenUsage).toHaveBeenCalledTimes(2)
  })

  it.each(["status", "summary"] as const)("treats an unpaired %s receipt as unconfirmed rather than successful", async (receipt) => {
    const { pane, stream, sessionId } = await mountCompressionRun()
    await settleChat(() => { stream.handlers.onTokenBudgetUpdated(budget()) })
    await settleChat(() => {
      if (receipt === "status") stream.handlers.onContextCompressionStatus("preflight", "completed")
      else stream.handlers.onContextSummarized(summary)
    })
    expect(pane.chat.contextCompression).toEqual({ status: "unconfirmed" })
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 288_000, maxContextTokens: 320_000 })
    expect(appStore.getState().updateTokenUsage).toHaveBeenCalledTimes(1)
    await settleChat(() => { stream.handlers.onTokenBudgetUpdated(budget(256_000)) })
    expect(pane.chat.contextCompression).toEqual({ status: "unconfirmed" })
  })

  it.each(["local stop", "cancelled event"] as const)("distinguishes %s from confirmed summary cancellation and rejects queued callbacks", async (ending) => {
    vi.mocked(agentClient.stopGeneration).mockResolvedValue(undefined)
    const { pane, stream, sessionId } = await mountCompressionRun()
    await settleChat(() => {
      stream.handlers.onTokenBudgetUpdated(budget())
      stream.handlers.onContextCompressionStatus("preflight", "started")
    })
    expect(pane.chat.contextCompression).toEqual({ status: "running" })
    await settleChat(() => {
      if (ending === "local stop") pane.chat.stop()
      else { stream.handlers.onCancelled(); stream.subscription.resolve() }
    })
    const expected = { status: ending === "local stop" ? "unconfirmed" : "cancelled" }
    expect(pane.chat.contextCompression).toEqual(expected)
    if (ending === "local stop") expect(stream.controller.signal.aborted).toBe(true)
    await settleChat(() => {
      stream.handlers.onContextCompressionStatus("preflight", "started")
      stream.handlers.onContextCompressionStatus("preflight", "completed")
      stream.handlers.onContextSummarized(summary)
      stream.handlers.onTokenBudgetUpdated(budget(128_000))
    })
    expect(pane.chat.contextCompression).toEqual(expected)
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 288_000, maxContextTokens: 320_000, budgetLimit: 300_000 })
    expect(appStore.getState().updateTokenUsage).toHaveBeenCalledTimes(1)
    expect(appStore.getState().setTruncationInfo).toHaveBeenCalledTimes(1)
  })

  it.each(["pending", "rejected"] as const)("does not confirm summary cancellation from a %s Stop request", async (outcome) => {
    const request = deferred<void>()
    vi.mocked(agentClient.stopGeneration).mockReturnValueOnce(request.promise)
    const { pane, stream } = await mountCompressionRun()
    await settleChat(() => {
      stream.handlers.onContextCompressionStatus("preflight", "started")
      pane.chat.stop()
    })
    expect(pane.chat.contextCompression).toEqual({ status: "unconfirmed" })
    expect(stream.controller.signal.aborted).toBe(true)
    expect(agentClient.stopGeneration).toHaveBeenCalledOnce()
    await settleChat(() => {
      if (outcome === "rejected") request.reject(new Error("synthetic Stop transport failure"))
      else request.resolve()
    })
    expect(pane.chat.contextCompression).toEqual({ status: "unconfirmed" })
  })

  it.each(["complete", "error"] as const)("does not infer compression success when the run ends by %s while compression is still running", async (ending) => {
    const { pane, stream } = await mountCompressionRun()
    await settleChat(() => { stream.handlers.onContextCompressionStatus("preflight", "started") })
    const terminalHistory = deferred<void>()
    history().mockReturnValueOnce(terminalHistory.promise)
    await settleChat(() => {
      if (ending === "complete") stream.handlers.onComplete(undefined)
      else stream.handlers.onError("synthetic generation error")
      stream.subscription.resolve()
    })
    expect(pane.chat.contextCompression).toEqual({ status: "unconfirmed" })
    expect(appStore.getState().updateTokenUsage).not.toHaveBeenCalled()
    await settleChat(() => {
      terminalHistory.resolve()
    })
    expect(pane.chat.contextCompression).toEqual({ status: "unconfirmed" })
  })

  it("cannot let an old operation overwrite the current feedback or token budget in the same Session", async () => {
    vi.mocked(agentClient.stopGeneration).mockResolvedValue(undefined)
    const { pane, stream, sessionId } = await mountCompressionRun()
    await settleChat(() => {
      stream.handlers.onTokenBudgetUpdated(budget())
      stream.handlers.onContextCompressionStatus("preflight", "started")
      pane.chat.stop()
    })
    const next = queueStream(sessionId, null)
    await send(pane.chat, "synthetic successor operation")
    await settleChat(() => {
      next.handlers.onTokenBudgetUpdated(budget(160_000))
      next.handlers.onContextCompressionStatus("preflight", "started")
    })
    expect(pane.chat.contextCompression).toEqual({ status: "running" })
    await settleChat(() => {
      stream.handlers.onContextCompressionStatus("preflight", "failed_candidate_plan:old operation")
      stream.handlers.onContextSummarized(summary)
      stream.handlers.onTokenBudgetUpdated(budget(32_000))
    })
    expect(pane.chat.contextCompression).toEqual({ status: "running" })
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 160_000, maxContextTokens: 320_000, budgetLimit: 300_000 })
    expect(appStore.getState().updateTokenUsage).toHaveBeenCalledTimes(2)
    expect(appStore.getState().setTruncationInfo).toHaveBeenCalledTimes(2)
    await settleChat(() => {
      next.handlers.onContextCompressionStatus("preflight", "completed")
      next.handlers.onTokenBudgetUpdated(budget(144_000))
    })
    expect(pane.chat.contextCompression).toEqual({ status: "completed", awaitingUsage: false })
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 144_000, maxContextTokens: 320_000 })
  })

  it("hides background feedback while preserving that Session's legitimate budget updates", async () => {
    const { pane, stream, sessionId } = await mountCompressionRun()
    await settleChat(() => {
      stream.handlers.onTokenBudgetUpdated(budget())
      stream.handlers.onContextCompressionStatus("preflight", "started")
    })
    const destination = "synthetic-other-session"
    feedSessions([savedSession(sessionId), session(destination)])
    await pane.rebind(destination)
    // Rebinding a pane does not stop its background run or subscription.
    // Its events may update A, while the new pane must show only B's data.
    expect(stream.controller.signal.aborted).toBe(false)
    expect(pane.chat.currentSessionId).toBe(destination)
    expect(pane.chat.contextCompression).toBeNull()
    await settleChat(() => {
      stream.handlers.onContextCompressionStatus("preflight", "started")
      stream.handlers.onContextSummarized(summary)
      stream.handlers.onTokenBudgetUpdated(budget(64_000))
    })
    expect(pane.chat.contextCompression).toBeNull()
    expect(storedUsage(destination)).toBeUndefined()
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 64_000, maxContextTokens: 320_000 })
    expect(appStore.getState().updateTokenUsage).toHaveBeenCalledTimes(2)
    expect(appStore.getState().setTruncationInfo).toHaveBeenCalledTimes(2)
    await pane.rebind(sessionId)
    expect(pane.chat.contextCompression).toEqual({ status: "completed", awaitingUsage: false })
  })

  it("accepts a newly acknowledged Session's budget before its pane finishes rebinding", async () => {
    const sessionId = "synthetic-created-compression-session"
    feedSessions([session(sessionId)])
    const stream = queueStream(sessionId, null)
    const pane = await mount(null)
    await send(pane.chat, "create a synthetic compression session")
    await settleChat(() => {
      stream.handlers.onTokenBudgetUpdated(budget())
      stream.handlers.onContextCompressionStatus("preflight", "started")
    })
    expect(pane.chat.contextCompression).toBeNull()
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 288_000, maxContextTokens: 320_000 })
    await pane.rebind(sessionId)
    expect(pane.chat.contextCompression).toEqual({ status: "running" })
    expect(appStore.getState().updateTokenUsage).toHaveBeenCalledTimes(1)
  })

  it("does not let another compression phase settle an observed running summary", async () => {
    const { pane, stream } = await mountCompressionRun()
    await settleChat(() => {
      stream.handlers.onContextCompressionStatus("preflight", "started")
      stream.handlers.onContextCompressionStatus("postflight", "completed")
      stream.handlers.onContextCompressionStatus("postflight", "failed_postcondition:late")
    })
    expect(pane.chat.contextCompression).toEqual({ status: "running" })
    await settleChat(() => { stream.handlers.onContextCompressionStatus("preflight", "completed") })
    expect(pane.chat.contextCompression).toEqual({ status: "completed", awaitingUsage: true })
  })
})
