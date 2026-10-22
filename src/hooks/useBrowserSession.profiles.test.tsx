import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ApiError, NetworkRequestError } from "@services/api"
import { browserService } from "@services/browser/BrowserService"
import type { BrowserProfileMode, BrowserState } from "@services/browser/types"
import { useBrowserSession } from "./useBrowserSession"

vi.mock("@services/browser/BrowserService", () => ({ browserService: {
  open: vi.fn(), openProfile: vi.fn(), get: vi.fn(), close: vi.fn(), frame: vi.fn(), closeTab: vi.fn(),
} }))

const state = (mode: BrowserProfileMode, epoch = 1): BrowserState => ({
  profile_mode: mode, storage_shared: mode === "shared", page_epoch: epoch, frame_seq: 0,
  active_tab_id: "tab-a", tabs: [{ tab_id: "tab-a", url: "about:blank", title: "Page", active: true }],
  url: "about:blank", title: "Page", viewport: { width: 640, height: 480 }, can_go_back: false, can_go_forward: false,
})
const notOpen = () => new ApiError("closed", 404, "Not Found", JSON.stringify({ error: { code: "browser_not_open" } }))
let root: Root
let host: HTMLDivElement
let browser: ReturnType<typeof useBrowserSession>
let states: Record<string, BrowserState | null>
function Harness({ id = "a", active = true }: { id?: string; active?: boolean }) { browser = useBrowserSession(id, active); return null }
const render = async (id = "a", active = true) => act(async () => root.render(<Harness id={id} active={active} />))

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  states = { a: state("shared"), b: state("shared", 20) }
  vi.mocked(browserService.get).mockImplementation(async (id) => { const current = states[id]; if (!current) throw notOpen(); return current })
  vi.mocked(browserService.frame).mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.openProfile).mockImplementation(async (id, mode) => { states[id] = state(mode, 10); return states[id]! })
  vi.mocked(browserService.close).mockImplementation(async (id) => { states[id] = null })
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.resetAllMocks() })

it("treats canonical browser_not_open as closed and opens a selected mode only on explicit intent", async () => {
  states.a = null
  await render()
  expect(browser.profilePhase).toBe("closed")
  expect(browser.state).toBeNull()
  expect(browserService.open).not.toHaveBeenCalled()
  expect(browserService.openProfile).not.toHaveBeenCalled()
  await act(async () => browser.openProfile("a", "clean"))
  expect(browserService.openProfile).toHaveBeenCalledExactlyOnceWith("a", "clean", expect.any(AbortSignal))
  expect(browser.profilePhase).toBe("active")
  expect(browser.profile).toEqual({ kind: "reported", mode: "clean", storageShared: false })
})

it("reads an existing clean browser on mount and after hiding without mode-free PUT or DELETE", async () => {
  states.a = state("clean")
  await render()
  await render("a", false)
  await render()
  expect(browser.profile).toEqual({ kind: "reported", mode: "clean", storageShared: false })
  expect(browserService.open).not.toHaveBeenCalled()
  expect(browserService.openProfile).not.toHaveBeenCalled()
  expect(browserService.close).not.toHaveBeenCalled()
})

it("keeps explicit close chat-bound across A→B→A and retries only a GET", async () => {
  await render()
  await act(async () => browser.closeProfile("a"))
  expect(browser.profilePhase).toBe("closed")
  expect(browser.state).toBeNull()
  await render("b")
  expect(browser.state?.page_epoch).toBe(20)
  await act(async () => browser.closeProfile("a"))
  expect(browserService.close).toHaveBeenCalledExactlyOnceWith("a", expect.any(AbortSignal))
  expect(states.b?.tabs).toHaveLength(1)
  await render()
  await act(async () => browser.retry())
  expect(browser.profilePhase).toBe("closed")
  expect(browserService.open).not.toHaveBeenCalled()
  expect(browserService.openProfile).not.toHaveBeenCalled()
})

it("keeps a zero-tab browser active with its clean mode instead of deleting the scope", async () => {
  states.a = state("clean")
  vi.mocked(browserService.closeTab).mockImplementation(async () => ({ ...states.a!, tabs: [], active_tab_id: null }))
  await render()
  await act(async () => browser.closeTab("tab-a"))
  expect(browser.state?.tabs).toEqual([])
  expect(browser.profilePhase).toBe("active")
  expect(browser.profile).toMatchObject({ kind: "reported", mode: "clean" })
  expect(browserService.close).not.toHaveBeenCalled()
})

it("restores the canonical mode after a 409 without automatic close, reopen or retry", async () => {
  states.a = null
  await render()
  vi.mocked(browserService.openProfile).mockImplementationOnce(async () => {
    states.a = state("clean", 9)
    throw new ApiError("conflict", 409, "Conflict", JSON.stringify({ error: { type: "browser_error", code: "browser_profile_mode_conflict" } }))
  })
  await act(async () => browser.openProfile("a", "shared"))
  expect(browser.profile).toMatchObject({ kind: "reported", mode: "clean" })
  expect(browser.error).toContain("请先关闭")
  expect(browserService.openProfile).toHaveBeenCalledTimes(1)
  expect(browserService.open).not.toHaveBeenCalled()
  expect(browserService.close).not.toHaveBeenCalled()
})

it("does not replay an ambiguous DELETE and reads current state without claiming it closed", async () => {
  await render()
  vi.mocked(browserService.close).mockRejectedValueOnce(new NetworkRequestError())
  await act(async () => browser.closeProfile("a"))
  expect(browser.state?.profile_mode).toBe("shared")
  expect(browser.error).toContain("未确认")
  await act(async () => browser.retry())
  expect(browserService.close).toHaveBeenCalledTimes(1)
  expect(browserService.openProfile).not.toHaveBeenCalled()
  expect(browserService.open).not.toHaveBeenCalled()
})

it("fences a previous chat's late mode ACK and never applies it to the new chat", async () => {
  states.a = null
  await render()
  let finish!: (value: BrowserState) => void
  vi.mocked(browserService.openProfile).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  let operation!: Promise<void>
  await act(async () => { operation = browser.openProfile("a", "clean") })
  await render("b")
  await act(async () => { finish(state("clean", 99)); await operation })
  expect(browser.readySessionId).toBe("b")
  expect(browser.state?.page_epoch).toBe(20)
  expect(browser.profile).toMatchObject({ mode: "shared" })
  await render()
  expect(browser.profilePhase).toBe("closed")
  expect(browser.state).toBeNull()
  expect(browserService.openProfile).toHaveBeenCalledTimes(1)
})

it("submits one explicit open despite duplicate intent while its first request is pending", async () => {
  states.a = null
  await render()
  let finish!: (value: BrowserState) => void
  vi.mocked(browserService.openProfile).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  let operation!: Promise<void>
  await act(async () => { operation = browser.openProfile("a", "clean"); void browser.openProfile("a", "shared") })
  expect(browserService.openProfile).toHaveBeenCalledTimes(1)
  await act(async () => { states.a = state("clean"); finish(states.a); await operation })
  expect(browser.profile).toMatchObject({ mode: "clean" })
})
