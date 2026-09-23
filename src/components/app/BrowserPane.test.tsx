import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { browserService } from "@services/browser/BrowserService"
import { FileOperationsService } from "@/shared/services/FileOperationsService"
import { BrowserPane } from "./BrowserPane"

vi.mock("@services/browser/BrowserService", () => ({
  browserService: {
    open: vi.fn(),
    get: vi.fn(),
    frame: vi.fn(),
    screenshot: vi.fn(),
  },
}))

vi.mock("@/shared/services/FileOperationsService", () => ({
  FileOperationsService: { saveBinaryFile: vi.fn() },
}))

let root: Root
let host: HTMLDivElement

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.mocked(browserService.open).mockResolvedValue({
    page_epoch: 1,
    frame_seq: 0,
    url: "https://example.test/",
    title: "Example",
    viewport: { width: 640, height: 480 },
    can_go_back: false,
    can_go_forward: false,
  })
  vi.mocked(browserService.frame).mockImplementation(() => new Promise(() => {}))
  vi.mocked(browserService.screenshot).mockResolvedValue({
    arrayBuffer: async () => Uint8Array.of(0xff, 0xd8, 0xff).buffer,
  } as Blob)
  vi.mocked(FileOperationsService.saveBinaryFile).mockResolvedValue({ filename: "browser-screenshot.jpg", success: true })
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  await act(async () => root.render(<BrowserPane sessionId="sid" active />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.resetAllMocks()
})

it("saves a Bamboo screenshot through the platform file service", async () => {
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="保存网页截图"]')?.click())

  expect(browserService.screenshot).toHaveBeenCalledWith("sid", expect.any(AbortSignal))
  expect(FileOperationsService.saveBinaryFile).toHaveBeenCalledWith(
    Uint8Array.of(0xff, 0xd8, 0xff),
    [{ name: "JPEG 图像", extensions: ["jpg"] }],
    expect.stringMatching(/^browser-screenshot-\d+\.jpg$/),
  )
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

it("surfaces a native save failure but treats dialog cancellation as cancellation", async () => {
  vi.mocked(FileOperationsService.saveBinaryFile).mockResolvedValueOnce({
    filename: "",
    success: false,
    error: "permission denied",
  })
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="保存网页截图"]')?.click())
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("保存截图失败")

  vi.mocked(FileOperationsService.saveBinaryFile).mockResolvedValueOnce({
    filename: "",
    success: false,
    error: "User cancelled save operation",
  })
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="保存网页截图"]')?.click())
  expect(host.querySelector('[role="alert"]')).toBeNull()
})
