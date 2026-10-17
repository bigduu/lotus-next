import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { changeLocale } from "@shared/i18n"
import type { ChatItem } from "@shared/types/chatMessages"
import { HomeDashboard } from "./HomeDashboard"

let root: Root
let host: HTMLDivElement
const pick = vi.fn()
const open = vi.fn()
const describe = vi.fn()
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
})
afterEach(async () => {
  act(() => root.unmount()); host.remove(); vi.clearAllMocks()
  await changeLocale("zh-CN")
})
function render(chats: ChatItem[] = []) {
  act(() => root.render(<HomeDashboard chats={chats} onOpenSession={open} onPickTemplate={pick} onDescribeTask={describe} />))
}
function search(query = "no-template-4918") {
  const input = host.querySelector("input")!
  act(() => {
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
  act(() => button("清空搜索").click())
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
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true })))
  expect(input.value).toBe("no-template-4918")
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 229, bubbles: true })))
  expect(input.value).toBe("no-template-4918")
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })))
  expect(input.value).toBe("")
  expect(document.activeElement).toBe(input)
  expect(pick).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled()
})
it("offers a native non-submit keyboard button that only requests existing composer focus", () => {
  render(); const input = search()
  const action = button("直接描述任务")
  expect(action.type).toBe("button")
  expect(action.tabIndex).toBe(0)
  act(() => { action.focus(); action.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })) })
  expect(describe).toHaveBeenCalledTimes(1)
  expect(input.value).toBe("no-template-4918")
  expect(pick).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled()
  // Returning to search keeps the query available for correction or Escape.
  act(() => input.focus())
  expect(input.value).toBe("no-template-4918")
})
it("keeps session shortcuts usable and resets a stale search when home is remounted", () => {
  render([{ id: "session-1", title: "Existing task" } as ChatItem]); search()
  act(() => button("Existing task").click())
  expect(open).toHaveBeenCalledWith("session-1")
  act(() => root.render(<div />))
  render()
  expect(host.querySelector("input")!.value).toBe("")
  expect(host.querySelector('[role="status"]')).toBeNull()
  expect(pick).not.toHaveBeenCalled(); expect(describe).not.toHaveBeenCalled()
})
it("localizes accessible search and recovery actions in English", async () => {
  await changeLocale("en-US"); render(); const input = search()
  expect(input.getAttribute("aria-label")).toBe("Search templates…")
  expect(button("Clear search")).toBeDefined()
  expect(button("Describe your task")).toBeDefined()
})
