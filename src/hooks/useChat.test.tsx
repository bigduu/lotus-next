import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
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
    chats: [] as Array<{ id: string; messages?: unknown[]; isRunning?: boolean }>,
    currentSessionId: null as string | null,
    selectedModel: "test-model",
    inputStates: {} as Record<string, { reasoningEffort?: string }>,
    lastSelectedPromptId: null as string | null,
    systemPrompts: [] as Array<{ id: string; content?: string }>,
    selectSession: vi.fn(),
    loadChatHistory: vi.fn(),
    refreshChatsNow: vi.fn(),
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
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    acknowledgeTemplate: vi.fn(),
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
    selectShouldObserve: () => () => false,
  }
})
vi.mock("@shared/store/appStore/slices/providerSlice", () => ({
  useProviderStore: (selector: (state: unknown) => unknown) =>
    selector({
      providerConfig: null,
      defaultProviderInstanceId: null,
      providerInstances: [],
    }),
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
type HookValue = ReturnType<typeof useChat>
type HookProps =
  | { mode: "main" }
  | {
      mode: "bound"
      sessionId: string | null
      onSessionCreated?: (sessionId: string) => void
    }
type SubscriptionHandlers = {
  onComplete(): void
  onError(error?: unknown): void
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
function pendingForever<T>(): Promise<T> {
  return new Promise<T>(() => {})
}
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}
async function mountUseChat(initialProps: HookProps) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  let current: HookValue | null = null
  function MainHarness() {
    current = useChat()
    return null
  }
  function BoundHarness({
    sessionId,
    onSessionCreated,
  }: Extract<HookProps, { mode: "bound" }>) {
    current = useChat(sessionId, onSessionCreated)
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
  mocks.appState.chats = []
  mocks.appState.currentSessionId = null
  mocks.appState.selectedModel = "test-model"
  mocks.appState.inputStates = {}
  mocks.appState.lastSelectedPromptId = null
  mocks.appState.systemPrompts = []
  for (const mock of [
    mocks.appState.selectSession,
    mocks.appState.loadChatHistory,
    mocks.appState.refreshChatsNow,
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
  mocks.appState.loadChatHistory.mockResolvedValue(undefined)
  mocks.appState.refreshChatsNow.mockResolvedValue(undefined)
  mocks.execute.mockResolvedValue(undefined)
  mocks.subscribeToEvents.mockResolvedValue(undefined)
  mocks.truncateSessionMessages.mockResolvedValue(undefined)
  mocks.apiGet.mockRejectedValue(new Error("no pending question"))
  mocks.apiPost.mockResolvedValue(undefined)
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
  consoleErrorSpy.mockRestore()
  consoleWarnSpy.mockRestore()
})
describe("useChat two-phase send lifecycle", () => {
  it.each([
    ["new-session POST rejection", null, "reject"],
    ["empty acknowledgement", null, "empty"],
    ["existing-session POST rejection", "existing-session", "reject"],
  ] as const)("keeps %s unconfirmed without rerunning a previous turn", async (_case, sid, mode) => {
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
  })
  it("acknowledges the exact template lease only after a valid submission acknowledgement", async () => {
    const templatePrompt = { prompt: "Use the exact template", revision: 17 }
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
      expect.objectContaining({ system_prompt: "Use the exact template" }),
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
    expect(mocks.execute).toHaveBeenCalledWith("detached-session", "test-model", undefined)
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
    expect(mocks.execute).toHaveBeenCalledWith("session-one", "test-model", undefined)
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
    expect(mocks.execute).toHaveBeenCalledWith("main-session", "test-model", undefined)
    expect(mocks.subscribeToEvents).toHaveBeenCalledWith(
      "main-session",
      expect.any(Object),
      expect.any(AbortController),
    )
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
        else handlers?.onError(new Error("generation failed"))
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
        })
        expect(mocks.appState.loadChatHistory).toHaveBeenNthCalledWith(2, "terminal-session")
      }
      await act(async () => {
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
        })
      }
    },
  )
  it.each(["refresh", "history"] as const)(
    "starts exact-session generation before resolving accepted when %s hydration fails",
    async (failurePoint) => {
      const milestones: string[] = []
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
        const accepted = await hook.current.send("run after acknowledgement")
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
      expect(mocks.execute).toHaveBeenCalledWith("ack-session", "test-model", undefined)
      expect(mocks.appState.refreshChatsNow).toHaveBeenCalledTimes(1)
      expect(mocks.appState.loadChatHistory).toHaveBeenCalledWith("ack-session")
      expect(hook.current.sendFailure).toBeNull()
    },
  )
  it("fences duplicate retry clicks before truncation and reruns only the owned session", async () => {
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
      truncation.resolve()
      await firstRetry
    })
    expect(mocks.truncateSessionMessages).toHaveBeenCalledTimes(1)
    expect(mocks.truncateSessionMessages).toHaveBeenCalledWith("exact-session", {
      mode: "error_retry",
    })
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(mocks.execute).toHaveBeenLastCalledWith("exact-session", "test-model", undefined)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(hook.current.sendFailure).toBeNull()
    expect(hook.current.pendingUserText).toBeNull()
  })
  it("finishes retry for session A without subscribing or contaminating a pane rebound to B", async () => {
    const { hook, truncation, retrying, callCounts } = await startPendingRetry(
      "session-a",
      "optimistic payload owned by A",
    )
    await hook.rerender({ mode: "bound", sessionId: "session-b" })
    await act(async () => {
      truncation.resolve()
      await retrying
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.truncateSessionMessages).toHaveBeenCalledWith("session-a", {
      mode: "error_retry",
    })
    expect(mocks.execute).toHaveBeenCalledTimes(callCounts.execute + 1)
    expect(mocks.execute).toHaveBeenLastCalledWith("session-a", "test-model", undefined)
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
    expect(mocks.execute).toHaveBeenLastCalledWith("detached-a", "test-model", undefined)
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
    )
    expect(mocks.subscribeToEvents).toHaveBeenCalledTimes(callCounts.subscribe)
    expect(mocks.appState.loadChatHistory.mock.calls.length).toBeGreaterThan(callCounts.history)
    expect(mocks.appState.loadChatHistory).toHaveBeenLastCalledWith("unmounted-session-a")
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
  it("clears the acknowledged optimistic payload after an immediate stop hydrates history", async () => {
    const initialHistory = deferred<void>()
    const subscription = deferred<void>()
    mocks.sendMessage.mockResolvedValueOnce({ session_id: "stopped-session" })
    mocks.appState.loadChatHistory
      .mockReturnValueOnce(initialHistory.promise)
      .mockResolvedValueOnce(undefined)
    mocks.subscribeToEvents.mockReturnValueOnce(subscription.promise)
    mocks.stopGeneration.mockResolvedValueOnce(undefined)
    const hook = await mountUseChat({ mode: "bound", sessionId: "stopped-session" })
    await act(async () => {
      await hook.current.send("stop this acknowledged run")
    })
    expect(hook.current.sending).toBe(true)
    expect(hook.current.pendingUserText).toBe("stop this acknowledged run")
    await act(async () => {
      hook.current.stop()
      subscription.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.stopGeneration).toHaveBeenCalledTimes(1)
    expect(mocks.stopGeneration).toHaveBeenCalledWith("stopped-session")
    expect(mocks.appState.loadChatHistory).toHaveBeenNthCalledWith(2, "stopped-session")
    expect(hook.current.sending).toBe(false)
    expect(hook.current.streaming).toBeNull()
    expect(hook.current.pendingUserText).toBeNull()
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
    expect(mocks.execute).toHaveBeenCalledWith("late-session", "test-model", undefined)
    expect(hook.current.sending).toBe(false)
    expect(hook.current.submissionPending).toBe(false)
    expect(hook.current.streaming).toBeNull()
  })
})
