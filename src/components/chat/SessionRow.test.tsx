import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { SessionRow } from "./SessionRow"
import { SIDEBAR_SESSION_DRAG_TYPE } from "@/lib/projectSidebarPreferences"

it("makes unassigned sessions draggable and suppresses post-drag pointer clicks, preserving later selection", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host)
  const select = vi.fn(); const noop = () => {}
  act(() => root.render(<SessionRow chat={{ id: "unassigned", title: "Draft" }} active={false} onSelect={select} onRename={noop} onDelete={noop} onTogglePin={noop} onCopySessionId={noop} />))
  const row = host.querySelector<HTMLElement>("[data-sidebar-session]")!
  const button = row.querySelector("button")!
  expect(row.draggable).toBe(true)
  const setData = vi.fn(); const dataTransfer = { setData, effectAllowed: "none" }
  const event = new Event("dragstart", { bubbles: true }); Object.defineProperty(event, "dataTransfer", { value: dataTransfer })
  act(() => row.dispatchEvent(event))
  expect(setData).toHaveBeenCalledWith(SIDEBAR_SESSION_DRAG_TYPE, JSON.stringify({ projectId: null, sessionId: "unassigned" }))
  expect(dataTransfer.effectAllowed).toBe("copyMove")
  act(() => { row.dispatchEvent(new Event("dragend", { bubbles: true })); button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })) })
  expect(select).not.toHaveBeenCalled()
  act(() => { button.dispatchEvent(new Event("pointerdown", { bubbles: true })); button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })) })
  expect(select).toHaveBeenCalledTimes(1)
  act(() => root.unmount()); host.remove()
})

it("keeps selected-row emphasis and actions stable when a running session finishes", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host)
  const noop = () => {}
  const render = (running: boolean) => act(() => root.render(<>
    <SessionRow key="first" chat={{ id: "first", title: "First", isRunning: running }} active onSelect={noop} onRename={noop} onDelete={noop} onTogglePin={noop} onCopySessionId={noop} />
    <SessionRow key="second" chat={{ id: "second", title: "Second" }} active={false} onSelect={noop} onRename={noop} onDelete={noop} onTogglePin={noop} onCopySessionId={noop} />
  </>))
  render(true)
  const selected = host.querySelector('[data-sidebar-session="first"]')!
  const selectedClasses = selected.className
  expect((selected as HTMLElement).style.boxShadow).toContain("inset")
  expect(selectedClasses).toContain("feedback-motion")
  expect(selected.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.style.opacity).toBe("1")
  expect(selected.querySelector('[aria-haspopup="menu"]')?.className).toContain("group-focus-within/row:opacity-100")
  render(false)
  expect(host.querySelector('[data-sidebar-session="first"]')).toBe(selected)
  expect(selected.className).toBe(selectedClasses)
  expect([...host.querySelectorAll('[data-sidebar-session]')].map((row) => row.getAttribute("data-sidebar-session"))).toEqual(["first", "second"])
  expect(selected.querySelector('[aria-current="page"]')).not.toBeNull()
  act(() => root.unmount()); host.remove()
})
