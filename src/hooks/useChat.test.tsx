import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { ProviderInstancesConfig } from "@shared/types/providerConfig"
import type { ProviderModelRef } from "@shared/types/providerModelRef"
import type { AgentEvent, ReasoningEffort } from "@services/chat/AgentService"
import type { ChatHistoryWindow } from "@shared/types/chatMessages"
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
  const fenceRoot = (enabled = false) => beginRootModeOperation("root-session", 0, "a".repeat(64), enabled)

  it("submits and executes a non-default provider's custom model before catalog metadata loads", async () => {
    const customRef = { provider: "other-provider", model: "vendor:custom-name" }
    mocks.providerState.providerSnapshot!.instances.push({
      id: customRef.provider, type: "openai", label: "Other", enabled: true,
      config: { runtime_models: [customRef.model] },
    })
    mocks.appState.selectedModel = customRef
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
    mocks.appState.selectedModel = { provider: "test-provider", model: selected }
    mocks.sendMessage.mockResolvedValueOnce({ session_id: "instance-only-session" })
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())
    const hook = await mountUseChat({ mode: "bound", sessionId: null })
    await act(async () => { await hook.current.send("start from the first provider") })
    const expectedRef = { provider: "test-provider", model: expectedModel }
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ model: expectedModel, model_ref: expectedRef }))
    expect(mocks.execute).toHaveBeenCalledWith("instance-only-session", expectedModel, undefined, undefined, expectedRef)
  })

  it("revalidates a disabled draft provider at submission and freezes the fallback for execute", async () => {
    const snapshot = mocks.providerState.providerSnapshot!
    snapshot.instances.push({ id: "second-provider", type: "openai", label: "Second", enabled: true, config: { runtime_models: ["second-default"] } })
    const response = deferred<{ session_id: string }>()
    mocks.sendMessage.mockReturnValueOnce(response.promise)
    mocks.subscribeToEvents.mockReturnValueOnce(pendingForever())
    const hook = await mountUseChat({ mode: "bound", sessionId: null })
    const cachedSend = hook.current.send
    snapshot.instances[0].enabled = false
    snapshot.defaults = { chat: { provider: "second-provider", model: "second-default" } }
    let sending!: Promise<SendSubmissionResult>
    act(() => { sending = cachedSend("use the newly configured provider") })
    const expectedRef = { provider: "second-provider", model: "second-default" }
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ model: expectedRef.model, model_ref: expectedRef }))

    // A later preference change must not reroute the acknowledged session.
    snapshot.instances[0].enabled = true
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

  it.each([409, 400, 500])("keeps a Source admission conflict unaccepted without changing the old source (HTTP %s)", async (status) => {
    const config = { model: "test-model", workspacePath: "/synthetic/original", projectId: "original-project" }
    mocks.appState.chats = [{ id: "old-source", messages: [], config }]
    mocks.sendMessage.mockRejectedValueOnce(new ApiError(
      "A running or starting session cannot change Project or Workspace", status, "Conflict",
      JSON.stringify({ error: { type: "api_error", code: "session_project_running_conflict" }, session_id: "old-source" }),
    ))
    const hook = await mountUseChat({ mode: "bound", sessionId: "old-source" })
    await act(async () => {
      expect(await hook.current.send("Keep the unsent draft", { workspacePath: "/synthetic/other", projectId: "other-project" })).toMatchObject({ kind: "unconfirmed" })
    })
    expect(mocks.sendMessage).toHaveBeenCalledOnce()
    expect(mocks.sendMessage.mock.calls[0][0]).toMatchObject({ session_id: "old-source", workspace_path: undefined, project_id: undefined })
    const failure = hook.current.sendFailure
    expect(failure?.kind === "submission-unconfirmed" ? failure.rejectionCode : undefined).toBe(status === 409 ? "session_project_running_conflict" : undefined)
    if (status === 409) expect(hook.current.sendFailure).toMatchObject({ rootModeSelectionSubmitted: false })
    expect(config).toEqual({ model: "test-model", workspacePath: "/synthetic/original", projectId: "original-project" })
    expect(hook.current.submissionPending).toBe(false)
    expect(hook.current.sending).toBe(false)
    await act(async () => { await hook.current.retry() })
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.appState.updateSession).not.toHaveBeenCalled()
    expect(mocks.apiPost).not.toHaveBeenCalled()
    expect(getRootModeFenceState("old-source")).toBe("clear")
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
  })
  it("keeps an existing child session bound to its own provider and model", async () => {
    const sessionId = "child-session"
    // A draft selected in another pane must not override this bound session.
    mocks.appState.selectedModel = { provider: "test-provider", model: "grok-4.7" }
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
        expect(mocks.appState.loadChatHistory).toHaveBeenNthCalledWith(2, "terminal-session", { throwOnError: true })
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
      // A legacy ACK has no user ID; require the new canonical user boundary.
      messages: [{ id: "tool-result", role: "assistant", type: "tool_result", createdAt: "2026-09-19T12:00:00Z" },
        { id: "persisted-user", role: "user", content: "finish after the tool", createdAt: "2026-09-19T12:00:01Z" },
        { id: "persisted-final", role: "assistant", type: "text", content: "durable final answer", createdAt: "2026-09-19T12:00:02Z" }],
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
  it("recovers an earlier User anchor after a control-only terminal already read the recent page", async () => {
    const sessionId = "paged-control-only-terminal"
    const finalText = "Final reply from a long durable turn"
    const acknowledged = { id: "accepted-user", role: "user", content: "Inspect a long tool trace", createdAt: "2026-09-19T12:00:00Z" }
    const savedFinal = { id: "persisted-final", role: "assistant", type: "text", phase: "final_answer",
      content: finalText, createdAt: "2026-09-19T12:01:00Z", historyIndex: 105 }
    let recentRead = false
    let recoveryRead = false
    mocks.appState.chats = [{ id: sessionId, isRunning: true, lastRunStatus: null, messages: [] }]
    mocks.sendMessage.mockResolvedValueOnce({ session_id: sessionId, message_id: acknowledged.id })
    mocks.subscribeToEvents.mockImplementationOnce(async (_sessionId: string, handlers: SubscriptionHandlers) => {
      handlers.onToken(finalText)
    })
    mocks.appState.refreshChatsNow.mockImplementation(async () => {
      if (recentRead) {
        const chat = mocks.appState.chats[0]!
        chat.isRunning = false
        chat.lastRunStatus = "completed"
      }
    })
    mocks.appState.loadChatHistory.mockImplementation(async (_sessionId, options) => {
      if (!options?.waitForAssistant) return
      const chat = mocks.appState.chats[0]!
      if (options.throwOnError) {
        recentRead = true
        chat.messages = [savedFinal]
        chat.historyWindow = { startIndex: 105, messageIds: [savedFinal.id], beforeMessageId: "opaque/105" }
      } else {
        recoveryRead = true
        chat.messages = [acknowledged, savedFinal]
        chat.historyWindow = { startIndex: 0, messageIds: [acknowledged.id, savedFinal.id], beforeMessageId: null }
      }
    })
    const props = { mode: "bound" as const, sessionId }
    const hook = await mountUseChat(props)
    await act(async () => { await hook.current.send(acknowledged.content) })
    await flushMicrotasks()
    await hook.rerender(props)
    expect(recentRead).toBe(true)
    expect(recoveryRead).toBe(true)
    expect(hook.current.messages.filter((message) => message.id === savedFinal.id)).toHaveLength(1)
    expect(hook.current.streaming).toBeNull()
    expect(hook.current.sendFailure).toBeNull()
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
