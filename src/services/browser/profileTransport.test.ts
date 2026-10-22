import { afterEach, expect, it, vi } from "vitest"
import { BrowserService } from "./BrowserService"
import { apiClient } from "@services/api"
vi.mock("@services/api", () => ({ apiClient: { putOnce: vi.fn(), deleteOnce: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
afterEach(() => vi.resetAllMocks())
it("uses single-attempt PUT with only the selected profile mode and encoded chat", async () => {
  const signal = new AbortController().signal
  await new BrowserService().openProfile("chat/a", "clean", signal)
  expect(apiClient.putOnce).toHaveBeenCalledExactlyOnceWith("browser/sessions/chat%2Fa", { profile_mode: "clean" }, { signal })
  expect(apiClient.post).not.toHaveBeenCalled()
})
it("uses a single-attempt DELETE only for the selected chat", async () => {
  const signal = new AbortController().signal
  await new BrowserService().close("chat/a", signal)
  expect(apiClient.deleteOnce).toHaveBeenCalledExactlyOnceWith("browser/sessions/chat%2Fa", { signal })
  expect(apiClient.delete).not.toHaveBeenCalled()
})
