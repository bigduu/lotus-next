import { beforeEach, describe, expect, it, vi } from "vitest"
import { agentClient } from "@services/chat/AgentService"
import { appStore } from "@shared/store/appStore/state"
import { providerStore } from "@shared/store/appStore/slices/providerState"
import type { AssistantToolResultMessage } from "@shared/types/chatMessages"
import { settleChat } from "./chatInteractionTestHarness"
import { appendPersistedUser, assistant, deferred, feedMessages, feedSessions, history, patchSession,
  queueStream, session, startedRun, useChatStreamFixture, user, type Chat } from "./chatStreamTestHarness"

const mount = useChatStreamFixture()
const at = "2026-09-19T12:00:00Z"
const waitForAssistant = { mode: "monotonic", waitForAssistant: true, retries: 8, retryDelayMs: 150 }
const existingTool: AssistantToolResultMessage = {
  id: "tool-result", role: "assistant", type: "tool_result", toolCallId: "fixture-call", toolName: "Read",
  createdAt: at, isError: false, result: { tool_name: "Read", result: "Fixture result", display_preference: "Default" },
}
const refresh = () => vi.mocked(appStore.getState().refreshChatsNow)
const send = (chat: Chat, text: string) => settleChat(async () => {
  await expect(chat.send(text)).resolves.toMatchObject({ kind: "accepted" })
})

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("Solid terminal history settlement", () => {
  it.each(["complete", "error"] as const)("waits for %s terminal settlement after the transport closes", async (ending) => {
    const id = "terminal-session"
    const payload = "optimistic terminal payload"
    const initialHistory = deferred<void>()
    const terminalHistory = deferred<void>()
    feedSessions([session(id)])
    const stream = queueStream(id, null)
    history().mockReturnValueOnce(initialHistory.promise).mockReturnValueOnce(terminalHistory.promise)
    const { chat } = await mount(id)
    await send(chat, payload)
    expect(chat).toMatchObject({ sending: true, streaming: "", pendingUserText: payload })

    await settleChat(() => {
      if (ending === "complete") stream.handlers.onComplete(undefined)
      else stream.handlers.onError("generation failed")
      // The transport can close long before the terminal history read settles.
      stream.subscription.resolve()
    })
    expect(chat).toMatchObject({ sending: true, pendingUserText: payload })
    const failure = { kind: "generation-failed", operationId: 1, sessionId: id, pendingOperationId: 1, message: "generation failed" }
    expect(chat.sendFailure).toEqual(ending === "complete" ? null : failure)
    expect(history()).toHaveBeenNthCalledWith(2, id, ending === "complete" ? waitForAssistant : { throwOnError: true })

    await settleChat(() => {
      appendPersistedUser(id, payload, "persisted-user")
      terminalHistory.resolve()
    })
    expect(chat).toMatchObject({ sending: false, streaming: null, pendingUserText: null })
    expect(chat.sendFailure).toEqual(ending === "complete" ? null : failure)
    await settleChat(() => initialHistory.resolve())
  })

  it("retains the completed live tail until WebSocket history reconciliation commits it", async () => {
    const id = "tool-tail-session"
    const payload = "finish after the tool"
    const answer = "durable final answer"
    feedSessions([{ ...session(id, [existingTool]), isRunning: true }])
    const stream = queueStream(id, null)
    const { chat } = await mount(id)
    await send(chat, payload)
    await settleChat(() => {
      stream.handlers.onToken(answer)
      stream.handlers.onComplete(undefined)
      stream.subscription.resolve()
    })
    expect(chat).toMatchObject({ sending: false, streamPhase: "finalizing", streaming: answer })

    await settleChat(() => {
      // Legacy acknowledgement: the inserted User message supplies the causal boundary.
      patchSession(id, { isRunning: false, messages: [
        existingTool, user("persisted-user", payload, "2026-09-19T12:00:01Z"),
        assistant("persisted-final", answer, undefined, "2026-09-19T12:00:02Z"),
      ] })
      stream.handlers.onSessionHistoryCommitted(id)
    })
    expect(history()).toHaveBeenLastCalledWith(id, { mode: "monotonic" })
    expect(chat).toMatchObject({ streamPhase: null, streaming: null })
  })

  it("reconciles a control-only WebSocket terminal instead of reporting an interrupted generation", async () => {
    const id = "control-only-terminal"
    const payload = "recover the missing semantic terminal"
    const answer = "final reply after recovered terminal"
    feedSessions([{ ...session(id, [existingTool]), isRunning: true }])
    const stream = queueStream(id, null)
    refresh().mockImplementation(async () => patchSession(id, { isRunning: false, lastRunStatus: "completed" }))
    history().mockImplementation(async (_sessionId, opts) => {
      if (opts?.waitForAssistant) feedMessages(id, [user("persisted-user", payload, at), assistant("persisted-final", answer)])
    })
    const { chat } = await mount(id)
    await send(chat, payload)
    await settleChat(() => {
      stream.handlers.onToken(answer)
      stream.subscription.resolve()
    })

    expect(refresh()).toHaveBeenCalled()
    expect(history()).toHaveBeenCalledWith(id, waitForAssistant)
    expect(chat).toMatchObject({ sendFailure: null, pendingUserText: null, streaming: null, streamPhase: null })
    expect(chat.messages).toContainEqual(expect.objectContaining({ id: "persisted-final", content: answer }))
  })

  it("recovers an earlier User anchor after a control-only terminal already read the recent page", async () => {
    const id = "paged-control-only-terminal"
    const answer = "Final reply from a long durable turn"
    const accepted = user("accepted-user", "Inspect a long tool trace", at)
    const saved = { ...assistant("persisted-final", answer, undefined, "2026-09-19T12:01:00Z"),
      phase: "final_answer" as const, historyIndex: 105 }
    let recentRead = false
    let recoveryRead = false
    feedSessions([{ ...session(id), isRunning: true }])
    const stream = queueStream(id, accepted.id)
    refresh().mockImplementation(async () => {
      if (recentRead) patchSession(id, { isRunning: false, lastRunStatus: "completed" })
    })
    history().mockImplementation(async (_id, opts) => {
      if (!opts?.waitForAssistant) return
      if (opts.throwOnError) {
        recentRead = true
        patchSession(id, { messages: [saved], historyWindow: { startIndex: 105, messageIds: [saved.id], beforeMessageId: "opaque/105" } })
      } else {
        recoveryRead = true
        patchSession(id, { messages: [accepted, saved], historyWindow: {
          startIndex: 0, messageIds: [accepted.id, saved.id], beforeMessageId: null,
        } })
      }
    })
    const { chat } = await mount(id)
    await send(chat, accepted.content)
    await settleChat(() => {
      stream.handlers.onToken(answer)
      stream.subscription.resolve()
    })
    expect(recentRead).toBe(true)
    expect(recoveryRead).toBe(true)
    expect(chat.messages.filter((message) => message.id === saved.id)).toHaveLength(1)
    expect(chat).toMatchObject({ streaming: null, sendFailure: null })
  })

  it.each(["refresh", "history"] as const)("starts exact-session generation before resolving accepted when %s hydration fails", async (failurePoint) => {
    const id = "ack-session"
    const modelRef = { provider: "test-provider", model: "test-model" }
    const milestones: string[] = []
    const image = { base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", name: "lifecycle.gif", size: 42, type: "image/gif" }
    appStore.setState({ selectedModel: modelRef })
    providerStore.setState({ ...providerStore.getInitialState(), providerSnapshot: {
      default_provider_instance_id: modelRef.provider,
      instances: [{ id: modelRef.provider, type: "openai", label: "Test", enabled: true, config: { runtime_models: [modelRef.model] } }],
      defaults: { chat: modelRef },
    } }, true)
    vi.mocked(agentClient.sendMessage).mockResolvedValueOnce({ session_id: id, status: "success" })
    vi.mocked(agentClient.execute).mockImplementationOnce(async (sessionId) => {
      milestones.push(`execute:${sessionId}`)
      return startedRun(sessionId, "accepted-run")
    })
    vi.mocked(agentClient.subscribeToEvents).mockImplementationOnce((sessionId, _handlers, controller) => {
      milestones.push(`subscribe:${sessionId}`)
      return new Promise((resolve) => controller?.signal.addEventListener("abort", () => resolve(), { once: true }))
    })
    if (failurePoint === "refresh") refresh().mockRejectedValueOnce(new Error("refresh failed"))
    else history().mockRejectedValueOnce(new Error("history failed"))

    const onSessionCreated = vi.fn()
    const pane = await mount(null, { onSessionCreated })
    await settleChat(async () => {
      const result = await pane.chat.send("run after acknowledgement", { images: [image] })
      milestones.push("accepted")
      expect(result).toMatchObject({ kind: "accepted", sessionId: id, navigated: true })
    })
    expect(milestones.slice(0, 3)).toEqual([`execute:${id}`, `subscribe:${id}`, "accepted"])
    expect(onSessionCreated).toHaveBeenCalledExactlyOnceWith(id)
    expect(agentClient.execute).toHaveBeenCalledWith(id, modelRef.model, undefined, undefined, modelRef)
    expect(refresh()).toHaveBeenCalledTimes(1)
    expect(history()).toHaveBeenCalledWith(id, { mode: "monotonic" })
    expect(pane.chat.sendFailure).toBeNull()
    feedSessions([session(id)])
    await pane.rebind(id)
    expect(pane.chat.pendingUserImages[0]?.name).toBe(image.name)
    expect(agentClient.sendMessage).toHaveBeenCalledTimes(1)
  })
})
