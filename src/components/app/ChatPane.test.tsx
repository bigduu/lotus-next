import { act, type ComponentProps, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SkillDefinition } from "@shared/types/skill"
import type { ProviderInstancesConfig } from "@shared/types/providerConfig"
import type { ProviderModelRef } from "@shared/types/providerModelRef"
import type { ReasoningEffort } from "@services/chat/AgentService"
import type { ReasoningEffortSelection } from "@shared/utils/reasoningEffort"
import type { TaskList } from "@shared/store/appStore/slices/todoListSlice"

type ComposerProps = ComponentProps<(typeof import("./Composer"))["Composer"]>
type MessageListProps = ComponentProps<(typeof import("./MessageList"))["MessageList"]>
type ModelEffortPickerProps = ComponentProps<
  (typeof import("@/components/chat/ModelEffortPicker"))["ModelEffortPicker"]
>
type ModelPickerProps = Pick<ModelEffortPickerProps, "modelGroups" | "modelProvider" | "menuPlacement" | "menuAlign"> & {
  value: string
  onChange: ModelEffortPickerProps["onModelChange"]
  disabled?: boolean
}
type ReasoningPickerProps = Pick<ModelEffortPickerProps,
  "value" | "onChange" | "disabled" | "allowUltra" | "thinkingMode" | "menuPlacement" | "menuAlign">
type ChatPaneProps = ComponentProps<(typeof import("./ChatPane"))["ChatPane"]>
type Send = ChatPaneProps["chat"]["send"]
type TicketController = ReturnType<(typeof import("@/hooks/useTicketWork"))["useTicketWork"]>
type State = {
  bindWorkspace: typeof import("@services/project/ProjectService").projectService.bindWorkspace
  currentSessionId: string | null
  managedHistoryBindings?: Record<string, { status: "active" | "stale" }>
  projects: Record<string, { project_path: string; name: string }>
  chats: { id: string; config: { reasoningEffort?: ReasoningEffort | null } }[]
  getInputState(id: string): State["inputStates"][string]
  setInputThinkingMode(id: string, mode: "standard" | "ultra"): boolean
  tokenUsages: Record<string, unknown>; inputStates: Record<string, { content: string; contentRevision: number; reasoningEffort?: ReasoningEffortSelection; thinkingMode?: "standard" | "ultra"; thinkingModeRevision?: number }>
  skills: SkillDefinition[]; childProgress: Record<string, unknown>; models: string[]; selectedModel: ProviderModelRef | undefined
  setInputContent(id: string, content: string): void
  setInputContentIfRevision(id: string, revision: number, content: string): boolean
  moveInputContentIfRevision(source: string, revision: number, target: string): boolean
  setSelectedModel(model: ProviderModelRef): void
  changeSessionModel(id: string, model: ProviderModelRef): Promise<void>
  setInputReasoningEffort(id: string, effort: ReasoningEffortSelection): void
  clearInputReasoningEffort(id: string): void
  clearInputThinkingModeIfRevision(id: string, revision: number): boolean
  changeSessionReasoningEffort(id: string, effort: ReasoningEffort | null): Promise<void>
  refreshChatsNow(): Promise<void>
  loadChatHistory: ReturnType<typeof vi.fn>
  taskLists: Record<string, TaskList>
  loadTaskList: ReturnType<typeof vi.fn>
  updateTokenUsage: ReturnType<typeof vi.fn>
  setTruncationInfo: ReturnType<typeof vi.fn>
}
const runtime = vi.hoisted(() => ({
  state: {} as State, listeners: new Set<() => void>(), composer: null as ComposerProps | null,
  messageList: null as MessageListProps | null,
  toastProps: null as ComponentProps<(typeof import("./Toasts"))["Toasts"]> | null,
  modelPicker: null as ModelPickerProps | null,
  reasoningPicker: null as ReasoningPickerProps | null,
  providerState: { providerSnapshot: null as ProviderInstancesConfig | null, providerStatus: "ready" },
  stickyAtBottom: true, scrollToBottom: vi.fn(),
  queueSend: vi.fn(), revision: 0, peekTemplate: vi.fn(),
  ticketWork: null as TicketController | null,
  worktreeControl: null as import("@services/workspace/newChatWorktreeTypes").NewChatWorktreeControlProps | null,
  getProject: vi.fn(), createWorktree: vi.fn(), bindWorkspace: vi.fn(),
  liveRetry: { canPrepare: false, prepareInitial: vi.fn<() => boolean | Promise<boolean>>(),
    offer: null as import("@/hooks/useLiveBootstrapRetry").LiveBootstrapView | null,
    confirm: vi.fn(), stop: vi.fn(), cancelForStop: vi.fn() },
}))
vi.mock("zustand/react/shallow", () => ({ useShallow: <T,>(selector: T) => selector }))
vi.mock("@shared/store/appStore", async () => {
  const React = await import("react")
  const useAppStore = Object.assign(
    <T,>(selector: (state: State) => T) =>
      React.useSyncExternalStore(
        (listener) => (runtime.listeners.add(listener), () => runtime.listeners.delete(listener)),
        () => selector(runtime.state),
        () => selector(runtime.state),
      ),
    { getState: () => runtime.state, setState: (update: (state: State) => Partial<State>) => { Object.assign(runtime.state, update(runtime.state)); notify() } },
  )
  return { useAppStore, selectChildren: () => (state: State) => state.childProgress }
})
vi.mock("@shared/store/appStore/state", () => ({
  appStore: {
    getState: () => runtime.state,
    subscribe: (listener: () => void) => {
      runtime.listeners.add(listener)
      return () => runtime.listeners.delete(listener)
    },
  },
}))
type ProviderState = typeof runtime.providerState
vi.mock("@shared/store/appStore/slices/providerSlice", () => ({ useProviderStore: <T,>(selector: (state: ProviderState) => T) => selector(runtime.providerState) }))
vi.mock("@/hooks/useLiveBootstrapRetry", () => ({ useLiveBootstrapRetry: () => runtime.liveRetry }))
vi.mock("@/hooks/useGuidanceQueue", () => ({ useGuidanceQueue: () => ({ mode: "after_round", setMode: vi.fn(), send: runtime.queueSend, cancel: vi.fn(), pending: [], error: null, busy: false, hasUnconfirmed: false }) }))
vi.mock("@/hooks/useTicketWork", () => ({ useTicketWork: () => runtime.ticketWork ?? {
  state: null, connected: false, negotiated: true, availability: { kind: "ready" }, refreshing: false, canRefresh: true, initializing: false, initializationError: null, canInitialize: false, initialize: async () => false, error: null, busy: {}, uncertain: {},
  canRespond: false, canSendIngress: false, respond: vi.fn(), refresh: vi.fn(),
} }))
vi.mock("@/hooks/useStickyScroll", () => ({
  useStickyScroll: () => ({
    scrollRef: { current: null }, contentRef: { current: null }, atBottom: runtime.stickyAtBottom,
    handleScroll: vi.fn(), scrollToBottom: runtime.scrollToBottom, pinToBottom: vi.fn(),
  }),
}))
vi.mock("@services/command/workflowCatalog", async (original) => ({
  ...await original<typeof import("@services/command/workflowCatalog")>(),
  getWorkflowCatalog: vi.fn().mockResolvedValue({ revision: 1, entries: [] }),
}))
vi.mock("@services/workspace", () => ({ workspaceService: { listWorkspaceFiles: vi.fn().mockResolvedValue([]) } }))
vi.mock("@services/project/ProjectService", () => ({ projectService: { getProject: runtime.getProject, bindWorkspace: runtime.bindWorkspace } }))
vi.mock("@services/workspace/WorktreeService", () => ({ worktreeService: { create: runtime.createWorktree } }))
vi.mock("@/components/app/NewChatWorktreeControl", () => ({
  NewChatWorktreeControl: (props: import("@services/workspace/newChatWorktreeTypes").NewChatWorktreeControlProps) => {
    runtime.worktreeControl = props
    return <div data-worktree-control>{props.error}</div>
  },
}))
vi.mock("@services/chat/AgentService", () => ({ isThinkingMode: (v: unknown) => v === "standard" || v === "ultra", agentClient: {
  patchSession: vi.fn().mockResolvedValue(undefined),
  getSession: vi.fn(),
  listSupervisorApprovals: vi.fn().mockResolvedValue([]),
  selectRootMode: vi.fn(),
  recoverRootMode: vi.fn(),
  compactSessionContext: vi.fn(),
  applySessionLoop: vi.fn(),
  resumeGoal: vi.fn(),
  sendMessage: vi.fn().mockImplementation(async (request) => ({ session_id: request.session_id, goal_command: { action: "set_prompt", should_execute: true } })),
  execute: vi.fn().mockResolvedValue(undefined),
} }))
vi.mock("@/lib/taskTemplates", () => ({ peekPendingTemplatePrompt: runtime.peekTemplate }))
vi.mock("@/lib/exportMarkdown", () => ({ downloadMarkdown: vi.fn() }))
vi.mock("@/lib/exportPdf", () => ({ downloadPdf: vi.fn() }))
vi.mock("@/components/chat/Dialogs", () => ({
  QuestionDialog: ({ q, onAnswer }: ComponentProps<(typeof import("@/components/chat/Dialogs"))["QuestionDialog"]>) =>
    <div data-parent-question>{q.question}<button onClick={() => onAnswer("main answer")}>Answer parent</button></div>,
  ChildApprovalCard: ({ a, onRespond, submitting, error }: ComponentProps<(typeof import("@/components/chat/Dialogs"))["ChildApprovalCard"]>) =>
    <div data-child-approval={a.childSessionId}>
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={submitting} onClick={() => onRespond(true)}>Approve child</button>
      <button disabled={submitting} onClick={() => onRespond(false)}>Deny child</button>
    </div>,
}))
vi.mock("@/components/app/ChatHeader", () => ({
  ChatHeader: ({ environment, supervisorControl, onOpenTaskDag }: {
    environment?: ReactNode
    supervisorControl?: ReactNode
    onOpenTaskDag?: () => void
  }) => <div>{environment}{supervisorControl}
    {onOpenTaskDag ? <button data-task-dag-shortcut onClick={onOpenTaskDag} /> : null}
  </div>,
}))
vi.mock("@/components/app/HomeDashboard", () => ({
  HomeDashboard: ({ onDescribeTask }: { onDescribeTask: () => void }) =>
    <button type="button" data-home-describe onClick={onDescribeTask}>Describe task</button>,
}))
vi.mock("@/components/app/MessageList", () => ({
  MessageList: (props: MessageListProps) => {
    runtime.messageList = props
    return <>{props.timelineAttachments?.map((entry) => <div key={entry.key}>{entry.node}</div>)}</>
  },
}))
vi.mock("@/components/app/Toasts", () => ({ Toasts: (props: ComponentProps<(typeof import("./Toasts"))["Toasts"]>) => { runtime.toastProps = props; return null } }))
vi.mock("@/components/app/ImageLightbox", () => ({
  ImageLightbox: ({ src }: { src: string | null }) =>
    src ? <div data-image-lightbox data-src={src} /> : null,
}))
vi.mock("@/components/app/ContextUsageRing", () => ({ ContextUsageRing: () => <span data-testid="context-usage" /> }))
vi.mock("@/components/chat/ModelEffortPicker", () => ({
  ModelEffortPicker: (props: ModelEffortPickerProps) => {
    runtime.modelPicker = {
      modelGroups: props.modelGroups, modelProvider: props.modelProvider, value: props.model, onChange: props.onModelChange,
      disabled: props.modelDisabled, menuPlacement: props.menuPlacement, menuAlign: props.menuAlign,
    }
    runtime.reasoningPicker = {
      value: props.value, onChange: props.onChange, disabled: props.disabled,
      allowUltra: props.allowUltra, thinkingMode: props.thinkingMode,
      menuPlacement: props.menuPlacement, menuAlign: props.menuAlign,
    }
    return <span data-testid="model-effort-picker" />
  },
}))
vi.mock("@/components/chat/PermissionModeControl", () => ({
  PermissionModeControl: () => <span data-testid="session-permission" />,
  NewSessionPermissionControl: () => <span data-testid="new-session-permission" />,
}))
vi.mock("@/components/app/Composer", () => ({
  Composer: (props: ComposerProps) => (runtime.composer = props,
    <div data-testid="composer-shell">
      <textarea ref={props.inputRef as React.Ref<HTMLTextAreaElement>} aria-label="消息" value={props.draft} onChange={(event) => props.onDraftChange(event.currentTarget.value)} />
      {props.permissionControl}
      {props.workspaceControl}
      {props.runtimeControls}
    </div>),
}))
import { agentClient } from "@services/chat/AgentService"
import { apiClient } from "@services/api"
import { ticketSnapshot } from "@services/tickets/testFixtures"
import { applyTicketSnapshot } from "@services/tickets/state"
import { ChatPane } from "./ChatPane"
const skill = (id: string): SkillDefinition => ({ id, name: id, description: id, prompt: id, tool_refs: [`tool-${id}`] })
const skillA = skill("skill-a")
const skillB = skill("skill-b")
const roots: Root[] = []
const rootFields = { root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64) }
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
function notify() { for (const listener of runtime.listeners) listener() }
function write(id: string, content: string) { runtime.state.setInputContent(id, content) }
function composer() { if (!runtime.composer) throw new Error("Composer did not render"); return runtime.composer }
function deferred<T>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function createChat(
  send: Send,
  id: string | null,
  lastRunStatus: string | null = null,
  lastRunError: string | null = null,
) {
  return {
    booted: true, chats: [], currentSessionId: id,
    currentChat: id
      ? { id, title: "Test", lastRunStatus, lastRunError, config: { workspacePath: "/session" } }
      : null,
    messages: [], streaming: "", streamPhase: null, streamingReasoning: "", liveSegments: [], streamStatus: null,
    pendingUserText: null, sending: false, submissionPending: false, sendFailure: null,
    pendingQuestion: null, pendingApproval: null, send,
    select: vi.fn(), stop: vi.fn(), newChat: vi.fn(),
    deleteMessage: vi.fn(), fork: vi.fn(), regenerate: vi.fn(), retry: vi.fn(),
    editMessage: vi.fn(), answerQuestion: vi.fn(), respondApproval: vi.fn(),
  } as unknown as ChatPaneProps["chat"]
}
async function mount(
  send: Send,
  id: string | null,
  running = false,
  streaming: string | null = id ? "" : null,
  lastRunStatus: string | null = null,
  compatibility?: ChatPaneProps["chat"]["executionCompatibility"],
) {
  const container = document.body.appendChild(document.createElement("div")); const root = createRoot(container); roots.push(root)
  await act(async () => {
    root.render(<ChatPane chat={{ ...createChat(send, id, lastRunStatus), sending: running, streaming, ...(compatibility ? { executionCompatibility: compatibility } : {}) }} pickedWorkspace="/picked"
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()}
      onOpenSidebar={vi.fn()} sidebarCollapsed={false} />)
  })
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea"); if (!textarea) throw new Error("textarea did not render")
  return textarea
}

function change(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  act(() => { setter?.call(textarea, value); textarea.dispatchEvent(new Event("input", { bubbles: true })) })
}
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
let mediaMatches = true
const mediaListeners = new Set<(event: MediaQueryListEvent) => void>()
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear(); runtime.ticketWork = null
  runtime.liveRetry.prepareInitial.mockReset().mockReturnValue(false)
  runtime.liveRetry.confirm.mockReset(); runtime.liveRetry.stop.mockReset(); runtime.liveRetry.cancelForStop.mockReset()
  runtime.liveRetry.offer = null
  vi.mocked(agentClient.getSession).mockReset().mockImplementation(async (sessionId) => ({
    session: { ...rootFields, id: sessionId, kind: "root", root_orchestration_only: false, thinking_mode: "standard" },
  }) as Awaited<ReturnType<typeof agentClient.getSession>>)
  vi.mocked(agentClient.selectRootMode).mockReset().mockImplementation(async (_id, operation) => ({
    status: "committed", operation_id: operation.operationId, expected_epoch: operation.expectedEpoch,
    resulting_epoch: operation.expectedEpoch + 1, enabled_at_completion: operation.enabled,
    thinking_mode_at_completion: operation.enabled ? "ultra" : "standard", root_tool_authority_revision: 1,
  }))
  vi.mocked(agentClient.recoverRootMode).mockReset().mockRejectedValue(new Error("recovery unavailable"))
  vi.mocked(agentClient.sendMessage).mockReset().mockImplementation(async (request) => ({
    session_id: request.session_id, goal_command: { action: "set_prompt", should_execute: true },
  }) as Awaited<ReturnType<typeof agentClient.sendMessage>>)
  vi.mocked(agentClient.compactSessionContext).mockReset().mockImplementation(async (session_id) => ({
    session_id, status: "unchanged",
  }))
  vi.mocked(agentClient.applySessionLoop).mockReset().mockImplementation(async (session_id) => ({
    session_id, loop: null,
  }))
  vi.mocked(agentClient.execute).mockReset().mockResolvedValue({ session_id: "root-session", status: "started", events_url: "" })
  runtime.queueSend.mockClear()
  runtime.queueSend.mockResolvedValue({ kind: "accepted", operationId: 0, sessionId: "queue-chat", navigated: false })
  mediaMatches = true; mediaListeners.clear()
  runtime.stickyAtBottom = true; runtime.scrollToBottom.mockReset()
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: mediaMatches,
    addEventListener: (_name: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.add(listener),
    removeEventListener: (_name: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.delete(listener),
  })))
  runtime.composer = null; runtime.messageList = null; runtime.modelPicker = null; runtime.reasoningPicker = null
  runtime.providerState.providerStatus = "ready"
  runtime.providerState.providerSnapshot = {
    default_provider_instance_id: "easycli",
    instances: [{ id: "easycli", type: "openai", label: "Easycli", enabled: true,
      config: { runtime_models: ["test-model", "gpt-6-sol", "grok-4.7"] } }],
    defaults: { chat: { provider: "easycli", model: "test-model" } },
  }
  runtime.listeners.clear(); runtime.revision = 0
  runtime.worktreeControl = null
  runtime.getProject.mockReset().mockResolvedValue({ id: "p1", status: "active", revision: 1, project_path: "/repo" })
  runtime.createWorktree.mockReset().mockResolvedValue({ path: "/trees/task" })
  runtime.bindWorkspace.mockReset().mockImplementation(async (_id, revision, request) => ({
    id: "p1", status: "active", revision: revision + 1, project_path: "/repo", workspace_bindings: [{ path: request.path }],
  }))
  runtime.state = {
    bindWorkspace: runtime.bindWorkspace,
    currentSessionId: null, projects: { p1: { project_path: "/repo", name: "Project one" }, p2: { project_path: "/other", name: "Project two" } },
    chats: [], getInputState: (id) => runtime.state.inputStates[id] ?? { content: "", contentRevision: 0 },
    setInputThinkingMode: (id, thinkingMode) => { runtime.state.inputStates = { ...runtime.state.inputStates, [id]: { ...runtime.state.getInputState(id), thinkingMode, thinkingModeRevision: ++runtime.revision } }; notify(); return true },
    tokenUsages: {}, inputStates: {}, skills: [skillA, skillB], childProgress: {}, models: [],
    selectedModel: { provider: "easycli", model: "test-model" },
    refreshChatsNow: vi.fn().mockResolvedValue(undefined),
    loadChatHistory: vi.fn().mockResolvedValue(undefined),
    taskLists: {},
    loadTaskList: vi.fn().mockResolvedValue(null),
    updateTokenUsage: vi.fn(), setTruncationInfo: vi.fn(),
    changeSessionReasoningEffort: vi.fn().mockResolvedValue(undefined),
    changeSessionModel: vi.fn().mockResolvedValue(undefined),
    setSelectedModel: (model) => { runtime.state.selectedModel = model; notify() },
    setInputReasoningEffort: (id, reasoningEffort) => {
      const previous = runtime.state.inputStates[id] ?? { content: "", contentRevision: 0 }
      runtime.state.inputStates = {
        ...runtime.state.inputStates,
        [id]: { ...previous, reasoningEffort },
      }
      notify()
    },
    clearInputReasoningEffort: (id) => {
      const current = runtime.state.inputStates[id]
      if (!current) return
      const { reasoningEffort: _reasoningEffort, ...rest } = current
      runtime.state.inputStates = { ...runtime.state.inputStates, [id]: rest }
      notify()
    },
    clearInputThinkingModeIfRevision: (id, revision) => {
      const current = runtime.state.inputStates[id]
      if (!current || current.thinkingModeRevision !== revision || current.thinkingMode === undefined) return false
      const { thinkingMode: _mode, ...rest } = current
      runtime.state.inputStates = { ...runtime.state.inputStates, [id]: rest }
      notify(); return true
    },
    setInputContent: (id, content) => {
      const previous = runtime.state.inputStates[id] ?? { content: "", contentRevision: 0 }
      runtime.state.inputStates = { ...runtime.state.inputStates, [id]: {
        ...previous, content, contentRevision: ++runtime.revision,
      } }
      notify()
    },
    setInputContentIfRevision: (id, revision, content) => {
      const current = runtime.state.inputStates[id]
      if ((current?.contentRevision ?? 0) !== revision) return false
      write(id, content); return true
    },
    moveInputContentIfRevision: (source, revision, target) => {
      const current = runtime.state.inputStates[source]
      if ((current?.contentRevision ?? 0) !== revision || runtime.state.inputStates[target]?.content)
        return false
      write(target, current?.content ?? ""); write(source, ""); return true
    },
  }
  runtime.peekTemplate.mockReset().mockReturnValue(null)
})
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })

describe("ChatPane composer acknowledgement", () => {
  it("opens the floating Supervisor overview in the header and keeps Work details in its existing target", async () => {
    const value = ticketSnapshot()
    value.scope.binding.supervisor_session_id = "bamboo-default-supervisor"
    runtime.ticketWork = { state: applyTicketSnapshot(null, value), connected: true, negotiated: true, availability: { kind: "ready" }, refreshing: false, canRefresh: true, initializing: false, initializationError: null, canInitialize: false, initialize: async () => false,
      error: null, busy: {}, uncertain: {}, respond: async () => false, refresh: async () => {}, canRespond: true, canSendIngress: true }
    const host = document.body.appendChild(document.createElement("div"))
    const target = document.body.appendChild(document.createElement("div"))
    const root = createRoot(host); roots.push(root)
    const onOpen = vi.fn(), onReference = vi.fn()
    await act(async () => root.render(<ChatPane chat={createChat(vi.fn<Send>(), "bamboo-default-supervisor")}
      pickedWorkspace={null} onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()}
      onOpenSidebar={vi.fn()} sidebarCollapsed={false}
      workPanelTarget={target} onOpenWork={onOpen} onWorkReference={onReference} />))
    await act(async () => { await vi.dynamicImportSettled() })
    expect(host.querySelector('[data-testid="ticket-work-overview"]')).toBeNull()
    expect(target.querySelector('[data-testid="ticket-work-overview"]')).not.toBeNull()
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="ticket-work-status"]')!.click())
    expect(onOpen).not.toHaveBeenCalled()
    const all = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "查看全部工作")!
    act(() => all.click())
    expect(onOpen).toHaveBeenCalledOnce()
    const field = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="消息"]')!
    field.focus()
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
    expect(document.activeElement).toBe(field)
    const reference = [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "在普通输入中引用此请求")!
    act(() => reference.click())
    expect(onReference).toHaveBeenCalledOnce()
    expect(host.querySelector('[data-testid="ticket-reference"]')?.textContent).toContain("报告A")
  })
  it.each(["ready", "new pointer intent", "session navigation", "hidden page"] as const)("waits for a lazy Work target and respects %s", async (outcome) => {
    const value = ticketSnapshot()
    const supervisor = "bamboo-default-supervisor"
    value.scope.binding.supervisor_session_id = supervisor
    runtime.ticketWork = { state: applyTicketSnapshot(null, value), connected: true, negotiated: true,
      availability: { kind: "ready" }, refreshing: false, canRefresh: true, initializing: false,
      initializationError: null, canInitialize: false, initialize: async () => false,
      error: null, busy: {}, uncertain: {}, respond: async () => false, refresh: async () => {}, canRespond: true, canSendIngress: true }
    let nextFrame = 0
    const frames = new Map<number, FrameRequestCallback>()
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame })
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id))
    const flushFrame = () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)) })
    const host = document.body.appendChild(document.createElement("div"))
    const target = document.body.appendChild(document.createElement("div"))
    const root = createRoot(host); roots.push(root)
    const render = (panel: HTMLElement | null, sessionId = supervisor, pageVisible = true) => act(() => root.render(
      <ChatPane chat={createChat(vi.fn<Send>(), sessionId)} pickedWorkspace={null}
        onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()}
        onOpenSidebar={vi.fn()} sidebarCollapsed={false}
        workPanelTarget={panel} onOpenWork={vi.fn()} pageVisible={pageVisible} />))
    render(null)
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="ticket-work-status"]')!.click())
    const all = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "查看全部工作")!
    act(() => all.click())
    flushFrame() // The import has not resolved in the first frame.
    if (outcome === "new pointer intent") act(() => document.dispatchEvent(new Event("pointerdown", { bubbles: true })))
    if (outcome === "session navigation") render(null, "another-session")
    if (outcome === "hidden page") render(null, supervisor, false)
    render(target, supervisor, outcome !== "hidden page")
    await act(async () => { await vi.dynamicImportSettled() })
    flushFrame()
    const overview = target.querySelector<HTMLElement>('[data-testid="ticket-work-overview"]')!
    expect(overview).not.toBeNull()
    expect(document.activeElement === overview).toBe(outcome === "ready")
  })
  it.each([
    ["ordinary titled Supervisor", "ordinary-root", "root", undefined],
    ["builtin ID marked child", "bamboo-default-supervisor", "child", undefined],
    ["builtin ID with a parent", "bamboo-default-supervisor", "root", "parent"],
  ] as const)("does not offer Supervisor overview for %s even if a scope binds to it", async (_name, id, kind, parent) => {
    const value = ticketSnapshot(); value.scope.binding.supervisor_session_id = id
    runtime.ticketWork = { state: applyTicketSnapshot(null, value), connected: true, negotiated: true, availability: { kind: "ready" }, refreshing: false, canRefresh: true, initializing: false, initializationError: null, canInitialize: false, initialize: async () => false,
      error: null, busy: {}, uncertain: {}, respond: async () => false, refresh: async () => {}, canRespond: true, canSendIngress: true }
    const chat = createChat(vi.fn<Send>(), id)
    chat.currentChat!.title = "Supervisor"; chat.currentChat!.kind = kind; chat.currentChat!.parentSessionId = parent
    const host = document.body.appendChild(document.createElement("div"))
    const root = createRoot(host); roots.push(root)
    await act(async () => root.render(<ChatPane chat={chat} pickedWorkspace={null}
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()}
      onOpenSidebar={vi.fn()} sidebarCollapsed={false} onOpenWork={vi.fn()} />))
    expect(host.querySelector('[data-testid="ticket-work-status"]')).toBeNull()
  })
  it.each(["loading", "disabled", "uninitialized", "unbound", "unsupported", "forbidden", "error"] as const)("renders the %s Work fallback with an explicit status and recovery", async (kind) => {
    const refresh = vi.fn(async () => {})
    runtime.ticketWork = { state: null, connected: false, negotiated: kind !== "loading", error: "exact service reason",
      availability: { kind, detail: "exact service reason" }, refreshing: kind === "loading", canRefresh: true, initializing: false, initializationError: null, canInitialize: false, initialize: async () => false,
      busy: {}, uncertain: {}, respond: async () => false, refresh, canRespond: false, canSendIngress: false }
    const host = document.body.appendChild(document.createElement("div"))
    const target = document.body.appendChild(document.createElement("div"))
    const root = createRoot(host); roots.push(root)
    await act(async () => root.render(<ChatPane chat={createChat(vi.fn<Send>(), "bamboo-default-supervisor")}
      pickedWorkspace={null} onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()}
      onOpenSidebar={vi.fn()} sidebarCollapsed={false} workPanelTarget={target} />))
    expect(target.querySelector('[data-testid="ticket-work-availability"]')).not.toBeNull()
    expect(target.querySelector(kind === "error" || kind === "forbidden" ? '[role="alert"]' : '[role="status"]')).not.toBeNull()
    expect(target.textContent).toContain("exact service reason")
    expect(target.querySelector("details")!.open).toBe(false)
    if (kind !== "loading") {
      act(() => target.querySelector<HTMLButtonElement>("button")!.click())
      expect(refresh).toHaveBeenCalledOnce()
    } else expect(target.querySelector("button")).toBeNull()
    expect(target.textContent).not.toContain("当前 Supervisor 暂不支持工作面板")
  })
  it("holds the draft and does not choose legacy routing while a running Supervisor negotiates tickets", async () => {
    runtime.ticketWork = { state: null, connected: false, negotiated: false, availability: { kind: "loading" }, refreshing: false, canRefresh: true, initializing: false, initializationError: null, canInitialize: false, initialize: async () => false, error: null,
      busy: {}, uncertain: {}, respond: async () => false, refresh: async () => {}, canRespond: false, canSendIngress: false }
    const send = vi.fn<Send>()
    const textarea = await mount(send, "negotiating-root", true)
    change(textarea, "创建工作")
    await act(async () => composer().onSubmit())
    expect(send).not.toHaveBeenCalled()
    expect(runtime.queueSend).not.toHaveBeenCalled()
    expect(runtime.state.inputStates["negotiating-root"].content).toBe("创建工作")
  })
  it("keeps an unknown semantic delivery out of legacy routing during reload and replays through partial scope", async () => {
    const randomUUID = crypto.randomUUID.bind(crypto)
    vi.stubGlobal("crypto", { randomUUID, subtle: { digest: async (_algorithm: string, bytes: Uint8Array) => {
      const result = new Uint8Array(32); for (const [i, byte] of bytes.entries()) result[i % 32] ^= byte; return result.buffer
    } } })
    const id = "semantic-ui-root"
    const value = ticketSnapshot()
    value.scope.binding.supervisor_session_id = id
    const ready = (): TicketController => ({
      state: applyTicketSnapshot(null, value), connected: true, negotiated: true, availability: { kind: "ready" }, refreshing: false, canRefresh: true, initializing: false, initializationError: null, canInitialize: false, initialize: async () => false, error: null,
      busy: {}, uncertain: {}, respond: async () => false, refresh: async () => {},
      canRespond: value.complete, canSendIngress: true,
    })
    vi.mocked(agentClient.execute).mockResolvedValue({ session_id: id, status: "already_running", events_url: "/events" })
    runtime.ticketWork = ready()
    const post = vi.spyOn(apiClient, "postOnce").mockRejectedValueOnce(new Error("unknown Human acknowledgement"))
    const send = vi.fn<Send>()
    const textarea = await mount(send, id)
    change(textarea, "创建报告")
    await act(async () => composer().onSubmit())
    const original = post.mock.calls[0][1] as { session_id: string; message_id: string }
    expect(sessionStorage.getItem("lotus-next.ticket-human." + id)).not.toBeNull()
    act(() => roots.pop()!.unmount())
    runtime.ticketWork = null
    await mount(send, id, true)
    await act(async () => composer().onSubmit())
    expect(send).not.toHaveBeenCalled()
    expect(runtime.queueSend).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledTimes(1)
    value.complete = false
    runtime.ticketWork = ready()
    act(() => roots.pop()!.unmount())
    await mount(send, id, true)
    post.mockResolvedValueOnce({ session_id: id, message_id: original.message_id, ingress_seq: 1 })
    await act(async () => {
      composer().onSubmit()
      await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    })
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[1][1]).toEqual(original)
    expect(send).not.toHaveBeenCalled()
    expect(runtime.queueSend).not.toHaveBeenCalled()
    expect(sessionStorage.getItem("lotus-next.ticket-human." + id)).toBeNull()
  })
  it("does not submit a draft mode as existing-Root authority", async () => {
    runtime.state.inputStates["root-session"] = { content: "", contentRevision: 0, thinkingMode: "ultra", thinkingModeRevision: 9 }
    const send = vi.fn<Send>().mockResolvedValue({ kind: "accepted", operationId: 1, sessionId: "root-session", navigated: false })
    const textarea = await mount(send, "root-session")
    change(textarea, "existing Root")
    act(() => composer().onSubmit())
    await flush()
    expect(send).toHaveBeenCalledWith("existing Root", expect.objectContaining({ thinkingMode: undefined, rootOrchestrationOnly: undefined }))
  })

  it.each(["standard", "ultra"] as const)("captures draft mode %s and clears only its exact revision", async (thinkingMode) => {
    const ack = deferred<Awaited<ReturnType<Send>>>()
    const send = vi.fn<Send>().mockReturnValueOnce(ack.promise)
    runtime.state.inputStates[""] = { content: "", contentRevision: 0, thinkingMode, thinkingModeRevision: 11, reasoningEffort: "max" }
    runtime.state.inputStates.__new_chat_pane2__ = { content: "keep split", contentRevision: 1, thinkingMode: "ultra", thinkingModeRevision: 12 }
    const textarea = await mount(send, null)
    change(textarea, "new root")
    act(() => composer().onSubmit())
    expect(send).toHaveBeenCalledWith("new root", expect.objectContaining({ thinkingMode, rootOrchestrationOnly: thinkingMode === "ultra", reasoningSelection: "max" }))
    await act(async () => { ack.resolve({ kind: "accepted", operationId: 1, sessionId: "new-root", navigated: true }); await Promise.resolve() })
    expect(runtime.state.inputStates[""].thinkingMode).toBeUndefined()
    expect(runtime.state.inputStates.__new_chat_pane2__.thinkingMode).toBe("ultra")
    expect(runtime.state.inputStates["new-root"]).toBeUndefined()
  })

  it.each(["standard", "ultra"] as const)("preserves a newer %s choice across a late mode ACK", async (newMode) => {
    const ack = deferred<Awaited<ReturnType<Send>>>()
    const send = vi.fn<Send>().mockReturnValueOnce(ack.promise)
    runtime.state.inputStates[""] = { content: "", contentRevision: 0, thinkingMode: "ultra", thinkingModeRevision: 21 }
    const textarea = await mount(send, null)
    change(textarea, "submitted")
    act(() => composer().onSubmit())
    runtime.state.inputStates[""] = { ...runtime.state.inputStates[""], thinkingMode: newMode, thinkingModeRevision: 22 }
    change(textarea, "newer draft")
    await act(async () => { ack.resolve({ kind: "accepted", operationId: 1, sessionId: "new-root", navigated: true }); await Promise.resolve() })
    expect(runtime.state.inputStates[""].thinkingMode).toBe(newMode)
    expect(runtime.state.inputStates[""].thinkingModeRevision).toBe(22)
    expect(runtime.state.inputStates["new-root"]?.thinkingMode).toBeUndefined()
  })

  it("routes session controls through the composer instead of the header", async () => {
    runtime.state.models = ["test-model"]
    await mount(vi.fn<Send>(), "session-1")
    const composerShell = document.querySelector('[data-testid="composer-shell"]')

    expect(composerShell?.querySelector('[data-testid="session-permission"]')).not.toBeNull()
    expect(composerShell?.querySelector('[data-testid="model-effort-picker"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="new-session-permission"]')).toBeNull()
  })

  it("passes the transient output rate to the composer without adding a row above it", async () => {
    const chat = createChat(vi.fn<Send>(), "session-1")
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container); roots.push(root)
    const render = async (outputRate: number | null) => {
      await act(async () => root.render(<ChatPane chat={{ ...chat, outputRate }} pickedWorkspace="/picked"
        onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()}
        onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))
    }

    await render(null)
    const region = container.querySelector("[data-composer-region]")
    const precedingNode = region?.previousElementSibling
    expect(composer().outputRate).toBeNull()
    await render(18.3)
    expect(composer().outputRate).toBe(18.3)
    expect(container.querySelector("[data-composer-region]")).toBe(region)
    expect(region?.previousElementSibling).toBe(precedingNode)
    await render(null)
    expect(composer().outputRate).toBeNull()
    expect(container.querySelector("[data-composer-region]")).toBe(region)
    expect(region?.previousElementSibling).toBe(precedingNode)
  })

  it("shows an existing child session's model instead of the root Chat default", async () => {
    runtime.state.models = ["gpt-5.6-sol", "gpt-5.6-luna"]
    runtime.state.selectedModel = undefined
    runtime.providerState.providerSnapshot = {
      default_provider_instance_id: "easycli",
      instances: [{
        id: "easycli",
        type: "openai",
        label: "Easycli",
        enabled: true,
        config: { runtime_models: ["gpt-5.6-sol", "gpt-5.6-luna"] },
      }],
      defaults: {
        chat: { provider: "easycli", model: "gpt-5.6-sol" },
      },
      features: { provider_model_ref: true },
    }
    const chat = createChat(vi.fn<Send>(), "child-session")
    if (!chat.currentChat) throw new Error("child chat was not created")
    chat.currentChat.config.model = "gpt-5.6-luna"
    chat.currentChat.config.model_ref = { provider: "easycli", model: "gpt-5.6-luna" }
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container); roots.push(root)

    await act(async () => root.render(<ChatPane chat={chat} pickedWorkspace="/picked"
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()}
      onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))

    expect(runtime.modelPicker?.value).toBe("gpt-5.6-luna")
  })

  it("saves an idle session's provider switch even when the model name matches", async () => {
    const pending = deferred<void>()
    runtime.state.changeSessionModel = vi.fn().mockReturnValue(pending.promise)
    runtime.state.models = ["gpt-6-sol", "grok-4.7"]
    runtime.providerState.providerSnapshot = {
      default_provider_instance_id: "easycli",
      instances: [
        { id: "easycli", type: "openai", label: "Easycli", enabled: true, config: { runtime_models: ["gpt-6-sol"] } },
        { id: "other", type: "openai", label: "Other", enabled: true, config: { runtime_models: ["gpt-6-sol"] } },
      ],
      defaults: { chat: { provider: "easycli", model: "gpt-6-sol" } },
      features: { provider_model_ref: true },
    }
    await mount(vi.fn<Send>(), "session-1")
    expect(runtime.modelPicker?.value).toBe("gpt-6-sol")

    const next = { provider: "other", model: "gpt-6-sol" }
    act(() => runtime.modelPicker?.onChange(next))
    expect(runtime.state.changeSessionModel).toHaveBeenCalledExactlyOnceWith("session-1", next)
    expect(runtime.modelPicker?.value).toBe("gpt-6-sol")
    expect(runtime.modelPicker?.disabled).toBe(true)
    expect(composer().submissionPending).toBe(true)
    expect(runtime.state.selectedModel).toEqual({ provider: "easycli", model: "test-model" })

    await act(async () => { pending.resolve(); await pending.promise })
    expect(runtime.modelPicker?.disabled).toBe(false)
    expect(composer().submissionPending).toBe(false)
  })

  it("lists saved models from enabled providers and excludes historical ids", async () => {
    runtime.state.models = ["old-global", "other-only"]
    runtime.providerState.providerSnapshot = {
      default_provider_instance_id: "other",
      instances: [
        { id: "work", type: "openai", label: "Work", enabled: true, config: { runtime_models: ["newly-added", "vendor:custom-name"] } },
        { id: "other", type: "openai", label: "Other", enabled: true, config: { runtime_models: ["other-only"] } },
        { id: "off", type: "openai", label: "Disabled", enabled: false, config: { runtime_models: ["disabled-model"] } },
      ],
      defaults: { chat: { provider: "other", model: "other-only" } },
    }
    const chat = createChat(vi.fn<Send>(), "session-1")
    chat.currentChat!.config.model_ref = { provider: "work", model: "historical-removed" }
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container); roots.push(root)
    await act(async () => root.render(<ChatPane chat={chat} pickedWorkspace="/picked"
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()}
      onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))

    expect(runtime.modelPicker?.modelGroups).toEqual([
      { provider: "work", label: "Work", models: ["newly-added", "vendor:custom-name"] },
      { provider: "other", label: "Other", models: ["other-only"] },
    ])
    expect(runtime.modelPicker?.value).toBe("historical-removed")
    expect(runtime.modelPicker?.modelProvider).toBe("work")
  })

  it("shows the new Chat default after the selected provider is disabled", async () => {
    const snapshot = runtime.providerState.providerSnapshot!
    snapshot.instances.push({ id: "other", type: "openai", label: "Other", enabled: true, config: { runtime_models: ["other-default", "other-custom"] } })
    await mount(vi.fn<Send>(), null)
    expect(runtime.modelPicker?.value).toBe("test-model")
    snapshot.instances[0].enabled = false
    runtime.providerState.providerSnapshot = { ...snapshot, defaults: { chat: { provider: "other", model: "other-default" } } }
    await act(async () => roots.at(-1)!.render(<ChatPane chat={createChat(vi.fn<Send>(), null)} pickedWorkspace="/picked"
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()}
      onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))

    expect(runtime.state.selectedModel).toEqual({ provider: "easycli", model: "test-model" })
    expect(runtime.modelPicker?.modelGroups).toEqual([{ provider: "other", label: "Other", models: ["other-default", "other-custom"] }])
    expect(runtime.modelPicker?.value).toBe("other-default")
  })

  it("offers the first provider's saved admission before role defaults have been configured", async () => {
    runtime.providerState.providerSnapshot!.defaults = undefined
    runtime.providerState.providerSnapshot!.instances[0].config.model = "test-model"
    await mount(vi.fn<Send>(), null)
    expect(runtime.modelPicker?.modelGroups).toEqual([
      { provider: "easycli", label: "Easycli", models: ["test-model", "gpt-6-sol", "grok-4.7"] },
    ])
    expect(runtime.modelPicker?.value).toBe("test-model")
  })

  it.each(["empty", "unavailable"])("hides model options when provider admission is %s", async (mode) => {
    runtime.state.models = ["stale-global"]
    runtime.providerState.providerSnapshot!.instances[0].config.runtime_models = []
    if (mode === "unavailable") runtime.providerState.providerStatus = "unavailable"
    await mount(vi.fn<Send>(), null)
    expect(runtime.modelPicker?.modelGroups).toEqual([])
  })

  it("does not accept a model change during a live run", async () => {
    runtime.state.models = ["gpt-6-sol", "grok-4.7"]
    await mount(vi.fn<Send>(), "session-1", true)
    expect(runtime.modelPicker?.disabled).toBe(true)
    act(() => runtime.modelPicker?.onChange({ provider: "easycli", model: "grok-4.7" }))
    expect(runtime.state.changeSessionModel).not.toHaveBeenCalled()
    expect(runtime.state.selectedModel).toEqual({ provider: "easycli", model: "test-model" })
  })

  it("puts the next-session permission selector in a blank composer", async () => {
    await mount(vi.fn<Send>(), null)
    const composerShell = document.querySelector('[data-testid="composer-shell"]')

    expect(composerShell?.querySelector('[data-testid="new-session-permission"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="session-permission"]')).toBeNull()
  })

})
