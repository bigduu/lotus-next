import { beforeEach, describe, expect, it, vi } from "vitest"
import { agentClient, type ExecuteResponse, type TruncateSessionMessagesResponse } from "@services/chat/AgentService"
import { appStore } from "@shared/store/appStore/state"
import { settleChat } from "./chatInteractionTestHarness"
import { appendPersistedUser, deferred, feedSessions, history, queueStream, session, useChatStreamFixture,
  type Chat } from "./chatStreamTestHarness"

const mount = useChatStreamFixture()
const execute = () => vi.mocked(agentClient.execute)
const truncate = () => vi.mocked(agentClient.truncateSessionMessages)
const subscribe = () => vi.mocked(agentClient.subscribeToEvents)
const refresh = () => vi.mocked(appStore.getState().refreshChatsNow)
const image = { base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", name: "lifecycle.gif", size: 42, type: "image/gif" }

const truncateReceipt = (id: string): TruncateSessionMessagesResponse =>
  ({ session_id: id, success: true, messages_removed: 0, message_count: 0 })

const send = (chat: Chat, text: string) => settleChat(async () => {
  await expect(chat.send(text)).resolves.toMatchObject({ kind: "accepted" })
})

function completeNextObservation() {
  subscribe().mockImplementationOnce(async (_id, handlers) => { handlers.onComplete?.(undefined) })
}

async function mountFailedSend(id: string, payload: string) {
  feedSessions([session(id)])
  queueStream(id, null)
  execute().mockRejectedValueOnce(new Error("generation did not start"))
  history().mockRejectedValueOnce(new Error("ack hydration failed"))
  const pane = await mount(id)
  await send(pane.chat, payload)
  const failure = pane.chat.sendFailure
  expect(failure).toMatchObject({ kind: "generation-failed", sessionId: id, message: "generation did not start" })
  if (failure?.kind !== "generation-failed") throw new Error("Expected an acknowledged failed generation")
  return { pane, failure }
}

async function startPendingRetry(id: string, payload: string) {
  const { pane, failure } = await mountFailedSend(id, payload)
  const truncation = deferred<TruncateSessionMessagesResponse>()
  truncate().mockReturnValueOnce(truncation.promise)
  const before = {
    execute: execute().mock.calls.length, subscribe: subscribe().mock.calls.length, history: history().mock.calls.length,
  }
  const retrying = pane.chat.retry(failure)
  return { pane, truncation, retrying, before }
}

beforeEach(() => {
  truncate().mockImplementation(async (id) => truncateReceipt(id))
  vi.spyOn(appStore.getState(), "markCancel")
  vi.spyOn(appStore.getState(), "updateSession")
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("Solid ordinary retry and Stop", () => {
  it("fences duplicate retry clicks before truncation and reruns only the owned session", async () => {
    const id = "exact-session"
    const payload = "accepted payload"
    const { pane, failure } = await mountFailedSend(id, payload)
    expect(pane.chat.pendingUserText).toBe(payload)
    await settleChat(() => pane.chat.retry({ ...failure, operationId: failure.operationId + 1 }))
    expect(truncate()).not.toHaveBeenCalled()

    const truncation = deferred<TruncateSessionMessagesResponse>()
    truncate().mockReturnValueOnce(truncation.promise)
    completeNextObservation()
    const first = pane.chat.retry(failure)
    await pane.chat.retry(failure)
    expect(truncate()).toHaveBeenCalledExactlyOnceWith(id, { mode: "error_retry" })
    expect(execute()).toHaveBeenCalledTimes(1)
    await settleChat(async () => {
      appendPersistedUser(id, payload, "persisted-user")
      truncation.resolve(truncateReceipt(id))
      await first
    })
    expect(truncate()).toHaveBeenCalledTimes(1)
    expect(execute()).toHaveBeenCalledTimes(2)
    expect(execute()).toHaveBeenLastCalledWith(id, "test-model", undefined, undefined, undefined)
    expect(console.error).not.toHaveBeenCalled()
    expect(pane.chat.sendFailure).toBeNull()
    expect(pane.chat.pendingUserText).toBeNull()
  })

  it("retries a persisted backend error after transient pane state is lost", async () => {
    const id = "persisted-error"
    feedSessions([{ ...session(id), lastRunStatus: "error" }])
    completeNextObservation()
    const { chat } = await mount(id)
    expect(chat.sendFailure).toBeNull()
    await settleChat(() => chat.retry())
    expect(truncate()).toHaveBeenCalledExactlyOnceWith(id, { mode: "error_retry" })
    expect(execute()).toHaveBeenCalledExactlyOnceWith(id, "test-model", undefined, undefined, undefined)
    expect(subscribe()).toHaveBeenCalledTimes(1)
  })

  it("continues with the session's saved model instead of another pane's draft choice", async () => {
    const id = "resumed-session"
    const existing = session(id)
    const modelRef = { provider: "easycli", model: "grok-4.7" }
    appStore.setState({ selectedModel: { provider: "test-provider", model: "gpt-6-sol" } })
    feedSessions([{ ...existing, lastRunStatus: "error", config: { ...existing.config, model: modelRef.model, model_ref: modelRef } }])
    completeNextObservation()
    const { chat } = await mount(id)
    await settleChat(() => chat.retry())
    expect(execute()).toHaveBeenCalledExactlyOnceWith(id, modelRef.model, undefined, undefined, modelRef)
  })

  it("finishes retry for session A without subscribing or contaminating a pane rebound to B", async () => {
    const a = "session-a"
    const b = "session-b"
    const payload = "optimistic payload owned by A"
    const { pane, truncation, retrying, before } = await startPendingRetry(a, payload)
    await pane.rebind(b)
    await settleChat(async () => {
      appendPersistedUser(a, payload, "persisted-user")
      truncation.resolve(truncateReceipt(a))
      await retrying
    })
    expect(truncate()).toHaveBeenCalledWith(a, { mode: "error_retry" })
    expect(execute()).toHaveBeenCalledTimes(before.execute + 1)
    expect(execute()).toHaveBeenLastCalledWith(a, "test-model", undefined, undefined, undefined)
    expect(subscribe()).toHaveBeenCalledTimes(before.subscribe)
    expect(history().mock.calls.length).toBeGreaterThan(before.history)
    expect(history()).toHaveBeenLastCalledWith(a)
    expect(pane.chat).toMatchObject({ currentSessionId: b, sending: false, submissionPending: false, streaming: null })
    await pane.rebind(a)
    expect(pane.chat.pendingUserText).toBeNull()
  })

  it("keeps a detached retry failure with A while B sends and permits exact A retry", async () => {
    const a = "detached-a"
    const b = "active-b"
    const { pane, truncation, retrying, before } = await startPendingRetry(a, "payload owned by detached A")
    const detachedExecute = deferred<ExecuteResponse>()
    execute().mockReturnValueOnce(detachedExecute.promise)
    await pane.rebind(b)
    await settleChat(() => truncation.resolve(truncateReceipt(a)))
    expect(execute()).toHaveBeenCalledTimes(before.execute + 1)
    expect(subscribe()).toHaveBeenCalledTimes(before.subscribe)

    const bStream = queueStream(b, null)
    await send(pane.chat, "B stays active")
    expect(pane.chat).toMatchObject({ sending: true, submissionPending: false, streaming: "" })
    await settleChat(async () => {
      detachedExecute.reject(new Error("detached A execute failed"))
      await retrying
    })
    expect(pane.chat).toMatchObject({
      currentSessionId: b, sendFailure: null, sending: true, submissionPending: false, streaming: "",
    })
    await settleChat(() => {
      bStream.handlers.onComplete(undefined)
      bStream.subscription.resolve()
    })
    await pane.rebind(a)
    const failure = pane.chat.sendFailure
    expect(failure).toEqual({
      kind: "generation-failed", operationId: 2, sessionId: a, pendingOperationId: 1, message: "detached A execute failed",
    })
    if (failure?.kind !== "generation-failed") throw new Error("Expected the detached failure")
    const postCount = vi.mocked(agentClient.sendMessage).mock.calls.length
    completeNextObservation()
    await settleChat(() => pane.chat.retry(failure))
    expect(truncate()).toHaveBeenLastCalledWith(a, { mode: "error_retry" })
    expect(execute()).toHaveBeenLastCalledWith(a, "test-model", undefined, undefined, undefined)
    expect(agentClient.sendMessage).toHaveBeenCalledTimes(postCount)
    expect(pane.chat.sendFailure).toBeNull()
  })

  it("finishes retry for session A without subscribing or updating an unmounted pane", async () => {
    const id = "unmounted-session-a"
    const { pane, truncation, retrying, before } = await startPendingRetry(id, "optimistic payload before unmount")
    pane.unmount()
    await settleChat(async () => {
      truncation.resolve(truncateReceipt(id))
      await retrying
    })
    expect(truncate()).toHaveBeenCalledWith(id, { mode: "error_retry" })
    expect(execute()).toHaveBeenCalledTimes(before.execute + 1)
    expect(execute()).toHaveBeenLastCalledWith(id, "test-model", undefined, undefined, undefined)
    expect(subscribe()).toHaveBeenCalledTimes(before.subscribe)
    expect(history().mock.calls.length).toBeGreaterThan(before.history)
    expect(history()).toHaveBeenLastCalledWith(id)
    expect(console.error).not.toHaveBeenCalled()
  })

  it("clears the acknowledged optimistic payload after an immediate Stop hydrates history", async () => {
    const id = "stopped-session"
    const text = "stop this acknowledged run"
    const initialHistory = deferred<void>()
    feedSessions([session(id)])
    const stream = queueStream(id, null)
    history().mockReturnValueOnce(initialHistory.promise)
      .mockImplementationOnce(async () => appendPersistedUser(id, text, "persisted-user"))
    vi.mocked(agentClient.stopGeneration).mockImplementationOnce(async () => {
      expect(stream.controller.signal.aborted).toBe(false)
    })
    const { chat } = await mount(id)
    await settleChat(async () => { await expect(chat.send(text, { images: [image] })).resolves.toMatchObject({ kind: "accepted" }) })
    expect(chat).toMatchObject({ sending: true, pendingUserText: text, pendingUserImages: [{ name: image.name }] })
    await settleChat(() => {
      chat.stop()
      stream.subscription.resolve()
    })
    expect(agentClient.stopGeneration).toHaveBeenCalledExactlyOnceWith(id)
    expect(appStore.getState().markCancel).toHaveBeenCalledExactlyOnceWith(id)
    expect(appStore.getState().updateSession).toHaveBeenCalledExactlyOnceWith(id, { isRunning: false }, { skipBackendPatch: true })
    expect(stream.controller.signal.aborted).toBe(true)
    expect(history()).toHaveBeenNthCalledWith(2, id)
    expect(chat).toMatchObject({ sending: false, streaming: null, pendingUserText: null, pendingUserImages: [] })
    await settleChat(() => initialHistory.resolve())
  })

  it("reconciles the optimistic idle state when Stop dispatch fails", async () => {
    const id = "stop-failed"
    feedSessions([{ ...session(id), isRunning: true }])
    vi.mocked(agentClient.stopGeneration).mockRejectedValueOnce(new Error("offline"))
    const { chat } = await mount(id)
    await settleChat(() => chat.stop())
    expect(agentClient.stopGeneration).toHaveBeenCalledExactlyOnceWith(id)
    expect(appStore.getState().markCancel).toHaveBeenCalledExactlyOnceWith(id)
    expect(appStore.getState().updateSession).toHaveBeenCalledExactlyOnceWith(id, { isRunning: false }, { skipBackendPatch: true })
    expect(refresh()).toHaveBeenCalledTimes(1)
    expect(history()).toHaveBeenCalledWith(id)
  })
})
