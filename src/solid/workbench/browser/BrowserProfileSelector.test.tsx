import { createSignal } from "solid-js"
import { render } from "@solidjs/web"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import i18n from "@shared/i18n/runtime"
import { readBrowserProfileReport } from "@services/browser/profileMode"
import type { BrowserProfileReport } from "@services/browser/profileMode"
import { BrowserProfileSelector, createBrowserProfileDraft } from "./BrowserProfileSelector"
import { settleBrowser } from "./browserSessionTestHarness"

const shared: BrowserProfileReport = { kind: "reported", mode: "shared", storageShared: true }
const clean: BrowserProfileReport = { kind: "reported", mode: "clean", storageShared: false }
const open = vi.fn()
const close = vi.fn()
type SelectorProps = Omit<Parameters<typeof BrowserProfileSelector>[0], "nextMode" | "onNextModeChange">
const defaults: SelectorProps = { sessionId: "chat-a", profile: shared, phase: "closed", actions: { open, close } }
let dispose: () => void
let show: (props?: Partial<SelectorProps>) => Promise<void>
let host: HTMLDivElement

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  host = document.body.appendChild(document.createElement("div"))
  const [configuration, setConfiguration] = createSignal(defaults)
  show = (props = {}) => settleBrowser(() => setConfiguration({ ...defaults, ...props }))
  await settleBrowser(() => {
    dispose = render(() => {
      const draft = createBrowserProfileDraft()
      return <BrowserProfileSelector {...configuration()} nextMode={draft.mode(configuration().sessionId)}
        onNextModeChange={(mode) => draft.select(configuration().sessionId, mode)} />
    }, host)
  })
})

afterEach(async () => {
  dispose()
  host.remove()
  vi.clearAllMocks()
  await i18n.changeLanguage("zh-CN")
})

async function chooseClean() {
  await settleBrowser(async () => {
    const select = host.querySelector("select")!
    select.value = "clean"
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

async function submit() {
  await settleBrowser(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
}

it("defaults a new explicit choice to shared and explains storage sharing and clean freshness", async () => {
  await show()
  expect(host.querySelector("select")?.value).toBe("shared")
  expect(host.textContent).toContain("共享账户")
  expect(host.textContent).toContain("不构成安全隔离")
  expect(host.textContent).toContain("不继承共享账户或上一次干净会话")
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it("changing a choice performs no operation; an explicit open emits one chat-bound mode intent", async () => {
  await show()
  await chooseClean()
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  await submit()
  expect(open).toHaveBeenCalledExactlyOnceWith("chat-a", "clean")
  expect(close).not.toHaveBeenCalled()
})

it("requires a separate explicit close before opening another mode", async () => {
  await show({ phase: "active" })
  expect(host.querySelector('[role="status"]')?.textContent).toContain("当前模式：共享账户")
  await chooseClean()
  await submit()
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  await settleBrowser(async () => host.querySelector("button")!.click())
  expect(close).toHaveBeenCalledExactlyOnceWith("chat-a")
  expect(open).not.toHaveBeenCalled()
  await show({ phase: "closed" })
  expect(open).not.toHaveBeenCalled()
  await submit()
  expect(open).toHaveBeenCalledExactlyOnceWith("chat-a", "clean")
})

it("does not reuse a previous clean mode as the default for a new scope", async () => {
  await show({ profile: clean })
  expect(host.querySelector("select")?.value).toBe("shared")
  expect(host.querySelector('[role="status"]')?.textContent).toContain("已关闭")
  expect(open).not.toHaveBeenCalled()
})

it("never turns a conflict notification into an automatic close or reopen", async () => {
  await show({ phase: "active", notice: "mode_conflict" })
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("请先关闭")
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it.each(["active", "closed"] as const)("blocks %s operations while an action is pending", async (phase) => {
  await show({ phase, pending: true })
  expect(host.querySelector("select")?.disabled).toBe(true)
  expect(host.querySelector("button")?.disabled).toBe(true)
  await submit()
  await settleBrowser(async () => host.querySelector("button")!.click())
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it.each([
  readBrowserProfileReport({}),
  readBrowserProfileReport({ profile_mode: "shared", storage_shared: false }),
])("exposes no write controls for an unconfirmed report: %j", async (profile) => {
  await show({ profile })
  expect(host.querySelector("select")).toBeNull()
  expect(host.querySelector("button")).toBeNull()
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it("keeps a reported mode read-only until a consumer action port is installed", async () => {
  await show({ actions: undefined, phase: "active" })
  expect(host.querySelector('[role="status"]')?.textContent).toContain("当前模式：共享账户")
  expect(host.querySelector("select")).toBeNull()
  expect(host.querySelector("button")).toBeNull()
})

it("does not apply the previous chat's draft mode to another chat", async () => {
  await show()
  await chooseClean()
  await show({ sessionId: "chat-b" })
  expect(host.querySelector("select")?.value).toBe("shared")
  expect(open).not.toHaveBeenCalled()
  await submit()
  expect(open).toHaveBeenCalledExactlyOnceWith("chat-b", "shared")
})

it("preserves the selected mode while changing locale", async () => {
  await show()
  await chooseClean()
  await settleBrowser(async () => i18n.changeLanguage("en-US"))
  expect(host.querySelector("select")?.value).toBe("clean")
  expect(host.textContent).toContain("Shared account")
  expect(host.textContent).toContain("not a security boundary")
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it("offers only an explicit mode-free default open for an unreported closed scope", async () => {
  const openDefault = vi.fn()
  await show({ profile: { kind: "unreported" }, phase: "closed", actions: { open, close, openDefault } })
  expect(host.querySelector("select")).toBeNull()
  expect(host.textContent).toContain("当前聊天浏览器已关闭")
  expect(host.textContent).not.toContain("当前模式：")
  await settleBrowser(async () => host.querySelector("button")!.click())
  expect(openDefault).toHaveBeenCalledExactlyOnceWith("chat-a")
  expect(open).not.toHaveBeenCalled()
})

it("still blocks a contradictory profile report even if initial opening is allowed", async () => {
  await show({ profile: { kind: "invalid" }, phase: "closed", actions: { open, close, openDefault: vi.fn() } })
  expect(host.querySelector("select")).toBeNull()
  expect(open).not.toHaveBeenCalled()
})

it("does not expose mode choices for a legacy closed scope with no positive profile report", async () => {
  await show({ profile: { kind: "unreported" }, phase: "closed", actions: { open, close, openDefault: vi.fn() } })
  expect(host.querySelector("select")).toBeNull()
  expect(host.textContent).not.toContain("当前模式：")
  expect(open).not.toHaveBeenCalled()
})

it("offers a separate explicit clean request without changing the legacy default or claiming a mode", async () => {
  const openDefault = vi.fn(), openClean = vi.fn()
  await show({ profile: { kind: "unreported" }, phase: "closed", actions: { open, close, openDefault, openClean } })
  expect(host.querySelector("select")).toBeNull()
  expect(host.textContent).not.toContain("当前模式：")
  expect(openClean).not.toHaveBeenCalled()
  const button = [...host.querySelectorAll("button")].find(button => button.textContent === "以干净会话打开")!
  await settleBrowser(async () => button.click())
  expect(openClean).toHaveBeenCalledExactlyOnceWith("chat-a")
  expect(openDefault).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
  await show({ profile: { kind: "unreported" }, phase: "closed", pending: true, actions: { open, close, openDefault, openClean } })
  expect([...host.querySelectorAll("button")].every(button => button.disabled)).toBe(true)
})
