import { createRoot, createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiClient, getBackendStorageScope } from "@services/api"
import { ApiError, NetworkRequestError } from "@services/api/errors"
import { agentClient, type AgentEventHandlers, type ChatResponse, type ExecuteResponse,
  type RunningSessionsResponse } from "@services/chat/AgentService"
import { clearSessionCompatibilityObservations } from "@services/chat/sessionExecutionCompatibility"
import { appStore } from "@shared/store/appStore/state"
import type { ChatItem, Message } from "@shared/types/chatMessages"
import { invalidateCompletedAnswers, resetCompletedAnswerHandoffsForTest } from "@/lib/completedAnswerHandoffRegistry"
import { beginOrdinaryRetryFence, beginContinuousRetryFence, confirmContinuousRetryFence,
  confirmOrdinaryStartedWithoutRunId, readContinuousRetryFence } from "@/lib/continuousRetryFence"
import { createChat, type SendSubmissionResult } from "./createChat"
import { settleChat } from "./chatInteractionTestHarness"

type SubscriptionHandlers = Required<AgentEventHandlers>
type Observation = Parameters<typeof agentClient.subscribeToEvents>[3]
type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}
const backendScope = getBackendStorageScope()
const model = "test-model"
const legacyCapability = { model: null, system_prompt: "", base_system_prompt: "", default_session_permission_mode: "default" }
const scopes = new Set<() => void>()

// Fixtures represent both complete responses and malformed older wire payloads.
const mocks = {
  apiGet: vi.fn<(path: string, options?: Parameters<typeof apiClient.get>[1]) => Promise<unknown>>(),
  getRunningSessions: vi.fn<(...args: Parameters<typeof agentClient.getRunningSessions>)
    => Promise<{ sessions: Array<Pick<RunningSessionsResponse["sessions"][number], "session_id" | "run_id">> }>>(),
  subscribeToEvents: vi.fn<(id: string, handlers: SubscriptionHandlers, controller: AbortController, observation?: Observation) => Promise<void>>(),
  execute: vi.fn<(...args: Parameters<typeof agentClient.execute>) => Promise<Partial<ExecuteResponse>>>(),
  sendMessage: vi.fn<(...args: Parameters<typeof agentClient.sendMessage>) => Promise<Pick<ChatResponse, "session_id">>>(),
  truncateSessionMessages: vi.fn<(...args: Parameters<typeof agentClient.truncateSessionMessages>) => Promise<void>>(),
  stopGeneration: vi.fn<typeof agentClient.stopGeneration>(),
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const pendingForever = () => new Promise<void>(() => {})

type SessionFixture = Pick<ChatItem, "id" | "messages" | "isRunning" | "lastRunStatus"> & {
  config?: Partial<ChatItem["config"]>
}

function chatFixture(input: SessionFixture): ChatItem {
  return {
    ...input, title: input.id, createdAt: 1,
    config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, model, ...input.config },
  }
}

const seedChats = (entries: SessionFixture[]) => appStore.setState({ chats: entries.map(chatFixture) })
const addChat = (entry: SessionFixture) => appStore.setState((state) => ({ chats: [...state.chats, chatFixture(entry)] }))
const findChat = (id: string) => appStore.getState().chats.find((chat) => chat.id === id)!
const updateChat = (id: string, patch: Partial<ChatItem>) => appStore.setState((state) => ({
  chats: state.chats.map((chat) => chat.id === id ? { ...chat, ...patch } : chat),
}))
const startObserving = (id: string) => appStore.getState().markForceSubscribe(id)
const stopObserving = (id: string) => appStore.getState().resetSession(id)

async function mountPane(initial: string | null) {
  const pane = createRoot((dispose) => {
    const [sessionId, setSessionId] = createSignal(initial)
    const chat = createChat(sessionId)
    scopes.add(dispose)
    return {
      chat,
      rebind: (id: string | null) => settleChat(() => setSessionId(id)),
      unmount: () => { if (scopes.delete(dispose)) dispose() },
    }
  })
  await settleChat()
  return pane
}

beforeEach(() => {
  resetCompletedAnswerHandoffsForTest()
  clearSessionCompatibilityObservations()
  appStore.setState({ ...appStore.getInitialState(),
    loadSubagentSessions: vi.fn(async () => {}),
    loadChatHistory: vi.fn(async () => {}),
    refreshChatsNow: vi.fn(async () => {}),
  }, true)
  vi.spyOn(appStore.getState(), "markCancel")
  vi.spyOn(appStore.getState(), "updateSession")
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.apiGet.mockImplementation(async (path) => {
    if (path === "execute/defaults") return legacyCapability
    throw new Error(`Unexpected retry fixture GET: ${path}`)
  })
  mocks.getRunningSessions.mockResolvedValue({ sessions: [] })
  mocks.execute.mockImplementation(async (id) => ({ session_id: id, status: "started", run_id: "synthetic-default-run" }))
  mocks.subscribeToEvents.mockResolvedValue(undefined)
  mocks.truncateSessionMessages.mockResolvedValue(undefined)
  vi.spyOn(apiClient, "get").mockImplementation((path, options) => mocks.apiGet(path, options) as Promise<never>)
  vi.spyOn(agentClient, "execute").mockImplementation(async (...args) => await mocks.execute(...args) as ExecuteResponse)
  vi.spyOn(agentClient, "sendMessage").mockImplementation(async (...args) => ({ status: "success", ...await mocks.sendMessage(...args) }))
  vi.spyOn(agentClient, "subscribeToEvents").mockImplementation((id, handlers, controller, observation) =>
    observation ? mocks.subscribeToEvents(id, handlers as SubscriptionHandlers, controller!, observation)
      : mocks.subscribeToEvents(id, handlers as SubscriptionHandlers, controller!))
  vi.spyOn(agentClient, "getRunningSessions").mockImplementation(async (...args) => ({
    sessions: (await mocks.getRunningSessions(...args)).sessions.map((entry) => ({
      started_at: "2026-10-06T10:00:00Z", round_count: 0, last_critical_events: [], running_child_session_ids: [],
      ...entry,
    })),
  }))
  vi.spyOn(agentClient, "truncateSessionMessages").mockImplementation(async (id, request) => {
    await mocks.truncateSessionMessages(id, request)
    return { session_id: id, success: true, messages_removed: 0, message_count: 0 }
  })
  vi.spyOn(agentClient, "stopGeneration").mockImplementation((...args) => mocks.stopGeneration(...args))
  vi.spyOn(agentClient, "getSession").mockRejectedValue(new Error("No session detail fixture"))
  vi.spyOn(agentClient, "getPendingQuestion").mockResolvedValue({ has_pending_question: false })
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(async () => {
  for (const dispose of scopes) dispose()
  scopes.clear()
  await settleChat()
  vi.restoreAllMocks()
})

describe("Solid continuous upstream retry and exact Stop", () => {
  const options = { upstreamRetry: { mode: "until_cancelled" as const } }
  const sid = "continuous-session"
  const allow = () => mocks.apiGet.mockImplementation(async (path:string) => path === "execute/defaults"
    ? {upstream_retry:{supported_modes:["bounded","until_cancelled"]}} : {})
  async function persisted() {
    seedChats([{id:sid,messages:[],lastRunStatus:"error",config:{model:"test-model"}}])
    return mountPane(sid)
  }
  it("deduplicates the same continuous retry completion across panes and later canonical history", async () => {
    allow()
    const answer = "Synthetic retry answer after a context summary"
    seedChats([{
      id: sid, lastRunStatus: "error", config: { model: "test-model" },
      messages: [{ id: "retry-user", role: "user", content: "Synthetic request", createdAt: "" }],
    }])
    mocks.execute.mockResolvedValue({ session_id: sid, status: "started", run_id: "shared-retry-run" })
    const streams: Array<{ handlers: SubscriptionHandlers; subscription: Deferred<void> }> = []
    mocks.subscribeToEvents.mockImplementation((_sessionId: string, handlers: SubscriptionHandlers, controller: AbortController) => {
      const subscription = deferred<void>()
      streams.push({ handlers, subscription })
      controller.signal.addEventListener("abort", () => subscription.resolve(), { once: true })
      return subscription.promise
    })
    const first = await mountPane(sid)
    const second = await mountPane(sid)
    let firstRequest!: Promise<void>, secondRequest!: Promise<void>
    await settleChat(async () => { firstRequest = first.chat.retry(undefined, options); await Promise.resolve() })
    await settleChat(async () => { secondRequest = second.chat.retry(undefined, options); await Promise.resolve() })
    expect(streams).toHaveLength(2)
    await settleChat(async () => {
      streams[0].handlers.onContextCompressionStatus("preflight", "started")
      streams[0].handlers.onContextSummarized({ summary: "Synthetic model context", messages_summarized: 1, tokens_saved: 20 })
      streams[0].handlers.onContextCompressionStatus("preflight", "completed")
      for (const stream of streams) {
        stream.handlers.onToken(answer)
        stream.handlers.onComplete(undefined)
        stream.subscription.resolve()
      }
      await firstRequest
      await secondRequest
    })
    first.unmount(); second.unmount()
    const restored = await mountPane(sid)
    const answerBodies = () => restored.chat.messages.flatMap((message) =>
      message.role === "assistant" && "content" in message && message.content === answer ? [message.content] : [])
    expect(answerBodies()).toHaveLength(1)
    expect(restored.chat.messages.some((message) => "content" in message && message.content === "Synthetic model context")).toBe(false)
    updateChat(sid, { messages: [...findChat(sid).messages, { id: "retry-answer", role: "assistant", type: "text", content: answer, createdAt: "" }] })
    await restored.rebind(sid); await settleChat()
    expect(answerBodies()).toHaveLength(1)
    expect(restored.chat.messages.some((message) => message.id.startsWith("completed-answer-handoff-"))).toBe(false)
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.truncateSessionMessages).not.toHaveBeenCalled()
  })
  it("keeps a delayed exact Stop after answer invalidation and ignores late output", async () => {
    allow()
    const ack = deferred<{ session_id: string; status: "started"; run_id: string }>()
    const subscription = deferred<void>()
    let handlers!: SubscriptionHandlers
    mocks.execute.mockReturnValue(ack.promise)
    mocks.stopGeneration.mockResolvedValue(undefined)
    mocks.subscribeToEvents.mockImplementation((_sessionId: string, next: SubscriptionHandlers, controller: AbortController) => {
      handlers = next
      controller.signal.addEventListener("abort", () => subscription.resolve(), { once: true })
      return subscription.promise
    })
    const hook = await persisted(); let request!: Promise<void>
    await settleChat(async () => { request = hook.chat.retry(undefined, options) })
    await settleChat(async () => {
      invalidateCompletedAnswers(sid)
      handlers.onToken("Synthetic stale answer")
      handlers.onComplete(undefined)
      hook.chat.stop()
    })
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    await settleChat(async () => {
      ack.resolve({ session_id: sid, status: "started", run_id: "cleared-original-run" })
      await request
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(sid, "cleared-original-run")
    expect(hook.chat.messages.some((message) => "content" in message && message.content === "Synthetic stale answer")).toBe(false)
    expect(hook.chat.streaming).not.toBe("Synthetic stale answer")
  })
  it("carries the negotiated live bootstrap opt-in only on the initial Execute", async () => {
    const target = "live-initial-execute"
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target })
    mocks.execute.mockResolvedValue({ session_id: target, status: "started", run_id: "live-run" })
    mocks.subscribeToEvents.mockReturnValue(pendingForever())
    const hook = await mountPane(target)
    await settleChat(async () => { await hook.chat.send("one synthetic request", { liveBootstrapResume: true }) })
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(target, "test-model", undefined, undefined, undefined, undefined, true)
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(mocks.truncateSessionMessages).not.toHaveBeenCalled()
  })
  it("does not add live bootstrap opt-in to an ordinary send when not negotiated", async () => {
    const target = "live-initial-unsupported"
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target })
    mocks.execute.mockResolvedValue({ session_id: target, status: "started", run_id: "ordinary-run" })
    mocks.subscribeToEvents.mockReturnValue(pendingForever())
    const hook = await mountPane(target)
    await settleChat(async () => { await hook.chat.send("one synthetic request") })
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(target, "test-model", undefined, undefined, undefined)
  })
  it("negotiates once, fences duplicate clicks and executes without Chat or truncate", async () => {
    const cap=deferred<unknown>();mocks.apiGet.mockReturnValue(cap.promise)
    const subscription=deferred<void>();mocks.subscribeToEvents.mockReturnValue(subscription.promise)
    mocks.execute.mockResolvedValue({session_id:sid,status:"started",run_id:"new-run"})
    const hook=await persisted();let first!:Promise<void>
    await settleChat(()=>{first=hook.chat.retry(undefined,options);void hook.chat.retry(undefined,options)})
    expect(mocks.execute).not.toHaveBeenCalled()
    await settleChat(async()=>cap.resolve({upstream_retry:{supported_modes:["until_cancelled"]}}))
    expect(mocks.apiGet).toHaveBeenCalledExactlyOnceWith("execute/defaults",{cache:"no-store"})
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(sid,"test-model",undefined,undefined,undefined,{mode:"until_cancelled"})
    expect(mocks.sendMessage).not.toHaveBeenCalled();expect(mocks.truncateSessionMessages).not.toHaveBeenCalled()
    expect(hook.chat.upstreamRetryStatus).toBe("enabled")
    await settleChat(async()=>{subscription.resolve();await first})
  })
  it.each([{}, {upstream_retry:{supported_modes:["bounded"]}}])("does not execute against old/unsupported producer %j",async(value)=>{
    mocks.apiGet.mockResolvedValue(value);const hook=await persisted()
    await settleChat(async()=>{await hook.chat.retry(undefined,options)})
    expect(mocks.execute).not.toHaveBeenCalled();expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.truncateSessionMessages).not.toHaveBeenCalled();expect(hook.chat.upstreamRetryStatus).toBe("unavailable")
  })
  it("discards read-only negotiation after navigating away and back",async()=>{
    const cap=deferred<unknown>();mocks.apiGet.mockReturnValue(cap.promise);const hook=await persisted();let request!:Promise<void>
    await settleChat(()=>{request=hook.chat.retry(undefined,options)})
    await hook.rebind("other");await hook.rebind(sid)
    await settleChat(async()=>{cap.resolve({upstream_retry:{supported_modes:["until_cancelled"]}});await request})
    expect(mocks.execute).not.toHaveBeenCalled();expect(mocks.sendMessage).not.toHaveBeenCalled()
  })
  it("does not issue Execute when the identity marker cannot be stored", async () => {
    allow()
    const hook = await persisted()
    const blocked = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("blocked") })
    await settleChat(async () => { await hook.chat.retry(undefined, options) })
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(hook.chat.upstreamRetryStatus).toBe("identity_unavailable")
    blocked.mockRestore()
  })
  it("reports when an acknowledged run identity cannot be saved", async () => {
    allow()
    const ack = deferred<{ session_id: string; status: "started"; run_id: string }>()
    const sub = deferred<void>()
    mocks.execute.mockReturnValue(ack.promise)
    mocks.subscribeToEvents.mockReturnValue(sub.promise)
    const hook = await persisted(); let request!: Promise<void>
    await settleChat(async () => { request = hook.chat.retry(undefined, options) })
    const blocked = vi.spyOn(sessionStorage, "setItem").mockImplementation(() => { throw new Error("blocked") })
    await settleChat(async () => { ack.resolve({ session_id: sid, status: "started", run_id: "original-run" }); await Promise.resolve() })
    expect(hook.chat.upstreamRetryStatus).toBe("identity_unsaved")
    blocked.mockRestore()
    await settleChat(async () => { sub.resolve(); await request })
  })
  it("does not fall back to session-only Stop when stored identity cannot be read", async () => {
    const other = "storage-unavailable-session"
    seedChats([{ id: other, messages: [], isRunning: true, config: { model: "test-model" } }])
    const hook = await mountPane(other)
    const blocked = vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
    await settleChat(async () => { hook.chat.stop(); await Promise.resolve() })
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    expect(appStore.getState().markCancel).not.toHaveBeenCalled()
    expect(hook.chat.upstreamRetryStatus).toBe("identity_unavailable")
    blocked.mockRestore()
  })
  it("waits for the exact Execute ACK before Stop and coalesces repeated clicks",async()=>{
    allow();const ack=deferred<{session_id:string;status:"started";run_id:string}>();const sub=deferred<void>()
    mocks.execute.mockReturnValue(ack.promise);mocks.subscribeToEvents.mockReturnValue(sub.promise);mocks.stopGeneration.mockResolvedValue(undefined)
    const hook=await persisted();let request!:Promise<void>
    await settleChat(async()=>{request=hook.chat.retry(undefined,options)})
    await settleChat(async()=>{hook.chat.stop();hook.chat.stop()})
    expect(mocks.stopGeneration).not.toHaveBeenCalled();expect(hook.chat.upstreamRetryStatus).toBe("stopping")
    await settleChat(async()=>{ack.resolve({session_id:sid,status:"started",run_id:"exact-original-run"});await Promise.resolve();await Promise.resolve()})
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(sid,"exact-original-run")
    expect(hook.chat.upstreamRetryStatus).toBe("stop_requested")
    await settleChat(async()=>{sub.resolve();await request})
    await hook.rebind("other");expect(hook.chat.upstreamRetryStatus).toBeNull()
  })
  it("does not send an exact Stop if the producer no longer advertises the capability", async () => {
    allow()
    mocks.execute.mockResolvedValue({ session_id: sid, status: "started", run_id: "original-run" })
    const sub = deferred<void>(); mocks.subscribeToEvents.mockReturnValue(sub.promise)
    const hook = await persisted(); let request!: Promise<void>
    await settleChat(async () => { request = hook.chat.retry(undefined, options) })
    mocks.apiGet.mockResolvedValue({})
    await settleChat(async () => { hook.chat.stop(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    expect(appStore.getState().markCancel).not.toHaveBeenCalled()
    expect(hook.chat.upstreamRetryStatus).toBe("stop_unconfirmed")
    await settleChat(async () => { sub.resolve(); await request })
  })
  it("retries a failed exact Stop only after another explicit click", async () => {
    allow()
    mocks.execute.mockResolvedValue({ session_id: sid, status: "started", run_id: "original-run" })
    mocks.stopGeneration.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce(undefined)
    const sub = deferred<void>(); mocks.subscribeToEvents.mockReturnValue(sub.promise)
    const hook = await persisted(); let request!: Promise<void>
    await settleChat(async () => { request = hook.chat.retry(undefined, options) })
    await settleChat(async () => { hook.chat.stop(); for (let i = 0; i < 8; i++) await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(sid, "original-run")
    expect(hook.chat.upstreamRetryStatus).toBe("stop_unconfirmed")
    await settleChat(async () => { hook.chat.stop(); for (let i = 0; i < 8; i++) await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledTimes(2)
    expect(mocks.stopGeneration).toHaveBeenLastCalledWith(sid, "original-run")
    expect(hook.chat.upstreamRetryStatus).toBe("stop_requested")
    await settleChat(async () => { sub.resolve(); await request })
  })
  it("does not mark a successor stopped when an exact Stop is rejected", async () => {
    allow()
    mocks.execute.mockResolvedValue({ session_id: sid, status: "started", run_id: "original-run" })
    mocks.stopGeneration.mockRejectedValue(new Error("stale run"))
    const sub = deferred<void>(); mocks.subscribeToEvents.mockReturnValue(sub.promise)
    const hook = await persisted(); let request!: Promise<void>
    await settleChat(async () => { request = hook.chat.retry(undefined, options) })
    await settleChat(async () => { hook.chat.stop(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(sid, "original-run")
    expect(appStore.getState().markCancel).not.toHaveBeenCalled()
    expect(appStore.getState().updateSession).not.toHaveBeenCalledWith(sid, { isRunning: false }, { skipBackendPatch: true })
    expect(hook.chat.upstreamRetryStatus).toBe("stop_unconfirmed")
    await settleChat(async () => { sub.resolve(); await request })
  })
  it.each([{}, {session_id:sid}, {session_id:"other",run_id:"foreign-run"}])("never sends an unfenced Stop for malformed ACK %j",async(ack)=>{
    allow();mocks.execute.mockResolvedValue(ack);const sub=deferred<void>();mocks.subscribeToEvents.mockReturnValue(sub.promise)
    const hook=await persisted();let request!:Promise<void>
    await settleChat(async()=>{request=hook.chat.retry(undefined,options)})
    await settleChat(async()=>{hook.chat.stop();await Promise.resolve();await Promise.resolve()})
    expect(mocks.stopGeneration).not.toHaveBeenCalled();expect(hook.chat.upstreamRetryStatus).toBe("stop_unconfirmed")
    await settleChat(async()=>{sub.resolve();await request})
  })
  it("does not stop a pre-existing run when Execute says already_running", async () => {
    allow()
    mocks.execute.mockResolvedValue({ session_id: sid, status: "already_running", run_id: "pre-existing-run" })
    const sub = deferred<void>(); mocks.subscribeToEvents.mockReturnValue(sub.promise)
    const hook = await persisted(); let request!: Promise<void>
    await settleChat(async () => { request = hook.chat.retry(undefined, options); await Promise.resolve() })
    expect(hook.chat.upstreamRetryStatus).toBe("already_running")
    await settleChat(async () => { hook.chat.stop(); await Promise.resolve(); await Promise.resolve() })
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    expect(hook.chat.upstreamRetryStatus).toBe("stop_unconfirmed")
    await settleChat(async () => { sub.resolve(); await request })
  })
  it("reports a completed Execute ACK as not started and leaves no live spinner", async () => {
    allow()
    mocks.execute.mockResolvedValue({ session_id: sid, status: "completed" })
    const sub = deferred<void>(); mocks.subscribeToEvents.mockReturnValue(sub.promise)
    const hook = await persisted(); let request!: Promise<void>
    await settleChat(async () => { request = hook.chat.retry(undefined, options); await Promise.resolve(); await Promise.resolve() })
    expect(hook.chat.upstreamRetryStatus).toBe("not_started")
    expect(hook.chat.streamPhase).toBeNull()
    await settleChat(async () => { sub.resolve(); await request })
  })
  it("keeps a guarded ordinary Stop on its own pending Execute ACK", async () => {
    allow()
    const target = "guarded-ordinary-pending"
    const prior = beginContinuousRetryFence(backendScope, target)!
    expect(confirmContinuousRetryFence(prior, "previous-run")).toBe(true)
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target })
    const ack = deferred<{ session_id: string; status: "started"; run_id: string }>()
    mocks.execute.mockReturnValue(ack.promise); mocks.stopGeneration.mockResolvedValue(undefined)
    mocks.subscribeToEvents.mockImplementation((_sid: string, _h: SubscriptionHandlers, controller: AbortController) => {
      const sub = deferred<void>(); controller.signal.addEventListener("abort", () => sub.resolve(), { once: true }); return sub.promise
    })
    const hook = await mountPane(target)
    await settleChat(async () => { await hook.chat.send("ordinary follow-up") })
    await settleChat(async () => { hook.chat.stop(); await Promise.resolve(); await Promise.resolve() })
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    await settleChat(async () => { ack.resolve({ session_id: target, status: "started", run_id: "new-ordinary-run" }); for (let i=0;i<8;i++) await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(target, "new-ordinary-run")
  })
  it("does not let an old unguarded pane stop a newer continuous run", async () => {
    allow()
    const target = "unguarded-older-pane"
    seedChats([{ id: target, messages: [], lastRunStatus: "error", config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target })
    mocks.execute.mockResolvedValueOnce({ session_id: target, status: "started", run_id: "ordinary-old" })
      .mockResolvedValueOnce({ session_id: target, status: "started", run_id: "continuous-new" })
    mocks.stopGeneration.mockResolvedValue(undefined)
    mocks.subscribeToEvents.mockImplementation((_sid: string, _h: SubscriptionHandlers, controller: AbortController) => {
      const sub = deferred<void>(); controller.signal.addEventListener("abort", () => sub.resolve(), { once: true }); return sub.promise
    })
    const old = await mountPane(target)
    await settleChat(async () => { await old.chat.send("old ordinary turn"); await Promise.resolve() })
    const newer = await mountPane(target); let newerRequest!: Promise<void>
    await settleChat(async () => { newerRequest = newer.chat.retry(undefined, options); await Promise.resolve() })
    await settleChat(async () => { old.chat.stop(); for (let i=0;i<8;i++) await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(target, "ordinary-old")
    newer.unmount(); await settleChat(async () => { await newerRequest })
  })
  it("retains the detached ordinary Execute ACK after switching sessions", async () => {
    allow()
    const target = "detached-ordinary-followup"
    const prior = beginContinuousRetryFence(backendScope, target)!
    expect(confirmContinuousRetryFence(prior, "previous-run")).toBe(true)
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }, { id: "other", messages: [] }])
    const chatAck = deferred<{ session_id: string }>(); mocks.sendMessage.mockReturnValue(chatAck.promise)
    mocks.execute.mockResolvedValue({ session_id: target, status: "started", run_id: "detached-new" })
    mocks.stopGeneration.mockResolvedValue(undefined)
    const hook = await mountPane(target); let sending!: Promise<SendSubmissionResult>
    await settleChat(() => { sending = hook.chat.send("follow-up before leaving") })
    await settleChat(async () => { hook.chat.select("other") }); await hook.rebind("other")
    await settleChat(async () => { chatAck.resolve({ session_id: target }); await sending; await Promise.resolve() })
    await hook.rebind(target)
    await settleChat(async () => { hook.chat.stop(); for (let i=0;i<8;i++) await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(target, "detached-new")
  })
  it("retains the detached ordinary retry Execute ACK after preparation and navigation", async () => {
    allow()
    const target = "detached-ordinary-rerun"
    const prior = beginContinuousRetryFence(backendScope, target)!
    expect(confirmContinuousRetryFence(prior, "previous-run")).toBe(true)
    seedChats([{ id: target, messages: [], lastRunStatus: "error", config: { model: "test-model" } }, { id: "other", messages: [] }])
    const prepared = deferred<void>(); mocks.truncateSessionMessages.mockReturnValue(prepared.promise)
    mocks.execute.mockResolvedValue({ session_id: target, status: "started", run_id: "detached-rerun" })
    mocks.stopGeneration.mockResolvedValue(undefined)
    const hook = await mountPane(target); let retrying!: Promise<void>
    await settleChat(() => { retrying = hook.chat.retry() })
    await settleChat(async () => { hook.chat.select("other") }); await hook.rebind("other")
    await settleChat(async () => { prepared.resolve(); await retrying; await Promise.resolve() })
    await hook.rebind(target)
    await settleChat(async () => { hook.chat.stop(); for (let i=0;i<8;i++) await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(target, "detached-rerun")
  })
  it("keeps the later ordinary reservation when older and newer ACKs both arrive late", async () => {
    allow()
    const target = "two-ordinary-starts"
    const prior = beginContinuousRetryFence(backendScope, target)!
    expect(confirmContinuousRetryFence(prior, "previous-run")).toBe(true)
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target }); mocks.stopGeneration.mockResolvedValue(undefined)
    const firstAck = deferred<{ session_id: string; status: "started"; run_id: string }>()
    const secondAck = deferred<{ session_id: string; status: "started"; run_id: string }>()
    mocks.execute.mockReturnValueOnce(firstAck.promise).mockReturnValueOnce(secondAck.promise)
    mocks.subscribeToEvents.mockImplementation((_sid: string, _h: SubscriptionHandlers, controller: AbortController) => {
      const sub = deferred<void>(); controller.signal.addEventListener("abort", () => sub.resolve(), { once: true }); return sub.promise
    })
    const first = await mountPane(target)
    const second = await mountPane(target)
    await settleChat(async () => { await first.chat.send("first turn") })
    await settleChat(async () => { await second.chat.send("later turn") })
    await settleChat(async () => { firstAck.resolve({ session_id: target, status: "started", run_id: "ordinary-first" }); await Promise.resolve() })
    await settleChat(async () => { secondAck.resolve({ session_id: target, status: "started", run_id: "ordinary-second" }); await Promise.resolve(); await Promise.resolve() })
    expect(readContinuousRetryFence(backendScope, target)).toEqual({ kind: "confirmed", runId: "ordinary-second" })
    await settleChat(async () => { second.chat.stop(); for (let i=0;i<8;i++) await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(target, "ordinary-second")
  })
  it("keeps unguarded ordinary chat working when browser storage writes are blocked", async () => {
    const target = "ordinary-storage-write-blocked"
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target }); mocks.execute.mockResolvedValue({ session_id: target, status: "started", run_id: "ordinary-run" })
    mocks.stopGeneration.mockResolvedValue(undefined); mocks.subscribeToEvents.mockReturnValue(pendingForever())
    const blocked = vi.spyOn(sessionStorage, "setItem").mockImplementation(() => { throw new Error("write blocked") })
    const hook = await mountPane(target)
    await settleChat(async () => { await hook.chat.send("ordinary message"); await Promise.resolve() })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    await settleChat(async () => { hook.chat.stop(); await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(target)
    blocked.mockRestore()
  })
  it("does not strand an ordinary message when storage cannot be read", async () => {
    allow()
    const target = "ordinary-storage-read-blocked"
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target }); mocks.execute.mockResolvedValue({ session_id: target, status: "started", run_id: "known-ordinary-run" })
    mocks.stopGeneration.mockResolvedValue(undefined); mocks.subscribeToEvents.mockReturnValue(pendingForever())
    const hook = await mountPane(target)
    const blocked = vi.spyOn(sessionStorage, "getItem").mockImplementation(() => { throw new Error("read blocked") })
    await settleChat(async () => { await hook.chat.send("ordinary message"); await Promise.resolve() })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(hook.chat.upstreamRetryStatus).toBe("identity_unsaved")
    await settleChat(async () => { hook.chat.stop(); for (let i=0;i<8;i++) await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(target, "known-ordinary-run")
    blocked.mockRestore()
  })
  it("uses exact Stop for an unguarded ordinary run when the service supports it", async () => {
    allow()
    const target = "exact-capable-ordinary"
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target }); mocks.execute.mockResolvedValue({ session_id: target, status: "started", run_id: "ordinary-exact" })
    mocks.stopGeneration.mockResolvedValue(undefined); mocks.subscribeToEvents.mockReturnValue(pendingForever())
    const hook = await mountPane(target)
    await settleChat(async () => { await hook.chat.send("ordinary message"); await Promise.resolve() })
    await settleChat(async () => { hook.chat.stop(); for (let i=0;i<8;i++) await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(target, "ordinary-exact")
  })
  const refusedResume = (sessionId: string) => new ApiError("synthetic private server detail", 409, "Conflict", JSON.stringify({
    session_id: sessionId, error: { code: "retry_resume_not_prepared", message: "synthetic private server detail" },
  }))
  const abortableSubscription = (
    _sid: string, _h: SubscriptionHandlers, controller: AbortController,
    observation?: { beforeAttachment: Promise<string | null>; acceptRunId: (runId: string) => void },
  ) => {
    if (observation) void observation.beforeAttachment.then((runId) => {
      if (runId && !controller.signal.aborted) observation.acceptRunId(runId)
    })
    const sub = deferred<void>()
    controller.signal.addEventListener("abort", () => sub.resolve(), { once: true })
    return sub.promise
  }

  it("cleans only the refused 409 retry and allows a later explicit run", async () => {
    allow()
    const id = "resume-refused-own-operation"
    const messages: Message[] = [{ id: "saved-user", role: "user", content: "Synthetic instruction", createdAt: "" },
      { id: "saved-answer", role: "assistant", type: "text", content: "Synthetic answer", createdAt: "" }]
    seedChats([{ id, messages, lastRunStatus: "error", config: { model: "test-model" } }])
    const reply = deferred<{ session_id: string; status: "started"; run_id: string }>()
    mocks.execute.mockReturnValueOnce(reply.promise).mockResolvedValueOnce({ session_id: id, status: "started", run_id: "later-exact-run" })
    mocks.stopGeneration.mockResolvedValue(undefined)
    mocks.subscribeToEvents.mockImplementation(abortableSubscription)
    const hook = await mountPane(id)
    let first!: Promise<void>, second!: Promise<void>
    await settleChat(async () => { first = hook.chat.retry(undefined, options); await Promise.resolve() })
    expect(readContinuousRetryFence(backendScope, id)).toEqual({ kind: "pending" })
    await settleChat(async () => { reply.reject(refusedResume(id)); await first })
    expect(readContinuousRetryFence(backendScope, id)).toEqual({ kind: "ambiguous" })
    expect(hook.chat.upstreamRetryStatus).toBe("not_started")
    expect(hook.chat.streamPhase).toBeNull()
    expect(hook.chat.sendFailure?.message).not.toContain("synthetic private server detail")
    expect(findChat(id).messages).toEqual(messages)
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.truncateSessionMessages).not.toHaveBeenCalled()
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    await settleChat(async () => { second = hook.chat.retry(undefined, options); await Promise.resolve(); await Promise.resolve() })
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(hook.chat.upstreamRetryStatus).toBe("enabled")
    await settleChat(async () => { hook.chat.stop(); await second })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(id, "later-exact-run")
  })

  it("cleans a refused 409 retry even after Stop was clicked while its ACK was pending", async () => {
    allow()
    const id = "resume-refused-after-stop"
    seedChats([{ id, messages: [], lastRunStatus: "error", config: { model: "test-model" } }])
    const reply = deferred<{ session_id: string; status: "started"; run_id: string }>()
    mocks.execute.mockReturnValue(reply.promise)
    mocks.subscribeToEvents.mockImplementation(abortableSubscription)
    const hook = await mountPane(id)
    let request!: Promise<void>
    await settleChat(async () => { request = hook.chat.retry(undefined, options); await Promise.resolve() })
    await settleChat(async () => { hook.chat.stop() })
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    await settleChat(async () => { reply.reject(refusedResume(id)); await request; for (let i = 0; i < 8; i++) await Promise.resolve() })
    expect(readContinuousRetryFence(backendScope, id)).toEqual({ kind: "ambiguous" })
    expect(hook.chat.upstreamRetryStatus).toBe("not_started")
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
  })

  it("preserves the earlier ordinary receipt when a later continuous request receives a refused 409", async () => {
    allow()
    const id = "resume-refused-preserve-prior"
    seedChats([{ id, messages: [], lastRunStatus: "error", config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: id })
    mocks.stopGeneration.mockResolvedValue(undefined)
    const ordinary = deferred<{ session_id: string; status: "started"; run_id: string }>()
    const retry = deferred<{ session_id: string; status: "started"; run_id: string }>()
    mocks.execute.mockReturnValueOnce(ordinary.promise).mockReturnValueOnce(retry.promise)
    mocks.subscribeToEvents.mockImplementation(abortableSubscription)
    const first = await mountPane(id)
    const second = await mountPane(id)
    await settleChat(async () => { await first.chat.send("one synthetic message") })
    let request!: Promise<void>
    await settleChat(async () => { request = second.chat.retry(undefined, options); await Promise.resolve() })
    await settleChat(async () => { ordinary.resolve({ session_id: id, status: "started", run_id: "earlier-owned-run" }); await Promise.resolve() })
    await settleChat(async () => { retry.reject(refusedResume(id)); await request })
    expect(readContinuousRetryFence(backendScope, id)).toEqual({ kind: "confirmed", runId: "earlier-owned-run" })
    await settleChat(async () => { first.chat.stop(); for (let i = 0; i < 8; i++) await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(id, "earlier-owned-run")
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(mocks.truncateSessionMessages).not.toHaveBeenCalled()
  })

  it("does not clear a successor receipt when an older request receives a delayed refused 409", async () => {
    allow()
    const id = "resume-refused-preserve-successor"
    seedChats([{ id, messages: [], lastRunStatus: "error", config: { model: "test-model" } }])
    const retry = deferred<{ session_id: string; status: "started"; run_id: string }>()
    mocks.execute.mockReturnValueOnce(retry.promise).mockResolvedValueOnce({ session_id: id, status: "started", run_id: "successor-owned-run" })
    mocks.sendMessage.mockResolvedValue({ session_id: id })
    mocks.stopGeneration.mockResolvedValue(undefined)
    mocks.subscribeToEvents.mockImplementation(abortableSubscription)
    const first = await mountPane(id)
    const second = await mountPane(id)
    let request!: Promise<void>
    await settleChat(async () => { request = first.chat.retry(undefined, options); await Promise.resolve() })
    await settleChat(async () => { await second.chat.send("one successor message"); await Promise.resolve() })
    expect(readContinuousRetryFence(backendScope, id)).toEqual({ kind: "confirmed", runId: "successor-owned-run" })
    await settleChat(async () => { retry.reject(refusedResume(id)); await request })
    expect(readContinuousRetryFence(backendScope, id)).toEqual({ kind: "confirmed", runId: "successor-owned-run" })
    await settleChat(async () => { second.chat.stop(); for (let i = 0; i < 8; i++) await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(id, "successor-owned-run")
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(mocks.truncateSessionMessages).not.toHaveBeenCalled()
  })

  it("does not clear another tab's receipt or shared guard on a refused 409", async () => {
    allow()
    const id = "resume-refused-another-tab"
    seedChats([{ id, messages: [], lastRunStatus: "error", config: { model: "test-model" } }])
    const reply = deferred<{ session_id: string; status: "started"; run_id: string }>()
    mocks.execute.mockReturnValue(reply.promise)
    mocks.subscribeToEvents.mockImplementation(abortableSubscription)
    const hook = await mountPane(id)
    let request!: Promise<void>
    await settleChat(async () => { request = hook.chat.retry(undefined, options); await Promise.resolve() })
    const guardKey = localStorage.key(0)!, guard = localStorage.getItem(guardKey)
    sessionStorage.clear() // Simulate another tab's independent session storage.
    const otherTab = beginContinuousRetryFence(backendScope, id)!
    expect(confirmContinuousRetryFence(otherTab, "other-tab-run")).toBe(true)
    await settleChat(async () => { reply.reject(refusedResume(id)); await request })
    expect(readContinuousRetryFence(backendScope, id)).toEqual({ kind: "confirmed", runId: "other-tab-run" })
    expect(localStorage.getItem(guardKey)).toBe(guard)
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
  })

  it("cleans a refused 409 after the originating pane unmounts", async () => {
    allow()
    const id = "resume-refused-after-unmount"
    seedChats([{ id, messages: [], lastRunStatus: "error", config: { model: "test-model" } }])
    const reply = deferred<{ session_id: string; status: "started"; run_id: string }>()
    mocks.execute.mockReturnValue(reply.promise)
    mocks.subscribeToEvents.mockImplementation(abortableSubscription)
    const hook = await mountPane(id)
    let request!: Promise<void>
    await settleChat(async () => { request = hook.chat.retry(undefined, options); await Promise.resolve() })
    hook.unmount()
    await settleChat(async () => { reply.reject(refusedResume(id)); await request; for (let i = 0; i < 8; i++) await Promise.resolve() })
    expect(readContinuousRetryFence(backendScope, id)).toEqual({ kind: "ambiguous" })
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
  })

  it.each([
    new ApiError("conflict", 409, "Conflict", JSON.stringify({ session_id: "another-session", error: { code: "retry_resume_not_prepared" } })),
    new ApiError("conflict", 409, "Conflict", JSON.stringify({ session_id: "resume-unknown-409", error: { code: "another_conflict" } })),
    new ApiError("conflict", 409, "Conflict", JSON.stringify({ session_id: "resume-unknown-409", run_id: "conflicting-run", error: { code: "retry_resume_not_prepared" } })),
    new ApiError("unavailable", 503, "Unavailable", JSON.stringify({ session_id: "resume-unknown-409", error: { code: "retry_resume_not_prepared" } })),
    new ApiError("conflict", 409, "Conflict", "not-json"),
    new NetworkRequestError(),
  ])("keeps a refused 409 or lost response pending when its non-start cannot be attributed (%s)", async (error) => {
    allow()
    const id = "resume-unknown-409"
    seedChats([{ id, messages: [], lastRunStatus: "error", config: { model: "test-model" } }])
    mocks.execute.mockRejectedValue(error)
    mocks.subscribeToEvents.mockImplementation(abortableSubscription)
    const hook = await mountPane(id)
    await settleChat(async () => { await hook.chat.retry(undefined, options) })
    expect(readContinuousRetryFence(backendScope, id)).toEqual({ kind: "pending" })
    expect(hook.chat.upstreamRetryStatus).not.toBe("enabled")
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.truncateSessionMessages).not.toHaveBeenCalled()
  })

  it("permits another explicit continuous retry after a confirmed non-start", async () => {
    allow()
    mocks.execute.mockResolvedValueOnce({ session_id: sid, status: "completed" })
      .mockResolvedValueOnce({ session_id: sid, status: "started", run_id: "later-retry" })
    mocks.subscribeToEvents.mockImplementation((_sid: string, _h: SubscriptionHandlers, controller: AbortController) => {
      const sub = deferred<void>(); controller.signal.addEventListener("abort", () => sub.resolve(), { once: true }); return sub.promise
    })
    const hook = await persisted(); let first!: Promise<void>; let second!: Promise<void>
    await settleChat(async () => { first = hook.chat.retry(undefined, options); await first })
    expect(hook.chat.upstreamRetryStatus).toBe("not_started")
    await settleChat(async () => { second = hook.chat.retry(undefined, options); await Promise.resolve(); await Promise.resolve() })
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(hook.chat.upstreamRetryStatus).toBe("enabled")
    hook.unmount(); await settleChat(async () => { await second })
  })
  it("warns if an ordinary ACK cannot be persisted", async () => {
    allow()
    const target = "ordinary-ack-save-failed"
    const prior = beginContinuousRetryFence(backendScope, target)!
    expect(confirmContinuousRetryFence(prior, "previous-run")).toBe(true)
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target }); const ack = deferred<{session_id:string;status:"started";run_id:string}>()
    mocks.execute.mockReturnValue(ack.promise); mocks.subscribeToEvents.mockReturnValue(pendingForever())
    const hook = await mountPane(target)
    await settleChat(async () => { await hook.chat.send("follow-up") })
    const blocked = vi.spyOn(sessionStorage, "setItem").mockImplementation(() => { throw new Error("write blocked") })
    await settleChat(async () => { ack.resolve({session_id:target,status:"started",run_id:"new-run"}); await Promise.resolve(); await Promise.resolve() })
    expect(hook.chat.upstreamRetryStatus).toBe("identity_unsaved")
    blocked.mockRestore()
  })
  it.each(["completed", "already_running"] as const)("streams before Execute reports %s and stops the observed Root", async (status) => {
    allow()
    const target = `inbox-stop-${status}`
    const prior = beginOrdinaryRetryFence(backendScope, target, { ensureGuard: true })
    if (prior.kind !== "reserved") throw new Error("Previous run was not reserved")
    expect(confirmContinuousRetryFence(prior.reservation, "previous-run")).toBe(true)
    const ack = deferred<{ session_id: string; status: typeof status }>()
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target })
    mocks.execute.mockReturnValue(ack.promise)
    mocks.stopGeneration.mockResolvedValue(undefined)
    mocks.subscribeToEvents.mockImplementation(abortableSubscription)

    const hook = await mountPane(target)
    await settleChat(async () => { await hook.chat.send("Start the synthetic Root") })
    expect(mocks.subscribeToEvents).toHaveBeenCalledExactlyOnceWith(
      target, expect.any(Object), expect.any(AbortController),
    )
    const handlers = mocks.subscribeToEvents.mock.lastCall![1] as SubscriptionHandlers
    await settleChat(async () => {
      handlers.onExecutionStarted("inbox-run")
      handlers.onToken("Output before Execute acknowledges")
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    expect(hook.chat.streaming).toBe("Output before Execute acknowledges")

    await settleChat(async () => { ack.resolve({ session_id: target, status }) })
    await settleChat(async () => { hook.chat.stop(); hook.chat.stop() })
    await settleChat()

    expect(mocks.getRunningSessions).not.toHaveBeenCalled()
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(target, "inbox-run")
    expect(appStore.getState().markCancel).not.toHaveBeenCalled()
    expect(hook.chat.upstreamRetryStatus).toBe("stop_requested")
  })

  it("uses an already-running Execute receipt without consulting the active list", async () => {
    allow()
    const target = "already-running-receipt"
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target })
    mocks.execute.mockResolvedValue({ session_id: target, status: "already_running", run_id: "acknowledged-run" })
    mocks.getRunningSessions.mockResolvedValue({ sessions: [{ session_id: target, run_id: "successor-run" }] })
    mocks.stopGeneration.mockResolvedValue(undefined)
    mocks.subscribeToEvents.mockImplementation(abortableSubscription)

    const hook = await mountPane(target)
    await settleChat(async () => { await hook.chat.send("Continue the synthetic Root") })
    await settleChat(async () => { hook.chat.stop() })
    await settleChat()

    expect(mocks.getRunningSessions).not.toHaveBeenCalled()
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(target, "acknowledged-run")
  })

  it("stops an externally started run using the identity captured while attaching", async () => {
    allow()
    const target = "observed-exact-stop"
    seedChats([{ id: target, messages: [], isRunning: true, config: { model: "test-model" } }])
    startObserving(target)
    mocks.getRunningSessions.mockResolvedValue({ sessions: [{ session_id: target, run_id: "observed-run" }] })
    mocks.stopGeneration.mockRejectedValue(new ApiError("Run is no longer current", 409, "Conflict"))
    mocks.subscribeToEvents.mockImplementation(abortableSubscription)
    const hook = await mountPane(target)
    await settleChat()

    // A Stop must use the observed ID even if a successor would answer a
    // fresh running-snapshot request by the time the user clicks.
    stopObserving(target)
    mocks.getRunningSessions.mockResolvedValue({ sessions: [{ session_id: target, run_id: "successor-run" }] })
    await settleChat(async () => { hook.chat.stop() })
    await settleChat()

    expect(mocks.getRunningSessions).toHaveBeenCalledTimes(1)
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(target, "observed-run")
    expect(appStore.getState().markCancel).not.toHaveBeenCalled()
    expect(hook.chat.upstreamRetryStatus).toBe("stop_unconfirmed")
  })

  it("does not dispatch Stop using a run identity received after the click", async () => {
    allow()
    const target = "late-observation-stop"
    const running = deferred<{ sessions: Array<{ session_id: string; run_id: string }> }>()
    seedChats([{ id: target, messages: [], isRunning: true, config: { model: "test-model" } }])
    startObserving(target)
    mocks.getRunningSessions.mockReturnValue(running.promise)
    mocks.subscribeToEvents.mockImplementation(abortableSubscription)
    const hook = await mountPane(target)
    stopObserving(target)

    await settleChat(async () => {
      hook.chat.stop()
      running.resolve({ sessions: [{ session_id: target, run_id: "late-run" }] })
    })
    await settleChat()
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    expect(hook.chat.upstreamRetryStatus).toBe("stop_unconfirmed")
  })

  it("ignores a late running snapshot after the observer attaches", async () => {
    allow()
    const target = "successor-before-stop"
    const running = deferred<{ sessions: Array<{ session_id: string; run_id: string }> }>()
    seedChats([{ id: target, messages: [], isRunning: true, config: { model: "test-model" } }])
    startObserving(target)
    mocks.getRunningSessions.mockReturnValue(running.promise)
    mocks.subscribeToEvents.mockImplementation(abortableSubscription)
    const hook = await mountPane(target)
    const [, handlers, , observation] = mocks.subscribeToEvents.mock.lastCall! as Parameters<typeof abortableSubscription>
    expect(await observation!.beforeAttachment).toBeNull()
    await settleChat(async () => {
      handlers.onToken("Output from the previous run")
      running.resolve({ sessions: [{ session_id: target, run_id: "successor-run" }] })
    })
    await settleChat()
    stopObserving(target)
    await settleChat(async () => { hook.chat.stop() })
    await settleChat()

    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    expect(hook.chat.upstreamRetryStatus).toBe("stop_unconfirmed")
  })

  it("does not use a non-start Execute receipt that arrives after the Stop click", async () => {
    allow()
    const target = "later-nonstart-receipt"
    const ack = deferred<{ session_id: string; status: "already_running"; run_id: string }>()
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target })
    mocks.execute.mockReturnValue(ack.promise)
    mocks.subscribeToEvents.mockImplementation(abortableSubscription)
    mocks.stopGeneration.mockResolvedValue(undefined)
    const hook = await mountPane(target)
    await settleChat(async () => { await hook.chat.send("Observe a synthetic run") })
    await vi.waitFor(() => expect(mocks.subscribeToEvents).toHaveBeenCalledTimes(1))
    const handlers = mocks.subscribeToEvents.mock.lastCall![1] as SubscriptionHandlers
    await settleChat(async () => {
      handlers.onExecutionStarted("observed-run")
      hook.chat.stop()
      ack.resolve({ session_id: target, status: "already_running", run_id: "successor-run" })
    })
    await settleChat()
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(target, "observed-run")
  })

  it.each([false, true])("keeps text before a tool through repeated Stop clicks and history supersession=%s", async (superseded) => {
    allow()
    const target = "exact-stop-tool-checkpoint"
    const history = deferred<void>()
    const stopReceipt = deferred<void>()
    const text = "Partial answer before a tool"
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target })
    mocks.execute.mockResolvedValue({ session_id: target, status: "started", run_id: "owned-run" })
    mocks.stopGeneration.mockReturnValue(stopReceipt.promise)
    mocks.subscribeToEvents.mockImplementation(abortableSubscription)
    const hook = await mountPane(target)
    await settleChat(async () => { await hook.chat.send("Start an ordinary turn") })
    await settleChat()
    const handlers = mocks.subscribeToEvents.mock.lastCall![1] as SubscriptionHandlers
    vi.mocked(appStore.getState().loadChatHistory).mockClear().mockReturnValue(history.promise)
    if (superseded) vi.mocked(appStore.getState().loadChatHistory).mockRejectedValueOnce(new DOMException("Superseded by the feed", "AbortError"))
    startObserving(target)
    await settleChat(async () => {
      handlers.onToken(text)
      handlers.onToolStart("tool-id", "Bash", {})
      hook.chat.stop()
      hook.chat.stop()
    })
    await settleChat()

    expect(hook.chat.liveSegments).toContainEqual(expect.objectContaining({ kind: "text", text }))
    expect(hook.chat.sending).toBe(false)
    expect(mocks.subscribeToEvents).toHaveBeenCalledTimes(1)
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(target, "owned-run")
    expect(appStore.getState().loadChatHistory).not.toHaveBeenCalled()
    await settleChat(async () => { stopReceipt.resolve() })
    await settleChat()
    expect(appStore.getState().loadChatHistory).toHaveBeenCalledTimes(superseded ? 2 : 1)
    expect(appStore.getState().loadChatHistory).toHaveBeenLastCalledWith(target, expect.objectContaining({
      mode: "monotonic", waitForAssistant: true, throwOnError: true,
    }))
    expect(hook.chat.liveSegments).toContainEqual(expect.objectContaining({ kind: "text", text }))
    stopObserving(target)
    await settleChat(async () => { history.resolve() })
    await settleChat()
    expect(hook.chat.liveSegments).toEqual([])
  })

  it("does not let an unowned observer borrow a later run's Stop identity", async () => {
    allow()
    const target = "unowned-observer"
    seedChats([{ id: target, messages: [], isRunning: true, lastRunStatus: "error", config: { model: "test-model" } }])
    mocks.execute.mockResolvedValue({ session_id: target, status: "started", run_id: "later-continuous" })
    mocks.stopGeneration.mockResolvedValue(undefined)
    mocks.subscribeToEvents.mockImplementation((_sid: string, _h: SubscriptionHandlers, controller: AbortController) => {
      const sub = deferred<void>(); controller.signal.addEventListener("abort", () => sub.resolve(), { once: true }); return sub.promise
    })
    startObserving(target)
    const observer = await mountPane(target)
    stopObserving(target)
    const owner = await mountPane(target); let request!: Promise<void>
    await settleChat(async () => { request = owner.chat.retry(undefined, options); await Promise.resolve() })
    await settleChat(async () => { observer.chat.stop(); for (let i=0;i<8;i++) await Promise.resolve() })
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    expect(observer.chat.upstreamRetryStatus).toBe("stop_unconfirmed")
    owner.unmount(); await settleChat(async () => { await request })
  })
  it.each([
    { kind: "legacy", rejected: false, refresh: false },
    { kind: "legacy", rejected: true, refresh: true },
    { kind: "exact", rejected: false, refresh: true },
    { kind: "exact", rejected: true, refresh: true },
  ] as const)("reconciles $kind Stop after rejection=$rejected only when needed", async ({ kind, rejected, refresh }) => {
    if (kind === "exact") allow()
    else mocks.apiGet.mockResolvedValue({ model: null, system_prompt: "", base_system_prompt: "", default_session_permission_mode: "default" })
    const target = `stop-reconcile-${kind}-${rejected}`
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target })
    mocks.execute.mockResolvedValue({ session_id: target, status: "started", run_id: "owned-run" })
    if (rejected) mocks.stopGeneration.mockRejectedValue(new Error("synthetic stop failure"))
    else mocks.stopGeneration.mockResolvedValue(undefined)
    mocks.subscribeToEvents.mockImplementation((_sid: string, _handlers: SubscriptionHandlers, controller: AbortController) => {
      const subscription = deferred<void>()
      controller.signal.addEventListener("abort", () => subscription.resolve(), { once: true })
      return subscription.promise
    })
    const hook = await mountPane(target)
    await settleChat(async () => { await hook.chat.send("synthetic request"); await Promise.resolve() })
    const before = vi.mocked(appStore.getState().refreshChatsNow).mock.calls.length
    await settleChat(async () => { hook.chat.stop(); for (let i = 0; i < 12; i++) await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(...(kind === "exact" ? [target, "owned-run"] : [target]))
    expect(vi.mocked(appStore.getState().refreshChatsNow).mock.calls.length - before).toBe(refresh ? 1 : 0)
    if (kind === "exact") expect(appStore.getState().markCancel).not.toHaveBeenCalled()
  })
  it.each(["continuous-pending", "missing-tab-receipt", "ordinary-pending"] as const)("reports unavailable identity after passive resume with %s", async (kind) => {
    allow()
    const target = `resume-${kind}`
    if (kind === "ordinary-pending") {
      expect(beginOrdinaryRetryFence(backendScope, target, { ensureGuard: true }).kind).toBe("reserved")
    } else {
      expect(beginContinuousRetryFence(backendScope, target)).not.toBeNull()
      if (kind === "missing-tab-receipt") sessionStorage.clear()
    }
    seedChats([{ id: target, messages: [], isRunning: true, config: { model: "test-model" } }])
    mocks.subscribeToEvents.mockImplementation((_sid: string, _handlers: SubscriptionHandlers, controller: AbortController) => {
      const subscription = deferred<void>()
      controller.signal.addEventListener("abort", () => subscription.resolve(), { once: true })
      return subscription.promise
    })
    startObserving(target)
    const hook = await mountPane(target)
    await settleChat()
    expect(mocks.subscribeToEvents).toHaveBeenCalled()
    stopObserving(target)
    await settleChat(async () => { hook.chat.stop(); for (let i = 0; i < 8; i++) await Promise.resolve() })
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    expect(appStore.getState().markCancel).not.toHaveBeenCalled()
    expect(hook.chat.upstreamRetryStatus).toBe("identity_unavailable")
  })
  it("persists a first ordinary started identity for reload on an exact-capable service", async () => {
    allow()
    const target = "first-ordinary-reload"
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target }); mocks.execute.mockResolvedValue({ session_id: target, status: "started", run_id: "first-run" })
    mocks.subscribeToEvents.mockReturnValue(pendingForever()); const hook = await mountPane(target)
    await settleChat(async () => { await hook.chat.send("ordinary message"); await Promise.resolve(); await Promise.resolve() })
    expect(readContinuousRetryFence(backendScope, target)).toEqual({kind:"confirmed",runId:"first-run"})
  })
  it("does not send a legacy Stop when capability data is malformed", async () => {
    mocks.apiGet.mockResolvedValue({ upstream_retry:{supported_modes:"until_cancelled"} })
    const target = "malformed-capability"
    seedChats([{ id: target, messages: [], config: { model: "test-model" } }])
    mocks.sendMessage.mockResolvedValue({ session_id: target }); mocks.execute.mockResolvedValue({ session_id: target, status: "started", run_id: "known-run" })
    mocks.stopGeneration.mockResolvedValue(undefined); mocks.subscribeToEvents.mockReturnValue(pendingForever())
    const hook = await mountPane(target)
    await settleChat(async () => { await hook.chat.send("ordinary message"); await Promise.resolve() })
    await settleChat(async () => { hook.chat.stop(); for (let i=0;i<8;i++) await Promise.resolve() })
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    expect(hook.chat.upstreamRetryStatus).toBe("stop_unconfirmed")
  })
  it("does not let a restored legacy observer stop a newer local run when its receipt cannot be written", async () => {
    const target = "restored-legacy-observer"
    const prior = beginOrdinaryRetryFence(backendScope, target, {ensureGuard:true})
    if (prior.kind !== "reserved") throw new Error("expected ordinary reservation")
    expect(confirmOrdinaryStartedWithoutRunId(prior.reservation)).toBe(true)
    seedChats([{ id: target, messages: [], isRunning:true, config: { model: "test-model" } }])
    mocks.subscribeToEvents.mockImplementation((_sid: string, _h: SubscriptionHandlers, controller: AbortController) => {
      const sub = deferred<void>(); controller.signal.addEventListener("abort", () => sub.resolve(), { once: true }); return sub.promise
    })
    startObserving(target); const observer = await mountPane(target); stopObserving(target)
    mocks.sendMessage.mockResolvedValue({session_id:target}); mocks.execute.mockResolvedValue({session_id:target,status:"started",run_id:"new-run"})
    const blocked = vi.spyOn(sessionStorage,"setItem").mockImplementation(() => {throw new Error("write blocked")})
    const newer = await mountPane(target)
    await settleChat(async () => {await newer.chat.send("new turn"); await Promise.resolve()}); blocked.mockRestore()
    await settleChat(async () => {observer.chat.stop(); for(let i=0;i<8;i++) await Promise.resolve()})
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    expect(observer.chat.upstreamRetryStatus).toBe("stop_unconfirmed")
  })
  it("recovers the earlier started ACK when a later ordinary request did not start", async () => {
    allow()
    const target = "ordinary-overlap-nonstart"
    seedChats([{id:target,messages:[],config:{model:"test-model"}}])
    mocks.sendMessage.mockResolvedValue({session_id:target}); mocks.stopGeneration.mockResolvedValue(undefined)
    const earlier = deferred<{session_id:string;status:"started";run_id:string}>()
    const later = deferred<{session_id:string;status:"already_running";run_id:string}>()
    mocks.execute.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise)
    mocks.subscribeToEvents.mockImplementation((_sid: string, _h: SubscriptionHandlers, controller: AbortController) => {
      const sub=deferred<void>();controller.signal.addEventListener("abort",()=>sub.resolve(),{once:true});return sub.promise
    })
    const first=await mountPane(target);const second=await mountPane(target)
    await settleChat(async()=>{await first.chat.send("first turn")});await settleChat(async()=>{await second.chat.send("later turn")})
    await settleChat(async()=>{earlier.resolve({session_id:target,status:"started",run_id:"earlier-run"});await Promise.resolve()})
    await settleChat(async()=>{later.resolve({session_id:target,status:"already_running",run_id:"not-an-owned-receipt"});for(let i=0;i<8;i++)await Promise.resolve()})
    expect(readContinuousRetryFence(backendScope,target)).toEqual({kind:"confirmed",runId:"earlier-run"})
    await settleChat(async()=>{second.chat.stop();for(let i=0;i<8;i++)await Promise.resolve()})
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(target,"earlier-run")
  })
  it("does not claim an already running execution adopted the requested mode",async()=>{
    allow();mocks.execute.mockResolvedValue({session_id:sid,status:"already_running",run_id:"other-owned-run"})
    const sub=deferred<void>();mocks.subscribeToEvents.mockReturnValue(sub.promise)
    const hook=await persisted();let request!:Promise<void>
    await settleChat(async()=>{request=hook.chat.retry(undefined,options)})
    expect(hook.chat.upstreamRetryStatus).toBe("already_running")
    await settleChat(async()=>{sub.resolve();await request})
  })
  it.each([false, true])("keeps the exact Stop fence after navigation and passive resume (delayed ACK=%s)", async (delayedAck) => {
    allow()
    const ack = deferred<{ session_id: string; status: "started"; run_id: string }>()
    mocks.execute.mockReturnValue(ack.promise)
    mocks.stopGeneration.mockResolvedValue(undefined)
    mocks.subscribeToEvents.mockImplementation((_sessionId: string, _handlers: SubscriptionHandlers, controller: AbortController) => {
      const subscription = deferred<void>()
      controller.signal.addEventListener("abort", () => subscription.resolve(), { once: true })
      return subscription.promise
    })
    const hook = await persisted()
    let request!: Promise<void>
    await settleChat(async () => { request = hook.chat.retry(undefined, options) })
    if (!delayedAck) await settleChat(async () => { ack.resolve({ session_id: sid, status: "started", run_id: "exact-original-run" }); await Promise.resolve() })
    await settleChat(async () => { hook.chat.select("other"); await request })
    await hook.rebind("other")
    updateChat(sid, { isRunning: true })
    startObserving(sid)
    await hook.rebind(sid); await settleChat()
    expect(mocks.subscribeToEvents).toHaveBeenCalledTimes(2)
    stopObserving(sid)
    await settleChat(async () => { hook.chat.stop(); await Promise.resolve() })
    if (delayedAck) {
      expect(mocks.stopGeneration).not.toHaveBeenCalled()
      await settleChat(async () => { ack.resolve({ session_id: sid, status: "started", run_id: "exact-original-run" }); await Promise.resolve(); await Promise.resolve() })
    }
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(sid, "exact-original-run")
  })
  it("keeps the exact Stop fence when the originating pane unmounts", async () => {
    allow()
    mocks.execute.mockResolvedValue({ session_id: sid, status: "started", run_id: "pane-original-run" })
    mocks.stopGeneration.mockResolvedValue(undefined)
    mocks.subscribeToEvents.mockImplementation((_sessionId: string, _handlers: SubscriptionHandlers, controller: AbortController) => {
      const subscription = deferred<void>()
      controller.signal.addEventListener("abort", () => subscription.resolve(), { once: true })
      return subscription.promise
    })
    const first = await persisted()
    let request!: Promise<void>
    await settleChat(async () => { request = first.chat.retry(undefined, options) })
    first.unmount()
    await settleChat(async () => { await request })
    updateChat(sid, { isRunning: true })
    startObserving(sid)
    const restored = await mountPane(sid)
    expect(mocks.subscribeToEvents).toHaveBeenCalledTimes(2)
    stopObserving(sid)
    await settleChat(async () => { restored.chat.stop(); await Promise.resolve(); await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(sid, "pane-original-run")
  })
  it("does not use one session's exact Stop fence for another session", async () => {
    allow()
    mocks.execute.mockResolvedValue({ session_id: sid, status: "started", run_id: "session-a-run" })
    mocks.stopGeneration.mockResolvedValue(undefined)
    mocks.subscribeToEvents.mockImplementation((_sessionId: string, _handlers: SubscriptionHandlers, controller: AbortController) => {
      const subscription = deferred<void>()
      controller.signal.addEventListener("abort", () => subscription.resolve(), { once: true })
      return subscription.promise
    })
    const hook = await persisted()
    addChat({ id: "other", messages: [], isRunning: true })
    let request!: Promise<void>
    await settleChat(async () => { request = hook.chat.retry(undefined, options) })
    await settleChat(async () => { hook.chat.select("other"); await request })
    startObserving("other")
    await hook.rebind("other")
    stopObserving("other")
    await settleChat(async () => { hook.chat.stop(); for (let i=0;i<8;i++) await Promise.resolve() })
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    expect(hook.chat.upstreamRetryStatus).toBe("stop_unconfirmed")
  })
  it("keeps an older pane's Stop bound to its own run after a successor starts", async () => {
    allow()
    mocks.execute.mockResolvedValueOnce({ session_id: sid, status: "started", run_id: "older-pane-run" })
      .mockResolvedValueOnce({ session_id: sid, status: "started", run_id: "successor-pane-run" })
    mocks.stopGeneration.mockImplementation(async (_sessionId: string, runId?: string) => {
      if (runId !== "successor-pane-run") throw new Error("stale run")
    })
    mocks.subscribeToEvents.mockImplementation((_sessionId: string, _handlers: SubscriptionHandlers, controller: AbortController) => {
      const subscription = deferred<void>()
      controller.signal.addEventListener("abort", () => subscription.resolve(), { once: true })
      return subscription.promise
    })
    const older = await persisted(); let olderRequest!: Promise<void>
    await settleChat(async () => { olderRequest = older.chat.retry(undefined, options) })
    const newer = await mountPane(sid); let newerRequest!: Promise<void>
    await settleChat(async () => { newerRequest = newer.chat.retry(undefined, options) })
    await settleChat(async () => { older.chat.stop(); await olderRequest; for (let i = 0; i < 8; i++) await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(sid, "older-pane-run")
    expect(appStore.getState().markCancel).not.toHaveBeenCalled()
    expect(older.chat.upstreamRetryStatus).toBe("stop_unconfirmed")
    newer.unmount()
    await settleChat(async () => { await newerRequest })
  })
  it("does not let a delayed ordinary ACK erase another pane's newer fence", async () => {
    allow()
    const oldOrdinaryAck = deferred<{ session_id: string; status: "started"; run_id: string }>()
    mocks.execute.mockResolvedValueOnce({ session_id: sid, status: "started", run_id: "first-continuous-run" })
      .mockReturnValueOnce(oldOrdinaryAck.promise)
      .mockResolvedValueOnce({ session_id: sid, status: "started", run_id: "new-continuous-run" })
    mocks.sendMessage.mockResolvedValue({ session_id: sid })
    mocks.stopGeneration.mockResolvedValue(undefined)
    mocks.subscribeToEvents.mockImplementation((_sessionId: string, _handlers: SubscriptionHandlers, controller: AbortController) => {
      const subscription = deferred<void>()
      controller.signal.addEventListener("abort", () => subscription.resolve(), { once: true })
      return subscription.promise
    })
    const first = await persisted()
    let firstRequest!: Promise<void>
    await settleChat(async () => { firstRequest = first.chat.retry(undefined, options) })
    await settleChat(async () => { first.chat.select("other"); await firstRequest })
    await first.rebind("other")
    await first.rebind(sid)
    await settleChat(async () => { await first.chat.send("ordinary attempt") })
    const second = await mountPane(sid)
    let secondRequest!: Promise<void>
    await settleChat(async () => { secondRequest = second.chat.retry(undefined, options); await Promise.resolve(); await Promise.resolve() })
    expect(mocks.execute).toHaveBeenCalledTimes(3)
    await settleChat(async () => { oldOrdinaryAck.resolve({ session_id: sid, status: "started", run_id: "older-ordinary-run" }); await Promise.resolve() })
    await settleChat(async () => { second.chat.stop(); await secondRequest })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(sid, "new-continuous-run")
  })
  it("uses the newly acknowledged ordinary execution without clearing other tabs’ identities", async () => {
    allow()
    const firstSubscription = deferred<void>()
    let firstHandlers!: SubscriptionHandlers
    mocks.subscribeToEvents.mockImplementationOnce((_sessionId: string, handlers: SubscriptionHandlers) => {
      firstHandlers = handlers
      return firstSubscription.promise
    }).mockReturnValue(pendingForever())
    mocks.execute.mockResolvedValueOnce({ session_id: sid, status: "started", run_id: "old-continuous-run" })
      .mockResolvedValueOnce({ session_id: sid, status: "started", run_id: "new-ordinary-run" })
    mocks.sendMessage.mockResolvedValue({ session_id: sid })
    mocks.stopGeneration.mockResolvedValue(undefined)
    const hook = await persisted()
    let request!: Promise<void>
    await settleChat(async () => { request = hook.chat.retry(undefined, options) })
    await settleChat(async () => { firstHandlers.onCancelled(); firstSubscription.resolve(); await request })
    await settleChat(async () => { await hook.chat.send("a later instruction"); await Promise.resolve() })
    await settleChat(async () => { hook.chat.stop(); for (let i = 0; i < 8; i++) await Promise.resolve() })
    expect(mocks.stopGeneration).toHaveBeenCalledExactlyOnceWith(sid, "new-ordinary-run")
  })
  it("does not inherit the mode on a later ordinary send",async()=>{
    allow();const sub=deferred<void>();let handlers!:SubscriptionHandlers
    mocks.execute.mockResolvedValue({session_id:sid,status:"started",run_id:"original-run"})
    mocks.subscribeToEvents.mockImplementationOnce((_sid:string,h:SubscriptionHandlers)=>{handlers=h;return sub.promise})
    const hook=await persisted();let request!:Promise<void>
    await settleChat(async()=>{request=hook.chat.retry(undefined,options)})
    await settleChat(async()=>{handlers.onCancelled();sub.resolve();await request})
    expect(hook.chat.upstreamRetryStatus).toBeNull()
    mocks.sendMessage.mockResolvedValue({session_id:sid});mocks.subscribeToEvents.mockReturnValue(pendingForever())
    await settleChat(async()=>{await hook.chat.send("a later instruction")})
    expect(mocks.execute.mock.calls.at(-1)).toHaveLength(5)
    expect(mocks.execute.mock.calls.at(-1)?.[0]).toBe(sid)
  })
})
