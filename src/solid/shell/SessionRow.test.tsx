import { createSignal, flush, For } from "solid-js"
import { render, type JSX } from "@solidjs/web"
import { afterEach, expect, it, vi } from "vitest"
import { SIDEBAR_SESSION_DRAG_TYPE } from "@/lib/projectSidebarPreferences"
import { uiText } from "@shared/i18n/text"
import type { ChatItem } from "@shared/types/chatMessages"
import { SessionRow } from "./SessionRow"

vi.mock("@lucide/solid", () => {
  const Icon = (props: Pick<JSX.IntrinsicElements["svg"], "class">) => <svg class={props.class} />
  return {
    AlertCircle: Icon, Check: Icon, Copy: Icon, GitBranch: Icon, GitMerge: Icon, List: Icon, LoaderCircle: Icon,
    MoreHorizontal: Icon, Pencil: Icon, Pin: Icon, PinOff: Icon, RotateCcw: Icon, Sparkles: Icon, Trash2: Icon,
  }
})

// Browser tests cover the actual portaled menu. The row needs its trigger
// present here to verify opacity and focus styles across a reactive update.
vi.mock("../ui/dropdown-menu", () => {
  const ignore = () => null
  return {
    DropdownMenu: (props: { children: JSX.Element }) => <>{props.children}</>,
    DropdownMenuTrigger: (props: JSX.IntrinsicElements["button"]) => <button type="button" {...props} />,
    DropdownMenuContent: ignore, DropdownMenuItem: ignore, DropdownMenuSub: ignore,
    DropdownMenuSubContent: ignore, DropdownMenuSubTrigger: ignore,
  }
})

const noop = () => {}
const actions = {
  onSelect: noop, onRename: noop, onDelete: noop, onClear: noop, onTogglePin: noop,
  onRegenerateTitle: noop, onCopySessionId: noop,
}

function chat(id: string, details: Partial<ChatItem> = {}): ChatItem {
  return {
    id, title: id, createdAt: 0, messages: [],
    config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null },
    ...details,
  }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function mount(view: () => JSX.Element) {
  const host = document.body.appendChild(document.createElement("div"))
  const dispose = render(view, host)
  flush()
  cleanups.push(() => {
    dispose()
    host.remove()
  })
  const row = (id: string) => host.querySelector<HTMLElement>(`[data-sidebar-session="${id}"]`)!
  return {
    host,
    row,
    slot: (id: string) => row(id).querySelector<HTMLElement>("button > span")!,
    indicator: (id: string) => row(id).querySelector<HTMLElement>("[data-session-run-failure]"),
  }
}

function sessionDrag() {
  const dataTransfer = { setData: vi.fn(), effectAllowed: "none" }
  const event = new Event("dragstart", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer })
  return { event, dataTransfer }
}

it("marks a session whose last run failed in red and explains the failure", () => {
  const chats = [
    chat("failed", { lastRunStatus: "error", lastRunError: "upstream 502 bad gateway" }),
    chat("silent", { lastRunStatus: "error" }),
    chat("completed", { lastRunStatus: "completed" }),
    chat("cancelled", { lastRunStatus: "cancelled" }),
    chat("fresh"),
  ]
  const view = mount(() => <For each={chats} keyed={(session) => session.id}>
    {(session) => <SessionRow chat={session()} active={false} unread={false} {...actions} />}
  </For>)
  expect(view.indicator("failed")?.getAttribute("title")).toBe("upstream 502 bad gateway")
  expect(view.indicator("silent")?.getAttribute("title")).toBe(uiText("session_last_run_failed_hint"))
  expect(view.indicator("failed")?.querySelector("svg")?.getAttribute("class")).toContain("text-destructive")
  expect(view.indicator("failed")?.querySelector("svg")?.getAttribute("class")).toContain("size-3.5")
  for (const id of ["completed", "cancelled", "fresh"]) expect(view.indicator(id)).toBeNull()
  const describedBy = view.row("failed").querySelector("button")!.getAttribute("aria-describedby")!.split(" ")
  expect(describedBy).toHaveLength(1)
  expect(view.row("failed").querySelector<HTMLElement>(`#${describedBy[0]}`)?.textContent)
    .toBe(uiText("session_last_run_failed_hint"))
  expect(chats.every((session) => view.slot(session.id).classList.contains("size-3.5"))).toBe(true)
})

it("lets a live run outrank a stale failure and keeps the unread signal", () => {
  const retrying = chat("retrying", { isRunning: true, lastRunStatus: "error", lastRunError: "earlier failure" })
  const failed = chat("both", { lastRunStatus: "error", lastRunError: "boom" })
  const view = mount(() => <>
    <SessionRow chat={retrying} active={false} unread {...actions} />
    <SessionRow chat={failed} active={false} unread {...actions} />
  </>)
  expect(view.indicator("retrying")).toBeNull()
  expect(view.slot("retrying").querySelector("[data-session-running]")).not.toBeNull()
  expect(view.slot("retrying").querySelector(".rounded-full.bg-primary")).not.toBeNull()
  const liveDescriptions = view.row("retrying").querySelector("button")!.getAttribute("aria-describedby")!.split(" ")
  expect(liveDescriptions.map((id) => document.getElementById(id)?.textContent))
    .toEqual([uiText("unread_messages_519491f4"), uiText("running_1f0eb99b")])

  const row = view.row("both")
  expect(row.querySelector("[data-session-run-failure]")).not.toBeNull()
  expect(row.querySelector(".rounded-full.bg-primary")).toBeNull()
  const describedBy = row.querySelector("button")!.getAttribute("aria-describedby")!.split(" ")
  expect(describedBy).toHaveLength(2)
  expect(describedBy.map((id) => row.querySelector<HTMLElement>(`#${id}`)?.textContent))
    .toEqual([uiText("unread_messages_519491f4"), uiText("session_last_run_failed_hint")])
})

it("makes unassigned sessions draggable and suppresses post-drag pointer clicks, preserving later selection", () => {
  const select = vi.fn()
  const view = mount(() => <SessionRow chat={chat("unassigned")} active={false} unread={false} {...actions} onSelect={select} />)
  const row = view.row("unassigned")
  const button = row.querySelector("button")!
  expect(row.draggable).toBe(true)
  const { event, dataTransfer } = sessionDrag()
  row.dispatchEvent(event)
  expect(dataTransfer.setData).toHaveBeenCalledWith(SIDEBAR_SESSION_DRAG_TYPE, JSON.stringify({ projectId: null, sessionId: "unassigned" }))
  expect(dataTransfer.effectAllowed).toBe("copyMove")
  row.dispatchEvent(new Event("dragend", { bubbles: true }))
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
  expect(select).not.toHaveBeenCalled()
  button.dispatchEvent(new Event("pointerdown", { bubbles: true }))
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
  expect(select).toHaveBeenCalledTimes(1)
})

it("keeps selected-row emphasis and actions stable when a running session finishes", () => {
  const [running, setRunning] = createSignal(true)
  const view = mount(() => <>
    <SessionRow chat={chat("first", { isRunning: running() })} active unread={false} {...actions} />
    <SessionRow chat={chat("second")} active={false} unread={false} {...actions} />
  </>)
  const selected = view.row("first")
  const selectedClasses = selected.className
  expect(selected.style.boxShadow).toContain("inset")
  expect(selectedClasses).toContain("feedback-motion")
  const menu = selected.querySelector<HTMLElement>('[aria-haspopup="menu"]')
  expect(menu?.style.opacity).toBe("1")
  expect(menu?.className).toContain("group-focus-within/row:opacity-100")
  setRunning(false)
  flush()
  expect(view.row("first")).toBe(selected)
  expect(selected.className).toBe(selectedClasses)
  expect([...view.host.querySelectorAll("[data-sidebar-session]")].map((row) => row.getAttribute("data-sidebar-session")))
    .toEqual(["first", "second"])
  expect(selected.querySelector('[aria-current="page"]')).not.toBeNull()
})

it("keeps an internal grip gesture out of the native editor drag protocol", () => {
  const view = mount(() => <SessionRow chat={chat("root")} active={false} unread={false} projectId="p1"
    dragHandle={<button data-sidebar-drag-handle="session:root">Move</button>} {...actions} />)
  const row = view.row("root")
  const handle = row.querySelector("[data-sidebar-drag-handle]")!
  handle.addEventListener("pointerdown", (event) => event.stopPropagation(), { once: true })
  handle.dispatchEvent(new Event("pointerdown", { bubbles: true }))
  const native = sessionDrag()
  row.dispatchEvent(native.event)
  expect(native.event.defaultPrevented).toBe(true)
  expect(native.dataTransfer.setData).not.toHaveBeenCalled()
  row.querySelector("button:not([data-sidebar-drag-handle])")!.dispatchEvent(new Event("pointerdown", { bubbles: true }))
  const external = sessionDrag()
  row.dispatchEvent(external.event)
  expect(external.event.defaultPrevented).toBe(false)
  expect(external.dataTransfer.setData).toHaveBeenCalledWith(SIDEBAR_SESSION_DRAG_TYPE, JSON.stringify({ projectId: "p1", sessionId: "root" }))
})

it("shows the running indicator for work in flight even when the backend reports idle", () => {
  const [state, setState] = createSignal<{ running?: boolean; isRunning?: boolean }>({ running: true, isRunning: false })
  const view = mount(() => <SessionRow chat={chat("s", { isRunning: state().isRunning })}
    active={false} unread={false} running={state().running} {...actions} />)
  const indicator = () => view.row("s").querySelector("[data-session-running]")
  expect(indicator()).not.toBeNull()
  expect(indicator()?.getAttribute("aria-hidden")).toBe("true")
  const button = view.row("s").querySelector("button")!
  expect(button.textContent).toBe("s")
  expect(button.firstElementChild?.contains(indicator())).toBe(true)
  expect(document.getElementById(button.getAttribute("aria-describedby")!)?.textContent).toBe("运行中")

  setState({ running: false, isRunning: true })
  flush()
  expect(indicator()).toBeNull()

  setState({ isRunning: true })
  flush()
  expect(indicator()).not.toBeNull()
  setState({ isRunning: false })
  flush()
  expect(indicator()).toBeNull()
})
