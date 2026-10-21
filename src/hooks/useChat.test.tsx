import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { ProviderInstancesConfig, ProviderKind } from "@shared/types/providerConfig"
import type { ContextSummaryInfo, PermissionDecisionResult, ReasoningEffort, TokenBudgetUsage } from "@services/chat/AgentService"
import type { TokenUsage } from "@shared/types/tokenBudget"
import type { ContextCompressionFeedback } from "@/lib/contextCompression"
import { ApiError, NetworkRequestError } from "@services/api/errors"
import { clearSessionCompatibilityObservations, observeSessionExecutionConflict } from "@services/chat/sessionExecutionCompatibility"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
const mocks = vi.hoisted(() => {
  const appState = {
    chats: [] as Array<{
      id: string
      messages?: unknown[]
      isRunning?: boolean
      lastRunStatus?: string | null
      tokenUsage?: TokenUsage
      config?: {
        model?: string
        model_ref?: { provider: string; model: string } | null
        reasoningEffort?: ReasoningEffort | null
      }
    }>,
    currentSessionId: null as string | null,
    sessionIndexRevision: 0,
    executionBySession: {},
    selectedModel: "test-model" as string | undefined,
    inputStates: {} as Record<string, { reasoningEffort?: string }>,
    lastSelectedPromptId: null as string | null,
    systemPrompts: [] as Array<{ id: string; content?: string; isDefault?: boolean }>,
    selectSession: vi.fn(),
    loadSubagentSessions: vi.fn(),
    restoreSession: vi.fn(),
    loadChatHistory: vi.fn(),
    refreshChatsNow: vi.fn(),
    markCancel: vi.fn(),
    updateSession: vi.fn(),
    updateTokenUsage: vi.fn(),
    setTruncationInfo: vi.fn(),
  }
  return {
    appState,
    initializeStore: vi.fn(),
    sendMessage: vi.fn(),
    execute: vi.fn(),
    subscribeToEvents: vi.fn(),
    truncateSessionMessages: vi.fn(),
    stopGeneration: vi.fn(),
    deleteSessionMessage: vi.fn(),
    patchSessionMessage: vi.fn(),
    restoreSessionState: vi.fn(),
    respondToChildApproval: vi.fn(),
    getPendingQuestion: vi.fn(),
    getSession: vi.fn(),
    submitPermissionDecision: vi.fn(),
    shouldObserve: false,
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    acknowledgeTemplate: vi.fn(),
    providerState: {
      providerSnapshot: null,
      catalog: null,
      getProviderType: vi.fn<(instanceId: string) => ProviderKind | undefined>(() => undefined),
    } as {
      providerSnapshot: ProviderInstancesConfig | null
      catalog: unknown
      getProviderType: ReturnType<typeof vi.fn<(instanceId: string) => ProviderKind | undefined>>
    },
  }
})
vi.mock("@shared/store/appStore", () => {
  const useAppStore = Object.assign(
    (selector: (state: typeof mocks.appState) => unknown) => selector(mocks.appState),
    { getState: () => mocks.appState },
  )
  return {
    useAppStore,
    initializeStore: mocks.initializeStore,
    selectSessionById:
      (sessionId: string | null) => (state: typeof mocks.appState) =>
        sessionId ? state.chats.find((chat) => chat.id === sessionId) ?? null : null,
    selectShouldObserve: () => () => mocks.shouldObserve,
  }
})
vi.mock("@shared/store/appStore/slices/providerSlice", () => ({
  useProviderStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector(mocks.providerState),
    { getState: () => mocks.providerState },
  ),
}))
vi.mock("@services/chat/AgentService", () => ({
  agentClient: {
    sendMessage: mocks.sendMessage,
    execute: mocks.execute,
    subscribeToEvents: mocks.subscribeToEvents,
    truncateSessionMessages: mocks.truncateSessionMessages,
    stopGeneration: mocks.stopGeneration,
    deleteSessionMessage: mocks.deleteSessionMessage,
    patchSessionMessage: mocks.patchSessionMessage,
    restoreSessionState: mocks.restoreSessionState,
    respondToChildApproval: mocks.respondToChildApproval,
    getPendingQuestion: mocks.getPendingQuestion,
    getSession: mocks.getSession,
    submitPermissionDecision: mocks.submitPermissionDecision,
  },
}))
vi.mock("@services/api", () => ({
  apiClient: {
    get: mocks.apiGet,
    post: mocks.apiPost,
  },
}))
vi.mock("@/lib/taskTemplates", () => ({
  acknowledgePendingTemplatePrompt: mocks.acknowledgeTemplate,
}))
vi.mock("@/lib/notify", () => ({ notify: vi.fn() }))
vi.mock("@shared/utils/systemPromptEnhancement", () => ({
  getSystemPromptEnhancementText: () => "",
}))
vi.mock("@shared/utils/copilotConclusionWithOptionsEnhancementUtils", () => ({
  isCopilotConclusionWithOptionsEnhancementEnabled: () => false,
}))
import { useChat, type GenerationFailure, type SendSubmissionResult } from "./useChat"
import { beginRootModeOperation, getRootModeFenceState } from "@/lib/rootModeTransitionFence"
import { getUsedModels } from "@shared/utils/usedModels"
type HookValue = ReturnType<typeof useChat>
type HookProps =
  | { mode: "main" }
  | {
      mode: "bound"
      sessionId: string | null
      onSessionCreated?: (sessionId: string) => void
    }
type SubscriptionHandlers = {
  onToken(content: string): void
  onMessageAppended(sessionId: string, messageId?: string): void
  onSessionHistoryCommitted(sessionId: string): void
  onComplete(): void
  onError(message: string): void
  onCancelled(): void
  onContextCompressionStatus(phase: string, status: string): void
  onContextSummarized(summary: ContextSummaryInfo): void
  onTokenBudgetUpdated(usage: TokenBudgetUsage): void
  onNeedClarification(event: { question?: string; options?: string[]; allow_custom?: boolean }): void
}
type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}
const mountedRoots: Root[] = []
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
let consoleErrorSpy: ReturnType<typeof vi.spyOn>
let consoleWarnSpy: ReturnType<typeof vi.spyOn>
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
function pendingForever<T>(): Promise<T> {
  return new Promise<T>(() => {})
}
function appendPersistedUser(sessionId: string, text: string, id = "persisted-user") {
  let chat = mocks.appState.chats.find((candidate) => candidate.id === sessionId)
  if (!chat) {
    chat = { id: sessionId, messages: [] }
    mocks.appState.chats.push(chat)
  }
  chat.messages = [...(chat.messages ?? []), { id, role: "user", content: text, createdAt: "2026-10-06T10:00:00Z" }]
}
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}
async function mountUseChat(initialProps: HookProps, onRender?: (value: HookValue) => void) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  let current: HookValue | null = null
  function MainHarness() {
    current = useChat()
    onRender?.(current)
    return null
  }
  function BoundHarness({
    sessionId,
    onSessionCreated,
  }: Extract<HookProps, { mode: "bound" }>) {
    current = useChat(sessionId, onSessionCreated)
    onRender?.(current)
    return null
  }
  const render = async (props: HookProps) => {
    await act(async () => {
      root.render(
        props.mode === "main" ? (
          <MainHarness />
        ) : (
          <BoundHarness {...props} />
        ),
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }
  await render(initialProps)
  return {
    get current(): HookValue {
      if (!current) throw new Error("useChat harness did not render")
      return current
    },
    rerender: render,
    unmount: () => {
      act(() => root.unmount())
      const index = mountedRoots.indexOf(root)
      if (index >= 0) mountedRoots.splice(index, 1)
      container.remove()
    },
  }
}
async function mountAcknowledgedFailure(sessionId: string, payload: string) {
  mocks.appState.chats = [{ id: sessionId, messages: [], config: { model: "test-model" } }]
  mocks.sendMessage.mockResolvedValueOnce({ session_id: sessionId })
  mocks.execute.mockRejectedValueOnce(new Error("initial generation failed"))
  mocks.subscribeToEvents.mockResolvedValueOnce(undefined)
  mocks.appState.loadChatHistory.mockRejectedValueOnce(new Error("initial history failed"))
  const hook = await mountUseChat({ mode: "bound", sessionId })
  await act(async () => {
    await hook.current.send(payload)
    await Promise.resolve()
    await Promise.resolve()
  })
  await flushMicrotasks()
  const failure = hook.current.sendFailure
  if (failure?.kind !== "generation-failed") {
    throw new Error("expected an acknowledged generation failure")
  }
  return { hook, failure }
}
async function startPendingRetry(sessionId: string, payload: string) {
  const { hook, failure } = await mountAcknowledgedFailure(sessionId, payload)
  const truncation = deferred<void>()
  mocks.truncateSessionMessages.mockReturnValueOnce(truncation.promise)
  const callCounts = {
    execute: mocks.execute.mock.calls.length,
    subscribe: mocks.subscribeToEvents.mock.calls.length,
    history: mocks.appState.loadChatHistory.mock.calls.length,
  }
  let retrying!: Promise<void>
  act(() => {
    retrying = hook.current.retry(failure)
  })
  return { hook, truncation, retrying, callCounts }
}
beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => {
  Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT")
})
beforeEach(() => {
  localStorage.clear()
  mocks.shouldObserve = false
  mocks.appState.chats = []
  mocks.appState.currentSessionId = null
  mocks.appState.sessionIndexRevision = 0
  mocks.appState.selectedModel = "test-model"
  mocks.appState.inputStates = {}
  mocks.appState.lastSelectedPromptId = null
  mocks.appState.systemPrompts = []
  mocks.providerState.providerSnapshot = {
    default_provider_instance_id: "test-provider",
    instances: [{ id: "test-provider", type: "openai", label: "Test", enabled: true, config: { runtime_models: ["test-model"] } }],
    defaults: { chat: { provider: "test-provider", model: "test-model" } },
  }
  mocks.providerState.catalog = null
  mocks.providerState.getProviderType.mockReset()
  mocks.providerState.getProviderType.mockReturnValue(undefined)
  for (const mock of [
    mocks.appState.selectSession,
    mocks.appState.loadSubagentSessions,
    mocks.appState.restoreSession,
    mocks.appState.loadChatHistory,
    mocks.appState.refreshChatsNow,
    mocks.appState.markCancel,
    mocks.appState.updateSession,
    mocks.appState.updateTokenUsage,
    mocks.appState.setTruncationInfo,
    mocks.initializeStore,
    mocks.sendMessage,
    mocks.execute,
    mocks.subscribeToEvents,
    mocks.truncateSessionMessages,
    mocks.stopGeneration,
    mocks.deleteSessionMessage,
    mocks.patchSessionMessage,
    mocks.restoreSessionState,
    mocks.respondToChildApproval,
    mocks.getPendingQuestion,
    mocks.getSession,
    mocks.submitPermissionDecision,
    mocks.apiGet,
    mocks.apiPost,
    mocks.acknowledgeTemplate,
  ]) {
    mock.mockReset()
  }
  mocks.initializeStore.mockResolvedValue(undefined)
  mocks.appState.selectSession.mockImplementation((sessionId: string | null) => {
    mocks.appState.currentSessionId = sessionId
  })
  mocks.appState.updateTokenUsage.mockImplementation((sessionId: string, usage: TokenUsage) => {
    const chat = mocks.appState.chats.find((candidate) => candidate.id === sessionId)
    if (chat) chat.tokenUsage = usage
  })
  mocks.appState.loadSubagentSessions.mockResolvedValue(undefined)
  mocks.appState.restoreSession.mockResolvedValue(false)
  mocks.appState.loadChatHistory.mockResolvedValue(undefined)
  mocks.appState.refreshChatsNow.mockResolvedValue(undefined)
  mocks.execute.mockResolvedValue(undefined)
  mocks.subscribeToEvents.mockResolvedValue(undefined)
  mocks.truncateSessionMessages.mockResolvedValue(undefined)
  mocks.getPendingQuestion.mockResolvedValue({ has_pending_question: false })
  mocks.getSession.mockRejectedValue(new Error("no status fixture"))
  mocks.apiGet.mockRejectedValue(new Error("no pending question"))
  mocks.apiPost.mockResolvedValue(undefined)
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount())
  vi.useRealTimers()
  document.body.replaceChildren()
  consoleErrorSpy.mockRestore()
  consoleWarnSpy.mockRestore()
})
describe("useChat two-phase send lifecycle", () => {
  const fenceRoot = (enabled = false) => beginRootModeOperation("root-session", 0, "a".repeat(64), enabled)

  it("submits and executes a saved custom model with its provider before catalog metadata loads", async () => {
    const customRef = { provider: "test-provider", model: "vendor:custom-name" }
    mocks.providerState.providerSnapshot!.instances[0].config.runtime_models!.push(customRef.model)
    mocks.appState.selectedModel = customRef.model
    mocks.sendMessage.mockResolvedValueOnce({ session_id: "custom-session" })
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())
    const hook = await mountUseChat({ mode: "bound", sessionId: null })

    await act(async () => { await hook.current.send("use the admitted custom model") })

    expect(mocks.providerState.catalog).toBeNull()
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ model: customRef.model, model_ref: customRef }))
    expect(mocks.execute).toHaveBeenCalledWith("custom-session", customRef.model, undefined, undefined, customRef)
  })

  it.each([["custom-model", "custom-model"], ["foreign-cached-model", "test-model"]])("uses saved instance admission without role defaults for selected %s", async (selected, expectedModel) => {
    const snapshot = mocks.providerState.providerSnapshot!
    snapshot.defaults = undefined
    snapshot.features = { provider_model_ref: false }
    snapshot.instances[0].config.model = "test-model"
    snapshot.instances[0].config.runtime_models = ["test-model", "custom-model"]
    mocks.appState.selectedModel = selected
    mocks.sendMessage.mockResolvedValueOnce({ session_id: "instance-only-session" })
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())
    const hook = await mountUseChat({ mode: "bound", sessionId: null })
    await act(async () => { await hook.current.send("start from the first provider") })
    const expectedRef = { provider: "test-provider", model: expectedModel }
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ model: expectedModel, model_ref: expectedRef }))
    expect(mocks.execute).toHaveBeenCalledWith("instance-only-session", expectedModel, undefined, undefined, expectedRef)
  })

  it("resolves a cached new-chat submission against the current provider and freezes that ref for execute", async () => {
    const snapshot = mocks.providerState.providerSnapshot!
    snapshot.instances.push({ id: "second-provider", type: "openai", label: "Second", enabled: true, config: { runtime_models: ["second-default"] } })
    const response = deferred<{ session_id: string }>()
    mocks.sendMessage.mockReturnValueOnce(response.promise)
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())
    const hook = await mountUseChat({ mode: "bound", sessionId: null })
    const cachedSend = hook.current.send
    // The global cached choice still belongs to the previous provider.
    snapshot.defaults = { chat: { provider: "second-provider", model: "second-default" } }
    let sending!: Promise<SendSubmissionResult>
    act(() => { sending = cachedSend("use the newly configured provider") })
    const expectedRef = { provider: "second-provider", model: "second-default" }
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ model: expectedRef.model, model_ref: expectedRef }))

    // A later preference change must not reroute the acknowledged session.
    snapshot.defaults = { chat: { provider: "test-provider", model: "test-model" } }
    await hook.rerender({ mode: "bound", sessionId: null })
    await act(async () => { response.resolve({ session_id: "switched-session" }); await sending })
    expect(mocks.execute).toHaveBeenCalledWith("switched-session", expectedRef.model, undefined, undefined, expectedRef)
  })

  it.each(["empty", "disabled", "missing"] as const)("blocks a new chat when saved admission is %s", async (mode) => {
    if (mode === "empty") mocks.providerState.providerSnapshot!.instances[0].config.runtime_models = []
    if (mode === "disabled") mocks.providerState.providerSnapshot!.instances[0].enabled = false
    if (mode === "missing") mocks.providerState.providerSnapshot = null
    const hook = await mountUseChat({ mode: "bound", sessionId: null })
    let result!: SendSubmissionResult
    await act(async () => { result = await hook.current.send("no eligible runtime model") })
    expect(result).toEqual({ kind: "blocked" })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it.each(["main", "bound"] as const)("keeps the %s pane's user bubble until its acknowledged message is in history", async (mode) => {
    const sessionId = "delayed-user-history"
    const text = "repeat the same request"
    const image = { base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", name: "lifecycle.gif", size: 42, type: "image/gif" }
    const oldUser = { id: "old-user", role: "user", content: text, createdAt: "2026-10-06T10:00:00Z" }
    const oldAssistant = { id: "old-reply", role: "assistant", type: "text", content: "previous response", createdAt: "2026-10-06T10:00:01Z" }
    mocks.appState.chats = [{ id: sessionId, messages: [oldUser, oldAssistant], config: { model: "test-model" } }]
    mocks.appState.currentSessionId = sessionId
    const initialHistory = deferred<void>()
    mocks.appState.loadChatHistory.mockReturnValueOnce(initialHistory.promise)
    mocks.sendMessage.mockResolvedValueOnce({ session_id: sessionId, message_id: "acknowledged-user" })
    let handlers!: SubscriptionHandlers
    mocks.subscribeToEvents.mockImplementationOnce((_sessionId: string, nextHandlers: SubscriptionHandlers) => {
      handlers = nextHandlers
      return pendingForever()
    })
    const props: HookProps = mode === "main" ? { mode } : { mode, sessionId }
    const renders: Array<{ pending: string | null; messages: HookValue["messages"] }> = []
    const hook = await mountUseChat(props, (value) => renders.push({ pending: value.pendingUserText, messages: value.messages }))
    await act(async () => { await hook.current.send(text, { images: [image] }) })
    expect(hook.current.pendingUserText).toBe(text)
    expect(hook.current.pendingUserImages).toEqual([expect.objectContaining({ name: image.name })])

    // A successful GET can still contain only the previous turn. Run-started
    // summaries and the first assistant token are not durable user-message proof.
    await act(async () => { initialHistory.resolve(); await Promise.resolve() })
    expect(hook.current.pendingUserText).toBe(text)
    expect(hook.current.pendingUserImages).toEqual([expect.objectContaining({ name: image.name })])
    mocks.appState.chats = [{ ...mocks.appState.chats[0], isRunning: true, messages: [oldUser, oldAssistant] }]
    await hook.rerender(props)
    expect(hook.current.pendingUserText).toBe(text)
    expect(hook.current.pendingUserImages).toEqual([expect.objectContaining({ name: image.name })])
    await act(async () => {
      handlers.onToken("reply before user history")
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    expect(hook.current.streaming).toBe("reply before user history")
    expect(hook.current.pendingUserText).toBe(text)
    expect(hook.current.pendingUserImages).toEqual([expect.objectContaining({ name: image.name })])

    const currentAssistant = { ...oldAssistant, id: "current-reply", content: "reply before user history" }
    mocks.appState.chats = [{ ...mocks.appState.chats[0], messages: [oldUser, oldAssistant, currentAssistant] }]
    await hook.rerender(props)
    expect(hook.current.pendingUserText).toBe(text)
    expect(hook.current.pendingUserImages).toEqual([expect.objectContaining({ name: image.name })])
    const currentUser = { ...oldUser, id: "acknowledged-user" }
    mocks.appState.chats = [{ ...mocks.appState.chats[0], messages: [oldUser, oldAssistant, currentUser, currentAssistant] }]
    renders.length = 0
    await hook.rerender(props)
    expect(hook.current.pendingUserText).toBeNull()
    expect(hook.current.pendingUserImages).toHaveLength(0)
    expect(renders.length).toBeGreaterThan(0)
    expect(renders.every((render) => render.pending === null)).toBe(true)
    expect(hook.current.messages.filter((message) => message.role === "user")).toHaveLength(2)
    expect(mocks.appState.loadChatHistory).toHaveBeenLastCalledWith(sessionId, { mode: "monotonic" })
  })

  it("matches a new user ID when an acknowledgement has no message ID, even for identical text", async () => {
    const sessionId = "legacy-acknowledgement"
    const text = "same text"
    const oldUser = { id: "old-user", role: "user", content: text, createdAt: "2026-10-06T10:00:00Z" }
    mocks.appState.chats = [{ id: sessionId, messages: [oldUser] }]
    mocks.sendMessage.mockResolvedValueOnce({ session_id: sessionId })
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())
    const props: HookProps = { mode: "bound", sessionId }
    const hook = await mountUseChat(props)
    await act(async () => { await hook.current.send(text) })
    expect(hook.current.pendingUserText).toBe(text)
    mocks.appState.chats = [{ id: sessionId, messages: [oldUser, { ...oldUser, id: "unrelated-user", content: "other request" }] }]
    await hook.rerender(props)
    expect(hook.current.pendingUserText).toBe(text)
    mocks.appState.chats = [{ id: sessionId, messages: [oldUser, { ...oldUser, id: "new-user" }] }]
    await hook.rerender(props)
    expect(hook.current.pendingUserText).toBeNull()
  })

  it("does not let an earlier history request retire a later send of the same text", async () => {
    const sessionId = "repeated-operations"
    const text = "again"
    const firstHistory = deferred<void>()
    const secondHistory = deferred<void>()
    const firstSubscription = deferred<void>()
    let firstHandlers!: SubscriptionHandlers
    mocks.appState.chats = [{ id: sessionId, messages: [] }]
    mocks.sendMessage
      .mockResolvedValueOnce({ session_id: sessionId, message_id: "first-user" })
      .mockResolvedValueOnce({ session_id: sessionId, message_id: "second-user" })
    mocks.appState.loadChatHistory
      .mockReturnValueOnce(firstHistory.promise)
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(secondHistory.promise)
    mocks.subscribeToEvents
      .mockImplementationOnce((_sessionId: string, handlers: SubscriptionHandlers) => { firstHandlers = handlers; return firstSubscription.promise })
      .mockReturnValueOnce(pendingForever())
    const props: HookProps = { mode: "bound", sessionId }
    const hook = await mountUseChat(props)
    await act(async () => { await hook.current.send(text) })
    appendPersistedUser(sessionId, text, "first-user")
    await hook.rerender(props)
    expect(hook.current.pendingUserText).toBeNull()
    await act(async () => { firstHandlers.onComplete(); firstSubscription.resolve() })
    expect(hook.current.sending).toBe(false)
    await act(async () => { await hook.current.send(text) })
    expect(hook.current.pendingUserText).toBe(text)
    await act(async () => { firstHistory.resolve(); secondHistory.resolve() })
    expect(hook.current.pendingUserText).toBe(text)
    appendPersistedUser(sessionId, text, "second-user")
    await hook.rerender(props)
    expect(hook.current.pendingUserText).toBeNull()
    expect(hook.current.messages.filter((message) => message.role === "user")).toHaveLength(2)
  })

  it.each(["complete", "error", "cancelled"] as const)("retains the user bubble when %s history resolves without the user message", async (terminal) => {
    const sessionId = "stale-terminal-user-history"
    const text = "accepted user message"
    const image = { base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", name: "lifecycle.gif", size: 42, type: "image/gif" }
    const initialHistory = deferred<void>()
    const terminalHistory = deferred<void>()
    const subscription = deferred<void>()
    let handlers!: SubscriptionHandlers
    mocks.appState.chats = [{ id: sessionId, messages: [] }]
    mocks.sendMessage.mockResolvedValueOnce({ session_id: sessionId, message_id: "accepted-user" })
    mocks.appState.loadChatHistory.mockReturnValueOnce(initialHistory.promise).mockReturnValueOnce(terminalHistory.promise)
    mocks.subscribeToEvents.mockImplementationOnce((_sessionId: string, nextHandlers: SubscriptionHandlers) => { handlers = nextHandlers; return subscription.promise })
    const props: HookProps = { mode: "bound", sessionId }
    const hook = await mountUseChat(props)
    await act(async () => { await hook.current.send(text, { images: [image] }) })
    await act(async () => {
      if (terminal === "complete") handlers.onComplete()
      else if (terminal === "error") handlers.onError("generation failed")
      else handlers.onCancelled()
      subscription.resolve()
      terminalHistory.resolve()
    })
    expect(hook.current.sending).toBe(false)
    expect(hook.current.pendingUserText).toBe(text)
    expect(hook.current.pendingUserImages[0]?.name).toBe(image.name)
    appendPersistedUser(sessionId, text, "accepted-user")
    await hook.rerender(props)
    expect(hook.current.pendingUserText).toBeNull()
    expect(hook.current.pendingUserImages).toHaveLength(0)
    await act(async () => { initialHistory.resolve() })
    expect(hook.current.pendingUserText).toBeNull()
    expect(hook.current.pendingUserImages).toHaveLength(0)
  })

  it.each(["workflow_revision_missing", "workflow_revision_mismatch", "workflow_source_mismatch", "root_orchestration_incompatible_mode"])("forwards exact typed selection without inline Root choice and returns %s", async (code) => {
    mocks.appState.chats = [{ id: "root-session", messages: [], config: { model: "test-model" } }]
    mocks.sendMessage.mockRejectedValueOnce(new ApiError("selection rejected", 409, "Conflict", JSON.stringify({ error: { code, message: "selection rejected" } })))
    const hook = await mountUseChat({ mode: "bound", sessionId: "root-session" })
    const workflowSelection = { id: "exact/id", source: "project" as const, revision: 17, args: { target: "src" } }
    let result: SendSubmissionResult | undefined
    await act(async () => { result = await hook.current.send("bounded task", { workflowSelection }) })
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ workflow_selection: workflowSelection, root_orchestration_only: undefined, thinking_mode: undefined }))
    expect(result).toMatchObject({ kind: "unconfirmed", workflowError: { code, message: "selection rejected" } })
    expect(getRootModeFenceState("root-session")).toBe("clear")
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it.each([true, false])("blocks inline mode selection %s on an existing Root", async (selection) => {
    mocks.appState.chats = [{ id: "root-session", messages: [], config: { model: "test-model" } }]
    const hook = await mountUseChat({ mode: "bound", sessionId: "root-session" })
    let outcome: SendSubmissionResult | undefined
    await act(async () => { outcome = await hook.current.send("coordinate children", { rootOrchestrationOnly: selection }) })
    expect(outcome).toEqual({ kind: "blocked" })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it.each([true, false, undefined])("forwards a new Root creation choice %s", async (selection) => {
    mocks.sendMessage.mockRejectedValueOnce(new Error("admission failed"))
    const hook = await mountUseChat({ mode: "bound", sessionId: null })
    await act(async () => { await hook.current.send("coordinate children", { rootOrchestrationOnly: selection }) })
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      session_id: undefined,
      root_orchestration_only: selection,
      thinking_mode: selection === undefined ? undefined : selection ? "ultra" : "standard",
    }))
  })

  it.each(["ultra", "standard"] as const)("submits product mode %s independently of ordinary Max", async (thinkingMode) => {
    mocks.sendMessage.mockRejectedValueOnce(new Error("admission failed"))
    const hook = await mountUseChat({ mode: "bound", sessionId: null })
    await act(async () => { await hook.current.send("coordinate", { thinkingMode, reasoningSelection: "max" }) })
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      thinking_mode: thinkingMode, root_orchestration_only: thinkingMode === "ultra", reasoning_effort: "max",
    }))
  })

  it("keeps Auto inherited for Ultra and leaves unspecified admission unchanged", async () => {
    mocks.sendMessage.mockRejectedValue(new Error("admission failed"))
    const hook = await mountUseChat({ mode: "bound", sessionId: null })
    await act(async () => { await hook.current.send("coordinate", { thinkingMode: "ultra", reasoningSelection: "auto" }) })
    expect(mocks.sendMessage.mock.calls[0][0]).toMatchObject({ thinking_mode: "ultra", root_orchestration_only: true })
    expect(mocks.sendMessage.mock.calls[0][0].reasoning_effort).toBeUndefined()
    await act(async () => { await hook.current.send("default admission") })
    const request = JSON.parse(JSON.stringify(mocks.sendMessage.mock.calls[1][0]))
    expect(request).not.toHaveProperty("thinking_mode")
    expect(request).not.toHaveProperty("root_orchestration_only")
  })

  it.each([
    { thinkingMode: "ultra", rootOrchestrationOnly: false },
    { thinkingMode: "standard", rootOrchestrationOnly: true },
    { thinkingMode: "max" }, { thinkingMode: null },
  ])("blocks invalid/contradictory first-chat selection %j", async (opts) => {
    const hook = await mountUseChat({ mode: "bound", sessionId: null })
    let outcome: SendSubmissionResult | undefined
    await act(async () => { outcome = await hook.current.send("coordinate", opts as never) })
    expect(outcome).toEqual({ kind: "blocked" })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it.each(["standard", "ultra"] as const)("blocks existing-Root selector %s", async (thinkingMode) => {
    mocks.appState.chats = [{ id: "root-session", messages: [], config: { model: "test-model" } }]
    const hook = await mountUseChat({ mode: "bound", sessionId: "root-session" })
    let outcome: SendSubmissionResult | undefined
    await act(async () => { outcome = await hook.current.send("coordinate", { thinkingMode }) })
    expect(outcome).toEqual({ kind: "blocked" })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it("classifies a typed new-Root creation rejection without a mode-operation fence", async () => {
    mocks.sendMessage.mockRejectedValueOnce(new ApiError(
      "Root orchestration-only mode conflicts with an active PlanMode",
      409,
      "Conflict",
      JSON.stringify({ error: { code: "root_orchestration_incompatible_mode" } }),
    ))
    const hook = await mountUseChat({ mode: "bound", sessionId: null })
    let result: Awaited<ReturnType<typeof hook.current.send>> | undefined
    await act(async () => { result = await hook.current.send("switch mode", { rootOrchestrationOnly: true }) })

    expect(result).toEqual({ kind: "unconfirmed", operationId: 1, rejectionCode: "root_orchestration_incompatible_mode" })
    expect(hook.current.sendFailure).toMatchObject({
      kind: "submission-unconfirmed",
      rejectionCode: "root_orchestration_incompatible_mode",
      message: "Root orchestration-only mode conflicts with an active PlanMode",
    })
    expect(localStorage.length).toBe(0)
  })

  it("labels a typed Skill conflict without claiming the request changed Root mode", async () => {
    mocks.appState.chats = [{ id: "root-session", messages: [], config: { model: "test-model" } }]
    mocks.sendMessage.mockRejectedValueOnce(new ApiError(
      "Selected Skill conflicts with active Root mode", 409, "Conflict",
      JSON.stringify({ error: { code: "root_orchestration_incompatible_mode" } }),
    ))
    const hook = await mountUseChat({ mode: "bound", sessionId: "root-session" })
    await act(async () => { await hook.current.send("use selected Skill", { skillIds: ["skill-a"] }) })
    expect(hook.current.sendFailure).toMatchObject({
      kind: "submission-unconfirmed",
      rejectionCode: "root_orchestration_incompatible_mode",
      rootModeSelectionSubmitted: false,
    })
    expect(getRootModeFenceState("root-session")).toBe("clear")
  })

  it("blocks omitted sends after a mode-only operation is fenced across remount", async () => {
    mocks.appState.chats = [{ id: "root-session", messages: [], config: { model: "test-model" } }]
    expect(fenceRoot(false)).not.toBeNull()
    const hook = await mountUseChat({ mode: "bound", sessionId: "root-session" })
    let outcome: SendSubmissionResult | undefined
    await act(async () => { outcome = await hook.current.send("continue without boolean") })
    expect(outcome).toEqual({ kind: "blocked" })
    expect(getRootModeFenceState("root-session")).toBe("uncertain")
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()

    hook.unmount()
    const restored = await mountUseChat({ mode: "bound", sessionId: "root-session" })
    await act(async () => { outcome = await restored.current.send("retry after reload", { rootOrchestrationOnly: true }) })
    expect(outcome).toEqual({ kind: "blocked" })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it("does not execute a rerun when a mode fence appears during preparation", async () => {
    mocks.appState.chats = [{ id: "root-session", messages: [], config: { model: "test-model" } }]
    const preparation = deferred<void>()
    mocks.truncateSessionMessages.mockReturnValueOnce(preparation.promise)
    const hook = await mountUseChat({ mode: "bound", sessionId: "root-session" })
    let rerun!: Promise<void>
    act(() => { rerun = hook.current.regenerate() })
    expect(mocks.truncateSessionMessages).toHaveBeenCalledTimes(1)
    expect(fenceRoot(false)).not.toBeNull()
    preparation.resolve()
    await act(async () => { await rerun })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it("keeps an acknowledged message but does not execute it after another tab fences the Session", async () => {
    mocks.appState.chats = [{ id: "root-session", messages: [], config: { model: "test-model" } }]
    const acknowledgement = deferred<{ session_id: string }>()
    mocks.sendMessage.mockReturnValueOnce(acknowledgement.promise)
    const hook = await mountUseChat({ mode: "bound", sessionId: "root-session" })
    let sending!: Promise<SendSubmissionResult>
    act(() => { sending = hook.current.send("accepted ordinary message") })
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(fenceRoot(false)).not.toBeNull()
    acknowledgement.resolve({ session_id: "root-session" })
    let outcome: SendSubmissionResult | undefined
    await act(async () => { outcome = await sending; await Promise.resolve() })
    expect(outcome).toMatchObject({ kind: "accepted", sessionId: "root-session" })
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(hook.current.sendFailure).toMatchObject({
      kind: "generation-failed", message: expect.stringContaining("消息已保存"),
    })
    expect(mocks.appState.loadChatHistory).toHaveBeenCalledWith("root-session", { mode: "monotonic" })
  })

  it("does not start detached execution after another tab fences an acknowledged Session", async () => {
    mocks.appState.chats = [{ id: "root-session", messages: [], config: { model: "test-model" } }]
    const acknowledgement = deferred<{ session_id: string }>()
    mocks.sendMessage.mockReturnValueOnce(acknowledgement.promise)
    const hook = await mountUseChat({ mode: "bound", sessionId: "root-session" })
    let sending!: Promise<SendSubmissionResult>
    act(() => { sending = hook.current.send("accepted while leaving") })
    await hook.rerender({ mode: "bound", sessionId: "other-session" })
    expect(fenceRoot(false)).not.toBeNull()
    acknowledgement.resolve({ session_id: "root-session" })
    await act(async () => { expect((await sending).kind).toBe("accepted") })
    expect(mocks.execute).not.toHaveBeenCalled()
    await hook.rerender({ mode: "bound", sessionId: "root-session" })
    expect(hook.current.sendFailure).toMatchObject({
      kind: "generation-failed", message: expect.stringContaining("消息已保存"),
    })
  })

  it.each([
    ["new-session POST rejection", null, "reject", "no ack"],
    ["empty acknowledgement", null, "empty", "The chat submission response did not acknowledge the expected session."],
    ["existing-session POST rejection", "existing-session", "reject", "no ack"],
  ] as const)("keeps %s unconfirmed without rerunning a previous turn", async (_case, sid, mode, message) => {
    if (mode === "reject") mocks.sendMessage.mockRejectedValueOnce(new Error("no ack"))
    else mocks.sendMessage.mockResolvedValueOnce({ session_id: "   " })
    const hook = await mountUseChat({ mode: "bound", sessionId: sid })
    let result: SendSubmissionResult | undefined
    await act(async () => {
      result = await hook.current.send("do not lose this")
    })
    expect(result).toEqual({ kind: "unconfirmed", operationId: 1 })
    expect(hook.current.sendFailure).toEqual({
      kind: "submission-unconfirmed",
      operationId: 1,
      sessionId: sid,
      message,
    })
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: "do not lose this", session_id: sid ?? undefined }),
    )
    expect(hook.current.submissionPending).toBe(false)
    expect(hook.current.sending).toBe(false)
    await act(async () => void (await hook.current.retry()))
    await flushMicrotasks()
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.subscribeToEvents).not.toHaveBeenCalled()
    expect(mocks.truncateSessionMessages).not.toHaveBeenCalled()
    expect(mocks.appState.refreshChatsNow).not.toHaveBeenCalled()
    expect(mocks.appState.loadChatHistory).not.toHaveBeenCalled()
    expect(getUsedModels()).toEqual([])
  })
  it("records the selected model only after the submission is acknowledged", async () => {
    mocks.sendMessage.mockResolvedValueOnce({ session_id: "used-model-session" })
    const hook = await mountUseChat({ mode: "bound", sessionId: null })

    await act(async () => {
      await hook.current.send("remember this model")
    })

    expect(getUsedModels()).toEqual(["test-model"])
  })
  it("acknowledges the exact template lease only after a valid submission acknowledgement", async () => {
    const templatePrompt = { prompt: "Use the exact template", revision: 17 }
    mocks.appState.lastSelectedPromptId = "general_assistant"
    mocks.appState.systemPrompts = [{
      id: "general_assistant",
      content: "You are the selected Bodhi assistant.",
      isDefault: true,
    }]
    mocks.sendMessage
      .mockRejectedValueOnce(new Error("submission not acknowledged"))
      .mockResolvedValueOnce({ session_id: "template-session" })
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())
    const hook = await mountUseChat({ mode: "bound", sessionId: null })
    await act(async () => {
      await hook.current.send("first attempt", { templatePrompt })
    })
    expect(mocks.acknowledgeTemplate).not.toHaveBeenCalled()
    let accepted: SendSubmissionResult | undefined
    await act(async () => {
      accepted = await hook.current.send("second attempt", { templatePrompt })
    })
    expect(accepted).toMatchObject({ kind: "accepted", sessionId: "template-session" })
    expect(mocks.acknowledgeTemplate).toHaveBeenCalledTimes(1)
    expect(mocks.acknowledgeTemplate).toHaveBeenCalledWith(templatePrompt)
    expect(mocks.sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        system_prompt:
          "You are the selected Bodhi assistant.\n\n## Task Mode\nUse the exact template",
      }),
    )
  })
  it("keeps the default prompt when a task template is selected without an explicit preset", async () => {
    const templatePrompt = { prompt: "Investigate the reported failure.", revision: 18 }
    mocks.appState.systemPrompts = [
      { id: "custom", content: "Custom prompt" },
      { id: "general_assistant", content: "Default Bodhi prompt", isDefault: true },
    ]
    mocks.sendMessage.mockResolvedValueOnce({ session_id: "default-template-session" })
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())
    const hook = await mountUseChat({ mode: "bound", sessionId: null })

    await act(async () => {
      await hook.current.send("start investigation", { templatePrompt })
    })

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        system_prompt:
          "Default Bodhi prompt\n\n## Task Mode\nInvestigate the reported failure.",
      }),
    )
  })
  it("commits an acknowledged template and starts generation after the submitting pane unmounts", async () => {
    const acknowledgement = deferred<{ session_id: string }>()
    const templatePrompt = { prompt: "Detached template", revision: 23 }
    mocks.sendMessage.mockReturnValueOnce(acknowledgement.promise)
    const hook = await mountUseChat({ mode: "bound", sessionId: null })
    let sending!: Promise<SendSubmissionResult>
    act(() => {
      sending = hook.current.send("accepted while leaving", { templatePrompt })
    })
    hook.unmount()
    let result: SendSubmissionResult | undefined
    await act(async () => {
      acknowledgement.resolve({ session_id: "detached-session" })
      result = await sending
    })
    expect(result).toMatchObject({
      kind: "accepted",
      sessionId: "detached-session",
      navigated: false,
    })
    expect(mocks.acknowledgeTemplate).toHaveBeenCalledTimes(1)
    expect(mocks.acknowledgeTemplate).toHaveBeenCalledWith(templatePrompt)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledWith("detached-session", "test-model", undefined, undefined, { provider: "test-provider", model: "test-model" })
    expect(mocks.subscribeToEvents).not.toHaveBeenCalled()
    expect(mocks.appState.selectSession).not.toHaveBeenCalled()
  })
  it("synchronously fences duplicate sends while the first POST is pending", async () => {
    const acknowledgement = deferred<{ session_id: string }>()
    mocks.sendMessage.mockReturnValueOnce(acknowledgement.promise)
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())
    const hook = await mountUseChat({ mode: "bound", sessionId: null })
    let first!: Promise<SendSubmissionResult>
    let second!: Promise<SendSubmissionResult>
    act(() => {
      first = hook.current.send("only once")
      second = hook.current.send("only once")
    })
    await expect(second).resolves.toEqual({ kind: "busy" })
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(mocks.execute).not.toHaveBeenCalled()
    let firstResult: SendSubmissionResult | undefined
    await act(async () => {
      acknowledgement.resolve({ session_id: "session-one" })
      firstResult = await first
    })
    expect(firstResult).toMatchObject({ kind: "accepted", sessionId: "session-one" })
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledWith("session-one", "test-model", undefined, undefined, { provider: "test-provider", model: "test-model" })
  })
  it("routes a main-pane new session through the global session store", async () => {
    mocks.sendMessage.mockResolvedValueOnce({ session_id: "main-session" })
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())
    const hook = await mountUseChat({ mode: "main" })
    let result: SendSubmissionResult | undefined
    await act(async () => {
      result = await hook.current.send("start in the main pane")
    })
    expect(result).toMatchObject({
      kind: "accepted",
      sessionId: "main-session",
      navigated: true,
    })
    expect(mocks.appState.selectSession).toHaveBeenCalledTimes(1)
    expect(mocks.appState.selectSession).toHaveBeenCalledWith("main-session")
    expect(mocks.execute).toHaveBeenCalledWith("main-session", "test-model", undefined, undefined, { provider: "test-provider", model: "test-model" })
    expect(mocks.subscribeToEvents).toHaveBeenCalledWith(
      "main-session",
      expect.any(Object),
      expect.any(AbortController),
    )
  })
  it.each([
    ["a blank new chat", null],
    ["another session", "session-b"],
  ] as const)("detaches the old UI stream when navigating to %s", async (_label, destination) => {
    mocks.appState.currentSessionId = "session-a"
    mocks.appState.chats = [{ id: "session-a", messages: [], isRunning: true }]
    mocks.sendMessage.mockResolvedValueOnce({ session_id: "session-a" })
    let controller: AbortController | undefined
    mocks.subscribeToEvents.mockImplementationOnce(
      (_sessionId: string, _handlers: SubscriptionHandlers, nextController: AbortController) => {
        controller = nextController
        return new Promise<void>((resolve) => {
          nextController.signal.addEventListener("abort", () => resolve(), { once: true })
        })
      },
    )
    const hook = await mountUseChat({ mode: "main" })
    await act(async () => {
      await hook.current.send("keep running in session A")
    })
    expect(hook.current.sending).toBe(true)
    expect(hook.current.streaming).toBe("")

    await act(async () => {
      if (destination === null) hook.current.newChat()
      else hook.current.select(destination)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(controller?.signal.aborted).toBe(true)
    expect(mocks.stopGeneration).not.toHaveBeenCalled()
    expect(mocks.appState.selectSession).toHaveBeenLastCalledWith(destination)
    if (destination !== null) {
      expect(mocks.appState.loadChatHistory).toHaveBeenCalledWith(destination)
    }
    expect(hook.current.currentSessionId).toBe(destination)
    expect(hook.current.sending).toBe(false)
    expect(hook.current.streaming).toBeNull()
  })
  it("restores a persisted child before allowing the default root to be persisted", async () => {
    localStorage.setItem("lotus_next_last_session", "saved-child")
    mocks.initializeStore.mockImplementationOnce(async () => {
      mocks.appState.chats = [{ id: "default-root", messages: [] }]
      mocks.appState.currentSessionId = "default-root"
    })
    mocks.appState.restoreSession.mockImplementationOnce(async (sessionId: string) => {
      mocks.appState.chats = [...mocks.appState.chats, { id: sessionId, messages: [] }]
      return true
    })

    await mountUseChat({ mode: "main" })
    await vi.waitFor(() => {
      expect(mocks.appState.selectSession).toHaveBeenCalledWith("saved-child")
    })

    expect(mocks.appState.restoreSession).toHaveBeenCalledExactlyOnceWith("saved-child")
    expect(mocks.appState.loadChatHistory).toHaveBeenCalledWith("saved-child")
    expect(localStorage.getItem("lotus_next_last_session")).toBe("saved-child")
  })
  it("force-refreshes a bound pane tree when the root index advances without navigation", async () => {
    mocks.appState.chats = [{ id: "split-root", messages: [] }]
    const hook = await mountUseChat({ mode: "bound", sessionId: "split-root" })
    await vi.waitFor(() => {
      expect(mocks.appState.loadSubagentSessions).toHaveBeenCalledExactlyOnceWith(
        "split-root",
        { force: true },
      )
    })

    mocks.appState.loadSubagentSessions.mockClear()
    mocks.appState.sessionIndexRevision += 1
    await hook.rerender({ mode: "bound", sessionId: "split-root" })

    expect(mocks.appState.loadSubagentSessions).toHaveBeenCalledExactlyOnceWith(
      "split-root",
      { force: true },
    )
  })
  it("hydrates admitted guidance from the live stream in a bound pane", async () => {
    const sessionId = "split-guidance"
    mocks.shouldObserve = true
    mocks.appState.chats = [{ id: sessionId, messages: [], isRunning: true }]
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())

    await mountUseChat({ mode: "bound", sessionId })
    await vi.waitFor(() => expect(mocks.subscribeToEvents).toHaveBeenCalledTimes(1))
    const handlers = mocks.subscribeToEvents.mock.calls[0][1] as SubscriptionHandlers

    act(() => handlers.onMessageAppended(sessionId, "queued-user"))

    expect(mocks.appState.loadChatHistory).toHaveBeenCalledExactlyOnceWith(sessionId, {
      mode: "monotonic",
    })
  })
  it.each([
    [undefined, undefined],
    ["max", "max"],
    ["none", "none"],
  ] as const)(
    "maps a new-session Chat reasoning preference %s without resolving provider defaults",
    async (configuredEffort, expectedWireEffort) => {
      mocks.appState.selectedModel = undefined
      mocks.providerState.providerSnapshot = {
        default_provider_instance_id: "instance-openai",
        instances: [{
          id: "instance-openai",
          type: "openai",
          label: "Easycli",
          enabled: true,
          // Deliberately differs from Auto: the new composer must not turn
          // this inherited provider value into an explicit picker override.
          config: { reasoning_effort: "high" },
        }],
        defaults: {
          chat: {
            provider: "instance-openai",
            model: "gpt-5.6-sol",
            ...(configuredEffort ? { reasoning_effort: configuredEffort } : {}),
          },
        },
        features: { provider_model_ref: true },
      }
      mocks.sendMessage.mockResolvedValueOnce({ session_id: "new-reasoning-session" })
      mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())

      const hook = await mountUseChat({ mode: "bound", sessionId: null })
      await act(async () => {
        await hook.current.send("start with configured reasoning")
      })

      const request = mocks.sendMessage.mock.calls[0][0]
      expect(request.reasoning_effort).toBe(expectedWireEffort)
      const serialized = JSON.parse(JSON.stringify(request)) as Record<string, unknown>
      if (expectedWireEffort === undefined) {
        expect(serialized).not.toHaveProperty("reasoning_effort")
      } else {
        expect(serialized.reasoning_effort).toBe(expectedWireEffort)
      }
      expect(mocks.execute).toHaveBeenCalledWith(
        "new-reasoning-session",
        "gpt-5.6-sol",
        expectedWireEffort,
        undefined,
        { provider: "instance-openai", model: "gpt-5.6-sol" },
      )
    },
  )
  it.each([
    ["auto", undefined],
    ["max", "max"],
    ["none", "none"],
  ] as const)(
    "uses a bound blank pane's frozen picker value %s for chat and execute",
    async (selection, expectedWireEffort) => {
      mocks.appState.selectedModel = undefined
      mocks.providerState.providerSnapshot = {
        default_provider_instance_id: "instance-openai",
        instances: [{
          id: "instance-openai",
          type: "openai",
          label: "Easycli",
          enabled: true,
          config: {},
        }],
        defaults: {
          chat: {
            provider: "instance-openai",
            model: "gpt-5.6-sol",
            reasoning_effort: "medium",
          },
        },
        features: { provider_model_ref: true },
      }
      mocks.sendMessage.mockResolvedValueOnce({ session_id: "new-split-session" })
      mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())

      const hook = await mountUseChat({ mode: "bound", sessionId: null })
      await act(async () => {
        await hook.current.send("start from split pane", {
          reasoningSelection: selection,
        })
      })

      expect(mocks.sendMessage.mock.calls[0][0].reasoning_effort).toBe(expectedWireEffort)
      expect(mocks.execute).toHaveBeenCalledWith(
        "new-split-session",
        "gpt-5.6-sol",
        expectedWireEffort,
        undefined,
        { provider: "instance-openai", model: "gpt-5.6-sol" },
      )
    },
  )
  it("uses the authoritative Chat preference instead of the compatibility provider", async () => {
    mocks.appState.selectedModel = undefined
    mocks.providerState.providerSnapshot = {
      default_provider_instance_id: "compatibility-openai",
      instances: [
        {
          id: "compatibility-openai",
          type: "openai",
          label: "Compatibility OpenAI",
          enabled: true,
          config: { reasoning_effort: "low" },
        },
        {
          id: "instance-openai",
          type: "openai",
          label: "Primary OpenAI",
          enabled: true,
          config: { reasoning_effort: "max" },
        },
      ],
      defaults: {
        chat: {
          provider: "instance-openai",
          model: "gpt-authoritative",
          reasoning_effort: "max",
        },
      },
      features: { provider_model_ref: true },
    }
    mocks.providerState.getProviderType.mockReturnValue("openai")
    mocks.appState.chats = [{
      id: "provider-session",
      messages: [],
      config: { reasoningEffort: "max" },
    }]
    mocks.sendMessage.mockResolvedValueOnce({ session_id: "provider-session" })
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())

    const hook = await mountUseChat({ mode: "bound", sessionId: "provider-session" })
    await act(async () => {
      await hook.current.send("use provider defaults")
    })

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: "provider-session",
        model: "gpt-authoritative",
        model_ref: { provider: "instance-openai", model: "gpt-authoritative" },
      }),
    )
    expect(mocks.execute).toHaveBeenCalledWith(
      "provider-session",
      "gpt-authoritative",
      "max",
      undefined,
      { provider: "instance-openai", model: "gpt-authoritative" },
    )
    expect(mocks.providerState.getProviderType).toHaveBeenCalledWith("instance-openai")
  })
  it("keeps an existing child session bound to its own provider and model", async () => {
    const sessionId = "child-session"
    // A draft selected in another pane must not override this bound session.
    mocks.appState.selectedModel = "grok-4.7"
    mocks.appState.chats = [{
      id: sessionId,
      messages: [],
      config: {
        model: "gpt-5.6-luna",
        model_ref: { provider: "easycli", model: "gpt-5.6-luna" },
      },
    }]
    mocks.providerState.providerSnapshot = {
      default_provider_instance_id: "easycli",
      instances: [{
        id: "easycli",
        type: "openai",
        label: "Easycli",
        enabled: true,
        config: { reasoning_effort: "max" },
      }],
      defaults: {
        chat: { provider: "easycli", model: "gpt-5.6-sol" },
      },
      features: { provider_model_ref: true },
    }
    mocks.providerState.getProviderType.mockReturnValue("openai")
    mocks.sendMessage.mockResolvedValueOnce({ session_id: sessionId })
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())

    const hook = await mountUseChat({ mode: "bound", sessionId })
    await act(async () => {
      await hook.current.send("continue child task")
    })

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: sessionId,
        model: "gpt-5.6-luna",
        model_ref: { provider: "easycli", model: "gpt-5.6-luna" },
      }),
    )
    expect(mocks.execute).toHaveBeenCalledWith(
      sessionId,
      "gpt-5.6-luna",
      "max",
      undefined,
      { provider: "easycli", model: "gpt-5.6-luna" },
    )
    expect(mocks.providerState.getProviderType).toHaveBeenCalledWith("easycli")
  })
  it.each(["complete", "error"] as const)(
    "waits for %s terminal settlement after the transport closes",
    async (terminalKind) => {
      const initialHistory = deferred<void>()
      const terminalHistory = deferred<void>()
      const subscription = deferred<void>()
      let handlers: SubscriptionHandlers | undefined
      mocks.sendMessage.mockResolvedValueOnce({ session_id: "terminal-session" })
      mocks.appState.loadChatHistory
        .mockReturnValueOnce(initialHistory.promise)
        .mockReturnValueOnce(terminalHistory.promise)
      mocks.subscribeToEvents.mockImplementationOnce(
        (_sessionId: string, nextHandlers: SubscriptionHandlers) => {
          handlers = nextHandlers
          return subscription.promise
        },
      )
      const hook = await mountUseChat({ mode: "bound", sessionId: "terminal-session" })
      await act(async () => {
        await hook.current.send("optimistic terminal payload")
      })
      expect(handlers).toBeDefined()
      expect(hook.current.sending).toBe(true)
      expect(hook.current.streaming).toBe("")
      expect(hook.current.pendingUserText).toBe("optimistic terminal payload")
      await act(async () => {
        if (terminalKind === "complete") handlers?.onComplete()
        else handlers?.onError("generation failed")
        // AgentService invokes the terminal callback without awaiting it, then
        // resolves subscribeToEvents immediately after transport teardown.
        subscription.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(hook.current.sending).toBe(true)
      expect(hook.current.pendingUserText).toBe("optimistic terminal payload")
      if (terminalKind === "complete") {
        expect(hook.current.sendFailure).toBeNull()
        expect(mocks.appState.loadChatHistory).toHaveBeenNthCalledWith(2, "terminal-session", {
          mode: "monotonic",
          waitForAssistant: true,
          retries: 8,
          retryDelayMs: 150,
        })
      } else {
        expect(hook.current.sendFailure).toEqual({
          kind: "generation-failed",
          operationId: 1,
          sessionId: "terminal-session",
          pendingOperationId: 1,
          message: "generation failed",
        })
        expect(mocks.appState.loadChatHistory).toHaveBeenNthCalledWith(2, "terminal-session")
      }
      await act(async () => {
        appendPersistedUser("terminal-session", "optimistic terminal payload")
        terminalHistory.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(hook.current.sending).toBe(false)
      expect(hook.current.streaming).toBeNull()
      expect(hook.current.pendingUserText).toBeNull()
      if (terminalKind === "error") {
        expect(hook.current.sendFailure).toEqual({
          kind: "generation-failed",
          operationId: 1,
          sessionId: "terminal-session",
          pendingOperationId: 1,
          message: "generation failed",
        })
      }
    },
  )
  it("retains the completed live tail until WebSocket history reconciliation commits it", async () => {
    const sessionId = "tool-tail-session"
    const subscription = deferred<void>()
    let handlers: SubscriptionHandlers | undefined
    mocks.appState.chats = [{
      id: sessionId,
      isRunning: true,
      messages: [{
        id: "tool-result",
        role: "assistant",
        type: "tool_result",
        createdAt: "2026-09-19T12:00:00Z",
      }],
    }]
    mocks.sendMessage.mockResolvedValueOnce({ session_id: sessionId })
    mocks.subscribeToEvents.mockImplementationOnce(
      (_sessionId: string, nextHandlers: SubscriptionHandlers) => {
        handlers = nextHandlers
        return subscription.promise
      },
    )

    const props = { mode: "bound", sessionId } as const
    const hook = await mountUseChat(props)
    await act(async () => {
      await hook.current.send("finish after the tool")
    })

    await act(async () => {
      handlers?.onToken("durable final answer")
      handlers?.onComplete()
      subscription.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(hook.current.sending).toBe(false)
    expect(hook.current.streamPhase).toBe("finalizing")
    expect(hook.current.streaming).toBe("durable final answer")

    mocks.appState.chats = [{
      id: sessionId,
      isRunning: false,
      messages: [{
        id: "persisted-final",
        role: "assistant",
        type: "text",
        content: "durable final answer",
        createdAt: "2026-09-19T12:00:01Z",
      }],
    }]
    handlers?.onSessionHistoryCommitted(sessionId)
    await hook.rerender(props)
    await flushMicrotasks()

    expect(mocks.appState.loadChatHistory).toHaveBeenLastCalledWith(sessionId, {
      mode: "monotonic",
    })
    expect(hook.current.streaming).toBeNull()
    expect(hook.current.streamPhase).toBeNull()
  })
  it("reconciles a control-only WebSocket terminal instead of reporting an interrupted generation", async () => {
    const sessionId = "control-only-terminal"
    mocks.appState.chats = [{
      id: sessionId,
      isRunning: true,
      lastRunStatus: null,
      messages: [{
        id: "tool-result",
        role: "assistant",
        type: "tool_result",
        createdAt: "2026-09-19T12:00:00Z",
      }],
    }]
    mocks.sendMessage.mockResolvedValueOnce({ session_id: sessionId })
    mocks.subscribeToEvents.mockImplementationOnce(
      async (_sessionId: string, handlers: SubscriptionHandlers) => {
        handlers.onToken("final reply after recovered terminal")
        // The v2 channel resolves on its terminal control, but the semantic
        // Complete frame was not observed by this subscriber.
      },
    )
    mocks.appState.refreshChatsNow.mockImplementation(async () => {
      const chat = mocks.appState.chats.find((candidate) => candidate.id === sessionId)
      if (chat) {
        chat.isRunning = false
        chat.lastRunStatus = "completed"
      }
    })
    mocks.appState.loadChatHistory.mockImplementation(async (_sessionId, options) => {
      if (!options?.waitForAssistant) return
      const chat = mocks.appState.chats.find((candidate) => candidate.id === sessionId)
      if (chat) {
        chat.messages = [{
          id: "persisted-user",
          role: "user",
          content: "recover the missing semantic terminal",
          createdAt: "2026-09-19T12:00:00Z",
        }, {
          id: "persisted-final",
          role: "assistant",
          type: "text",
          content: "final reply after recovered terminal",
          createdAt: "2026-09-19T12:00:01Z",
        }]
      }
    })

    const hook = await mountUseChat({ mode: "bound", sessionId })
    await act(async () => {
      await hook.current.send("recover the missing semantic terminal")
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushMicrotasks()

    expect(mocks.appState.refreshChatsNow).toHaveBeenCalled()
    expect(mocks.appState.loadChatHistory).toHaveBeenCalledWith(sessionId, {
      mode: "monotonic",
      waitForAssistant: true,
      retries: 8,
      retryDelayMs: 150,
    })
    expect(hook.current.sendFailure).toBeNull()
    expect(hook.current.pendingUserText).toBeNull()
    expect(hook.current.streaming).toBeNull()
    expect(hook.current.streamPhase).toBeNull()
  })
  it.each(["refresh", "history"] as const)(
    "starts exact-session generation before resolving accepted when %s hydration fails",
    async (failurePoint) => {
      const milestones: string[] = []
      const image = { base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", name: "lifecycle.gif", size: 42, type: "image/gif" }
      mocks.sendMessage.mockResolvedValueOnce({ session_id: "ack-session" })
      mocks.execute.mockImplementationOnce(async (sessionId: string) => {
        milestones.push(`execute:${sessionId}`)
      })
      mocks.subscribeToEvents.mockImplementationOnce((sessionId: string) => {
        milestones.push(`subscribe:${sessionId}`)
        return pendingForever()
      })
      if (failurePoint === "refresh") {
        mocks.appState.refreshChatsNow.mockRejectedValueOnce(new Error("refresh failed"))
      } else {
        mocks.appState.loadChatHistory.mockRejectedValueOnce(new Error("history failed"))
      }
      const hook = await mountUseChat({
        mode: "bound",
        sessionId: null,
        onSessionCreated: vi.fn(),
      })
      const result = await act(async () => {
        const accepted = await hook.current.send("run after acknowledgement", { images: [image] })
        milestones.push("accepted")
        return accepted
      })
      await flushMicrotasks()
      expect(result).toMatchObject({
        kind: "accepted",
        sessionId: "ack-session",
        navigated: true,
      })
      expect(milestones.slice(0, 3)).toEqual([
        "execute:ack-session",
        "subscribe:ack-session",
        "accepted",
      ])
      expect(mocks.execute).toHaveBeenCalledWith("ack-session", "test-model", undefined, undefined, { provider: "test-provider", model: "test-model" })
      expect(mocks.appState.refreshChatsNow).toHaveBeenCalledTimes(1)
      expect(mocks.appState.loadChatHistory).toHaveBeenCalledWith("ack-session", { mode: "monotonic" })
      expect(hook.current.sendFailure).toBeNull()
      mocks.appState.chats = [{ id: "ack-session", messages: [] }]
      await hook.rerender({ mode: "bound", sessionId: "ack-session" })
      expect(hook.current.pendingUserImages[0]?.name).toBe(image.name)
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    },
  )
  it("fences duplicate retry clicks before truncation and reruns only the owned session", async () => {
    mocks.appState.chats = [{ id: "exact-session", messages: [], config: { model: "test-model" } }]
    mocks.sendMessage.mockResolvedValueOnce({ session_id: "exact-session" })
    let executeAttempt = 0
    mocks.execute.mockImplementation(() => {
      executeAttempt += 1
      return executeAttempt === 1
        ? Promise.reject(new Error("generation did not start"))
        : Promise.resolve()
    })
    mocks.subscribeToEvents
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce((_sessionId: string, handlers: SubscriptionHandlers) => {
        handlers.onComplete()
        return Promise.resolve()
      })
    mocks.appState.loadChatHistory.mockRejectedValueOnce(new Error("ack hydration failed"))
    const hook = await mountUseChat({ mode: "bound", sessionId: "exact-session" })
    let result: SendSubmissionResult | undefined
    await act(async () => {
      result = await hook.current.send("accepted payload")
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushMicrotasks()
    expect(result).toMatchObject({ kind: "accepted", sessionId: "exact-session" })
    expect(hook.current.sendFailure).toMatchObject({
      kind: "generation-failed",
      sessionId: "exact-session",
    })
    expect(hook.current.pendingUserText).toBe("accepted payload")
    const failure = hook.current.sendFailure as GenerationFailure
    await act(async () => {
      await hook.current.retry({ ...failure, operationId: failure.operationId + 1 })
    })
    expect(mocks.truncateSessionMessages).not.toHaveBeenCalled()
    const truncation = deferred<void>()
    mocks.truncateSessionMessages.mockReturnValueOnce(truncation.promise)
    let firstRetry!: Promise<void>
    let duplicateRetry!: Promise<void>
    act(() => {
      firstRetry = hook.current.retry(failure)
      duplicateRetry = hook.current.retry(failure)
    })
    await duplicateRetry
    expect(mocks.truncateSessionMessages).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    await act(async () => {
      appendPersistedUser("exact-session", "accepted payload")
      truncation.resolve()
      await firstRetry
    })
    expect(mocks.truncateSessionMessages).toHaveBeenCalledTimes(1)
    expect(mocks.truncateSessionMessages).toHaveBeenCalledWith("exact-session", {
      mode: "error_retry",
    })
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(mocks.execute).toHaveBeenLastCalledWith("exact-session", "test-model", undefined, undefined, undefined)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(hook.current.sendFailure).toBeNull()
    expect(hook.current.pendingUserText).toBeNull()
  })
  it("retries a persisted backend error after transient hook state is lost", async () => {
    mocks.appState.chats = [{
      id: "persisted-error",
      messages: [],
      lastRunStatus: "error",
      config: { model: "test-model" },
    }]
    mocks.subscribeToEvents.mockImplementationOnce(
      (_sessionId: string, handlers: SubscriptionHandlers) => {
        handlers.onComplete()
        return Promise.resolve()
      },
    )
    const hook = await mountUseChat({ mode: "bound", sessionId: "persisted-error" })

    expect(hook.current.sendFailure).toBeNull()
    await act(async () => void (await hook.current.retry()))

    expect(mocks.truncateSessionMessages).toHaveBeenCalledWith("persisted-error", {
      mode: "error_retry",
    })
    expect(mocks.execute).toHaveBeenCalledWith(
      "persisted-error",
      "test-model",
      undefined,
      undefined,
      undefined,
    )
    expect(mocks.subscribeToEvents).toHaveBeenCalledTimes(1)
  })
  it("continues with the session's saved model instead of another pane's draft choice", async () => {
    mocks.appState.selectedModel = "gpt-6-sol"
    mocks.appState.chats = [{
      id: "resumed-session",
      messages: [],
      lastRunStatus: "error",
      config: {
        model: "grok-4.7",
        model_ref: { provider: "easycli", model: "grok-4.7" },
      },
    }]
    mocks.subscribeToEvents.mockImplementationOnce(
      (_sessionId: string, handlers: SubscriptionHandlers) => {
        handlers.onComplete()
        return Promise.resolve()
      },
    )

    const hook = await mountUseChat({ mode: "bound", sessionId: "resumed-session" })
    await act(async () => void (await hook.current.retry()))

    expect(mocks.execute).toHaveBeenCalledWith(
      "resumed-session",
      "grok-4.7",
      undefined,
      undefined,
      { provider: "easycli", model: "grok-4.7" },
    )
  })
  it("finishes retry for session A without subscribing or contaminating a pane rebound to B", async () => {
    const { hook, truncation, retrying, callCounts } = await startPendingRetry(
      "session-a",
      "optimistic payload owned by A",
    )
    await hook.rerender({ mode: "bound", sessionId: "session-b" })
    await act(async () => {
      appendPersistedUser("session-a", "optimistic payload owned by A")
      truncation.resolve()
      await retrying
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.truncateSessionMessages).toHaveBeenCalledWith("session-a", {
      mode: "error_retry",
    })
    expect(mocks.execute).toHaveBeenCalledTimes(callCounts.execute + 1)
    expect(mocks.execute).toHaveBeenLastCalledWith("session-a", "test-model", undefined, undefined, undefined)
    expect(mocks.subscribeToEvents).toHaveBeenCalledTimes(callCounts.subscribe)
    expect(mocks.appState.loadChatHistory.mock.calls.length).toBeGreaterThan(callCounts.history)
    expect(mocks.appState.loadChatHistory).toHaveBeenLastCalledWith("session-a")
    expect(hook.current.currentSessionId).toBe("session-b")
    expect(hook.current.sending).toBe(false)
    expect(hook.current.submissionPending).toBe(false)
    expect(hook.current.streaming).toBeNull()
    await hook.rerender({ mode: "bound", sessionId: "session-a" })
    expect(hook.current.pendingUserText).toBeNull()
  })
  it("keeps a detached retry failure with A while B sends and permits exact A retry", async () => {
    const { hook, truncation, retrying, callCounts } = await startPendingRetry(
      "detached-a",
      "payload owned by detached A",
    )
    const detachedExecute = deferred<void>()
    mocks.execute.mockReturnValueOnce(detachedExecute.promise)
    await hook.rerender({ mode: "bound", sessionId: "active-b" })
    await act(async () => {
      truncation.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.execute).toHaveBeenCalledTimes(callCounts.execute + 1)
    expect(mocks.subscribeToEvents).toHaveBeenCalledTimes(callCounts.subscribe)
    const bSubscription = deferred<void>()
    let bHandlers: SubscriptionHandlers | undefined
    mocks.sendMessage.mockResolvedValueOnce({ session_id: "active-b" })
    mocks.subscribeToEvents.mockImplementationOnce(
      (_sid: string, handlers: SubscriptionHandlers) => {
        bHandlers = handlers
        return bSubscription.promise
      },
    )
    await act(async () => void (await hook.current.send("B stays active")))
    expect(hook.current.sending).toBe(true)
    expect(hook.current.submissionPending).toBe(false)
    expect(hook.current.streaming).toBe("")
    await act(async () => {
      detachedExecute.reject(new Error("detached A execute failed"))
      await retrying
      await Promise.resolve()
    })
    expect(hook.current.currentSessionId).toBe("active-b")
    expect(hook.current.sendFailure).toBeNull()
    expect(hook.current.sending).toBe(true)
    expect(hook.current.submissionPending).toBe(false)
    expect(hook.current.streaming).toBe("")
    await act(async () => {
      bHandlers?.onComplete()
      bSubscription.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await hook.rerender({ mode: "bound", sessionId: "detached-a" })
    expect(hook.current.sendFailure).toEqual({
      kind: "generation-failed",
      operationId: 2,
      sessionId: "detached-a",
      pendingOperationId: 1,
      message: "detached A execute failed",
    })
    const aFailure = hook.current.sendFailure as GenerationFailure
    const postCount = mocks.sendMessage.mock.calls.length
    mocks.subscribeToEvents.mockImplementationOnce(
      (_sid: string, handlers: SubscriptionHandlers) => {
        handlers.onComplete()
        return Promise.resolve()
      },
    )
    await act(async () => void (await hook.current.retry(aFailure)))
    expect(mocks.truncateSessionMessages).toHaveBeenLastCalledWith("detached-a", {
      mode: "error_retry",
    })
    expect(mocks.execute).toHaveBeenLastCalledWith("detached-a", "test-model", undefined, undefined, undefined)
    expect(mocks.sendMessage).toHaveBeenCalledTimes(postCount)
    expect(hook.current.sendFailure).toBeNull()
  })
  it("finishes retry for session A without subscribing or updating an unmounted pane", async () => {
    const { hook, truncation, retrying, callCounts } = await startPendingRetry(
      "unmounted-session-a",
      "optimistic payload before unmount",
    )
    hook.unmount()
    await act(async () => {
      truncation.resolve()
      await retrying
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.truncateSessionMessages).toHaveBeenCalledWith("unmounted-session-a", {
      mode: "error_retry",
    })
    expect(mocks.execute).toHaveBeenCalledTimes(callCounts.execute + 1)
    expect(mocks.execute).toHaveBeenLastCalledWith(
      "unmounted-session-a",
      "test-model",
      undefined,
      undefined,
      undefined,
    )
    expect(mocks.subscribeToEvents).toHaveBeenCalledTimes(callCounts.subscribe)
    expect(mocks.appState.loadChatHistory.mock.calls.length).toBeGreaterThan(callCounts.history)
    expect(mocks.appState.loadChatHistory).toHaveBeenLastCalledWith("unmounted-session-a")
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
  it("clears the acknowledged optimistic payload after an immediate stop hydrates history", async () => {
    const image = { base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", name: "lifecycle.gif", size: 42, type: "image/gif" }
    const initialHistory = deferred<void>()
    const subscription = deferred<void>()
    let subscriptionController: AbortController | undefined
    mocks.sendMessage.mockResolvedValueOnce({ session_id: "stopped-session" })
    mocks.appState.loadChatHistory
      .mockReturnValueOnce(initialHistory.promise)
      .mockImplementationOnce(async () => { appendPersistedUser("stopped-session", "stop this acknowledged run") })
    mocks.subscribeToEvents.mockImplementationOnce(
      (_sessionId: string, _handlers: SubscriptionHandlers, controller: AbortController) => {
        subscriptionController = controller
        return subscription.promise
      },
    )
    mocks.stopGeneration.mockImplementationOnce(async () => {
      expect(subscriptionController?.signal.aborted).toBe(false)
    })
    const hook = await mountUseChat({ mode: "bound", sessionId: "stopped-session" })
    await act(async () => {
      await hook.current.send("stop this acknowledged run", { images: [image] })
    })
    expect(hook.current.sending).toBe(true)
    expect(hook.current.pendingUserText).toBe("stop this acknowledged run")
    expect(hook.current.pendingUserImages[0]?.name).toBe(image.name)
    await act(async () => {
      hook.current.stop()
      subscription.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.stopGeneration).toHaveBeenCalledTimes(1)
    expect(mocks.stopGeneration).toHaveBeenCalledWith("stopped-session")
    expect(mocks.appState.markCancel).toHaveBeenCalledExactlyOnceWith("stopped-session")
    expect(mocks.appState.updateSession).toHaveBeenCalledExactlyOnceWith(
      "stopped-session",
      { isRunning: false },
      { skipBackendPatch: true },
    )
    expect(subscriptionController?.signal.aborted).toBe(true)
    expect(mocks.appState.loadChatHistory).toHaveBeenNthCalledWith(2, "stopped-session")
    expect(hook.current.sending).toBe(false)
    expect(hook.current.streaming).toBeNull()
    expect(hook.current.pendingUserText).toBeNull()
    expect(hook.current.pendingUserImages).toHaveLength(0)
  })
  it("reconciles the optimistic idle state when Stop dispatch fails", async () => {
    mocks.appState.chats = [{ id: "stop-failed", isRunning: true }]
    mocks.stopGeneration.mockRejectedValueOnce(new Error("offline"))
    const hook = await mountUseChat({ mode: "bound", sessionId: "stop-failed" })

    await act(async () => {
      hook.current.stop()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.appState.markCancel).toHaveBeenCalledExactlyOnceWith("stop-failed")
    expect(mocks.appState.updateSession).toHaveBeenCalledExactlyOnceWith(
      "stop-failed",
      { isRunning: false },
      { skipBackendPatch: true },
    )
    expect(mocks.appState.refreshChatsNow).toHaveBeenCalledTimes(1)
    expect(mocks.appState.loadChatHistory).toHaveBeenCalledWith("stop-failed")
  })
  it("does not let a late acknowledgement navigate after the pane has moved", async () => {
    const acknowledgement = deferred<{ session_id: string }>()
    const onSessionCreated = vi.fn()
    mocks.sendMessage.mockReturnValueOnce(acknowledgement.promise)
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())
    const hook = await mountUseChat({ mode: "bound", sessionId: null, onSessionCreated })
    let sending!: Promise<SendSubmissionResult>
    act(() => {
      sending = hook.current.send("slow acknowledgement")
    })
    await hook.rerender({ mode: "bound", sessionId: "different-session", onSessionCreated })
    let result: SendSubmissionResult | undefined
    await act(async () => {
      acknowledgement.resolve({ session_id: "late-session" })
      result = await sending
    })
    expect(result).toMatchObject({
      kind: "accepted",
      sessionId: "late-session",
      navigated: false,
    })
    expect(onSessionCreated).not.toHaveBeenCalled()
    expect(mocks.subscribeToEvents).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalledWith("late-session", "test-model", undefined, undefined, { provider: "test-provider", model: "test-model" })
    expect(hook.current.sending).toBe(false)
    expect(hook.current.submissionPending).toBe(false)
    expect(hook.current.streaming).toBeNull()
  })
})

const permissionQuestion = (generation = "generation/a", revision = 7, callId = "call/a", sessionId = "session/a") => ({
  has_pending_question: true as const, interaction_kind: "permission" as const,
  question: "Allow this followup?", options: ["Approve", "Deny"], allow_custom: false,
  tool_call_id: callId, permission_request: {
    session_id: sessionId, request_id: callId, request_generation: generation,
    policy_revision: revision, tool_name: "session_control", permission_type: "execute_command",
    resource: "root-a", operation_summary: "Follow up with the existing Root",
    allowed_decisions: ["allow_once", "deny_once"],
  },
})
const clarificationQuestion = (callId = "clarification/a") => ({
  has_pending_question: true as const, interaction_kind: "clarification" as const,
  question: "Which branch?", options: ["main", "dev"], allow_custom: true,
  tool_call_id: callId, permission_request: null,
})
const noQuestion = { has_pending_question: false as const }
const confirmedDecision = (status?: string, replayed = false): PermissionDecisionResult => ({
  replayed, autoResumeStatus: status, continuationConfirmed: true,
})
const expectedDecision = { request_id: "call/a", request_generation: "generation/a",
  decision: "allow_once", expected_policy_revision: 7 }
async function mountPermission() {
  mocks.getPendingQuestion.mockResolvedValue(permissionQuestion())
  return mountUseChat({ mode: "bound", sessionId: "session/a" })
}
async function mountObservedSession() {
  mocks.shouldObserve = true
  mocks.appState.chats = [{ id: "session/a", isRunning: true }]
  const stream = deferred<void>()
  mocks.subscribeToEvents.mockReturnValue(stream.promise)
  const hook = await mountUseChat({ mode: "bound", sessionId: "session/a" })
  const handlers = mocks.subscribeToEvents.mock.calls[0][1] as SubscriptionHandlers
  return { hook, stream, handlers }
}

describe("useChat typed permission approval", () => {
  it("submits once synchronously and keeps the question until its matching acknowledgement", async () => {
    const response = deferred<PermissionDecisionResult>()
    mocks.submitPermissionDecision.mockReturnValue(response.promise)
    const hook = await mountPermission()
    let answering!: Promise<void>
    act(() => {
      answering = hook.current.answerQuestion("allow_once")
      void hook.current.answerQuestion("allow_once")
      void hook.current.answerQuestion("deny_once")
    })
    expect(mocks.submitPermissionDecision).toHaveBeenCalledExactlyOnceWith("session/a", expectedDecision)
    expect(mocks.apiPost).not.toHaveBeenCalled()
    expect(hook.current.pendingQuestion).toEqual(permissionQuestion())
    expect(hook.current.questionSubmitting).toBe(true)
    mocks.getPendingQuestion.mockResolvedValue(noQuestion)
    await act(async () => { response.resolve(confirmedDecision("completed")); await answering })
    expect(hook.current.pendingQuestion).toBeNull()
    expect(hook.current.questionSubmitting).toBe(false)
    expect(hook.current.questionError).toBeNull()
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.subscribeToEvents).not.toHaveBeenCalled()
  })

  it("uses the exact typed DenyOnce and rejects text and remembered choices", async () => {
    const hook = await mountPermission()
    await act(async () => {
      await hook.current.answerQuestion("Approve")
      await hook.current.answerQuestion("allow_session")
    })
    expect(mocks.submitPermissionDecision).not.toHaveBeenCalled()
    mocks.submitPermissionDecision.mockResolvedValue(confirmedDecision("completed"))
    mocks.getPendingQuestion.mockResolvedValue(noQuestion)
    await act(async () => { await hook.current.answerQuestion("deny_once") })
    expect(mocks.submitPermissionDecision).toHaveBeenCalledExactlyOnceWith("session/a", {
      ...expectedDecision, decision: "deny_once",
    })
    expect(mocks.apiPost).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it.each(["started", "already_running"])("observes a confirmed %s continuation without executing again", async (status) => {
    const hook = await mountPermission()
    mocks.appState.chats = [{ id: "session/a", isRunning: true }]
    mocks.submitPermissionDecision.mockResolvedValue(confirmedDecision(status))
    mocks.getPendingQuestion.mockResolvedValue(noQuestion)
    mocks.subscribeToEvents.mockReturnValue(pendingForever())
    await act(async () => { await hook.current.answerQuestion("allow_once") })
    expect(mocks.subscribeToEvents).toHaveBeenCalledTimes(1)
    expect(mocks.subscribeToEvents.mock.calls[0][0]).toBe("session/a")
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(hook.current.pendingQuestion).toBeNull()
  })

  it("keeps the existing subscription when the server continues the original session", async () => {
    mocks.getPendingQuestion.mockResolvedValue(permissionQuestion())
    const { hook } = await mountObservedSession()
    const originalController = mocks.subscribeToEvents.mock.calls[0][2] as AbortController
    mocks.submitPermissionDecision.mockResolvedValue(confirmedDecision("started"))
    mocks.getPendingQuestion.mockResolvedValue(noQuestion)
    await act(async () => { await hook.current.answerQuestion("allow_once") })
    expect(mocks.subscribeToEvents).toHaveBeenCalledTimes(1)
    expect(originalController.signal.aborted).toBe(false)
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(hook.current.pendingQuestion).toBeNull()
  })

  it("settles a matching replay without inventing a continuation", async () => {
    const hook = await mountPermission()
    mocks.submitPermissionDecision.mockResolvedValue(confirmedDecision(undefined, true))
    mocks.getPendingQuestion.mockResolvedValue(noQuestion)
    await act(async () => { await hook.current.answerQuestion("allow_once") })
    expect(hook.current.pendingQuestion).toBeNull()
    expect(hook.current.questionError).toBeNull()
    expect(mocks.appState.loadChatHistory).toHaveBeenCalledWith("session/a")
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.subscribeToEvents).not.toHaveBeenCalled()
  })

  it("retains recorded-decision evidence when continuation is malformed, without retry or execute", async () => {
    const hook = await mountPermission()
    mocks.submitPermissionDecision.mockResolvedValue({ replayed: false, autoResumeStatus: "started", continuationConfirmed: false })
    mocks.getPendingQuestion.mockResolvedValue(noQuestion)
    await act(async () => { await hook.current.answerQuestion("allow_once") })
    expect(hook.current.pendingQuestion).toBeNull()
    expect(hook.current.questionError).toContain("已记录")
    expect(hook.current.questionCanRetry).toBe(false)
    await act(async () => { await hook.current.refreshQuestion(); await hook.current.retryQuestion() })
    expect(hook.current.questionError).toContain("已记录")
    expect(mocks.submitPermissionDecision).toHaveBeenCalledTimes(1)
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.subscribeToEvents).not.toHaveBeenCalled()
  })

  it.each([new NetworkRequestError(), new ApiError("unavailable", 503, "Unavailable"), new Error("mismatched receipt")])(
    "does not treat an empty GET as acknowledgement of an uncertain POST: %s", async (error) => {
      const hook = await mountPermission()
      mocks.submitPermissionDecision.mockRejectedValue(error)
      mocks.getPendingQuestion.mockResolvedValue(noQuestion)
      await act(async () => { await hook.current.answerQuestion("allow_once") })
      expect(hook.current.pendingQuestion).toEqual(permissionQuestion())
      expect(hook.current.questionError).toContain("尚未确认")
      expect(hook.current.questionCanRetry).toBe(true)
      await act(async () => { await hook.current.answerQuestion("deny_once"); await hook.current.refreshQuestion() })
      expect(mocks.submitPermissionDecision).toHaveBeenCalledTimes(1)
      expect(hook.current.questionCanRetry).toBe(true)
      expect(mocks.apiPost).not.toHaveBeenCalled()
      expect(mocks.execute).not.toHaveBeenCalled()
      expect(mocks.subscribeToEvents).not.toHaveBeenCalled()
    },
  )

  it("replays only the identical user-selected tuple after a lost reply", async () => {
    const hook = await mountPermission()
    mocks.submitPermissionDecision.mockRejectedValueOnce(new NetworkRequestError())
      .mockResolvedValueOnce(confirmedDecision(undefined, true))
    mocks.getPendingQuestion.mockResolvedValue(noQuestion)
    await act(async () => { await hook.current.answerQuestion("allow_once") })
    expect(mocks.submitPermissionDecision).toHaveBeenCalledTimes(1)
    await act(async () => { await hook.current.retryQuestion() })
    expect(mocks.submitPermissionDecision.mock.calls).toEqual([
      ["session/a", expectedDecision], ["session/a", expectedDecision],
    ])
    expect(hook.current.pendingQuestion).toBeNull()
    expect(hook.current.questionError).toBeNull()
    expect(hook.current.questionCanRetry).toBe(false)
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.subscribeToEvents).not.toHaveBeenCalled()
  })

  it.each([403, 409])("refreshes a %s into the narrowed policy and requires a fresh explicit decision", async (status) => {
    const hook = await mountPermission()
    const changed = permissionQuestion("generation/a", 8)
    changed.permission_request.allowed_decisions = ["deny_once", "deny_session"]
    mocks.getPendingQuestion.mockResolvedValue(changed)
    mocks.submitPermissionDecision.mockRejectedValueOnce(new ApiError("changed", status, "Rejected"))
    await act(async () => { await hook.current.answerQuestion("allow_once") })
    expect(hook.current.pendingQuestion).toEqual(changed)
    expect(hook.current.questionError).toContain("已变化")
    expect(hook.current.questionCanRetry).toBe(false)
    await act(async () => { await hook.current.retryQuestion(); await hook.current.answerQuestion("allow_once") })
    expect(mocks.submitPermissionDecision).toHaveBeenCalledTimes(1)
    mocks.submitPermissionDecision.mockResolvedValueOnce(confirmedDecision("completed"))
    mocks.getPendingQuestion.mockResolvedValue(noQuestion)
    await act(async () => { await hook.current.answerQuestion("deny_once") })
    expect(mocks.submitPermissionDecision).toHaveBeenLastCalledWith("session/a", {
      ...expectedDecision, decision: "deny_once", expected_policy_revision: 8,
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it.each([["generation/b", 7], ["generation/a", 8]] as const)("does not carry an uncertain approval onto %s revision %s", async (generation, revision) => {
    const hook = await mountPermission()
    mocks.submitPermissionDecision.mockRejectedValueOnce(new NetworkRequestError())
    mocks.getPendingQuestion.mockResolvedValue(noQuestion)
    await act(async () => { await hook.current.answerQuestion("allow_once") })
    const next = permissionQuestion(generation, revision)
    mocks.getPendingQuestion.mockResolvedValue(next)
    await act(async () => { await hook.current.refreshQuestion(); await hook.current.retryQuestion() })
    expect(hook.current.pendingQuestion).toEqual(next)
    expect(hook.current.questionCanRetry).toBe(false)
    expect(mocks.submitPermissionDecision).toHaveBeenCalledTimes(1)
  })

  it.each([["generation/b", 7], ["generation/a", 8]] as const)("rejects a stale visible click after refreshing to %s revision %s", async (generation, revision) => {
    const hook = await mountPermission()
    const oldClick = hook.current.answerQuestion
    const next = permissionQuestion(generation, revision)
    mocks.getPendingQuestion.mockResolvedValue(next)
    await act(async () => { await hook.current.refreshQuestion() })
    await act(async () => { await oldClick("allow_once") })
    expect(mocks.submitPermissionDecision).not.toHaveBeenCalled()
    expect(hook.current.pendingQuestion).toEqual(next)
    mocks.submitPermissionDecision.mockResolvedValue(confirmedDecision("completed"))
    mocks.getPendingQuestion.mockResolvedValue(noQuestion)
    await act(async () => { await hook.current.answerQuestion("allow_once") })
    expect(mocks.submitPermissionDecision).toHaveBeenCalledExactlyOnceWith("session/a", {
      ...expectedDecision, request_generation: generation, expected_policy_revision: revision,
    })
  })
})

describe("useChat pending question ownership", () => {
  it("discards an earlier GET after a newer canonical question is displayed", async () => {
    const hook = await mountPermission()
    const older = deferred<typeof noQuestion>()
    const next = permissionQuestion("generation/b")
    mocks.getPendingQuestion.mockReturnValueOnce(older.promise).mockResolvedValueOnce(next)
    let firstRead!: ReturnType<HookValue["refreshQuestion"]>
    act(() => { firstRead = hook.current.refreshQuestion() })
    await act(async () => { await hook.current.refreshQuestion() })
    await act(async () => { older.resolve(noQuestion); await firstRead })
    expect(hook.current.pendingQuestion).toEqual(next)
    expect(hook.current.questionLoading).toBe(false)
    expect(mocks.submitPermissionDecision).not.toHaveBeenCalled()
  })

  it("discards a previous visit's GET after A to B to A navigation", async () => {
    const older = deferred<ReturnType<typeof permissionQuestion>>()
    const next = permissionQuestion("generation/b")
    mocks.getPendingQuestion.mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(permissionQuestion("generation/b", 7, "call/b", "session/b"))
      .mockResolvedValueOnce(next)
    const hook = await mountUseChat({ mode: "bound", sessionId: "session/a" })
    await hook.rerender({ mode: "bound", sessionId: "session/b" })
    await hook.rerender({ mode: "bound", sessionId: "session/a" })
    await act(async () => { older.resolve(permissionQuestion()); await older.promise })
    expect(hook.current.pendingQuestion).toEqual(next)
    expect(hook.current.questionLoading).toBe(false)
    expect(mocks.getPendingQuestion).toHaveBeenCalledTimes(3)
  })

  it("discards old submission and click callbacks after A to B to A, even with the same question identity", async () => {
    const response = deferred<PermissionDecisionResult>()
    mocks.submitPermissionDecision.mockReturnValue(response.promise)
    const hook = await mountPermission()
    const oldClick = hook.current.answerQuestion
    let submission!: Promise<void>
    act(() => { submission = oldClick("allow_once") })
    mocks.getPendingQuestion.mockResolvedValueOnce(permissionQuestion("generation/b", 7, "call/b", "session/b"))
      .mockResolvedValueOnce(permissionQuestion())
    await hook.rerender({ mode: "bound", sessionId: "session/b" })
    await hook.rerender({ mode: "bound", sessionId: "session/a" })
    await act(async () => { response.resolve(confirmedDecision("started")); await submission; await oldClick("deny_once") })
    expect(hook.current.pendingQuestion).toEqual(permissionQuestion())
    expect(hook.current.questionSubmitting).toBe(false)
    expect(mocks.submitPermissionDecision).toHaveBeenCalledTimes(1)
    expect(mocks.getPendingQuestion).toHaveBeenCalledTimes(3)
    expect(mocks.appState.loadChatHistory).not.toHaveBeenCalled()
    expect(mocks.subscribeToEvents).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it.each([["generation/b", 7], ["generation/a", 8]] as const)("an old POST cannot settle a new submission for %s revision %s", async (generation, revision) => {
    const oldResponse = deferred<PermissionDecisionResult>()
    const newResponse = deferred<PermissionDecisionResult>()
    mocks.submitPermissionDecision.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(newResponse.promise)
    const hook = await mountPermission()
    let oldSubmission!: Promise<void>
    act(() => { oldSubmission = hook.current.answerQuestion("allow_once") })
    const next = permissionQuestion(generation, revision)
    mocks.getPendingQuestion.mockResolvedValue(next)
    await act(async () => { await hook.current.refreshQuestion() })
    let newSubmission!: Promise<void>
    act(() => { newSubmission = hook.current.answerQuestion("deny_once") })
    await act(async () => { oldResponse.resolve(confirmedDecision("started")); await oldSubmission })
    expect(hook.current.pendingQuestion).toEqual(next)
    expect(hook.current.questionSubmitting).toBe(true)
    expect(mocks.getPendingQuestion).toHaveBeenCalledTimes(2)
    expect(mocks.subscribeToEvents).not.toHaveBeenCalled()
    mocks.getPendingQuestion.mockResolvedValue(noQuestion)
    await act(async () => { newResponse.resolve(confirmedDecision("completed")); await newSubmission })
    expect(hook.current.pendingQuestion).toBeNull()
    expect(hook.current.questionSubmitting).toBe(false)
    expect(mocks.submitPermissionDecision).toHaveBeenLastCalledWith("session/a", {
      ...expectedDecision, request_generation: generation, expected_policy_revision: revision, decision: "deny_once",
    })
  })

  it("keeps an unavailable initial read visible until an explicit refresh confirms the question", async () => {
    mocks.getPendingQuestion.mockRejectedValueOnce(new NetworkRequestError())
    const hook = await mountUseChat({ mode: "bound", sessionId: "session/a" })
    expect(hook.current.pendingQuestion).toBeNull()
    expect(hook.current.questionUnavailable).toBe(true)
    expect(hook.current.questionError).toContain("无法读取")
    mocks.getPendingQuestion.mockResolvedValue(permissionQuestion())
    await act(async () => { await hook.current.refreshQuestion() })
    expect(hook.current.pendingQuestion).toEqual(permissionQuestion())
    expect(hook.current.questionUnavailable).toBe(false)
    expect(hook.current.questionError).toBeNull()
    expect(mocks.submitPermissionDecision).not.toHaveBeenCalled()
  })

  it("does not offer a different decision if a matching receipt is followed by the same pending question", async () => {
    const hook = await mountPermission()
    mocks.submitPermissionDecision.mockResolvedValue({ replayed: false, continuationConfirmed: false })
    await act(async () => { await hook.current.answerQuestion("allow_once") })
    expect(hook.current.pendingQuestion).toEqual(permissionQuestion())
    expect(hook.current.questionUnavailable).toBe(true)
    expect(hook.current.questionError).toContain("已记录")
    await act(async () => { await hook.current.answerQuestion("deny_once"); await hook.current.retryQuestion() })
    expect(mocks.submitPermissionDecision).toHaveBeenCalledTimes(1)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})

describe("useChat permission wait and ordinary clarification", () => {
  it("rehydrates canonical permission after Complete without using notification display text", async () => {
    const { hook, stream, handlers } = await mountObservedSession()
    const pending = deferred<ReturnType<typeof permissionQuestion>>()
    mocks.getPendingQuestion.mockReturnValueOnce(pending.promise)
    await act(async () => {
      handlers.onNeedClarification({ question: "untrusted old text", options: ["Approve"], allow_custom: true })
      handlers.onComplete()
      stream.resolve()
      await stream.promise
    })
    await act(async () => { pending.resolve(permissionQuestion()); await pending.promise })
    expect(hook.current.pendingQuestion).toEqual(permissionQuestion())
    expect(hook.current.sendFailure).toBeNull()
    expect(mocks.submitPermissionDecision).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it("settles a stream's permission wait without reporting interrupted generation", async () => {
    const { hook, stream, handlers } = await mountObservedSession()
    mocks.getPendingQuestion.mockResolvedValueOnce(permissionQuestion())
    await act(async () => { handlers.onNeedClarification({}); stream.resolve(); await stream.promise })
    await flushMicrotasks()
    expect(hook.current.pendingQuestion).toEqual(permissionQuestion())
    expect(hook.current.sendFailure).toBeNull()
    expect(hook.current.streaming).toBeNull()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it("does not turn a superseded pending read into absence or a generation failure", async () => {
    const { hook, stream, handlers } = await mountObservedSession()
    const older = deferred<typeof noQuestion>()
    mocks.getPendingQuestion.mockReturnValueOnce(older.promise).mockResolvedValueOnce(permissionQuestion())
    act(() => handlers.onNeedClarification({}))
    await act(async () => { await hook.current.refreshQuestion() })
    await act(async () => { older.resolve(noQuestion); stream.resolve(); await stream.promise })
    await flushMicrotasks()
    expect(hook.current.pendingQuestion).toEqual(permissionQuestion())
    expect(hook.current.sendFailure).toBeNull()
    expect(mocks.getPendingQuestion).toHaveBeenCalledTimes(3)
  })

  it("follows an event with one additional read only when publication is absent", async () => {
    const { hook, stream, handlers } = await mountObservedSession()
    mocks.getPendingQuestion.mockResolvedValueOnce(noQuestion).mockResolvedValueOnce(permissionQuestion())
    await act(async () => { handlers.onNeedClarification({}); stream.resolve(); await stream.promise })
    await flushMicrotasks()
    expect(mocks.getPendingQuestion).toHaveBeenCalledTimes(3)
    expect(hook.current.pendingQuestion).toEqual(permissionQuestion())
    expect(hook.current.sendFailure).toBeNull()
  })

  it("keeps a real stream error visible even when a permission is pending", async () => {
    mocks.getPendingQuestion.mockResolvedValue(permissionQuestion())
    const { hook, stream, handlers } = await mountObservedSession()
    await act(async () => { handlers.onError("generation failed"); stream.resolve(); await stream.promise })
    expect(hook.current.sendFailure?.kind).toBe("generation-failed")
    expect(hook.current.sendFailure?.message).toBe("generation failed")
    expect(hook.current.pendingQuestion).toEqual(permissionQuestion())
  })

  it("submits ordinary clarification text with its expected call ID and waits for acknowledgement", async () => {
    const question = clarificationQuestion()
    mocks.getPendingQuestion.mockResolvedValue(question)
    const response = deferred<{ success: boolean; auto_resume_status: string }>()
    mocks.apiPost.mockReturnValue(response.promise)
    const hook = await mountUseChat({ mode: "bound", sessionId: "session/a" })
    let answering!: Promise<void>
    act(() => { answering = hook.current.answerQuestion("release/next") })
    expect(mocks.apiPost).toHaveBeenCalledExactlyOnceWith("respond/session%2Fa", {
      response: "release/next", expected_tool_call_id: "clarification/a",
    })
    expect(hook.current.pendingQuestion).toEqual(question)
    mocks.getPendingQuestion.mockResolvedValue(noQuestion)
    await act(async () => { response.resolve({ success: true, auto_resume_status: "completed" }); await answering })
    expect(hook.current.pendingQuestion).toBeNull()
    expect(mocks.submitPermissionDecision).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.subscribeToEvents).not.toHaveBeenCalled()
  })

  it("preserves a failed clarification and does not observe an unacknowledged answer", async () => {
    const question = { ...clarificationQuestion(), allow_custom: false }
    mocks.getPendingQuestion.mockResolvedValue(question)
    mocks.apiPost.mockRejectedValueOnce(new NetworkRequestError())
    const hook = await mountUseChat({ mode: "bound", sessionId: "session/a" })
    await act(async () => { await hook.current.answerQuestion("not offered") })
    expect(mocks.apiPost).not.toHaveBeenCalled()
    await act(async () => { await hook.current.answerQuestion("dev") })
    expect(hook.current.pendingQuestion).toEqual(question)
    expect(hook.current.questionError).toContain("尚未确认")
    expect(mocks.apiPost).toHaveBeenCalledExactlyOnceWith("respond/session%2Fa", {
      response: "dev", expected_tool_call_id: "clarification/a",
    })
    expect(mocks.submitPermissionDecision).not.toHaveBeenCalled()
    expect(mocks.subscribeToEvents).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})

describe("useChat pending reads during permission submission", () => {
  it("retains the submitted question when an event reads absence before the matching receipt arrives", async () => {
    mocks.getPendingQuestion.mockResolvedValue(permissionQuestion())
    const { hook, handlers } = await mountObservedSession()
    const response = deferred<PermissionDecisionResult>()
    mocks.submitPermissionDecision.mockReturnValue(response.promise)
    let submission!: Promise<void>
    act(() => { submission = hook.current.answerQuestion("allow_once") })
    mocks.getPendingQuestion.mockResolvedValue(noQuestion)
    act(() => handlers.onNeedClarification({}))
    await flushMicrotasks()
    expect(hook.current.pendingQuestion).toEqual(permissionQuestion())
    expect(hook.current.questionSubmitting).toBe(true)
    expect(hook.current.questionError).toBeNull()
    await act(async () => { response.resolve(confirmedDecision("completed")); await submission })
    expect(hook.current.pendingQuestion).toBeNull()
    expect(hook.current.questionSubmitting).toBe(false)
    expect(hook.current.questionError).toBeNull()
    expect(mocks.appState.loadChatHistory).toHaveBeenCalledWith("session/a")
    expect(mocks.submitPermissionDecision).toHaveBeenCalledExactlyOnceWith("session/a", expectedDecision)
    expect(mocks.subscribeToEvents).toHaveBeenCalledTimes(1)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it.each([new NetworkRequestError(), new ApiError("unavailable", 503, "Unavailable")])(
    "retains exact retry after an event reads absence before the POST rejects: %s", async (error) => {
      mocks.getPendingQuestion.mockResolvedValue(permissionQuestion())
      const { hook, handlers } = await mountObservedSession()
      const response = deferred<PermissionDecisionResult>()
      mocks.submitPermissionDecision.mockReturnValueOnce(response.promise)
      let submission!: Promise<void>
      act(() => { submission = hook.current.answerQuestion("allow_once") })
      mocks.getPendingQuestion.mockResolvedValue(noQuestion)
      act(() => handlers.onNeedClarification({}))
      await flushMicrotasks()
      expect(hook.current.pendingQuestion).toEqual(permissionQuestion())
      expect(hook.current.questionSubmitting).toBe(true)
      await act(async () => { response.reject(error); await submission })
      expect(hook.current.pendingQuestion).toEqual(permissionQuestion())
      expect(hook.current.questionSubmitting).toBe(false)
      expect(hook.current.questionError).toContain("尚未确认")
      expect(hook.current.questionCanRetry).toBe(true)
      mocks.submitPermissionDecision.mockResolvedValueOnce(confirmedDecision(undefined, true))
      await act(async () => { await hook.current.retryQuestion() })
      expect(mocks.submitPermissionDecision.mock.calls).toEqual([
        ["session/a", expectedDecision], ["session/a", expectedDecision],
      ])
      expect(hook.current.pendingQuestion).toBeNull()
      expect(hook.current.questionCanRetry).toBe(false)
      expect(hook.current.questionError).toBeNull()
      expect(mocks.subscribeToEvents).toHaveBeenCalledTimes(1)
      expect(mocks.execute).not.toHaveBeenCalled()
    },
  )

  it.each([403, 409])("allows canonical absence to clear a definite %s rejection", async (status) => {
    mocks.getPendingQuestion.mockResolvedValue(permissionQuestion())
    const { hook, handlers } = await mountObservedSession()
    const response = deferred<PermissionDecisionResult>()
    mocks.submitPermissionDecision.mockReturnValueOnce(response.promise)
    let submission!: Promise<void>
    act(() => { submission = hook.current.answerQuestion("allow_once") })
    mocks.getPendingQuestion.mockResolvedValue(noQuestion)
    act(() => handlers.onNeedClarification({}))
    await flushMicrotasks()
    await act(async () => { response.reject(new ApiError("rejected", status, "Rejected")); await submission })
    expect(hook.current.pendingQuestion).toBeNull()
    expect(hook.current.questionCanRetry).toBe(false)
    expect(hook.current.questionSubmitting).toBe(false)
    expect(hook.current.questionError).toContain("已变化")
    expect(mocks.submitPermissionDecision).toHaveBeenCalledTimes(1)
    expect(mocks.subscribeToEvents).toHaveBeenCalledTimes(1)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})

describe("owned streams without a terminal frame", () => {
  const sessionId = "orphaned-owned-stream"
  async function start() {
    vi.useFakeTimers()
    mocks.appState.chats = [{ id: sessionId, isRunning: true, lastRunStatus: "completed", messages: [] }]
    mocks.sendMessage.mockResolvedValue({ session_id: sessionId })
    const subscription = deferred<void>()
    mocks.subscribeToEvents.mockImplementation((_id, _handlers, controller: AbortController) =>
      { controller.signal.addEventListener("abort", () => subscription.resolve(), { once: true }); return subscription.promise },
    )
    mocks.appState.refreshChatsNow.mockImplementation(async () => {
      mocks.appState.chats[0].isRunning = false
    })
    mocks.getSession.mockResolvedValue({ session: { id: sessionId, is_running: false, last_run_status: "completed" } })
    const hook = await mountUseChat({ mode: "bound", sessionId })
    // The detail-only compatibility observation is independent of run liveness.
    // The assertions below count only status polls after this initial read.
    expect(mocks.getSession).toHaveBeenCalledExactlyOnceWith(sessionId)
    mocks.getSession.mockClear()
    await act(async () => { await hook.current.send("inspect the worktree") })
    return { hook, controller: mocks.subscribeToEvents.mock.calls[0][2] as AbortController, closeSubscription: subscription.resolve }
  }
  async function advance(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }

  it("clears an owned run after two idle reads without trusting an old completed status", async () => {
    const { hook, controller } = await start()
    expect(hook.current.sending).toBe(true)
    await advance(5_000)
    expect(controller.signal.aborted).toBe(false)
    expect(mocks.getSession).toHaveBeenCalledTimes(1)
    await advance(2_000)
    expect(controller.signal.aborted).toBe(true)
    expect(hook.current.sending).toBe(false)
    expect(hook.current.streaming).toBeNull()
    expect(hook.current.sendFailure).toMatchObject({ kind: "generation-failed", sessionId })
    expect(mocks.appState.loadChatHistory).toHaveBeenLastCalledWith(sessionId, { mode: "monotonic" })
    const readCount = mocks.getSession.mock.calls.length
    await advance(20_000)
    expect(mocks.getSession).toHaveBeenCalledTimes(readCount)
  })

  it("does not read an idle pre-start summary until execute acknowledges admission", async () => {
    const execution = deferred<void>()
    mocks.execute.mockReturnValueOnce(execution.promise)
    const { hook, controller } = await start()
    await advance(15_000)
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(controller.signal.aborted).toBe(false)
    await act(async () => { execution.resolve(); await Promise.resolve() })
    await advance(7_000)
    expect(controller.signal.aborted).toBe(true)
    expect(hook.current.sending).toBe(false)
  })

  it("keeps a successor and a suspended question alive after the first idle read", async () => {
    const { hook, controller } = await start()
    await advance(5_000)
    mocks.getSession.mockResolvedValue({ session: { id: sessionId, is_running: true } })
    await advance(2_000)
    expect(controller.signal.aborted).toBe(false)
    mocks.getSession.mockResolvedValue({ session: { id: sessionId, is_running: false, has_pending_question: true } })
    await advance(10_000)
    expect(controller.signal.aborted).toBe(false)
    expect(hook.current.sending).toBe(true)
    expect(hook.current.sendFailure).toBeNull()
    expect(mocks.appState.refreshChatsNow).not.toHaveBeenCalled()
  })

  it("preserves a running successor admitted while history is being read", async () => {
    const { hook, controller } = await start()
    mocks.appState.loadChatHistory.mockImplementation(async () => {
      mocks.appState.chats[0].isRunning = true
    })
    await advance(7_000)
    expect(controller.signal.aborted).toBe(false)
    expect(hook.current.sending).toBe(true)
    expect(hook.current.sendFailure).toBeNull()
  })

  it("settles a successfully persisted reply without a false interruption", async () => {
    const { hook, controller } = await start()
    const handlers = mocks.subscribeToEvents.mock.calls[0][1] as SubscriptionHandlers
    await act(async () => { handlers.onToken("durable final reply") })
    mocks.appState.loadChatHistory.mockImplementation(async () => {
      mocks.appState.chats[0].messages = [{ id: "final-message", role: "assistant", type: "text", content: "durable final reply" }]
    })
    await advance(7_000)
    expect(controller.signal.aborted).toBe(true)
    expect(hook.current.sending).toBe(false)
    expect(hook.current.sendFailure).toBeNull()
    expect(hook.current.streaming).toBeNull()
  })

  it("ignores a status response after the owning pane has unmounted", async () => {
    const { hook, controller } = await start()
    const status = deferred<unknown>()
    mocks.getSession.mockReturnValueOnce(status.promise)
    await advance(5_000)
    hook.unmount()
    await act(async () => { status.resolve({ session: { id: sessionId, is_running: false } }); await Promise.resolve() })
    expect(controller.signal.aborted).toBe(true)
    expect(mocks.appState.refreshChatsNow).not.toHaveBeenCalled()
    await advance(10_000)
    expect(mocks.getSession).toHaveBeenCalledTimes(1)
  })

  it("ignores an idle status response when a terminal event arrives during the read", async () => {
    const { hook, controller, closeSubscription } = await start()
    const status = deferred<unknown>()
    mocks.getSession.mockReturnValueOnce(status.promise)
    await advance(5_000)
    const handlers = mocks.subscribeToEvents.mock.calls[0][1] as SubscriptionHandlers
    await act(async () => { handlers.onComplete(); closeSubscription(); await Promise.resolve() })
    const historyReads = mocks.appState.loadChatHistory.mock.calls.length
    await act(async () => {
      status.resolve({ session: { id: sessionId, is_running: false } })
      await Promise.resolve()
    })
    await advance(10_000)
    expect(mocks.getSession).toHaveBeenCalledTimes(1)
    expect(mocks.appState.loadChatHistory).toHaveBeenCalledTimes(historyReads)
    expect(mocks.appState.refreshChatsNow).not.toHaveBeenCalled()
    expect(hook.current.sendFailure).toBeNull()
    expect(hook.current.sending).toBe(false)
    expect(controller.signal.aborted).toBe(false)
  })
})


describe("image attachment visibility", () => {
  it.each([
    { known: "neither", lateSecondAck: false }, { known: "first", lateSecondAck: false }, { known: "second", lateSecondAck: false },
    { known: "neither", lateSecondAck: true }, { known: "first", lateSecondAck: true }, { known: "second", lateSecondAck: true },
  ])("uses distinct canonical messages for consecutive legacy image-only ACKs (%j)", async ({ known, lateSecondAck }) => {
    const sid = "legacy-image-queue", history = deferred<void>()
    const secondAck = deferred<{ session_id: string; message_id?: string }>()
    const image = { base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", name: "first.gif", size: 42, type: "image/gif" }
    mocks.appState.chats = [{ id: sid, messages: [] }]
    mocks.sendMessage.mockResolvedValueOnce({ session_id: sid, ...(known === "first" ? { message_id: "first-legacy-user" } : {}) })
      .mockReturnValueOnce(secondAck.promise)
    mocks.appState.loadChatHistory.mockImplementation((_id: string, options?: { mode?: string; waitForAssistant?: boolean }) =>
      options?.mode === "monotonic" && !options.waitForAssistant ? history.promise : Promise.resolve())
    mocks.subscribeToEvents.mockImplementation(async (_sid: string, handlers: SubscriptionHandlers) => { handlers.onComplete() })
    const hook = await mountUseChat({ mode: "bound", sessionId: sid })
    await act(async () => { await hook.current.send("", { images: [image] }) })
    await flushMicrotasks()
    let sending!: Promise<SendSubmissionResult>
    act(() => { sending = hook.current.send("", { images: [{ ...image, name: "second.gif" }] }) })
    const acknowledgeSecond = () => act(async () => {
      secondAck.resolve({ session_id: sid, ...(known === "second" ? { message_id: "second-legacy-user" } : {}) })
      expect((await sending).kind).toBe("accepted")
    })
    if (!lateSecondAck) await acknowledgeSecond()
    expect(hook.current.pendingUserMessages).toHaveLength(lateSecondAck ? 1 : 2)
    // Reserve a known ID before fallback matching. A pre-ACK canonical snapshot
    // uses chronological order because old replies cannot identify message IDs.
    const firstCanonical = !lateSecondAck && known === "second" ? "second" : "first"
    appendPersistedUser(sid, "", `${firstCanonical}-legacy-user`)
    await hook.rerender({ mode: "bound", sessionId: sid })
    if (lateSecondAck) await acknowledgeSecond()
    const remaining = firstCanonical === "first" ? "second" : "first"
    expect(hook.current.pendingUserMessages).toHaveLength(1)
    expect(hook.current.pendingUserMessages[0].images[0].name).toBe(`${remaining}.gif`)
    await act(async () => { history.resolve() })
    expect(hook.current.pendingUserMessages).toHaveLength(1)
    appendPersistedUser(sid, "", `${remaining}-legacy-user`)
    await hook.rerender({ mode: "bound", sessionId: sid })
    expect(hook.current.pendingUserMessages).toHaveLength(0)
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2); expect(mocks.execute).toHaveBeenCalledTimes(2)
  })
  it("does not replay an unconfirmed image POST after an older legacy ACK becomes canonical", async () => {
    const sid = "unconfirmed-legacy-image", secondAck = deferred<{ session_id: string }>()
    const image = { base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", name: "first.gif", size: 42, type: "image/gif" }
    mocks.appState.chats = [{ id: sid, messages: [] }]
    mocks.sendMessage.mockResolvedValueOnce({ session_id: sid }).mockReturnValueOnce(secondAck.promise)
      .mockResolvedValueOnce({ session_id: sid })
    mocks.subscribeToEvents.mockImplementation(async (_sid: string, handlers: SubscriptionHandlers) => { handlers.onComplete() })
    const hook = await mountUseChat({ mode: "bound", sessionId: sid })
    await act(async () => { await hook.current.send("", { images: [image] }) })
    await flushMicrotasks()
    let sending!: Promise<SendSubmissionResult>
    act(() => { sending = hook.current.send("", { images: [{ ...image, name: "second.gif" }] }) })
    appendPersistedUser(sid, "", "first-user")
    await hook.rerender({ mode: "bound", sessionId: sid })
    await act(async () => { secondAck.reject(new NetworkRequestError()); expect((await sending).kind).toBe("unconfirmed") })
    expect(hook.current.pendingUserMessages).toHaveLength(0)
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2); expect(mocks.execute).toHaveBeenCalledTimes(1)
    await act(async () => { await hook.current.send("", { images: [{ ...image, name: "second.gif" }] }) })
    await flushMicrotasks()
    expect(hook.current.pendingUserMessages).toHaveLength(1)
    expect(hook.current.pendingUserImages[0]?.name).toBe("second.gif")
    appendPersistedUser(sid, "", "explicit-retry-user")
    await hook.rerender({ mode: "bound", sessionId: sid })
    expect(hook.current.pendingUserMessages).toHaveLength(0)
    expect(mocks.sendMessage).toHaveBeenCalledTimes(3); expect(mocks.execute).toHaveBeenCalledTimes(2)
  })
  it.each([
    { newSession: false, caption: "" }, { newSession: false, caption: "late caption" },
    { newSession: true, caption: "" }, { newSession: true, caption: "late caption" },
  ])("retains a late image ACK after navigating away before POST resolves (%j)", async ({ newSession, caption }) => {
    const a = "late-image-ack", b = "viewed-while-posting", acknowledgement = deferred<{ session_id: string; message_id: string }>()
    const image = { base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", name: "late.gif", size: 42, type: "image/gif" }
    mocks.appState.chats = [{ id: a, messages: [] }, { id: b, messages: [] }]
    mocks.sendMessage.mockReturnValueOnce(acknowledgement.promise)
    const created = vi.fn()
    const hook = await mountUseChat({ mode: "bound", sessionId: newSession ? null : a, onSessionCreated: created })
    let sending!: Promise<SendSubmissionResult>
    act(() => { sending = hook.current.send(caption, { images: [image] }) })
    await hook.rerender({ mode: "bound", sessionId: b, onSessionCreated: created })
    await act(async () => { expect(await hook.current.send("B waits for A's ACK", { images: [image] })).toEqual({ kind: "busy" }) })
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    await act(async () => {
      acknowledgement.resolve({ session_id: a, message_id: "late-exact-ack" })
      expect(await sending).toMatchObject({ kind: "accepted", sessionId: a, navigated: false })
    })
    expect(hook.current.currentSessionId).toBe(b)
    expect(hook.current.pendingUserMessages).toHaveLength(0)
    expect(created).not.toHaveBeenCalled(); expect(mocks.appState.selectSession).not.toHaveBeenCalled()
    expect(mocks.subscribeToEvents).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute.mock.calls[0][0]).toBe(a)
    await hook.rerender({ mode: "bound", sessionId: a, onSessionCreated: created })
    expect(hook.current.pendingUserMessages).toHaveLength(1)
    expect(hook.current.pendingUserMessages[0]).toMatchObject({ text: caption, images: [{ name: "late.gif" }] })
    appendPersistedUser(a, caption, "late-exact-ack")
    await hook.rerender({ mode: "bound", sessionId: a, onSessionCreated: created })
    expect(hook.current.pendingUserMessages).toHaveLength(0)
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1); expect(mocks.execute).toHaveBeenCalledTimes(1)
  })
  it.each([
    { nextImage: false, firstHydrated: 1 }, { nextImage: true, firstHydrated: 1 },
    { nextImage: false, firstHydrated: 2 }, { nextImage: true, firstHydrated: 2 },
  ])("retains consecutive image ACKs in one session until each is canonical (%j)", async ({ nextImage, firstHydrated }) => {
    const sid = "consecutive-image-session", history = deferred<void>()
    const image = { base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", name: "first.gif", size: 42, type: "image/gif" }
    mocks.appState.chats = [{ id: sid, messages: [] }]
    mocks.sendMessage.mockResolvedValueOnce({ session_id: sid, message_id: "ack-1" })
      .mockResolvedValueOnce({ session_id: sid, message_id: "ack-2" })
    mocks.appState.loadChatHistory.mockImplementation((_id: string, options?: { mode?: string; waitForAssistant?: boolean }) =>
      options?.mode === "monotonic" && !options.waitForAssistant ? history.promise : Promise.resolve())
    mocks.subscribeToEvents.mockImplementation(async (_sid: string, handlers: SubscriptionHandlers) => { handlers.onComplete() })
    const hook = await mountUseChat({ mode: "bound", sessionId: sid })
    await act(async () => { await hook.current.send("first caption", { images: [image] }) })
    await flushMicrotasks()
    expect(hook.current.sending).toBe(false)
    await act(async () => { await hook.current.send("second caption", { images: nextImage ? [{ ...image, name: "second.gif" }] : [] }) })
    await flushMicrotasks()
    const names = () => hook.current.pendingUserMessages?.flatMap((item) => item.images.map((entry) => entry.name))
      ?? hook.current.pendingUserImages.map((entry) => entry.name)
    expect(names()).toEqual(nextImage ? ["first.gif", "second.gif"] : ["first.gif"])
    expect(hook.current.pendingUserMessages.map((item) => item.text)).toEqual(["first caption", "second caption"])
    await act(async () => {
      appendPersistedUser(sid, firstHydrated === 1 ? "first caption" : "second caption", `ack-${firstHydrated}`)
      history.resolve()
    })
    await hook.rerender({ mode: "bound", sessionId: sid })
    expect(hook.current.pendingUserMessages.map((item) => item.text)).toEqual([firstHydrated === 1 ? "second caption" : "first caption"])
    appendPersistedUser(sid, firstHydrated === 1 ? "second caption" : "first caption", `ack-${firstHydrated === 1 ? 2 : 1}`)
    await hook.rerender({ mode: "bound", sessionId: sid })
    expect(hook.current.pendingUserMessages).toHaveLength(0)
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2); expect(mocks.execute).toHaveBeenCalledTimes(2)
  })
  it.each([false, true])("keeps A's delayed image after B sends (B image=%s), retiring each exact acknowledgement independently", async (bHasImage) => {
    const a = "image-a", b = "image-b", firstRead = deferred<void>()
    const image = { base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", name: "A.gif", size: 42, type: "image/gif" }
    mocks.appState.chats = [{ id: a, messages: [] }, { id: b, messages: [] }]
    mocks.sendMessage.mockResolvedValueOnce({ session_id: a, message_id: "ack-a" })
      .mockResolvedValueOnce({ session_id: b, message_id: "ack-b" })
    // Delay only ACK hydration; the completed run's separate canonical read
    // resolves with old history so another session can submit normally.
    mocks.appState.loadChatHistory.mockImplementation((id: string, options?: { mode?: string; waitForAssistant?: boolean }) =>
      id === a && options?.mode === "monotonic" && !options.waitForAssistant ? firstRead.promise : Promise.resolve())
    mocks.subscribeToEvents.mockImplementation(async (_sid: string, handlers: SubscriptionHandlers) => { handlers.onComplete() })
    const hook = await mountUseChat({ mode: "bound", sessionId: a })
    await act(async () => { await hook.current.send("A caption", { images: [image] }) })
    await flushMicrotasks()
    expect(hook.current.sending).toBe(false)
    expect(hook.current.pendingUserImages[0]?.name).toBe("A.gif")

    await hook.rerender({ mode: "bound", sessionId: b })
    expect(hook.current.pendingUserImages).toHaveLength(0)
    await act(async () => { await hook.current.send("B caption", { images: bHasImage ? [{ ...image, name: "B.gif" }] : [] }) })
    await flushMicrotasks()
    expect(hook.current.pendingUserText).toBe("B caption")
    expect(hook.current.pendingUserImages).toHaveLength(bHasImage ? 1 : 0)

    await hook.rerender({ mode: "bound", sessionId: a })
    expect(hook.current.pendingUserText).toBe("A caption")
    expect(hook.current.pendingUserImages[0]?.name).toBe("A.gif")
    await act(async () => {
      appendPersistedUser(a, "A caption", "ack-a")
      firstRead.resolve()
    })
    await hook.rerender({ mode: "bound", sessionId: a })
    expect(hook.current.pendingUserImages).toHaveLength(0)
    await hook.rerender({ mode: "bound", sessionId: b })
    expect(hook.current.pendingUserText).toBe("B caption")
    expect(hook.current.pendingUserImages[0]?.name).toBe(bHasImage ? "B.gif" : undefined)
    appendPersistedUser(b, "B caption", "ack-b")
    await hook.rerender({ mode: "bound", sessionId: b })
    expect(hook.current.pendingUserText).toBeNull()
    expect(hook.current.pendingUserImages).toHaveLength(0)
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2)
    expect(mocks.execute).toHaveBeenCalledTimes(2)
  })
  it.each(["", "caption with image"])("retains acknowledged pending image metadata until exact history hydration (%s)", async (text) => {
    const sid = "image-pending-session", history = deferred<void>()
    const image = { base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", name: "fixture.gif", size: 42, type: "image/gif" }
    mocks.appState.chats = [{ id: sid, messages: [] }]
    mocks.sendMessage.mockResolvedValueOnce({ session_id: sid, message_id: "accepted-image" })
    mocks.appState.loadChatHistory.mockReturnValueOnce(history.promise)
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())
    const hook = await mountUseChat({ mode: "bound", sessionId: sid })
    await act(async () => { await hook.current.send(text, { images: [image] }) })
    expect(mocks.sendMessage.mock.calls[0][0].images).toEqual([image])
    expect(hook.current.pendingUserText).toBe(text)
    expect(hook.current.pendingUserImages).toHaveLength(1)
    expect(hook.current.pendingUserImages[0]).toMatchObject({ name: "fixture.gif", size: 42, type: "image/gif", url: `data:image/gif;base64,${image.base64}` })
    await hook.rerender({ mode: "bound", sessionId: "other-session" })
    expect(hook.current.pendingUserImages).toHaveLength(0)
    await hook.rerender({ mode: "bound", sessionId: sid })
    expect(hook.current.pendingUserImages).toHaveLength(1)
    await act(async () => {
      mocks.appState.chats[0].messages = [{ id: "accepted-image", role: "user", content: text,
        images: [{ id: "persisted-image", url: "http://localhost:9563/api/v1/sessions/image-pending-session/attachments/image-1", name: "fixture.gif", type: "image/gif", size: 42 }], createdAt: "2026-10-19T00:00:00Z" }]
      history.resolve(); await Promise.resolve(); await Promise.resolve()
    })
    expect(hook.current.pendingUserText).toBeNull()
    expect(hook.current.pendingUserImages).toHaveLength(0)
  })
})


describe("session execution compatibility v1", () => {
  const report = (status: "compatible" | "legacy_compatible" | "conflict") => ({
    session_version: status === "legacy_compatible" ? null : status === "conflict" ? 99 : 1,
    current_session_version: 1, status, history_readable: true, execution_allowed: status !== "conflict",
    conflicts: status === "conflict" ? [{ code: "unsupported_session_version", message: "Declared execution version is unsupported." }] : [],
  })
  it("blocks sending and destructive rerun only after explicit detail conflict", async () => {
    const sid = "compatibility-conflict-session"
    mocks.appState.chats = [{ id: sid, messages: [{ id: "original-user", role: "user", content: "old history" }] }]
    mocks.getSession.mockResolvedValue({ session: { id: sid, execution_compatibility: report("conflict") } })
    const hook = await mountUseChat({ mode: "bound", sessionId: sid })
    await flushMicrotasks()
    await act(async () => { expect((await hook.current.send("preserve this draft")).kind).toBe("blocked") })
    await act(async () => { await hook.current.regenerate(); await hook.current.editMessage("original-user", "edited draft") })
    expect(mocks.sendMessage).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.truncateSessionMessages).not.toHaveBeenCalled(); expect(mocks.restoreSessionState).not.toHaveBeenCalled()
    expect(mocks.appState.chats[0].messages).toHaveLength(1)
  })
  it.each([undefined, "compatible", "legacy_compatible"] as const)("keeps normal send available when report is %s", async (status) => {
    const sid = `compatibility-open-${status ?? "missing"}`
    mocks.appState.chats = [{ id: sid, messages: [] }]
    mocks.getSession.mockResolvedValue({ session: { id: sid, ...(status ? { execution_compatibility: report(status) } : {}) } })
    mocks.sendMessage.mockResolvedValueOnce({ session_id: sid, message_id: "accepted-compatibility" })
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())
    const hook = await mountUseChat({ mode: "bound", sessionId: sid })
    await flushMicrotasks()
    await act(async () => { expect((await hook.current.send("continue normally")).kind).toBe("accepted") })
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
  })
  it("records a typed submit refusal once and recovers only after a fresh compatible detail", async () => {
    const sid = "compatibility-submit-refusal"
    const image = { base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", name: "lifecycle.gif", size: 42, type: "image/gif" }
    mocks.appState.chats = [{ id: sid, messages: [] }]
    mocks.getSession.mockResolvedValue({ session: { id: sid } })
    mocks.sendMessage.mockRejectedValueOnce(new ApiError("incompatible", 409, "", JSON.stringify({
      session_id: sid, error: { type: "conflict", code: "session_execution_incompatible", message: "incompatible" }, compatibility: report("conflict"),
    })))
    const hook = await mountUseChat({ mode: "bound", sessionId: sid })
    await act(async () => { expect((await hook.current.send("keep my content", { images: [image] })).kind).toBe("blocked") })
    expect(hook.current.executionCompatibility.blocked).toBe(true)
    expect(hook.current.sendFailure).toBeNull()
    expect(hook.current.pendingUserMessages).toHaveLength(0)
    await act(async () => { expect((await hook.current.send("keep my content", { images: [image] })).kind).toBe("blocked") })
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1); expect(mocks.execute).not.toHaveBeenCalled()
    mocks.getSession.mockResolvedValue({ session: { id: sid, execution_compatibility: report("legacy_compatible") } })
    await act(async () => { await hook.current.executionCompatibility.refresh() })
    expect(hook.current.executionCompatibility.blocked).toBe(false)
    mocks.sendMessage.mockResolvedValueOnce({ session_id: sid, message_id: "accepted-after-review" })
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())
    await act(async () => { expect((await hook.current.send("keep my content", { images: [image] })).kind).toBe("accepted") })
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2)
    expect(hook.current.pendingUserImages[0]?.name).toBe(image.name)
  })
  it("keeps an acknowledged message when execute returns typed conflict and prevents retry", async () => {
    const sid = "compatibility-execute-refusal"
    const image = { base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", name: "lifecycle.gif", size: 42, type: "image/gif" }
    mocks.appState.chats = [{ id: sid, messages: [] }]
    mocks.getSession.mockResolvedValue({ session: { id: sid, execution_compatibility: report("compatible") } })
    mocks.sendMessage.mockResolvedValueOnce({ session_id: sid, message_id: "accepted-before-conflict" })
    mocks.execute.mockRejectedValueOnce(new ApiError("incompatible", 409, "", JSON.stringify({
      session_id: sid, error: { type: "conflict", code: "session_execution_incompatible", message: "incompatible" }, compatibility: report("conflict"),
    })))
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())
    const hook = await mountUseChat({ mode: "bound", sessionId: sid })
    await act(async () => { expect((await hook.current.send("already saved", { images: [image] })).kind).toBe("accepted") })
    await flushMicrotasks()
    expect(hook.current.executionCompatibility.blocked).toBe(true)
    expect(hook.current.pendingUserText).toBe("already saved")
    expect(hook.current.pendingUserImages[0]?.name).toBe(image.name)
    expect(hook.current.sendFailure?.kind).toBe("generation-failed")
    await act(async () => { await hook.current.retry() })
    expect(mocks.execute).toHaveBeenCalledTimes(1); expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(mocks.truncateSessionMessages).not.toHaveBeenCalled()
  })

})


describe("child approval compatibility", () => {
  beforeEach(() => clearSessionCompatibilityObservations())
  afterEach(() => clearSessionCompatibilityObservations())
  const parent = "approval-target-parent", child = "approval-target-child"
  const report = (blocked: boolean) => ({ session_version: blocked ? 99 : 1, current_session_version: 1,
    status: blocked ? "conflict" : "compatible", history_readable: true, execution_allowed: !blocked,
    conflicts: blocked ? [{ code: "unsupported_session_version", message: "Future child" }] : [] })
  const conflict = (id: string) => new ApiError("incompatible", 409, "", JSON.stringify({ session_id: id,
    error: { code: "session_execution_incompatible" }, compatibility: report(true) }))
  async function pending(childBlocked = false, childRead?: Promise<unknown>) {
    mocks.appState.chats = [{ id: parent, messages: [], isRunning: true }]
    mocks.shouldObserve = true
    mocks.getSession.mockImplementation(async (id: string) => id === child && childRead ? childRead
      : { session: { id, execution_compatibility: report(id === child && childBlocked) } })
    mocks.subscribeToEvents.mockReturnValue(pendingForever())
    mocks.respondToChildApproval.mockResolvedValue({ delivered: true })
    const hook = await mountUseChat({ mode: "bound", sessionId: parent })
    const handlers = mocks.subscribeToEvents.mock.calls[0][1] as { onChildApprovalRequested(id: string, request: string, detail: { toolName: string; permission: string }): void }
    await act(async () => handlers.onChildApprovalRequested(child, "request-7", { toolName: "Write", permission: "write" }))
    await flushMicrotasks()
    return hook
  }
  it.each([true, false])("submits the Human's %s decision to the compatible Child despite a parent conflict", async (approved) => {
    const hook = await pending()
    await act(async () => { observeSessionExecutionConflict(parent, conflict(parent)) })
    expect(hook.current.pendingApproval?.childSessionId).toBe(child)
    expect(mocks.respondToChildApproval).not.toHaveBeenCalled()
    await act(async () => { await hook.current.respondApproval(approved) })
    expect(mocks.respondToChildApproval).toHaveBeenCalledExactlyOnceWith(child, "request-7", approved)
    expect(mocks.sendMessage).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled()
  })
  it("reads the Child's own report and retains its pending request through conflict and explicit recovery", async () => {
    const hook = await pending(true)
    expect(mocks.getSession).toHaveBeenCalledWith(child)
    expect(hook.current.approvalCompatibility.blocked).toBe(true)
    await act(async () => { await hook.current.respondApproval(true); await hook.current.respondApproval(false) })
    expect(mocks.respondToChildApproval).not.toHaveBeenCalled()
    expect(hook.current.pendingApproval?.requestId).toBe("request-7")
    mocks.getSession.mockImplementation(async (id: string) => ({ session: { id, execution_compatibility: report(false) } }))
    await act(async () => { await hook.current.approvalCompatibility.refresh() })
    expect(hook.current.approvalCompatibility.blocked).toBe(false)
    expect(mocks.respondToChildApproval).not.toHaveBeenCalled()
    await act(async () => { await hook.current.respondApproval(false) })
    expect(mocks.respondToChildApproval).toHaveBeenCalledExactlyOnceWith(child, "request-7", false)
  })
  it.each([false, true])("retains a rejected Child approval and observes its typed conflict while detail is pending=%s", async (readPending) => {
    const staleRead = deferred<unknown>()
    const hook = await pending(false, readPending ? staleRead.promise : undefined)
    const original = hook.current.pendingApproval
    mocks.respondToChildApproval.mockRejectedValueOnce(conflict(child))
    await act(async () => { await hook.current.respondApproval(true) })
    expect(hook.current.pendingApproval).toBe(original)
    expect(hook.current.approvalCompatibility.blocked).toBe(true)
    expect(hook.current.executionCompatibility.blocked).toBe(false)
    await act(async () => { await hook.current.respondApproval(false) })
    expect(mocks.respondToChildApproval).toHaveBeenCalledExactlyOnceWith(child, "request-7", true)
    if (readPending) {
      await act(async () => { staleRead.resolve({ session: { id: child, execution_compatibility: report(false) } }); await Promise.resolve() })
      expect(hook.current.approvalCompatibility.blocked).toBe(true)
    }
    mocks.getSession.mockImplementation(async (id: string) => ({ session: { id, execution_compatibility: report(false) } }))
    await act(async () => { await hook.current.approvalCompatibility.refresh() })
    expect(hook.current.approvalCompatibility.blocked).toBe(false)
    expect(mocks.respondToChildApproval).toHaveBeenCalledTimes(1)
    await act(async () => { await hook.current.respondApproval(false) })
    expect(mocks.respondToChildApproval).toHaveBeenLastCalledWith(child, "request-7", false)
    expect(hook.current.pendingApproval).toBeNull()
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.sendMessage).not.toHaveBeenCalled()
  })
  it.each(["network", "undelivered"])("retains an unconfirmed approval with an error and prevents concurrent submissions (%s)", async (failure) => {
    const hook = await pending(), response = deferred<{ delivered: boolean }>()
    mocks.respondToChildApproval.mockReturnValueOnce(response.promise)
    const original = hook.current.pendingApproval
    let submitting!: Promise<void>
    await act(async () => { submitting = hook.current.respondApproval(true); await hook.current.respondApproval(false) })
    expect(hook.current.pendingApproval).toBe(original)
    expect(hook.current.approvalSubmitting).toBe(true)
    expect(mocks.respondToChildApproval).toHaveBeenCalledTimes(1)
    await act(async () => {
      if (failure === "network") response.reject(new Error("network lost"))
      else response.resolve({ delivered: false })
      await submitting
    })
    expect(hook.current.pendingApproval).toBe(original)
    expect(hook.current.approvalSubmitting).toBe(false)
    expect(hook.current.approvalError).toBeTruthy()
    expect(hook.current.approvalCompatibility.blocked).toBe(false)
    expect(mocks.respondToChildApproval).toHaveBeenCalledTimes(1)
  })
  it.each(["success", "refusal"])("does not replace a newer approval when the previous submission settles (%s)", async (outcome) => {
    const hook = await pending(), response = deferred<{ delivered: boolean }>()
    mocks.respondToChildApproval.mockReturnValueOnce(response.promise)
    let submitting!: Promise<void>
    await act(async () => { submitting = hook.current.respondApproval(true) })
    const handlers = mocks.subscribeToEvents.mock.calls[0][1] as { onChildApprovalRequested(id: string, request: string, detail: { toolName: string; permission: string }): void }
    await act(async () => handlers.onChildApprovalRequested("new-child", "request-8", { toolName: "Write", permission: "write" }))
    await act(async () => {
      if (outcome === "success") response.resolve({ delivered: true })
      else response.reject(conflict(child))
      await submitting
    })
    expect(hook.current.pendingApproval?.requestId).toBe("request-8")
    expect(hook.current.approvalCompatibility.blocked).toBe(false)
    expect(hook.current.approvalError).toBeNull()
    expect(mocks.respondToChildApproval).toHaveBeenCalledTimes(1)
  })
  it("a cached approval callback still respects a later conflict for that exact Child", async () => {
    const hook = await pending(), cached = hook.current.respondApproval
    await act(async () => { observeSessionExecutionConflict(child, conflict(child)) })
    await act(async () => { await cached(true) })
    expect(mocks.respondToChildApproval).not.toHaveBeenCalled()
    expect(hook.current.pendingApproval?.requestId).toBe("request-7")
  })
})

describe("useChat context compression feedback", () => {
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
  const storedUsage = (sessionId: string) => mocks.appState.chats.find((chat) => chat.id === sessionId)?.tokenUsage
  function queueRun(sessionId: string) {
    const subscription = deferred<void>()
    let capturedHandlers: SubscriptionHandlers | undefined
    let capturedController: AbortController | undefined
    mocks.sendMessage.mockResolvedValueOnce({ session_id: sessionId })
    mocks.subscribeToEvents.mockImplementationOnce(
      (_sessionId: string, handlers: SubscriptionHandlers, controller: AbortController) => {
        capturedHandlers = handlers
        capturedController = controller
        controller.signal.addEventListener("abort", () => subscription.resolve(), { once: true })
        return subscription.promise
      },
    )
    return {
      subscription,
      get handlers() {
        if (!capturedHandlers) throw new Error("synthetic compression stream did not subscribe")
        return capturedHandlers
      },
      get controller() {
        if (!capturedController) throw new Error("synthetic compression stream has no controller")
        return capturedController
      },
    }
  }
  async function mountCompressionRun(onRender?: (value: HookValue) => void) {
    const sessionId = "synthetic-compression-session"
    mocks.appState.chats = [{ id: sessionId, messages: [], config: { model: "test-model" } }]
    const stream = queueRun(sessionId)
    const hook = await mountUseChat({ mode: "bound", sessionId }, onRender)
    await act(async () => { await hook.current.send("synthetic compression lifecycle") })
    return { hook, stream, sessionId }
  }

  it.each([
    { status: "failed_candidate_plan:synthetic candidate diagnostic", expected: { status: "failed", reason: "candidate_plan" } },
    { status: "deferred_tool_protocol", expected: { status: "deferred", reason: "tool_protocol" } },
  ])("retains pre-start $status without claiming a running compressor", async ({ status, expected }) => {
    const rendered: Array<ContextCompressionFeedback | null> = []
    const { hook, stream } = await mountCompressionRun((value) => rendered.push(value.contextCompression))
    expect(hook.current.contextCompression).toBeNull()
    await act(async () => { stream.handlers.onContextCompressionStatus("preflight", status) })
    expect(hook.current.contextCompression).toEqual(expected)
    expect(hook.current.streamStatus).toBeNull()
    await act(async () => {
      stream.handlers.onContextCompressionStatus("preflight", "map:1/3 input=180000 output=4000 safe=200000 model_limit=320000")
      stream.handlers.onToken("ordinary assistant text")
    })
    expect(hook.current.contextCompression).toEqual(expected)
    expect(rendered.some((feedback) => feedback?.status === "running")).toBe(false)
    expect(mocks.appState.updateTokenUsage).not.toHaveBeenCalled()
    expect(mocks.appState.setTruncationInfo).not.toHaveBeenCalled()
  })

  it("retains a started compressor through map/reduce progress and ordinary tokens", async () => {
    const { hook, stream } = await mountCompressionRun()
    await act(async () => { stream.handlers.onContextCompressionStatus("preflight", "started") })
    expect(hook.current.contextCompression).toEqual({ status: "running" })
    for (const progress of [
      "map:1/3 input=180000 output=4000 safe=200000 model_limit=320000",
      "reduce:1/1 input=12000 output=4000 safe=200000 model_limit=320000",
    ]) {
      await act(async () => {
        stream.handlers.onContextCompressionStatus("preflight", progress)
        stream.handlers.onToken("more ordinary text")
      })
      expect(hook.current.contextCompression).toEqual({ status: "running" })
    }
    expect(mocks.appState.updateTokenUsage).not.toHaveBeenCalled()
  })

  it.each(["status", "summary"] as const)("waits for actual budget usage after a paired %s receipt without changing the meter", async (receipt) => {
    const { hook, stream, sessionId } = await mountCompressionRun()
    await act(async () => { stream.handlers.onTokenBudgetUpdated(budget()) })
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 288_000, maxContextTokens: 320_000, budgetLimit: 300_000 })
    const originalUsage = structuredClone(storedUsage(sessionId))
    await act(async () => {
      stream.handlers.onContextCompressionStatus("preflight", "started")
      if (receipt === "status") stream.handlers.onContextCompressionStatus("preflight", "completed")
      else stream.handlers.onContextSummarized(summary)
    })
    expect(hook.current.contextCompression).toEqual({ status: "completed", awaitingUsage: true })
    expect(storedUsage(sessionId)).toEqual(originalUsage)
    expect(mocks.appState.updateTokenUsage).toHaveBeenCalledTimes(1)
    expect(mocks.appState.setTruncationInfo).toHaveBeenCalledExactlyOnceWith(sessionId, false, 0)
    await act(async () => { stream.handlers.onToken("the answer continues before a new budget") })
    expect(hook.current.contextCompression).toEqual({ status: "completed", awaitingUsage: true })
    await act(async () => { stream.handlers.onTokenBudgetUpdated(budget(256_000)) })
    expect(hook.current.contextCompression).toEqual({ status: "completed", awaitingUsage: false })
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 256_000, maxContextTokens: 320_000, budgetLimit: 300_000 })
    expect(mocks.appState.updateTokenUsage).toHaveBeenCalledTimes(2)
    await act(async () => {
      stream.handlers.onContextSummarized(summary)
      stream.handlers.onContextCompressionStatus("preflight", "completed")
    })
    expect(hook.current.contextCompression).toEqual({ status: "completed", awaitingUsage: false })
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 256_000, maxContextTokens: 320_000, budgetLimit: 300_000 })
    expect(mocks.appState.updateTokenUsage).toHaveBeenCalledTimes(2)
  })

  it.each(["status", "summary"] as const)("treats an unpaired %s receipt as unconfirmed rather than successful", async (receipt) => {
    const { hook, stream, sessionId } = await mountCompressionRun()
    await act(async () => { stream.handlers.onTokenBudgetUpdated(budget()) })
    await act(async () => {
      if (receipt === "status") stream.handlers.onContextCompressionStatus("preflight", "completed")
      else stream.handlers.onContextSummarized(summary)
    })
    expect(hook.current.contextCompression).toEqual({ status: "unconfirmed" })
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 288_000, maxContextTokens: 320_000 })
    expect(mocks.appState.updateTokenUsage).toHaveBeenCalledTimes(1)
    await act(async () => { stream.handlers.onTokenBudgetUpdated(budget(256_000)) })
    expect(hook.current.contextCompression).toEqual({ status: "unconfirmed" })
  })

  it.each(["local stop", "cancelled event"] as const)("distinguishes %s from confirmed summary cancellation and rejects queued callbacks", async (ending) => {
    mocks.stopGeneration.mockResolvedValue(undefined)
    const { hook, stream, sessionId } = await mountCompressionRun()
    await act(async () => {
      stream.handlers.onTokenBudgetUpdated(budget())
      stream.handlers.onContextCompressionStatus("preflight", "started")
    })
    expect(hook.current.contextCompression).toEqual({ status: "running" })
    await act(async () => {
      if (ending === "local stop") hook.current.stop()
      else { stream.handlers.onCancelled(); stream.subscription.resolve() }
      await Promise.resolve()
      await Promise.resolve()
    })
    const expected = { status: ending === "local stop" ? "unconfirmed" : "cancelled" }
    expect(hook.current.contextCompression).toEqual(expected)
    if (ending === "local stop") expect(stream.controller.signal.aborted).toBe(true)
    await act(async () => {
      stream.handlers.onContextCompressionStatus("preflight", "started")
      stream.handlers.onContextCompressionStatus("preflight", "completed")
      stream.handlers.onContextSummarized(summary)
      stream.handlers.onTokenBudgetUpdated(budget(128_000))
    })
    expect(hook.current.contextCompression).toEqual(expected)
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 288_000, maxContextTokens: 320_000, budgetLimit: 300_000 })
    expect(mocks.appState.updateTokenUsage).toHaveBeenCalledTimes(1)
    expect(mocks.appState.setTruncationInfo).toHaveBeenCalledTimes(1)
  })

  it.each(["pending", "rejected"] as const)("does not confirm summary cancellation from a %s Stop request", async (outcome) => {
    const request = deferred<void>()
    mocks.stopGeneration.mockReturnValueOnce(request.promise)
    const { hook, stream } = await mountCompressionRun()
    await act(async () => {
      stream.handlers.onContextCompressionStatus("preflight", "started")
      hook.current.stop()
    })
    expect(hook.current.contextCompression).toEqual({ status: "unconfirmed" })
    expect(stream.controller.signal.aborted).toBe(true)
    expect(mocks.stopGeneration).toHaveBeenCalledOnce()
    await act(async () => {
      if (outcome === "rejected") request.reject(new Error("synthetic Stop transport failure"))
      else request.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(hook.current.contextCompression).toEqual({ status: "unconfirmed" })
  })

  it.each(["complete", "error"] as const)("does not infer compression success when the run ends by %s while compression is still running", async (ending) => {
    const { hook, stream } = await mountCompressionRun()
    await act(async () => { stream.handlers.onContextCompressionStatus("preflight", "started") })
    const terminalHistory = deferred<void>()
    mocks.appState.loadChatHistory.mockReturnValueOnce(terminalHistory.promise)
    await act(async () => {
      if (ending === "complete") stream.handlers.onComplete()
      else stream.handlers.onError("synthetic generation error")
      stream.subscription.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(hook.current.contextCompression).toEqual({ status: "unconfirmed" })
    expect(mocks.appState.updateTokenUsage).not.toHaveBeenCalled()
    await act(async () => {
      terminalHistory.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(hook.current.contextCompression).toEqual({ status: "unconfirmed" })
  })

  it("cannot let an old operation overwrite the current feedback or token budget in the same Session", async () => {
    mocks.stopGeneration.mockResolvedValue(undefined)
    const { hook, stream, sessionId } = await mountCompressionRun()
    await act(async () => {
      stream.handlers.onTokenBudgetUpdated(budget())
      stream.handlers.onContextCompressionStatus("preflight", "started")
      hook.current.stop()
      await Promise.resolve()
      await Promise.resolve()
    })
    const next = queueRun(sessionId)
    await act(async () => { await hook.current.send("synthetic successor operation") })
    await act(async () => {
      next.handlers.onTokenBudgetUpdated(budget(160_000))
      next.handlers.onContextCompressionStatus("preflight", "started")
    })
    expect(hook.current.contextCompression).toEqual({ status: "running" })
    await act(async () => {
      stream.handlers.onContextCompressionStatus("preflight", "failed_candidate_plan:old operation")
      stream.handlers.onContextSummarized(summary)
      stream.handlers.onTokenBudgetUpdated(budget(32_000))
    })
    expect(hook.current.contextCompression).toEqual({ status: "running" })
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 160_000, maxContextTokens: 320_000, budgetLimit: 300_000 })
    expect(mocks.appState.updateTokenUsage).toHaveBeenCalledTimes(2)
    expect(mocks.appState.setTruncationInfo).toHaveBeenCalledTimes(2)
    await act(async () => {
      next.handlers.onContextCompressionStatus("preflight", "completed")
      next.handlers.onTokenBudgetUpdated(budget(144_000))
    })
    expect(hook.current.contextCompression).toEqual({ status: "completed", awaitingUsage: false })
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 144_000, maxContextTokens: 320_000 })
  })

  it("hides background feedback while preserving that Session's legitimate budget updates", async () => {
    const { hook, stream, sessionId } = await mountCompressionRun()
    await act(async () => {
      stream.handlers.onTokenBudgetUpdated(budget())
      stream.handlers.onContextCompressionStatus("preflight", "started")
    })
    const destination = "synthetic-other-session"
    mocks.appState.chats.push({ id: destination, messages: [], config: { model: "test-model" } })
    await hook.rerender({ mode: "bound", sessionId: destination })
    // Rebinding a pane does not stop its background run or subscription.
    // Its events may update A, while the new pane must show only B's data.
    expect(stream.controller.signal.aborted).toBe(false)
    expect(hook.current.currentSessionId).toBe(destination)
    expect(hook.current.contextCompression).toBeNull()
    await act(async () => {
      stream.handlers.onContextCompressionStatus("preflight", "started")
      stream.handlers.onContextSummarized(summary)
      stream.handlers.onTokenBudgetUpdated(budget(64_000))
    })
    expect(hook.current.contextCompression).toBeNull()
    expect(storedUsage(destination)).toBeUndefined()
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 64_000, maxContextTokens: 320_000 })
    expect(mocks.appState.updateTokenUsage).toHaveBeenCalledTimes(2)
    expect(mocks.appState.setTruncationInfo).toHaveBeenCalledTimes(2)
    await hook.rerender({ mode: "bound", sessionId })
    expect(hook.current.contextCompression).toEqual({ status: "completed", awaitingUsage: false })
  })

  it("accepts a newly acknowledged Session's budget before its pane finishes rebinding", async () => {
    const sessionId = "synthetic-created-compression-session"
    mocks.appState.chats = [{ id: sessionId, messages: [], config: { model: "test-model" } }]
    const stream = queueRun(sessionId)
    const hook = await mountUseChat({ mode: "bound", sessionId: null })
    await act(async () => { await hook.current.send("create a synthetic compression session") })
    await act(async () => {
      stream.handlers.onTokenBudgetUpdated(budget())
      stream.handlers.onContextCompressionStatus("preflight", "started")
    })
    expect(hook.current.contextCompression).toBeNull()
    expect(storedUsage(sessionId)).toMatchObject({ totalTokens: 288_000, maxContextTokens: 320_000 })
    await hook.rerender({ mode: "bound", sessionId })
    expect(hook.current.contextCompression).toEqual({ status: "running" })
    expect(mocks.appState.updateTokenUsage).toHaveBeenCalledTimes(1)
  })

  it("does not let another compression phase settle an observed running summary", async () => {
    const { hook, stream } = await mountCompressionRun()
    await act(async () => {
      stream.handlers.onContextCompressionStatus("preflight", "started")
      stream.handlers.onContextCompressionStatus("postflight", "completed")
      stream.handlers.onContextCompressionStatus("postflight", "failed_postcondition:late")
    })
    expect(hook.current.contextCompression).toEqual({ status: "running" })
    await act(async () => { stream.handlers.onContextCompressionStatus("preflight", "completed") })
    expect(hook.current.contextCompression).toEqual({ status: "completed", awaitingUsage: true })
  })
})
