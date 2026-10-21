import { act, useLayoutEffect, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { captureWorkbenchFocusReturn } from "@/lib/workbenchFocusReturn"
import { CommandPalette } from "./CommandPalette"
import { uiText } from "@shared/i18n/ui"

let root: Root
let container: HTMLDivElement
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
environment.IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("CommandPalette session scope", () => {
  it("keeps action-first ordering and the existing fifty-root limit", () => {
    act(() => root.render(<CommandPalette open onClose={vi.fn()} onSelect={vi.fn()} onSettings={vi.fn()} onNewChat={vi.fn()}
      chats={Array.from({ length: 55 }, (_, index) => ({ id: `session-${index}`, title: `Session ${index}` }))} />))
    const options = [...container.querySelectorAll('[role="option"]')].map((option) => option.textContent)
    expect(options).toHaveLength(52)
    expect(options.slice(0, 3)).toEqual([uiText("new_conversation_6897a8ef"), uiText("system_settings_68ea5dd4"), "Session 0"])
    expect(options.at(-1)).toBe("Session 49")
  })

  it("uses Command navigation without looping and picks the current live result", () => {
    const onSelect = vi.fn()
    const render = (chats: Array<{ id: string; title: string }>) => act(() => root.render(
      <CommandPalette open chats={chats} onClose={vi.fn()} onSelect={onSelect} onSettings={vi.fn()} onNewChat={vi.fn()} />,
    ))
    render([{ id: "alpha", title: "Alpha" }, { id: "beta", title: "Beta" }])
    const input = container.querySelector("input")!
    const key = (value: string) => act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })))
    const active = () => container.querySelector('[role="option"][aria-selected="true"]')?.textContent
    expect(input.getAttribute("aria-activedescendant")).toBe(container.querySelector('[role="option"][aria-selected="true"]')?.id)
    key("ArrowUp")
    expect(active()).toBe(uiText("new_conversation_6897a8ef"))
    key("End")
    expect(active()).toBe("Beta")
    key("ArrowDown")
    expect(active()).toBe("Beta")
    render([{ id: "gamma", title: "Gamma" }])
    key("End")
    key("Enter")
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("gamma")
  })

  it("keeps IME navigation, confirmation and Escape out of the command list", () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    act(() => root.render(<CommandPalette open chats={[{ id: "a", title: "中文一" }, { id: "b", title: "中文二" }]}
      onClose={onClose} onSelect={onSelect} onSettings={vi.fn()} onNewChat={vi.fn()} />))
    const input = container.querySelector("input")!
    act(() => {
      input.focus()
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "中" }))
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "中文")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const active = input.getAttribute("aria-activedescendant")
    for (const key of ["ArrowDown", "Enter", "Escape"]) {
      act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })))
    }
    expect(input.getAttribute("aria-activedescendant")).toBe(active)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    act(() => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" })))
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true })))
    expect(onSelect).not.toHaveBeenCalled()
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("a")
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("keeps an empty search open and never confirms a previously highlighted item", () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const onNewChat = vi.fn()
    act(() => root.render(<CommandPalette open chats={[{ id: "a", title: "Alpha" }]}
      onClose={onClose} onSelect={onSelect} onSettings={vi.fn()} onNewChat={onNewChat} />))
    const input = container.querySelector("input")!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "no matching result")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(container.querySelector('[role="status"]')?.textContent).toBe(uiText("no_matches_7a54f3fc"))
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0)
    expect(input.hasAttribute("aria-activedescendant")).toBe(false)
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })))
    expect(onSelect).not.toHaveBeenCalled()
    expect(onNewChat).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("preserves a new search entered immediately when the palette reopens", () => {
    const onSettings = vi.fn()
    const onNewChat = vi.fn()
    const query = uiText("system_settings_68ea5dd4")
    const setInput = (value: string) => {
      const input = container.querySelector("input")!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }
    function ImmediateSearch({ enabled }: { enabled: boolean }) {
      useLayoutEffect(() => { if (enabled) setInput(query) }, [enabled])
      return null
    }
    const render = (open: boolean, immediate = false) => act(() => root.render(<>
      <CommandPalette open={open} chats={[{ id: "root", title: "Root session" }]}
        onClose={vi.fn()} onSelect={vi.fn()} onSettings={onSettings} onNewChat={onNewChat} />
      <ImmediateSearch enabled={immediate} />
    </>))
    render(true)
    act(() => setInput("Root session"))
    expect(container.querySelector("input")?.value).toBe("Root session")
    render(false)
    render(true, true)
    expect(container.querySelector("input")?.value).toBe(query)
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1)
    act(() => container.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
    expect(onSettings).toHaveBeenCalledOnce()
    expect(onNewChat).not.toHaveBeenCalled()
  })

  it("offers roots but not preserved child rows in the global switcher", () => {
    const onSelect = vi.fn()
    act(() => root.render(
      <CommandPalette
        open
        onClose={vi.fn()}
        chats={[
          { id: "root", title: "Root session", parentSessionId: null },
          { id: "stale-child", title: "Stale child", kind: "child", parentSessionId: "root" },
          { id: "legacy-child", title: "Legacy child", kind: "child", parentSessionId: null },
        ]}
        onSelect={onSelect}
        onNewChat={vi.fn()}
        onSettings={vi.fn()}
      />
    ))

    expect(container.textContent).toContain("Root session")
    expect(container.textContent).not.toContain("Stale child")
    expect(container.textContent).not.toContain("Legacy child")
    const rootButton = [...container.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((button) => button.textContent?.includes("Root session"))
    expect(rootButton).toBeDefined()
    act(() => rootButton!.click())
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("root")
  })
})


it.each([false, true])("dismisses on the backdrop and preserves a newer focus target: %s", async (newFocus) => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return <><button onClick={() => setOpen(true)}>Open commands</button><button>Next target</button>
      <CommandPalette open={open} onClose={() => setOpen(false)} chats={[]} onSelect={vi.fn()} onNewChat={vi.fn()} onSettings={vi.fn()} /></>
  }
  act(() => root.render(<Harness />))
  const [opener, next] = container.querySelectorAll<HTMLButtonElement>("button")
  await act(async () => { opener.focus(); opener.click() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  const overlay = container.querySelector('[role="dialog"]')!.parentElement!
  await act(async () => {
    overlay.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    overlay.click()
  })
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  if (newFocus) act(() => next.focus())
  await vi.waitFor(() => expect(document.activeElement).toBe(newFocus ? next : opener))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  expect(document.activeElement).toBe(newFocus ? next : opener)
})

it.each(["return", "new-focus", "new-scope", "removed", "hidden"])("resolves a vanished drag preview without stealing navigation focus: %s", async (outcome) => {
  vi.useFakeTimers()
  try {
    let scope = "original"
    let resolveTarget: () => HTMLElement | null = () => null
    const render = (open: boolean) => act(() => root.render(<>
      <aside id="right-workbench" tabIndex={-1}><button data-workbench-tab-handle="tool:session">Duplicate title</button></aside>
      <input aria-label="New destination" />
      <CommandPalette open={open} getReturnFocusTarget={resolveTarget} onClose={vi.fn()} chats={[]} onSelect={vi.fn()} onNewChat={vi.fn()} onSettings={vi.fn()} />
    </>))
    render(false)
    const panel = container.querySelector<HTMLElement>("aside")!
    const handle = panel.querySelector<HTMLButtonElement>("button")!
    const next = container.querySelector<HTMLInputElement>('input[aria-label="New destination"]')!
    const preview = handle.cloneNode(true) as HTMLButtonElement
    container.appendChild(preview)
    preview.focus()
    resolveTarget = captureWorkbenchFocusReturn(preview, scope, () => scope)
    preview.remove()
    panel.focus()
    render(true)
    render(false)
    // Model the fallback/navigation focus before Radix's deferred close autofocus.
    // An async act here can already finish autofocus before this setup runs.
    if (outcome === "new-scope") scope = "new-session"
    if (outcome === "removed") handle.remove()
    if (outcome === "hidden") panel.hidden = true
    if (outcome === "new-focus") next.focus()
    else panel.focus()
    await act(async () => { await vi.runAllTimersAsync() })
    expect(document.activeElement).toBe(outcome === "return" ? handle : outcome === "new-focus" ? next : panel)
  } finally {
    vi.useRealTimers()
  }
})
