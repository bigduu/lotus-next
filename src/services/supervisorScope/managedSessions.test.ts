import { expect, it, vi } from "vitest"
import { apiClient, ApiError } from "@services/api"
import { agentClient } from "@services/chat/AgentService"
import { canWriteManagedSessions, decodeManagedSessionReceipt, decodeManagedSessions, managedSessionsClient, managedSessionsProblem, type ManagedSessionIntent, type ManagedSessionsResponse } from "./managedSessions"
vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(), apiClient: { get: vi.fn(), putOnce: vi.fn(), put: vi.fn(), post: vi.fn() } }))
vi.mock("@services/chat/AgentService", () => ({ agentClient: { listSessions: vi.fn() } }))
const fixture = (): ManagedSessionsResponse => ({ capabilities: { managed_sessions_http_v1: true }, scope: { supervisor: { session_id: "bamboo-default-supervisor", incarnation_id: "11111111-1111-4111-8111-111111111111" }, state_revision: 4, allowed_projects: ["p1"] },
  sessions: [{ session_id: "root-a", link_revision: 3, enabled: true, authorized: true, target_created_at: "2026-10-25T00:00:00Z", target_project_id: "p1", target_metadata_version: 2 }],
  owner_authorization: { available: true, required: true, kind: "existing_access", http_registration: false, code: null } })
const intent: ManagedSessionIntent = { supervisor: fixture().scope.supervisor, expected_state_revision: 4, target_session_id: "root-b", enabled: true }
it("reads only canonical metadata and preserves unavailable target proof without a grant", async () => {
  const base = fixture(), body: ManagedSessionsResponse = { ...base, sessions: [{ ...base.sessions[0]!, authorized: false, authorization_error: "target_authority_unavailable" }] }
  vi.mocked(apiClient.get).mockResolvedValue({ ...body, private_history: "not part of the view" })
  const signal = new AbortController().signal
  expect(await managedSessionsClient.read(signal)).toEqual(body)
  expect(apiClient.get).toHaveBeenCalledExactlyOnceWith("supervisor/default/sessions", { signal })
  expect(apiClient.putOnce).not.toHaveBeenCalled(); expect(canWriteManagedSessions(body)).toBe(true)
  expect(canWriteManagedSessions({ ...body, owner_authorization: { ...body.owner_authorization, available: false } })).toBe(false)
})
it.each([
  (body: ManagedSessionsResponse) => ({ ...body, sessions: [...body.sessions, ...body.sessions] }),
  (body: ManagedSessionsResponse) => ({ ...body, scope: { ...body.scope, state_revision: Number.MAX_SAFE_INTEGER + 1 } }),
  (body: ManagedSessionsResponse) => ({ ...body, capabilities: { managed_sessions_http_v1: false } }),
  (body: ManagedSessionsResponse) => ({ ...body, sessions: [{ ...body.sessions[0], session_id: "../foreign" }] }),
  (body: ManagedSessionsResponse) => ({ ...body, sessions: [{ ...body.sessions[0], target_project_id: "foreign" }] }),
  (body: ManagedSessionsResponse) => ({ ...body, sessions: [{ ...body.sessions[0], authorization_error: "target_authority_unavailable" }] }),
  (body: ManagedSessionsResponse) => ({ ...body, sessions: [{ ...body.sessions[0], authorized: false, authorization_error: "future" }] }),
  (body: ManagedSessionsResponse) => ({ ...body, owner_authorization: { ...body.owner_authorization, kind: "ui_approved" } }),
])("rejects malformed or contradictory management response %#", (damage) => expect(() => decodeManagedSessions(damage(fixture()))).toThrow())
it("uses one exact CAS PUT and verifies the receipt instead of inferring success", async () => {
  const receipt = { supervisor: intent.supervisor, state_revision: 5, changed: true, link_revision: 5 }
  vi.mocked(apiClient.putOnce).mockResolvedValue({ receipt })
  expect(await managedSessionsClient.update(intent)).toEqual(receipt)
  expect(apiClient.putOnce).toHaveBeenCalledExactlyOnceWith("supervisor/default/sessions/root-b", { incarnation_id: intent.supervisor.incarnation_id, expected_state_revision: 4, enabled: true })
  expect(apiClient.put).not.toHaveBeenCalled(); expect(apiClient.post).not.toHaveBeenCalled()
  expect(() => decodeManagedSessionReceipt({ ...receipt, state_revision: 4 }, intent)).toThrow()
  expect(() => decodeManagedSessionReceipt({ ...receipt, supervisor: { ...intent.supervisor, incarnation_id: "22222222-2222-4222-8222-222222222222" } }, intent)).toThrow()
})
it("preserves unconfirmed failure and old-backend unsupported without another request", async () => {
  const error = new ApiError("unconfirmed", 503, "", JSON.stringify({ code: "managed_sessions_outcome_unconfirmed" }))
  vi.mocked(apiClient.putOnce).mockRejectedValue(error)
  await expect(managedSessionsClient.update(intent)).rejects.toBe(error)
  expect(apiClient.putOnce).toHaveBeenCalledTimes(1)
  expect(managedSessionsProblem(new ApiError("old", 404, ""))).toEqual({ kind: "unsupported", code: undefined })
})
it("pages owner Root summaries without treating index metadata as a management grant", async () => {
  vi.mocked(agentClient.listSessions).mockResolvedValue({ sessions: [
    { id: "root-a", kind: "root", title: "A", model: "target-model", is_running: true, project_id: "p1", last_run_status: "running", messages: "private" },
    { id: "bamboo-default-supervisor", kind: "root", title: "Supervisor" }, { id: "child", kind: "child" },
  ], total: 120, offset: 0, limit: 100, next_offset: 100 } as never)
  expect(await managedSessionsClient.candidates()).toEqual({ sessions: [{ session_id: "root-a", title: "A", project_id: "p1", model: "target-model", is_running: true, last_run_status: "running" }], nextOffset: 100 })
  expect(agentClient.listSessions).toHaveBeenCalledExactlyOnceWith({ kind: "root", limit: 100, offset: 0 })
})
