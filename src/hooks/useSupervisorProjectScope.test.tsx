import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { ApiError } from "@services/api"
import { httpScopeFixture, scopeFixture } from "@services/supervisorScope/testFixtures"
import type { ProjectOption, ProjectScopeIntent, ProjectScopeReceipt, ProjectScopeResponse } from "@services/supervisorScope/types"
import { ownerAuthenticationCodes } from "@services/supervisorScope/types"
import { useSupervisorProjectScope, type ProjectScopeDependencies } from "./useSupervisorProjectScope"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const roots: Root[] = []
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren() })
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }
const error = (status: number, code: string) => new ApiError("private diagnostic", status, "", JSON.stringify({ code }))
async function mount(options: { scope?: ProjectScopeResponse; projects?: readonly ProjectOption[] } = {}) {
  let canonical = options.scope ?? httpScopeFixture()
  const update = vi.fn<(intent: ProjectScopeIntent) => Promise<ProjectScopeReceipt>>().mockRejectedValue(new Error("lost response"))
  const read = vi.fn(async () => structuredClone(canonical))
  const deps: ProjectScopeDependencies = { read, update, projects: vi.fn(async () => options.projects ?? [
    { id: "p1", name: "One", status: "active" as const }, { id: "p2", name: "Two", status: "active" as const }]) }
  let value!: ReturnType<typeof useSupervisorProjectScope>
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  function Probe({ open }: { open: boolean }) { value = useSupervisorProjectScope(open, deps); return null }
  const render = async (open: boolean) => { await act(async () => root.render(<Probe open={open} />)) }
  await render(true)
  return { get value() { return value }, read, update, deps, render,
    setCanonical(scope: ProjectScopeResponse) { canonical = scope },
    edit(id: string, checked: boolean) { act(() => value.edit(id, checked)) },
    review() { act(() => value.reviewDraft()) },
    async confirm() { await act(async () => value.confirm()) },
    async refresh() { await act(async () => value.refresh()) } }
}
it("keeps legacy Host-only scope readable and previewable without a web write", async () => {
  const h = await mount({ scope: scopeFixture() }); h.edit("p2", true); h.review(); await h.confirm()
  expect(h.value.canEdit).toBe(true); expect(h.value.canConfirm).toBe(false)
  expect(h.value.review?.mutation.allowed_projects).toEqual(["p1", "p2"]); expect(h.update).not.toHaveBeenCalled()
})
it.each(ownerAuthenticationCodes)("blocks %s without inferring owner from UI access or native presence", async (code) => {
  const invoke = vi.fn(); vi.stubGlobal("__TAURI_INTERNALS__", { invoke })
  const h = await mount({ scope: httpScopeFixture(code) }); h.review(); await h.confirm()
  expect(h.value.canConfirm).toBe(false); expect(h.update).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled()
})
it("submits one immutable exact full-set intent and confirms receipt plus fresh state", async () => {
  const h = await mount(), pending = deferred<ProjectScopeReceipt>()
  h.update.mockReturnValue(pending.promise); h.edit("p1", false); h.edit("p2", true); h.review()
  let command!: Promise<void>; act(() => { command = h.value.confirm(); void h.value.confirm() })
  expect(h.update).toHaveBeenCalledTimes(1)
  const intent = h.update.mock.calls[0]![0]
  expect(intent).toEqual({ supervisor: httpScopeFixture().scope.supervisor, expected_state_revision: 0,
    mutation: { kind: "configure_project_scope", allowed_projects: ["p2"] } })
  expect(Object.isFrozen(intent.mutation.allowed_projects)).toBe(true)
  h.edit("p1", true); expect(h.value.draft).toEqual(["p2"])
  h.setCanonical({ ...httpScopeFixture(), scope: { ...httpScopeFixture().scope, state_revision: 1, allowed_projects: ["p2"] } })
  await act(async () => { pending.resolve({ supervisor: intent.supervisor, state_revision: 1, changed: true, link_revision: null }); await command })
  expect(h.value.notice?.kind).toBe("saved"); expect(h.read).toHaveBeenCalledTimes(2)
  expect(h.value.review).toBeNull(); expect(h.value.submitting).toBe(false)
})
it.each([
  [401, "owner_authentication_required", "authentication"], [403, "owner_request_origin_invalid", "rejected"],
  [403, "host_owner_authorization_required", "rejected"], [409, "scope_revision_conflict", "conflict"],
  [409, "project_archived", "conflict"], [503, "owner_authentication_unconfigured", "unavailable"],
  [503, "owner_authentication_unavailable", "unavailable"], [503, "scope_authority_invalid", "unavailable"],
] as const)("preserves %i/%s and never replays after rereading", async (status, code, kind) => {
  const h = await mount(); h.edit("p1", false); h.edit("p2", true); h.review(); h.update.mockRejectedValue(error(status, code))
  h.setCanonical({ ...httpScopeFixture(), scope: { ...httpScopeFixture().scope, state_revision: 3, allowed_projects: ["p1", "p3"] } })
  await h.confirm(); expect(h.value.notice).toEqual({ kind, code }); expect(h.read).toHaveBeenCalledTimes(2)
  expect(h.value.draft).toEqual(["p2"]); expect(h.value.observation?.scope.allowed_projects).toEqual(["p1", "p3"])
  expect(h.value.review).toBeNull(); expect(h.update).toHaveBeenCalledTimes(1)
  if (kind !== "conflict") { h.review(); await h.confirm(); expect(h.update).toHaveBeenCalledTimes(1) }
})
it.each(["lost-response", "malformed-receipt", "wrong-incarnation", "wrong-revision"])("never treats matching GET as proof of %s", async (mode) => {
  const h = await mount(); h.review()
  if (mode !== "lost-response") h.update.mockResolvedValue(mode === "malformed-receipt" ? {} as ProjectScopeReceipt : {
    supervisor: mode === "wrong-incarnation" ? { ...httpScopeFixture().scope.supervisor, incarnation_id: "22222222-2222-4222-8222-222222222222" } : httpScopeFixture().scope.supervisor,
    state_revision: mode === "wrong-revision" ? 9 : 0, changed: false, link_revision: null })
  await h.confirm(); expect(h.value.notice?.kind).toBe("unknown"); expect(h.read).toHaveBeenCalledTimes(2)
  expect(h.update).toHaveBeenCalledTimes(1); expect(h.value.review).toBeNull()
})
it("retains unknown after a failed readback without enabling another action", async () => {
  const h = await mount(); h.review(); h.read.mockRejectedValueOnce(error(503, "scope_unavailable")); await h.confirm()
  expect(h.value.notice?.kind).toBe("unknown"); expect(h.value.problem?.kind).toBe("unavailable")
  expect(h.value.observation).toBeNull(); expect(h.value.canConfirm).toBe(false); expect(h.update).toHaveBeenCalledTimes(1)
})
it("refreshes after login without replaying or retaining the prior review", async () => {
  const h = await mount({ scope: httpScopeFixture("owner_authentication_required") }); h.edit("p2", true); h.review()
  h.setCanonical(httpScopeFixture()); await h.refresh()
  expect(h.value.review).toBeNull(); expect(h.value.draft).toEqual(["p1", "p2"]); expect(h.value.canConfirm).toBe(false)
  expect(h.update).not.toHaveBeenCalled(); h.review(); expect(h.value.canConfirm).toBe(true)
})
it("discards a pre-submit local draft on close/reopen without any write", async () => {
  const h = await mount(); h.edit("p2", true); h.review(); await h.render(false); await h.render(true)
  expect(h.value.draft).toEqual(["p1"]); expect(h.value.review).toBeNull(); expect(h.update).not.toHaveBeenCalled()
})
it("ignores a late observation and acknowledgement after close/reopen", async () => {
  const h = await mount(), pending = deferred<ProjectScopeReceipt>(); h.review(); h.update.mockReturnValueOnce(pending.promise)
  let command!: Promise<void>; act(() => { command = h.value.confirm() })
  await h.render(false); h.setCanonical({ ...httpScopeFixture(), scope: { ...httpScopeFixture().scope, state_revision: 7 } }); await h.render(true)
  await act(async () => { pending.resolve({ supervisor: httpScopeFixture().scope.supervisor, state_revision: 1, changed: true, link_revision: null }); await command })
  expect(h.value.observation?.scope.state_revision).toBe(7); expect(h.value.notice).toBeNull(); expect(h.update).toHaveBeenCalledTimes(1)
})
it("blocks unavailable current IDs until explicitly removed", async () => {
  const h = await mount({ projects: [{ id: "p2", name: "Two", status: "active" }] }); h.review()
  expect(h.value.draft).toEqual(["p1"]); expect(h.value.canConfirm).toBe(false)
  h.edit("p1", false); h.edit("p2", true); h.review(); expect(h.value.canConfirm).toBe(true); expect(h.update).not.toHaveBeenCalled()
})
it("enforces the 64-Project limit without silently filtering", async () => {
  const projects = Array.from({ length: 65 }, (_, n) => ({ id: `p${n}`, name: `${n}`, status: "active" as const }))
  const h = await mount({ projects, scope: { ...httpScopeFixture(), scope: { ...httpScopeFixture().scope, allowed_projects: projects.slice(0, 64).map((p) => p.id) } } })
  h.edit("p64", true); expect(h.value.draft).toHaveLength(64); expect(h.value.draft).not.toContain("p64")
  h.edit("p0", false); h.edit("p64", true); h.review(); expect(h.value.review?.mutation.allowed_projects).toContain("p64")
})
it("withdraws review after a forbidden refresh", async () => {
  const h = await mount(); h.review(); h.read.mockRejectedValue(error(403, "owner_request_origin_invalid")); await h.refresh(); await h.confirm()
  expect(h.value.problem?.code).toBe("owner_request_origin_invalid"); expect(h.value.observation).toBeNull(); expect(h.update).not.toHaveBeenCalled()
})
