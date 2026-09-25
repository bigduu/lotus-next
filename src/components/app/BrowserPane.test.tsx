import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { browserService } from "@services/browser/BrowserService"
import { ApiError } from "@services/api"
import { FileOperationsService } from "@/shared/services/FileOperationsService"
import { BrowserPane } from "./BrowserPane"

vi.mock("@services/browser/BrowserService", () => ({
  browserService: {
    open: vi.fn(),
    get: vi.fn(),
    frame: vi.fn(),
    screenshot: vi.fn(),
    createTab: vi.fn(),
    activateTab: vi.fn(),
    closeTab: vi.fn(),
    respondDialog: vi.fn(),
    input: vi.fn(),
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
  vi.mocked(browserService.get).mockResolvedValue({
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
    page_epoch: 1,
    blob: { arrayBuffer: async () => Uint8Array.of(0xff, 0xd8, 0xff).buffer } as Blob,
  })
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

it("clears save errors on chat switch and ignores a previous chat's delayed failure", async () => {
  vi.mocked(FileOperationsService.saveBinaryFile).mockResolvedValueOnce({
    filename: "",
    success: false,
    error: "permission denied",
  })
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="保存网页截图"]')?.click())
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("保存截图失败")

  await act(async () => root.render(<BrowserPane sessionId="second-chat" active />))
  expect(host.querySelector('[role="alert"]')).toBeNull()

  let finishSave!: (result: { filename: string; success: boolean; error: string }) => void
  vi.mocked(FileOperationsService.saveBinaryFile).mockImplementationOnce(() => new Promise((resolve) => {
    finishSave = resolve
  }))
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="保存网页截图"]')?.click())
  expect(FileOperationsService.saveBinaryFile).toHaveBeenCalledTimes(2)

  await act(async () => root.render(<BrowserPane sessionId="third-chat" active />))
  await act(async () => finishSave({ filename: "", success: false, error: "permission denied" }))
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

it("focuses a pending prompt while letting app controls keep focus and keyboard input", async () => {
  const pending = {
    page_epoch: 8, frame_seq: 1, active_tab_id: "tab-a",
    url: "https://example.test/", title: "Example",
    viewport: { width: 640, height: 480 }, can_go_back: false, can_go_forward: false,
    pending_dialog: {
      dialog_id: "a".repeat(24), tab_id: "tab-a", page_epoch: 8,
      url: "javascript:untrusted()", type: "prompt" as const,
      message: "Enter a value", message_truncated: false,
      default_value: "shown prefix", default_value_truncated: true,
      expires_at_ms: Date.now() + 30_000, status: "pending" as const,
    },
  }
  vi.mocked(browserService.open).mockResolvedValueOnce(pending)
  vi.mocked(browserService.get).mockResolvedValue(pending)
  await act(async () => root.render(<BrowserPane sessionId="prompt-chat" active />))

  const modal = host.querySelector<HTMLDivElement>('[role="dialog"]')!
  expect(modal.textContent).toContain("来自 未知网页")
  const prompt = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="弹窗输入"]')!
  const accept = Array.from(modal.querySelectorAll("button")).find((button) => button.textContent === "确定")!
  expect(document.activeElement).toBe(prompt)
  expect(modal.getAttribute("aria-modal")).toBe("false")
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="查看 DOM"]')?.disabled).toBe(true)
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="保存网页截图"]')?.disabled).toBe(true)
  expect(host.querySelector<HTMLInputElement>('input[aria-label="网页地址"]')?.disabled).toBe(true)
  const browserInput = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="网页键盘输入"]')!
  expect(browserInput.disabled).toBe(true)

  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
  await act(async () => {
    accept.focus()
    accept.dispatchEvent(tab)
  })
  expect(tab.defaultPrevented).toBe(false)

  const outside = document.body.appendChild(document.createElement("textarea"))
  outside.setAttribute("aria-label", "消息")
  await act(async () => outside.focus())
  const typed = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true })
  outside.dispatchEvent(typed)
  expect(document.activeElement).toBe(outside)
  expect(typed.defaultPrevented).toBe(false)
  await act(async () => browserInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
  expect(browserService.input).not.toHaveBeenCalled()

  await act(async () => root.render(<BrowserPane sessionId="another-chat" active />))
  expect(document.activeElement).toBe(outside)
  outside.remove()
})

it("clears the dialog overlay after a transient state failure when the model answers it", async () => {
  const current = {
    page_epoch: 8, frame_seq: 1, active_tab_id: "tab-a",
    url: "https://example.test/", title: "Example",
    viewport: { width: 640, height: 480 }, can_go_back: false, can_go_forward: false,
  }
  const pending = {
    ...current,
    pending_dialog: {
      dialog_id: "a".repeat(24), tab_id: "tab-a", page_epoch: 8,
      url: current.url, type: "alert" as const,
      message: "Page question", message_truncated: false,
      default_value: "", default_value_truncated: false,
      expires_at_ms: Date.now() + 30_000, status: "pending" as const,
    },
  }
  let resolveModel!: (next: typeof current) => void
  const modelResponse = new Promise<typeof current>((resolve) => { resolveModel = resolve })
  vi.mocked(browserService.open).mockResolvedValue(pending)
  vi.mocked(browserService.get)
    .mockRejectedValueOnce(new ApiError("temporarily unavailable", 503, "Unavailable"))
    .mockImplementation(() => modelResponse)

  await act(async () => root.render(<BrowserPane sessionId="recovering-dialog" active />))
  expect(host.querySelector("[data-browser-dialog]")).not.toBeNull()

  await act(async () => {
    await vi.waitFor(() => expect(browserService.get).toHaveBeenCalledTimes(2), { timeout: 3000 })
  })
  expect(host.querySelector("[data-browser-dialog]")).not.toBeNull()
  expect(host.querySelector('[role="alert"]')).toBeNull()

  await act(async () => resolveModel(current))
  expect(host.querySelector("[data-browser-dialog]")).toBeNull()
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(browserService.get).toHaveBeenCalledTimes(2)
})

it("keeps browser controls in one toolbar without a nested tab strip", () => {
  expect(host.querySelector('nav[aria-label="浏览器标签列表"]')).toBeNull()
  expect(host.querySelector('button[aria-label="新建标签页"]')).toBeNull()
  expect(host.querySelector('input[aria-label="网页地址"]')).not.toBeNull()
})

it("shows a focused address entry instead of browser chrome when no page exists", async () => {
  vi.mocked(browserService.open).mockResolvedValueOnce({
    page_epoch: 3, frame_seq: 0, active_tab_id: null, tabs: [],
    url: "", title: "", viewport: { width: 640, height: 480 },
    can_go_back: false, can_go_forward: false,
  })
  await act(async () => root.render(<BrowserPane sessionId="empty-chat" active />))

  expect(host.querySelector("[data-browser-empty]")?.textContent).toContain("还没有打开网页")
  expect(host.querySelector<HTMLInputElement>('input[aria-label="网页地址"]')).toBe(document.activeElement)
  expect(host.querySelector('button[aria-label="后退"]')).toBeNull()
  expect(host.querySelector("[data-browser-viewport]")).toBeNull()
})
