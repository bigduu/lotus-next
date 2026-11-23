import { render } from "@solidjs/web"
import { flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { agentClient } from "@services/chat/AgentService"
import { appStore } from "@shared/store/appStore/state"
import type { ChatItem } from "@shared/types/chatMessages"
import { uiText } from "@shared/i18n/text"
import { ComposerCommandMenus } from "./ComposerCommandMenus"
import { createComposerCommands, type ComposerCommandsOptions } from "./createComposerCommands"

const session: ChatItem = {
  id: "composer-commands-test", title: "Example conversation", kind: "root", createdAt: 1, messages: [],
  config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null },
}
let cleanup: (() => void) | undefined

afterEach(() => {
  cleanup?.()
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
