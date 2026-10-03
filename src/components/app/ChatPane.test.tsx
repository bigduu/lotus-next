import { act, type ComponentProps, type ReactElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CommandItem } from "@services/command"
import type { SkillDefinition } from "@shared/types/skill"
import type { ProviderInstancesConfig } from "@shared/types/providerConfig"
import type { ReasoningEffort } from "@services/chat/AgentService"
import type { ReasoningEffortSelection } from "@shared/utils/reasoningEffort"

type ComposerProps = ComponentProps<(typeof import("./Composer"))["Composer"]>
type MessageListProps = ComponentProps<(typeof import("./MessageList"))["MessageList"]>
type ModelPickerProps = ComponentProps<
  (typeof import("@/components/chat/ModelPicker"))["ModelPicker"]
>
type ReasoningPickerProps = ComponentProps<
  (typeof import("@/components/chat/ReasoningPicker"))["ReasoningPicker"]
>
type ChatPaneProps = ComponentProps<(typeof import("./ChatPane"))["ChatPane"]>
type Send = ChatPaneProps["chat"]["send"]
type TicketController = ReturnType<(typeof import("@/hooks/useTicketWork"))["useTicketWork"]>
type WorkflowControlProps = ComponentProps<(typeof import("@/components/chat/WorkflowSelectionControl"))["WorkflowSelectionControl"]>
type State = {
  chats: { id: string; config: { reasoningEffort?: ReasoningEffort | null } }[]
  getInputState(id: string): State["inputStates"][string]
  setInputThinkingMode(id: string, mode: "standard" | "ultra"): boolean
  tokenUsages: Record<string, unknown>; inputStates: Record<string, { content: string; contentRevision: number; reasoningEffort?: ReasoningEffortSelection; thinkingMode?: "standard" | "ultra"; thinkingModeRevision?: number }>
  skills: SkillDefinition[]; childProgress: Record<string, unknown>; models: string[]; selectedModel: string | undefined
  setInputContent(id: string, content: string): void
  setInputContentIfRevision(id: string, revision: number, content: string): boolean
  moveInputContentIfRevision(source: string, revision: number, target: string): boolean
  setSelectedModel(model: string): void
  changeSessionModel(id: string, model: string): Promise<void>
  setInputReasoningEffort(id: string, effort: ReasoningEffortSelection): void
  clearInputReasoningEffort(id: string): void
  clearInputThinkingModeIfRevision(id: string, revision: number): boolean
  changeSessionReasoningEffort(id: string, effort: ReasoningEffort | null): Promise<void>
  refreshChatsNow(): Promise<void>
  loadChatHistory(id: string): Promise<void>
}
const runtime = vi.hoisted(() => ({
  state: {} as State, listeners: new Set<() => void>(), composer: null as ComposerProps | null,
  messageList: null as MessageListProps | null,
  modelPicker: null as ModelPickerProps | null,
  reasoningPicker: null as ReasoningPickerProps | null,
  providerState: { providerSnapshot: null as ProviderInstancesConfig | null },
  stickyAtBottom: true, scrollToBottom: vi.fn(),
  queueSend: vi.fn(), revision: 0, getWorkflow: vi.fn(), listCommands: vi.fn(), peekTemplate: vi.fn(),
  ticketWork: null as TicketController | null,
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
type ProviderState = typeof runtime.providerState
vi.mock("@shared/store/appStore/slices/providerSlice", () => ({ useProviderStore: <T,>(selector: (state: ProviderState) => T) => selector(runtime.providerState) }))
vi.mock("@/hooks/useGuidanceQueue", () => ({ useGuidanceQueue: () => ({ mode: "after_round", setMode: vi.fn(), send: runtime.queueSend, cancel: vi.fn(), pending: [], error: null, busy: false, hasUnconfirmed: false }) }))
vi.mock("@/hooks/useTicketWork", () => ({ useTicketWork: () => runtime.ticketWork ?? {
  state: null, connected: false, negotiated: true, error: null, busy: {}, uncertain: {},
  canRespond: false, canSendIngress: false, respond: vi.fn(), refresh: vi.fn(),
} }))
vi.mock("@/hooks/useStickyScroll", () => ({
  useStickyScroll: () => ({
    scrollRef: { current: null }, contentRef: { current: null }, atBottom: runtime.stickyAtBottom,
    handleScroll: vi.fn(), scrollToBottom: runtime.scrollToBottom, pinToBottom: vi.fn(),
  }),
}))
vi.mock("@services/command", () => ({ commandService: { listCommands: runtime.listCommands, getWorkflowCommand: runtime.getWorkflow } }))
vi.mock("@services/workspace", () => ({ workspaceService: { listWorkspaceFiles: vi.fn().mockResolvedValue([]) } }))
vi.mock("@services/chat/AgentService", () => ({ isThinkingMode: (v: unknown) => v === "standard" || v === "ultra", agentClient: {
  patchSession: vi.fn().mockResolvedValue(undefined),
  getSession: vi.fn(),
  selectRootMode: vi.fn(),
  recoverRootMode: vi.fn(),
  sendMessage: vi.fn().mockImplementation(async (request) => ({ session_id: request.session_id, goal_command: { action: "set_prompt", should_execute: true } })),
  execute: vi.fn().mockResolvedValue(undefined),
} }))
vi.mock("@/lib/taskTemplates", () => ({ peekPendingTemplatePrompt: runtime.peekTemplate }))
vi.mock("@/lib/exportMarkdown", () => ({ downloadMarkdown: vi.fn() }))
vi.mock("@/lib/exportPdf", () => ({ downloadPdf: vi.fn() }))
vi.mock("@/components/chat/Dialogs", () => ({ QuestionDialog: () => null, ApprovalDialog: () => null }))
vi.mock("@/components/app/ChatHeader", () => ({
  ChatHeader: ({ environment }: { environment?: ReactNode }) => <div>{environment}</div>,
}))
vi.mock("@/components/app/HomeDashboard", () => ({ HomeDashboard: () => null }))
vi.mock("@/components/app/MessageList", () => ({
  MessageList: (props: MessageListProps) => {
    runtime.messageList = props
    return null
  },
}))
vi.mock("@/components/app/Toasts", () => ({ Toasts: () => null }))
vi.mock("@/components/app/ImageLightbox", () => ({
  ImageLightbox: ({ src }: { src: string | null }) =>
    src ? <div data-image-lightbox data-src={src} /> : null,
}))
vi.mock("@/components/app/ContextUsageRing", () => ({ ContextUsageRing: () => <span data-testid="context-usage" /> }))
vi.mock("@/components/chat/ReasoningPicker", () => ({ reasoningEffortLabel: (value: string) => value, ReasoningPicker: (props: ReasoningPickerProps) => (runtime.reasoningPicker = props, <span data-testid="reasoning-picker" />) }))
vi.mock("@/components/chat/ModelPicker", () => ({
  ModelPicker: (props: ModelPickerProps) => {
    runtime.modelPicker = props
    return <span data-testid="model-picker" />
  },
}))
vi.mock("@/components/chat/PermissionModeControl", () => ({
  PermissionModeControl: () => <span data-testid="session-permission" />,
  NewSessionPermissionControl: () => <span data-testid="new-session-permission" />,
}))
vi.mock("@/components/app/Composer", () => ({
  Composer: (props: ComposerProps) => (runtime.composer = props,
    <div data-testid="composer-shell">
      <textarea ref={props.inputRef} aria-label="消息" value={props.draft} onChange={(event) => props.onDraftChange(event.currentTarget.value)} />
      {props.permissionControl}
      {props.runtimeControls}
    </div>),
}))
import { agentClient } from "@services/chat/AgentService"
import { beginRootModeOperation, getRootModeFenceState } from "@/lib/rootModeTransitionFence"
import { ApiError, RequestTimeoutError } from "@services/api/errors"
import { apiClient } from "@services/api"
import { ticketSnapshot } from "@services/tickets/testFixtures"
import { applyTicketSnapshot } from "@services/tickets/state"
import { ChatPane } from "./ChatPane"
import { isSessionUnread, useSessionReadState } from "@/lib/sessionReadState"
const skill = (id: string): SkillDefinition => ({ id, name: id, description: id, prompt: id, tool_refs: [`tool-${id}`] })
const workflow = (id: string): CommandItem => ({ id, name: id, display_name: id, description: id, type: "workflow", metadata: null })
const skillA = skill("skill-a")
const skillB = skill("skill-b")
const workflowA = workflow("workflow-a")
const workflowB = workflow("workflow-b")
const roots: Root[] = []
const rootFields = { root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64) }
const beginRootModeTransition = (id: string, enabled: boolean) => beginRootModeOperation(id, 0, rootFields.root_mode_birth_token, enabled)
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
function notify() { for (const listener of runtime.listeners) listener() }
function write(id: string, content: string) { runtime.state.setInputContent(id, content) }
function composer() { if (!runtime.composer) throw new Error("Composer did not render"); return runtime.composer }
function workflowControl() { return (composer().workflowControl as ReactElement<WorkflowControlProps>).props }
async function openWorkflowCatalog() {
  expect(composer().workflowControl).toBeNull()
  await act(async () => composer().onPickCatalog?.())
  expect(composer().workflowControl).not.toBeNull()
}
const typedEntry: import("@services/command/workflowCatalog").WorkflowCatalogEntry = {
  id: "review-exact", name: "Review", description: "Review", kind: "instruction", source: "workspace", revision: 9,
  winner: true, status: "valid", invocation_policy: { explicit: true }, argument_schema: { type: "object", required: ["target"], properties: { target: { type: "string" } } },
}
function thinkingPicker() {
  if (!runtime.reasoningPicker) throw new Error("Thinking picker did not render")
  return {
    checked: runtime.reasoningPicker.thinkingMode === "ultra",
    disabled: runtime.reasoningPicker.disabled,
    click: () => runtime.reasoningPicker?.onChange(runtime.reasoningPicker.thinkingMode === "ultra" ? "auto" : "ultra"),
  }
}
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
) {
  const container = document.body.appendChild(document.createElement("div")); const root = createRoot(container); roots.push(root)
  await act(async () => {
    root.render(<ChatPane chat={{ ...createChat(send, id, lastRunStatus), sending: running, streaming }} pickedWorkspace="/picked"
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
      onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />)
  })
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea"); if (!textarea) throw new Error("textarea did not render")
  return textarea
}
function change(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  act(() => { setter?.call(textarea, value); textarea.dispatchEvent(new Event("input", { bubbles: true })) })
}
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
async function pickWorkflow(command: CommandItem) { await act(async () => { composer().onPickWorkflow(command); await Promise.resolve() }) }
async function addImage(name: string) {
  const readComplete = deferred<void>()
  const nativeReadAsDataUrl = FileReader.prototype.readAsDataURL
  const readSpy = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader, blob: Blob) {
    this.addEventListener("loadend", () => readComplete.resolve(), { once: true })
    nativeReadAsDataUrl.call(this, blob)
  })
  try {
    await act(async () => {
      composer().onAddFiles([new File([name], name, { type: "image/png" })])
      await readComplete.promise
    })
  } finally {
    readSpy.mockRestore()
  }
  await vi.waitFor(
    () => expect(composer().attachments.some((attachment) => attachment.name === name)).toBe(true),
    { timeout: 1_000 },
  )
}
async function fill(textarea: HTMLTextAreaElement) {
  act(() => composer().onPickSkill(skillA)); await pickWorkflow(workflowA); await addImage("before.png"); change(textarea, "original request")
}
let mediaMatches = true
const mediaListeners = new Set<(event: MediaQueryListEvent) => void>()
function resizePane(wide: boolean) {
  act(() => {
    mediaMatches = wide
    for (const listener of mediaListeners) listener({ matches: wide } as MediaQueryListEvent)
  })
}
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear(); runtime.ticketWork = null
  rootFields.root_mode_transition_epoch = 0
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
  runtime.providerState.providerSnapshot = null
  runtime.listeners.clear(); runtime.revision = 0
  runtime.state = {
    chats: [], getInputState: (id) => runtime.state.inputStates[id] ?? { content: "", contentRevision: 0 },
    setInputThinkingMode: (id, thinkingMode) => { runtime.state.inputStates = { ...runtime.state.inputStates, [id]: { ...runtime.state.getInputState(id), thinkingMode, thinkingModeRevision: ++runtime.revision } }; notify(); return true },
    tokenUsages: {}, inputStates: {}, skills: [skillA, skillB], childProgress: {}, models: [],
    selectedModel: "test-model",
    refreshChatsNow: vi.fn().mockResolvedValue(undefined),
    loadChatHistory: vi.fn().mockResolvedValue(undefined),
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
  runtime.getWorkflow.mockReset().mockImplementation((name: string) => Promise.resolve({ name, content: `${name} body`, type: "workflow" }))
  runtime.listCommands.mockReset().mockResolvedValue({ commands: [], total: 0 }); runtime.peekTemplate.mockReset().mockReturnValue(null)
})
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })
describe("ChatPane composer acknowledgement", () => {
  it("holds the draft and does not choose legacy routing while a running Supervisor negotiates tickets", async () => {
    runtime.ticketWork = { state: null, connected: false, negotiated: false, error: null,
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
      state: applyTicketSnapshot(null, value), connected: true, negotiated: true, error: null,
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
    expect(composerShell?.querySelector('[data-testid="reasoning-picker"]')).not.toBeNull()
    expect(composerShell?.querySelector('[data-testid="model-picker"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="new-session-permission"]')).toBeNull()
  })

  it("passes the transient output rate to the composer without adding a row above it", async () => {
    const chat = createChat(vi.fn<Send>(), "session-1")
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container); roots.push(root)
    const render = async (outputRate: number | null) => {
      await act(async () => root.render(<ChatPane chat={{ ...chat, outputRate }} pickedWorkspace="/picked"
        onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
        onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))
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
        config: {},
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
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
      onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))

    expect(runtime.modelPicker?.value).toBe("gpt-5.6-luna")
  })

  it("saves an idle session's model before showing the new selection", async () => {
    const pending = deferred<void>()
    runtime.state.changeSessionModel = vi.fn().mockReturnValue(pending.promise)
    runtime.state.models = ["gpt-6-sol", "grok-4.7"]
    runtime.providerState.providerSnapshot = {
      default_provider_instance_id: "easycli",
      instances: [{ id: "easycli", type: "openai", label: "Easycli", enabled: true, config: {} }],
      defaults: { chat: { provider: "easycli", model: "gpt-6-sol" } },
      features: { provider_model_ref: true },
    }
    await mount(vi.fn<Send>(), "session-1")
    expect(runtime.modelPicker?.value).toBe("gpt-6-sol")

    act(() => runtime.modelPicker?.onChange("grok-4.7"))
    expect(runtime.state.changeSessionModel).toHaveBeenCalledExactlyOnceWith("session-1", "grok-4.7")
    expect(runtime.modelPicker?.value).toBe("gpt-6-sol")
    expect(runtime.modelPicker?.disabled).toBe(true)
    expect(composer().submissionPending).toBe(true)
    expect(runtime.state.selectedModel).toBe("test-model")

    await act(async () => { pending.resolve(); await pending.promise })
    expect(runtime.modelPicker?.disabled).toBe(false)
    expect(composer().submissionPending).toBe(false)
  })

  it("does not accept a model change during a live run", async () => {
    runtime.state.models = ["gpt-6-sol", "grok-4.7"]
    await mount(vi.fn<Send>(), "session-1", true)
    expect(runtime.modelPicker?.disabled).toBe(true)
    act(() => runtime.modelPicker?.onChange("grok-4.7"))
    expect(runtime.state.changeSessionModel).not.toHaveBeenCalled()
    expect(runtime.state.selectedModel).toBe("test-model")
  })

  it("puts the next-session permission selector in a blank composer", async () => {
    await mount(vi.fn<Send>(), null)
    const composerShell = document.querySelector('[data-testid="composer-shell"]')

    expect(composerShell?.querySelector('[data-testid="new-session-permission"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="session-permission"]')).toBeNull()
  })

  it.each([
    [undefined, "auto"],
    ["max", "max"],
    ["none", "none"],
  ] as const)(
    "keeps a new composer aligned with the Chat setting %s",
    async (configuredEffort, expectedSelection) => {
      runtime.providerState.providerSnapshot = {
        default_provider_instance_id: "easycli",
        instances: [
          {
            id: "easycli",
            type: "openai",
            label: "Easycli",
            enabled: true,
            config: {},
          },
        ],
        defaults: {
          chat: {
            provider: "easycli",
            model: "gpt-5.6-sol",
            ...(configuredEffort ? { reasoning_effort: configuredEffort } : {}),
          },
        },
      }

      const textarea = await mount(vi.fn<Send>(), null)
      expect(runtime.reasoningPicker?.value).toBe(expectedSelection)

      // Initializing a text draft must not manufacture the old hard-coded
      // medium override and shadow Provider Settings.
      change(textarea, "new session draft")
      expect(runtime.reasoningPicker?.value).toBe(expectedSelection)
    },
  )

  it("freezes the blank composer's picker value into the submission", async () => {
    const send = vi.fn<Send>().mockResolvedValue({
      kind: "accepted",
      operationId: 1,
      sessionId: "new-session",
      navigated: false,
    })
    const textarea = await mount(send, null)

    act(() => runtime.reasoningPicker?.onChange("none"))
    change(textarea, "new session with reasoning disabled")
    act(() => composer().onSubmit())
    await flush()

    expect(send).toHaveBeenCalledWith(
      "new session with reasoning disabled",
      expect.objectContaining({ reasoningSelection: "none" }),
    )
  })

  it("does not inherit a previous session's sending flag in a blank new chat", async () => {
    await mount(vi.fn<Send>(), null, true, null)
    expect(composer().sending).toBe(false)
  })

  it("keeps Stop available while the visible session owns the live stream", async () => {
    await mount(vi.fn<Send>(), "session-1", true, "")
    expect(composer().sending).toBe(true)
  })

  it("shows a persisted generation error after remount and keeps retry actionable", async () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container); roots.push(root)
    const retry = vi.fn().mockResolvedValue(undefined)
    const chat = {
      ...createChat(
        vi.fn<Send>(),
        "failed-session",
        "error",
        "Budget error: compression stream closed before response.completed",
      ),
      retry,
    }

    await act(async () => root.render(<ChatPane chat={chat} pickedWorkspace="/picked"
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
      onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))

    const alert = container.querySelector<HTMLElement>('[role="alert"]')
    expect(alert?.textContent).toContain("消息已发送，但生成中断")
    expect(alert?.textContent).toContain(
      "Budget error: compression stream closed before response.completed",
    )
    const retryButton = Array.from(alert?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent?.includes("重试生成"))
    expect(retryButton).toBeDefined()
    await act(async () => retryButton?.click())
    expect(retry).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledWith()
  })

  it.each([
    [
      "Stream timed out: phase=bootstrap, deadline_ms=120000, last_http_status=429, retry_delay_ms=60000",
      "模型服务正在限流",
      "提供商或代理返回了 429",
    ],
    [
      "Stream timed out: phase=bootstrap, deadline_ms=120000, last_semantic_ms_ago=never",
      "模型服务连接超时",
      "请检查提供商、代理和网络状态",
    ],
  ])("explains a persisted bootstrap failure while keeping diagnostics available", async (detail, title, action) => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container); roots.push(root)
    const chat = createChat(vi.fn<Send>(), "failed-session", "error", detail)

    await act(async () => root.render(<ChatPane chat={chat} pickedWorkspace="/picked"
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
      onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))

    const alert = container.querySelector<HTMLElement>('[role="alert"]')
    expect(alert?.textContent).toContain(title)
    expect(alert?.textContent).toContain(action)
    expect(alert?.querySelector("details")?.open).toBe(false)
    expect(alert?.querySelector("details")?.textContent).toContain(detail)
    expect(alert?.querySelector("summary")?.textContent).toBe("技术详情")
    expect(alert?.textContent).toContain("重试生成")
  })

  it("explains a live HTTP 429 generation failure", async () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container); roots.push(root)
    const chat = {
      ...createChat(vi.fn<Send>(), "failed-session"),
      sendFailure: {
        kind: "generation-failed" as const,
        operationId: 4,
        sessionId: "failed-session",
        message: "LLM error: HTTP 429: model_cooldown",
      },
    }

    await act(async () => root.render(<ChatPane chat={chat} pickedWorkspace="/picked"
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
      onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))

    const alert = container.querySelector<HTMLElement>('[role="alert"]')
    expect(alert?.textContent).toContain("模型服务正在限流")
    expect(alert?.textContent).toContain("请等待限流解除")
    expect(alert?.querySelector("details")?.textContent).toContain("HTTP 429")
  })

  it("shows the concrete submission error while preserving the draft", async () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container); roots.push(root)
    const chat = {
      ...createChat(vi.fn<Send>(), "missing-workspace"),
      sendFailure: {
        kind: "submission-unconfirmed" as const,
        operationId: 1,
        sessionId: "missing-workspace",
        message: "Project context error: workspace path does not exist",
      },
    }

    await act(async () => root.render(<ChatPane chat={chat} pickedWorkspace="/picked"
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
      onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))

    const alert = container.querySelector<HTMLElement>('[role="alert"]')
    expect(alert?.textContent).toContain("发送状态未确认，内容已保留")
    expect(alert?.textContent).toContain("Project context error: workspace path does not exist")
    expect(alert?.textContent).toContain("继续编辑")
  })

  it.each([
    ["completed", false, true],
    ["completed", true, false],
    ["cancelled", false, false],
    ["error", false, false],
    [null, false, false],
  ] as const)(
    "folds process only for a settled completed run (status=%s, running=%s)",
    async (lastRunStatus, running, expected) => {
      await mount(vi.fn<Send>(), "session-1", running, "", lastRunStatus)

      expect(runtime.messageList?.latestRunFinished).toBe(expected)
    },
  )

  it("preserves an exact raw draft, focus, and template ownership before ACK", async () => {
    const templatePrompt = Object.freeze({ prompt: "template prompt", revision: 7 })
    runtime.peekTemplate.mockReturnValue(templatePrompt)
    const send = vi.fn<Send>().mockResolvedValue({ kind: "unconfirmed", operationId: 1 })
    const textarea = await mount(send, null)
    change(textarea, "  exact raw draft  ")
    document.body.tabIndex = -1; document.body.focus(); act(() => composer().onSubmit()); await flush()
    expect(send).toHaveBeenCalledWith("  exact raw draft  ", {
      skillIds: undefined, images: undefined, workspacePath: "/picked", projectId: null, templatePrompt,
      permissionMode: "default", rootOrchestrationOnly: false,
    })
    expect(runtime.state.inputStates[""]?.content).toBe("  exact raw draft  "); expect(runtime.peekTemplate).toHaveBeenCalledTimes(1); expect(document.activeElement).toBe(textarea)
  })
  it("clears all unchanged fields only after a valid ACK", async () => {
    write("session-1", "")
    const send = vi.fn<Send>().mockResolvedValue({
      kind: "accepted", operationId: 2, sessionId: "session-1", navigated: false,
    })
    const textarea = await mount(send, "session-1")
    await fill(textarea); act(() => composer().onSubmit()); await flush()
    expect(send).toHaveBeenCalledWith("workflow-a body\n\noriginal request", {
      skillIds: ["skill-a"], images: [expect.objectContaining({ name: "before.png" })],
      workspacePath: "/picked", projectId: null, templatePrompt: null,
      permissionMode: undefined, rootOrchestrationOnly: undefined,
    })
    expect(runtime.state.inputStates["session-1"]?.content).toBe(""); expect(composer()).toMatchObject({ attachments: [], selectedSkill: null, selectedWorkflow: null })
  })
  it("keeps every field edited during ACK wait, including an external draft write", async () => {
    write("session-1", "")
    const ack = deferred<Awaited<ReturnType<Send>>>()
    const send = vi.fn<Send>().mockReturnValue(ack.promise)
    const textarea = await mount(send, "session-1")
    await fill(textarea); act(() => composer().onSubmit()); act(() => composer().onPickSkill(skillB))
    await pickWorkflow(workflowB); await addImage("after.png"); act(() => write("session-1", "external pane draft"))
    ack.resolve({ kind: "accepted", operationId: 3, sessionId: "session-1", navigated: false })
    await flush()
    expect(runtime.state.inputStates["session-1"]?.content).toBe("external pane draft")
    expect(composer().attachments.map((item) => item.name)).toEqual(["before.png", "after.png"])
    expect(composer().selectedSkill).toEqual(skillB); expect(composer().selectedWorkflow).toEqual({ name: "workflow-b", content: "workflow-b body" }); expect(send).toHaveBeenCalledTimes(1)
  })
  it("re-keys a newer new-chat draft after ACK without overwriting it", async () => {
    const ack = deferred<Awaited<ReturnType<Send>>>()
    const send = vi.fn<Send>().mockReturnValue(ack.promise)
    const textarea = await mount(send, null)
    change(textarea, "first request"); act(() => composer().onSubmit()); change(textarea, "second request")
    ack.resolve({ kind: "accepted", operationId: 4, sessionId: "created", navigated: true })
    await flush()
    expect(runtime.state.inputStates["created"]?.content).toBe("second request"); expect(runtime.state.inputStates[""]?.content).toBe("")
  })
})

describe("Root orchestration-only control", () => {
  it("sends an explicit creation choice from the new Root composer", async () => {
    const send = vi.fn<Send>().mockResolvedValue({ kind: "unconfirmed", operationId: 1 })
    const textarea = await mount(send, null)
    expect(thinkingPicker().checked).toBe(false)

    act(() => thinkingPicker().click())
    expect(thinkingPicker().checked).toBe(true)
    expect(document.querySelector('[role="status"]')?.textContent).toContain("下次创建时使用 Ultra 编排")
    change(textarea, "delegate this work")
    act(() => composer().onSubmit())
    await flush()

    expect(send).toHaveBeenCalledWith("delegate this work", expect.objectContaining({
      rootOrchestrationOnly: true,
    }))
  })

  it("reads the saved Root choice and omits it on an unchanged follow-up", async () => {
    vi.mocked(agentClient.getSession).mockImplementation(async (sessionId) => ({
      session: { ...rootFields, id: sessionId, kind: "root", root_orchestration_only: true, thinking_mode: "ultra" },
    }) as Awaited<ReturnType<typeof agentClient.getSession>>)
    const send = vi.fn<Send>().mockResolvedValue({
      kind: "accepted", operationId: 1, sessionId: "root-session", navigated: false,
    })
    const textarea = await mount(send, "root-session")
    expect(thinkingPicker().checked).toBe(true)
    expect(document.querySelector('[role="status"]')?.textContent).toContain("服务器已确认 Ultra 编排")

    change(textarea, "check progress")
    act(() => composer().onSubmit())
    await flush()
    expect(send).toHaveBeenCalledWith("check progress", expect.objectContaining({
      rootOrchestrationOnly: undefined,
    }))
    expect(agentClient.getSession).toHaveBeenCalledTimes(2)
  })

  it("switches an existing Root without chat and omits mode on the next message", async () => {
    let durable = true
    vi.mocked(agentClient.getSession).mockImplementation(async (sessionId) => ({
      session: { ...rootFields, root_mode_transition_epoch: durable ? 0 : 1, id: sessionId, kind: "root", root_orchestration_only: durable, thinking_mode: durable ? "ultra" : "standard" },
    }) as Awaited<ReturnType<typeof agentClient.getSession>>)
    vi.mocked(agentClient.selectRootMode).mockImplementationOnce(async (_id, operation) => {
      durable = false
      return { status: "committed", operation_id: operation.operationId, expected_epoch: 0,
        resulting_epoch: 1, enabled_at_completion: false, thinking_mode_at_completion: "standard", root_tool_authority_revision: 2 }
    })
    const send = vi.fn<Send>().mockResolvedValue({ kind: "accepted", operationId: 1, sessionId: "root-session", navigated: false })
    const textarea = await mount(send, "root-session")
    await act(async () => { thinkingPicker().click(); await Promise.resolve(); await Promise.resolve() })
    expect(thinkingPicker().checked).toBe(false)
    expect(document.querySelector('[role="status"]')?.textContent).toContain("服务器已确认普通模式")
    expect(send).not.toHaveBeenCalled()
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()

    change(textarea, "continue directly")
    act(() => composer().onSubmit())
    await flush()
    expect(send).toHaveBeenCalledWith("continue directly", expect.objectContaining({
      rootOrchestrationOnly: undefined,
    }))
    expect(document.querySelector('[role="status"]')?.textContent).toContain("服务器已确认普通模式")
  })

  it("keeps a timed-out mode-only operation fenced after a late commit and reload", async () => {
    let durable = true
    vi.mocked(agentClient.getSession).mockImplementation(async (sessionId) => ({
      session: { ...rootFields, id: sessionId, kind: "root", root_orchestration_only: durable, thinking_mode: durable ? "ultra" : "standard" },
    }) as Awaited<ReturnType<typeof agentClient.getSession>>)
    vi.mocked(agentClient.selectRootMode).mockRejectedValueOnce(new RequestTimeoutError())
    const send = vi.fn<Send>()
    const textarea = await mount(send, "root-session")
    await act(async () => { thinkingPicker().click(); await Promise.resolve(); await Promise.resolve() })
    change(textarea, "disable mode")
    act(() => composer().onSubmit())
    await flush()
    expect(agentClient.getSession).toHaveBeenCalledTimes(1)
    expect(getRootModeFenceState("root-session")).toBe("uncertain")
    expect(document.querySelector('[role="status"]')?.textContent).toContain("权限结果未知")
    expect(document.body.textContent).not.toContain("服务器已确认 Ultra 编排")
    expect(document.body.textContent).toContain("恢复切换")
    expect(thinkingPicker().disabled).toBe(true)

    act(() => roots.pop()?.unmount())
    document.body.replaceChildren()
    await mount(send, "root-session") // a reload can still read the old value
    expect(document.querySelector('[role="status"]')?.textContent).toContain("权限结果未知")
    expect(document.body.textContent).toContain("恢复切换")
    durable = false // the previously timed-out POST commits after that GET
    act(() => roots.pop()?.unmount())
    document.body.replaceChildren()
    const restored = await mount(send, "root-session")
    expect(document.querySelector('[role="status"]')?.textContent).toContain("权限结果未知")
    change(restored, "send with omitted mode")
    act(() => composer().onSubmit())
    expect(send).not.toHaveBeenCalled()
    expect(restored.value).toBe("send with omitted mode")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("处理模式切换")
  })

  it("blocks Goal and queued guidance on a fenced Session", async () => {
    expect(beginRootModeTransition("root-session", false)).not.toBeNull()
    const send = vi.fn<Send>()
    const textarea = await mount(send, "root-session", true)
    change(textarea, "/goal continue")
    act(() => composer().onSubmit())
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
    change(textarea, "queue more work")
    act(() => composer().onSubmit())
    expect(runtime.queueSend).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it("does not execute a Goal if another tab fences the Session before its ACK follow-up", async () => {
    const history = deferred<void>()
    runtime.state.loadChatHistory = vi.fn().mockReturnValue(history.promise)
    const textarea = await mount(vi.fn<Send>(), "root-session")
    change(textarea, "/goal complete later")
    act(() => composer().onSubmit())
    await flush()
    expect(agentClient.sendMessage).toHaveBeenCalledTimes(1)
    act(() => { expect(beginRootModeTransition("root-session", true)).not.toBeNull() })
    history.resolve()
    await flush()
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it("restores the durable choice after a Bamboo rejection and shows its cause", async () => {
    vi.mocked(agentClient.getSession).mockImplementation(async (sessionId) => ({
      session: { ...rootFields, id: sessionId, kind: "root", root_orchestration_only: true, thinking_mode: "ultra" },
    }) as Awaited<ReturnType<typeof agentClient.getSession>>)
    vi.mocked(agentClient.selectRootMode).mockRejectedValueOnce(new ApiError("incompatible", 409, "Conflict",
      JSON.stringify({ error: { code: "root_orchestration_incompatible_mode" } })))
    vi.mocked(agentClient.recoverRootMode).mockImplementationOnce(async (_id, operation) => {
      rootFields.root_mode_transition_epoch = operation.expectedEpoch + 1
      return { status: "rejected_incompatible", operation_id: operation.operationId, expected_epoch: operation.expectedEpoch,
        resulting_epoch: operation.expectedEpoch + 1, enabled_at_completion: true, thinking_mode_at_completion: "ultra", root_tool_authority_revision: 1 }
    })
    const send = vi.fn<Send>()
    await mount(send, "root-session")
    await act(async () => { thinkingPicker().click(); await Promise.resolve(); await Promise.resolve() })

    expect(thinkingPicker().checked).toBe(true)
    expect(document.querySelector('[role="status"]')?.textContent).toContain("服务器已确认 Ultra 编排")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("不兼容")
    expect(send).not.toHaveBeenCalled()
  })

  it("does not call a Skill conflict an attempted Root mode switch", async () => {
    const chat = {
      ...createChat(vi.fn<Send>(), "root-session"),
      sendFailure: {
        kind: "submission-unconfirmed", operationId: 1, sessionId: "root-session",
        rejectionCode: "root_orchestration_incompatible_mode",
        rootModeSelectionSubmitted: false,
        message: "Selected Skill conflicts with active Root mode",
      },
    } as ChatPaneProps["chat"]
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container); roots.push(root)
    await act(async () => root.render(<ChatPane chat={chat} pickedWorkspace="/picked"
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
      onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))
    expect(document.body.textContent).toContain("Bamboo 已拒绝此请求，内容已保留")
    expect(document.body.textContent).not.toContain("Bamboo 已拒绝此模式切换")
    expect(document.body.textContent).toContain("Selected Skill conflicts with active Root mode")
  })

  it("keeps Child mode read-only and never loads Root authority for it", async () => {
    const send = vi.fn<Send>().mockResolvedValue({ kind: "unconfirmed", operationId: 1 })
    const childChat = createChat(send, "child-session")
    if (!childChat.currentChat) throw new Error("child chat was not created")
    childChat.currentChat.kind = "child"
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container); roots.push(root)
    await act(async () => root.render(<ChatPane chat={childChat} pickedWorkspace="/picked"
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
      onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))

    expect(runtime.reasoningPicker?.allowUltra).toBe(false)
    expect(document.body.textContent).not.toContain("Ultra 编排")
    expect(agentClient.getSession).not.toHaveBeenCalled()
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    if (!textarea) throw new Error("child composer did not render")
    change(textarea, "child progress")
    act(() => composer().onSubmit())
    await flush()
    expect(send).toHaveBeenCalledWith("child progress", expect.objectContaining({
      rootOrchestrationOnly: undefined,
    }))
  })

  it("treats a Child detail as read-only even before the list supplies kind", async () => {
    vi.mocked(agentClient.getSession).mockImplementation(async (sessionId) => ({
      session: { id: sessionId, kind: "child", root_orchestration_only: null },
    }) as Awaited<ReturnType<typeof agentClient.getSession>>)
    await mount(vi.fn<Send>(), "child-session")
    expect(runtime.reasoningPicker?.allowUltra).toBe(false)
    expect(document.body.textContent).not.toContain("Ultra 编排")
    expect(document.querySelector('[role="alert"]')?.textContent ?? "").not.toContain("无法确认 Root")
  })

  it("shows Child ordinary save failure without exposing a Root Ultra control", async () => {
    const child = createChat(vi.fn<Send>(), "child-session")
    child.currentChat!.kind = "child"
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container); roots.push(root)
    runtime.state.changeSessionReasoningEffort = vi.fn().mockRejectedValueOnce(new Error("Child save offline"))
    await act(async () => root.render(<ChatPane chat={child} pickedWorkspace="/picked"
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
      onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))
    await act(async () => { runtime.reasoningPicker?.onChange("low"); await Promise.resolve() })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Child save offline")
    expect(runtime.reasoningPicker?.allowUltra).toBe(false)
    expect(document.body.textContent).not.toContain("Ultra 编排")
    expect(agentClient.selectRootMode).not.toHaveBeenCalled()
  })

  it("warns that a selected Skill conflicts while keeping Bamboo as the admission authority", async () => {
    vi.mocked(agentClient.getSession).mockImplementation(async (sessionId) => ({
      session: { ...rootFields, id: sessionId, kind: "root", root_orchestration_only: true, thinking_mode: "ultra" },
    }) as Awaited<ReturnType<typeof agentClient.getSession>>)
    const send = vi.fn<Send>().mockResolvedValue({ kind: "unconfirmed", operationId: 1 })
    const textarea = await mount(send, "root-session")
    act(() => composer().onPickSkill(skillA))
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("已选 Skill 与 Ultra 编排不兼容")
    change(textarea, "use this skill")
    act(() => composer().onSubmit())
    await flush()
    expect(send).toHaveBeenCalledWith("use this skill", expect.objectContaining({
      skillIds: ["skill-a"], rootOrchestrationOnly: undefined,
    }))
  })

  it("does not describe an unchanged-mode Skill rejection as a mode switch", async () => {
    vi.mocked(agentClient.getSession).mockImplementation(async (sessionId) => ({
      session: { ...rootFields, id: sessionId, kind: "root", root_orchestration_only: true, thinking_mode: "ultra" },
    }) as Awaited<ReturnType<typeof agentClient.getSession>>)
    const send = vi.fn<Send>().mockResolvedValue({
      kind: "unconfirmed", operationId: 1, rejectionCode: "root_orchestration_incompatible_mode",
    })
    const textarea = await mount(send, "root-session")
    act(() => composer().onPickSkill(skillA))
    change(textarea, "apply skill")
    act(() => composer().onSubmit())
    await flush()
    expect(send).toHaveBeenCalledWith("apply skill", expect.objectContaining({ rootOrchestrationOnly: undefined }))
    expect(document.body.textContent).not.toContain("拒绝本次模式切换")
    expect(document.querySelector('[role="status"]')?.textContent).toContain("服务器已确认 Ultra 编排")
  })

  it("blocks a text-expanded Workflow while Root mode is selected", async () => {
    vi.mocked(agentClient.getSession).mockImplementation(async (sessionId) => ({
      session: { ...rootFields, id: sessionId, kind: "root", root_orchestration_only: true, thinking_mode: "ultra" },
    }) as Awaited<ReturnType<typeof agentClient.getSession>>)
    const send = vi.fn<Send>()
    const textarea = await mount(send, "root-session")
    await pickWorkflow(workflowA)
    change(textarea, "run workflow")
    act(() => composer().onSubmit())

    expect(send).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("在思考强度中选择普通档位")
    act(() => composer().onClearWorkflow())
    expect(document.querySelector('[role="alert"]')?.textContent ?? "").not.toContain("在思考强度中选择普通档位")
  })

  it("opens the directory only on demand and dismisses it without leaving an empty panel", async () => {
    const textarea = await mount(vi.fn<Send>(), "root-session")
    expect(composer().workflowControl).toBeNull()
    change(textarea, "/目录工作流")
    act(() => composer().onPickCatalog?.())
    expect(composer().workflowControl).not.toBeNull()
    expect(composer().draft).toBe("")
    act(() => workflowControl().onClose?.())
    expect(composer().workflowControl).toBeNull()
  })

  it.each(["root_orchestration_incompatible_mode", "workflow_revision_mismatch"])("sends typed Workflow to Bamboo and preserves draft, exact choice and durable Root on %s", async (code) => {
    vi.mocked(agentClient.getSession).mockImplementation(async (sessionId) => ({
      session: { ...rootFields, id: sessionId, kind: "root", root_orchestration_only: true, thinking_mode: "ultra" },
    }) as Awaited<ReturnType<typeof agentClient.getSession>>)
    const send = vi.fn<Send>().mockResolvedValue({ kind: "unconfirmed", operationId: 1,
      workflowError: { code, message: "Bamboo rejected exact selection" } })
    const textarea = await mount(send, "root-session")
    await openWorkflowCatalog()
    act(() => workflowControl().onChange({ entry: typedEntry, argsText: '{"target":"src"}' }))
    change(textarea, "keep original task")
    const reads = vi.mocked(agentClient.getSession).mock.calls.length
    act(() => composer().onSubmit()); await flush()
    expect(send).toHaveBeenCalledWith("keep original task", expect.objectContaining({
      workflowSelection: { id: "review-exact", source: "workspace", revision: 9, args: { target: "src" } }, rootOrchestrationOnly: undefined,
    }))
    expect(runtime.state.inputStates["root-session"]?.content).toBe("keep original task")
    expect(workflowControl().selected?.entry.revision).toBe(9)
    expect(workflowControl().error).toContain(code)
    expect(workflowControl().error).toContain(code === "root_orchestration_incompatible_mode" ? "所选工作流与 Ultra 编排不兼容" : "版本已变化")
    expect(vi.mocked(agentClient.getSession).mock.calls.length).toBeGreaterThan(reads)
    expect(thinkingPicker().checked).toBe(true)
    expect(agentClient.selectRootMode).not.toHaveBeenCalled()
  })

  it("rejects invalid typed arguments before sending and retains the draft", async () => {
    const send = vi.fn<Send>(); const textarea = await mount(send, "root-session")
    await openWorkflowCatalog()
    act(() => workflowControl().onChange({ entry: typedEntry, argsText: '{}' }))
    change(textarea, "keep request"); act(() => composer().onSubmit())
    expect(send).not.toHaveBeenCalled()
    expect(workflowControl().error).toContain("target")
    expect(runtime.state.inputStates["root-session"]?.content).toBe("keep request")
  })

  it("does not turn typed selection into queued text during a run", async () => {
    const send = vi.fn<Send>(); const textarea = await mount(send, "root-session", true)
    await openWorkflowCatalog()
    act(() => workflowControl().onChange({ entry: typedEntry, argsText: '{"target":"src"}' }))
    change(textarea, "keep request"); act(() => composer().onSubmit())
    expect(send).not.toHaveBeenCalled(); expect(runtime.queueSend).not.toHaveBeenCalled()
    expect(workflowControl().error).toContain("消息队列只接收文本")
  })

  it("preserves a newer typed selection across a late ACK", async () => {
    const ack = deferred<Awaited<ReturnType<Send>>>()
    const send = vi.fn<Send>().mockReturnValue(ack.promise); const textarea = await mount(send, "root-session")
    await openWorkflowCatalog()
    act(() => workflowControl().onChange({ entry: typedEntry, argsText: '{"target":"src"}' }))
    change(textarea, "first request"); act(() => composer().onSubmit())
    act(() => workflowControl().onChange({ entry: { ...typedEntry, revision: 10 }, argsText: '{"target":"tests"}' }))
    ack.resolve({ kind: "accepted", operationId: 1, sessionId: "root-session", navigated: false }); await flush()
    expect(workflowControl().selected?.entry.revision).toBe(10)
  })

  it("does not let a late legacy expansion replace a newer typed choice", async () => {
    const pending = deferred<{ name: string; content: string; type: string }>()
    runtime.getWorkflow.mockReturnValueOnce(pending.promise)
    await mount(vi.fn<Send>(), "root-session")
    await openWorkflowCatalog()
    act(() => composer().onPickWorkflow(workflowA))
    act(() => workflowControl().onChange({ entry: typedEntry, argsText: '{"target":"src"}' }))
    pending.resolve({ name: "legacy", content: "legacy instructions", type: "workflow" }); await flush()
    expect(workflowControl().selected?.entry.id).toBe("review-exact")
    expect(composer().selectedWorkflow).toBeNull()
  })

  it("drops typed catalog authority when switching Sessions without moving draft text", async () => {
    const send = vi.fn<Send>(); const textarea = await mount(send, "root-session")
    await openWorkflowCatalog()
    act(() => workflowControl().onChange({ entry: typedEntry, argsText: '{"target":"src"}' }))
    change(textarea, "root draft")
    const root = roots.at(-1)!
    await act(async () => root.render(<ChatPane chat={createChat(send, "other-session")} pickedWorkspace="/picked"
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
      onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))
    expect(composer().workflowControl).toBeNull()
    expect(runtime.state.inputStates["root-session"]?.content).toBe("root draft")
  })

  it("dismisses command menus before JSON editing while preserving a slash-prefixed typed task", async () => {
    const textarea = await mount(vi.fn<Send>(), "root-session")
    await openWorkflowCatalog()
    act(() => workflowControl().onChange({ entry: typedEntry, argsText: '{"target":"src"}' }))
    change(textarea, "/goal literal task")
    expect(composer().slashQuery).toBe("goal literal task")
    act(() => workflowControl().onArgsFocus?.())
    expect(composer().slashQuery).toBeNull()
    expect(workflowControl().selected?.entry.id).toBe(typedEntry.id)
    expect(runtime.state.inputStates["root-session"]?.content).toBe("/goal literal task")
  })

  it("keeps the confirmed server label while a Root run is active", async () => {
    vi.mocked(agentClient.getSession).mockImplementation(async (sessionId) => ({
      session: { ...rootFields, id: sessionId, kind: "root", root_orchestration_only: true, thinking_mode: "ultra" },
    }) as Awaited<ReturnType<typeof agentClient.getSession>>)
    await mount(vi.fn<Send>(), "root-session", true)
    expect(thinkingPicker().checked).toBe(true)
    expect(thinkingPicker().disabled).toBe(true)
    expect(document.querySelector('[role="status"]')?.textContent).toContain("服务器已确认 Ultra 编排")
  })

  it("holds a Goal command while a mode-only operation is pending", async () => {
    vi.mocked(agentClient.getSession).mockImplementation(async (sessionId) => ({
      session: { ...rootFields, id: sessionId, kind: "root", root_orchestration_only: true, thinking_mode: "ultra" },
    }) as Awaited<ReturnType<typeof agentClient.getSession>>)
    const send = vi.fn<Send>()
    const terminal = deferred<Awaited<ReturnType<typeof agentClient.selectRootMode>>>()
    vi.mocked(agentClient.selectRootMode).mockReturnValueOnce(terminal.promise)
    const textarea = await mount(send, "root-session")
    act(() => thinkingPicker().click())
    change(textarea, "/goal complete the task")
    act(() => composer().onSubmit())

    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(textarea.value).toBe("/goal complete the task")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("请恢复该请求")
    const operation = vi.mocked(agentClient.selectRootMode).mock.calls[0][1]
    await act(async () => {
      terminal.resolve({ status: "committed", operation_id: operation.operationId, expected_epoch: operation.expectedEpoch,
        resulting_epoch: operation.expectedEpoch + 1, enabled_at_completion: false, thinking_mode_at_completion: "standard", root_tool_authority_revision: 2 })
      await Promise.resolve()
    })
  })

  it("fails closed when detail is unavailable and recovers by reading the server", async () => {
    vi.mocked(agentClient.getSession)
      .mockRejectedValueOnce(new Error("authority unavailable"))
      .mockImplementation(async (sessionId) => ({
        session: { ...rootFields, id: sessionId, kind: "root", root_orchestration_only: true, thinking_mode: "ultra" },
      }) as Awaited<ReturnType<typeof agentClient.getSession>>)
    await mount(vi.fn<Send>(), "root-session")
    expect(thinkingPicker().disabled).toBe(true)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("authority unavailable")

    const retryButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "重新读取")
    expect(retryButton).toBeDefined()
    await act(async () => { retryButton?.click(); await Promise.resolve() })
    expect(thinkingPicker().checked).toBe(true)
    expect(thinkingPicker().disabled).toBe(false)
  })

  it("keeps the independent thinking picker in a narrow composer", async () => {
    await mount(vi.fn<Send>(), null)
    resizePane(false)
    expect(runtime.reasoningPicker?.allowUltra).toBe(true)
    expect(runtime.reasoningPicker?.disabled).toBe(false)
    expect(document.querySelector('[data-testid="composer-shell"]')?.contains(document.querySelector('[data-testid="reasoning-picker"]'))).toBe(true)
    expect(document.querySelector('input[type="checkbox"]')).toBeNull()
  })
})

it("handles a goal command without sending it to the conversation", async () => {
  const send = vi.fn<Send>()
  const input = await mount(send, "goal-chat")
  change(input, "/goal 完成测试并说明结果")
  act(() => composer().onSubmit())
  await flush()
  expect(agentClient.sendMessage).toHaveBeenCalledWith({ session_id: "goal-chat", model: "", message: "/goal 完成测试并说明结果" })
  expect(send).not.toHaveBeenCalled()
  expect(input.value).toBe("")
})

it("retains a goal command when saving fails", async () => {
  vi.mocked(agentClient.sendMessage).mockRejectedValueOnce(new Error("offline"))
  const send = vi.fn<Send>()
  const input = await mount(send, "goal-chat")
  change(input, "/goal 保留草稿")
  act(() => composer().onSubmit())
  await flush()
  expect(send).not.toHaveBeenCalled()
  expect(input.value).toBe("/goal 保留草稿")
})

it("queues text and images from the normal composer while a run is active", async () => {
  const send = vi.fn<Send>()
  const input = await mount(send, "queue-chat", true)
  await addImage("queue.png")
  change(input, "请结合图片继续")
  act(() => composer().onSubmit())
  await flush()
  expect(runtime.queueSend).toHaveBeenCalledWith("请结合图片继续", [expect.objectContaining({ name: "queue.png", type: "image/png", base64: btoa("queue.png") })])
  expect(send).not.toHaveBeenCalled()
  expect(input.value).toBe("")
  expect(composer().attachments).toHaveLength(0)
})

it("keeps queued text and images in the composer until admission is confirmed", async () => {
  runtime.queueSend.mockResolvedValueOnce({ kind: "unconfirmed", operationId: 0 })
  const input = await mount(vi.fn<Send>(), "queue-chat", true)
  await addImage("retry.png")
  change(input, "保留图片")
  act(() => composer().onSubmit())
  await flush()
  expect(input.value).toBe("保留图片")
  expect(composer().attachments).toHaveLength(1)
})

it("honors goal control responses that must not start a new execution", async () => {
  vi.mocked(agentClient.execute).mockClear()
  vi.mocked(agentClient.sendMessage).mockResolvedValueOnce({ session_id: "goal-chat", status: "accepted", goal_command: { action: "off", should_execute: false } })
  const input = await mount(vi.fn<Send>(), "goal-chat")
  change(input, "/goal off")
  act(() => composer().onSubmit())
  await flush()
  expect(agentClient.execute).not.toHaveBeenCalled()
  expect(input.value).toBe("")
})


it("admits an acknowledged Goal even when submitted during a running session", async () => {
  vi.mocked(agentClient.execute).mockClear()
  const acknowledgement = deferred<Awaited<ReturnType<typeof agentClient.sendMessage>>>()
  vi.mocked(agentClient.sendMessage).mockReturnValueOnce(acknowledgement.promise)
  const input = await mount(vi.fn<Send>(), "goal-race", true)
  change(input, "/goal 完成新的目标")
  act(() => composer().onSubmit())
  expect(agentClient.execute).not.toHaveBeenCalled()
  await act(async () => acknowledgement.resolve({ session_id: "goal-race", status: "accepted", goal_command: { action: "set_prompt", should_execute: true } }))
  await flush()
  expect(agentClient.execute).toHaveBeenCalledTimes(1)
  expect(agentClient.execute).toHaveBeenCalledWith("goal-race", undefined)
  expect(input.value).toBe("")
})

describe("ChatPane read visibility", () => {
  for (const hiddenBy of ["closed", "narrow viewport"] as const) {
    it(`retains unread background messages while secondary pane is ${hiddenBy}`, async () => {
      const container = document.body.appendChild(document.createElement("div"))
      const root = createRoot(container); roots.push(root)
      const id = `read-visibility-${hiddenBy}`
      const base = createChat(vi.fn<Send>(), id)
      const session = (count: number) => ({ ...base.currentChat!, messageCount: count })
      function Surface({ open, count }: { open: boolean; count: number }) {
        const current = session(count)
        const markers = useSessionReadState()
        return <>
          <span data-testid="unread">{String(isSessionUnread(current, markers))}</span>
          {open && <ChatPane chat={{ ...base, currentChat: current }} pickedWorkspace={null}
            secondary={{ sessionId: id, chats: [], onPickSession: vi.fn(), onClose: vi.fn() }}
            onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen
            onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />}
        </>
      }
      const unread = () => container.querySelector('[data-testid="unread"]')?.textContent
      await act(async () => root.render(<Surface open count={1} />))
      expect(unread()).toBe("false")
      if (hiddenBy === "narrow viewport") resizePane(false)
      await act(async () => root.render(<Surface open={hiddenBy !== "closed"} count={2} />))
      expect(unread()).toBe("true")
      act(() => document.dispatchEvent(new Event("visibilitychange")))
      expect(unread()).toBe("true")
      if (hiddenBy === "narrow viewport") resizePane(true)
      await act(async () => root.render(<Surface open count={2} />))
      expect(unread()).toBe("false")
    })
  }
})

it("shows an unreadable pending request with a working refresh control outside the dialog", async () => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container); roots.push(root)
  const refresh = vi.fn().mockResolvedValue("pending")
  const chat = { ...createChat(vi.fn<Send>(), "approval-root"), pendingQuestion: null,
    questionError: "暂时无法读取确认请求，请刷新后重试。", questionUnavailable: true,
    questionLoading: false, questionSubmitting: false, refreshQuestion: refresh }
  await act(async () => root.render(<ChatPane chat={chat} pickedWorkspace="/picked"
    onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
    onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))
  const alert = container.querySelector('[role="alert"]')
  expect(alert?.textContent).toContain("无法读取确认请求")
  const refreshButton = alert?.querySelector("button")
  expect(refreshButton?.textContent).toBe("刷新请求")
  act(() => refreshButton?.click())
  expect(refresh).toHaveBeenCalledTimes(1)
})

it("routes a sub-agent card to the side-preview callback without replacing the main session", async () => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container); roots.push(root)
  const chat = createChat(vi.fn<Send>(), "parent")
  const openPreview = vi.fn()
  await act(async () => root.render(<ChatPane chat={chat} pickedWorkspace="/picked"
    onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
    onToggleSplit={vi.fn()} onSelectSubAgent={openPreview}
    onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))

  act(() => runtime.messageList?.onSelectSubAgent("child"))

  expect(openPreview).toHaveBeenCalledExactlyOnceWith("child")
  expect(chat.select).not.toHaveBeenCalled()
})

it("centers the jump-to-bottom control on the composer column", async () => {
  runtime.stickyAtBottom = false
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container); roots.push(root)
  const chat = createChat(vi.fn<Send>(), "parent")

  await act(async () => root.render(<ChatPane chat={chat} pickedWorkspace="/picked"
    onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
    onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))

  const region = container.querySelector("[data-composer-region]")
  const anchor = region?.querySelector<HTMLElement>("[data-scroll-to-bottom-anchor]")
  const button = anchor?.querySelector<HTMLButtonElement>('button[aria-label="滚动到底部"]')
  expect(anchor).not.toBeNull()
  expect(anchor?.className).toContain("inset-x-0")
  expect(anchor?.className).toContain("px-3")
  expect(anchor?.className).toContain("max-w-6xl")
  expect(region?.querySelector('[data-testid="composer-shell"]')).not.toBeNull()

  await act(async () => button?.click())
  expect(runtime.scrollToBottom).toHaveBeenCalledTimes(1)
})

it("shows Environment by default and only suppresses it while the side pane is open", async () => {
  vi.stubGlobal("ResizeObserver", undefined)
  const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(() => ({
      x: 0, y: 0, width: 1900, height: 720,
      top: 0, right: 1900, bottom: 720, left: 0,
      toJSON: () => ({}),
    }) as DOMRect)
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container); roots.push(root)
  const chat = createChat(vi.fn<Send>(), "parent")
  const render = (sidePaneOpen: boolean) => (
    <ChatPane chat={chat} pickedWorkspace="/picked"
      onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()}
      sidePaneOpen={sidePaneOpen} splitOpen={false}
      onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />
  )

  await act(async () => root.render(render(false)))
  expect(container.querySelector("[data-environment-floating]")?.getAttribute("data-state"))
    .toBe("open")
  expect(runtime.messageList?.contentShiftX).toBe(-166)

  await act(async () => root.render(render(true)))
  expect(container.querySelector("[data-environment-floating]")?.getAttribute("data-state"))
    .toBe("closed")
  expect(runtime.messageList?.contentShiftX).toBe(0)

  await act(async () => root.render(render(false)))
  expect(container.querySelector("[data-environment-floating]")?.getAttribute("data-state"))
    .toBe("open")
  expect(runtime.messageList?.contentShiftX).toBe(-166)
  rectSpy.mockRestore()
})

it("auto-shows Environment once the chat surface clears it and animates state changes", async () => {
  mediaMatches = true
  let containerWidth = 1400
  vi.stubGlobal("ResizeObserver", undefined)
  const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(() => ({
      x: 0, y: 0, width: containerWidth, height: 720,
      top: 0, right: containerWidth, bottom: 720, left: 0,
      toJSON: () => ({}),
    }) as DOMRect)
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container); roots.push(root)
  const chat = createChat(vi.fn<Send>(), "parent")

  await act(async () => root.render(<ChatPane chat={chat} pickedWorkspace="/picked"
    onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
    onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))

  const launcher = container.querySelector<HTMLButtonElement>(
    'button[aria-label="打开 Environment"]',
  )
  const floating = () => container.querySelector<HTMLElement>("[data-environment-floating]")
  expect(launcher?.getAttribute("aria-expanded")).toBe("false")
  expect(floating()?.getAttribute("data-state")).toBe("closed")
  expect(floating()?.getAttribute("aria-hidden")).toBe("true")
  expect(floating()?.style.transition).toContain("transform 200ms ease-out")
  expect(floating()?.style.transform).toContain("translateX(0.75rem)")
  expect(runtime.messageList?.contentShiftX).toBe(0)
  expect(container.querySelector("[data-environment-inline]")).toBeNull()
  expect(container.querySelector<HTMLElement>("[data-chat-body]")?.style.paddingRight).toBe("")

  containerWidth = 1484
  await act(async () => window.dispatchEvent(new Event("resize")))
  expect(floating()?.getAttribute("data-state")).toBe("open")
  expect(floating()?.style.transform).toContain("translateX(0)")
  expect(runtime.messageList?.contentShiftX).toBe(-166)

  containerWidth = 1400
  await act(async () => window.dispatchEvent(new Event("resize")))
  expect(floating()?.getAttribute("data-state")).toBe("closed")
  expect(runtime.messageList?.contentShiftX).toBe(0)

  const compactLauncher = container.querySelector<HTMLButtonElement>(
    'button[aria-label="打开 Environment"]',
  )
  await act(async () => compactLauncher?.click())

  expect(floating()?.getAttribute("data-state")).toBe("open")
  expect(floating()?.getAttribute("aria-hidden")).toBe("false")
  expect(runtime.messageList?.contentShiftX).toBe(-124)
  expect(container.querySelector("[data-environment-inline]")).toBeNull()
  rectSpy.mockRestore()
})

it("updates Environment from live edits and previews image sources", async () => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container); roots.push(root)
  const previewUrl = "data:image/png;base64,c291cmNl"
  const chat = createChat(vi.fn<Send>(), "parent")
  chat.messages = [{
    id: "user-with-image",
    role: "user",
    content: "参考图片",
    createdAt: "2026-09-21T00:00:00Z",
    images: [{
      id: "source-1",
      name: "source.png",
      type: "image/png",
      size: 6,
      url: previewUrl,
    }],
  }]
  chat.liveSegments = [{
    kind: "tools",
    calls: [{
      toolCallId: "edit-1",
      toolName: "Edit",
      output: JSON.stringify({
        operation: "edit",
        file_path: "/workspace/src/index.css",
        diff: {
          unified: "--- a/src/index.css\n+++ b/src/index.css\n@@ -1,2 +1,3 @@\n-old\n+new\n+more\n same",
        },
      }),
      status: "completed",
    }],
  }]

  await act(async () => root.render(<ChatPane chat={chat} pickedWorkspace="/picked"
    onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen={false}
    onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))

  const card = container.querySelector<HTMLElement>("[data-environment-card]")
  expect(card?.textContent).toContain("1 个变更文件")
  expect(card?.textContent).toContain("+2")
  expect(card?.textContent).toContain("−1")
  const sourcePreview = card?.querySelector<HTMLButtonElement>(
    'button[aria-label="预览 source.png"]',
  )
  expect(sourcePreview?.querySelector("img")?.getAttribute("src")).toBe(previewUrl)
  await act(async () => sourcePreview?.click())
  expect(container.querySelector("[data-image-lightbox]")?.getAttribute("data-src")).toBe(previewUrl)
})

it("returns from a child inside the side pane without changing the main session", async () => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container); roots.push(root)
  const chat = createChat(vi.fn<Send>(), "child")
  chat.currentChat = { ...chat.currentChat!, parentSessionId: "parent" }
  const pickSideSession = vi.fn()
  await act(async () => root.render(<ChatPane chat={chat} pickedWorkspace={null}
    secondary={{ sessionId: "child", chats: [], onPickSession: pickSideSession, onClose: vi.fn() }}
    onOpenWorkspacePicker={vi.fn()} onOpenInspector={vi.fn()} splitOpen
    onToggleSplit={vi.fn()} onOpenSidebar={vi.fn()} sidebarCollapsed={false} />))

  const back = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    button.textContent?.includes("返回父会话"),
  )
  act(() => back?.click())

  expect(pickSideSession).toHaveBeenCalledExactlyOnceWith("parent")
  expect(chat.select).not.toHaveBeenCalled()
})
