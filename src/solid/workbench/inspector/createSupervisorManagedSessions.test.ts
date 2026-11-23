import { createRoot, createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { ApiError } from "@services/api"
import type { ManagedSessionIntent, ManagedSessionReceipt, ManagedSessionsResponse, SessionCandidate, SessionCandidatesPage } from "@services/supervisorScope/managedSessions"
import { createSupervisorManagedSessions, type ManagedSessionsDependencies } from "./createSupervisorManagedSessions"
import { currentUserManagedSessionsFixture } from "@services/supervisorScope/testFixtures"
const roots: Array<() => void> = []
afterEach(() => { for (const dispose of roots.splice(0)) dispose() })

async function settle(action: () => unknown) {
  await action()
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve()
    flush()
  }
}
async function mountController(dependencies: ManagedSessionsDependencies) {
  const [active, setActive] = createSignal(true)
  const controller = createRoot((dispose) => {
    roots.push(dispose)
    return createSupervisorManagedSessions(active, dependencies)
  })
  await settle(() => {})
  return { controller, render: (visible: boolean) => settle(() => setActive(visible)) }
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }
const fixture = (): ManagedSessionsResponse => ({ capabilities: { managed_sessions_http_v1: true }, scope: { supervisor: { session_id: "bamboo-default-supervisor", incarnation_id: "11111111-1111-4111-8111-111111111111" }, state_revision: 4, allowed_projects: ["p1"] },
  sessions: [{ session_id: "a", link_revision: 3, enabled: true, authorized: true, target_created_at: "2026-10-25T00:00:00Z", target_project_id: "p1", target_metadata_version: 2 }],
  owner_authorization: { available: true, required: true, kind: "existing_access", http_registration: false, code: null } })
async function mount(initial = fixture()) {
  let canonical = initial
  const read = vi.fn(async () => structuredClone(canonical))
  const update = vi.fn<(intent: ManagedSessionIntent) => Promise<ManagedSessionReceipt>>().mockRejectedValue(new Error("lost response"))
  const candidates = vi.fn<() => Promise<SessionCandidatesPage>>().mockResolvedValue({ sessions: [
    { session_id: "a", title: "Session A", project_id: "p1", model: "model-a", is_running: false },
    { session_id: "b", title: "Session B", project_id: "p1", model: "model-b", is_running: false },
    { session_id: "foreign", title: "Private other Project", project_id: "p2", model: "x", is_running: false },
  ], nextOffset: null })
  const dependencies: ManagedSessionsDependencies = { read, update, candidates }
  const { controller, render } = await mountController(dependencies)
  return { controller, read, update, candidates, render,
    setCanonical(value: ManagedSessionsResponse) { canonical = value },
    review(id = "b", enabled = true) { controller.reviewTarget(id, enabled); flush() },
    confirm: () => settle(controller.confirm),
    refresh: () => settle(controller.refresh) }
}
it("lists canonical Root/Child sessions outside legacy Projects without a candidate or attach gate", async () => {
  const h = await mount(currentUserManagedSessionsFixture())
  expect(h.controller.rows().map((row) => [row.session_id, row.status])).toEqual([["root-a", "current_user"], ["child-a", "current_user"]])
  expect(h.controller.canManage()).toBe(false); expect(h.controller.rows().every((row) => !row.canEnable)).toBe(true)
  expect(h.candidates).not.toHaveBeenCalled()
  h.review("root-a", true); h.review("child-a", false); await h.confirm()
  expect(h.controller.view().review).toBeNull(); expect(h.update).not.toHaveBeenCalled()
})
it("loads another canonical page and discards a page completing after refresh", async () => {
  const h = await mount(currentUserManagedSessionsFixture("child-a")), pending = deferred<ManagedSessionsResponse>()
  h.read.mockReturnValueOnce(pending.promise)
  const page = h.controller.loadMore()
  expect(h.read).toHaveBeenLastCalledWith(expect.any(AbortSignal), { after: "child-a", limit: 20 })
  h.setCanonical({ ...currentUserManagedSessionsFixture(), sessions: [] }); await h.refresh()
  await settle(async () => { pending.resolve(currentUserManagedSessionsFixture()); await page })
  expect(h.controller.rows()).toEqual([]); expect(h.controller.view().nextAfter).toBeNull(); expect(h.controller.view().loadingMore).toBe(false)
})
it("appends a canonical page once without fetching candidates or creating links", async () => {
  const h = await mount(currentUserManagedSessionsFixture("child-a")), next = currentUserManagedSessionsFixture()
  const entry = next.sessions[0]!
  h.read.mockResolvedValueOnce({ ...next, sessions: [{ ...entry, session_id: "root-b", root_session_id: "root-b",
    current_user_target: { ...entry.current_user_target!, session_id: "root-b", root_session_id: "root-b" } }] })
  await settle(async () => { await Promise.all([h.controller.loadMore(), h.controller.loadMore()]) })
  expect(h.read).toHaveBeenCalledTimes(2)
  expect(h.controller.rows().map((row) => row.session_id)).toEqual(["root-a", "child-a", "root-b"])
  expect(h.controller.view().nextAfter).toBeNull(); expect(h.candidates).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled()
})
it("withdraws canonical rows after application access is refused on a page read", async () => {
  const h = await mount(currentUserManagedSessionsFixture("child-a"))
  h.read.mockRejectedValueOnce(new ApiError("denied", 403, "", "{}"))
  await settle(async () => h.controller.loadMore())
  expect(h.controller.view().problem?.kind).toBe("forbidden"); expect(h.controller.view().observation).toBeNull()
  expect(h.controller.rows()).toEqual([]); expect(h.controller.view().nextAfter).toBeNull(); expect(h.update).not.toHaveBeenCalled()
})
it("rejects a new page from a different canonical Supervisor incarnation", async () => {
  const h = await mount(currentUserManagedSessionsFixture("child-a")), next = currentUserManagedSessionsFixture()
  h.read.mockResolvedValueOnce({ ...next, scope: { ...next.scope, supervisor: { ...next.scope.supervisor, incarnation_id: "22222222-2222-4222-8222-222222222222" } } })
  await settle(async () => h.controller.loadMore())
  expect(h.controller.view().problem?.kind).toBe("conflict"); expect(h.controller.rows()).toEqual([]); expect(h.controller.view().nextAfter).toBeNull()
  expect(h.candidates).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled()
})
it("lists only allowed candidates and canonical links without automatically attaching", async () => {
  const h = await mount()
  expect(h.controller.rows().map((row) => [row.session_id, row.status])).toEqual([["a", "authorized"], ["b", "available"]])
  expect(h.update).not.toHaveBeenCalled(); expect(h.controller.canManage()).toBe(true)
  h.review("foreign"); expect(h.controller.view().review).toBeNull()
})
it("freezes one target and exact CAS, blocks double submit, and verifies receipt plus fresh link", async () => {
  const h = await mount(), pending = deferred<ManagedSessionReceipt>()
  h.update.mockReturnValue(pending.promise); h.review()
  const command = h.controller.confirm()
  void h.controller.confirm()
  expect(h.update).toHaveBeenCalledTimes(1)
  const intent = h.update.mock.calls[0]![0]
  expect(intent).toEqual({ supervisor: fixture().scope.supervisor, expected_state_revision: 4, target_session_id: "b", enabled: true })
  expect(Object.isFrozen(intent)).toBe(true); expect(Object.isFrozen(intent.supervisor)).toBe(true)
  h.setCanonical({ ...fixture(), scope: { ...fixture().scope, state_revision: 5 }, sessions: [...fixture().sessions, { ...fixture().sessions[0]!, session_id: "b", link_revision: 5 }] })
  await settle(async () => { pending.resolve({ supervisor: intent.supervisor, state_revision: 5, changed: true, link_revision: 5 }); await command })
  expect(h.controller.view().notice).toBe("saved"); expect(h.read).toHaveBeenCalledTimes(2); expect(h.controller.view().review).toBeNull(); expect(h.controller.view().submitting).toBe(false)
})
it("keeps an uncertain PUT unconfirmed despite matching GET, without auto replay", async () => {
  const h = await mount(); h.review()
  h.setCanonical({ ...fixture(), scope: { ...fixture().scope, state_revision: 5 }, sessions: [...fixture().sessions, { ...fixture().sessions[0]!, session_id: "b", link_revision: 5 }] })
  await h.confirm(); expect(h.controller.view().notice).toBe("unknown"); expect(h.update).toHaveBeenCalledTimes(1)
  await h.refresh(); await h.confirm(); expect(h.controller.view().notice).toBe("unknown"); expect(h.update).toHaveBeenCalledTimes(1)
  h.review("b", false); expect(h.controller.view().review?.expected_state_revision).toBe(5)
})
it("clears stale review after CAS conflict and permits a new explicit review only against fresh scope", async () => {
  const h = await mount(); h.review()
  h.update.mockRejectedValue(new ApiError("changed", 409, "", JSON.stringify({ code: "scope_revision_conflict" })))
  h.setCanonical({ ...fixture(), scope: { ...fixture().scope, state_revision: 8, allowed_projects: ["p2"] } })
  await h.confirm(); expect(h.controller.view().notice).toBe("conflict"); expect(h.controller.view().review).toBeNull()
  h.review(); await h.confirm(); expect(h.update).toHaveBeenCalledTimes(1)
})
it("blocks management after failed canonical readback and retains the unknown outcome", async () => {
  const h = await mount(); h.review(); h.read.mockRejectedValue(new ApiError("unavailable", 503, "", "{}"))
  await h.confirm(); expect(h.controller.view().observation).toBeNull(); expect(h.controller.canManage()).toBe(false); expect(h.controller.view().notice).toBe("unknown")
  h.review(); await h.confirm(); expect(h.update).toHaveBeenCalledTimes(1)
})
it("ignores a late PUT acknowledgement after close and reopen", async () => {
  const h = await mount(), pending = deferred<ManagedSessionReceipt>(); h.review(); h.update.mockReturnValue(pending.promise)
  const command = h.controller.confirm()
  await h.render(false); h.setCanonical({ ...fixture(), scope: { ...fixture().scope, state_revision: 9 } }); await h.render(true)
  await settle(async () => { pending.resolve({ supervisor: fixture().scope.supervisor, state_revision: 5, changed: true, link_revision: 5 }); await command })
  expect(h.controller.view().observation?.scope.state_revision).toBe(9); expect(h.controller.view().notice).toBeNull(); expect(h.update).toHaveBeenCalledTimes(1)
})
it("shows unverifiable targets without an enable action, retaining explicit detach", async () => {
  const h = await mount(); h.setCanonical({ ...fixture(), sessions: [{ ...fixture().sessions[0]!, authorized: false, authorization_error: "target_authority_unavailable" }] }); await h.refresh()
  expect(h.controller.rows()[0]?.status).toBe("unavailable"); expect(h.controller.rows()[0]?.canEnable).toBe(false)
  h.review("a", true); expect(h.controller.view().review).toBeNull(); h.review("a", false); expect(h.controller.view().review?.enabled).toBe(false)
})
it("discards candidate pages that finish after a canonical refresh", async () => {
  const h = await mount(), pending = deferred<SessionCandidatesPage>()
  h.candidates.mockResolvedValueOnce({ sessions: [], nextOffset: 100 }); await h.refresh()
  h.candidates.mockReturnValueOnce(pending.promise)
  const page = h.controller.loadMore()
  await h.refresh()
  await settle(async () => { pending.resolve({ sessions: [{ session_id: "late", title: "late", project_id: "p1", model: "x", is_running: false }], nextOffset: null }); await page })
  expect(h.controller.rows().some((row) => row.session_id === "late")).toBe(false); expect(h.controller.view().loadingMore).toBe(false)
})

it("hydrates current-user titles without gating canonical rows and ignores late old-target titles", async () => {
  const first = currentUserManagedSessionsFixture(), old = deferred<readonly SessionCandidate[]>()
  const target = first.sessions[0]!.current_user_target!
  const nextTarget = { ...target, created_at: "2026-10-29T00:00:00Z", authority_sha256: "e".repeat(64) }
  const second = { ...first, sessions: [{ ...first.sessions[0]!, target_created_at: nextTarget.created_at, current_user_target: nextTarget }] }
  let canonical = first
  const read = vi.fn(async () => canonical)
  const describe = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce([{ session_id: "root-a", title: "New title", project_id: null, model: "x", is_running: false, observedTarget: nextTarget }])
  const dependencies: ManagedSessionsDependencies = { read, describe, candidates: vi.fn(), update: vi.fn() }
  const { controller } = await mountController(dependencies)
  expect(controller.rows()[0]?.session_id).toBe("root-a"); expect(controller.rows()[0]?.summary).toBeUndefined()
  canonical = second; await settle(async () => { await controller.refresh() })
  expect(controller.rows()[0]?.summary?.title).toBe("New title")
  await settle(async () => { old.resolve([{ session_id: "root-a", title: "Old title", project_id: null, model: "x", is_running: false, observedTarget: target }]); await old.promise })
  expect(controller.rows()[0]?.summary?.title).toBe("New title"); expect(dependencies.update).not.toHaveBeenCalled()
})

it("hides cached current-user labels if a later directory page lacks owner access", async () => {
  const first = currentUserManagedSessionsFixture("child-a"), target = first.sessions[0]!.current_user_target!
  const read = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce({ ...first, sessions: [], next_after: null,
    owner_authorization: { ...first.owner_authorization, available: false } })
  const describe = vi.fn(async () => [{ session_id: target.session_id, title: "Title", project_id: target.project_id, model: "x", is_running: false, observedTarget: target }])
  const dependencies: ManagedSessionsDependencies = { read, describe, candidates: vi.fn(), update: vi.fn() }
  const { controller } = await mountController(dependencies)
  expect(controller.rows()[0]?.summary?.title).toBe("Title")
  await settle(async () => controller.loadMore())
  expect(controller.view().observation?.owner_authorization.available).toBe(false)
  expect(controller.rows()[0]?.summary).toBeUndefined(); expect(describe).toHaveBeenCalledTimes(1)
})

it("hydrates titles from each canonical page without turning summaries into grants", async () => {
  const first = currentUserManagedSessionsFixture("child-a"), target = first.sessions[0]!.current_user_target!
  const nextTarget = { ...target, session_id: "root-b", root_session_id: "root-b" }
  const next = { ...first, next_after: null, sessions: [{ ...first.sessions[0]!, session_id: "root-b", root_session_id: "root-b", current_user_target: nextTarget }] }
  const read = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next)
  const describe = vi.fn(async (links: ManagedSessionsResponse["sessions"]) => links.map((link) => ({
    session_id: link.session_id, title: `Title ${link.session_id}`, project_id: link.target_project_id, model: "x", is_running: false, observedTarget: link.current_user_target! })))
  const dependencies: ManagedSessionsDependencies = { read, describe, candidates: vi.fn(), update: vi.fn() }
  const { controller } = await mountController(dependencies)
  await settle(async () => controller.loadMore())
  expect(controller.rows().map((row) => row.summary?.title)).toEqual(["Title root-a", "Title child-a", "Title root-b"])
  expect(controller.rows().every((row) => !row.canEnable)).toBe(true); expect(dependencies.update).not.toHaveBeenCalled()
})
