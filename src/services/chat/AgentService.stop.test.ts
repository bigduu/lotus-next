import { beforeEach, describe, expect, it, vi } from "vitest"
const transport = vi.hoisted(() => ({
  post: vi.fn(),
  postOnce: vi.fn(),
  stopAgent: vi.fn(),
}))

vi.mock("@services/api", () => ({ apiClient: { post: transport.post, postOnce: transport.postOnce } }))
vi.mock("./v2Stream", () => ({ stopAgent: transport.stopAgent }))

import { agentClient } from "./AgentService"

beforeEach(() => {
  transport.post.mockReset().mockResolvedValue(undefined)
  transport.postOnce.mockReset()
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

describe("background command Stop transport", () => {
  const handle = "e9511561-7f99-4389-a7de-0c9e7a39ffe7"

  it("accepts a cancellation receipt for the exact handle through one request", async () => {
    transport.postOnce.mockResolvedValue({ status: "cancelled", exec_session_id: handle })

    await agentClient.stopBackgroundCommand("session/a", handle)

    expect(transport.postOnce).toHaveBeenCalledExactlyOnceWith(
      "sessions/session%2Fa/background-command-wait/cancel", { exec_session_id: handle },
    )
    expect(transport.stopAgent).not.toHaveBeenCalled()
    expect(transport.post).not.toHaveBeenCalled()
  })

  it.each([
    undefined,
    { status: "cancelled" },
    { status: "cancelled", exec_session_id: "e9511561-7f99-4389-a7de-0c9e7a39ffe8" },
    { status: "stopping", exec_session_id: handle },
  ])("rejects a response without an exact cancellation receipt (%j)", async (response) => {
    transport.postOnce.mockResolvedValue(response)

    await expect(agentClient.stopBackgroundCommand("session-1", handle)).rejects.toThrow("Unconfirmed background command Stop")
    expect(transport.postOnce).toHaveBeenCalledOnce()
    expect(transport.stopAgent).not.toHaveBeenCalled()
    expect(transport.post).not.toHaveBeenCalled()
  })

  it("does not send a request for a handle that fails validation", async () => {
    await expect(agentClient.stopBackgroundCommand("session-1", "unknown")).rejects.toThrow("Invalid background command identity")
    expect(transport.postOnce).not.toHaveBeenCalled()
  })
})
