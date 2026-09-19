import { beforeEach, describe, expect, it, vi } from "vitest"
const transport = vi.hoisted(() => ({
  post: vi.fn(),
  stopAgent: vi.fn(),
}))

vi.mock("@services/api", () => ({ apiClient: { post: transport.post } }))
vi.mock("./v2Stream", () => ({ stopAgent: transport.stopAgent }))

import { agentClient } from "./AgentService"

beforeEach(() => {
  transport.post.mockReset().mockResolvedValue(undefined)
  transport.stopAgent.mockReset().mockReturnValue(false)
})

describe("generation Stop transport", () => {
  it("uses realtime control without enqueuing a duplicate REST Stop", async () => {
    transport.stopAgent.mockReturnValue(true)

    await agentClient.stopGeneration("session/a")

    expect(transport.stopAgent).toHaveBeenCalledExactlyOnceWith("session/a")
    expect(transport.post).not.toHaveBeenCalled()
  })

  it("uses REST when the realtime socket is unavailable", async () => {
    await agentClient.stopGeneration("session-1")

    expect(transport.stopAgent).toHaveBeenCalledExactlyOnceWith("session-1")
    expect(transport.post).toHaveBeenCalledExactlyOnceWith("stop/session-1")
  })
})
