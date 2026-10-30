import { beforeEach, expect, it, vi } from "vitest"
import { apiClient } from "@services/api"
import { decodeManagedSessions, managedSessionsClient } from "./managedSessions"
import { currentUserManagedSessionsFixture } from "./testFixtures"

vi.mock("@services/api", () => ({ apiClient: { get: vi.fn(), postOnce: vi.fn(), putOnce: vi.fn() }, isApiError: vi.fn(() => false) }))
vi.mock("@services/chat/AgentService", () => ({ agentClient: { listSessions: vi.fn() } }))
const directory = () => {
  const value = currentUserManagedSessionsFixture()
  return { ...value, capabilities: { ...value.capabilities, current_user_bound_history_v1: true } }
}
const select = () => {
  const page = directory()
  return { supervisor: page.scope.supervisor, target: page.sessions[0]!.current_user_target! }
}
const bound = () => {
  const { supervisor, target } = select()
  return { session_id: target.session_id, supervisor, current_user_target: target,
    history_snapshot_source: "durable", messages: [{ id: "m1", role: "assistant", content: "Synthetic answer", created_at: "2026-10-27T00:00:00Z" }] }
}
beforeEach(() => vi.clearAllMocks())
it("retains the producer's supported capability and distinguishes an older producer", () => {
  expect(decodeManagedSessions(directory()).capabilities.current_user_bound_history_v1).toBe(true)
  const older = currentUserManagedSessionsFixture()
  expect(decodeManagedSessions({ ...older, capabilities: { managed_sessions_http_v1: true, supervisor_current_user_scope_v1: true } }).capabilities.current_user_bound_history_v1).toBeUndefined()
})
it("reads the exact target through the bound endpoint and preserves its history", async () => {
  vi.mocked(apiClient.postOnce).mockResolvedValue(bound())
  await expect(managedSessionsClient.readBoundHistory(select())).resolves.toEqual(bound())
  expect(apiClient.postOnce).toHaveBeenCalledExactlyOnceWith("supervisor/default/sessions/root-a/history", select(), { cache: "no-store" })
  expect(apiClient.get).not.toHaveBeenCalled()
})
it.each([
  { current_user_target: { ...select().target, authority_sha256: "f".repeat(64) } },
  { current_user_target: { ...select().target, ancestry_sha256: "f".repeat(64) } },
  { supervisor: { ...select().supervisor, incarnation_id: "22222222-2222-4222-8222-222222222222" } },
  { session_id: "other" }, { messages: null }, { history_snapshot_source: "unknown" },
])("rejects a mismatched or malformed bound response %# without falling back", async (patch) => {
  vi.mocked(apiClient.postOnce).mockResolvedValue({ ...bound(), ...patch })
  await expect(managedSessionsClient.readBoundHistory(select())).rejects.toThrow()
  expect(apiClient.get).not.toHaveBeenCalled()
})
it("retains a refused bound read without falling back to the weaker history endpoint", async () => {
  const failure = new Error("target changed")
  vi.mocked(apiClient.postOnce).mockRejectedValue(failure)
  await expect(managedSessionsClient.readBoundHistory(select())).rejects.toBe(failure)
  expect(apiClient.get).not.toHaveBeenCalled()
})

it("does not treat an older or unsupported producer as an atomic history reader", async () => {
  const page = directory(), selected = select()
  const legacy = { ...page, capabilities: { managed_sessions_http_v1: true as const, supervisor_current_user_scope_v1: true as const } }
  vi.spyOn(managedSessionsClient, "read").mockResolvedValueOnce(legacy).mockResolvedValueOnce({ ...page, capabilities: { ...page.capabilities, current_user_bound_history_v1: false } })
  const { revalidateManagedSelection } = await import("./managedSessions")
  await expect(revalidateManagedSelection(selected, () => true)).resolves.toBe(false)
  await expect(revalidateManagedSelection(selected, () => true)).resolves.toBe(false)
  expect(apiClient.postOnce).not.toHaveBeenCalled()
})
