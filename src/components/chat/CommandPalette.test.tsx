import { act, useLayoutEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
    expect(container.querySelectorAll("button")).toHaveLength(1)
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
    const rootButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Root session"))
    expect(rootButton).toBeDefined()
    act(() => rootButton!.click())
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("root")
  })
})
