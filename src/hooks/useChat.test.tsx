import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { ProviderInstancesConfig } from "@shared/types/providerConfig"
import type { ProviderModelRef } from "@shared/types/providerModelRef"
import type { AgentEvent, ReasoningEffort } from "@services/chat/AgentService"
import type { ChatHistoryWindow } from "@shared/types/chatMessages"
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
      historyWindow?: ChatHistoryWindow
      isRunning?: boolean
      lastRunStatus?: string | null
      config?: {
        model?: string
        model_ref?: { provider: string; model: string } | null
        reasoningEffort?: ReasoningEffort | null
      }
    }>,
    currentSessionId: null as string | null,
    sessionIndexRevision: 0,
    executionBySession: {},
    selectedModel: undefined as ProviderModelRef | undefined,
    inputStates: {} as Record<string, { reasoningEffort?: string }>,
    lastSelectedPromptId: null as string | null,
    systemPrompts: [] as Array<{ id: string; content?: string; isDefault?: boolean }>,
    selectSession: vi.fn(),
    loadSubagentSessions: vi.fn(),
    restoreSession: vi.fn(),
    loadChatHistory: vi.fn(),
    invalidateHistoryAfterMessageDelete: vi.fn(),
    refreshChatsNow: vi.fn(),
    markCancel: vi.fn(),
    updateSession: vi.fn(),
  }
  return {
    appState,
    initializeStore: vi.fn(),
    sendMessage: vi.fn(),
    execute: vi.fn(),
    subscribeToEvents: vi.fn(),
    truncateSessionMessages: vi.fn(),
    stopGeneration: vi.fn(),
    getRunningSessions: vi.fn(),
    deleteSessionMessage: vi.fn(),
    patchSessionMessage: vi.fn(),
    restoreSessionState: vi.fn(),
    getPendingQuestion: vi.fn(),
    getSession: vi.fn(),
    shouldObserve: false,
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    acknowledgeTemplate: vi.fn(),
    providerState: {
      providerSnapshot: null,
      catalog: null,
    } as {
      providerSnapshot: ProviderInstancesConfig | null
      catalog: unknown
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
vi.mock("@shared/store/appStore/state", () => ({
  appStore: { getState: () => mocks.appState },
}))
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
    getRunningSessions: mocks.getRunningSessions,
    deleteSessionMessage: mocks.deleteSessionMessage,
    patchSessionMessage: mocks.patchSessionMessage,
    restoreSessionState: mocks.restoreSessionState,
    getPendingQuestion: mocks.getPendingQuestion,
    getSession: mocks.getSession,
  },
}))
vi.mock("@services/api", () => ({
  getBackendStorageScope: () => "https://fixture.test/api/v1",
  apiClient: {
    get: mocks.apiGet,
    post: mocks.apiPost,
  },
}))
vi.mock("@/lib/taskTemplates", () => ({
  acknowledgePendingTemplatePrompt: mocks.acknowledgeTemplate,
}))
vi.mock("@/lib/notify", () => ({ notify: vi.fn(), isNotifyEnabled: () => false, notifyPermission: () => "denied" }))
vi.mock("@shared/utils/systemPromptEnhancement", () => ({
  getSystemPromptEnhancementText: () => "",
}))
import { useChat, type GenerationFailure, type SendSubmissionResult } from "./useChat"
import { resetCompletedAnswerHandoffsForTest } from "@/lib/completedAnswerHandoffRegistry"
type HookValue = ReturnType<typeof useChat>
type HookProps =
  | { mode: "main" }
  | {
      mode: "bound"
      sessionId: string | null
      onSessionCreated?: (sessionId: string) => void
    }
type SubscriptionHandlers = {
  onExecutionStarted(runId: string, startedAt?: string): void
  onToken(content: string): void
  onToolStart(toolCallId: string, toolName: string, args: Record<string, unknown>): void
  onToolToken(toolCallId: string, content: string): void
  onToolComplete(toolCallId: string, result: AgentEvent["result"]): void
  onToolError(toolCallId: string, error: string): void
  onMessageAppended(sessionId: string, messageId?: string): void
  onSessionHistoryCommitted(sessionId: string): void
  onComplete(): void
  onError(message: string): void
  onCancelled(): void
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
  resetCompletedAnswerHandoffsForTest()
  localStorage.clear()
  sessionStorage.clear()
  mocks.shouldObserve = false
  mocks.appState.chats = []
  mocks.appState.currentSessionId = null
  mocks.appState.sessionIndexRevision = 0
  mocks.appState.selectedModel = { provider: "test-provider", model: "test-model" }
  mocks.appState.inputStates = {}
  mocks.appState.lastSelectedPromptId = null
  mocks.appState.systemPrompts = []
  mocks.providerState.providerSnapshot = {
    default_provider_instance_id: "test-provider",
    instances: [{ id: "test-provider", type: "openai", label: "Test", enabled: true, config: { runtime_models: ["test-model"] } }],
    defaults: { chat: { provider: "test-provider", model: "test-model" } },
  }
  mocks.providerState.catalog = null
  for (const mock of [
    mocks.appState.selectSession,
    mocks.appState.loadSubagentSessions,
    mocks.appState.restoreSession,
    mocks.appState.loadChatHistory,
    mocks.appState.invalidateHistoryAfterMessageDelete,
    mocks.appState.refreshChatsNow,
    mocks.appState.markCancel,
    mocks.appState.updateSession,
    mocks.initializeStore,
    mocks.sendMessage,
    mocks.execute,
    mocks.subscribeToEvents,
    mocks.truncateSessionMessages,
    mocks.stopGeneration,
    mocks.getRunningSessions,
    mocks.deleteSessionMessage,
    mocks.patchSessionMessage,
    mocks.restoreSessionState,
    mocks.getPendingQuestion,
    mocks.getSession,
    mocks.apiGet,
    mocks.apiPost,
    mocks.acknowledgeTemplate,
  ]) {
    mock.mockReset()
  }
  mocks.initializeStore.mockResolvedValue(undefined)
  mocks.getRunningSessions.mockResolvedValue({ sessions: [] })
  mocks.appState.selectSession.mockImplementation((sessionId: string | null) => {
    mocks.appState.currentSessionId = sessionId
  })
  mocks.appState.loadSubagentSessions.mockResolvedValue(undefined)
  mocks.appState.restoreSession.mockResolvedValue(false)
  mocks.appState.loadChatHistory.mockResolvedValue(undefined)
  mocks.appState.refreshChatsNow.mockResolvedValue(undefined)
  mocks.execute.mockImplementation(async (sessionId: string) => ({ session_id: sessionId, status: "started", run_id: "synthetic-default-run" }))
  mocks.subscribeToEvents.mockResolvedValue(undefined)
  mocks.truncateSessionMessages.mockResolvedValue(undefined)
  mocks.getPendingQuestion.mockResolvedValue({ has_pending_question: false })
  mocks.getSession.mockRejectedValue(new Error("no status fixture"))
  mocks.apiGet.mockImplementation(async (path: string) => { if (path === "execute/defaults") return { model:null, system_prompt:"", base_system_prompt:"", default_session_permission_mode:"default" }; throw new Error("no pending question") })
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
    mocks.appState.selectedModel = { provider: "test-provider", model: "gpt-6-sol" }
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

})
