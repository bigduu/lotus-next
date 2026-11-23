import { render as mount } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Toasts, type ToastNotice } from "./Toasts"

vi.mock("@lucide/solid", () => ({ Info: () => null, Loader2: () => null, X: () => null }))

let dispose: () => void
let setCurrent: (props: Parameters<typeof Toasts>[0]) => void
let host: HTMLDivElement
const dismiss = vi.fn()
const info: ToastNotice = { id: 1, kind: "info", message: "Saved" }
function dispatch(action: () => void) { action(); flush() }
function render(toast: ToastNotice | null = info, forking = false, onRestoreFocus?: () => void) {
  dispatch(() => setCurrent({ toast, forking, onDismiss: dismiss, onRestoreFocus }))
}
function tick(ms: number) { dispatch(() => vi.advanceTimersByTime(ms)) }
beforeEach(() => {
  vi.useFakeTimers()
  dismiss.mockClear()
  host = document.body.appendChild(document.createElement("div"))
  const [props, setProps] = createSignal<Parameters<typeof Toasts>[0]>({ toast: null, forking: false, onDismiss: dismiss })
  setCurrent = setProps
  dispose = mount(() => <Toasts {...props()} />, host)
})
afterEach(() => {
  dispose()
  host.remove()
  vi.useRealTimers()
})
describe("notification lifecycle", () => {
  it("announces progress without dismissing the pending result", () => {
    render(info, true)
    expect(host.querySelector('[role="status"]')?.textContent).toBe("分叉中…")
    tick(30000)
    expect(dismiss).not.toHaveBeenCalled()
    render()
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Saved")
    tick(5000)
    expect(dismiss).toHaveBeenCalledOnce()
  })
  it("pauses the remaining lifetime on hover and keyboard focus, including overlap", () => {
    render()
    tick(2000)
    const card = host.querySelector('.pointer-events-auto')!
    dispatch(() => card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })))
    tick(10000)
    dispatch(() => host.querySelector('button')!.focus())
    dispatch(() => card.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true })))
    tick(10000)
    expect(dismiss).not.toHaveBeenCalled()
    dispatch(() => host.querySelector('button')!.blur())
    tick(2999)
    expect(dismiss).not.toHaveBeenCalled()
    tick(1)
    expect(dismiss).toHaveBeenCalledOnce()
  })
  it("keeps typed errors until manual dismissal and exposes full, bounded details", () => {
    const message = 'failure'.repeat(100)
    render({ id: 2, kind: 'error', message })
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(`操作失败${message.slice(0, 160)}…`)
    expect(host.querySelector('details div')?.textContent).toBe(message)
    expect((host.querySelector('details div') as HTMLElement).style.maxHeight).toBe('min(40vh, 20rem)')
    expect(host.querySelector('summary')?.textContent).toBe('显示详情')
    tick(60000)
    expect(dismiss).not.toHaveBeenCalled()
    dispatch(() => host.querySelector('button')!.click())
    expect(dismiss).toHaveBeenCalledOnce()
  })
  it("uses explicit error type instead of guessing from words, and cancels replaced timers", () => {
    render({ ...info, message: 'Error details copied' })
    expect(host.querySelector('[role="alert"]')).toBeNull()
    const old = host.querySelector('.surface-motion')
    tick(4000)
    render({ ...info })
    expect(host.querySelector('.surface-motion')).toBe(old)
    render({ ...info, id: 2 })
    expect(host.querySelector('.surface-motion')).not.toBe(old)
    tick(1000)
    expect(dismiss).not.toHaveBeenCalled()
    render(null)
    tick(10000)
    expect(dismiss).not.toHaveBeenCalled()
  })
  it("pauses while details are expanded even after pointer and focus leave", () => {
    render({ ...info, details: 'Full diagnostic text' })
    const details = host.querySelector('details')!
    dispatch(() => { details.open = true; details.dispatchEvent(new Event('toggle', { bubbles: true })) })
    tick(10000)
    expect(dismiss).not.toHaveBeenCalled()
    dispatch(() => { details.open = false; details.dispatchEvent(new Event('toggle', { bubbles: true })) })
    tick(5000)
    expect(dismiss).toHaveBeenCalledOnce()
  })
})


it("retains the full long message alongside distinct diagnostic details", () => {
  const message = 'Long actionable explanation. '.repeat(20)
  render({ id: 9, kind: 'error', message, details: 'Diagnostic context' })
  expect(host.querySelector('details div')?.textContent).toBe(`${message}\n\nDiagnostic context`)
  render({ id: 10, kind: 'error', message: 'Short summary', details: 'Diagnostic context' })
  expect(host.querySelector('details div')?.textContent).toBe('Diagnostic context')
  render({ id: 11, kind: 'error', message, details: message })
  expect(host.querySelector('details div')?.textContent).toBe(message)
})


it("labels errors independently of a truncated failure suffix", () => {
  const message = 'Context '.repeat(40) + '失败'
  render({ id: 20, kind: 'error', message })
  expect(host.querySelector('[role="alert"] strong')?.textContent).toBe('操作失败')
  expect(host.querySelector('details div')?.textContent).toBe(message)
})

it.each([false, true])("restores manual dismissal focus to the prior control or composer (%s)", (removeOrigin) => {
  const origin = document.createElement('button')
  const composer = document.createElement('textarea')
  const fallback = vi.fn(() => composer.focus())
  render({ ...info, kind: "error" }, false, fallback)
  document.body.append(origin, composer)
  dispatch(() => origin.focus())
  const close = host.querySelector('button')!
  dispatch(() => close.focus())
  if (removeOrigin) origin.remove()
  dispatch(() => close.click())
  expect(document.activeElement).toBe(removeOrigin ? composer : origin)
  expect(fallback).toHaveBeenCalledTimes(removeOrigin ? 1 : 0)
  origin.remove(); composer.remove()
})

it("does not move focus when a notification expires or is removed asynchronously", () => {
  const outside = document.body.appendChild(document.createElement('button'))
  const fallback = vi.fn()
  render(info, false, fallback)
  outside.focus()
  tick(5000)
  expect(document.activeElement).toBe(outside)
  expect(fallback).not.toHaveBeenCalled()
  render(null)
  expect(document.activeElement).toBe(outside)
  outside.remove()
})


it("does not restore focus for a dismissal while focus is outside the notification", () => {
  const outside = document.body.appendChild(document.createElement('button'))
  const fallback = vi.fn()
  render(info, false, fallback)
  outside.focus()
  dispatch(() => host.querySelector('button')!.click())
  expect(document.activeElement).toBe(outside)
  expect(fallback).not.toHaveBeenCalled()
  outside.remove()
})


it.each(['hidden', 'inert', 'aria-hidden'])("skips a return control inside a %s pane", (attribute) => {
  const pane = document.body.appendChild(document.createElement('div'))
  const origin = pane.appendChild(document.createElement('button'))
  const fallback = vi.fn()
  render(info, false, fallback)
  origin.focus()
  dispatch(() => host.querySelector('button')!.focus())
  pane.setAttribute(attribute, 'true')
  dispatch(() => host.querySelector('button')!.click())
  expect(fallback).toHaveBeenCalledOnce()
  pane.remove()
})
