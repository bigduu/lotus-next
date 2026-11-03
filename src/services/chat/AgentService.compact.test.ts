import { beforeEach, expect, it, vi } from "vitest"
const mock = vi.hoisted(() => ({ postOnce: vi.fn() }))
vi.mock("@services/api", () => ({ apiClient: mock }))
import { agentClient } from "./AgentService"

const sessionId = "fixture/session"
const unchanged = { session_id: sessionId, status: "unchanged" }
const compacted = {
  ...unchanged,
  status: "compacted",
  usage_before_percent: 71.2,
  usage_after_percent: 24,
  token_usage: {
    total_tokens: 24000, system_tokens: 1000, summary_tokens: 2000, window_tokens: 21000,
    budget_limit: 96000, max_context_tokens: 100000, truncation_occurred: false, segments_removed: 0,
  },
}
beforeEach(() => mock.postOnce.mockReset())

it.each([unchanged, compacted])("posts once to the encoded maintenance endpoint", async (receipt) => {
  mock.postOnce.mockResolvedValue(receipt)
  await expect(agentClient.compactSessionContext(sessionId)).resolves.toBe(receipt)
  expect(mock.postOnce).toHaveBeenCalledExactlyOnceWith(
    "sessions/fixture%2Fsession/compact", undefined, { logicalTimeoutMs: 310_000 },
  )
})

it.each([
  undefined, {}, { ...unchanged, session_id: "other" }, { ...unchanged, status: "started" },
  { ...compacted, usage_after_percent: undefined }, { ...compacted, token_usage: null },
  { ...compacted, token_usage: { ...compacted.token_usage, total_tokens: -1 } },
])("rejects malformed compaction acknowledgement %#", async (receipt) => {
  mock.postOnce.mockResolvedValue(receipt)
  await expect(agentClient.compactSessionContext(sessionId)).rejects.toThrow("Invalid context compaction receipt")
  expect(mock.postOnce).toHaveBeenCalledOnce()
})
