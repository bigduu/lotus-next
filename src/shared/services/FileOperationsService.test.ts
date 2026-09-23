import { beforeEach, expect, it, vi } from "vitest"
import { save } from "@tauri-apps/plugin-dialog"
import { writeFile } from "@tauri-apps/plugin-fs"
import { FileOperationsService } from "./FileOperationsService"

vi.mock("@/utils/environment", () => ({ isTauriEnvironment: () => true }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }))
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn(), writeTextFile: vi.fn() }))

beforeEach(() => {
  vi.mocked(save).mockResolvedValue("/tmp/browser-screenshot.jpg")
})

it("writes JPEG bytes selected by the native save dialog", async () => {
  const bytes = Uint8Array.of(0xff, 0xd8, 0xff)
  const result = await FileOperationsService.saveBinaryFile(
    bytes,
    [{ name: "JPEG 图像", extensions: ["jpg"] }],
    "browser-screenshot.jpg",
  )

  expect(save).toHaveBeenCalledWith({
    filters: [{ name: "JPEG 图像", extensions: ["jpg"] }],
    defaultPath: "browser-screenshot.jpg",
  })
  expect(writeFile).toHaveBeenCalledWith("/tmp/browser-screenshot.jpg", bytes)
  expect(result).toEqual({ filename: "browser-screenshot.jpg", success: true })
})
