import { render, type JSX } from "@solidjs/web"
import { flush, Show } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/text"
import type { ChatItem } from "@shared/types/chatMessages"
import { SupervisorEntry } from "./SupervisorEntry"

vi.mock("@lucide/solid", () => {
  const Icon = (props: Pick<JSX.IntrinsicElements["svg"], "class" | "aria-hidden">) =>
    <svg class={props.class} aria-hidden={props["aria-hidden"]} />
  return { AlertCircle: Icon, CircleDot: Icon, LoaderCircle: Icon, MoreHorizontal: Icon, Pencil: Icon, RotateCcw: Icon,
    X: Icon, Check: Icon, ChevronRight: Icon, Circle: Icon }
})

// The browser suite exercises Kobalte's actual portal and keyboard handling.
// This JSDOM fixture keeps the native sidebar and lazy error boundary mounted.
vi.mock("../ui/dropdown-menu", () => ({
  DropdownMenu: (props: { open: boolean; onOpenChange: (open: boolean) => void; children: JSX.Element }) =>
    <Show when={props.open}>
      <div role="menu" onClick={() => props.onOpenChange(false)}>{props.children}</div>
    </Show>,
  DropdownMenuTrigger: () => null,
  DropdownMenuContent: (props: { children: JSX.Element }) => props.children,
  DropdownMenuItem: (props: { disabled?: boolean; onSelect?: () => void; children: JSX.Element }) =>
    <button type="button" role="menuitem" disabled={props.disabled} onClick={() => props.onSelect?.()}>{props.children}</button>,
}))

vi.mock("../ui/dialog", () => {
  const Body = (props: { children: JSX.Element }) => props.children
  return {
    Dialog: (props: { open: boolean; children: JSX.Element }) => <Show when={props.open}>{props.children}</Show>,
    DialogContent: (props: { children: JSX.Element }) => <div role="dialog">{props.children}</div>,
    DialogDescription: Body, DialogFooter: Body, DialogHeader: Body, DialogTitle: Body,
  }
})

vi.mock("../workbench/inspector/SupervisorManagedSessions", () => ({
  SupervisorManagedSessionsDialog: () => { throw new Error("fixture crash") },
}))

const chat = (overrides: Partial<ChatItem>): ChatItem =>
  ({ id: "supervisor", title: "Supervisor", ...overrides }) as ChatItem

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function mount(entry: ChatItem, unread = false) {
  const host = document.body.appendChild(document.createElement("div"))
  const noop = () => {}
  const dispose = render(() => <SupervisorEntry chat={entry} active={false} unread={unread}
    busy={false} running={entry.isRunning === true} disabled={false} onSelect={noop} onRename={noop} onClear={noop} />, host)
  flush()
  cleanups.push(() => { dispose(); host.remove() })
  return host
}

it("marks a supervisor whose last run failed, and stays quiet when it did not", () => {
  const failed = mount(chat({ lastRunStatus: "error", lastRunError: "tool policy blocked the run" }))
  const marker = failed.querySelector<HTMLElement>("[data-session-run-failure]")
  expect(marker?.getAttribute("title")).toBe("tool policy blocked the run")
  expect(marker?.querySelector("svg")?.getAttribute("class")).toContain("text-destructive")
  expect(failed.querySelector(".rounded-full.bg-primary")).toBeNull()
  expect(failed.textContent).toContain(uiText("session_last_run_failed_hint"))

  const running = mount(chat({ isRunning: true, lastRunStatus: "error", lastRunError: "earlier failure" }))
  expect(running.querySelector("[data-session-run-failure]")).toBeNull()
  const runningButton = running.querySelector("button")!
  expect(runningButton.firstElementChild?.querySelector("[data-session-running]")).not.toBeNull()
  expect(runningButton.textContent).toBe("Supervisor")
  const statusId = runningButton.getAttribute("aria-describedby")!.split(" ")[1]!
  expect(document.getElementById(statusId)?.textContent).toBe(uiText("running_1f0eb99b"))

  const completed = mount(chat({ lastRunStatus: "completed" }))
  expect(completed.querySelector("[data-session-run-failure]")).toBeNull()
  expect(completed.querySelector(".rounded-full.bg-primary")).toBeNull()
})

it("announces failure and unread independently instead of letting one replace the other", () => {
  const host = mount(chat({ lastRunStatus: "error", lastRunError: "boom" }), true)
  const button = host.querySelector("button")!
  const marker = host.querySelector<HTMLElement>("[data-session-run-failure]")
  expect(marker?.getAttribute("title")).toBe("boom")
  expect(host.querySelector("[data-session-running]")).toBeNull()
  const describedBy = button.getAttribute("aria-describedby")!.split(" ")
  expect(describedBy.length).toBeGreaterThanOrEqual(3)
  const descriptions = describedBy.map((id) => document.getElementById(id)?.textContent ?? "")
  expect(descriptions.some((text) => text.includes(uiText("unread_messages_519491f4")))).toBe(true)
  expect(descriptions.some((text) => text.includes(uiText("session_last_run_failed_hint")))).toBe(true)
})

it("reports a crashed managed sessions dialog as a render failure", async () => {
  const host = mount(chat({}))
  host.querySelector("button")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
  flush()
  const findManage = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((node) => node.textContent?.trim() === uiText("supervisor_sessions_manage"))
  await vi.waitFor(() => expect(findManage()).toBeDefined())
  findManage()!.click()

  await vi.waitFor(() => {
    flush()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain(uiText("supervisor_sessions_render_failed"))
    expect(dialog?.textContent).not.toContain(uiText("supervisor_sessions_unavailable"))
    expect(dialog?.textContent).not.toContain(uiText("supervisor_sessions_read_failed"))
  })
})
