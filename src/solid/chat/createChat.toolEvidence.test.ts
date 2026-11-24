import { beforeEach, describe, expect, it, vi } from "vitest"
import { apiClient } from "@services/api"
import { agentClient, type SessionSummary } from "@services/chat/AgentService"
import type { AssistantToolResultMessage, Message } from "@shared/types/chatMessages"
import { settleChat } from "./chatInteractionTestHarness"
import { appendPersistedUser, assistant, deferred, feedMessages, feedSessions, history as readHistory, queueStream,
  savedSession, session, useChatStreamFixture, user as userMessage, type Chat } from "./chatStreamTestHarness"

const mount = useChatStreamFixture()
const failure = "Tool error: Execution failed: Native canonical Session Source scope changed"
const result = "Process exited with code 0\nPosted comment: https://example.invalid/comment/fixture"
const requestText = "publish the synthetic fixture"
const at = "2026-10-27T00:00:00Z"

const calls = (pane: { chat: Chat }) => pane.chat.liveSegments
  .flatMap((segment) => segment.kind === "tools" ? segment.calls : [])
const frame = () => settleChat(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

function toolResult(id: string, output: string): AssistantToolResultMessage {
  return {
    id, role: "assistant", type: "tool_result", toolCallId: "call-1", toolName: "exec_command", isError: false,
    createdAt: at, result: { result: output, tool_name: "exec_command", display_preference: "Default" },
  }
}

function failedSummary(id: string): SessionSummary {
  return { id, kind: "root", title: id, title_version: 0, pinned: false, root_session_id: id,
    spawn_depth: 0, model: "test-model", created_at: at, updated_at: at, last_activity_at: at,
    message_count: 0, has_attachments: false, is_running: false, last_run_status: "error", last_run_error: failure,
  }
}

async function send(chat: Chat, text: string) {
  await settleChat(async () => { await expect(chat.send(text)).resolves.toMatchObject({ kind: "accepted" }) })
}

async function mountRun(id = "synthetic-tool-session", messages: Message[] = [], messageId?: string | null) {
  feedSessions([session(id, messages)])
  const stream = queueStream(id, messageId)
  const pane = await mount(id)
  await send(pane.chat, requestText)
  return { pane, stream, sessionId: id }
}

async function finishTool(stream: ReturnType<typeof queueStream>) {
  await settleChat(() => {
    stream.handlers.onToolStart("call-1", "exec_command", { cmd: "synthetic fixture" })
    stream.handlers.onToolToken("call-1", "preview")
    stream.handlers.onToolComplete("call-1", { success: true, result })
  })
  await frame()
}

function failRun(stream: ReturnType<typeof queueStream>) {
  return settleChat(() => {
    stream.handlers.onError(failure)
    stream.subscription.resolve()
  })
}

function expectNoReplay() {
  expect(agentClient.sendMessage).toHaveBeenCalledTimes(1)
  expect(agentClient.execute).toHaveBeenCalledTimes(1)
  expect(apiClient.post).not.toHaveBeenCalled()
  expect(agentClient.truncateSessionMessages).not.toHaveBeenCalled()
}

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}))

describe("Solid tool-stream terminal evidence", () => {
  it("keeps one tool per run and preserves the first completion through duplicate and late events", async () => {
    const { pane, stream } = await mountRun()
    await settleChat(async () => {
      stream.handlers.onToolStart("call-1", "exec_command", { cmd: "original" })
      stream.handlers.onToolToken("call-1", "preview")
      stream.handlers.onToolStart("call-1", "exec_command", { cmd: "duplicate" })
    })
    await frame()
    expect(calls(pane)).toEqual([{ toolCallId: "call-1", toolName: "exec_command", args: { cmd: "original" }, output: "preview", status: "running" }])
    await settleChat(async () => {
      stream.handlers.onToolComplete("call-1", { success: true, result })
      stream.handlers.onToolToken("call-1", "late output")
      stream.handlers.onToolStart("call-1", "exec_command", { cmd: "replayed start" })
      stream.handlers.onToolComplete("call-1", { success: false, result: "late failure" })
      stream.handlers.onToolError("call-1", "late error")
    })
    await frame()
    expect(calls(pane)).toEqual([{ toolCallId: "call-1", toolName: "exec_command", args: { cmd: "original" }, output: result, status: "completed", images: undefined }])
    expectNoReplay()
  })

  it("does not replace a terminal tool error with a late completion", async () => {
    const { pane, stream } = await mountRun()
    await settleChat(async () => {
      stream.handlers.onToolStart("call-1", "exec_command", {})
      stream.handlers.onToolError("call-1", "first error")
      stream.handlers.onToolToken("call-1", "late output")
      stream.handlers.onToolComplete("call-1", { success: true, result })
      stream.handlers.onToolError("call-1", "duplicate error")
    })
    await frame()
    expect(calls(pane)).toEqual([{ toolCallId: "call-1", toolName: "exec_command", args: {}, output: "", status: "error", error: "first error" }])
    expectNoReplay()
  })

  it("uses an empty final result instead of retaining a streamed preview", async () => {
    const { pane, stream } = await mountRun()
    await settleChat(async () => {
      stream.handlers.onToolStart("call-1", "exec_command", {})
      stream.handlers.onToolToken("call-1", "preview")
      stream.handlers.onToolComplete("call-1", { success: true, result: "" })
    })
    await frame()
    expect(calls(pane)[0]).toMatchObject({ status: "completed", output: "" })
    expectNoReplay()
  })

  it("retains completed tool evidence after a scope error and failed history read without replay", async () => {
    const { pane, stream, sessionId } = await mountRun()
    await finishTool(stream)
    readHistory().mockImplementationOnce((_sid, options) => options?.throwOnError
      ? Promise.reject(new Error("synthetic history unavailable")) : Promise.resolve())
    await failRun(stream)
    expect(readHistory()).toHaveBeenLastCalledWith(sessionId, { throwOnError: true })
    expect(calls(pane)).toHaveLength(1)
    expect(calls(pane)[0]).toMatchObject({ status: "completed", output: result })
    expect(pane.chat).toMatchObject({ sending: false, streaming: null, streamPhase: null, streamStatus: null,
      pendingUserText: "publish the synthetic fixture", sendFailure: { kind: "generation-failed", sessionId, message: failure } })
    expect(stream.controller.signal.aborted).toBe(true)
    expect(agentClient.stopGeneration).not.toHaveBeenCalled()
    await settleChat(async () => {
      stream.handlers.onToolStart("call-1", "exec_command", {})
      stream.handlers.onToolToken("call-1", "late output")
      stream.handlers.onToolError("call-1", "late error")
      stream.handlers.onToken("late assistant token")
    })
    await frame()
    expect(calls(pane)).toHaveLength(1)
    expect(calls(pane)[0]).toMatchObject({ status: "completed", output: result })
    expect(pane.chat.streaming).toBeNull()
    expectNoReplay()

    feedMessages(sessionId, [
      userMessage(`${sessionId}-user`, requestText),
      toolResult("persisted-tool", result),
    ])
    await settleChat()
    expect(calls(pane)).toEqual([])
    expect(pane.chat.pendingUserText).toBeNull()
    expect(pane.chat.sendFailure?.message).toBe(failure)
    expectNoReplay()
    // Once acknowledged by history, a later explicit history edit cannot
    // resurrect an obsolete in-memory result.
    feedMessages(sessionId, savedSession(sessionId).messages.slice(0, 1))
    await settleChat()
    expect(calls(pane)).toEqual([])
  })

  it("retires live evidence and the exact pending message after confirmed failure-history hydration", async () => {
    const { pane, stream, sessionId } = await mountRun()
    await finishTool(stream)
    readHistory().mockImplementationOnce(async () => appendPersistedUser(sessionId, requestText, `${sessionId}-user`))
    await failRun(stream)
    expect(calls(pane)).toEqual([])
    expect(pane.chat.pendingUserText).toBeNull()
    expect(pane.chat.sendFailure?.message).toBe(failure)
    expectNoReplay()
  })

  it("does not acknowledge a reused tool id with a result that predates this operation", async () => {
    const previousResult = toolResult("previous-tool-result", "previous operation output")
    const { pane, stream, sessionId } = await mountRun("synthetic-reused-tool-id", [previousResult])
    await finishTool(stream)
    readHistory().mockRejectedValueOnce(new Error("synthetic history unavailable"))
    await failRun(stream)
    expect(calls(pane)).toHaveLength(1)
    expect(calls(pane)[0]).toMatchObject({ toolCallId: "call-1", status: "completed", output: result })
    expect(pane.chat).toMatchObject({ sending: false, streaming: null, streamPhase: null,
      sendFailure: { kind: "generation-failed", sessionId, message: failure } })
    await settleChat()
    expect(calls(pane)[0]?.output).toBe(result)

    feedMessages(sessionId, [previousResult,
      userMessage(`${sessionId}-user`, requestText),
      toolResult("current-tool-result", result)])
    await settleChat()
    expect(calls(pane)).toEqual([])
    feedMessages(sessionId, [previousResult])
    await settleChat()
    expect(calls(pane)).toEqual([])
    expect(pane.chat.sendFailure?.message).toBe(failure)
    expectNoReplay()
  })

  it.each(["acknowledged", "legacy"] as const)("keeps %s evidence when an earlier result hydrates after streaming begins", async (acknowledgement) => {
    const sessionId = `synthetic-late-history-${acknowledgement}`
    const previousResult = toolResult("previous-tool-result", "previous operation output")
    const user = userMessage(`${sessionId}-user`, requestText)
    const initialHistory = deferred<void>()
    readHistory().mockImplementationOnce(async () => {
      await initialHistory.promise
      feedMessages(sessionId, [previousResult, user])
    })
    const { pane, stream } = await mountRun(sessionId, [], acknowledgement === "legacy" ? null : user.id)
    await finishTool(stream)
    await settleChat(() => initialHistory.resolve())
    expect(pane.chat.pendingUserText).toBeNull()
    readHistory().mockRejectedValueOnce(new Error("synthetic terminal history unavailable"))
    await failRun(stream)
    expect(calls(pane)).toHaveLength(1)
    expect(calls(pane)[0]).toMatchObject({ toolCallId: "call-1", status: "completed", output: result })
    expect(pane.chat).toMatchObject({ sending: false, streaming: null, streamPhase: null,
      sendFailure: { kind: "generation-failed", sessionId, message: failure } })

    feedMessages(sessionId, [previousResult, user,
      toolResult("current-tool-result", result)])
    await settleChat()
    if (acknowledgement === "acknowledged") expect(calls(pane)).toEqual([])
    else expect(calls(pane)[0]?.output).toBe(result)
    feedMessages(sessionId, [previousResult, user])
    await settleChat()
    if (acknowledgement === "acknowledged") expect(calls(pane)).toEqual([])
    else expect(calls(pane)[0]?.output).toBe(result)
    expectNoReplay()
  })

  it.each(["later-turn", "current-window", "legacy"] as const)("bounds retained tool acknowledgement to its user window: %s", async (scenario) => {
    const sessionId = `synthetic-user-window-${scenario}`
    const user = userMessage(`${sessionId}-user`, requestText)
    const nextUser = userMessage(`${sessionId}-next-user`, "next turn fixture")
    const currentResult = toolResult("current-result", result)
    const nextResult = toolResult("next-result", "next turn output")
    const { pane, stream } = await mountRun(sessionId, [], scenario === "legacy" ? null : user.id)
    await finishTool(stream)
    readHistory().mockRejectedValueOnce(new Error("synthetic history unavailable"))
    await failRun(stream)
    expect(calls(pane)[0]?.output).toBe(result)

    // A second pane starts the next turn before its busy summary reaches A.
    // Its canonical history update must not retire A's unconfirmed tool result.
    const next = queueStream(sessionId, nextUser.id)
    const otherPane = await mount(sessionId)
    await send(otherPane.chat, nextUser.content)
    const canonical = [user, ...(scenario === "later-turn" ? [] : [currentResult]), nextUser, nextResult,
      assistant("next-final", "next turn answer")]
    readHistory().mockImplementationOnce(async () => feedMessages(sessionId, canonical))
    await settleChat(() => {
      next.handlers.onToolStart("call-1", "exec_command", { cmd: "next turn fixture" })
      next.handlers.onToolComplete("call-1", { success: true, result: "next turn output" })
      next.handlers.onToken("next turn answer")
      next.handlers.onComplete(undefined)
      next.subscription.resolve()
    })
    if (scenario === "current-window") expect(calls(pane)).toEqual([])
    else expect(calls(pane)[0]).toMatchObject({ status: "completed", output: result })
    expect(pane.chat).toMatchObject({ sending: false, streaming: null, streamPhase: null,
      sendFailure: { kind: "generation-failed", sessionId, message: failure } })
    expect(otherPane.chat).toMatchObject({ sending: false, streaming: null, streamPhase: null, sendFailure: null })

    feedMessages(sessionId, canonical.filter((message) => message.id !== currentResult.id))
    await settleChat()
    if (scenario === "current-window") expect(calls(pane)).toEqual([])
    else expect(calls(pane)[0]?.output).toBe(result)
    expect(agentClient.sendMessage).toHaveBeenCalledTimes(2)
    expect(agentClient.execute).toHaveBeenCalledTimes(2)
    expect(agentClient.subscribeToEvents).toHaveBeenCalledTimes(2)
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(agentClient.truncateSessionMessages).not.toHaveBeenCalled()
    expect(agentClient.stopGeneration).not.toHaveBeenCalled()
  })

  it.each(["control-only terminal", "idle reconciliation"] as const)("retains tool evidence when %s cannot confirm history", async (ending) => {
    if (ending === "idle reconciliation") vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
    const { pane, stream, sessionId } = await mountRun()
    await finishTool(stream)
    readHistory().mockImplementation((_sid, options) => options?.throwOnError
      ? Promise.reject(new Error("synthetic history unavailable")) : Promise.resolve())
    if (ending === "control-only terminal") {
      await settleChat(() => stream.subscription.resolve())
    } else {
      vi.mocked(agentClient.getSession).mockResolvedValue({ session: failedSummary(sessionId) })
      await settleChat(() => vi.advanceTimersByTimeAsync(7_000))
    }
    expect(readHistory()).toHaveBeenCalledWith(sessionId, expect.objectContaining({
      mode: "monotonic", throwOnError: true,
    }))
    expect(calls(pane)[0]).toMatchObject({ status: "completed", output: result })
    expect(pane.chat).toMatchObject({ sending: false, streaming: null, streamPhase: null,
      sendFailure: { kind: "generation-failed", sessionId } })
    expectNoReplay()
  })

  it("does not resurrect evidence after Stop supersedes an in-flight failed-history read", async () => {
    const { pane, stream, sessionId } = await mountRun()
    await finishTool(stream)
    const history = deferred<void>()
    readHistory().mockReturnValueOnce(history.promise)
    vi.mocked(agentClient.stopGeneration).mockResolvedValueOnce(undefined)
    await settleChat(() => {
      stream.handlers.onError(failure)
      stream.subscription.resolve()
      pane.chat.stop()
    })
    expect(agentClient.stopGeneration).toHaveBeenCalledExactlyOnceWith(sessionId)
    await settleChat(() => history.reject(new Error("synthetic late read failure")))
    expect(calls(pane)).toEqual([])
    expect(pane.chat.streaming).toBeNull()
    expect(stream.controller.signal.aborted).toBe(true)
    expect(pane.chat.pendingUserText).toBe(requestText)
    expectNoReplay()
  })

  it("permits the same tool id in a successor run and keeps late callbacks away from its Stop control", async () => {
    const { pane, stream, sessionId } = await mountRun()
    await finishTool(stream)
    readHistory().mockRejectedValueOnce(new Error("synthetic history unavailable"))
    await failRun(stream)
    const next = queueStream(sessionId)
    await send(pane.chat, "successor fixture")
    await settleChat(async () => {
      next.handlers.onToolStart("call-1", "exec_command", { cmd: "successor" })
      next.handlers.onToolToken("call-1", "new output")
      stream.handlers.onToolComplete("call-1", { success: true, result: "old result" })
      stream.handlers.onToolStart("call-2", "exec_command", {})
    })
    await frame()
    expect(calls(pane)).toEqual([{ toolCallId: "call-1", toolName: "exec_command", args: { cmd: "successor" }, output: "new output", status: "running" }])
    expect(pane.chat.sending).toBe(true)
    vi.mocked(agentClient.stopGeneration).mockResolvedValueOnce(undefined)
    await settleChat(() => pane.chat.stop())
    expect(agentClient.stopGeneration).toHaveBeenCalledExactlyOnceWith(sessionId)
    expect(next.controller.signal.aborted).toBe(true)
    expect(calls(pane)).toEqual([])
    expect(agentClient.sendMessage).toHaveBeenCalledTimes(2)
    expect(agentClient.execute).toHaveBeenCalledTimes(2)
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(agentClient.truncateSessionMessages).not.toHaveBeenCalled()
  })
})
