import { createContext, createSignal, flush, onSettled, Show, useContext } from "solid-js"
import { render, type ComponentProps, type JSX } from "@solidjs/web"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { captureWorkbenchFocusReturn } from "@/lib/workbenchFocusReturn"
import type { ChatItem } from "@shared/types/chatMessages"
import { uiText } from "@shared/i18n/text"
import { CommandPalette } from "./CommandPalette"

vi.mock("@lucide/solid", () => {
  const Icon = () => <svg aria-hidden="true" />
  return { MessageSquare: Icon, Plus: Icon, Search: Icon, Settings: Icon }
})

// Browser tests own the real Kobalte portal, backdrop, and focus lifecycle.
// The keyboard and return-focus logic in the palette and Command is real here.
vi.mock("../ui/dialog", () => {
  const ChangeOpen = createContext<(open: boolean) => void>()
  type Children = { children: JSX.Element }
  return {
    Dialog: (props: Children & { open: boolean; onOpenChange: (open: boolean) => void }) =>
      <Show when={props.open}><ChangeOpen value={props.onOpenChange}>{props.children}</ChangeOpen></Show>,
    DialogContent: (props: Children & { onCloseAutoFocus: (event: Event) => void; onEscapeKeyDown: (event: KeyboardEvent) => void }) => {
      const change = useContext(ChangeOpen)
      let panel!: HTMLDivElement
      onSettled(() => {
        panel.querySelector("input")?.focus()
        return () => {
          setTimeout(() => props.onCloseAutoFocus(new Event("focus", { cancelable: true })), 0)
        }
      })
      return <div data-slot="dialog-overlay" onClick={(event) => {
        if (event.target === event.currentTarget && event.button === 0) change(false)
      }}><div role="dialog" ref={(element) => { panel = element }} onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          props.onEscapeKeyDown(event)
          if (!event.defaultPrevented) change(false)
        }
      }}>{props.children}</div></div>
    },
    DialogTitle: (props: Children) => <h2>{props.children}</h2>,
  }
})

type PaletteProps = ComponentProps<typeof CommandPalette>
const chat = (id: string, title: string, identity?: Pick<ChatItem, "kind" | "parentSessionId">): ChatItem => ({
  id, title, ...identity, createdAt: 0, messages: [],
  config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null },
})
const makeActions = () => ({
  onClose: vi.fn(), onSelect: vi.fn(), onSettings: vi.fn(), onNewChat: vi.fn(), getReturnFocusTarget: () => null,
})
let container: HTMLDivElement
let dispose: (() => void) | undefined
const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")
beforeEach(() => {
  container = document.body.appendChild(document.createElement("div"))
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() })
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  container.remove()
  if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scroll)
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
  vi.useRealTimers()
})

function mount(view: () => JSX.Element) {
  dispose = render(view, container)
  flush()
}
function palette(options: Partial<PaletteProps> = {}) {
  const [open, setOpen] = createSignal(true)
  const [props, setProps] = createSignal<PaletteProps>({ chats: [], ...makeActions(), ...options })
  mount(() => <Show when={open()}><CommandPalette {...props()} /></Show>)
  return {
    actions: props(),
    open: (value: boolean) => { setOpen(value); flush() },
    update: (value: Partial<PaletteProps>) => { setProps((previous) => ({ ...previous, ...value })); flush() },
  }
}
const input = () => container.querySelector<HTMLInputElement>('[role="combobox"]')!
const options = () => [...container.querySelectorAll('[role="option"]')].map((option) => option.textContent)
const active = () => container.querySelector('[role="option"][aria-selected="true"]')
const press = (key: string, keyCode?: number) => {
  input().dispatchEvent(new KeyboardEvent("keydown", { key, keyCode, bubbles: true, cancelable: true }))
  flush()
}
const search = (value: string) => {
  input().value = value
  input().dispatchEvent(new Event("input", { bubbles: true }))
  flush()
}

describe("CommandPalette session scope", () => {
  it("keeps action-first ordering and the existing fifty-root limit", () => {
    palette({ chats: Array.from({ length: 55 }, (_, index) => chat(`session-${index}`, `Session ${index}`)) })
    expect(options()).toHaveLength(52)
    expect(options().slice(0, 3)).toEqual([uiText("new_conversation_6897a8ef"), uiText("system_settings_68ea5dd4"), "Session 0"])
    expect(options().at(-1)).toBe("Session 49")
  })

  it("uses Command navigation without looping and picks the current live result", () => {
    const onSelect = vi.fn(), onClose = vi.fn()
    const view = palette({ chats: [chat("alpha", "Alpha"), chat("beta", "Beta")], onSelect, onClose })
    expect(input().getAttribute("aria-activedescendant")).toBe(active()?.id)
    press("ArrowUp")
    expect(active()?.textContent).toBe(uiText("new_conversation_6897a8ef"))
    press("End")
    expect(active()?.textContent).toBe("Beta")
    press("ArrowDown")
    expect(active()?.textContent).toBe("Beta")
    press("Home")
    expect(active()?.textContent).toBe(uiText("new_conversation_6897a8ef"))
    view.update({ chats: [chat("gamma", "Gamma")] })
    press("End")
    press("Enter")
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("gamma")
    expect(onClose).toHaveBeenCalledOnce()
    expect(onSelect.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0])
  })

  it("keeps IME navigation, confirmation and Escape out of the command list", () => {
    const onSelect = vi.fn(), onClose = vi.fn()
    palette({ chats: [chat("a", "中文一"), chat("b", "中文二")], onSelect, onClose })
    input().focus()
    input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "中" }))
    search("中文")
    const selected = input().getAttribute("aria-activedescendant")
    for (const key of ["ArrowDown", "Home", "End", "Enter", "Escape"]) press(key)
    expect(input().getAttribute("aria-activedescendant")).toBe(selected)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" }))
    press("Enter", 229)
    expect(onSelect).not.toHaveBeenCalled()
    press("Enter")
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("a")
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("keeps an empty search open and never confirms a previously highlighted item", () => {
    const { actions } = palette({ chats: [chat("a", "Alpha")] })
    search("no matching result")
    expect(container.querySelector('[role="status"]')?.textContent).toBe(uiText("no_matches_7a54f3fc"))
    expect(options()).toHaveLength(0)
    expect(input().hasAttribute("aria-activedescendant")).toBe(false)
    press("Enter")
    expect(actions.onSelect).not.toHaveBeenCalled()
    expect(actions.onNewChat).not.toHaveBeenCalled()
    expect(actions.onClose).not.toHaveBeenCalled()
  })

  it("preserves a new search entered immediately when the palette reopens", () => {
    const query = uiText("system_settings_68ea5dd4")
    const view = palette({ chats: [chat("root", "Root session")] })
    search("Root session")
    expect(input().value).toBe("Root session")
    view.open(false)
    view.open(true)
    search(query)
    expect(input().value).toBe(query)
    expect(options()).toEqual([query])
    press("Enter")
    expect(view.actions.onSettings).toHaveBeenCalledOnce()
    expect(view.actions.onNewChat).not.toHaveBeenCalled()
  })

  it("offers roots but not preserved child rows in the global switcher", () => {
    const { actions } = palette({ chats: [
      chat("root", "Root session", { parentSessionId: null }),
      chat("stale-child", "Stale child", { kind: "child", parentSessionId: "root" }),
      chat("legacy-child", "Legacy child", { kind: "child", parentSessionId: null }),
    ] })
    expect(container.textContent).toContain("Root session")
    expect(container.textContent).not.toContain("Stale child")
    expect(container.textContent).not.toContain("Legacy child")
    const result = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === "Root session")
    expect(result).toBeDefined()
    result!.click()
    expect(actions.onSelect).toHaveBeenCalledExactlyOnceWith("root")
  })
})

it.each([false, true])("dismisses on the backdrop and preserves a newer focus target: %s", async (newFocus) => {
  const [open, setOpen] = createSignal(false)
  const actions = makeActions()
  let opener!: HTMLButtonElement
  mount(() => <>
    <button ref={(element) => { opener = element }} onClick={() => setOpen(true)}>Open commands</button><button>Next target</button>
    <Show when={open()}><CommandPalette chats={[]} {...actions}
      onClose={() => setOpen(false)} getReturnFocusTarget={() => opener} /></Show>
  </>)
  const next = container.querySelectorAll("button")[1]
  opener.focus()
  opener.click()
  flush()
  expect(document.activeElement).toBe(input())
  const overlay = container.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!
  overlay.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
  overlay.click()
  flush()
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  if (newFocus) next.focus()
  await vi.waitFor(() => expect(document.activeElement).toBe(newFocus ? next : opener))
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(document.activeElement).toBe(newFocus ? next : opener)
})

it.each(["return", "new-focus", "new-scope", "removed", "hidden"])(
  "resolves a vanished drag preview without stealing navigation focus: %s", async (outcome) => {
    vi.useFakeTimers()
    let scope = "original"
    let resolveTarget: () => HTMLElement | null = () => null
    const [open, setOpen] = createSignal(false)
    const actions = makeActions()
    mount(() => <>
      <aside id="right-workbench" tabindex={-1}><button data-workbench-tab-handle="tool:session">Duplicate title</button></aside>
      <input aria-label="New destination" />
      <Show when={open()}><CommandPalette chats={[]} {...actions} getReturnFocusTarget={() => resolveTarget()} /></Show>
    </>)
    const panel = container.querySelector("aside")!
    const handle = panel.querySelector("button")!
    const next = container.querySelector<HTMLInputElement>('input[aria-label="New destination"]')!
    const preview = handle.cloneNode(true) as HTMLButtonElement
    container.appendChild(preview)
    preview.focus()
    resolveTarget = captureWorkbenchFocusReturn(preview, scope, () => scope)
    preview.remove()
    panel.focus()
    setOpen(true)
    flush()
    setOpen(false)
    flush()
    if (outcome === "new-scope") scope = "new-session"
    if (outcome === "removed") handle.remove()
    if (outcome === "hidden") panel.hidden = true
    if (outcome === "new-focus") next.focus()
    else panel.focus()
    await vi.runAllTimersAsync()
    expect(document.activeElement).toBe(outcome === "return" ? handle : outcome === "new-focus" ? next : panel)
  },
)
