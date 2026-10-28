import { beforeEach, expect, it, vi } from "vitest"
const api = vi.hoisted(() => ({post:vi.fn(),stopAgent:vi.fn()}))
vi.mock("@services/api", () => ({apiClient:{post:api.post}}))
vi.mock("./v2Stream", () => ({stopAgent:api.stopAgent}))
import { agentClient } from "./AgentService"
beforeEach(() => {api.post.mockReset().mockResolvedValue({});api.stopAgent.mockReset().mockReturnValue(true)})
it("adds continuous mode only to the explicitly selected Execute", async () => {
  await agentClient.execute("session-1",undefined,undefined,undefined,undefined,{mode:"until_cancelled"})
  await agentClient.execute("session-1")
  await agentClient.execute("child-session")
  expect(api.post.mock.calls).toEqual([
    ["execute/session-1",{upstream_retry:{mode:"until_cancelled"}}],
    ["execute/session-1",{}],["execute/child-session",{}],
  ])
})
it("opts a single initial execution into the negotiated live bootstrap offer", async () => {
  await agentClient.execute("session-1", undefined, undefined, undefined, undefined, undefined, true)
  await agentClient.execute("session-1")
  expect(api.post.mock.calls).toEqual([
    ["execute/session-1", { live_bootstrap_resume: true }], ["execute/session-1", {}],
  ])
})
it("uses only the exact-run Stop header even with a live socket", async () => {
  await agentClient.stopGeneration("session/a","run-original")
  expect(api.stopAgent).not.toHaveBeenCalled()
  expect(api.post).toHaveBeenCalledExactlyOnceWith("stop/session%2Fa",undefined,{headers:{"Bamboo-Run-Id":"run-original"}})
})
it.each(["","bad\nrun","a".repeat(129)])("never falls back to a broad Stop on invalid run %j", async (id) => {
  await expect(agentClient.stopGeneration("session-1",id)).rejects.toThrow()
  expect(api.post).not.toHaveBeenCalled();expect(api.stopAgent).not.toHaveBeenCalled()
})
it("does not retry a rejected exact Stop through another transport", async () => {
  api.post.mockRejectedValue(new Error("stale run"))
  await expect(agentClient.stopGeneration("session-1","old-run")).rejects.toThrow("stale run")
  expect(api.post).toHaveBeenCalledTimes(1);expect(api.stopAgent).not.toHaveBeenCalled()
})
