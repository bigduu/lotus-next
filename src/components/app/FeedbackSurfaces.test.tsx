import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HomeDashboard } from "./HomeDashboard"
import { Toasts } from "./Toasts"
import { TASK_TEMPLATES, peekPendingTemplatePrompt, setPendingTemplatePrompt } from "@/lib/taskTemplates"

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setPendingTemplatePrompt(null)
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT")
})

function search(value: string) {
  const input = host.querySelector("input")!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("home and transient feedback", () => {
  it("uses the shared press and keyboard-focus feedback without changing template selection", () => {
    const pick = vi.fn()
    act(() => root.render(<HomeDashboard chats={[]} onOpenSession={vi.fn()} onPickTemplate={pick} onDescribeTask={vi.fn()} />))
    const card = host.querySelector("button")!
    expect(card.classList.contains("button-interaction")).toBe(true)
    expect(card.classList.contains("focus-visible:ring-2")).toBe(true)
    expect(card.querySelector('[aria-hidden="true"]')).not.toBeNull()
    act(() => card.click())
    expect(pick).toHaveBeenCalledExactlyOnceWith(TASK_TEMPLATES[0]!.prefill)
    expect(peekPendingTemplatePrompt()?.prompt ?? null).toBe(TASK_TEMPLATES[0]!.taskPrompt ?? null)
  })

  it("announces the empty search once without remounting its entrance on further typing", () => {
    act(() => root.render(<HomeDashboard chats={[]} onOpenSession={vi.fn()} onPickTemplate={vi.fn()} onDescribeTask={vi.fn()} />))
    search("no-matching-template-xyz")
    const empty = host.querySelector('[role="status"]')!
    expect(empty.textContent).toContain("没有匹配的模板")
    expect(empty.classList.contains("surface-motion")).toBe(true)
    expect(empty.classList.contains("surface-fade")).toBe(true)
    search("still-no-matching-template-xyz")
    expect(host.querySelector('[role="status"]')).toBe(empty)
    search("")
    expect(host.querySelector('[role="status"]')).toBeNull()
  })

  it("announces progress and results without replaying the same notification on rerender", () => {
    act(() => root.render(<Toasts forking toast="ignored while busy" />))
    const status = host.querySelector('[role="status"]')!
    expect(status.getAttribute("aria-atomic")).toBe("true")
    expect(status.textContent).toBe("分叉中…")
    expect(status.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
    act(() => root.render(<Toasts forking={false} toast="Could not save. Try again." />))
    const notice = status.firstElementChild
    expect(notice?.classList.contains("surface-motion")).toBe(true)
    expect(notice?.querySelector("svg")?.classList.contains("lucide-info")).toBe(true)
    expect(status.textContent).toBe("Could not save. Try again.")
    act(() => root.render(<Toasts forking={false} toast="Could not save. Try again." />))
    expect(status.firstElementChild).toBe(notice)
    act(() => root.render(<Toasts forking={false} toast="Saved" />))
    expect(status.firstElementChild).not.toBe(notice)
    act(() => root.render(<Toasts forking={false} toast={null} />))
    expect(host.querySelector('[role="status"]')).toBeNull()
  })
})
