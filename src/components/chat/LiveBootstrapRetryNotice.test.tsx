import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/ui"
import type { LiveBootstrapView } from "@/hooks/useLiveBootstrapRetry"
import { LiveBootstrapRetryNotice } from "./LiveBootstrapRetryNotice"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
const offer = (status: LiveBootstrapView["status"]): LiveBootstrapView =>
  ({ sessionId: "s", runId: "run-a", status, secondsRemaining: 8, deadline: 10000 })
beforeEach(() => { root = createRoot(document.body.appendChild(document.createElement("div"))) })
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren() })
it("shows the waiting countdown and invokes only the chosen action", async () => {
  const confirm = vi.fn(), stop = vi.fn()
  await act(async () => root.render(<LiveBootstrapRetryNotice offer={offer("waiting")} disabled={false} onConfirm={confirm} onStop={stop} />))
  expect(document.querySelector('[role="status"]')?.textContent).toContain("8")
  const buttons = [...document.querySelectorAll("button")]
  expect(buttons.map(button => button.textContent)).toEqual([uiText("upstream_retry_until_stopped"), uiText("stop_generation_9ad0aac3")])
  act(() => buttons[0]!.click()); expect(confirm).toHaveBeenCalledOnce(); expect(stop).not.toHaveBeenCalled()
  act(() => buttons[1]!.click()); expect(stop).toHaveBeenCalledOnce()
})
it.each(["expired", "unavailable", "identity_unavailable", "stop_requested", "stop_unconfirmed"] as const)("shows %s without a new confirmation or Stop", async (status) => {
  await act(async () => root.render(<LiveBootstrapRetryNotice offer={offer(status)} disabled={false} onConfirm={vi.fn()} onStop={vi.fn()} />))
  expect(document.querySelector('[role="status"]')?.textContent).toBeTruthy()
  expect(document.querySelectorAll("button")).toHaveLength(0)
})
it("retains Stop but does not repeat an unconfirmed confirmation", async () => {
  await act(async () => root.render(<LiveBootstrapRetryNotice offer={offer("unconfirmed")} disabled={false} onConfirm={vi.fn()} onStop={vi.fn()} />))
  expect([...document.querySelectorAll("button")].map(button => button.textContent)).toEqual([uiText("stop_generation_9ad0aac3")])
})
it("does not render an absent offer or act through disabled controls", async () => {
  const confirm = vi.fn(), stop = vi.fn()
  await act(async () => root.render(<LiveBootstrapRetryNotice offer={null} disabled={false} onConfirm={confirm} onStop={stop} />))
  expect(document.body.textContent).toBe("")
  await act(async () => root.render(<LiveBootstrapRetryNotice offer={offer("waiting")} disabled stopDisabled onConfirm={confirm} onStop={stop} />))
  act(() => document.querySelectorAll("button").forEach(button => button.click()))
  expect(confirm).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled()
})
