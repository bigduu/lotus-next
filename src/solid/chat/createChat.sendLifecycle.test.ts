import { createEffect, createRoot, createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiClient } from "@services/api"
import { agentClient, type AgentEventHandlers, type ChatResponse } from "@services/chat/AgentService"
import { clearSessionCompatibilityObservations } from "@services/chat/sessionExecutionCompatibility"
import { appStore } from "@shared/store/appStore/state"
import { providerStore } from "@shared/store/appStore/slices/providerState"
import type { ChatItem, Message, UserMessage } from "@shared/types/chatMessages"
import { getUsedModels } from "@shared/utils/usedModels"
import { resetCompletedAnswerHandoffsForTest } from "@/lib/completedAnswerHandoffRegistry"
import { createChat } from "./createChat"
import { settleChat } from "./chatInteractionTestHarness"

vi.mock("@shared/store/appStore/state", async (original) => ({
  ...await original<typeof import("@shared/store/appStore/state")>(),
  initializeStore: vi.fn(async () => {}),
}))

const model = "test-model"
const modelRef = { provider: "test-provider", model }
const timestamp = "2026-10-06T10:00:00Z"
const image = {
  base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  name: "lifecycle.gif", size: 42, type: "image/gif",
}
const scopes: Array<() => void> = []

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function acknowledge(sessionId: string, messageId?: string): ChatResponse {
  return { session_id: sessionId, message_id: messageId, status: "success" }
}

function session(id: string, messages: Message[] = []): ChatItem {
  return {
    id, messages, title: id, createdAt: 1,
    config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, model },
  }
}

function user(id: string, content: string): UserMessage {
  return { id, role: "user", content, createdAt: timestamp }
}

function publishMessages(id: string, messages: Message[], running?: boolean) {
  appStore.setState((state) => ({
    chats: state.chats.map((item) => item.id === id ? { ...item, messages, isRunning: running ?? item.isRunning } : item),
  }))
}

type Chat = ReturnType<typeof createChat>
type PendingSnapshot = { pending: string | null; messages: Chat["messages"] }

async function mount(bound?: string | null, options: {
  onSessionCreated?: (id: string) => void
  onProjection?: (snapshot: PendingSnapshot) => void
} = {}) {
  const pane = createRoot((dispose) => {
    const [id, rebind] = createSignal(bound ?? null)
    const chat = createChat(bound === undefined ? undefined : id, options.onSessionCreated)
    const track = options.onProjection
    if (track) createEffect(() => ({ pending: chat.pendingUserText, messages: chat.messages }), (snapshot) => { track(snapshot) })
    scopes.push(dispose)
    return { chat, rebind }
  })
  await settleChat()
  return pane
}

beforeEach(() => {
  resetCompletedAnswerHandoffsForTest()
  clearSessionCompatibilityObservations()
  appStore.setState({ ...appStore.getInitialState(), selectedModel: modelRef,
    loadSubagentSessions: vi.fn(async () => {}),
    loadChatHistory: vi.fn(async () => {}),
    refreshChatsNow: vi.fn(async () => {}),
  }, true)
  providerStore.setState({ ...providerStore.getInitialState(), providerSnapshot: {
    default_provider_instance_id: modelRef.provider,
    instances: [{ id: modelRef.provider, type: "openai", label: "Test", enabled: true, config: { runtime_models: [model] } }],
    defaults: { chat: modelRef },
  } }, true)
  vi.spyOn(apiClient, "get").mockImplementation(async (path) => {
    if (path === "execute/defaults") return { model: null, system_prompt: "", base_system_prompt: "" }
    throw new Error(`Unexpected fixture GET ${path}`)
  })
  vi.spyOn(agentClient, "sendMessage").mockRejectedValue(new Error("No chat acknowledgement fixture"))
  vi.spyOn(agentClient, "execute").mockImplementation(async (sessionId) =>
    ({ session_id: sessionId, status: "started", run_id: "synthetic-run", events_url: "/v2/stream" }))
  vi.spyOn(agentClient, "subscribeToEvents").mockImplementation((_id, _handlers, controller) =>
    new Promise<void>((resolve) => controller?.signal.addEventListener("abort", () => resolve(), { once: true })))
  vi.spyOn(agentClient, "stopGeneration").mockResolvedValue(undefined)
  vi.spyOn(agentClient, "truncateSessionMessages").mockRejectedValue(new Error("No truncate permitted in send fixtures"))
  vi.spyOn(agentClient, "getPendingQuestion").mockResolvedValue({ has_pending_question: false })
  vi.spyOn(agentClient, "getRunningSessions").mockResolvedValue({ sessions: [] })
  vi.spyOn(agentClient, "getSession").mockRejectedValue(new Error("No session detail fixture"))
})

afterEach(async () => {
  for (const dispose of scopes.splice(0)) dispose()
  await settleChat()
  vi.restoreAllMocks()
})

describe("createChat exact two-phase acknowledgement", () => {
  it("synchronously fences duplicate sends while the first POST is pending", async () => {
    const receipt = deferred<ChatResponse>()
    vi.mocked(agentClient.sendMessage).mockReturnValueOnce(receipt.promise)
    const { chat } = await mount(null)
    const first = chat.send("only once")
    const second = chat.send("only once")
    await expect(second).resolves.toEqual({ kind: "busy" })
    expect(agentClient.sendMessage).toHaveBeenCalledTimes(1)
    expect(agentClient.execute).not.toHaveBeenCalled()
    await settleChat(async () => {
      receipt.resolve(acknowledge("session-one"))
      await expect(first).resolves.toMatchObject({ kind: "accepted", sessionId: "session-one" })
    })
    expect(agentClient.sendMessage).toHaveBeenCalledTimes(1)
    expect(agentClient.execute).toHaveBeenCalledExactlyOnceWith("session-one", model, undefined, undefined, modelRef)
  })

  it("routes a main-pane new session through the global session store", async () => {
    const target = "main-session"
    vi.mocked(agentClient.sendMessage).mockResolvedValueOnce(acknowledge(target))
    const select = vi.spyOn(appStore.getState(), "selectSession")
    const { chat } = await mount()
    await settleChat(async () => {
      await expect(chat.send("start in the main pane")).resolves.toMatchObject({ kind: "accepted", sessionId: target, navigated: true })
    })
    expect(select).toHaveBeenCalledExactlyOnceWith(target)
    expect(appStore.getState().currentSessionId).toBe(target)
    expect(agentClient.execute).toHaveBeenCalledExactlyOnceWith(target, model, undefined, undefined, modelRef)
    expect(agentClient.subscribeToEvents).toHaveBeenCalledExactlyOnceWith(target, expect.any(Object), expect.any(AbortController))
  })

  it("blocks a delayed first send whose preparation origin was already invalidated", async () => {
    const { chat } = await mount()
    await expect(chat.send("stale prepared draft", { isOriginCurrent: () => false })).resolves.toEqual({ kind: "blocked" })
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it("does not navigate a prepared send ACK after null-to-null new-chat intent", async () => {
    const receipt = deferred<ChatResponse>()
    vi.mocked(agentClient.sendMessage).mockReturnValueOnce(receipt.promise)
    const select = vi.spyOn(appStore.getState(), "selectSession")
    const { chat } = await mount()
    let version = 0
    const initialVersion = version
    const pending = chat.send("prepared original draft", { isOriginCurrent: () => version === initialVersion })
    await settleChat(() => { version++; chat.newChat() })
    select.mockClear()
    const target = "late-prepared-session"
    await settleChat(async () => {
      receipt.resolve(acknowledge(target))
      await expect(pending).resolves.toMatchObject({ kind: "accepted", navigated: false, sessionId: target })
    })
    expect(select).not.toHaveBeenCalled()
    expect(agentClient.subscribeToEvents).not.toHaveBeenCalled()
    expect(agentClient.execute).toHaveBeenCalledExactlyOnceWith(target, model, undefined, undefined, modelRef)
    expect(appStore.getState().currentSessionId).toBeNull()
  })

  it("finishes an acknowledged send without navigating a bound pane that already moved", async () => {
    const receipt = deferred<ChatResponse>()
    const onSessionCreated = vi.fn()
    vi.mocked(agentClient.sendMessage).mockReturnValueOnce(receipt.promise)
    const { chat, rebind } = await mount(null, { onSessionCreated })
    const pending = chat.send("slow acknowledgement")
    await settleChat(() => rebind("different-session"))
    const target = "late-session"
    await settleChat(async () => {
      receipt.resolve(acknowledge(target))
      await expect(pending).resolves.toMatchObject({ kind: "accepted", navigated: false, sessionId: target })
    })
    expect(onSessionCreated).not.toHaveBeenCalled()
    expect(agentClient.subscribeToEvents).not.toHaveBeenCalled()
    expect(agentClient.execute).toHaveBeenCalledExactlyOnceWith(target, model, undefined, undefined, modelRef)
    expect(chat.currentSessionId).toBe("different-session")
    expect(chat.sending).toBe(false)
    expect(chat.submissionPending).toBe(false)
    expect(chat.streaming).toBeNull()
  })

  it.each([
    ["new-session POST rejection", null, "reject", "no ack"],
    ["empty acknowledgement", null, "empty", "The chat submission response did not acknowledge the expected session."],
    ["existing-session POST rejection", "existing-session", "reject", "no ack"],
  ] as const)("keeps %s unconfirmed without rerunning a previous turn", async (_case, id, mode, message) => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    if (mode === "reject") vi.mocked(agentClient.sendMessage).mockRejectedValueOnce(new Error("no ack"))
    else vi.mocked(agentClient.sendMessage).mockResolvedValueOnce(acknowledge("   "))
    const { chat } = await mount(id)
    await settleChat(async () => {
      await expect(chat.send("do not lose this")).resolves.toEqual({ kind: "unconfirmed", operationId: 1 })
    })
    expect(chat.sendFailure).toEqual({ kind: "submission-unconfirmed", operationId: 1, sessionId: id, message })
    expect(agentClient.sendMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "do not lose this", session_id: id ?? undefined }),
    )
    expect(chat.submissionPending).toBe(false)
    expect(chat.sending).toBe(false)
    await settleChat(() => chat.retry())
    expect(agentClient.sendMessage).toHaveBeenCalledTimes(1)
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(agentClient.subscribeToEvents).not.toHaveBeenCalled()
    expect(agentClient.truncateSessionMessages).not.toHaveBeenCalled()
    expect(appStore.getState().refreshChatsNow).not.toHaveBeenCalled()
    expect(appStore.getState().loadChatHistory).not.toHaveBeenCalled()
    expect(getUsedModels()).toEqual([])
  })
})

describe("createChat pending user reconciliation", () => {
  it.each(["main", "bound"] as const)("keeps the %s pane's user bubble until the exact ACK appears in history", async (mode) => {
    const id = "delayed-user-history"
    const text = "repeat the same request"
    const oldUser = user("old-user", text)
    const oldAssistant = { id: "old-reply", role: "assistant", type: "text", content: "previous response", createdAt: timestamp } as const
    appStore.setState({ chats: [session(id, [oldUser, oldAssistant])], currentSessionId: id })
    const initialHistory = deferred<void>()
    vi.mocked(appStore.getState().loadChatHistory).mockReturnValueOnce(initialHistory.promise)
    vi.mocked(agentClient.sendMessage).mockResolvedValueOnce(acknowledge(id, "acknowledged-user"))
    const renders: PendingSnapshot[] = []
    const { chat } = await mount(mode === "main" ? undefined : id, { onProjection: (value) => renders.push(value) })
    const expectPending = () => {
      expect(chat.pendingUserText).toBe(text)
      expect(chat.pendingUserImages).toEqual([expect.objectContaining({ name: image.name })])
    }
    await settleChat(() => chat.send(text, { images: [image] }))
    expectPending()
    await settleChat(() => initialHistory.resolve())
    expectPending()
    await settleChat(() => publishMessages(id, [oldUser, oldAssistant], true))
    expectPending()

    const currentAnswer = "reply before user history"
    const handlers = vi.mocked(agentClient.subscribeToEvents).mock.calls[0][1]
    await settleChat(async () => {
      handlers.onToken?.(currentAnswer)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    expect(chat.streaming).toBe(currentAnswer)
    expectPending()
    const currentAssistant = { ...oldAssistant, id: "current-reply", content: currentAnswer }
    await settleChat(() => publishMessages(id, [oldUser, oldAssistant, currentAssistant]))
    expectPending()
    renders.length = 0
    await settleChat(() => publishMessages(id, [oldUser, oldAssistant, user("acknowledged-user", text), currentAssistant]))
    expect(chat.pendingUserText).toBeNull()
    expect(chat.pendingUserImages).toHaveLength(0)
    expect(renders.length).toBeGreaterThan(0)
    expect(renders.every((value) => value.pending === null && value.messages.filter((message) => message.role === "user").length === 2)).toBe(true)
    expect(appStore.getState().loadChatHistory).toHaveBeenLastCalledWith(id, { mode: "monotonic" })
  })

  it("matches a new user ID when the ACK has no message ID, even with identical text", async () => {
    const id = "legacy-acknowledgement"
    const text = "same text"
    const oldUser = user("old-user", text)
    appStore.setState({ chats: [session(id, [oldUser])] })
    vi.mocked(agentClient.sendMessage).mockResolvedValueOnce(acknowledge(id))
    const { chat } = await mount(id)
    await settleChat(() => chat.send(text))
    expect(chat.pendingUserText).toBe(text)
    await settleChat(() => publishMessages(id, [oldUser, user("unrelated-user", "other request")]))
    expect(chat.pendingUserText).toBe(text)
    await settleChat(() => publishMessages(id, [oldUser, user("new-user", text)]))
    expect(chat.pendingUserText).toBeNull()
  })

  it("does not let an earlier history request retire a later send of the same text", async () => {
    const id = "repeated-operations"
    const text = "again"
    const firstHistory = deferred<void>()
    const secondHistory = deferred<void>()
    const firstSubscription = deferred<void>()
    const firstUser = user("first-user", text)
    appStore.setState({ chats: [session(id)] })
    vi.mocked(agentClient.sendMessage)
      .mockResolvedValueOnce(acknowledge(id, firstUser.id))
      .mockResolvedValueOnce(acknowledge(id, "second-user"))
    vi.mocked(appStore.getState().loadChatHistory)
      .mockReturnValueOnce(firstHistory.promise).mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(secondHistory.promise)
    vi.mocked(agentClient.subscribeToEvents).mockReturnValueOnce(firstSubscription.promise)
    const { chat } = await mount(id)
    await settleChat(() => chat.send(text))
    await settleChat(() => publishMessages(id, [firstUser]))
    expect(chat.pendingUserText).toBeNull()
    const firstStream = vi.mocked(agentClient.subscribeToEvents).mock.calls[0][1]
    await settleChat(() => {
      firstStream.onComplete?.(undefined)
      firstSubscription.resolve()
    })
    expect(chat.sending).toBe(false)
    await settleChat(() => chat.send(text))
    expect(chat.pendingUserText).toBe(text)
    await settleChat(() => {
      firstHistory.resolve()
      secondHistory.resolve()
    })
    expect(chat.pendingUserText).toBe(text)
    await settleChat(() => publishMessages(id, [firstUser, user("second-user", text)]))
    expect(chat.pendingUserText).toBeNull()
    expect(chat.messages.filter((message) => message.role === "user")).toHaveLength(2)
  })

  it.each(["complete", "error", "cancelled"] as const)("retains the user bubble when %s history omits the ACK", async (terminal) => {
    const id = "stale-terminal-user-history"
    const text = "accepted user message"
    const initialHistory = deferred<void>()
    const terminalHistory = deferred<void>()
    const subscription = deferred<void>()
    let handlers!: AgentEventHandlers
    appStore.setState({ chats: [session(id)] })
    vi.mocked(agentClient.sendMessage).mockResolvedValueOnce(acknowledge(id, "accepted-user"))
    vi.mocked(appStore.getState().loadChatHistory).mockReturnValueOnce(initialHistory.promise).mockReturnValueOnce(terminalHistory.promise)
    vi.mocked(agentClient.subscribeToEvents).mockImplementationOnce((_id, callbacks) => {
      handlers = callbacks
      return subscription.promise
    })
    const { chat } = await mount(id)
    await settleChat(() => chat.send(text, { images: [image] }))
    await settleChat(() => {
      if (terminal === "complete") handlers.onComplete?.(undefined)
      else if (terminal === "error") handlers.onError?.("generation failed")
      else handlers.onCancelled?.()
      subscription.resolve()
      terminalHistory.resolve()
    })
    expect(chat.sending).toBe(false)
    expect(chat.pendingUserText).toBe(text)
    expect(chat.pendingUserImages[0]?.name).toBe(image.name)
    await settleChat(() => publishMessages(id, [user("accepted-user", text)]))
    expect(chat.pendingUserText).toBeNull()
    expect(chat.pendingUserImages).toHaveLength(0)
    await settleChat(() => initialHistory.resolve())
    expect(chat.pendingUserText).toBeNull()
    expect(chat.pendingUserImages).toHaveLength(0)
  })
})
