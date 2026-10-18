import { apiClient, isApiError } from "@services/api"
import { projectService } from "@services/project"
import { scopeErrorCodes, type ProjectOption, type ProjectScopeIntent, type ProjectScopeReceipt, type ProjectScopeResponse, type ScopeErrorCode, type ScopeProblem, type SupervisorReference } from "./types"

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
export const safeRevision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
export const projectId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)
const reference = (value: unknown): value is SupervisorReference => {
  const ref = record(value)
  return ref?.session_id === "bamboo-default-supervisor" && typeof ref.incarnation_id === "string"
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(ref.incarnation_id)
}
export const sameSupervisor = (a: SupervisorReference, b: SupervisorReference) => a.session_id === b.session_id && a.incarnation_id === b.incarnation_id
export const sameProjects = (a: readonly string[], b: readonly string[]) => {
  const right = [...b].sort()
  return a.length === right.length && [...a].sort().every((id, index) => id === right[index])
}
class InvalidScopeResponse extends Error {}
const invalid = (): never => { throw new InvalidScopeResponse("invalid_project_scope_response") }

export function decodeProjectScope(value: unknown): ProjectScopeResponse {
  const body = record(value), scope = record(body?.scope), caps = record(body?.capabilities), owner = record(body?.owner_authorization)
  const ids = scope?.allowed_projects
  if (!body || !scope || !reference(scope.supervisor) || !safeRevision(scope.state_revision)
    || !Array.isArray(ids) || ids.length > 64 || !ids.every(projectId) || new Set(ids).size !== ids.length
    || body.code !== (ids.length ? "project_scope_configured" : "project_scope_uninitialized")
    || caps?.project_scope_v1 !== true || typeof caps.supervised_root_create_v1 !== "boolean"
    || typeof owner?.available !== "boolean" || owner.required !== true || owner.kind !== "trusted_host_intent" || owner.http_registration !== false) return invalid()
  return { code: ids.length ? "project_scope_configured" : "project_scope_uninitialized", scope: { supervisor: { ...scope.supervisor }, state_revision: scope.state_revision, allowed_projects: [...ids].sort() },
    capabilities: { project_scope_v1: true, supervised_root_create_v1: caps.supervised_root_create_v1 },
    owner_authorization: { available: owner.available, required: true, kind: "trusted_host_intent", http_registration: false } }
}
export function decodeProjectScopeReceipt(value: unknown, intent: ProjectScopeIntent): ProjectScopeReceipt {
  const body = record(value)
  if (!body || !reference(body.supervisor) || !sameSupervisor(body.supervisor, intent.supervisor)
    || !safeRevision(body.state_revision) || typeof body.changed !== "boolean"
    || (body.changed ? body.state_revision <= intent.expected_state_revision : body.state_revision !== intent.expected_state_revision)
    || body.link_revision !== null && !safeRevision(body.link_revision)) return invalid()
  return { supervisor: { ...body.supervisor }, state_revision: body.state_revision, changed: body.changed, link_revision: body.link_revision }
}
export function scopeProblem(failure: unknown): ScopeProblem {
  if (failure instanceof InvalidScopeResponse) return { kind: "invalid" }
  if (!isApiError(failure)) return { kind: "error" }
  let code: ScopeErrorCode | undefined
  try {
    const value = record(JSON.parse(failure.body ?? "null"))?.code
    if (scopeErrorCodes.includes(value as ScopeErrorCode)) code = value as ScopeErrorCode
  } catch { /* Unknown responses confer no authority. */ }
  return { kind: failure.status === 401 || failure.status === 403 ? "forbidden"
    : failure.status === 404 ? code === "supervisor_missing" ? "missing" : code === "project_unavailable" ? "error" : "unsupported"
    : failure.status === 409 ? "conflict" : failure.status === 503 ? "unavailable" : "error", code }
}

/** Observation only. Production has no JS mutation transport for this scope. */
export const supervisorScopeClient = {
  async read(signal?: AbortSignal) {
    return decodeProjectScope(await apiClient.get<unknown>("supervisor/default/scope", { signal }))
  },
  async projects(): Promise<readonly ProjectOption[]> {
    const result = await projectService.listProjects()
    if (!Array.isArray(result?.projects) || result.projects.some((p) => !projectId(p.id) || typeof p.name !== "string" || !["active", "archived"].includes(p.status))
      || new Set(result.projects.map((p) => p.id)).size !== result.projects.length) return invalid()
    return result.projects.map(({ id, name, status }) => ({ id, name, status }))
  },
}
