import { describe, expect, it, vi } from "vitest"
import { apiClient, ApiError } from "@services/api"
import { projectService } from "@services/project"
import { canWriteProjectScope, decodeProjectScope, decodeProjectScopeReceipt, scopeProblem, supervisorScopeClient } from "./client"
import { unavailableProjectScopeOwnerBridge } from "./ownerBridge"
import type { ProjectScopeIntent } from "./types"
vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(),
  apiClient: { get: vi.fn(), put: vi.fn(), putOnce: vi.fn(), post: vi.fn() } }))
vi.mock("@services/project", () => ({ projectService: { listProjects: vi.fn() } }))

import { httpScopeFixture, scopeFixture } from "./testFixtures"
const intent: ProjectScopeIntent = { supervisor: scopeFixture().scope.supervisor, expected_state_revision: 2,
  mutation: { kind: "configure_project_scope", allowed_projects: ["p2"] } }

describe("Supervisor Project scope read contract", () => {
  it("uses only the canonical GET and never writes or invokes native while reading", async () => {
    vi.mocked(apiClient.get).mockResolvedValue(scopeFixture())
    const signal = new AbortController().signal
    expect(await supervisorScopeClient.read(signal)).toEqual(scopeFixture())
    expect(apiClient.get).toHaveBeenCalledExactlyOnceWith("supervisor/default/scope", { signal })
    expect(Object.keys(supervisorScopeClient)).toEqual(["read", "projects", "update"])
    expect(apiClient.put).not.toHaveBeenCalled(); expect(apiClient.putOnce).not.toHaveBeenCalled()
    const invoke = vi.fn(); vi.stubGlobal("__TAURI_INTERNALS__", { invoke })
    expect(await unavailableProjectScopeOwnerBridge.inspectAvailability(scopeFixture())).toEqual({ transport_ready: false, authority_profile: null })
    expect(await unavailableProjectScopeOwnerBridge.confirmAndApply(intent)).toEqual({ kind: "unavailable" })
    expect(invoke).not.toHaveBeenCalled()
  })
  it("preserves an explicitly empty set at a later revision without claiming never configured", () => {
    expect(decodeProjectScope({ ...scopeFixture(), code: "project_scope_uninitialized", scope: { ...scopeFixture().scope, state_revision: 9, allowed_projects: [] } }).scope)
      .toMatchObject({ state_revision: 9, allowed_projects: [] })
    expect(decodeProjectScope({ ...scopeFixture(), capabilities: { project_scope_v1: true, supervised_root_create_v1: false } }).capabilities.supervised_root_create_v1).toBe(false)
  })
  it.each([
    null, {}, { ...scopeFixture(), code: "future" },
    ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1].map((state_revision) => ({ ...scopeFixture(), scope: { ...scopeFixture().scope, state_revision } })),
    ...[["p1", "p1"], ["bad/path"], ["项目"], Array.from({ length: 65 }, (_, n) => `p${n}`)].map((allowed_projects) => ({ ...scopeFixture(), scope: { ...scopeFixture().scope, allowed_projects } })),
    { ...scopeFixture(), scope: { ...scopeFixture().scope, supervisor: { ...scopeFixture().scope.supervisor, session_id: "ordinary" } } },
    { ...scopeFixture(), scope: { ...scopeFixture().scope, supervisor: { ...scopeFixture().scope.supervisor, incarnation_id: "unknown" } } },
    { ...scopeFixture(), owner_authorization: { available: true } },
    { ...scopeFixture(), owner_authorization: { ...scopeFixture().owner_authorization, http_registration: true } },
    { ...scopeFixture(), capabilities: { project_scope_v1: false } },
    { ...scopeFixture(), code: "project_scope_uninitialized" },
  ])("blocks malformed, imprecise or contradictory observation %#", (value) => {
    expect(() => decodeProjectScope(value)).toThrow()
  })
  it.each([[401, undefined, "authentication"], [403, "host_owner_authorization_required", "forbidden"],
    [404, "supervisor_missing", "missing"], [404, undefined, "unsupported"], [409, "scope_revision_conflict", "conflict"],
    [503, "host_owner_authorization_unavailable", "unavailable"], [503, "scope_authority_invalid", "unavailable"]] as const)("keeps HTTP %i/code %s visible as %s", (status, code, kind) => {
    expect(scopeProblem(new ApiError("private diagnostic", status, "", JSON.stringify({ error: { message: "private diagnostic" }, code })))).toEqual({ kind, code })
  })
  it("reads Project metadata without granting or silently rewriting IDs", async () => {
    vi.mocked(projectService.listProjects).mockResolvedValue({ projects: [{ id: "p1", name: "A", status: "active" }] } as Awaited<ReturnType<typeof projectService.listProjects>>)
    expect(await supervisorScopeClient.projects()).toEqual([{ id: "p1", name: "A", status: "active" }])
  })
  it.each([true, false])("verifies a changed=%s receipt independently of HTTP success", (changed) => {
    const receipt = { supervisor: intent.supervisor, state_revision: changed ? 3 : 2, changed, link_revision: null }
    expect(decodeProjectScopeReceipt(receipt, intent)).toEqual(receipt)
    expect(() => decodeProjectScopeReceipt({ ...receipt, supervisor: { ...receipt.supervisor, incarnation_id: "22222222-2222-4222-8222-222222222222" } }, intent)).toThrow()
    expect(() => decodeProjectScopeReceipt({ ...receipt, state_revision: changed ? 2 : 3 }, intent)).toThrow()
    expect(() => decodeProjectScopeReceipt({ ...receipt, link_revision: undefined }, intent)).toThrow()
  })
})


describe("authenticated HTTP scope v1", () => {
  it("preserves explicit request-specific owner eligibility and normalizes display metadata", () => {
    expect(decodeProjectScope({ ...httpScopeFixture(), note: "display metadata" })).toEqual(httpScopeFixture())
    expect(canWriteProjectScope(decodeProjectScope(httpScopeFixture()))).toBe(true)
    expect(canWriteProjectScope(scopeFixture())).toBe(false)
  })
  it.each(["owner_authentication_required", "owner_authentication_unconfigured", "owner_authentication_unavailable"] as const)("preserves %s independently of a readable scope", (code) => {
    const scope = decodeProjectScope(httpScopeFixture(code))
    expect(scope.owner_authorization.code).toBe(code); expect(canWriteProjectScope(scope)).toBe(false)
  })
  it.each([
    { ...httpScopeFixture(), capabilities: { ...scopeFixture().capabilities } },
    { ...httpScopeFixture(), owner_authorization: { ...httpScopeFixture().owner_authorization, code: "owner_authentication_required" } },
    { ...httpScopeFixture(), owner_authorization: { ...httpScopeFixture().owner_authorization, available: false } },
    { ...httpScopeFixture(), owner_authorization: { ...httpScopeFixture().owner_authorization, code: "future" } },
    { ...httpScopeFixture(), owner_authorization: { ...httpScopeFixture().owner_authorization, kind: "front_end_approved" } },
    { ...httpScopeFixture(), owner_authorization: { ...httpScopeFixture().owner_authorization, code: undefined } },
  ])("rejects contradictory or unrecognized HTTP authority %#", (scope) => expect(() => decodeProjectScope(scope)).toThrow())
  it("sends only the frozen three-field full body through putOnce and decodes receipt-only success", async () => {
    const receipt = { supervisor: intent.supervisor, state_revision: 3, changed: true, link_revision: null }
    vi.mocked(apiClient.putOnce).mockResolvedValue({ receipt })
    expect(await supervisorScopeClient.update(intent)).toEqual(receipt)
    expect(apiClient.putOnce).toHaveBeenCalledExactlyOnceWith("supervisor/default/scope", {
      incarnation_id: intent.supervisor.incarnation_id, expected_state_revision: 2, allowed_projects: ["p2"],
    })
    expect(apiClient.put).not.toHaveBeenCalled(); expect(apiClient.post).not.toHaveBeenCalled()
  })
  it.each([{}, { receipt: {} }, { receipt: { supervisor: intent.supervisor, state_revision: 2, changed: true, link_revision: null } }])("rejects malformed success without replay %#", async (response) => {
    vi.mocked(apiClient.putOnce).mockResolvedValue(response)
    await expect(supervisorScopeClient.update(intent)).rejects.toThrow(); expect(apiClient.putOnce).toHaveBeenCalledTimes(1)
  })
  it("leaves a failed PUT rejected after one call", async () => {
    const error = new ApiError("denied", 503, "", JSON.stringify({ code: "owner_authentication_unavailable" }))
    vi.mocked(apiClient.putOnce).mockRejectedValue(error)
    await expect(supervisorScopeClient.update(intent)).rejects.toBe(error)
    expect(apiClient.putOnce).toHaveBeenCalledTimes(1); expect(apiClient.put).not.toHaveBeenCalled()
  })
})
