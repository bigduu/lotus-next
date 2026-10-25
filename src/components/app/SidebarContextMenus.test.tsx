import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/ui"
import { SessionRow } from "@/components/chat/SessionRow"
import { ProjectGroupHeader } from "./ProjectGroupHeader"
import { ProjectSectionHeader } from "./ProjectSectionHeader"
import { SupervisorEntry } from "./SupervisorEntry"
import type { ProjectManifest } from "@services/project"
import type { ChatItem } from "@shared/types/chatMessages"

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
environment.IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
const action = vi.fn()

beforeEach(() => {
  action.mockReset()
  container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
function render(node: ReactNode) {
  act(() => root.render(node))
  return container.querySelector("button")!
}
async function context(button: HTMLElement, keyboard?: string) {
  await act(async () => button.dispatchEvent(keyboard
    ? new KeyboardEvent("keydown", { key: keyboard, shiftKey: keyboard === "F10", bubbles: true, cancelable: true })
    : new MouseEvent("contextmenu", { bubbles: true, cancelable: true })))
}
const session = () => <SessionRow chat={{ id: "session", title: "Session" }} active={false}
  onSelect={action} onRename={action} onDelete={action} onTogglePin={action} onCopySessionId={action} />
const fixtures = {
  session,
  project: () => <ProjectGroupHeader project={{ id: "project", name: "Project", status: "active" } as ProjectManifest}
    label="Project" sessionCount={1} expanded contentId="content" disabled={false} pinned={false}
    onToggleExpanded={action} onNewChat={action} onEdit={action} onTogglePin={action}
    onCreateSection={action} onManageSections={action} onReveal={action} onArchive={action} />,
  section: () => <ProjectSectionHeader onManageSections={action}><button onClick={action}>Section</button></ProjectSectionHeader>,
  supervisor: () => <SupervisorEntry chat={{ id: "supervisor", title: "Supervisor" } as ChatItem}
    active={false} unread={false} busy={false} disabled={false} onSelect={action} onRename={action} />,
}

describe("sidebar item context menus", () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    for (const keyboard of [undefined, "ContextMenu", "F10"]) {
      it(`${name} opens from ${keyboard ?? "right click"} without activating the row and restores focus`, async () => {
        const button = render(fixture())
        button.focus()
        await context(button, keyboard)
        expect(document.querySelector('[role="menu"]')).not.toBeNull()
        expect(document.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0)
        expect(action).not.toHaveBeenCalled()
        await act(async () => {
          document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
          await new Promise((resolve) => setTimeout(resolve, 10))
        })
        expect(document.querySelector('[role="menu"]')).toBeNull()
        await vi.waitFor(() => expect(document.activeElement).toBe(button))
      })
    }
  }
  for (const [name, fixture] of Object.entries(fixtures)) {
    it(`${name} has identical context and explicit action menus`, async () => {
      const button = render(fixture())
      await context(button)
      const contextActions = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
      await act(async () => {
        document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
      const trigger = container.querySelector<HTMLElement>('[aria-haspopup="menu"]')!
      await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })))
      expect([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(contextActions)
    })
  }
  it("reuses session actions and keeps inline rename selectable", async () => {
    const button = render(session())
    expect(button.closest('[data-sidebar-session]')?.classList.contains("select-none")).toBe(true)
    await context(button)
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    await act(async () => items.find((item) => item.textContent?.trim() === uiText("rename_0d0cbac2"))!.click())
    const input = container.querySelector("input")!
    expect(input).not.toBeNull()
    expect(input.closest(".select-none")).toBeNull()
    await context(input)
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(action).not.toHaveBeenCalled()
  })
  it("section management calls the existing action", async () => {
    await context(render(fixtures.section()))
    await act(async () => document.querySelector<HTMLElement>('[role="menuitem"]')!.click())
    expect(action).toHaveBeenCalledTimes(1)
  })
  it("supervisor keeps rename and offers session management and Project-scope review entries", async () => {
    await context(render(fixtures.supervisor()))
    expect([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual([
      uiText("supervisor_rename"), uiText("supervisor_sessions_manage"), uiText("supervisor_scope_title"), uiText("conversation_clear_action"),
    ])
    await act(async () => document.querySelector<HTMLElement>('[role="menuitem"]')!.click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.querySelector("input")?.closest(".select-none")).toBeNull()
    expect(action).not.toHaveBeenCalled()
  })
})
