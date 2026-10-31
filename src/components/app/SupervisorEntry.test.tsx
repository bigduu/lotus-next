import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it } from "vitest"
import { uiText } from "@shared/i18n/ui"
import type { ChatItem } from "@shared/types/chatMessages"
import { SupervisorEntry } from "./SupervisorEntry"

const chat = (overrides: Partial<ChatItem>): ChatItem =>
  ({ id: "supervisor", title: "Supervisor", ...overrides }) as ChatItem

const render = (entry: ChatItem, unread = false) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host)
  const noop = () => {}
  act(() => root.render(<SupervisorEntry chat={entry} active={false} unread={unread} busy={false} disabled={false}
    onSelect={noop} onRename={noop} />))
  const cleanup = () => { act(() => root.unmount()); host.remove() }
  return { host, cleanup }
}

it("marks a supervisor whose last run failed, and stays quiet when it did not", () => {
  const failed = render(chat({ lastRunStatus: "error", lastRunError: "tool policy blocked the run" }))
  const marker = failed.host.querySelector<HTMLElement>("[data-session-run-failure]")
  // The backend cause stays verbatim; the marker is red rather than the blue unread/running dot.
  expect(marker?.getAttribute("title")).toBe("tool policy blocked the run")
  expect(marker?.querySelector("svg")?.getAttribute("class")).toContain("text-destructive")
  expect(failed.host.querySelector(".rounded-full.bg-primary")).toBeNull()
  expect(failed.host.textContent).toContain(uiText("session_last_run_failed_hint"))
  failed.cleanup()

  const running = render(chat({ isRunning: true, lastRunStatus: "error", lastRunError: "earlier failure" }))
  // A live run outranks a previous failure, so the row keeps the running pulse.
  expect(running.host.querySelector("[data-session-run-failure]")).toBeNull()
  expect(running.host.querySelector(".animate-pulse")).not.toBeNull()
  running.cleanup()

  const completed = render(chat({ lastRunStatus: "completed" }))
  expect(completed.host.querySelector("[data-session-run-failure]")).toBeNull()
  expect(completed.host.querySelector(".rounded-full.bg-primary")).toBeNull()
  completed.cleanup()
})

it("announces failure and unread independently instead of letting one replace the other", () => {
  const view = render(chat({ lastRunStatus: "error", lastRunError: "boom" }), true)
  const button = view.host.querySelector("button")!
  // Both states reach assistive tech: the red marker replaces the dot visually, but
  // the unread state must not disappear from the description.
  const describedBy = button.getAttribute("aria-describedby")!.split(" ")
  expect(describedBy.length).toBeGreaterThanOrEqual(3)
  const described = describedBy.map((id) => view.host.querySelector<HTMLElement>(`[id="${id}"]`)?.textContent ?? "")
  expect(described.some((text) => text.includes(uiText("unread_messages_519491f4")))).toBe(true)
  expect(described.some((text) => text.includes(uiText("session_last_run_failed_hint")))).toBe(true)
  view.cleanup()
})
