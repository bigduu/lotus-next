import { apiClient, isApiError } from "@services/api"
import { agentClient } from "@services/chat/AgentService"
import { projectId, safeRevision, sameSupervisor, scopeProblem } from "./client"
import type { ScopeProblem, SupervisorReference } from "./types"

export interface ManagedSessionLink {
  readonly session_id: string
  readonly link_revision: number
  readonly enabled: boolean
  readonly authorized: boolean
  readonly target_created_at: string
  readonly target_project_id: string
  readonly target_metadata_version: number
  readonly authorization_error?: "target_authority_unavailable"
}
export interface ManagedSessionsResponse {
  readonly capabilities: { readonly managed_sessions_http_v1: true }
  readonly scope: { readonly supervisor: SupervisorReference; readonly state_revision: number; readonly allowed_projects: readonly string[] }
  readonly sessions: readonly ManagedSessionLink[]
  readonly owner_authorization: { readonly available: boolean; readonly required: true; readonly kind: "existing_access"; readonly http_registration: false; readonly code: null }
}
/** Owner index metadata helps selection and display. It never grants management. */
export interface SessionCandidate {
  readonly session_id: string
  readonly title: string
  readonly project_id: string | null
  readonly model: string
  readonly is_running: boolean
  readonly last_run_status?: string
}
export interface SessionCandidatesPage { readonly sessions: readonly SessionCandidate[]; readonly nextOffset: number | null }
export interface ManagedSessionIntent {
  readonly supervisor: SupervisorReference
  readonly expected_state_revision: number
  readonly target_session_id: string
  readonly enabled: boolean
}
export interface ManagedSessionReceipt {
  readonly supervisor: SupervisorReference
  readonly state_revision: number
  readonly changed: boolean
  readonly link_revision: number | null
}
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
export const managedSessionId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256
  && value.trim() === value && value !== "." && !value.includes("..") && !value.includes("/") && !value.includes("\\")
  && ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159) && value !== "bamboo-default-supervisor"
const reference = (value: unknown): value is SupervisorReference => {
  const ref = record(value)
  return ref?.session_id === "bamboo-default-supervisor" && typeof ref.incarnation_id === "string"
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(ref.incarnation_id)
}
class InvalidManagedSessions extends Error {}
const invalid = (): never => { throw new InvalidManagedSessions("invalid_managed_sessions_response") }
export function decodeManagedSessions(value: unknown): ManagedSessionsResponse {
  const body = record(value), scope = record(body?.scope), caps = record(body?.capabilities), owner = record(body?.owner_authorization)
  const projects = scope?.allowed_projects, links = body?.sessions
  if (!scope || !reference(scope.supervisor) || !safeRevision(scope.state_revision)
    || !Array.isArray(projects) || projects.length > 64 || !projects.every(projectId) || new Set(projects).size !== projects.length
    || caps?.managed_sessions_http_v1 !== true || !Array.isArray(links) || links.length > 256
    || typeof owner?.available !== "boolean" || owner.required !== true || owner.kind !== "existing_access" || owner.http_registration !== false || owner.code !== null) return invalid()
  const sessions: ManagedSessionLink[] = []
  for (const value of links) {
    const link = record(value)
    if (!link || !managedSessionId(link.session_id) || !safeRevision(link.link_revision) || link.link_revision === 0 || link.link_revision > scope.state_revision
      || typeof link.enabled !== "boolean" || typeof link.authorized !== "boolean" || !projectId(link.target_project_id)
      || typeof link.target_created_at !== "string" || !Number.isFinite(Date.parse(link.target_created_at)) || !safeRevision(link.target_metadata_version)
      || link.authorization_error !== undefined && (link.authorization_error !== "target_authority_unavailable" || link.authorized)
      || link.authorized && (!link.enabled || !projects.includes(link.target_project_id))
      || sessions.some((previous) => previous.session_id === link.session_id)) return invalid()
    sessions.push({ session_id: link.session_id, link_revision: link.link_revision, enabled: link.enabled, authorized: link.authorized,
      target_created_at: link.target_created_at, target_project_id: link.target_project_id, target_metadata_version: link.target_metadata_version,
      ...(link.authorization_error === "target_authority_unavailable" ? { authorization_error: link.authorization_error } : {}) })
  }
  return { capabilities: { managed_sessions_http_v1: true }, scope: { supervisor: { ...scope.supervisor }, state_revision: scope.state_revision, allowed_projects: [...projects].sort() },
    sessions: sessions.sort((a, b) => a.session_id.localeCompare(b.session_id)),
    owner_authorization: { available: owner.available, required: true, kind: "existing_access", http_registration: false, code: null } }
}
export function decodeManagedSessionReceipt(value: unknown, intent: ManagedSessionIntent): ManagedSessionReceipt {
  const receipt = record(value)
  if (!receipt || !reference(receipt.supervisor) || !sameSupervisor(receipt.supervisor, intent.supervisor)
    || !safeRevision(receipt.state_revision) || typeof receipt.changed !== "boolean"
    || (receipt.changed ? receipt.state_revision <= intent.expected_state_revision : receipt.state_revision !== intent.expected_state_revision)
    || receipt.link_revision !== null && (!safeRevision(receipt.link_revision) || receipt.link_revision === 0 || receipt.link_revision > receipt.state_revision)) return invalid()
  return { supervisor: { ...receipt.supervisor }, state_revision: receipt.state_revision, changed: receipt.changed, link_revision: receipt.link_revision }
}
export const canWriteManagedSessions = (value: ManagedSessionsResponse | null) => value?.capabilities.managed_sessions_http_v1 === true && value.owner_authorization.available
export function managedSessionsProblem(error: unknown): ScopeProblem {
  if (error instanceof InvalidManagedSessions) return { kind: "invalid" }
  if (isApiError(error) && error.status === 501) return { kind: "unsupported" }
  return scopeProblem(error)
}
export const managedSessionsClient = {
  async read(signal?: AbortSignal) { return decodeManagedSessions(await apiClient.get<unknown>("supervisor/default/sessions", { signal })) },
  async candidates(offset = 0): Promise<SessionCandidatesPage> {
    const page = await agentClient.listSessions({ kind: "root", limit: 100, offset })
    if (!Array.isArray(page.sessions) || page.sessions.length > 256 || !safeRevision(page.total) || !safeRevision(page.offset)
      || page.next_offset !== undefined && (!safeRevision(page.next_offset) || page.next_offset <= offset)) return invalid()
    const sessions = page.sessions.filter((session) => session.kind === "root" && managedSessionId(session.id)).map((session) => {
      if (typeof session.title !== "string" || typeof session.model !== "string" || typeof session.is_running !== "boolean"
        || session.project_id != null && !projectId(session.project_id)) return invalid()
      return { session_id: session.id, title: session.title, project_id: session.project_id ?? null, model: session.model,
        is_running: session.is_running, ...(typeof session.last_run_status === "string" ? { last_run_status: session.last_run_status } : {}) }
    })
    return { sessions, nextOffset: page.next_offset ?? null }
  },
  async update(intent: ManagedSessionIntent): Promise<ManagedSessionReceipt> {
    if (!reference(intent.supervisor) || !safeRevision(intent.expected_state_revision) || !managedSessionId(intent.target_session_id) || typeof intent.enabled !== "boolean") return invalid()
    const response = record(await apiClient.putOnce<unknown>(`supervisor/default/sessions/${encodeURIComponent(intent.target_session_id)}`, {
      incarnation_id: intent.supervisor.incarnation_id, expected_state_revision: intent.expected_state_revision, enabled: intent.enabled,
    }))
    return decodeManagedSessionReceipt(response?.receipt, intent)
  },
}
