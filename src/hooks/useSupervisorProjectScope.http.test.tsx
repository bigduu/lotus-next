import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { apiClient } from "@services/api"
import { useSupervisorProjectScope } from "./useSupervisorProjectScope"

vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(),
  apiClient: { get: vi.fn(), putOnce: vi.fn(), put: vi.fn(), post: vi.fn() } }))
vi.mock("@services/project", () => ({ projectService: { listProjects: async () => ({ projects: [{ id: "p1", name: "One", status: "active" }] }) } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let cleanup = () => {}
afterEach(() => { cleanup(); document.body.replaceChildren() })
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
  let value!: ReturnType<typeof useSupervisorProjectScope>
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  cleanup = () => act(() => root.unmount())
  function Probe() { value = useSupervisorProjectScope(true); return null }
  await act(async () => root.render(<Probe />))
  act(() => { value.edit("p1", true); value.reviewDraft() })
  expect(value.canConfirm).toBe(true)
  await act(async () => value.confirm())
  expect(apiClient.putOnce).toHaveBeenCalledTimes(1)
  expect(apiClient.put).not.toHaveBeenCalled(); expect(apiClient.post).not.toHaveBeenCalled()
  expect(value.notice?.kind).toBe("saved")
  expect(apiClient.get).toHaveBeenCalledTimes(2)
  expect(invoke).not.toHaveBeenCalled()
})
