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
  queueSend: vi.fn(), revision: 0, getWorkflow: vi.fn(), listCommands: vi.fn(), peekTemplate: vi.fn(),
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
type ProviderState = { providerSnapshot: null }
vi.mock("@shared/store/appStore/slices/providerSlice", () => ({ useProviderStore: <T,>(selector: (state: ProviderState) => T) => selector({ providerSnapshot: null }) }))
vi.mock("@/hooks/useGuidanceQueue", () => ({ useGuidanceQueue: () => ({ mode: "after_round", setMode: vi.fn(), send: runtime.queueSend, cancel: vi.fn(), pending: [], error: null, busy: false, hasUnconfirmed: false }) }))
vi.mock("@/hooks/useStickyScroll", () => ({
  useStickyScroll: () => ({ scrollRef: { current: null }, contentRef: { current: null }, atBottom: true,
    handleScroll: vi.fn(), scrollToBottom: vi.fn(), pinToBottom: vi.fn() }),
}))
vi.mock("@services/command", () => ({ commandService: { listCommands: runtime.listCommands, getWorkflowCommand: runtime.getWorkflow } }))
vi.mock("@services/workspace", () => ({ workspaceService: { listWorkspaceFiles: vi.fn().mockResolvedValue([]) } }))
vi.mock("@services/chat/AgentService", () => ({ agentClient: {
  patchSession: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockImplementation(async (request) => ({ session_id: request.session_id, goal_command: { action: "set_prompt", should_execute: true } })),
  execute: vi.fn().mockResolvedValue(undefined),
} }))
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
vi.mock("@/components/chat/PermissionModeControl", () => ({ PermissionModeControl: () => null }))
vi.mock("@/components/app/Composer", () => ({
  Composer: (props: ComposerProps) => (runtime.composer = props,
    <textarea ref={props.inputRef} aria-label="消息" value={props.draft} onChange={(event) => props.onDraftChange(event.currentTarget.value)} />),
}))
import { agentClient } from "@services/chat/AgentService"
import { ChatPane } from "./ChatPane"
import { isSessionUnread, useSessionReadState } from "@/lib/sessionReadState"
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
async function mount(send: Send, id: string | null, running = false) {
  const container = document.body.appendChild(document.createElement("div")); const root = createRoot(container); roots.push(root)
  await act(async () => {
    root.render(<ChatPane chat={{ ...createChat(send, id), sending: running }} pickedWorkspace="/picked"
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
  runtime.queueSend.mockResolvedValue({ kind: "accepted", operationId: 0, sessionId: "queue-chat", navigated: false })
  mediaMatches = true; mediaListeners.clear()
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: mediaMatches,
    addEventListener: (_name: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.add(listener),
    removeEventListener: (_name: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.delete(listener),
  })))
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
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })
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
