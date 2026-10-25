import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { ApiError } from "@services/api"
import type { ManagedSessionIntent, ManagedSessionReceipt, ManagedSessionsResponse, SessionCandidatesPage } from "@services/supervisorScope/managedSessions"
import { useSupervisorManagedSessions, type ManagedSessionsDependencies } from "./useSupervisorManagedSessions"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const roots: Root[] = []
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren() })
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }
const fixture = (): ManagedSessionsResponse => ({ capabilities: { managed_sessions_http_v1: true }, scope: { supervisor: { session_id: "bamboo-default-supervisor", incarnation_id: "11111111-1111-4111-8111-111111111111" }, state_revision: 4, allowed_projects: ["p1"] },
  sessions: [{ session_id: "a", link_revision: 3, enabled: true, authorized: true, target_created_at: "2026-10-25T00:00:00Z", target_project_id: "p1", target_metadata_version: 2 }],
  owner_authorization: { available: true, required: true, kind: "existing_access", http_registration: false, code: null } })
async function mount() {
  let canonical = fixture()
  const read = vi.fn(async () => structuredClone(canonical))
  const update = vi.fn<(intent: ManagedSessionIntent) => Promise<ManagedSessionReceipt>>().mockRejectedValue(new Error("lost response"))
  const candidates = vi.fn<() => Promise<SessionCandidatesPage>>().mockResolvedValue({ sessions: [
    { session_id: "a", title: "Session A", project_id: "p1", model: "model-a", is_running: false },
    { session_id: "b", title: "Session B", project_id: "p1", model: "model-b", is_running: false },
    { session_id: "foreign", title: "Private other Project", project_id: "p2", model: "x", is_running: false },
  ], nextOffset: null })
  const dependencies: ManagedSessionsDependencies = { read, update, candidates }
  let value!: ReturnType<typeof useSupervisorManagedSessions>
  function Probe({ active }: { active: boolean }) { value = useSupervisorManagedSessions(active, dependencies); return null }
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  const render = async (active: boolean) => { await act(async () => root.render(<Probe active={active} />)) }
  await render(true)
  return { get value() { return value }, read, update, candidates, render, setCanonical(value: ManagedSessionsResponse) { canonical = value },
    review(id = "b", enabled = true) { act(() => value.reviewTarget(id, enabled)) },
    async confirm() { await act(async () => value.confirm()) }, async refresh() { await act(async () => value.refresh()) } }
}
it("lists only allowed candidates and canonical links without automatically attaching", async () => {
  const h = await mount()
  expect(h.value.rows.map((row) => [row.session_id, row.status])).toEqual([["a", "authorized"], ["b", "available"]])
  expect(h.update).not.toHaveBeenCalled(); expect(h.value.canManage).toBe(true)
  h.review("foreign"); expect(h.value.review).toBeNull()
})
it("freezes one target and exact CAS, blocks double submit, and verifies receipt plus fresh link", async () => {
  const h = await mount(), pending = deferred<ManagedSessionReceipt>()
  h.update.mockReturnValue(pending.promise); h.review()
  let command!: Promise<void>; act(() => { command = h.value.confirm(); void h.value.confirm() })
  expect(h.update).toHaveBeenCalledTimes(1)
  const intent = h.update.mock.calls[0]![0]
  expect(intent).toEqual({ supervisor: fixture().scope.supervisor, expected_state_revision: 4, target_session_id: "b", enabled: true })
  expect(Object.isFrozen(intent)).toBe(true); expect(Object.isFrozen(intent.supervisor)).toBe(true)
  h.setCanonical({ ...fixture(), scope: { ...fixture().scope, state_revision: 5 }, sessions: [...fixture().sessions, { ...fixture().sessions[0]!, session_id: "b", link_revision: 5 }] })
  await act(async () => { pending.resolve({ supervisor: intent.supervisor, state_revision: 5, changed: true, link_revision: 5 }); await command })
  expect(h.value.notice).toBe("saved"); expect(h.read).toHaveBeenCalledTimes(2); expect(h.value.review).toBeNull(); expect(h.value.submitting).toBe(false)
})
it("keeps an uncertain PUT unconfirmed despite matching GET, without auto replay", async () => {
  const h = await mount(); h.review()
  h.setCanonical({ ...fixture(), scope: { ...fixture().scope, state_revision: 5 }, sessions: [...fixture().sessions, { ...fixture().sessions[0]!, session_id: "b", link_revision: 5 }] })
  await h.confirm(); expect(h.value.notice).toBe("unknown"); expect(h.update).toHaveBeenCalledTimes(1)
  await h.refresh(); await h.confirm(); expect(h.value.notice).toBe("unknown"); expect(h.update).toHaveBeenCalledTimes(1)
  h.review("b", false); expect(h.value.review?.expected_state_revision).toBe(5)
})
it("clears stale review after CAS conflict and permits a new explicit review only against fresh scope", async () => {
  const h = await mount(); h.review()
  h.update.mockRejectedValue(new ApiError("changed", 409, "", JSON.stringify({ code: "scope_revision_conflict" })))
  h.setCanonical({ ...fixture(), scope: { ...fixture().scope, state_revision: 8, allowed_projects: ["p2"] } })
  await h.confirm(); expect(h.value.notice).toBe("conflict"); expect(h.value.review).toBeNull()
  h.review(); await h.confirm(); expect(h.update).toHaveBeenCalledTimes(1)
})
it("blocks management after failed canonical readback and retains the unknown outcome", async () => {
  const h = await mount(); h.review(); h.read.mockRejectedValue(new ApiError("unavailable", 503, "", "{}"))
  await h.confirm(); expect(h.value.observation).toBeNull(); expect(h.value.canManage).toBe(false); expect(h.value.notice).toBe("unknown")
  h.review(); await h.confirm(); expect(h.update).toHaveBeenCalledTimes(1)
})
it("ignores a late PUT acknowledgement after close and reopen", async () => {
  const h = await mount(), pending = deferred<ManagedSessionReceipt>(); h.review(); h.update.mockReturnValue(pending.promise)
  let command!: Promise<void>; act(() => { command = h.value.confirm() })
  await h.render(false); h.setCanonical({ ...fixture(), scope: { ...fixture().scope, state_revision: 9 } }); await h.render(true)
  await act(async () => { pending.resolve({ supervisor: fixture().scope.supervisor, state_revision: 5, changed: true, link_revision: 5 }); await command })
  expect(h.value.observation?.scope.state_revision).toBe(9); expect(h.value.notice).toBeNull(); expect(h.update).toHaveBeenCalledTimes(1)
})
it("shows unverifiable targets without an enable action, retaining explicit detach", async () => {
  const h = await mount(); h.setCanonical({ ...fixture(), sessions: [{ ...fixture().sessions[0]!, authorized: false, authorization_error: "target_authority_unavailable" }] }); await h.refresh()
  expect(h.value.rows[0]?.status).toBe("unavailable"); expect(h.value.rows[0]?.canEnable).toBe(false)
  h.review("a", true); expect(h.value.review).toBeNull(); h.review("a", false); expect(h.value.review?.enabled).toBe(false)
})
it("discards candidate pages that finish after a canonical refresh", async () => {
  const h = await mount(), pending = deferred<SessionCandidatesPage>()
  h.candidates.mockResolvedValueOnce({ sessions: [], nextOffset: 100 }); await h.refresh()
  h.candidates.mockReturnValueOnce(pending.promise)
  let page!: Promise<void>; act(() => { page = h.value.loadMore() })
  await h.refresh()
  await act(async () => { pending.resolve({ sessions: [{ session_id: "late", title: "late", project_id: "p1", model: "x", is_running: false }], nextOffset: null }); await page })
  expect(h.value.rows.some((row) => row.session_id === "late")).toBe(false); expect(h.value.loadingMore).toBe(false)
})
