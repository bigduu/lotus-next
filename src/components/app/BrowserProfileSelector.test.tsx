import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import i18n from "@/shared/i18n"
import { readBrowserProfileReport } from "@services/browser/profileMode"
import type { BrowserProfileReport } from "@services/browser/profileMode"
import { BrowserProfileSelector } from "./BrowserProfileSelector"

const shared: BrowserProfileReport = { kind: "reported", mode: "shared", storageShared: true }
const clean: BrowserProfileReport = { kind: "reported", mode: "clean", storageShared: false }
const open = vi.fn()
const close = vi.fn()
let root: Root
let host: HTMLDivElement

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  await i18n.changeLanguage("zh-CN")
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.clearAllMocks()
  await i18n.changeLanguage("zh-CN")
})

async function render(props: Partial<Parameters<typeof BrowserProfileSelector>[0]> = {}) {
  await act(async () => root.render(<BrowserProfileSelector sessionId="chat-a" profile={shared} phase="closed" actions={{ open, close }} {...props} />))
}

async function chooseClean() {
  await act(async () => {
    const select = host.querySelector("select")!
    select.value = "clean"
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

async function submit() {
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
}

it("defaults a new explicit choice to shared and explains storage sharing and clean freshness", async () => {
  await render()
  expect(host.querySelector("select")?.value).toBe("shared")
  expect(host.textContent).toContain("共享账户")
  expect(host.textContent).toContain("不构成安全隔离")
  expect(host.textContent).toContain("不继承共享账户或上一次干净会话")
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it("changing a choice performs no operation; an explicit open emits one chat-bound mode intent", async () => {
  await render()
  await chooseClean()
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  await submit()
  expect(open).toHaveBeenCalledExactlyOnceWith("chat-a", "clean")
  expect(close).not.toHaveBeenCalled()
})

it("requires a separate explicit close before opening another mode", async () => {
  await render({ phase: "active" })
  expect(host.querySelector('[role="status"]')?.textContent).toContain("当前模式：共享账户")
  await chooseClean()
  await submit()
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  await act(async () => host.querySelector("button")!.click())
  expect(close).toHaveBeenCalledExactlyOnceWith("chat-a")
  expect(open).not.toHaveBeenCalled()
  await render({ phase: "closed" })
  expect(open).not.toHaveBeenCalled()
  await submit()
  expect(open).toHaveBeenCalledExactlyOnceWith("chat-a", "clean")
})

it("does not reuse a previous clean mode as the default for a new scope", async () => {
  await render({ profile: clean })
  expect(host.querySelector("select")?.value).toBe("shared")
  expect(host.querySelector('[role="status"]')?.textContent).toContain("已关闭")
  expect(open).not.toHaveBeenCalled()
})

it("never turns a conflict notification into an automatic close or reopen", async () => {
  await render({ phase: "active", notice: "mode_conflict" })
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("请先关闭")
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it.each(["active", "closed"] as const)("blocks %s operations while an action is pending", async (phase) => {
  await render({ phase, pending: true })
  expect(host.querySelector("select")?.disabled).toBe(true)
  expect(host.querySelector("button")?.disabled).toBe(true)
  await submit()
  await act(async () => host.querySelector("button")!.click())
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it.each([
  readBrowserProfileReport({}),
  readBrowserProfileReport({ profile_mode: "shared", storage_shared: false }),
])("exposes no write controls for an unconfirmed report: %j", async (profile) => {
  await render({ profile })
  expect(host.querySelector("select")).toBeNull()
  expect(host.querySelector("button")).toBeNull()
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it("keeps a reported mode read-only until a consumer action port is installed", async () => {
  await render({ actions: undefined, phase: "active" })
  expect(host.querySelector('[role="status"]')?.textContent).toContain("当前模式：共享账户")
  expect(host.querySelector("select")).toBeNull()
  expect(host.querySelector("button")).toBeNull()
})

it("does not apply the previous chat's draft mode to another chat", async () => {
  await render()
  await chooseClean()
  await render({ sessionId: "chat-b" })
  expect(host.querySelector("select")?.value).toBe("shared")
  expect(open).not.toHaveBeenCalled()
  await submit()
  expect(open).toHaveBeenCalledExactlyOnceWith("chat-b", "shared")
})

it("preserves the selected mode while changing locale", async () => {
  await render()
  await chooseClean()
  await act(async () => i18n.changeLanguage("en-US"))
  expect(host.querySelector("select")?.value).toBe("clean")
  expect(host.textContent).toContain("Shared account")
  expect(host.textContent).toContain("not a security boundary")
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it("offers an explicit initial choice for typed browser_not_open without claiming an existing profile", async () => {
  await render({ profile: { kind: "unreported" }, phase: "closed", allowUnreportedOpen: true })
  expect(host.textContent).toContain("当前聊天浏览器已关闭")
  expect(host.textContent).not.toContain("当前模式：")
  await chooseClean()
  await submit()
  expect(open).toHaveBeenCalledExactlyOnceWith("chat-a", "clean")
})

it("still blocks a contradictory profile report even if initial opening is allowed", async () => {
  await render({ profile: { kind: "invalid" }, phase: "closed", allowUnreportedOpen: true })
  expect(host.querySelector("select")).toBeNull()
  expect(open).not.toHaveBeenCalled()
})
