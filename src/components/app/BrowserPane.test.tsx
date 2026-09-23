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
    createTab: vi.fn(),
    activateTab: vi.fn(),
    closeTab: vi.fn(),
    respondDialog: vi.fn(),
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

it("focuses a pending prompt and traps keyboard focus inside the dialog", async () => {
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
  const cancel = Array.from(modal.querySelectorAll("button")).find((button) => button.textContent === "取消")!
  expect(document.activeElement).toBe(prompt)
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="查看 DOM"]')?.disabled).toBe(true)
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="保存网页截图"]')?.disabled).toBe(true)
  expect(host.querySelector<HTMLInputElement>('input[aria-label="网页地址"]')?.disabled).toBe(true)

  await act(async () => {
    prompt.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
  })
  expect(document.activeElement).toBe(cancel)
  await act(async () => {
    accept.focus()
    accept.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
  })
  expect(document.activeElement).toBe(prompt)

  const outside = document.body.appendChild(document.createElement("button"))
  await act(async () => outside.focus())
  expect(document.activeElement).toBe(prompt)
  outside.remove()
})

it("shows accessible tab controls and sends create, switch, and close to Bamboo", async () => {
  const tabs = [
    { tab_id: "tab-a", url: "https://a.test/", title: "Alpha", active: true },
    { tab_id: "tab-b", url: "https://b.test/", title: "Beta", active: false },
  ]
  const first = {
    page_epoch: 4, frame_seq: 0, url: tabs[0].url, title: tabs[0].title,
    viewport: { width: 640, height: 480 }, can_go_back: false, can_go_forward: false,
    active_tab_id: "tab-a", tabs,
  }
  const second = {
    ...first, page_epoch: 5, url: tabs[1].url, title: tabs[1].title,
    active_tab_id: "tab-b", tabs: tabs.map((tab) => ({ ...tab, active: tab.tab_id === "tab-b" })),
  }
  const returned = { ...first, page_epoch: 6 }
  const closed = { ...second, page_epoch: 7, tabs: [second.tabs[1]] }
  vi.mocked(browserService.open).mockResolvedValueOnce(first)
  vi.mocked(browserService.createTab).mockResolvedValueOnce(second)
  vi.mocked(browserService.activateTab).mockResolvedValueOnce(returned)
  vi.mocked(browserService.closeTab).mockResolvedValueOnce(closed)
  await act(async () => root.render(<BrowserPane sessionId="tabbed" active />))

  const tabList = host.querySelector('nav[aria-label="浏览器标签列表"]')
  expect(tabList).not.toBeNull()
  expect(tabList?.querySelector('[aria-current="page"]')?.textContent).toBe("Alpha")
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="新建标签页"]')?.click())
  expect(browserService.createTab).toHaveBeenCalledWith("tabbed", 4)
  expect(tabList?.querySelector('[aria-current="page"]')?.textContent).toBe("Beta")
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="切换到标签页 1：Alpha"]')?.click())
  expect(browserService.activateTab).toHaveBeenCalledWith("tabbed", "tab-a", 5)
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="关闭标签页 1：Alpha"]')?.click())
  expect(browserService.closeTab).toHaveBeenCalledWith("tabbed", "tab-a", 6)
})

it("hides tab controls for older Bamboo state", () => {
  expect(host.querySelector('nav[aria-label="浏览器标签列表"]')).toBeNull()
  expect(host.querySelector('button[aria-label="新建标签页"]')).toBeNull()
})

it("does not start saving screenshot bytes after the active tab changes", async () => {
  const tabs = [
    { tab_id: "tab-a", url: "https://a.test/", title: "Alpha", active: true },
    { tab_id: "tab-b", url: "https://b.test/", title: "Beta", active: false },
  ]
  const first = {
    page_epoch: 1, frame_seq: 0, url: tabs[0].url, title: tabs[0].title,
    viewport: { width: 640, height: 480 }, can_go_back: false, can_go_forward: false,
    active_tab_id: "tab-a", tabs,
  }
  const second = {
    ...first, page_epoch: 2, url: tabs[1].url, title: tabs[1].title,
    active_tab_id: "tab-b", tabs: tabs.map((tab) => ({ ...tab, active: tab.tab_id === "tab-b" })),
  }
  vi.mocked(browserService.open).mockResolvedValueOnce(first)
  vi.mocked(browserService.get).mockResolvedValue(first)
  vi.mocked(browserService.activateTab).mockResolvedValue(second)
  let releaseBytes!: (bytes: ArrayBuffer) => void
  vi.mocked(browserService.screenshot).mockResolvedValue({
    page_epoch: 1,
    active_tab_id: "tab-a",
    blob: { arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => { releaseBytes = resolve }) } as Blob,
  })
  await act(async () => root.render(<BrowserPane sessionId="tabbed-save" active />))
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="保存网页截图"]')?.click())
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="切换到标签页 2：Beta"]')?.click())
  await act(async () => releaseBytes(Uint8Array.of(0xff, 0xd8).buffer))
  expect(FileOperationsService.saveBinaryFile).not.toHaveBeenCalled()
})
