import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { ApiError } from "@services/api"
import { nativeAvailabilityFixture, nativeCancellationFixture, scopeFixture } from "@services/supervisorScope/testFixtures"
import { nativeConfirmationUnavailableCodes, nativeCancellationCodes, unavailableProjectScopeOwnerBridge, type ProjectScopeOwnerBridge, type ProjectScopeOwnerOutcome } from "@services/supervisorScope/ownerBridge"
import type { ProjectOption, ProjectScopeIntent, ProjectScopeResponse } from "@services/supervisorScope/types"
import { useSupervisorProjectScope, type ProjectScopeDependencies } from "./useSupervisorProjectScope"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const roots: Root[] = []
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren() })
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }
async function mount(options: { bridge?: ProjectScopeOwnerBridge; scope?: ProjectScopeResponse; projects?: readonly ProjectOption[] } = {}) {
  let canonical = options.scope ?? scopeFixture()
  const apply = vi.fn<(intent: ProjectScopeIntent) => Promise<ProjectScopeOwnerOutcome>>().mockResolvedValue({ kind: "unknown" })
  const inspect = vi.fn(async () => nativeAvailabilityFixture())
  const read = vi.fn(async () => structuredClone(canonical))
  const deps: ProjectScopeDependencies = { read, projects: vi.fn(async () => options.projects ?? [{ id: "p1", name: "One", status: "active" as const }, { id: "p2", name: "Two", status: "active" as const }]),
    bridge: options.bridge ?? { inspectAvailability: inspect, confirmAndApply: apply } }
  let value!: ReturnType<typeof useSupervisorProjectScope>
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  function Probe({ open }: { open: boolean }) { value = useSupervisorProjectScope(open, deps); return null }
  const render = async (open: boolean) => { await act(async () => root.render(<Probe open={open} />)) }
  await render(true)
  return { get value() { return value }, read, apply, inspect, deps, render,
    setCanonical(value: ProjectScopeResponse) { canonical = value },
    edit(id: string, checked: boolean) { act(() => value.edit(id, checked)) },
    review() { act(() => value.reviewDraft()) },
    async confirm() { await act(async () => value.confirm()) },
    async refresh() { await act(async () => value.refresh()) } }
}
it("keeps the default production bridge blocked despite backend verifier presence", async () => {
  const h = await mount({ bridge: unavailableProjectScopeOwnerBridge })
  expect(h.value.nativeAvailable).toBe(false); expect(h.value.canEdit).toBe(true)
  h.edit("p2", true); h.review(); expect(h.value.review?.mutation.allowed_projects).toEqual(["p1", "p2"])
  await h.confirm(); expect(h.read).toHaveBeenCalledTimes(1); expect(h.apply).not.toHaveBeenCalled()
})
it("does not infer native confirmation readiness from transport or HTTP verifier presence", async () => {
  const h = await mount(); h.inspect.mockResolvedValue({ transport_ready: true, authority_profile: null })
  await h.refresh(); h.review(); await h.confirm()
  expect(h.value.nativeAvailable).toBe(false); expect(h.value.canConfirm).toBe(false)
  expect(h.inspect).toHaveBeenCalledTimes(2); expect(h.apply).not.toHaveBeenCalled()
})
it("submits the immutable exact full-set intent once and waits for canonical confirmation", async () => {
  const h = await mount(), pending = deferred<ProjectScopeOwnerOutcome>()
  h.apply.mockReturnValue(pending.promise); h.edit("p1", false); h.edit("p2", true); h.review()
  let command!: Promise<void>
  act(() => { command = h.value.confirm(); void h.value.confirm() })
  expect(h.apply).toHaveBeenCalledTimes(1)
  const intent = h.apply.mock.calls[0]![0]
  expect(intent).toEqual({ supervisor: scopeFixture().scope.supervisor, expected_state_revision: 0, mutation: { kind: "configure_project_scope", allowed_projects: ["p2"] } })
  expect(Object.isFrozen(intent.mutation.allowed_projects)).toBe(true)
  h.setCanonical({ ...scopeFixture(), scope: { ...scopeFixture().scope, state_revision: 1, allowed_projects: ["p2"] } })
  await act(async () => { pending.resolve({ kind: "applied", receipt: { supervisor: intent.supervisor, state_revision: 1, changed: true, link_revision: null } }); await command })
  expect(h.value.notice?.kind).toBe("saved"); expect(h.read).toHaveBeenCalledTimes(2)
  expect(h.value.review).toBeNull(); expect(h.value.submitting).toBe(false)
})
it("native cancellation before submission does not re-read or discard the user's set", async () => {
  const h = await mount(); h.apply.mockResolvedValue(nativeCancellationFixture()); h.edit("p2", true); h.review(); await h.confirm()
  expect(h.value.notice?.kind).toBe("cancelled"); expect(h.value.draft).toEqual(["p1", "p2"])
  expect(h.read).toHaveBeenCalledTimes(1); expect(h.value.review).toBeNull()
})
it.each([
  [403, "host_owner_authorization_required", "rejected"], [409, "scope_revision_conflict", "conflict"],
  [503, "host_owner_authorization_unavailable", "unavailable"], [503, "scope_authority_invalid", "unavailable"],
] as const)("preserves refusal %i/%s and never replays it", async (status, code, kind) => {
  const h = await mount(); h.edit("p1", false); h.edit("p2", true); h.review()
  h.apply.mockResolvedValue({ kind: "rejected", status, code })
  h.setCanonical({ ...scopeFixture(), scope: { ...scopeFixture().scope, state_revision: 3, allowed_projects: ["p1", "p3"] } })
  await h.confirm(); expect(h.value.notice).toEqual({ kind, code }); expect(h.read).toHaveBeenCalledTimes(2)
  expect(h.value.draft).toEqual(["p2"]); expect(h.value.observation?.scope.allowed_projects).toEqual(["p1", "p3"])
  expect(h.value.review).toBeNull(); expect(h.apply).toHaveBeenCalledTimes(1)
  h.review(); expect(h.value.review?.expected_state_revision).toBe(3); expect(h.apply).toHaveBeenCalledTimes(1)
})
it.each(["unknown", "throw", "bad-receipt"] as const)("does not equate a matching canonical set with this %s submission's success", async (outcome) => {
  const h = await mount(); h.review()
  if (outcome === "throw") h.apply.mockRejectedValue(new Error("bridge disconnected"))
  else h.apply.mockResolvedValue(outcome === "unknown" ? { kind: "unknown" } : { kind: "applied", receipt: {} })
  await h.confirm(); expect(h.value.notice?.kind).toBe("unknown"); expect(h.read).toHaveBeenCalledTimes(2)
  expect(h.value.review).toBeNull(); expect(h.apply).toHaveBeenCalledTimes(1)
})
it("retains unavailable selected IDs until explicitly removed", async () => {
  const h = await mount({ projects: [{ id: "p2", name: "Two", status: "active" }] })
  expect(h.value.draft).toEqual(["p1"]); h.review(); expect(h.value.canConfirm).toBe(false)
  h.edit("p1", false); h.edit("p2", true); h.review(); expect(h.value.review?.mutation.allowed_projects).toEqual(["p2"])
  expect(h.value.canConfirm).toBe(true); expect(h.apply).not.toHaveBeenCalled()
})
it("enforces the 64-Project limit without expanding the set or silently removing IDs", async () => {
  const projects = Array.from({ length: 65 }, (_, i) => ({ id: `p${i}`, name: `${i}`, status: "active" as const }))
  const h = await mount({ projects, scope: { ...scopeFixture(), scope: { ...scopeFixture().scope, allowed_projects: projects.slice(0, 64).map((p) => p.id) } } })
  h.edit("p64", true); expect(h.value.draft).toHaveLength(64); expect(h.value.draft).not.toContain("p64")
  h.edit("p0", false); h.edit("p64", true); h.review(); expect(h.value.review?.mutation.allowed_projects).toHaveLength(64)
  expect(h.value.review?.mutation.allowed_projects).toContain("p64"); expect(h.apply).not.toHaveBeenCalled()
})
it("withdraws a reviewed intent after a denied refresh, without reusing it", async () => {
  const h = await mount(); h.review(); h.read.mockRejectedValue(new ApiError("denied", 403, ""))
  await h.refresh(); expect(h.value.problem?.kind).toBe("forbidden"); expect(h.value.observation).toBeNull()
  expect(h.value.canConfirm).toBe(false); await h.confirm(); expect(h.apply).not.toHaveBeenCalled()
})
it("ignores a late observation across close/reopen", async () => {
  const h = await mount(), pending = deferred<ProjectScopeResponse>()
  h.read.mockReturnValueOnce(pending.promise)
  let read!: Promise<ProjectScopeResponse | null>
  act(() => { read = h.value.refresh() }); await h.render(false)
  h.setCanonical({ ...scopeFixture(), scope: { ...scopeFixture().scope, state_revision: 7 } }); await h.render(true)
  await act(async () => { pending.resolve(scopeFixture()); await read })
  expect(h.value.observation?.scope.state_revision).toBe(7); expect(h.value.review).toBeNull()
})

it.each([[500, "scope_unavailable"], [503, undefined], [409, "host_owner_authorization_required"]] as const)("keeps unexpected native refusal %i/%s unconfirmed", async (status, code) => {
  const h = await mount(); h.review(); h.apply.mockResolvedValue({ kind: "rejected", status, code })
  await h.confirm(); expect(h.value.notice?.kind).toBe("unknown")
  expect(h.read).toHaveBeenCalledTimes(2); expect(h.apply).toHaveBeenCalledTimes(1)
})

it("keeps an unknown submission unconfirmed when its canonical read also fails", async () => {
  const h = await mount(); h.review(); h.apply.mockResolvedValue({ kind: "unknown" })
  h.read.mockRejectedValueOnce(new ApiError("unavailable", 503, ""))
  await h.confirm(); expect(h.value.notice?.kind).toBe("unknown")
  expect(h.value.observation).toBeNull(); expect(h.value.problem?.kind).toBe("unavailable")
  expect(h.value.canConfirm).toBe(false); expect(h.value.review).toBeNull()
  expect(h.read).toHaveBeenCalledTimes(2); expect(h.apply).toHaveBeenCalledTimes(1)
})

it("allows Bamboo per-request confirmation independently of the HTTP verifier", async () => {
  const scope = scopeFixture()
  const h = await mount({ scope: { ...scope, owner_authorization: { ...scope.owner_authorization, available: false } } })
  h.inspect.mockResolvedValue({ transport_ready: true, authority_profile: {
    kind: "bamboo_native_confirmation_v1", confirmation_available: true,
    confirmation_required_per_request: true, unavailable_code: null,
  } })
  await h.refresh(); h.review()
  expect(h.inspect).toHaveBeenCalled(); expect(h.value.nativeAvailable).toBe(true)
  expect(h.value.canConfirm).toBe(true); expect(h.apply).not.toHaveBeenCalled()
})
it("does not treat an unqualified cancellation as proof that CAS was never submitted", async () => {
  const h = await mount(); h.review(); h.apply.mockResolvedValue({ kind: "cancelled" } as ProjectScopeOwnerOutcome)
  await h.confirm(); expect(h.value.notice?.kind).toBe("unknown")
  expect(h.read).toHaveBeenCalledTimes(2); expect(h.apply).toHaveBeenCalledTimes(1)
})

it.each(nativeCancellationCodes)("preserves explicit pre-CAS %s without readback or replay", async (code) => {
  const h = await mount(); h.edit("p2", true); h.review(); h.apply.mockResolvedValue(nativeCancellationFixture(code))
  await h.confirm(); expect(h.value.notice).toEqual({ kind: "cancelled", code })
  expect(h.value.draft).toEqual(["p1", "p2"]); expect(h.value.review).toBeNull()
  expect(h.read).toHaveBeenCalledTimes(1); expect(h.apply).toHaveBeenCalledTimes(1)
})
it.each(nativeConfirmationUnavailableCodes)("blocks request-time refusal %s without another prompt", async (code) => {
  const h = await mount(); h.review(); h.apply.mockResolvedValue({ kind: "rejected", status: 503, code })
  await h.confirm(); expect(h.value.notice).toEqual({ kind: "unavailable", code })
  expect(h.value.nativeAvailable).toBe(false); expect(h.value.nativeUnavailableCode).toBe(code)
  expect(h.read).toHaveBeenCalledTimes(2); expect(h.apply).toHaveBeenCalledTimes(1)
  h.review(); await h.confirm(); expect(h.apply).toHaveBeenCalledTimes(1)
})
it.each([
  { kind: "cancelled", code: "native_confirmation_cancelled", status_code: 409, not_submitted: false },
  { kind: "cancelled", code: "native_confirmation_cancelled", status_code: 503, not_submitted: true },
  { kind: "cancelled", code: "future_cancel", status_code: 409, not_submitted: true },
  { ...nativeCancellationFixture(), receipt: {} },
])("leaves ambiguous cancellation %j unknown even after a matching GET", async (outcome) => {
  const h = await mount(); h.review(); h.apply.mockResolvedValue(outcome as ProjectScopeOwnerOutcome)
  await h.confirm(); expect(h.value.notice?.kind).toBe("unknown")
  expect(h.read).toHaveBeenCalledTimes(2); expect(h.apply).toHaveBeenCalledTimes(1)
})
it("ignores the old in-flight acknowledgement after close/reopen and never replays it", async () => {
  const h = await mount(), pending = deferred<ProjectScopeOwnerOutcome>(); h.review(); h.apply.mockReturnValueOnce(pending.promise)
  let command!: Promise<void>; act(() => { command = h.value.confirm() })
  await h.render(false); h.setCanonical({ ...scopeFixture(), scope: { ...scopeFixture().scope, state_revision: 7 } }); await h.render(true)
  await act(async () => { pending.resolve({ kind: "applied", receipt: { supervisor: scopeFixture().scope.supervisor, state_revision: 1, changed: true, link_revision: null } }); await command })
  expect(h.value.observation?.scope.state_revision).toBe(7); expect(h.value.notice).toBeNull()
  expect(h.value.review).toBeNull(); expect(h.read).toHaveBeenCalledTimes(2); expect(h.apply).toHaveBeenCalledTimes(1)
})
