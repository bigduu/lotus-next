import { act, createRef, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { Composer } from "./Composer"

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
})

function mountComposer(overrides: Partial<ComponentProps<typeof Composer>> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  const inputRef = createRef<HTMLTextAreaElement>()
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
    atQuery: null,
    displayWorkspace: null,
    workspaceFiles: [],
    onPickFile: vi.fn(),
    hasSession: true,
    onOpenWorkspacePicker: vi.fn(),
    onDismissMenus: vi.fn(),
    ...overrides,
  }

  act(() => root.render(<Composer {...props} />))

  const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="消息"]')
  expect(textarea).not.toBeNull()
  return { container, inputRef, props, textarea: textarea! }
}

function dispatchSubmitShortcut(
  textarea: HTMLTextAreaElement,
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

  it.each([{}, { ctrlKey: true }, { metaKey: true }])("leaves Shift+Enter to insert a newline with modifiers %j", (modifiers) => {
    const { textarea, props } = mountComposer()
    expect(dispatchSubmitShortcut(textarea, { ...modifiers, shiftKey: true }).defaultPrevented).toBe(false)
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

  it.each(["slash", "file"])("lets the open %s picker select on Enter without sending", (picker) => {
    const onPick = vi.fn()
    const { textarea, props } = mountComposer(picker === "slash" ? {
      draft: "/goal", slashQuery: "goal", onPickGoal: onPick,
    } : {
      draft: "@read", atQuery: "read", displayWorkspace: "/workspace", onPickFile: onPick,
      workspaceFiles: [{ name: "README.md", path: "README.md", is_directory: false }],
    })
    // The real window capture listener must leave IME and Shift+Enter alone.
    expect(dispatchSubmitShortcut(textarea, { isComposing: true }).defaultPrevented).toBe(false)
    expect(dispatchSubmitShortcut(textarea, { keyCode: 229 }).defaultPrevented).toBe(false)
    expect(dispatchSubmitShortcut(textarea, { shiftKey: true }).defaultPrevented).toBe(false)
    expect(onPick).not.toHaveBeenCalled()
    expect(dispatchSubmitShortcut(textarea).defaultPrevented).toBe(true)
    expect(onPick).toHaveBeenCalledOnce()
    expect(props.onSubmit).not.toHaveBeenCalled()
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
    expect(inputRef.current).toBe(textarea)

    act(() => pendingButton?.click())
    expect(onStop).not.toHaveBeenCalled()
  })

  it("exposes distinct accessible actions for generation and idle states", () => {
    const sendingView = mountComposer({ sending: true })
    expect(sendingView.container.querySelector('button[aria-label="停止生成"]')).not.toBeNull()

    const idleView = mountComposer()
    expect(idleView.container.querySelector('button[aria-label="发送消息"]')).not.toBeNull()
    expect(idleView.textarea.getAttribute("aria-busy")).toBe("false")
  })
})

it("offers queue submission and Stop together while generating", () => {
  const { container, props, textarea } = mountComposer({ sending: true, queueMode: "after_round", onQueueModeChange: vi.fn() })
  expect(container.querySelector('button[aria-label="加入队列"]')).not.toBeNull()
  expect(container.querySelector('button[aria-label="停止生成"]')).not.toBeNull()
  dispatchSubmitShortcut(textarea)
  expect(props.onSubmit).toHaveBeenCalledOnce()
})
