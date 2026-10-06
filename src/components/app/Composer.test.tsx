import { act, createRef, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import type { Editor } from "@tiptap/core"
import type { ComposerInputHandle } from "@/components/chat/ComposerEditor"
import { Composer } from "./Composer"
import { changeLocale } from "@shared/i18n"
import { useAppStore } from "@shared/store/appStore"

const mountedRoots: Root[] = []
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterAll(() => {
  Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT")
  if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
  useAppStore.setState({ systemPrompts: [], lastSelectedPromptId: null })
})

function mountComposer(overrides: Partial<ComponentProps<typeof Composer>> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  const inputRef = createRef<ComposerInputHandle>()
  const props: ComponentProps<typeof Composer> = {
    draft: "保留这条消息",
    onDraftChange: vi.fn(),
    onSubmit: vi.fn(),
    onStop: vi.fn(),
    sending: false,
    submissionPending: false,
    inputRef,
    attachments: [],
    onAddFiles: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onPreviewImage: vi.fn(),
    selectedSkill: null,
    onClearSkill: vi.fn(),
    onPickSkill: vi.fn(),
    skills: [],
    workflows: [],
    selectedWorkflow: null,
    onClearWorkflow: vi.fn(),
    onPickWorkflow: vi.fn(),
    slashQuery: null,
    onMentionQueryChange: vi.fn(),
    displayWorkspace: null,
    workspaceFiles: [],
    hasSession: true,
    onOpenWorkspacePicker: vi.fn(),
    selectedProjectId: null,
    onSelectProject: vi.fn(),
    onDismissMenus: vi.fn(),
    ...overrides,
  }

  act(() => root.render(<Composer {...props} />))

  const textarea = container.querySelector<HTMLDivElement>('[data-composer-editor][aria-label="消息"]')
  expect(textarea).not.toBeNull()
  return { container, inputRef, props, textarea: textarea! }
}

function dispatchSubmitShortcut(
  textarea: HTMLElement,
  options: KeyboardEventInit = {},
) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Enter",
    ...options,
  })
  if (options.keyCode !== undefined) {
    Object.defineProperty(event, "keyCode", { value: options.keyCode })
  }
  act(() => textarea.dispatchEvent(event))
  return event
}

describe("Composer submission controls", () => {
  it("sends semantic ingress during execution without showing legacy queue controls", () => {
    const { container, textarea, props } = mountComposer({ sending: true, sendWhileRunning: true })
    expect(container.querySelector('[aria-label="发送时机"]')).toBeNull()
    expect(container.querySelector('[aria-label="发送消息"]')).not.toBeNull()
    dispatchSubmitShortcut(textarea)
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
  })
  it("keeps permission, runtime, and submission controls inside the composer surface", () => {
    const { container } = mountComposer({
      workflowControl: <span data-testid="workflow-chip">Review · 本条消息</span>,
      permissionControl: <span data-testid="permission-control">Auto</span>,
      runtimeControls: <span data-testid="runtime-controls">Model</span>,
    })
    const surface = container.querySelector("[data-composer-surface]")
    const permission = container.querySelector('[data-testid="permission-control"]')
    const runtimeControls = container.querySelector('[data-testid="runtime-controls"]')
    const send = container.querySelector('button[aria-label="发送消息"]')

    expect(surface).not.toBeNull()
    expect(surface?.contains(container.querySelector('[data-testid="workflow-chip"]'))).toBe(true)
    expect(surface?.contains(permission)).toBe(true)
    expect(surface?.contains(runtimeControls)).toBe(true)
    expect(surface?.contains(send)).toBe(true)
  })

  it("keeps the optional output rate inside the input without changing its layout", () => {
    const view = mountComposer({ outputRate: null })
    const surface = view.container.querySelector("[data-composer-surface]")
    const inputRow = view.textarea.parentElement?.parentElement
    const inputClass = view.textarea.className
    const inputPadding = view.textarea.style.paddingRight

    expect(surface?.contains(inputRow ?? null)).toBe(true)
    expect(inputRow?.className).toContain("relative")
    expect(inputPadding).toBe("128px")
    expect(inputRow?.querySelector("[data-output-rate]")).toBeNull()

    act(() => mountedRoots.at(-1)?.render(<Composer {...view.props} outputRate={18.3} />))
    const rate = inputRow?.querySelector<HTMLElement>("[data-output-rate]")
    expect(rate?.textContent?.trim()).toBe("约 18.3 token/秒")
    expect(rate?.title).toBe("根据流式文本估算，不用于计费")
    expect(rate?.className).toContain("absolute")
    expect(rate?.className).not.toContain("pointer-events-none")
    expect(view.textarea.parentElement?.parentElement).toBe(inputRow)
    expect(view.textarea.className).toBe(inputClass)
    expect(view.textarea.style.paddingRight).toBe(inputPadding)

    act(() => mountedRoots.at(-1)?.render(<Composer {...view.props} outputRate={null} />))
    expect(inputRow?.querySelector("[data-output-rate]")).toBeNull()
    expect(view.textarea.parentElement?.parentElement).toBe(inputRow)
    expect(view.textarea.className).toBe(inputClass)
    expect(view.textarea.style.paddingRight).toBe(inputPadding)
  })

  it.each([
    ["native composition", { isComposing: true }],
    ["legacy IME key code", { keyCode: 229 }],
  ])("does not submit Enter during %s", (_label, eventInit) => {
    const onSubmit = vi.fn()
    const { textarea } = mountComposer({ onSubmit })

    for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }]) {
      expect(dispatchSubmitShortcut(textarea, { ...eventInit, ...modifiers }).defaultPrevented).toBe(false)
    }

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each([{}, { ctrlKey: true }, { metaKey: true }])("submits once for Enter with modifiers %j", (modifiers) => {
    const onSubmit = vi.fn()
    const { textarea } = mountComposer({ onSubmit })

    expect(dispatchSubmitShortcut(textarea, modifiers).defaultPrevented).toBe(true)

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it.each([{}, { ctrlKey: true }, { metaKey: true }])("inserts a newline for Shift+Enter with modifiers %j", (modifiers) => {
    const { textarea, props } = mountComposer()
    expect(dispatchSubmitShortcut(textarea, { ...modifiers, shiftKey: true }).defaultPrevented).toBe(true)
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it.each<Partial<ComponentProps<typeof Composer>>>([
    { draft: "  \n " },
    { submissionPending: true },
    { sending: true },
    { sending: true, onQueueModeChange: vi.fn(), submissionPending: true },
    { sending: true, onQueueModeChange: vi.fn(), draft: "" },
  ])("keeps guarded Enter submission safe: %j", (overrides) => {
    const { textarea, props } = mountComposer(overrides)
    expect(dispatchSubmitShortcut(textarea).defaultPrevented).toBe(true)
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it.each<Partial<ComponentProps<typeof Composer>>>([
    { attachments: [{ id: "image", name: "image.png", url: "data:image/png;base64," }] },
    { selectedWorkflow: { name: "review", content: "Review the change" } },
  ])("submits non-text content through the same handler: %j", (overrides) => {
    const { textarea, props } = mountComposer({ ...overrides, draft: "" })
    dispatchSubmitShortcut(textarea)
    expect(props.onSubmit).toHaveBeenCalledOnce()
  })

  it("lets the open slash picker select on Enter without sending", () => {
    const onPick = vi.fn()
    const { textarea, props } = mountComposer({ draft: "/goal", slashQuery: "goal", onPickGoal: onPick })
    expect(dispatchSubmitShortcut(textarea, { isComposing: true }).defaultPrevented).toBe(false)
    expect(dispatchSubmitShortcut(textarea, { keyCode: 229 }).defaultPrevented).toBe(false)
    expect(onPick).not.toHaveBeenCalled()
    expect(dispatchSubmitShortcut(textarea).defaultPrevented).toBe(true)
    expect(onPick).toHaveBeenCalledOnce()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it("routes picker keys only to their own pane, leaving parameter textareas and IME alone", () => {
    const first = mountComposer({ draft: "/goal", slashQuery: "goal", onPickGoal: vi.fn() })
    const second = mountComposer({ draft: "/goal", slashQuery: "goal", onPickGoal: vi.fn() })
    const parameters = document.body.appendChild(document.createElement("textarea"))
    expect(first.textarea.id).not.toBe(second.textarea.id)
    expect(dispatchSubmitShortcut(parameters).defaultPrevented).toBe(false)
    expect(dispatchSubmitShortcut(second.textarea, { isComposing: true }).defaultPrevented).toBe(false)
    expect(dispatchSubmitShortcut(second.textarea, { keyCode: 229 }).defaultPrevented).toBe(false)
    dispatchSubmitShortcut(second.textarea)
    expect(first.props.onPickGoal).not.toHaveBeenCalled()
    expect(second.props.onPickGoal).toHaveBeenCalledOnce()
    expect(second.props.onSubmit).not.toHaveBeenCalled()
    dispatchSubmitShortcut(first.textarea)
    expect(first.props.onPickGoal).toHaveBeenCalledOnce()
  })

  it("shows a disabled pending control without exposing the generation stop action", () => {
    const onStop = vi.fn()
    const { container, inputRef, textarea } = mountComposer({
      onStop,
      sending: true,
      submissionPending: true,
    })

    const pendingButton = container.querySelector<HTMLButtonElement>('button[aria-label="正在发送"]')
    expect(pendingButton?.disabled).toBe(true)
    expect(container.querySelector('button[aria-label="停止生成"]')).toBeNull()
    expect(container.querySelector('button[aria-label="发送消息"]')).toBeNull()
    expect(textarea.getAttribute("aria-busy")).toBe("true")
    expect(inputRef.current?.focus).toBeTypeOf("function")

    act(() => pendingButton?.click())
    expect(onStop).not.toHaveBeenCalled()
  })

  it("exposes distinct accessible actions for generation and idle states", () => {
    const sendingView = mountComposer({ sending: true })
    const stop = sendingView.container.querySelector<HTMLButtonElement>('button[aria-label="停止生成"]')
    expect(stop).not.toBeNull()
    expect(stop?.className).toContain("bg-primary")
    expect(stop?.className).toContain("text-primary-foreground")
    expect(stop?.querySelector("svg")?.getAttribute("fill")).toBe("white")
    expect(stop?.querySelector("svg")?.getAttribute("stroke")).toBe("white")

    const idleView = mountComposer()
    expect(idleView.container.querySelector('button[aria-label="发送消息"]')).not.toBeNull()
    expect(idleView.textarea.getAttribute("aria-busy")).toBe("false")
  })
})

it("offers queue submission and Stop together while generating", () => {
  const { container, props, textarea } = mountComposer({ sending: true, queueMode: "after_round", onQueueModeChange: vi.fn() })
  expect(container.querySelector('button[aria-label="加入队列"]')).not.toBeNull()
  expect(container.querySelector('button[aria-label="停止生成"]')).not.toBeNull()
  const timing = container.querySelector<HTMLSelectElement>('select[aria-label="发送时机"]')
  expect(timing?.title).toBe("当前工具调用完成后、下一次模型调用前发送")
  expect(timing?.selectedOptions[0]?.textContent).toBe("工具调用后")
  dispatchSubmitShortcut(textarea)
  expect(props.onSubmit).toHaveBeenCalledOnce()
})

describe("Composer new-chat project chip", () => {
  it("shows the project chip for new chats and hides the manual workspace button once a project is selected", () => {
    useAppStore.setState({
      projectsAvailable: true,
      projects: {
        p1: {
          id: "p1", name: "Zenith", status: "active", revision: 1, resource_revision: 1,
          project_path: "/tmp/zenith", project_path_status: "configured", workspace_count: 1,
          created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
          schema_version: 2, workspace_bindings: [],
        },
      },
    })

    const bare = mountComposer({ hasSession: false })
    expect(bare.container.textContent).toContain("选择项目")
    expect(bare.container.textContent).toContain("选择工作目录")

    const picked = mountComposer({ hasSession: false, selectedProjectId: "p1" })
    expect(picked.container.textContent).toContain("Zenith")
    const workspaceButton = [...picked.container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("工作目录"),
    )
    expect(workspaceButton?.className).toContain("hidden")

    useAppStore.setState({ projects: {}, projectsAvailable: null })
  })

  it("hides the project chip entirely when the backend has no Project API", () => {
    useAppStore.setState({ projectsAvailable: false, projects: {} })
    const view = mountComposer({ hasSession: false })
    expect(view.container.textContent).not.toContain("选择项目")
    useAppStore.setState({ projectsAvailable: null })
  })
})

describe("Composer new-chat prompt chip", () => {
  it("uses the real default preset without rendering a duplicate fallback option", () => {
    useAppStore.setState({
      lastSelectedPromptId: null,
      systemPrompts: [{
        id: "general_assistant",
        name: "Bodhi",
        content: "Default Bodhi prompt",
        isDefault: true,
      }],
    })

    const { container } = mountComposer({ hasSession: false })
    const trigger = container.querySelector<HTMLButtonElement>('button[title="系统提示词:Bodhi"]')

    expect(trigger?.textContent).toContain("Bodhi")
    expect(trigger?.textContent).not.toContain("默认提示词")

    act(() => {
      trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })
    const options = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .map((item) => item.textContent?.trim())

    expect(options).toEqual(["Bodhi"])
  })
})

it("formats the output rate with the selected UI locale instead of the French browser locale", async () => {
  vi.spyOn(window.navigator, "language", "get").mockReturnValue("fr-FR")
  const view = mountComposer({ outputRate: 1234.5 })
  await act(async () => { await changeLocale("en-US") })
  expect(view.container.querySelector("[data-output-rate]")?.textContent).toContain("1,234.5")
  await act(async () => { await changeLocale("fr-FR") })
  expect(view.container.querySelector("[data-output-rate]")?.textContent).toContain((1234.5).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
  vi.restoreAllMocks()
})


it("routes @file Enter only to the owning composer in split panes", async () => {
  const files = [{ name: "README.md", path: "README.md", is_directory: false }]
  const first = mountComposer({ draft: "@re", displayWorkspace: "/first", workspaceFiles: files })
  const second = mountComposer({ draft: "@re", displayWorkspace: "/second", workspaceFiles: files })
  const editor = (element: HTMLElement) => (element as HTMLElement & { editor: Editor }).editor
  await act(async () => {
    editor(first.textarea).commands.setTextSelection(4)
    editor(second.textarea).commands.setTextSelection(4)
    editor(second.textarea).view.focus()
    await Promise.resolve()
  })
  expect(first.container.querySelector('[role="listbox"]')).not.toBeNull()
  expect(second.container.querySelector('[role="listbox"]')).not.toBeNull()
  await act(async () => { dispatchSubmitShortcut(second.textarea); await Promise.resolve() })
  expect(first.container.querySelector('[data-type="mention"]')).toBeNull()
  expect(second.container.querySelector('[data-type="mention"]')?.textContent).toBe("@README.md")
  expect(first.props.onSubmit).not.toHaveBeenCalled()
  expect(second.props.onSubmit).not.toHaveBeenCalled()
})
