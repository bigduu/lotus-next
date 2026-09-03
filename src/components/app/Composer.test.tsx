import { act, createRef, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { Composer } from "./Composer"

const mountedRoots: Root[] = []
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT")
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
  options: { isComposing?: boolean; keyCode?: number } = {},
) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Enter",
    ctrlKey: true,
    isComposing: options.isComposing,
  })
  if (options.keyCode !== undefined) {
    Object.defineProperty(event, "keyCode", { value: options.keyCode })
  }
  act(() => textarea.dispatchEvent(event))
}

describe("Composer submission controls", () => {
  it.each([
    ["native composition", { isComposing: true }],
    ["legacy IME key code", { keyCode: 229 }],
  ])("does not submit the Cmd/Ctrl+Enter shortcut during %s", (_label, eventInit) => {
    const onSubmit = vi.fn()
    const { textarea } = mountComposer({ onSubmit })

    dispatchSubmitShortcut(textarea, eventInit)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("submits once for a normal Cmd/Ctrl+Enter shortcut", () => {
    const onSubmit = vi.fn()
    const { textarea } = mountComposer({ onSubmit })

    dispatchSubmitShortcut(textarea)

    expect(onSubmit).toHaveBeenCalledTimes(1)
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
