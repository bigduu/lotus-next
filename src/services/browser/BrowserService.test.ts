import { afterEach, expect, it, vi } from "vitest"
import { BrowserService } from "./BrowserService"
import { apiClient } from "@services/api"

vi.mock("@services/api", () => ({
  apiClient: {
    put: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    fetchRaw: vi.fn(),
  },
}))

const service = new BrowserService()

afterEach(() => vi.resetAllMocks())

it("binds every browser action to one encoded Bamboo session and epoch", async () => {
  const state = {
    page_epoch: 7,
    frame_seq: 1,
    url: "about:blank",
    title: "",
    viewport: { width: 640, height: 480 },
    can_go_back: false,
    can_go_forward: false,
  }
  vi.mocked(apiClient.put).mockResolvedValue(state)
  vi.mocked(apiClient.post).mockResolvedValue(state)
  const signal = new AbortController().signal

  await service.open("session/a", signal)
  await service.navigate("session/a", "https://example.test", 7)
  await service.history("session/a", "back", 7)
  await service.viewport("session/a", { width: 640, height: 480 }, 7)
  await service.input("session/a", { kind: "click", x: 12, y: 24 }, 7)
  await service.createTab("session/a", 7)
  await service.activateTab("session/a", "tab/b", 7)
  await service.closeTab("session/a", "tab/b", 7)
  await service.respondDialog("session/a", {
    dialog_id: "a".repeat(24), expected_epoch: 7, accept: true,
  })
  await service.respondDialog("session/a", {
    dialog_id: "a".repeat(24), expected_epoch: 7, accept: true, text: "",
  })

  expect(apiClient.put).toHaveBeenCalledWith("browser/sessions/session%2Fa", {}, { signal })
  expect(apiClient.post).toHaveBeenNthCalledWith(
    1,
    "browser/sessions/session%2Fa/navigate",
    { url: "https://example.test", expected_epoch: 7 },
  )
  expect(apiClient.post).toHaveBeenNthCalledWith(
    2,
    "browser/sessions/session%2Fa/history",
    { direction: "back", expected_epoch: 7 },
  )
  expect(apiClient.post).toHaveBeenNthCalledWith(
    3,
    "browser/sessions/session%2Fa/viewport",
    { width: 640, height: 480, expected_epoch: 7 },
  )
  expect(apiClient.post).toHaveBeenNthCalledWith(
    4,
    "browser/sessions/session%2Fa/input",
    { kind: "click", x: 12, y: 24, expected_epoch: 7 },
  )
  expect(apiClient.post).toHaveBeenNthCalledWith(
    5,
    "browser/sessions/session%2Fa/tabs",
    { expected_epoch: 7 },
  )
  expect(apiClient.post).toHaveBeenNthCalledWith(
    6,
    "browser/sessions/session%2Fa/tabs/activate",
    { tab_id: "tab/b", expected_epoch: 7 },
  )
  expect(apiClient.post).toHaveBeenNthCalledWith(
    7,
    "browser/sessions/session%2Fa/tabs/close",
    { tab_id: "tab/b", expected_epoch: 7 },
  )
  expect(apiClient.post).toHaveBeenNthCalledWith(
    8,
    "browser/sessions/session%2Fa/dialog",
    { dialog_id: "a".repeat(24), expected_epoch: 7, accept: true },
  )
  expect(apiClient.post).toHaveBeenNthCalledWith(
    9,
    "browser/sessions/session%2Fa/dialog",
    { dialog_id: "a".repeat(24), expected_epoch: 7, accept: true, text: "" },
  )
})

it("reads JPEG frame metadata, treats 204 as unchanged, and captures a fresh screenshot", async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
  vi.mocked(apiClient.fetchRaw)
    .mockResolvedValueOnce(new Response(bytes, {
      headers: {
        "content-type": "image/jpeg",
        "X-Frame-Seq": "9",
        "X-Page-Epoch": "42",
        "X-Tab-Id": "tab-a",
        "X-Viewport-Width": "800",
        "X-Viewport-Height": "600",
      },
    }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(bytes, {
      headers: { "content-type": "image/jpeg", "X-Page-Epoch": "42", "X-Tab-Id": "tab-a" },
    }))

  const signal = new AbortController().signal
  const frame = await service.frame("sid", 8, 1500, signal)
  expect(frame).toMatchObject({ frame_seq: 9, page_epoch: 42, active_tab_id: "tab-a", viewport: { width: 800, height: 600 } })
  expect(frame?.blob.size).toBe(bytes.byteLength)
  expect(frame?.blob.type).toBe("image/jpeg")
  expect(apiClient.fetchRaw).toHaveBeenNthCalledWith(
    1,
    "browser/sessions/sid/frame?after=8&wait_ms=1500",
    { cache: "no-store", signal },
  )
  await expect(service.frame("sid", 9, 1500, signal)).resolves.toBeNull()
  expect(await service.screenshot("sid", signal)).toMatchObject({
    page_epoch: 42,
    active_tab_id: "tab-a",
    blob: expect.objectContaining({ size: bytes.byteLength }),
  })
  expect(apiClient.fetchRaw).toHaveBeenNthCalledWith(
    3,
    "browser/sessions/sid/screenshot",
    { cache: "no-store", signal },
  )
})

it("rejects frames without readable metadata", async () => {
  vi.mocked(apiClient.fetchRaw).mockResolvedValue(new Response(new Uint8Array([0xff]), {
    headers: { "content-type": "image/jpeg" },
  }))
  await expect(service.frame("sid", 0, 0)).rejects.toThrow("X-Frame-Seq")
})
