import { createEffect, createRoot, createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiClient } from "@services/api"
import { NetworkRequestError } from "@services/api/errors"
import { agentClient, type AgentEventHandlers, type ChatResponse, type ExecuteResponse, type SessionSummary } from "@services/chat/AgentService"
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
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
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

describe("createChat interrupted continuation", () => {
  const id = "interrupted-session"
  const messages: Message[] = [
    user("interrupted-user", "Use the existing conversation"),
    { id: "partial-answer", role: "assistant", type: "text", content: "Saved partial answer", createdAt: timestamp },
  ]

  function interruptedSession(detail: Partial<SessionSummary> = {}, chat: Partial<ChatItem> = {}) {
    appStore.setState({ chats: [{ ...session(id, messages), kind: "root", lastRunStatus: "cancelled",
      isRunning: false, messageCount: messages.length, ...chat }] })
    vi.mocked(agentClient.getSession).mockResolvedValue({ session: {
      id, kind: "root", root_session_id: id, spawn_depth: 0, title: id, title_version: 0, pinned: false,
      model, created_at: timestamp, updated_at: timestamp, last_activity_at: timestamp,
      message_count: messages.length, has_attachments: false, is_running: false, has_pending_question: false,
      last_run_status: "cancelled", resume_interrupted: true, ...detail,
    } })
    return vi.spyOn(apiClient, "postOnce").mockResolvedValue({
      session_id: id, status: "started", run_id: "resume-run", events_url: "/v2/stream",
    })
  }

  it.each(["cancelled", "running"])("continues saved %s history through one exact execution without sending or truncating", async (status) => {
    const continueExecution = interruptedSession({ last_run_status: status }, { lastRunStatus: status })
    const { chat } = await mount(id)
    await vi.waitFor(() => expect(chat.canResumeInterrupted).toBe(true))
    const continuation = chat.resumeInterrupted()
    await expect(chat.resumeInterrupted()).resolves.toBe(false)
    await settleChat()
    expect(continueExecution).toHaveBeenCalledExactlyOnceWith(`execute/${id}`, { resume_interrupted: true })
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.truncateSessionMessages).not.toHaveBeenCalled()
    expect(chat.pendingUserText).toBeNull()
    expect(chat.messages).toEqual(messages)

    await settleChat(() => vi.mocked(agentClient.subscribeToEvents).mock.calls[0][1].onComplete?.(undefined))
    await expect(continuation).resolves.toBe(true)
  })

  it("attaches the stream only after the interrupted execute is acknowledged", async () => {
    const receipt = deferred<ExecuteResponse>()
    const continueExecution = interruptedSession().mockReturnValueOnce(receipt.promise)
    const { chat } = await mount(id)
    await vi.waitFor(() => expect(chat.canResumeInterrupted).toBe(true))

    const continuation = chat.resumeInterrupted()
    await settleChat()
    expect(continueExecution).toHaveBeenCalledOnce()
    expect(agentClient.subscribeToEvents).not.toHaveBeenCalled()

    await settleChat(() => receipt.resolve({
      session_id: id, status: "started", run_id: "resume-run", events_url: "/v2/stream",
    }))
    const subscriptions = vi.mocked(agentClient.subscribeToEvents).mock.calls
    expect(subscriptions).toHaveLength(1)
    expect(subscriptions[0][0]).toBe(id)
    await settleChat(() => subscriptions[0][1].onComplete?.(undefined))
    await expect(continuation).resolves.toBe(true)
  })

  it.each([
    { reason: "the server did not authorize a resume", detail: { resume_interrupted: false }, chat: {} },
    { reason: "the server has no resume support", detail: { resume_interrupted: undefined }, chat: {} },
    { reason: "the session is running", detail: {}, chat: { isRunning: true } },
  ])("refuses to continue when $reason", async ({ detail, chat: override }) => {
    const continueExecution = interruptedSession(detail, override)
    const { chat } = await mount(id)
    expect(chat.canResumeInterrupted).toBe(false)
    await expect(chat.resumeInterrupted()).resolves.toBe(false)
    expect(continueExecution).not.toHaveBeenCalled()
  })

  it("does not resume while a clarification is waiting for an answer", async () => {
    const continueExecution = interruptedSession()
    vi.mocked(agentClient.getPendingQuestion).mockResolvedValue({
      has_pending_question: true, interaction_kind: "clarification", permission_request: null,
      question: "Which branch?", options: ["main"], allow_custom: true, tool_call_id: "question/one",
    })
    const { chat } = await mount(id)
    await vi.waitFor(() => expect(chat.pendingQuestion?.tool_call_id).toBe("question/one"))
    expect(chat.canResumeInterrupted).toBe(false)
    await expect(chat.resumeInterrupted()).resolves.toBe(false)
    expect(continueExecution).not.toHaveBeenCalled()
  })
})

const historyReads = () => vi.mocked(appStore.getState().loadChatHistory)
const uploadFixture = (name: string) => ({ ...image, name })

function hydrateUserImageTurn(sessionId: string, content: string, id: string) {
  const chat = appStore.getState().chats.find((item) => item.id === sessionId)!
  publishMessages(sessionId, [...chat.messages, user(id, content)])
}

describe("Solid image attachment visibility", () => {
  it.each([
    { known: "neither", lateSecondAck: false }, { known: "first", lateSecondAck: false }, { known: "second", lateSecondAck: false },
    { known: "neither", lateSecondAck: true }, { known: "first", lateSecondAck: true }, { known: "second", lateSecondAck: true },
  ])("uses distinct canonical messages for consecutive legacy image-only ACKs (%j)", async ({ known, lateSecondAck }) => {
    const sid = "legacy-image-queue", history = deferred<void>()
    const secondAck = deferred<ChatResponse>()
    const image = uploadFixture("first.gif")
    appStore.setState({ chats: [session(sid)] })
    vi.mocked(agentClient.sendMessage).mockResolvedValueOnce(acknowledge(sid, known === "first" ? "first-legacy-user" : undefined))
      .mockReturnValueOnce(secondAck.promise)
    historyReads().mockImplementation((_id: string, options?: { mode?: string; waitForAssistant?: boolean }) =>
      options?.mode === "monotonic" && !options.waitForAssistant ? history.promise : Promise.resolve())
    vi.mocked(agentClient.subscribeToEvents).mockImplementation(async (_sid, handlers) => { handlers.onComplete?.(undefined) })
    const pane = await mount(sid)
    await settleChat(async () => { await pane.chat.send("", { images: [image] }) })
    const sending = pane.chat.send("", { images: [{ ...image, name: "second.gif" }] })
    const acknowledgeSecond = () => settleChat(async () => {
      secondAck.resolve(acknowledge(sid, known === "second" ? "second-legacy-user" : undefined))
      expect((await sending).kind).toBe("accepted")
    })
    if (!lateSecondAck) await acknowledgeSecond()
    expect(pane.chat.pendingUserMessages).toHaveLength(lateSecondAck ? 1 : 2)
    // Reserve a known ID before fallback matching. A pre-ACK canonical snapshot
    // uses chronological order because old replies cannot identify message IDs.
    const firstCanonical = !lateSecondAck && known === "second" ? "second" : "first"
    hydrateUserImageTurn(sid, "", `${firstCanonical}-legacy-user`)
    await settleChat()
    if (lateSecondAck) await acknowledgeSecond()
    const remaining = firstCanonical === "first" ? "second" : "first"
    expect(pane.chat.pendingUserMessages).toHaveLength(1)
    expect(pane.chat.pendingUserMessages[0].images[0].name).toBe(`${remaining}.gif`)
    await settleChat(() => history.resolve())
    expect(pane.chat.pendingUserMessages).toHaveLength(1)
    hydrateUserImageTurn(sid, "", `${remaining}-legacy-user`)
    await settleChat()
    expect(pane.chat.pendingUserMessages).toHaveLength(0)
    expect(vi.mocked(agentClient.sendMessage)).toHaveBeenCalledTimes(2); expect(agentClient.execute).toHaveBeenCalledTimes(2)
  })
  it("does not replay an unconfirmed image POST after an older legacy ACK becomes canonical", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sid = "unconfirmed-legacy-image", secondAck = deferred<ChatResponse>()
    const image = uploadFixture("first.gif")
    appStore.setState({ chats: [session(sid)] })
    vi.mocked(agentClient.sendMessage).mockResolvedValueOnce(acknowledge(sid)).mockReturnValueOnce(secondAck.promise)
      .mockResolvedValueOnce(acknowledge(sid))
    vi.mocked(agentClient.subscribeToEvents).mockImplementation(async (_sid, handlers) => { handlers.onComplete?.(undefined) })
    const pane = await mount(sid)
    await settleChat(async () => { await pane.chat.send("", { images: [image] }) })
    const sending = pane.chat.send("", { images: [{ ...image, name: "second.gif" }] })
    hydrateUserImageTurn(sid, "", "first-user")
    await settleChat()
    await settleChat(async () => { secondAck.reject(new NetworkRequestError()); expect((await sending).kind).toBe("unconfirmed") })
    expect(pane.chat.pendingUserMessages).toHaveLength(0)
    expect(vi.mocked(agentClient.sendMessage)).toHaveBeenCalledTimes(2); expect(agentClient.execute).toHaveBeenCalledTimes(1)
    await settleChat(async () => { await pane.chat.send("", { images: [{ ...image, name: "second.gif" }] }) })
    expect(pane.chat.pendingUserMessages).toHaveLength(1)
    expect(pane.chat.pendingUserImages[0]?.name).toBe("second.gif")
    hydrateUserImageTurn(sid, "", "explicit-retry-user")
    await settleChat()
    expect(pane.chat.pendingUserMessages).toHaveLength(0)
    expect(vi.mocked(agentClient.sendMessage)).toHaveBeenCalledTimes(3); expect(agentClient.execute).toHaveBeenCalledTimes(2)
  })
  it.each([
    { newSession: false, caption: "" }, { newSession: false, caption: "late caption" },
    { newSession: true, caption: "" }, { newSession: true, caption: "late caption" },
  ])("retains a late image ACK after navigating away before POST resolves (%j)", async ({ newSession, caption }) => {
    const a = "late-image-ack", b = "viewed-while-posting", acknowledgement = deferred<ChatResponse>()
    const image = uploadFixture("late.gif")
    appStore.setState({ chats: [session(a), session(b)] })
    vi.mocked(agentClient.sendMessage).mockReturnValueOnce(acknowledgement.promise)
    const created = vi.fn()
    const select = vi.spyOn(appStore.getState(), "selectSession")
    const pane = await mount(newSession ? null : a, { onSessionCreated: created })
    const sending = pane.chat.send(caption, { images: [image] })
    await settleChat(() => pane.rebind(b))
    await settleChat(async () => { expect(await pane.chat.send("B waits for A's ACK", { images: [image] })).toEqual({ kind: "busy" }) })
    expect(vi.mocked(agentClient.sendMessage)).toHaveBeenCalledTimes(1)
    await settleChat(async () => {
      acknowledgement.resolve(acknowledge(a, "late-exact-ack"))
      expect(await sending).toMatchObject({ kind: "accepted", sessionId: a, navigated: false })
    })
    expect(pane.chat.currentSessionId).toBe(b)
    expect(pane.chat.pendingUserMessages).toHaveLength(0)
    expect(created).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled()
    expect(vi.mocked(agentClient.subscribeToEvents)).not.toHaveBeenCalled()
    expect(agentClient.execute).toHaveBeenCalledTimes(1)
    expect(vi.mocked(agentClient.execute).mock.calls[0][0]).toBe(a)
    await settleChat(() => pane.rebind(a))
    expect(pane.chat.pendingUserMessages).toHaveLength(1)
    expect(pane.chat.pendingUserMessages[0]).toMatchObject({ text: caption, images: [{ name: "late.gif" }] })
    hydrateUserImageTurn(a, caption, "late-exact-ack")
    await settleChat(() => pane.rebind(a))
    expect(pane.chat.pendingUserMessages).toHaveLength(0)
    expect(vi.mocked(agentClient.sendMessage)).toHaveBeenCalledTimes(1); expect(agentClient.execute).toHaveBeenCalledTimes(1)
  })
  it.each([
    { nextImage: false, firstHydrated: 1 }, { nextImage: true, firstHydrated: 1 },
    { nextImage: false, firstHydrated: 2 }, { nextImage: true, firstHydrated: 2 },
  ])("retains consecutive image ACKs in one session until each is canonical (%j)", async ({ nextImage, firstHydrated }) => {
    const sid = "consecutive-image-session", history = deferred<void>()
    const image = uploadFixture("first.gif")
    appStore.setState({ chats: [session(sid)] })
    vi.mocked(agentClient.sendMessage).mockResolvedValueOnce(acknowledge(sid, "ack-1"))
      .mockResolvedValueOnce(acknowledge(sid, "ack-2"))
    historyReads().mockImplementation((_id: string, options?: { mode?: string; waitForAssistant?: boolean }) =>
      options?.mode === "monotonic" && !options.waitForAssistant ? history.promise : Promise.resolve())
    vi.mocked(agentClient.subscribeToEvents).mockImplementation(async (_sid, handlers) => { handlers.onComplete?.(undefined) })
    const pane = await mount(sid)
    await settleChat(async () => { await pane.chat.send("first caption", { images: [image] }) })
    expect(pane.chat.sending).toBe(false)
    await settleChat(async () => { await pane.chat.send("second caption", { images: nextImage ? [{ ...image, name: "second.gif" }] : [] }) })
    expect(pane.chat.pendingUserMessages.flatMap((item) => item.images.map((entry) => entry.name))).toEqual(nextImage ? ["first.gif", "second.gif"] : ["first.gif"])
    expect(pane.chat.pendingUserMessages.map((item) => item.text)).toEqual(["first caption", "second caption"])
    await settleChat(async () => {
      hydrateUserImageTurn(sid, firstHydrated === 1 ? "first caption" : "second caption", `ack-${firstHydrated}`)
      history.resolve()
    })
    await settleChat()
    expect(pane.chat.pendingUserMessages.map((item) => item.text)).toEqual([firstHydrated === 1 ? "second caption" : "first caption"])
    hydrateUserImageTurn(sid, firstHydrated === 1 ? "second caption" : "first caption", `ack-${firstHydrated === 1 ? 2 : 1}`)
    await settleChat()
    expect(pane.chat.pendingUserMessages).toHaveLength(0)
    expect(vi.mocked(agentClient.sendMessage)).toHaveBeenCalledTimes(2); expect(agentClient.execute).toHaveBeenCalledTimes(2)
  })
  it.each([false, true])("keeps A's delayed image after B sends (B image=%s), retiring each exact acknowledgement independently", async (bHasImage) => {
    const a = "image-a", b = "image-b", firstRead = deferred<void>()
    const image = uploadFixture("A.gif")
    appStore.setState({ chats: [session(a), session(b)] })
    vi.mocked(agentClient.sendMessage).mockResolvedValueOnce(acknowledge(a, "ack-a"))
      .mockResolvedValueOnce(acknowledge(b, "ack-b"))
    // Delay only ACK hydration; the completed run's separate canonical read
    // resolves with old history so another session can submit normally.
    historyReads().mockImplementation((id: string, options?: { mode?: string; waitForAssistant?: boolean }) =>
      id === a && options?.mode === "monotonic" && !options.waitForAssistant ? firstRead.promise : Promise.resolve())
    vi.mocked(agentClient.subscribeToEvents).mockImplementation(async (_sid, handlers) => { handlers.onComplete?.(undefined) })
    const pane = await mount(a)
    await settleChat(async () => { await pane.chat.send("A caption", { images: [image] }) })
    expect(pane.chat.sending).toBe(false)
    expect(pane.chat.pendingUserImages[0]?.name).toBe("A.gif")

    await settleChat(() => pane.rebind(b))
    expect(pane.chat.pendingUserImages).toHaveLength(0)
    await settleChat(async () => { await pane.chat.send("B caption", { images: bHasImage ? [{ ...image, name: "B.gif" }] : [] }) })
    expect(pane.chat.pendingUserText).toBe("B caption")
    expect(pane.chat.pendingUserImages).toHaveLength(bHasImage ? 1 : 0)

    await settleChat(() => pane.rebind(a))
    expect(pane.chat.pendingUserText).toBe("A caption")
    expect(pane.chat.pendingUserImages[0]?.name).toBe("A.gif")
    await settleChat(async () => {
      hydrateUserImageTurn(a, "A caption", "ack-a")
      firstRead.resolve()
    })
    expect(pane.chat.pendingUserImages).toHaveLength(0)
    await settleChat(() => pane.rebind(b))
    expect(pane.chat.pendingUserText).toBe("B caption")
    expect(pane.chat.pendingUserImages[0]?.name).toBe(bHasImage ? "B.gif" : undefined)
    await settleChat(() => hydrateUserImageTurn(b, "B caption", "ack-b"))
    expect(pane.chat.pendingUserText).toBeNull()
    expect(pane.chat.pendingUserImages).toHaveLength(0)
    expect(vi.mocked(agentClient.sendMessage)).toHaveBeenCalledTimes(2)
    expect(agentClient.execute).toHaveBeenCalledTimes(2)
  })
  it.each(["", "caption with image"])("retains acknowledged pending image metadata until exact history hydration (%s)", async (text) => {
    const sid = "image-pending-session", history = deferred<void>()
    const image = uploadFixture("fixture.gif")
    appStore.setState({ chats: [session(sid)] })
    vi.mocked(agentClient.sendMessage).mockResolvedValueOnce(acknowledge(sid, "accepted-image"))
    historyReads().mockReturnValueOnce(history.promise)
    const pane = await mount(sid)
    await settleChat(async () => { await pane.chat.send(text, { images: [image] }) })
    expect(vi.mocked(agentClient.sendMessage).mock.calls[0][0].images).toEqual([image])
    expect(pane.chat.pendingUserText).toBe(text)
    expect(pane.chat.pendingUserImages).toHaveLength(1)
    expect(pane.chat.pendingUserImages[0]).toMatchObject({ name: "fixture.gif", size: 42, type: "image/gif", url: `data:image/gif;base64,${image.base64}` })
    await settleChat(() => pane.rebind("other-session"))
    expect(pane.chat.pendingUserImages).toHaveLength(0)
    await settleChat(() => pane.rebind(sid))
    expect(pane.chat.pendingUserImages).toHaveLength(1)
    await settleChat(async () => {
      publishMessages(sid, [{ id: "accepted-image", role: "user", content: text,
        images: [{ id: "persisted-image", url: "http://localhost:9563/api/v1/sessions/image-pending-session/attachments/image-1", name: "fixture.gif", type: "image/gif", size: 42 }], createdAt: "2026-10-19T00:00:00Z" }])
      history.resolve()
    })
    expect(pane.chat.pendingUserText).toBeNull()
    expect(pane.chat.pendingUserImages).toHaveLength(0)
  })
})
