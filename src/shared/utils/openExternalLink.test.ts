import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { isTauriEnvironment } = vi.hoisted(() => ({
  isTauriEnvironment: vi.fn<() => boolean>(),
}))

vi.mock("../../utils/environment", () => ({ isTauriEnvironment }))

import { openExternalLink } from "./openExternalLink"

beforeEach(() => {
  isTauriEnvironment.mockReset().mockReturnValue(true)
})

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__")
})

describe("openExternalLink on Bodhi desktop", () => {
  it("uses the shell plugin to open the user's default browser", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { invoke },
    })
    const popup = vi.spyOn(window, "open")

    await openExternalLink(" https://example.com/readme ")

    expect(invoke).toHaveBeenCalledExactlyOnceWith("plugin:shell|open", {
      path: "https://example.com/readme",
    })
    expect(popup).not.toHaveBeenCalled()
  })

  it("reports a shell failure instead of silently trying a webview popup", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("shell denied"))
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { invoke },
    })
    const popup = vi.spyOn(window, "open")

    await expect(openExternalLink("https://example.com/readme")).rejects.toThrow("shell denied")
    expect(popup).not.toHaveBeenCalled()
  })
})
