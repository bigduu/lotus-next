import { beforeEach, expect, it, vi } from "vitest"

const mock = vi.hoisted(() => ({ getOnce: vi.fn(), postOnce: vi.fn() }))
vi.mock("@services/api", () => ({ apiClient: mock }))

import { agentClient } from "./AgentService"

const sessionId = "fixture/session"
const endpoint = "sessions/fixture%2Fsession/loop"
const paused = { session_id: sessionId, loop: { state: "paused", next_fire_at: null, last_run_status: "failed" } }

beforeEach(() => {
  mock.getOnce.mockReset()
  mock.postOnce.mockReset()
})

it("reads status without cache or a normal chat request", async () => {
  mock.getOnce.mockResolvedValue(paused)
  await expect(agentClient.applySessionLoop(sessionId, { action: "status" })).resolves.toBe(paused)
  expect(mock.getOnce).toHaveBeenCalledExactlyOnceWith(endpoint, { cache: "no-store" })
  expect(mock.postOnce).not.toHaveBeenCalled()
})

it("posts the typed command once to the session loop endpoint", async () => {
  const command = { action: "start", interval_seconds: 300, prompt: "Check the build" } as const
  const scheduled = { session_id: sessionId, loop: { state: "scheduled", next_fire_at: "2026-11-20T00:00:00Z", last_run_status: null } }
  mock.postOnce.mockResolvedValue(scheduled)
  await expect(agentClient.applySessionLoop(sessionId, command)).resolves.toBe(scheduled)
  expect(mock.postOnce).toHaveBeenCalledExactlyOnceWith(endpoint, command)
  expect(mock.getOnce).not.toHaveBeenCalled()
})

it("confirms a fixed start only from a scheduled fixed or legacy acknowledgement", async () => {
  const command = { action: "start", interval_seconds: 300, prompt: "Check the build" } as const
  const loop = { state: "scheduled", next_fire_at: "2026-11-20T00:00:00Z", last_run_status: null }
  mock.postOnce
    .mockResolvedValueOnce({ session_id: sessionId, loop: null })
    .mockResolvedValueOnce({ session_id: sessionId, loop: { ...loop, mode: "adaptive" } })
    .mockResolvedValueOnce({ session_id: sessionId, loop: { ...loop, mode: "fixed", state: "stopped" } })
  const receipt = { session_id: sessionId, loop: { ...loop, mode: "fixed" } }
  mock.postOnce.mockResolvedValueOnce(receipt)

  for (let index = 0; index < 3; index++) {
    await expect(agentClient.applySessionLoop(sessionId, command)).rejects.toThrow(/acknowledgement/)
  }
  await expect(agentClient.applySessionLoop(sessionId, command)).resolves.toBe(receipt)
})

it("confirms an automatic loop only from an adaptive start acknowledgement", async () => {
  const command = { action: "start_adaptive", prompt: "Check the build" } as const
  const loop = { state: "scheduled", next_fire_at: "2026-11-20T00:00:00Z", last_run_status: null }
  mock.postOnce
    .mockResolvedValueOnce({ session_id: sessionId, loop })
    .mockResolvedValueOnce({ session_id: sessionId, loop: { ...loop, mode: "fixed" } })
    .mockResolvedValueOnce({ session_id: sessionId, loop: null })
  const receipt = { session_id: sessionId, loop: { ...loop, mode: "adaptive" } }
  mock.postOnce.mockResolvedValueOnce(receipt)

  for (let index = 0; index < 3; index++) {
    await expect(agentClient.applySessionLoop(sessionId, command)).rejects.toThrow(/acknowledgement/)
  }
  await expect(agentClient.applySessionLoop(sessionId, command)).resolves.toBe(receipt)
  expect(mock.postOnce).toHaveBeenLastCalledWith(endpoint, command)
  expect(mock.getOnce).not.toHaveBeenCalled()
})

it.each([
  { ...paused, session_id: "other" },
  { session_id: sessionId },
  { ...paused, loop: { ...paused.loop, state: "running" } },
  { ...paused, loop: { ...paused.loop, mode: "invalid" } },
  { ...paused, loop: { ...paused.loop, next_fire_at: "unconfirmed" } },
  { ...paused, loop: { ...paused.loop, last_run_status: { malformed: true } } },
])("rejects malformed or mismatched session loop responses %#", async (receipt) => {
  mock.getOnce.mockResolvedValue(receipt)
  await expect(agentClient.applySessionLoop(sessionId, { action: "status" })).rejects.toThrow(/acknowledgement/)
})
