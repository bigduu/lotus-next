import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { browserService } from "@services/browser/BrowserService"
import { ApiError } from "@services/api"
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
    respondDialog: vi.fn(),
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

const emptyState = (epoch: number): BrowserState => ({
  ...state(epoch),
  active_tab_id: null,
  url: "",
  title: "",
  tabs: [],
})

const pendingState = (type: "alert" | "confirm" | "prompt" = "prompt"): BrowserState => ({
  ...tabbedState(17, "tab-a"),
  pending_dialog: {
    dialog_id: "a".repeat(24), tab_id: "tab-a", page_epoch: 17,
    url: "https://example.test/tab-a", type,
    message: "Page question", message_truncated: false,
    default_value: "default answer", default_value_truncated: false,
    expires_at_ms: Date.now() + 30_000, status: "pending",
  },
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

it("opens the first URL in one tab request without leaving a blank page", async () => {
  vi.mocked(browserService.open).mockResolvedValue(emptyState(7))
  vi.mocked(browserService.frame).mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.createTab).mockResolvedValue({
    ...tabbedState(8, "tab-a"),
    tabs: [{ tab_id: "tab-a", url: "https://example.test/first", title: "First", active: true }],
    url: "https://example.test/first",
  })

  await act(async () => root.render(<Harness />))
  expect(browser.state?.tabs).toHaveLength(0)
  await act(async () => browser.openUrlInNewTab("https://example.test/first"))

  expect(browserService.createTab).toHaveBeenCalledExactlyOnceWith("sid", 7, "https://example.test/first")
  expect(browserService.navigate).not.toHaveBeenCalled()
  expect(browser.state?.tabs).toHaveLength(1)
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

it("adopts a lower epoch and reset frame sequence after browser host recovery", async () => {
  vi.mocked(browserService.open).mockResolvedValue(tabbedState(90, "tab-a"))
  vi.mocked(browserService.get).mockResolvedValue(tabbedState(4, "tab-b"))
  vi.mocked(browserService.frame)
    .mockResolvedValueOnce({
      blob: new Blob(["old host"], { type: "image/jpeg" }),
      frame_seq: 20, page_epoch: 90, active_tab_id: "tab-a",
      viewport: { width: 640, height: 480 },
    })
    .mockResolvedValueOnce({
      blob: new Blob(["new host"], { type: "image/jpeg" }),
      frame_seq: 1, page_epoch: 4, active_tab_id: "tab-b",
      viewport: { width: 640, height: 480 },
    })
    .mockImplementation(() => new Promise(() => {}))

  await act(async () => root.render(<Harness />))

  expect(browser.state?.page_epoch).toBe(4)
  expect(browser.state?.active_tab_id).toBe("tab-b")
  expect(browser.frame?.page_epoch).toBe(4)
  expect(browser.frame?.active_tab_id).toBe("tab-b")
  expect(browser.frame?.frame_seq).toBe(1)
  expect(vi.mocked(browserService.frame).mock.calls[1]?.[1]).toBe(20)
  expect(vi.mocked(browserService.frame).mock.calls[2]?.[1]).toBe(1)
})

it("restarts at zero when a state read sees a recovered host before an old frame returns", async () => {
  let releaseOldFrame!: (value: Awaited<ReturnType<typeof browserService.frame>>) => void
  const oldFrame = new Promise<Awaited<ReturnType<typeof browserService.frame>>>((resolve) => {
    releaseOldFrame = resolve
  })
  vi.mocked(browserService.open).mockResolvedValue(tabbedState(90, "tab-a"))
  vi.mocked(browserService.get).mockResolvedValue(tabbedState(4, "tab-b"))
  vi.mocked(browserService.dom).mockResolvedValue({
    page_epoch: 4, active_tab_id: "tab-b", url: "https://example.test/tab-b",
    title: "tab-b", snapshot: "new host DOM",
  })
  vi.mocked(browserService.frame)
    .mockResolvedValueOnce({
      blob: new Blob(["old host"], { type: "image/jpeg" }),
      frame_seq: 20, page_epoch: 90, active_tab_id: "tab-a",
      viewport: { width: 640, height: 480 },
    })
    .mockImplementationOnce(() => oldFrame)
    .mockResolvedValueOnce({
      blob: new Blob(["new host"], { type: "image/jpeg" }),
      frame_seq: 1, page_epoch: 4, active_tab_id: "tab-b",
      viewport: { width: 640, height: 480 },
    })
    .mockImplementation(() => new Promise(() => {}))

  await act(async () => root.render(<Harness />))
  expect(browser.frame?.frame_seq).toBe(20)
  expect(vi.mocked(browserService.frame).mock.calls[1]?.[1]).toBe(20)
  await act(async () => browser.inspectDom())
  expect(browser.state?.page_epoch).toBe(4)
  expect(browser.state?.active_tab_id).toBe("tab-b")
  expect(browser.frame).toBeNull()

  await act(async () => releaseOldFrame({
    blob: new Blob(["late old host"], { type: "image/jpeg" }),
    frame_seq: 21, page_epoch: 90, active_tab_id: "tab-a",
    viewport: { width: 640, height: 480 },
  }))
  expect(vi.mocked(browserService.frame).mock.calls[2]?.[1]).toBe(0)
  expect(browser.frame?.frame_seq).toBe(1)
  expect(browser.frame?.page_epoch).toBe(4)
  expect(browser.frame?.active_tab_id).toBe("tab-b")
})

it("advances past a stale frame on the same page without a hot poll loop", async () => {
  vi.mocked(browserService.open).mockResolvedValue(tabbedState(90, "tab-a"))
  vi.mocked(browserService.get).mockResolvedValue(tabbedState(90, "tab-a"))
  vi.mocked(browserService.frame)
    .mockResolvedValueOnce({
      blob: new Blob(["current"], { type: "image/jpeg" }),
      frame_seq: 20, page_epoch: 90, active_tab_id: "tab-a",
      viewport: { width: 640, height: 480 },
    })
    .mockResolvedValueOnce({
      blob: new Blob(["stale"], { type: "image/jpeg" }),
      frame_seq: 21, page_epoch: 89, active_tab_id: "tab-a",
      viewport: { width: 640, height: 480 },
    })
    .mockImplementation(() => new Promise(() => {}))

  await act(async () => root.render(<Harness />))
  expect(vi.mocked(browserService.frame).mock.calls[2]?.[1]).toBe(21)
  expect(browser.frame).toBeNull()
})

it("does not let an older state request overwrite a completed tab switch", async () => {
  let releaseGet!: (value: BrowserState) => void
  const staleGet = new Promise<BrowserState>((resolve) => { releaseGet = resolve })
  vi.mocked(browserService.open).mockResolvedValue(tabbedState(90, "tab-a"))
  vi.mocked(browserService.frame).mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.dom).mockResolvedValue({
    page_epoch: 90, active_tab_id: "tab-a", url: "https://example.test/tab-a",
    title: "tab-a", snapshot: "old DOM",
  })
  vi.mocked(browserService.get).mockImplementation(() => staleGet)
  vi.mocked(browserService.activateTab).mockResolvedValue(tabbedState(91, "tab-b"))

  await act(async () => root.render(<Harness />))
  let inspect!: Promise<void>
  await act(async () => { inspect = browser.inspectDom() })
  await act(async () => browser.activateTab("tab-b"))
  await act(async () => releaseGet(tabbedState(90, "tab-a")))
  await act(async () => inspect)

  expect(browser.state?.page_epoch).toBe(91)
  expect(browser.state?.active_tab_id).toBe("tab-b")
  expect(browser.dom).toBeNull()
})

it("fences frames when a queued close becomes an active-tab close", async () => {
  let releaseOldFrame!: (value: Awaited<ReturnType<typeof browserService.frame>>) => void
  let releaseActivation!: (value: BrowserState) => void
  let releaseClose!: (value: BrowserState) => void
  const oldFrame = new Promise<Awaited<ReturnType<typeof browserService.frame>>>((resolve) => { releaseOldFrame = resolve })
  const activation = new Promise<BrowserState>((resolve) => { releaseActivation = resolve })
  const close = new Promise<BrowserState>((resolve) => { releaseClose = resolve })
  vi.mocked(browserService.open).mockResolvedValue(tabbedState(1, "tab-a"))
  vi.mocked(browserService.frame)
    .mockResolvedValueOnce({
      blob: new Blob(["first frame"], { type: "image/jpeg" }),
      frame_seq: 1, page_epoch: 1, active_tab_id: "tab-a",
      viewport: { width: 640, height: 480 },
    })
    .mockImplementationOnce(() => oldFrame)
    .mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.activateTab).mockImplementation(() => activation)
  vi.mocked(browserService.closeTab).mockImplementation(() => close)

  await act(async () => root.render(<Harness />))
  let switching!: Promise<void>
  let closing!: Promise<void>
  await act(async () => {
    switching = browser.activateTab("tab-b")
    closing = browser.closeTab("tab-b")
  })
  await act(async () => { releaseActivation(tabbedState(2, "tab-b")); await switching })
  expect(browser.state?.active_tab_id).toBe("tab-b")
  expect(browserService.closeTab).toHaveBeenCalledWith("sid", "tab-b", 2)
  await act(async () => releaseOldFrame({
    blob: new Blob(["late frame"], { type: "image/jpeg" }),
    frame_seq: 2, page_epoch: 1, active_tab_id: "tab-a",
    viewport: { width: 640, height: 480 },
  }))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)) })
  expect(browser.frame).toBeNull()
  expect(browserService.frame).toHaveBeenCalledTimes(2)

  await act(async () => { releaseClose(tabbedState(3, "tab-a")); await closing })
  expect(browser.state?.active_tab_id).toBe("tab-a")
})

it("keeps a cached JPEG and stops incompatible reads while a dialog is pending", async () => {
  const current = tabbedState(17, "tab-a")
  vi.mocked(browserService.open).mockResolvedValue(current)
  vi.mocked(browserService.frame)
    .mockResolvedValueOnce({
      blob: new Blob(["cached"], { type: "image/jpeg" }), frame_seq: 4,
      page_epoch: 17, active_tab_id: "tab-a", viewport: { width: 640, height: 480 },
    })
    .mockRejectedValueOnce(new ApiError("dialog pending", 409, "Conflict"))
    .mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.get).mockResolvedValue(pendingState())

  await act(async () => root.render(<Harness />))
  expect(browser.state?.pending_dialog?.dialog_id).toBe("a".repeat(24))
  expect(browser.frame?.frame_seq).toBe(4)
  expect(browser.error).toBeNull()
  expect(browserService.frame).toHaveBeenCalledTimes(2)
  await act(async () => {
    await browser.navigate("https://another.test/")
    await browser.viewport({ width: 800, height: 600 })
    await browser.inspectDom()
    await browser.captureScreenshot()
  })
  expect(browserService.navigate).not.toHaveBeenCalled()
  expect(browserService.viewport).not.toHaveBeenCalled()
  expect(browserService.dom).not.toHaveBeenCalled()
  expect(browserService.screenshot).not.toHaveBeenCalled()
  expect(browser.frame?.frame_seq).toBe(4)
})

it("keeps the cached frame and resumes when one pending state read fails before the model resolves the dialog", async () => {
  const current = tabbedState(17, "tab-a")
  let resolveModel!: (next: BrowserState) => void
  const modelResponse = new Promise<BrowserState>((resolve) => { resolveModel = resolve })
  vi.mocked(browserService.open).mockResolvedValue(current)
  vi.mocked(browserService.frame)
    .mockResolvedValueOnce({
      blob: new Blob(["cached"], { type: "image/jpeg" }), frame_seq: 4,
      page_epoch: 17, active_tab_id: "tab-a", viewport: { width: 640, height: 480 },
    })
    .mockRejectedValueOnce(new ApiError("dialog pending", 409, "Conflict"))
    .mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.get)
    .mockResolvedValueOnce(pendingState())
    .mockRejectedValueOnce(new ApiError("temporarily unavailable", 503, "Unavailable"))
    .mockImplementation(() => modelResponse)

  await act(async () => root.render(<Harness />))
  expect(browser.state?.pending_dialog?.dialog_id).toBe("a".repeat(24))
  expect(browser.frame?.frame_seq).toBe(4)

  await act(async () => {
    await vi.waitFor(() => expect(browserService.get).toHaveBeenCalledTimes(3), { timeout: 3000 })
  })
  expect(browser.state?.pending_dialog?.dialog_id).toBe("a".repeat(24))
  expect(browser.frame?.frame_seq).toBe(4)
  expect(browser.error).toBeNull()

  await act(async () => resolveModel(current))
  expect(browserService.get).toHaveBeenCalledTimes(3)
  expect(browser.state?.pending_dialog).toBeUndefined()
  expect(browser.frame?.frame_seq).toBe(4)
  expect(browser.error).toBeNull()
})

it("answers an exact dialog without prompt text when untouched and refreshes a stale 409", async () => {
  vi.mocked(browserService.open).mockResolvedValue(pendingState())
  vi.mocked(browserService.frame).mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.respondDialog).mockRejectedValue(new ApiError(
    "stale dialog", 409, "Conflict", JSON.stringify({ error: { code: "stale_dialog" } }),
  ))
  vi.mocked(browserService.get).mockResolvedValue(tabbedState(18, "tab-b"))

  await act(async () => root.render(<Harness />))
  await act(async () => browser.respondDialog(true))
  expect(browserService.respondDialog).toHaveBeenCalledWith("sid", {
    dialog_id: "a".repeat(24), expected_epoch: 17, accept: true,
  })
  expect(browser.state?.active_tab_id).toBe("tab-b")
  expect(browser.state?.page_epoch).toBe(18)
  expect(browser.error).toBeNull()
})

it("answers a background tab dialog using that dialog's identity while another tab stays active", async () => {
  const pending = pendingState("confirm")
  pending.pending_dialog!.tab_id = "tab-b"
  pending.pending_dialog!.url = "https://background.test/question"
  vi.mocked(browserService.open).mockResolvedValue(pending)
  vi.mocked(browserService.frame).mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.respondDialog).mockResolvedValue(tabbedState(17, "tab-a"))

  await act(async () => root.render(<Harness />))
  await act(async () => browser.respondDialog(false))
  expect(browserService.respondDialog).toHaveBeenCalledWith("sid", {
    dialog_id: "a".repeat(24), expected_epoch: 17, accept: false,
  })
  expect(browser.state?.active_tab_id).toBe("tab-a")
  expect(browser.state?.pending_dialog).toBeUndefined()
})

it("discards a late background tab response after the active tab changes", async () => {
  const pending = pendingState("confirm")
  pending.pending_dialog!.tab_id = "tab-b"
  pending.pending_dialog!.url = "https://background.test/question"
  let releaseResponse!: (value: BrowserState) => void
  const response = new Promise<BrowserState>((resolve) => { releaseResponse = resolve })
  vi.mocked(browserService.open).mockResolvedValue(pending)
  vi.mocked(browserService.frame).mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.respondDialog).mockImplementation(() => response)
  vi.mocked(browserService.get).mockResolvedValue({
    ...tabbedState(18, "tab-b"), pending_dialog: pending.pending_dialog,
  })

  await act(async () => root.render(<Harness />))
  let answering!: Promise<void>
  await act(async () => { answering = browser.respondDialog(true) })
  expect(browserService.respondDialog).toHaveBeenCalledTimes(1)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)) })
  expect(browser.state?.active_tab_id).toBe("tab-b")
  await act(async () => { releaseResponse(pending); await answering })
  expect(browser.state?.active_tab_id).toBe("tab-b")
  expect(browser.state?.page_epoch).toBe(18)
})

it("sends an explicitly empty prompt and discards a late result after model tab change", async () => {
  let releaseResponse!: (value: BrowserState) => void
  const response = new Promise<BrowserState>((resolve) => { releaseResponse = resolve })
  vi.mocked(browserService.open).mockResolvedValue(pendingState())
  vi.mocked(browserService.frame).mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.respondDialog).mockImplementation(() => response)
  vi.mocked(browserService.get).mockResolvedValue(tabbedState(18, "tab-b"))

  await act(async () => root.render(<Harness />))
  let answering!: Promise<void>
  await act(async () => { answering = browser.respondDialog(true, "") })
  expect(browserService.respondDialog).toHaveBeenCalledWith("sid", {
    dialog_id: "a".repeat(24), expected_epoch: 17, accept: true, text: "",
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)) })
  expect(browser.state?.active_tab_id).toBe("tab-b")
  await act(async () => { releaseResponse(pendingState()); await answering })
  expect(browser.state?.page_epoch).toBe(18)
  expect(browser.state?.active_tab_id).toBe("tab-b")
})
