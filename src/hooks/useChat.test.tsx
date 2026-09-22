import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { ProviderInstancesConfig, ProviderKind } from "@shared/types/providerConfig"
import type { PermissionDecisionResult, ReasoningEffort } from "@services/chat/AgentService"
import { ApiError, NetworkRequestError } from "@services/api/errors"
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
      config?: {
        model?: string
        model_ref?: { provider: string; model: string } | null
        reasoningEffort?: ReasoningEffort | null
      }
    }>,
    currentSessionId: null as string | null,
    sessionIndexRevision: 0,
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
    submitPermissionDecision: vi.fn(),
    shouldObserve: false,
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    acknowledgeTemplate: vi.fn(),
    providerState: {
      providerSnapshot: null,
      getProviderType: vi.fn<(instanceId: string) => ProviderKind | undefined>(() => undefined),
    } as {
      providerSnapshot: ProviderInstancesConfig | null
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
  useProviderStore: (selector: (state: unknown) => unknown) =>
    selector(mocks.providerState),
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
  localStorage.clear()
  mocks.shouldObserve = false
  mocks.appState.chats = []
  mocks.appState.currentSessionId = null
  mocks.appState.sessionIndexRevision = 0
  mocks.appState.selectedModel = "test-model"
  mocks.appState.inputStates = {}
  mocks.appState.lastSelectedPromptId = null
  mocks.appState.systemPrompts = []
  mocks.providerState.providerSnapshot = null
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
  mocks.appState.loadSubagentSessions.mockResolvedValue(undefined)
  mocks.appState.restoreSession.mockResolvedValue(false)
  mocks.appState.loadChatHistory.mockResolvedValue(undefined)
  mocks.appState.refreshChatsNow.mockResolvedValue(undefined)
  mocks.execute.mockResolvedValue(undefined)
  mocks.subscribeToEvents.mockResolvedValue(undefined)
  mocks.truncateSessionMessages.mockResolvedValue(undefined)
  mocks.getPendingQuestion.mockResolvedValue({ has_pending_question: false })
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
    const hook = await mountUseChat({ mode: "bound", sessionId: "used-model-session" })

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
    expect(mocks.execute).toHaveBeenCalledWith("detached-session", "test-model", undefined, undefined, undefined)
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
    expect(mocks.execute).toHaveBeenCalledWith("session-one", "test-model", undefined, undefined, undefined)
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
    expect(mocks.execute).toHaveBeenCalledWith("main-session", "test-model", undefined, undefined, undefined)
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
    mocks.appState.selectedModel = undefined
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
      expect(mocks.execute).toHaveBeenCalledWith("ack-session", "test-model", undefined, undefined, undefined)
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
    const initialHistory = deferred<void>()
    const subscription = deferred<void>()
    let subscriptionController: AbortController | undefined
    mocks.sendMessage.mockResolvedValueOnce({ session_id: "stopped-session" })
    mocks.appState.loadChatHistory
      .mockReturnValueOnce(initialHistory.promise)
      .mockResolvedValueOnce(undefined)
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
    expect(mocks.execute).toHaveBeenCalledWith("late-session", "test-model", undefined, undefined, undefined)
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
