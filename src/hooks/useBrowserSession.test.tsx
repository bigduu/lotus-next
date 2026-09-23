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
  vi.mocked(browserService.get).mockResolvedValue({
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
