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
