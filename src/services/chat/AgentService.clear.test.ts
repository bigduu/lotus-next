import { beforeEach, describe, expect, it, vi } from "vitest"
const mock = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }))
vi.mock("@services/api", () => ({ apiClient: mock }))
import { agentClient } from "./AgentService"

beforeEach(() => { mock.post.mockReset(); mock.get.mockReset() })
describe("C1 wire receipt", () => {
  it("sends the existing body-free POST once and requires an exact receipt", async () => {
    mock.post.mockResolvedValue({ success: true, session_id: "fixture/session" })
    await agentClient.clearSession("fixture/session")
    expect(mock.post).toHaveBeenCalledExactlyOnceWith("sessions/fixture%2Fsession/clear")
  })
  it.each([undefined, null, {}, { success: false, session_id: "fixture/session" }, { success: true, session_id: "other" }])("rejects malformed success %#", async (receipt) => {
    mock.post.mockResolvedValue(receipt)
    await expect(agentClient.clearSession("fixture/session")).rejects.toThrow()
    expect(mock.post).toHaveBeenCalledTimes(1)
  })
  it("reads encoded detail/history without a browser cache", async () => {
    mock.get.mockResolvedValue({ session_id: "fixture/session", messages: [] })
    await agentClient.getSession("fixture/session")
    await agentClient.getHistory("fixture/session")
    expect(mock.get.mock.calls).toEqual([
      ["sessions/fixture%2Fsession", { cache: "no-store" }],
      ["history/fixture%2Fsession", { cache: "no-store" }],
    ])
  })
})
