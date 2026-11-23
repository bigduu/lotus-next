import { createRoot, createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { ApiError } from "@services/api"
import { currentUserScopeFixture, httpScopeFixture, scopeFixture } from "@services/supervisorScope/testFixtures"
import type { ProjectOption, ProjectScopeIntent, ProjectScopeReceipt, ProjectScopeResponse } from "@services/supervisorScope/types"
import { createSupervisorProjectScope, type ProjectScopeDependencies } from "./createSupervisorProjectScope"

const roots: Array<() => void> = []
afterEach(() => { for (const dispose of roots.splice(0)) dispose() })

async function settle(action: () => unknown) {
  await action()
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve()
    flush()
  }
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }
const error = (status: number, code: string) => new ApiError("private diagnostic", status, "", JSON.stringify({ code }))
async function mount(options: { scope?: ProjectScopeResponse; projects?: readonly ProjectOption[] } = {}) {
  let canonical = options.scope ?? httpScopeFixture()
  const update = vi.fn<(intent: ProjectScopeIntent) => Promise<ProjectScopeReceipt>>().mockRejectedValue(new Error("lost response"))
  const read = vi.fn(async () => structuredClone(canonical))
  const deps: ProjectScopeDependencies = { read, update, projects: vi.fn(async () => options.projects ?? [
    { id: "p1", name: "One", status: "active" as const }, { id: "p2", name: "Two", status: "active" as const }]) }
  const [open, setOpen] = createSignal(true)
  const controller = createRoot((dispose) => {
    roots.push(dispose)
    return createSupervisorProjectScope(open, deps)
  })
  await settle(() => {})
  return { controller, read, update, deps,
    render: (visible: boolean) => settle(() => setOpen(visible)),
    setCanonical(scope: ProjectScopeResponse) { canonical = scope },
    edit(id: string, checked: boolean) { controller.edit(id, checked); flush() },
    review() { controller.reviewDraft(); flush() },
    confirm: () => settle(controller.confirm),
    refresh: () => settle(controller.refresh) }
}
it("keeps legacy Host-only scope readable and previewable without a web write", async () => {
  const h = await mount({ scope: scopeFixture() }); h.edit("p2", true); h.review(); await h.confirm()
  expect(h.controller.canEdit()).toBe(true); expect(h.controller.canConfirm()).toBe(false)
  expect(h.controller.view().review?.mutation.allowed_projects).toEqual(["p1", "p2"]); expect(h.update).not.toHaveBeenCalled()
})
it("keeps current-user management readable without legacy Project authorization editing", async () => {
  const h = await mount({ scope: currentUserScopeFixture(), projects: [] })
  h.edit("p2", true); h.review(); await h.confirm()
  expect(h.controller.view().observation?.code).toBe("current_user_scope_ready")
  expect(h.controller.canEdit()).toBe(false); expect(h.controller.canConfirm()).toBe(false)
  expect(h.controller.view().draft).toEqual([]); expect(h.controller.view().review).toBeNull(); expect(h.update).not.toHaveBeenCalled()
})
it("withdraws a legacy authorization draft when a fresh response reports current-user management", async () => {
  const h = await mount(); h.edit("p2", true); h.review()
  h.setCanonical(currentUserScopeFixture()); await h.refresh(); h.review(); await h.confirm()
  expect(h.controller.canEdit()).toBe(false); expect(h.controller.view().review).toBeNull(); expect(h.update).not.toHaveBeenCalled()
})
it("does not describe a legacy receipt as an access grant after a current-user transition", async () => {
  const h = await mount(); h.review()
  h.update.mockImplementationOnce(async (intent) => {
    h.setCanonical({ ...currentUserScopeFixture(), scope: { ...currentUserScopeFixture().scope,
      state_revision: 1, allowed_projects: [...intent.mutation.allowed_projects] } })
    return { supervisor: intent.supervisor, state_revision: 1, changed: true, link_revision: null }
  })
  await h.confirm()
  expect(h.controller.view().observation?.code).toBe("current_user_scope_ready")
  expect(h.controller.view().notice?.kind).not.toBe("saved"); expect(h.controller.canConfirm()).toBe(false)
  expect(h.update).toHaveBeenCalledTimes(1)
})
it("blocks unavailable access without inferring permission from UI or native presence", async () => {
  const invoke = vi.fn(); vi.stubGlobal("__TAURI_INTERNALS__", { invoke })
  const h = await mount({ scope: httpScopeFixture(false) }); h.review(); await h.confirm()
  expect(h.controller.canConfirm()).toBe(false); expect(h.update).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled()
})
it("submits one immutable exact full-set intent and confirms receipt plus fresh state", async () => {
  const h = await mount(), pending = deferred<ProjectScopeReceipt>()
  h.update.mockReturnValue(pending.promise); h.edit("p1", false); h.edit("p2", true); h.review()
  const command = h.controller.confirm()
  void h.controller.confirm()
  expect(h.update).toHaveBeenCalledTimes(1)
  const intent = h.update.mock.calls[0]![0]
  expect(intent).toEqual({ supervisor: httpScopeFixture().scope.supervisor, expected_state_revision: 0,
    mutation: { kind: "configure_project_scope", allowed_projects: ["p2"] } })
  expect(Object.isFrozen(intent.mutation.allowed_projects)).toBe(true)
  h.edit("p1", true); expect(h.controller.view().draft).toEqual(["p2"])
  h.setCanonical({ ...httpScopeFixture(), scope: { ...httpScopeFixture().scope, state_revision: 1, allowed_projects: ["p2"] } })
  await settle(async () => { pending.resolve({ supervisor: intent.supervisor, state_revision: 1, changed: true, link_revision: null }); await command })
  expect(h.controller.view().notice?.kind).toBe("saved"); expect(h.read).toHaveBeenCalledTimes(2)
  expect(h.controller.view().review).toBeNull(); expect(h.controller.view().submitting).toBe(false)
})
it.each([
  [401, "", "authentication"], [403, "", "rejected"],
  [403, "host_owner_authorization_required", "rejected"], [409, "scope_revision_conflict", "conflict"],
  [409, "project_archived", "conflict"], [503, "project_store_unavailable", "unavailable"],
  [503, "scope_authority_invalid", "unavailable"],
] as const)("preserves %i/%s and never replays after rereading", async (status, code, kind) => {
  const h = await mount(); h.edit("p1", false); h.edit("p2", true); h.review(); h.update.mockRejectedValue(error(status, code))
  h.setCanonical({ ...httpScopeFixture(), scope: { ...httpScopeFixture().scope, state_revision: 3, allowed_projects: ["p1", "p3"] } })
  await h.confirm(); expect(h.controller.view().notice).toEqual({ kind, code: code || undefined }); expect(h.read).toHaveBeenCalledTimes(2)
  expect(h.controller.view().draft).toEqual(["p2"]); expect(h.controller.view().observation?.scope.allowed_projects).toEqual(["p1", "p3"])
  expect(h.controller.view().review).toBeNull(); expect(h.update).toHaveBeenCalledTimes(1)
  if (kind !== "conflict") { h.review(); await h.confirm(); expect(h.update).toHaveBeenCalledTimes(1) }
})
it.each(["lost-response", "malformed-receipt", "wrong-incarnation", "wrong-revision"])("never treats matching GET as proof of %s", async (mode) => {
  const h = await mount(); h.review()
  if (mode !== "lost-response") h.update.mockResolvedValue(mode === "malformed-receipt" ? {} as ProjectScopeReceipt : {
    supervisor: mode === "wrong-incarnation" ? { ...httpScopeFixture().scope.supervisor, incarnation_id: "22222222-2222-4222-8222-222222222222" } : httpScopeFixture().scope.supervisor,
    state_revision: mode === "wrong-revision" ? 9 : 0, changed: false, link_revision: null })
  await h.confirm(); expect(h.controller.view().notice?.kind).toBe("unknown"); expect(h.read).toHaveBeenCalledTimes(2)
  expect(h.update).toHaveBeenCalledTimes(1); expect(h.controller.view().review).toBeNull()
})
it("retains unknown after a failed readback without enabling another action", async () => {
  const h = await mount(); h.review(); h.read.mockRejectedValueOnce(error(503, "scope_unavailable")); await h.confirm()
  expect(h.controller.view().notice?.kind).toBe("unknown"); expect(h.controller.view().problem?.kind).toBe("unavailable")
  expect(h.controller.view().observation).toBeNull(); expect(h.controller.canConfirm()).toBe(false); expect(h.update).toHaveBeenCalledTimes(1)
})
it("rereads existing access without replaying or retaining the prior review", async () => {
  const h = await mount({ scope: httpScopeFixture(false) }); h.edit("p2", true); h.review()
  h.setCanonical(httpScopeFixture()); await h.refresh()
  expect(h.controller.view().review).toBeNull(); expect(h.controller.view().draft).toEqual(["p1", "p2"]); expect(h.controller.canConfirm()).toBe(false)
  expect(h.update).not.toHaveBeenCalled(); h.review(); expect(h.controller.canConfirm()).toBe(true)
})
it("discards a pre-submit local draft on close/reopen without any write", async () => {
  const h = await mount(); h.edit("p2", true); h.review(); await h.render(false); await h.render(true)
  expect(h.controller.view().draft).toEqual(["p1"]); expect(h.controller.view().review).toBeNull(); expect(h.update).not.toHaveBeenCalled()
})
it("ignores a late observation and acknowledgement after close/reopen", async () => {
  const h = await mount(), pending = deferred<ProjectScopeReceipt>(); h.review(); h.update.mockReturnValueOnce(pending.promise)
  const command = h.controller.confirm()
  await h.render(false); h.setCanonical({ ...httpScopeFixture(), scope: { ...httpScopeFixture().scope, state_revision: 7 } }); await h.render(true)
  await settle(async () => { pending.resolve({ supervisor: httpScopeFixture().scope.supervisor, state_revision: 1, changed: true, link_revision: null }); await command })
  expect(h.controller.view().observation?.scope.state_revision).toBe(7); expect(h.controller.view().notice).toBeNull(); expect(h.update).toHaveBeenCalledTimes(1)
})
it("blocks unavailable current IDs until explicitly removed", async () => {
  const h = await mount({ projects: [{ id: "p2", name: "Two", status: "active" }] }); h.review()
  expect(h.controller.view().draft).toEqual(["p1"]); expect(h.controller.canConfirm()).toBe(false)
  h.edit("p1", false); h.edit("p2", true); h.review(); expect(h.controller.canConfirm()).toBe(true); expect(h.update).not.toHaveBeenCalled()
})
it("enforces the 64-Project limit without silently filtering", async () => {
  const projects = Array.from({ length: 65 }, (_, n) => ({ id: `p${n}`, name: `${n}`, status: "active" as const }))
  const h = await mount({ projects, scope: { ...httpScopeFixture(), scope: { ...httpScopeFixture().scope, allowed_projects: projects.slice(0, 64).map((p) => p.id) } } })
  h.edit("p64", true); expect(h.controller.view().draft).toHaveLength(64); expect(h.controller.view().draft).not.toContain("p64")
  h.edit("p0", false); h.edit("p64", true); h.review(); expect(h.controller.view().review?.mutation.allowed_projects).toContain("p64")
})
it("withdraws review after a forbidden refresh", async () => {
  const h = await mount(); h.review(); h.read.mockRejectedValue(error(403, "host_owner_authorization_required")); await h.refresh(); await h.confirm()
  expect(h.controller.view().problem?.code).toBe("host_owner_authorization_required"); expect(h.controller.view().observation).toBeNull(); expect(h.update).not.toHaveBeenCalled()
})

it("keeps post-CAS outcome unconfirmed unknown despite a matching canonical GET", async () => {
  const h = await mount(); h.edit("p1", false); h.edit("p2", true); h.review()
  h.update.mockRejectedValue(error(503, "scope_outcome_unconfirmed"))
  h.setCanonical({ ...httpScopeFixture(), scope: { ...httpScopeFixture().scope, state_revision: 1, allowed_projects: ["p2"] } })
  await h.confirm(); expect(h.controller.view().notice?.kind).toBe("unknown")
  expect(h.update).toHaveBeenCalledTimes(1); expect(h.controller.view().review).toBeNull()
  await h.refresh(); expect(h.controller.view().notice?.kind).toBe("unknown")
  await h.confirm(); expect(h.update).toHaveBeenCalledTimes(1)
})
