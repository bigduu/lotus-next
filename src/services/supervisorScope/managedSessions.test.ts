import { expect, it, vi } from "vitest"
import { apiClient, ApiError } from "@services/api"
import { agentClient } from "@services/chat/AgentService"
import { canWriteManagedSessions, decodeManagedSessionReceipt, decodeManagedSessions, managedSessionsClient, managedSessionsProblem, type ManagedSessionIntent, type ManagedSessionsResponse } from "./managedSessions"
import { currentUserManagedSessionsFixture } from "./testFixtures"
vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(), apiClient: { get: vi.fn(), putOnce: vi.fn(), put: vi.fn(), post: vi.fn() } }))
vi.mock("@services/chat/AgentService", () => ({ agentClient: { listSessions: vi.fn() } }))
const fixture = (): ManagedSessionsResponse => ({ capabilities: { managed_sessions_http_v1: true }, scope: { supervisor: { session_id: "bamboo-default-supervisor", incarnation_id: "11111111-1111-4111-8111-111111111111" }, state_revision: 4, allowed_projects: ["p1"] },
  sessions: [{ session_id: "root-a", link_revision: 3, enabled: true, authorized: true, target_created_at: "2026-10-25T00:00:00Z", target_project_id: "p1", target_metadata_version: 2 }],
  owner_authorization: { available: true, required: true, kind: "existing_access", http_registration: false, code: null } })
const intent: ManagedSessionIntent = { supervisor: fixture().scope.supervisor, expected_state_revision: 4, target_session_id: "root-b", enabled: true }
it("preserves the canonical Root/Child target observations and separates legacy links without granting writes", () => {
  const body = currentUserManagedSessionsFixture("child-a")
  expect(decodeManagedSessions(body)).toEqual(body)
  expect(canWriteManagedSessions(body)).toBe(false)
  expect(decodeManagedSessions(body).sessions.map((entry) => entry.session_id)).toEqual(["root-a", "child-a"])
  expect(decodeManagedSessions(body).sessions[0]?.target_project_id).toBeNull()
  expect(decodeManagedSessions(body).sessions[1]?.current_user_target?.ancestry_sha256).toBe("d".repeat(64))
})
it.each([
  (body: ManagedSessionsResponse) => ({ ...body, management_access: undefined }),
  (body: ManagedSessionsResponse) => ({ ...body, management_access: { kind: "current_user", requires_session_attachment: true } }),
  (body: ManagedSessionsResponse) => ({ ...body, legacy_links: [] }),
  (body: ManagedSessionsResponse) => ({ ...body, next_after: undefined }),
  (body: ManagedSessionsResponse) => ({ ...body, sessions: Array.from({ length: 21 }, () => body.sessions[0]) }),
  ...[
    { current_user_target: undefined }, { link_revision: 1 }, { authorized: false }, { target_metadata_version: 99 },
    { parent_session_id: "unrelated-root" }, { target_created_at: "2026-10-27T09:00:00Z" },
  ].map((patch) => (body: ManagedSessionsResponse) => ({ ...body, sessions: [{ ...body.sessions[0], ...patch }] })),
])("rejects incomplete or mismatched current-user directory observations %#", (damage) => {
  expect(() => decodeManagedSessions(damage(currentUserManagedSessionsFixture()))).toThrow()
})
it("uses the canonical after/query/limit page and never falls back to an attachment mutation", async () => {
  vi.mocked(apiClient.get).mockResolvedValue(currentUserManagedSessionsFixture())
  const signal = new AbortController().signal
  const result = await managedSessionsClient.read(signal, { after: "root-a", query: "task & plan", limit: 20 })
  expect(result).toEqual(currentUserManagedSessionsFixture())
  expect(apiClient.get).toHaveBeenCalledExactlyOnceWith("supervisor/default/sessions?limit=20&after=root-a&query=task+%26+plan", { signal })
  expect(apiClient.putOnce).not.toHaveBeenCalled(); expect(agentClient.listSessions).not.toHaveBeenCalled()
})
it("refuses an oversized page request or repeated cursor without retrying", async () => {
  await expect(managedSessionsClient.read(undefined, { limit: 21 })).rejects.toThrow()
  expect(apiClient.get).not.toHaveBeenCalled()
  vi.mocked(apiClient.get).mockResolvedValue(currentUserManagedSessionsFixture("root-a"))
  await expect(managedSessionsClient.read(undefined, { after: "root-a" })).rejects.toThrow()
  expect(apiClient.get).toHaveBeenCalledTimes(1)
})
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

it("uses only exact canonical session detail as a best-effort title", async () => {
  const links = currentUserManagedSessionsFixture().sessions
  const detail = (i: number) => {
    const target = links[i]!.current_user_target!
    return { session: { id: target.session_id, created_at: target.created_at, kind: target.kind, root_session_id: target.root_session_id,
      parent_session_id: target.parent_session_id, project_id: target.project_id, title: i ? "Child title" : "Root title", model: "display-model", is_running: false } }
  }
  vi.mocked(apiClient.get).mockImplementation(async (path) => path.endsWith("root-a") ? detail(0) : detail(1))
  const signal = new AbortController().signal
  const summaries = await managedSessionsClient.describe(links, signal)
  expect(summaries.map((summary) => [summary.session_id, summary.title])).toEqual([["root-a", "Root title"], ["child-a", "Child title"]])
  expect(summaries[0]?.observedTarget).toEqual(links[0]?.current_user_target)
  expect(apiClient.get).toHaveBeenCalledWith("sessions/root-a", { signal, cache: "no-store" })
  expect(apiClient.putOnce).not.toHaveBeenCalled()
})
it("never uses a mismatched or unavailable detail as the canonical session title", async () => {
  const links = currentUserManagedSessionsFixture().sessions, target = links[0]!.current_user_target!
  vi.mocked(apiClient.get).mockImplementation(async (path) => {
    if (path.endsWith("child-a")) throw new Error("unavailable")
    return { session: { id: target.session_id, created_at: "2020-01-01T00:00:00Z", kind: target.kind, root_session_id: target.root_session_id,
      parent_session_id: target.parent_session_id, project_id: target.project_id, title: "Wrong incarnation", model: "x", is_running: false } }
  })
  expect(await managedSessionsClient.describe(links, new AbortController().signal)).toEqual([])
})

it("bounds optional detail requests to four concurrent reads", async () => {
  const link = currentUserManagedSessionsFixture().sessions[0]!, target = link.current_user_target!
  const links = Array.from({ length: 9 }, (_, i) => {
    const id = `root-${i}`
    return { ...link, session_id: id, root_session_id: id, current_user_target: { ...target, session_id: id, root_session_id: id } }
  })
  let active = 0, peak = 0
  vi.mocked(apiClient.get).mockImplementation(async () => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return {} })
  expect(await managedSessionsClient.describe(links)).toEqual([])
  expect(apiClient.get).toHaveBeenCalledTimes(9); expect(peak).toBeLessThanOrEqual(4)
})
