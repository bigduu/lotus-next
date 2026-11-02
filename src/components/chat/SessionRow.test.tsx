import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/ui"
import { SessionRow } from "./SessionRow"
import { SIDEBAR_SESSION_DRAG_TYPE } from "@/lib/projectSidebarPreferences"

type RowChat = { id: string; title?: string; isRunning?: boolean; lastRunStatus?: string | null; lastRunError?: string | null }

const renderRows = (chats: RowChat[]) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host)
  const noop = () => {}
  act(() => root.render(<>
    {chats.map((chat) => <SessionRow key={chat.id} chat={chat} active={false} onSelect={noop} onRename={noop}
      onDelete={noop} onTogglePin={noop} onCopySessionId={noop} />)}
  </>))
  const row = (id: string) => host.querySelector<HTMLElement>(`[data-sidebar-session="${id}"]`)!
  const slot = (id: string) => row(id).querySelector<HTMLElement>("button > span")!
  return {
    row,
    slot,
    indicator: (id: string) => row(id).querySelector<HTMLElement>("[data-session-run-failure]"),
    cleanup: () => { act(() => root.unmount()); host.remove() },
  }
}

it("marks a session whose last run failed in red and explains the failure", () => {
  const view = renderRows([
    { id: "failed", title: "Failed", lastRunStatus: "error", lastRunError: "upstream 502 bad gateway" },
    { id: "silent", title: "Silent", lastRunStatus: "error" },
    { id: "completed", title: "Completed", lastRunStatus: "completed" },
    { id: "cancelled", title: "Cancelled", lastRunStatus: "cancelled" },
    { id: "fresh", title: "Fresh" },
  ])
  // The backend error is surfaced verbatim; without one the row still explains itself.
  expect(view.indicator("failed")?.getAttribute("title")).toBe("upstream 502 bad gateway")
  expect(view.indicator("silent")?.getAttribute("title")).toBe(uiText("session_last_run_failed_hint"))
  expect(view.indicator("failed")?.querySelector("svg")?.getAttribute("class")).toContain("text-destructive")
  expect(view.indicator("failed")?.querySelector("svg")?.getAttribute("class")).toContain("size-3.5")
  // A cancellation is a deliberate user choice, and a finished success is not a failure.
  for (const id of ["completed", "cancelled", "fresh"]) expect(view.indicator(id)).toBeNull()
  // The red marker is described for assistive tech, not colour only.
  const describedBy = view.row("failed").querySelector("button")!.getAttribute("aria-describedby")!.split(" ")
  expect(describedBy).toHaveLength(1)
  expect(view.row("failed").querySelector<HTMLElement>(`#${describedBy[0]}`)?.textContent)
    .toBe(uiText("session_last_run_failed_hint"))
  // Every row reserves the same indicator slot, so titles stay aligned across states.
  expect(["failed", "silent", "completed", "cancelled", "fresh"]
    .map((id) => view.slot(id).className).every((className) => className.includes("size-3.5"))).toBe(true)
  view.cleanup()
})

it("lets a live run outrank a stale failure and keeps the unread signal", () => {
  const view = renderRows([
    { id: "retrying", title: "Retrying", isRunning: true, lastRunStatus: "error", lastRunError: "earlier failure" },
  ])
  expect(view.indicator("retrying")).toBeNull()
  expect(view.slot("retrying").querySelector(".animate-pulse")).not.toBeNull()
  view.cleanup()

  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host)
  const noop = () => {}
  act(() => root.render(<SessionRow chat={{ id: "both", title: "Both", lastRunStatus: "error", lastRunError: "boom" }}
    active={false} unread onSelect={noop} onRename={noop} onDelete={noop} onTogglePin={noop} onCopySessionId={noop} />))
  const row = host.querySelector<HTMLElement>('[data-sidebar-session="both"]')!
  // A failed row keeps the red marker instead of the unread dot, and announces both states.
  expect(row.querySelector("[data-session-run-failure]")).not.toBeNull()
  expect(row.querySelector(".rounded-full.bg-primary")).toBeNull()
  const describedBy = row.querySelector("button")!.getAttribute("aria-describedby")!.split(" ")
  expect(describedBy).toHaveLength(2)
  expect(describedBy.map((id) => row.querySelector<HTMLElement>(`#${id}`)?.textContent))
    .toEqual([uiText("unread_messages_519491f4"), uiText("session_last_run_failed_hint")])
  act(() => root.unmount()); host.remove()
})

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

it("keeps an internal grip gesture out of the native editor drag protocol", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host)
  const noop = () => {}
  act(() => root.render(<SessionRow chat={{ id: "root", title: "Root" }} active={false} projectId="p1"
    dragHandle={<button data-sidebar-drag-handle="session:root">Move</button>}
    onSelect={noop} onRename={noop} onDelete={noop} onTogglePin={noop} onCopySessionId={noop} />))
  const row = host.querySelector<HTMLElement>("[data-sidebar-session]")!
  const handle = row.querySelector('[data-sidebar-drag-handle]')!
  const setData = vi.fn()
  act(() => handle.dispatchEvent(new Event("pointerdown", { bubbles: true })))
  const native = new Event("dragstart", { bubbles: true, cancelable: true })
  Object.defineProperty(native, "dataTransfer", { value: { setData } })
  act(() => row.dispatchEvent(native))
  expect(native.defaultPrevented).toBe(true)
  expect(setData).not.toHaveBeenCalled()
  act(() => row.querySelector('button:not([data-sidebar-drag-handle])')!.dispatchEvent(new Event("pointerdown", { bubbles: true })))
  const external = new Event("dragstart", { bubbles: true, cancelable: true })
  Object.defineProperty(external, "dataTransfer", { value: { setData } })
  act(() => row.dispatchEvent(external))
  expect(external.defaultPrevented).toBe(false)
  expect(setData).toHaveBeenCalledWith(SIDEBAR_SESSION_DRAG_TYPE, JSON.stringify({ projectId: "p1", sessionId: "root" }))
  act(() => root.unmount()); host.remove()
})

it("shows the running indicator for work in flight even when the backend reports idle", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host)
  const noop = () => {}
  const render = (running?: boolean, isRunning?: boolean) => act(() => root.render(<SessionRow
    chat={{ id: "s", title: "Session", isRunning }} active={false} running={running}
    onSelect={noop} onRename={noop} onDelete={noop} onTogglePin={noop} onCopySessionId={noop} />))
  const indicator = () => host.querySelector("[data-session-running]")

  // A background shell keeps the row alive after `is_running` went false.
  render(true, false)
  expect(indicator()?.getAttribute("aria-label")).toBe("运行中")
  expect(indicator()?.className).toContain("animate-pulse")

  // An explicit false wins over a stale backend flag.
  render(false, true)
  expect(indicator()).toBeNull()

  // Callers that only know `is_running` keep the original behaviour.
  render(undefined, true)
  expect(indicator()).not.toBeNull()
  render(undefined, false)
  expect(indicator()).toBeNull()

  act(() => root.unmount()); host.remove()
})
