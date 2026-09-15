import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CommandPalette } from "./CommandPalette"

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
