import { render, type ComponentProps } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/text"
import { LiveBootstrapRetryNotice } from "./LiveBootstrapRetryNotice"
import type { LiveBootstrapView } from "./createLiveBootstrapRetry"

type NoticeProps = ComponentProps<typeof LiveBootstrapRetryNotice>
const offer = (status: LiveBootstrapView["status"]): LiveBootstrapView =>
  ({ sessionId: "s", runId: "run-a", status, secondsRemaining: 8, deadline: 10000 })
let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  dispose?.()
  host?.remove()
})

function mount(initial: Pick<NoticeProps, "offer" | "disabled">) {
  const onConfirm = vi.fn()
  const onStop = vi.fn()
  const onRefresh = vi.fn()
  const [state, setState] = createSignal<NoticeProps>({ ...initial, onConfirm, onStop, onRefresh })
  const container = document.body.appendChild(document.createElement("div"))
  host = container
  dispose = render(() => <LiveBootstrapRetryNotice offer={state().offer} disabled={state().disabled}
    stopDisabled={state().stopDisabled} refreshDisabled={state().refreshDisabled}
    onConfirm={onConfirm} onStop={onStop} onRefresh={onRefresh} />, container)
  flush()
  return {
    container, onConfirm, onStop, onRefresh,
    status: () => container.querySelector('[role="status"]'),
    buttons: () => [...container.querySelectorAll("button")],
    update: (next: Partial<NoticeProps>) => {
      setState((previous) => ({ ...previous, ...next }))
      flush()
    },
  }
}

it("shows the waiting countdown and invokes only the chosen action", () => {
  const view = mount({ offer: offer("waiting"), disabled: false })
  expect(view.status()?.textContent).toContain("8")
  const buttons = view.buttons()
  expect(buttons.map((button) => button.textContent)).toEqual([
    uiText("upstream_retry_until_stopped"), uiText("stop_generation_9ad0aac3"),
  ])
  buttons[0].click()
  expect(view.onConfirm).toHaveBeenCalledOnce()
  expect(view.onStop).not.toHaveBeenCalled()
  buttons[1].click()
  expect(view.onStop).toHaveBeenCalledOnce()
  expect(view.onRefresh).not.toHaveBeenCalled()
})

it.each(["expired", "unavailable", "stop_requested"] as const)("shows %s with no actions", (status) => {
  const view = mount({ offer: offer(status), disabled: false })
  expect(view.status()?.textContent).toBeTruthy()
  expect(view.buttons()).toHaveLength(0)
})

it.each(["identity_unavailable", "stop_unconfirmed"] as const)("shows %s with only Refresh", (status) => {
  const view = mount({ offer: offer(status), disabled: false })
  expect(view.status()?.textContent).toBeTruthy()
  const buttons = view.buttons()
  expect(buttons.map((button) => button.textContent)).toEqual([uiText("live_retry_refresh")])
  buttons[0].click()
  expect(view.onRefresh).toHaveBeenCalledOnce()
})

it("retains Stop when confirmation is unconfirmed", () => {
  const view = mount({ offer: offer("unconfirmed"), disabled: false })
  expect(view.buttons().map((button) => button.textContent)).toEqual([uiText("stop_generation_9ad0aac3")])
})

it("hides an absent offer and prevents disabled actions", () => {
  const view = mount({ offer: null, disabled: false })
  expect(view.container.textContent).toBe("")
  view.update({ offer: offer("stop_unconfirmed"), disabled: true, stopDisabled: true, refreshDisabled: true })
  expect(view.buttons()).toHaveLength(1)
  view.buttons().forEach((button) => button.click())
  expect(view.onRefresh).not.toHaveBeenCalled()
  view.update({ offer: offer("waiting") })
  expect(view.buttons()).toHaveLength(2)
  view.buttons().forEach((button) => button.click())
  expect(view.onConfirm).not.toHaveBeenCalled()
  expect(view.onStop).not.toHaveBeenCalled()
})
