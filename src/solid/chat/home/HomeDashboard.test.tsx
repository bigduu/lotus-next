import { render as mount } from "@solidjs/web"
import { flush } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { changeLocale } from "@shared/i18n/runtime"
import { TASK_TEMPLATES, peekPendingTemplatePrompt, setPendingTemplatePrompt } from "@/lib/taskTemplates"
import type { ChatItem } from "@shared/types/chatMessages"
import { HomeDashboard } from "./HomeDashboard"

vi.mock("@lucide/solid", () => {
  const icon = () => <svg aria-hidden="true" />
  return {
    BarChart3: icon, BookOpen: icon, Bug: icon, Clock: icon, Code: icon, FileSearch: icon, FileText: icon,
    GitCompare: icon, HelpCircle: icon, Loader2: icon, MessageSquare: icon, Network: icon, Pin: icon,
    Plus: icon, Search: icon, Wrench: icon,
  }
})

let dispose: (() => void) | undefined
let host: HTMLDivElement
const pick = vi.fn()
const open = vi.fn()
const describe = vi.fn()
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"))
})
afterEach(async () => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.clearAllMocks()
  setPendingTemplatePrompt(null)
  await changeLocale("zh-CN", { persist: false })
})
function render(chats: ChatItem[] = []) {
  dispose?.()
  dispose = mount(() => <HomeDashboard chats={chats} onOpenSession={open} onPickTemplate={pick} onDescribeTask={describe} />, host)
  flush()
}
function dispatch(action: () => void) { action(); flush() }

function search(query = "no-template-4918") {
  const input = host.querySelector("input")!
  dispatch(() => {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  return input
}
function button(label: string) {
  const found = [...host.querySelectorAll("button")].find((node) => node.textContent === label)
  if (!found) throw new Error(`Missing action: ${label}`)
  return found
}
it("clears an empty-result search, restores templates, and returns focus to search", () => {
  render()
  const templateCount = host.querySelectorAll("button").length
  const input = search()
  expect(host.querySelector('[role="status"]')).not.toBeNull()
  dispatch(() => button("清空搜索").click())
  expect(input.value).toBe("")
  expect(host.querySelector('[role="status"]')).toBeNull()
  expect(host.querySelectorAll("button")).toHaveLength(templateCount)
  expect(document.activeElement).toBe(input)
  expect(pick).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
  expect(describe).not.toHaveBeenCalled()
})
it("clears with Escape but leaves IME Escape untouched and does not create a task", () => {
  render(); const input = search()
  dispatch(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true })))
  expect(input.value).toBe("no-template-4918")
  dispatch(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 229, bubbles: true })))
  expect(input.value).toBe("no-template-4918")
  dispatch(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })))
  expect(input.value).toBe("")
  expect(document.activeElement).toBe(input)
  expect(pick).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled()
})
it("offers a native non-submit keyboard button that only requests existing composer focus", () => {
  render(); const input = search()
  const action = button("直接描述任务")
  expect(action.type).toBe("button")
  expect(action.tabIndex).toBe(0)
  dispatch(() => { action.focus(); action.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })) })
  expect(describe).toHaveBeenCalledTimes(1)
  expect(input.value).toBe("no-template-4918")
  expect(pick).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled()
  // Returning to search keeps the query available for correction or Escape.
  dispatch(() => input.focus())
  expect(input.value).toBe("no-template-4918")
})
it("keeps session shortcuts usable and resets a stale search when home is remounted", () => {
  render([{ id: "session-1", title: "Existing task" } as ChatItem]); search()
  dispatch(() => button("Existing task").click())
  expect(open).toHaveBeenCalledWith("session-1")
  render()
  expect(host.querySelector("input")!.value).toBe("")
  expect(host.querySelector('[role="status"]')).toBeNull()
  expect(pick).not.toHaveBeenCalled(); expect(describe).not.toHaveBeenCalled()
})
it("localizes accessible search and recovery actions in English", async () => {
  await changeLocale("en-US", { persist: false }); render(); const input = search()
  expect(input.getAttribute("aria-label")).toBe("Search templates…")
  expect(button("Clear search")).toBeDefined()
  expect(button("Describe your task")).toBeDefined()
})

it("uses the shared press and keyboard-focus feedback without changing template selection", () => {
  render()
  const card = host.querySelector("button")!
  expect(card.classList.contains("button-interaction")).toBe(true)
  expect(card.classList.contains("focus-visible:ring-2")).toBe(true)
  expect(card.querySelector('[aria-hidden="true"]')).not.toBeNull()
  dispatch(() => card.click())
  expect(pick).toHaveBeenCalledExactlyOnceWith(TASK_TEMPLATES[0]!.prefill)
  expect(peekPendingTemplatePrompt()?.prompt ?? null).toBe(TASK_TEMPLATES[0]!.taskPrompt ?? null)
})

it("announces the empty search once without remounting its entrance on further typing", () => {
  render()
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
