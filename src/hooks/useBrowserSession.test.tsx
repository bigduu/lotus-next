import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { browserService } from "@services/browser/BrowserService"
import { useBrowserSession } from "./useBrowserSession"
import type { BrowserState } from "@services/browser/types"

vi.mock("@services/browser/BrowserService", () => ({
  browserService: {
    open: vi.fn(),
    get: vi.fn(),
    frame: vi.fn(),
    navigate: vi.fn(),
    history: vi.fn(),
    viewport: vi.fn(),
    input: vi.fn(),
    createTab: vi.fn(),
    activateTab: vi.fn(),
    closeTab: vi.fn(),
    dom: vi.fn(),
    screenshot: vi.fn(),
  },
}))

const state = (epoch: number, sequence = 0): BrowserState => ({
  page_epoch: epoch,
  frame_seq: sequence,
  url: "https://example.test/",
  title: "Example",
  viewport: { width: 640, height: 480 },
  can_go_back: false,
  can_go_forward: false,
})

const tabbedState = (epoch: number, activeTabId: string): BrowserState => ({
  ...state(epoch),
  active_tab_id: activeTabId,
  url: `https://example.test/${activeTabId}`,
  title: activeTabId,
  tabs: ["tab-a", "tab-b"].map((tabId) => ({
    tab_id: tabId,
    url: `https://example.test/${tabId}`,
    title: tabId,
    active: tabId === activeTabId,
  })),
})

let root: Root
let host: HTMLDivElement
let browser: ReturnType<typeof useBrowserSession>
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL")
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL")

function Harness({ sessionId = "sid", active = true }: { sessionId?: string; active?: boolean }) {
  browser = useBrowserSession(sessionId, active)
  return null
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:frame-1") })
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() })
  vi.mocked(browserService.open).mockResolvedValue(state(1))
  vi.mocked(browserService.get).mockResolvedValue(state(1))
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.resetAllMocks()
  if (originalCreateObjectURL) Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL)
  else Reflect.deleteProperty(URL, "createObjectURL")
  if (originalRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectURL)
  else Reflect.deleteProperty(URL, "revokeObjectURL")
})

it("stops polling and frees the frame when the tab hides without deleting the Bamboo page", async () => {
  vi.mocked(browserService.frame)
    .mockResolvedValueOnce({
      blob: new Blob(["frame"], { type: "image/jpeg" }),
      frame_seq: 1,
      page_epoch: 1,
      viewport: { width: 640, height: 480 },
    })
    .mockImplementation(() => new Promise(() => {}))

  await act(async () => root.render(<Harness />))
  expect(browser.frame?.frame_seq).toBe(1)
  const signal = vi.mocked(browserService.frame).mock.calls[1]?.[3]
  expect(signal?.aborted).toBe(false)

  await act(async () => root.render(<Harness active={false} />))
  expect(signal?.aborted).toBe(true)
  expect(browser.frame).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:frame-1")
  expect(browserService.open).toHaveBeenCalledTimes(1)
})

it("restarts frame polling from zero after navigation changes the page epoch", async () => {
  let releaseSecond!: (value: null) => void
  const secondFrame = new Promise<null>((resolve) => { releaseSecond = resolve })
  vi.mocked(browserService.frame)
    .mockResolvedValueOnce({
      blob: new Blob(["frame"], { type: "image/jpeg" }),
      frame_seq: 5,
      page_epoch: 1,
      viewport: { width: 640, height: 480 },
    })
    .mockImplementationOnce(() => secondFrame)
    .mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.navigate).mockResolvedValue(state(2))

  await act(async () => root.render(<Harness />))
  expect(vi.mocked(browserService.frame).mock.calls[1]?.[1]).toBe(5)
  await act(async () => browser.navigate("https://example.test/next"))
  await act(async () => releaseSecond(null))

  expect(vi.mocked(browserService.frame).mock.calls[2]?.[1]).toBe(0)
  expect(browser.state?.page_epoch).toBe(2)
  expect(browser.frame).toBeNull()
})

it("clears an open DOM snapshot when the agent navigates the shared page", async () => {
  let releaseRemoteFrame!: (value: {
    blob: Blob
    frame_seq: number
    page_epoch: number
    viewport: { width: number; height: number }
  }) => void
  const remoteFrame = new Promise<{
    blob: Blob
    frame_seq: number
    page_epoch: number
    viewport: { width: number; height: number }
  }>((resolve) => { releaseRemoteFrame = resolve })
  vi.mocked(browserService.frame)
    .mockResolvedValueOnce({
      blob: new Blob(["old frame"], { type: "image/jpeg" }),
      frame_seq: 1,
      page_epoch: 1,
      viewport: { width: 640, height: 480 },
    })
    .mockImplementationOnce(() => remoteFrame)
    .mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.dom).mockResolvedValue({
    page_epoch: 1,
    url: "https://example.test/",
    title: "Example",
    snapshot: "old DOM",
  })
  vi.mocked(browserService.get)
    .mockResolvedValueOnce(state(1))
    .mockResolvedValue({
      ...state(2, 2),
      url: "https://example.test/next",
    })

  await act(async () => root.render(<Harness />))
  await act(async () => browser.inspectDom())
  expect(browser.dom?.snapshot).toBe("old DOM")

  await act(async () => releaseRemoteFrame({
    blob: new Blob(["new frame"], { type: "image/jpeg" }),
    frame_seq: 2,
    page_epoch: 2,
    viewport: { width: 640, height: 480 },
  }))

  expect(browser.state?.url).toBe("https://example.test/next")
  expect(browser.dom).toBeNull()
  expect(browser.frame?.page_epoch).toBe(2)
})

it("discards an in-flight old-tab frame and DOM after a human tab switch", async () => {
  let releaseFrame!: (frame: {
    blob: Blob; frame_seq: number; page_epoch: number; active_tab_id: string;
    viewport: { width: number; height: number }
  }) => void
  let releaseDom!: (snapshot: {
    page_epoch: number; active_tab_id: string; url: string; title: string; snapshot: string
  }) => void
  const delayedFrame = new Promise<Awaited<ReturnType<typeof browserService.frame>>>((resolve) => {
    releaseFrame = resolve as typeof releaseFrame
  })
  const delayedDom = new Promise<Awaited<ReturnType<typeof browserService.dom>>>((resolve) => {
    releaseDom = resolve
  })
  vi.mocked(browserService.open).mockResolvedValue(tabbedState(1, "tab-a"))
  vi.mocked(browserService.get).mockResolvedValue(tabbedState(2, "tab-b"))
  vi.mocked(browserService.frame)
    .mockResolvedValueOnce({
      blob: new Blob(["old frame"], { type: "image/jpeg" }),
      frame_seq: 1,
      page_epoch: 1,
      active_tab_id: "tab-a",
      viewport: { width: 640, height: 480 },
    })
    .mockImplementationOnce(() => delayedFrame)
    .mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.dom).mockImplementation(() => delayedDom)
  vi.mocked(browserService.activateTab).mockResolvedValue(tabbedState(2, "tab-b"))

  await act(async () => root.render(<Harness />))
  expect(browser.frame?.active_tab_id).toBe("tab-a")
  let inspect!: Promise<void>
  await act(async () => { inspect = browser.inspectDom() })
  await act(async () => browser.activateTab("tab-b"))
  expect(browser.state?.active_tab_id).toBe("tab-b")
  expect(browser.frame).toBeNull()
  await act(async () => releaseDom({
    page_epoch: 1, active_tab_id: "tab-a", url: "https://example.test/tab-a",
    title: "tab-a", snapshot: "old DOM",
  }))
  await act(async () => inspect)
  expect(browser.dom).toBeNull()
  await act(async () => releaseFrame({
    blob: new Blob(["late old frame"], { type: "image/jpeg" }),
    frame_seq: 2, page_epoch: 1, active_tab_id: "tab-a",
    viewport: { width: 640, height: 480 },
  }))
  expect(browser.frame).toBeNull()
  expect(vi.mocked(browserService.frame).mock.calls.at(-1)?.[1]).toBe(0)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:frame-1")
})

it("rejects a delayed screenshot after a popup becomes the active tab", async () => {
  let releaseScreenshot!: (value: Awaited<ReturnType<typeof browserService.screenshot>>) => void
  const delayedScreenshot = new Promise<Awaited<ReturnType<typeof browserService.screenshot>>>((resolve) => {
    releaseScreenshot = resolve
  })
  vi.mocked(browserService.open).mockResolvedValue(tabbedState(1, "tab-a"))
  vi.mocked(browserService.frame).mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.screenshot).mockImplementation(() => delayedScreenshot)
  vi.mocked(browserService.get).mockResolvedValue(tabbedState(2, "tab-b"))

  await act(async () => root.render(<Harness />))
  let capture!: Promise<Awaited<ReturnType<typeof browser.captureScreenshot>>>
  await act(async () => { capture = browser.captureScreenshot() })
  await act(async () => releaseScreenshot({
    blob: new Blob(["old screenshot"], { type: "image/jpeg" }),
    page_epoch: 1,
    active_tab_id: "tab-a",
  }))
  expect(await capture).toBeNull()
  expect(browser.state?.active_tab_id).toBe("tab-b")
})

it("keeps the old frame hidden when its poll returns before tab activation completes", async () => {
  let releaseOldFrame!: (value: Awaited<ReturnType<typeof browserService.frame>>) => void
  let releaseActivation!: (value: BrowserState) => void
  const oldFrame = new Promise<Awaited<ReturnType<typeof browserService.frame>>>((resolve) => {
    releaseOldFrame = resolve
  })
  const activation = new Promise<BrowserState>((resolve) => { releaseActivation = resolve })
  vi.mocked(browserService.open).mockResolvedValue(tabbedState(1, "tab-a"))
  vi.mocked(browserService.frame)
    .mockResolvedValueOnce({
      blob: new Blob(["first frame"], { type: "image/jpeg" }),
      frame_seq: 1, page_epoch: 1, active_tab_id: "tab-a",
      viewport: { width: 640, height: 480 },
    })
    .mockImplementationOnce(() => oldFrame)
    .mockResolvedValueOnce({
      blob: new Blob(["new frame"], { type: "image/jpeg" }),
      frame_seq: 3, page_epoch: 2, active_tab_id: "tab-b",
      viewport: { width: 640, height: 480 },
    })
    .mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.activateTab).mockImplementation(() => activation)

  await act(async () => root.render(<Harness />))
  expect(browser.frame?.active_tab_id).toBe("tab-a")
  let switching!: Promise<void>
  await act(async () => { switching = browser.activateTab("tab-b") })
  expect(browser.frame).toBeNull()
  await act(async () => releaseOldFrame({
    blob: new Blob(["late old frame"], { type: "image/jpeg" }),
    frame_seq: 2, page_epoch: 1, active_tab_id: "tab-a",
    viewport: { width: 640, height: 480 },
  }))
  expect(browser.frame).toBeNull()
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1)

  await act(async () => { releaseActivation(tabbedState(2, "tab-b")); await switching })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)) })
  expect(browser.frame?.active_tab_id).toBe("tab-b")
})
