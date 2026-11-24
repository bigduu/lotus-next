import { createRoot, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { apiClient } from "@services/api"
import { createSupervisorProjectScope } from "./createSupervisorProjectScope"

vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(),
  apiClient: { get: vi.fn(), putOnce: vi.fn(), put: vi.fn(), post: vi.fn() } }))
vi.mock("@services/project", () => ({ projectService: { listProjects: async () => ({ projects: [{ id: "p1", name: "One", status: "active" }] }) } }))
let cleanup = () => {}
afterEach(() => cleanup())

async function settle() {
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve()
    flush()
  }
}
const observation = () => ({ code: "project_scope_uninitialized", scope: {
  supervisor: { session_id: "bamboo-default-supervisor", incarnation_id: "11111111-1111-4111-8111-111111111111" },
  state_revision: 0, allowed_projects: [] as string[] },
  capabilities: { project_scope_v1: true, supervised_root_create_v1: true, project_scope_http_write_v1: true },
  owner_authorization: { available: true, required: true, kind: "existing_access", http_registration: false, code: null } })

it.each([false, true])("uses the same HTTP scope action with native globals=%s and no native readiness", async (native) => {
  const invoke = vi.fn(); if (native) vi.stubGlobal("__TAURI_INTERNALS__", { invoke })
  let scope = observation()
  vi.mocked(apiClient.get).mockImplementation(async () => structuredClone(scope))
  vi.mocked(apiClient.putOnce).mockImplementation(async (_path, body) => {
    expect(body).toEqual({ incarnation_id: scope.scope.supervisor.incarnation_id, expected_state_revision: 0, allowed_projects: ["p1"] })
    scope = { ...scope, code: "project_scope_configured", scope: { ...scope.scope, state_revision: 1, allowed_projects: ["p1"] } }
    return { receipt: { supervisor: scope.scope.supervisor, state_revision: 1, changed: true, link_revision: null } }
  })
  const controller = createRoot((dispose) => {
    cleanup = dispose
    return createSupervisorProjectScope(() => true)
  })
  await settle()
  controller.edit("p1", true)
  flush()
  controller.reviewDraft()
  flush()
  expect(controller.canConfirm()).toBe(true)
  await controller.confirm()
  expect(apiClient.putOnce).toHaveBeenCalledTimes(1)
  expect(apiClient.put).not.toHaveBeenCalled(); expect(apiClient.post).not.toHaveBeenCalled()
  expect(controller.view().notice?.kind).toBe("saved")
  expect(apiClient.get).toHaveBeenCalledTimes(2)
  expect(invoke).not.toHaveBeenCalled()
})
