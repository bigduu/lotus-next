import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CommandItem } from "@services/command"
import type { SkillDefinition } from "@shared/types/skill"

type ComposerProps = ComponentProps<(typeof import("./Composer"))["Composer"]>
type ChatPaneProps = ComponentProps<(typeof import("./ChatPane"))["ChatPane"]>
type Send = ChatPaneProps["chat"]["send"]
type State = {
  tokenUsages: Record<string, unknown>; inputStates: Record<string, { content: string; contentRevision: number; reasoningEffort: "medium" }>
  skills: SkillDefinition[]; childProgress: Record<string, unknown>; models: string[]; selectedModel: string
  setInputContent(id: string, content: string): void
  setInputContentIfRevision(id: string, revision: number, content: string): boolean
  moveInputContentIfRevision(source: string, revision: number, target: string): boolean
  setSelectedModel(model: string): void; setInputReasoningEffort(id: string, effort: string): void; refreshChatsNow(): Promise<void>
}
const runtime = vi.hoisted(() => ({
  state: {} as State, listeners: new Set<() => void>(), composer: null as ComposerProps | null,
  revision: 0, getWorkflow: vi.fn(), listCommands: vi.fn(), peekTemplate: vi.fn(),
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
    { getState: () => runtime.state },
  )
  return { useAppStore, selectChildren: () => (state: State) => state.childProgress }
})
type ProviderState = { providerConfig: null; defaultProviderInstanceId: null; providerInstances: never[] }
vi.mock("@shared/store/appStore/slices/providerSlice", () => ({ useProviderStore: <T,>(selector: (state: ProviderState) => T) => selector({ providerConfig: null, defaultProviderInstanceId: null, providerInstances: [] }) }))
vi.mock("@/hooks/useStickyScroll", () => ({
  useStickyScroll: () => ({ scrollRef: { current: null }, contentRef: { current: null }, atBottom: true,
    handleScroll: vi.fn(), scrollToBottom: vi.fn(), pinToBottom: vi.fn() }),
}))
vi.mock("@services/command", () => ({ commandService: { listCommands: runtime.listCommands, getWorkflowCommand: runtime.getWorkflow } }))
vi.mock("@services/workspace", () => ({ workspaceService: { listWorkspaceFiles: vi.fn().mockResolvedValue([]) } }))
vi.mock("@services/chat/AgentService", () => ({ agentClient: { patchSession: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/taskTemplates", () => ({ peekPendingTemplatePrompt: runtime.peekTemplate }))
vi.mock("@/lib/exportMarkdown", () => ({ downloadMarkdown: vi.fn() }))
vi.mock("@/lib/exportPdf", () => ({ downloadPdf: vi.fn() }))
vi.mock("@/components/chat/Dialogs", () => ({ QuestionDialog: () => null, ApprovalDialog: () => null }))
vi.mock("@/components/app/ChatHeader", () => ({ ChatHeader: () => null }))
vi.mock("@/components/app/HomeDashboard", () => ({ HomeDashboard: () => null }))
vi.mock("@/components/app/MessageList", () => ({ MessageList: () => null }))
vi.mock("@/components/app/Toasts", () => ({ Toasts: () => null }))
vi.mock("@/components/app/ImageLightbox", () => ({ ImageLightbox: () => null }))
vi.mock("@/components/chat/ReasoningPicker", () => ({ ReasoningPicker: () => null }))
vi.mock("@/components/chat/ModelPicker", () => ({ ModelPicker: () => null }))
vi.mock("@/components/app/Composer", () => ({
  Composer: (props: ComposerProps) => (runtime.composer = props,
    <textarea ref={props.inputRef} aria-label="消息" value={props.draft} onChange={(event) => props.onDraftChange(event.currentTarget.value)} />),
}))
import { ChatPane } from "./ChatPane"
const skill = (id: string): SkillDefinition => ({ id, name: id, description: id, prompt: id, tool_refs: [`tool-${id}`] })
const workflow = (id: string): CommandItem => ({ id, name: id, display_name: id, description: id, type: "workflow", metadata: null })
const skillA = skill("skill-a")
const skillB = skill("skill-b")
const workflowA = workflow("workflow-a")
const workflowB = workflow("workflow-b")
const roots: Root[] = []
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
function notify() { for (const listener of runtime.listeners) listener() }
function write(id: string, content: string) { runtime.state.setInputContent(id, content) }
function composer() { if (!runtime.composer) throw new Error("Composer did not render"); return runtime.composer }
function deferred<T>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function createChat(send: Send, id: string | null) {
  return {
    booted: true, chats: [], currentSessionId: id,
    currentChat: id ? { id, title: "Test", config: { workspacePath: "/session" } } : null,
    messages: [], streaming: "", streamingReasoning: "", liveSegments: [], streamStatus: null,
    pendingUserText: null, sending: false, submissionPending: false, sendFailure: null,
    pendingQuestion: null, pendingApproval: null, send,
    select: vi.fn(), stop: vi.fn(), newChat: vi.fn(),
    deleteMessage: vi.fn(), fork: vi.fn(), regenerate: vi.fn(), retry: vi.fn(),
    editMessage: vi.fn(), answerQuestion: vi.fn(), respondApproval: vi.fn(),
  } as unknown as ChatPaneProps["chat"]
}
async function mount(send: Send, id: string | null) {
  const container = document.body.appendChild(document.createElement("div")); const root = createRoot(container); roots.push(root)
  await act(async () => {
    root.render(<ChatPane chat={createChat(send, id)} pickedWorkspace="/picked"
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
  await act(async () => { composer().onAddFiles([new File([name], name, { type: "image/png" })]); await new Promise((resolve) => setTimeout(resolve, 0)) })
}
async function fill(textarea: HTMLTextAreaElement) {
  act(() => composer().onPickSkill(skillA)); await pickWorkflow(workflowA); await addImage("before.png"); change(textarea, "original request")
}
beforeEach(() => {
  runtime.composer = null; runtime.listeners.clear(); runtime.revision = 0
  runtime.state = {
    tokenUsages: {}, inputStates: {}, skills: [skillA, skillB], childProgress: {}, models: [],
    selectedModel: "test-model", setInputReasoningEffort: vi.fn(),
    refreshChatsNow: vi.fn().mockResolvedValue(undefined),
    setSelectedModel: (model) => { runtime.state.selectedModel = model; notify() },
    setInputContent: (id, content) => {
      const previous = runtime.state.inputStates[id] ?? { content: "", contentRevision: 0, reasoningEffort: "medium" }
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
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren() })
describe("ChatPane composer acknowledgement", () => {
  it("preserves an exact raw draft, focus, and template ownership before ACK", async () => {
    const templatePrompt = Object.freeze({ prompt: "template prompt", revision: 7 })
    runtime.peekTemplate.mockReturnValue(templatePrompt)
    const send = vi.fn<Send>().mockResolvedValue({ kind: "unconfirmed", operationId: 1 })
    const textarea = await mount(send, null)
    change(textarea, "  exact raw draft  ")
    document.body.tabIndex = -1; document.body.focus(); act(() => composer().onSubmit()); await flush()
    expect(send).toHaveBeenCalledWith("  exact raw draft  ", {
      skillIds: undefined, images: undefined, workspacePath: "/picked", templatePrompt,
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
      workspacePath: "/picked", templatePrompt: null,
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
