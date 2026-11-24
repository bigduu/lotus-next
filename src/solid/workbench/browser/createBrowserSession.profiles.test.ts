import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ApiError, NetworkRequestError } from "@services/api"
import { browserService } from "@services/browser/BrowserService"
import type { BrowserProfileMode, BrowserState } from "@services/browser/types"
import type { BrowserSession } from "./createBrowserSession"
import { createBrowserSessionHarness, settleBrowser } from "./browserSessionTestHarness"

vi.mock("@services/browser/BrowserService", () => ({ browserService: {
  open: vi.fn(), openProfile: vi.fn(), get: vi.fn(), close: vi.fn(), frame: vi.fn(), closeTab: vi.fn(), navigate: vi.fn(), viewport: vi.fn(),
} }))

const state = (mode: BrowserProfileMode, epoch = 1): BrowserState => ({
  profile_mode: mode, storage_shared: mode === "shared", page_epoch: epoch, frame_seq: 0,
  active_tab_id: "tab-a", tabs: [{ tab_id: "tab-a", url: "about:blank", title: "Page", active: true }],
  url: "about:blank", title: "Page", viewport: { width: 640, height: 480 }, can_go_back: false, can_go_forward: false,
})
const notOpen = () => new ApiError("closed", 404, "Not Found", JSON.stringify({ error: { code: "browser_not_open" } }))
let harness: ReturnType<typeof createBrowserSessionHarness>
let browser: BrowserSession
let states: Record<string, BrowserState | null>
const show = (id = "a", active = true) => harness.show(id, active)

beforeEach(() => {
  states = { a: state("shared"), b: state("shared", 20) }
  vi.mocked(browserService.get).mockImplementation(async (id) => { const current = states[id]; if (!current) throw notOpen(); return current })
  vi.mocked(browserService.frame).mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.open).mockImplementation(async (id) => { states[id] = state("shared", 5); return states[id]! })
  vi.mocked(browserService.openProfile).mockImplementation(async (id, mode) => { states[id] = state(mode, 10); return states[id]! })
  vi.mocked(browserService.close).mockImplementation(async (id) => { states[id] = null })
  harness = createBrowserSessionHarness("a")
  browser = harness.browser
})
afterEach(() => {
  harness.dispose()
  vi.resetAllMocks()
  vi.useRealTimers()
})
async function negotiatedClosed() {
  await show()
  await settleBrowser(async () => browser.closeProfile("a"))
  vi.mocked(browserService.close).mockClear()
}

it("opens a closed browser once for a Browser-entry click, including repeated clicks during the read", async () => {
  states.a = null
  let rejectRead!: (reason: unknown) => void
  vi.mocked(browserService.get).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject }))
  await show()
  await settleBrowser(async () => { browser.requestEntryOpen("a"); browser.requestEntryOpen("a") })
  expect(browser.entryOpening).toBe(true)
  expect(browserService.open).not.toHaveBeenCalled()
  await settleBrowser(async () => { rejectRead(notOpen()) })
  expect(browserService.open).toHaveBeenCalledExactlyOnceWith("a", expect.any(AbortSignal))
  expect(browserService.openProfile).not.toHaveBeenCalled()
  expect(browser.profile).toEqual({ kind: "reported", mode: "shared", storageShared: true })
  expect(browser.entryOpening).toBe(false)
})

it("does not reopen on hide, read retry, or an existing clean scope; a later entry click opens shared after close", async () => {
  states.a = state("clean")
  await show()
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  await show("a", false)
  await show()
  await settleBrowser(async () => browser.retry())
  expect(browser.profile).toMatchObject({ kind: "reported", mode: "clean" })
  expect(browserService.open).not.toHaveBeenCalled()
  await settleBrowser(async () => browser.closeProfile("a"))
  expect(browser.profilePhase).toBe("closed")
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  expect(browserService.open).toHaveBeenCalledTimes(1)
  expect(browser.profile).toMatchObject({ kind: "reported", mode: "shared" })
})

it("rechecks a cached active scope on entry before deciding whether to open", async () => {
  await show()
  states.a = null // Another client closed the scope before this view noticed.
  await settleBrowser(async () => { browser.requestEntryOpen("a"); browser.requestEntryOpen("a") })
  expect(browserService.open).toHaveBeenCalledExactlyOnceWith("a", expect.any(AbortSignal))
  expect(browserService.openProfile).not.toHaveBeenCalled()
  expect(browser.profile).toMatchObject({ kind: "reported", mode: "shared" })
})

it.each(["navigate", "viewport"] as const)("waits for an in-flight %s before rechecking an entry", async (operation) => {
  await show()
  let finishAction!: () => void
  const result = { ...state("shared", 8), url: "https://example.test/" }
  const deferred = () => new Promise<BrowserState>((resolve) => { finishAction = () => { states.a = result; resolve(result) } })
  vi.mocked(browserService.navigate).mockImplementationOnce(deferred)
  vi.mocked(browserService.viewport).mockImplementationOnce(deferred)
  let action!: Promise<BrowserState | null>
  await settleBrowser(async () => { action = operation === "navigate" ? browser.navigate(result.url) : browser.viewport({ width: 800, height: 600 }) })
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  expect(browserService.get).toHaveBeenCalledTimes(1)
  expect(browser.entryOpening).toBe(true)
  let response!: BrowserState | null
  await settleBrowser(async () => { finishAction(); response = await action })
  expect(response?.url).toBe(result.url)
  expect(browser.state?.url).toBe(result.url)
  expect(browserService.get).toHaveBeenCalledTimes(2)
  expect(browserService.open).not.toHaveBeenCalled()
  expect(browser.entryOpening).toBe(false)
})

it("keeps a queued action failure visible through rechecks and later automatic actions until retry", async () => {
  await show()
  let failAction!: () => void
  vi.mocked(browserService.navigate).mockImplementationOnce(() => new Promise((_resolve, reject) => {
    failAction = () => reject(new NetworkRequestError())
  }))
  let action!: Promise<BrowserState | null>
  await settleBrowser(async () => { action = browser.navigate("https://example.test/") })
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  await settleBrowser(async () => { failAction(); await action })
  expect(browserService.get).toHaveBeenCalledTimes(2)
  expect(browser.error).toBeTruthy()
  const error = browser.error
  vi.mocked(browserService.navigate).mockResolvedValueOnce(state("shared", 9))
  await settleBrowser(async () => browser.navigate("https://example.test/next"))
  expect(browser.error).toBe(error)
  await show("b")
  expect(browser.error).toBeNull()
  await show("a")
  expect(browser.error).toBe(error)
  await settleBrowser(async () => browser.retry())
  expect(browser.error).toBeNull()
})

it("shows a queued action refusal together with a failed canonical read", async () => {
  await show()
  let refuseAction!: () => void
  vi.mocked(browserService.navigate).mockImplementationOnce(() => new Promise((_resolve, reject) => {
    refuseAction = () => reject(new ApiError("busy", 503, "Unavailable", JSON.stringify({ error: { code: "browser_busy", type: "browser_error" } })))
  }))
  vi.mocked(browserService.get).mockRejectedValueOnce(new NetworkRequestError())
  let action!: Promise<BrowserState | null>
  await settleBrowser(async () => { action = browser.navigate("https://example.test/") })
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  await settleBrowser(async () => { refuseAction(); await action })
  expect(browser.error).toContain("本次请求未执行")
  expect(browser.error).toContain("暂时无法使用")
  expect(browserService.open).not.toHaveBeenCalled()
})

it("keeps a queued action refusal visible during and after empty-scope read failures", async () => {
  vi.useFakeTimers()
  states.a = { ...state("shared"), tabs: [], active_tab_id: null }
  await show()
  let refuseAction!: () => void
  vi.mocked(browserService.navigate).mockImplementationOnce(() => new Promise((_resolve, reject) => {
    refuseAction = () => reject(new ApiError("busy", 503, "Unavailable", JSON.stringify({ error: { code: "browser_busy", type: "browser_error" } })))
  }))
  let action!: Promise<BrowserState | null>
  await settleBrowser(async () => { action = browser.navigate("https://example.test/") })
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  await settleBrowser(async () => { refuseAction(); await action })
  vi.mocked(browserService.get).mockRejectedValueOnce(new NetworkRequestError())
    .mockRejectedValueOnce(new NetworkRequestError()).mockRejectedValueOnce(new NetworkRequestError())
  await settleBrowser(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(browser.error).toContain("本次请求未执行")
  expect(browser.error).toContain("暂时无法使用")
  await settleBrowser(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(browser.error).toContain("本次请求未执行")
})

it("opens once for a new entry intent received while close is in flight", async () => {
  await show()
  let finishClose!: () => void
  vi.mocked(browserService.close).mockImplementationOnce(() => new Promise((resolve) => {
    finishClose = () => { states.a = null; resolve() }
  }))
  let closing!: Promise<void>
  await settleBrowser(async () => { closing = browser.closeProfile("a") })
  await settleBrowser(async () => { browser.requestEntryOpen("a"); browser.requestEntryOpen("a") })
  expect(browser.entryOpening).toBe(true)
  expect(browserService.open).not.toHaveBeenCalled()
  await settleBrowser(async () => { finishClose(); await closing })
  expect(browserService.close).toHaveBeenCalledTimes(1)
  expect(browserService.open).toHaveBeenCalledExactlyOnceWith("a", expect.any(AbortSignal))
  expect(browserService.openProfile).not.toHaveBeenCalled()
  expect(browser.profile).toMatchObject({ kind: "reported", mode: "shared" })
  expect(browser.entryOpening).toBe(false)
})

it("keeps the active scope and the unconfirmed close warning when a queued entry follows a failed close", async () => {
  states.a = state("clean")
  await show()
  let failClose!: () => void
  vi.mocked(browserService.close).mockImplementationOnce(() => new Promise((_resolve, reject) => {
    failClose = () => reject(new NetworkRequestError())
  }))
  let closing!: Promise<void>
  await settleBrowser(async () => { closing = browser.closeProfile("a") })
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  await settleBrowser(async () => { failClose(); await closing })
  expect(browserService.close).toHaveBeenCalledTimes(1)
  expect(browserService.open).not.toHaveBeenCalled()
  expect(browserService.openProfile).not.toHaveBeenCalled()
  expect(browser.profile).toMatchObject({ kind: "reported", mode: "clean" })
  expect(browser.error).toContain("未确认")
  expect(browser.entryOpening).toBe(false)
})

it("preserves an unconfirmed open warning when empty-scope reads fail and recover", async () => {
  vi.useFakeTimers()
  states.a = null
  const empty = { ...state("shared"), tabs: [], active_tab_id: null }
  vi.mocked(browserService.open).mockImplementationOnce(async () => { states.a = empty; throw new NetworkRequestError() })
  await show()
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  expect(browser.profilePhase).toBe("active")
  expect(browser.error).toContain("未确认")

  vi.mocked(browserService.get).mockRejectedValueOnce(new NetworkRequestError())
  await settleBrowser(async () => { await vi.advanceTimersByTimeAsync(500) })
  await settleBrowser(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(browser.error).toContain("未确认")

  vi.mocked(browserService.get).mockRejectedValueOnce(new NetworkRequestError())
    .mockRejectedValueOnce(new NetworkRequestError()).mockRejectedValueOnce(new NetworkRequestError())
  await settleBrowser(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(browser.error).toContain("未确认")
  await settleBrowser(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(browser.error).toContain("未确认")
  expect(browserService.open).toHaveBeenCalledTimes(1)
})

it("opens from a fresh entry click after a closed scope was hidden", async () => {
  states.a = null
  await show()
  await show("a", false)
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  await show()
  expect(browserService.open).toHaveBeenCalledTimes(1)
  expect(browser.profile).toMatchObject({ kind: "reported", mode: "shared" })
})

it("uses the fresh activation's first closed read for the entry click and reconciles a refused default once", async () => {
  const calls: string[] = []
  states.a = null
  vi.mocked(browserService.get).mockImplementation(async () => { calls.push("read"); throw notOpen() })
  vi.mocked(browserService.open).mockImplementation(async () => {
    calls.push("open")
    throw new ApiError("unavailable", 503, "Unavailable", JSON.stringify({
      error: { type: "browser_error", code: "browser_unavailable", message: "browser runtime unavailable: browser_shared_profile_unsupported: request clean explicitly" },
    }))
  })
  await show("a", false)
  browser.requestEntryOpen("a")
  expect(calls).toEqual([])
  await show()
  expect(calls).toEqual(["read", "open", "read"])
  expect(browser.error).toContain("不支持打开共享浏览器")
  expect(browser.entryOpening).toBe(false)
  expect(browserService.openProfile).not.toHaveBeenCalled()
})

it("keeps a legacy default open unreported after an entry click", async () => {
  states.a = null
  const { profile_mode: _mode, storage_shared: _shared, ...legacy } = state("shared")
  vi.mocked(browserService.open).mockImplementationOnce(async () => { states.a = legacy; return legacy })
  await show()
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  expect(browserService.open).toHaveBeenCalledTimes(1)
  expect(browser.profilePhase).toBe("active")
  expect(browser.profile).toEqual({ kind: "unreported" })
})

it("shows an unconfirmed failed open without replay, then permits a new entry click", async () => {
  states.a = null
  vi.mocked(browserService.open).mockRejectedValueOnce(new NetworkRequestError())
  await show()
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  expect(browser.error).toContain("未确认")
  expect(browser.entryOpening).toBe(false)
  await settleBrowser(async () => browser.retry())
  expect(browserService.open).toHaveBeenCalledTimes(1)
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  expect(browserService.open).toHaveBeenCalledTimes(2)
  expect(browser.profile).toMatchObject({ kind: "reported", mode: "shared" })
})

it("retries a failed initial read when the entry is selected after the failure", async () => {
  states.a = null
  vi.mocked(browserService.get).mockRejectedValueOnce(new NetworkRequestError())
  await show()
  expect(browser.error).toBeTruthy()
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  expect(browserService.open).toHaveBeenCalledTimes(1)
  expect(browser.profile).toMatchObject({ kind: "reported", mode: "shared" })
  expect(browser.entryOpening).toBe(false)
})

it("keeps an entry intent after its read fails and opens only after the user retries the read", async () => {
  states.a = null
  let rejectRead!: (reason: unknown) => void
  vi.mocked(browserService.get).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject }))
  await show()
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  await settleBrowser(async () => rejectRead(new NetworkRequestError()))
  expect(browser.entryOpening).toBe(false)
  expect(browser.error).toBeTruthy()
  expect(browserService.open).not.toHaveBeenCalled()
  await settleBrowser(async () => browser.retry())
  expect(browserService.open).toHaveBeenCalledTimes(1)
  expect(browser.profile).toMatchObject({ kind: "reported", mode: "shared" })
})

it("reports the exact unsupported-shared refusal without silently opening clean", async () => {
  states.a = null
  vi.mocked(browserService.open).mockRejectedValueOnce(new ApiError("unavailable", 503, "Unavailable", JSON.stringify({
    error: { type: "browser_error", code: "browser_unavailable", message: "browser runtime unavailable: browser_shared_profile_unsupported: request clean explicitly" },
  })))
  await show()
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  expect(browser.error).toContain("不支持打开共享浏览器")
  expect(browser.error).not.toContain("未确认")
  expect(browserService.open).toHaveBeenCalledTimes(1)
  expect(browserService.openProfile).not.toHaveBeenCalled()
  await settleBrowser(async () => browser.openClean("a"))
  expect(browser.profile).toMatchObject({ kind: "reported", mode: "clean", storageShared: false })
})

it("does not transfer a pending entry click to a different chat", async () => {
  let rejectRead!: (reason: unknown) => void
  vi.mocked(browserService.get).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject }))
  await show()
  await settleBrowser(async () => browser.requestEntryOpen("a"))
  await show("b")
  await settleBrowser(async () => rejectRead(notOpen()))
  expect(browser.readySessionId).toBe("b")
  expect(browserService.open).not.toHaveBeenCalled()
})


it("uses an explicit mode-free first open before the server confirms profile support", async () => {
  states.a = null
  await show()
  expect(browser.profilePhase).toBe("closed")
  expect(browser.state).toBeNull()
  expect(browserService.open).not.toHaveBeenCalled()
  await settleBrowser(async () => browser.openDefault("a"))
  expect(browserService.open).toHaveBeenCalledExactlyOnceWith("a", expect.any(AbortSignal))
  expect(browserService.openProfile).not.toHaveBeenCalled()
  expect(browser.profile).toEqual({ kind: "reported", mode: "shared", storageShared: true })
  await settleBrowser(async () => browser.closeProfile("a"))
  await settleBrowser(async () => browser.openProfile("a", "clean"))
  expect(browserService.openProfile).toHaveBeenCalledExactlyOnceWith("a", "clean", expect.any(AbortSignal))
  expect(browser.profile).toEqual({ kind: "reported", mode: "clean", storageShared: false })
})

it("reads an existing clean browser on mount and after hiding without mode-free PUT or DELETE", async () => {
  states.a = state("clean")
  await show()
  await show("a", false)
  await show()
  expect(browser.profile).toEqual({ kind: "reported", mode: "clean", storageShared: false })
  expect(browserService.open).not.toHaveBeenCalled()
  expect(browserService.openProfile).not.toHaveBeenCalled()
  expect(browserService.close).not.toHaveBeenCalled()
})

it("keeps explicit close chat-bound across A→B→A and retries only a GET", async () => {
  await show()
  await settleBrowser(async () => browser.closeProfile("a"))
  expect(browser.profilePhase).toBe("closed")
  expect(browser.state).toBeNull()
  await show("b")
  expect(browser.state?.page_epoch).toBe(20)
  await settleBrowser(async () => browser.closeProfile("a"))
  expect(browserService.close).toHaveBeenCalledExactlyOnceWith("a", expect.any(AbortSignal))
  expect(states.b?.tabs).toHaveLength(1)
  await show()
  await settleBrowser(async () => browser.retry())
  expect(browser.profilePhase).toBe("closed")
  expect(browserService.open).not.toHaveBeenCalled()
  expect(browserService.openProfile).not.toHaveBeenCalled()
})

it("keeps a zero-tab browser active with its clean mode instead of deleting the scope", async () => {
  states.a = state("clean")
  vi.mocked(browserService.closeTab).mockImplementation(async () => ({ ...states.a!, tabs: [], active_tab_id: null }))
  await show()
  await settleBrowser(async () => browser.closeTab("tab-a"))
  expect(browser.state?.tabs).toEqual([])
  expect(browser.profilePhase).toBe("active")
  expect(browser.profile).toMatchObject({ kind: "reported", mode: "clean" })
  expect(browserService.close).not.toHaveBeenCalled()
})

it("restores the canonical mode after a 409 without automatic close, reopen or retry", async () => {
  await negotiatedClosed()
  vi.mocked(browserService.openProfile).mockImplementationOnce(async () => {
    states.a = state("clean", 9)
    throw new ApiError("conflict", 409, "Conflict", JSON.stringify({ error: { type: "browser_error", code: "browser_profile_mode_conflict" } }))
  })
  await settleBrowser(async () => browser.openProfile("a", "shared"))
  expect(browser.profile).toMatchObject({ kind: "reported", mode: "clean" })
  expect(browser.error).toContain("请先关闭")
  expect(browserService.openProfile).toHaveBeenCalledTimes(1)
  expect(browserService.open).not.toHaveBeenCalled()
  expect(browserService.close).not.toHaveBeenCalled()
})

it("does not replay an ambiguous DELETE and reads current state without claiming it closed", async () => {
  await show()
  vi.mocked(browserService.close).mockRejectedValueOnce(new NetworkRequestError())
  await settleBrowser(async () => browser.closeProfile("a"))
  expect(browser.state?.profile_mode).toBe("shared")
  expect(browser.error).toContain("未确认")
  await settleBrowser(async () => browser.retry())
  expect(browserService.close).toHaveBeenCalledTimes(1)
  expect(browserService.openProfile).not.toHaveBeenCalled()
  expect(browserService.open).not.toHaveBeenCalled()
})

it("fences a previous chat's late mode ACK and never applies it to the new chat", async () => {
  await negotiatedClosed()
  let finish!: (value: BrowserState) => void
  vi.mocked(browserService.openProfile).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  let operation!: Promise<void>
  await settleBrowser(async () => { operation = browser.openProfile("a", "clean") })
  await show("b")
  await settleBrowser(async () => { finish(state("clean", 99)); await operation })
  expect(browser.readySessionId).toBe("b")
  expect(browser.state?.page_epoch).toBe(20)
  expect(browser.profile).toMatchObject({ mode: "shared" })
  await show()
  expect(browser.profilePhase).toBe("closed")
  expect(browser.state).toBeNull()
  expect(browserService.openProfile).toHaveBeenCalledTimes(1)
})

it("submits one explicit open despite duplicate intent while its first request is pending", async () => {
  await negotiatedClosed()
  let finish!: (value: BrowserState) => void
  vi.mocked(browserService.openProfile).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  let operation!: Promise<void>
  await settleBrowser(async () => { operation = browser.openProfile("a", "clean"); void browser.openProfile("a", "shared") })
  expect(browserService.openProfile).toHaveBeenCalledTimes(1)
  await settleBrowser(async () => { states.a = state("clean"); finish(states.a); await operation })
  expect(browser.profile).toMatchObject({ mode: "clean" })
})

it("does not infer profile support from legacy browser_not_open", async () => {
  states.a = null
  await show()
  expect(browser.profilePhase).toBe("closed")
  expect(browserService.open).not.toHaveBeenCalled()
  await settleBrowser(async () => browser.openProfile("a", "clean"))
  expect(browserService.openProfile).not.toHaveBeenCalled()
  expect(browserService.close).not.toHaveBeenCalled()
})

it("keeps a legacy default open usable without enabling unsupported profile controls or automatic reopen", async () => {
  states.a = null
  await show()
  const { profile_mode: _mode, storage_shared: _shared, ...legacy } = state("shared")
  vi.mocked(browserService.open).mockImplementationOnce(async () => { states.a = legacy; return legacy })
  await settleBrowser(async () => browser.openDefault("a"))
  expect(browser.profile).toEqual({ kind: "unreported" })
  expect(browser.profilePhase).toBe("active")
  await settleBrowser(async () => browser.closeProfile("a"))
  await settleBrowser(async () => browser.openProfile("a", "clean"))
  await show("a", false)
  await show()
  await settleBrowser(async () => browser.retry())
  expect(browserService.open).toHaveBeenCalledTimes(1)
  expect(browserService.openProfile).not.toHaveBeenCalled()
  expect(browserService.close).not.toHaveBeenCalled()
})

it("drops cached profile eligibility when a later canonical state no longer reports it", async () => {
  await show()
  const { profile_mode: _mode, storage_shared: _shared, ...legacy } = state("shared")
  states.a = legacy
  await settleBrowser(async () => browser.retry())
  expect(browser.profile).toEqual({ kind: "unreported" })
  states.a = null
  await settleBrowser(async () => browser.retry())
  await settleBrowser(async () => browser.openProfile("a", "clean"))
  expect(browserService.openProfile).not.toHaveBeenCalled()
  expect(browserService.open).not.toHaveBeenCalled()
})

it("never bootstraps a browser from a generic legacy404 or a read retry", async () => {
  states.a = null
  vi.mocked(browserService.get).mockRejectedValue(new ApiError("legacy missing", 404, "Not Found"))
  await show()
  await settleBrowser(async () => browser.retry())
  expect(browserService.open).not.toHaveBeenCalled()
  expect(browserService.openProfile).not.toHaveBeenCalled()
  expect(browserService.close).not.toHaveBeenCalled()
})

it("reports typed browser_busy as a known refusal without replaying or claiming the browser closed", async () => {
  await show()
  vi.mocked(browserService.close).mockRejectedValueOnce(new ApiError("busy", 503, "Unavailable", JSON.stringify({ error: { code: "browser_busy", type: "browser_error" } })))
  await settleBrowser(async () => browser.closeProfile("a"))
  expect(browser.profilePhase).toBe("active")
  expect(browser.error).toContain("本次请求未执行")
  expect(browser.error).not.toContain("结果未确认")
  expect(browserService.close).toHaveBeenCalledTimes(1)
  expect(browserService.open).not.toHaveBeenCalled()
  expect(browserService.openProfile).not.toHaveBeenCalled()
})

it("does not automatically retry an empty-scope state read refused with browser_busy", async () => {
  vi.useFakeTimers()
  try {
    states.a = { ...state("shared"), tabs: [], active_tab_id: null }
    await show()
    vi.mocked(browserService.get).mockRejectedValue(new ApiError("busy", 503, "Unavailable", JSON.stringify({ error: { code: "browser_busy", type: "browser_error" } })))
    await settleBrowser(async () => vi.advanceTimersByTimeAsync(2500))
    expect(browserService.get).toHaveBeenCalledTimes(2)
    expect(browser.profilePhase).toBe("active")
    expect(browserService.close).not.toHaveBeenCalled()
    expect(browserService.open).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})


it("retains an ambiguous profile write warning when the canonical read also loses connection", async () => {
  await show()
  vi.mocked(browserService.close).mockRejectedValueOnce(new NetworkRequestError())
  vi.mocked(browserService.get).mockRejectedValue(new NetworkRequestError())
  await settleBrowser(async () => browser.closeProfile("a"))
  expect(browser.state).toBeNull()
  expect(browser.profilePhase).toBe("unknown")
  expect(browser.error).toContain("未确认")
  expect(browser.error).toContain("暂时无法使用")
  await settleBrowser(async () => browser.retry())
  expect(browser.error).toContain("未确认")
  expect(browserService.close).toHaveBeenCalledTimes(1)
  expect(browserService.open).not.toHaveBeenCalled()
  expect(browserService.openProfile).not.toHaveBeenCalled()
  vi.mocked(browserService.get).mockImplementation(async (id) => states[id]!)
  await settleBrowser(async () => browser.retry())
  expect(browser.state?.profile_mode).toBe("shared")
  expect(browserService.close).toHaveBeenCalledTimes(1)
})


it("keeps a known busy refusal distinct when its later canonical read fails", async () => {
  await show()
  vi.mocked(browserService.close).mockRejectedValueOnce(new ApiError("busy", 503, "Unavailable", JSON.stringify({ error: { code: "browser_busy", type: "browser_error" } })))
  vi.mocked(browserService.get).mockRejectedValue(new NetworkRequestError())
  await settleBrowser(async () => browser.closeProfile("a"))
  expect(browser.error).toContain("暂时无法使用")
  expect(browser.error).not.toContain("未确认")
  expect(browserService.close).toHaveBeenCalledTimes(1)
  expect(browserService.open).not.toHaveBeenCalled()
  expect(browserService.openProfile).not.toHaveBeenCalled()
})

it("allows only a user-explicit clean request from a canonical closed scope and confirms the result", async () => {
  states.a = null
  await show()
  expect(browserService.openProfile).not.toHaveBeenCalled()
  await settleBrowser(async () => browser.openProfile("a", "shared"))
  expect(browserService.openProfile).not.toHaveBeenCalled()
  await settleBrowser(async () => browser.openClean("a"))
  expect(browserService.openProfile).toHaveBeenCalledExactlyOnceWith("a", "clean", expect.any(AbortSignal))
  expect(browserService.open).not.toHaveBeenCalled()
  expect(browser.profile).toMatchObject({ kind: "reported", mode: "clean", storageShared: false })
  await settleBrowser(async () => browser.retry())
  expect(browserService.openProfile).toHaveBeenCalledTimes(1)
})

it("does not turn a generic404 or unconfirmed clean ACK into clean capability", async () => {
  states.a = null
  vi.mocked(browserService.get).mockRejectedValueOnce(new ApiError("missing", 404, "Not Found"))
  await show()
  await settleBrowser(async () => browser.openClean("a"))
  expect(browserService.openProfile).not.toHaveBeenCalled()
  await settleBrowser(async () => browser.retry())
  const { profile_mode: _mode, storage_shared: _shared, ...legacy } = state("shared")
  vi.mocked(browserService.openProfile).mockImplementationOnce(async () => { states.a = legacy; return legacy })
  await settleBrowser(async () => browser.openClean("a"))
  expect(browser.profile).toEqual({ kind: "unreported" })
  expect(browser.error).toContain("结果未确认")
  expect(browserService.openProfile).toHaveBeenCalledTimes(1)
})
