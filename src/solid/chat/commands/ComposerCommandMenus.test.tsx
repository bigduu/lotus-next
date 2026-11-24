import { render } from "@solidjs/web"
import { createSignal, createUniqueId, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import type { Editor } from "@tiptap/core"
import { agentClient } from "@services/chat/AgentService"
import { appStore } from "@shared/store/appStore/state"
import type { ChatItem } from "@shared/types/chatMessages"
import { uiText } from "@shared/i18n/text"
import { workspaceService } from "@services/workspace/WorkspaceService"
import type { WorkspaceFileEntry } from "@services/workspace/types"
import { ComposerEditor } from "../../composer/ComposerEditor"
import { settleChat } from "../chatInteractionTestHarness"
import { ComposerCommandMenus } from "./ComposerCommandMenus"
import { createComposerCommands, type ComposerCommandsOptions } from "./createComposerCommands"

const session: ChatItem = {
  id: "composer-commands-test", title: "Example conversation", kind: "root", createdAt: 1, messages: [],
  config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null },
}
let cleanup: (() => void) | undefined
const scopedDisposers: (() => void)[] = []

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  for (const dispose of scopedDisposers.splice(0).reverse()) dispose()
  vi.restoreAllMocks()
})

function mount(query: string, options: { newChat?: boolean; running?: boolean } = {}) {
  const invokeWorkflow = vi.fn()
  const invokeGoal = vi.fn()
  const compact = vi.spyOn(agentClient, "compactSessionContext").mockResolvedValue({
    session_id: session.id, status: "unchanged",
  })
  const currentSessionId = options.newChat ? null : session.id
  const currentChat = options.newChat ? null : session
  const draftKey = currentSessionId ?? ""
  const { chats, currentSessionId: previousId, inputStates } = appStore.getState()
  appStore.setState({ chats: [session], currentSessionId })
  appStore.getState().setInputContent(draftKey, "/" + query)
  const chat = {
    currentSessionId, currentChat, executionCompatibility: { blocked: false }, submissionPending: false,
  } as ComposerCommandsOptions["chat"]
  const host = document.body.appendChild(document.createElement("div"))
  const dispose = render(() => {
    const commands = createComposerCommands({
      chat, draftKey: () => draftKey, inputId: "test-editor", workspacePath: () => null,
      running: () => options.running === true, blocked: () => false, hasAttachments: () => false,
      queueBusy: () => false, queuePending: () => false, thinkingMode: () => "standard",
      openGoal: invokeGoal, openWorkflowRuns: invokeWorkflow,
    })
    return <><ComposerCommandMenus commands={commands} /><div id="test-editor" contenteditable="true" /></>
  }, host)
  flush()
  cleanup = () => {
    dispose()
    host.remove()
    appStore.setState({ chats, currentSessionId: previousId, inputStates })
  }
  return {
    invokeWorkflow, invokeGoal, compact,
    buttons: () => [...host.querySelectorAll<HTMLButtonElement>('button[role="option"]')],
  }
}

it("opens Workflow Runs on demand without changing the draft", () => {
  const view = mount("workflow")
  const [workflow] = view.buttons()
  expect(workflow.textContent).toContain("/workflow")
  expect(workflow.textContent).toContain("编排运行")
  expect(view.invokeWorkflow).not.toHaveBeenCalled()
  workflow.click()
  expect(view.invokeWorkflow).toHaveBeenCalledExactlyOnceWith(session.id)
  expect(appStore.getState().getInputState(session.id).content).toBe("/workflow")
})

it("omits Workflow Runs before a session exists", () => {
  const view = mount("workflow", { newChat: true })
  expect(view.buttons()).toHaveLength(0)
  expect(view.invokeWorkflow).not.toHaveBeenCalled()
})

it("keeps Goal ahead of Workflow Runs with an empty slash query", () => {
  const view = mount("")
  const buttons = view.buttons()
  expect(buttons[0].textContent).toContain("/goal")
  expect(buttons.slice(1).some((button) => button.textContent?.includes("/workflow"))).toBe(true)
  buttons[0].click()
  expect(view.invokeGoal).toHaveBeenCalledExactlyOnceWith(session.id)
  expect(view.invokeWorkflow).not.toHaveBeenCalled()
})

it("invokes manual compaction from a matching command name", async () => {
  const view = mount("comp")
  const [compact] = view.buttons()
  expect(compact.textContent).toContain("/compact")
  expect(compact.textContent).toContain("压缩当前会话的上下文")
  compact.click()
  await vi.waitFor(() => {
    flush()
    expect(view.compact).toHaveBeenCalledExactlyOnceWith(session.id)
    expect(appStore.getState().getInputState(session.id).content).toBe("")
  })
})

it("shows the disabled exact compact command with its reason while running", () => {
  const view = mount("compact", { running: true })
  const options = view.buttons()
  expect(options).toHaveLength(1)
  expect(options[0].disabled).toBe(true)
  expect(options[0].textContent).toContain(uiText("compact_wait_for_session"))
  options[0].click()
  expect(view.compact).not.toHaveBeenCalled()
})

function scopedEditor(suffix: string, content: string, workspace?: string) {
  const [path, setWorkspace] = createSignal(workspace)
  const { chats, inputStates } = appStore.getState()
  const currentChat = { ...session, id: `test-session-${suffix}` }
  appStore.setState({ chats: [...chats, currentChat] })
  appStore.getState().setInputContent(currentChat.id, content)
  const openGoal = vi.fn()
  const send = vi.fn()
  const host = document.body.appendChild(document.createElement("div"))
  const dispose = render(() => {
    const inputId = createUniqueId()
    const chat = {
      currentChat, currentSessionId: currentChat.id, executionCompatibility: { blocked: false }, submissionPending: false,
    } as ComposerCommandsOptions["chat"]
    const commands = createComposerCommands({
      chat, inputId, draftKey: () => currentChat.id, workspacePath: path,
      running: () => false, blocked: () => false, hasAttachments: () => false, queueBusy: () => false,
      queuePending: () => false, thinkingMode: () => "standard", openGoal,
    })
    return <><ComposerCommandMenus commands={commands} /><ComposerEditor id={inputId} value={content}
      label="Messages" title="Enter" placeholder="Message" busy={false}
      mentionsEnabled={Boolean(path())} mentionScope={path()}
      onChange={(value) => appStore.getState().setInputContent(currentChat.id, value)}
      onSubmit={send} onAddFiles={vi.fn()} onSuggestionChange={commands.setFileSuggestion} /></>
  }, host)
  scopedDisposers.push(() => {
    dispose()
    host.remove()
    appStore.setState({ chats, inputStates })
  })
  flush()
  const input = host.querySelector<HTMLDivElement & { editor: Editor }>("[data-composer-editor]")!
  return { host, input, openGoal, send, setWorkspace, id: currentChat.id }
}

function pressEnter(element: HTMLElement, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true, ...options })
  element.dispatchEvent(event)
  flush()
  return event
}

it("selects a slash option on Enter without sending and ignores IME Enter", () => {
  const pane = scopedEditor("slash", "/goal")
  expect(pane.host.querySelector('[role="option"]')).not.toBeNull()
  expect(pressEnter(pane.input, { isComposing: true }).defaultPrevented).toBe(false)
  expect(pressEnter(pane.input, { keyCode: 229 }).defaultPrevented).toBe(false)
  expect(pane.openGoal).not.toHaveBeenCalled()
  expect(pressEnter(pane.input).defaultPrevented).toBe(true)
  expect(pane.openGoal).toHaveBeenCalledExactlyOnceWith(pane.id)
  expect(pane.send).not.toHaveBeenCalled()
})

it("routes command keyboard shortcuts to only their own pane", () => {
  const first = scopedEditor("first-slash", "/goal")
  const second = scopedEditor("second-slash", "/goal")
  const parameters = document.body.appendChild(document.createElement("textarea"))
  try {
    expect(first.input.id).not.toBe(second.input.id)
    expect(pressEnter(parameters).defaultPrevented).toBe(false)
    expect(pressEnter(second.input, { isComposing: true }).defaultPrevented).toBe(false)
    expect(pressEnter(second.input, { keyCode: 229 }).defaultPrevented).toBe(false)
    pressEnter(second.input)
    expect(first.openGoal).not.toHaveBeenCalled()
    expect(second.openGoal).toHaveBeenCalledExactlyOnceWith(second.id)
    expect(second.send).not.toHaveBeenCalled()
    pressEnter(first.input)
    expect(first.openGoal).toHaveBeenCalledExactlyOnceWith(first.id)
    expect(first.send).not.toHaveBeenCalled()
  } finally {
    parameters.remove()
  }
})

it("picks a workspace file only in the focused split editor without sending", async () => {
  vi.spyOn(workspaceService, "listWorkspaceFiles").mockResolvedValue([{ name: "README.md", path: "README.md", is_directory: false }])
  const first = scopedEditor("first-file", "@re", "/first")
  const second = scopedEditor("second-file", "@re", "/second")
  await settleChat(() => {
    first.input.editor.commands.setTextSelection(4)
    second.input.editor.commands.setTextSelection(4)
    second.input.editor.view.focus()
  })
  expect(first.host.querySelector('[role="listbox"]')).not.toBeNull()
  expect(second.host.querySelector('[role="listbox"]')).not.toBeNull()
  pressEnter(second.input)
  expect(first.host.querySelector('[data-type="mention"]')).toBeNull()
  expect(second.host.querySelector('[data-type="mention"]')?.textContent).toBe("@README.md")
  expect(first.send).not.toHaveBeenCalled()
  expect(second.send).not.toHaveBeenCalled()
})

it("dismisses the previous workspace menu and ignores its late files when the editor opens the new one", async () => {
  let resolveFirst!: (files: WorkspaceFileEntry[]) => void
  let resolveSecond!: (files: WorkspaceFileEntry[]) => void
  const first = new Promise<WorkspaceFileEntry[]>((resolve) => { resolveFirst = resolve })
  const second = new Promise<WorkspaceFileEntry[]>((resolve) => { resolveSecond = resolve })
  const current = { name: "read-current.ts", path: "read-current.ts", is_directory: false }
  const stale = { name: "read-stale.ts", path: "read-stale.ts", is_directory: false }
  const list = vi.spyOn(workspaceService, "listWorkspaceFiles").mockReturnValueOnce(first).mockReturnValueOnce(second)
  const pane = scopedEditor("changes-workspace", "@read", "/previous")
  const search = () => pane.input.editor.commands.setTextSelection(6)
  const entries = () => [...pane.host.querySelectorAll('[role="option"]')].map((node) => node.textContent?.trim())
  await settleChat(() => { pane.input.editor.view.focus(); search() })
  expect(list.mock.calls).toEqual([["/previous"]])
  await settleChat(() => pane.setWorkspace("/current"))
  expect(entries()).toEqual([])
  await settleChat(() => pane.input.editor.commands.insertContent("-"))
  expect(list.mock.calls).toEqual([["/previous"], ["/current"]])
  await settleChat(() => resolveSecond([current]))
  expect(entries()).toEqual(["read-current.ts"])
  await settleChat(() => resolveFirst([stale]))
  expect(entries()).toEqual(["read-current.ts"])

  expect(pane.send).not.toHaveBeenCalled()
})
