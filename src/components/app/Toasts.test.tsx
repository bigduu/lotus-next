import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Toasts, type ToastNotice } from "./Toasts"

let root: Root
let host: HTMLDivElement
const dismiss = vi.fn()
const info: ToastNotice = { id: 1, kind: "info", message: "Saved" }
function render(toast: ToastNotice | null = info, forking = false) {
  act(() => root.render(<Toasts toast={toast} forking={forking} onDismiss={dismiss} />))
}
function tick(ms: number) { act(() => vi.advanceTimersByTime(ms)) }
beforeEach(() => {
  vi.useFakeTimers()
  dismiss.mockClear()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT")
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
    act(() => card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    tick(10000)
    act(() => host.querySelector('button')!.focus())
    act(() => card.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
    tick(10000)
    expect(dismiss).not.toHaveBeenCalled()
    act(() => host.querySelector('button')!.blur())
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
    act(() => host.querySelector('button')!.click())
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
    act(() => { details.open = true; details.dispatchEvent(new Event('toggle', { bubbles: true })) })
    tick(10000)
    expect(dismiss).not.toHaveBeenCalled()
    act(() => { details.open = false; details.dispatchEvent(new Event('toggle', { bubbles: true })) })
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
  act(() => root.render(<Toasts toast={{ ...info, kind: 'error' }} forking={false} onDismiss={dismiss} onRestoreFocus={fallback} />))
  document.body.append(origin, composer)
  act(() => origin.focus())
  const close = host.querySelector('button')!
  act(() => close.focus())
  if (removeOrigin) origin.remove()
  act(() => close.click())
  expect(document.activeElement).toBe(removeOrigin ? composer : origin)
  expect(fallback).toHaveBeenCalledTimes(removeOrigin ? 1 : 0)
  origin.remove(); composer.remove()
})

it("does not move focus when a notification expires or is removed asynchronously", () => {
  const outside = document.body.appendChild(document.createElement('button'))
  const fallback = vi.fn()
  act(() => root.render(<Toasts toast={info} forking={false} onDismiss={dismiss} onRestoreFocus={fallback} />))
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
  act(() => root.render(<Toasts toast={info} forking={false} onDismiss={dismiss} onRestoreFocus={fallback} />))
  outside.focus()
  act(() => host.querySelector('button')!.click())
  expect(document.activeElement).toBe(outside)
  expect(fallback).not.toHaveBeenCalled()
  outside.remove()
})


it.each(['hidden', 'inert', 'aria-hidden'])("skips a return control inside a %s pane", (attribute) => {
  const pane = document.body.appendChild(document.createElement('div'))
  const origin = pane.appendChild(document.createElement('button'))
  const fallback = vi.fn()
  act(() => root.render(<Toasts toast={info} forking={false} onDismiss={dismiss} onRestoreFocus={fallback} />))
  origin.focus()
  act(() => host.querySelector('button')!.focus())
  pane.setAttribute(attribute, 'true')
  act(() => host.querySelector('button')!.click())
  expect(fallback).toHaveBeenCalledOnce()
  pane.remove()
})
