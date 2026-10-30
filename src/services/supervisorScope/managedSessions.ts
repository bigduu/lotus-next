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
  readonly target_project_id: string | null
  readonly target_metadata_version: number
  readonly authorization_error?: "target_authority_unavailable" | null
  readonly kind?: "root" | "child"
  readonly root_session_id?: string
  readonly parent_session_id?: string | null
  readonly current_user_target?: CurrentUserSessionTarget
}
/** Canonical observation kept intact for a future exact-target adapter, never a grant. */
export interface CurrentUserSessionTarget {
  readonly session_id: string
  readonly created_at: string
  readonly kind: "root" | "child"
  readonly root_session_id: string
  readonly parent_session_id: string | null
  readonly authority_sha256: string
  readonly ancestry_sha256: string
  readonly metadata_version: number
  readonly project_id: string | null
}
export interface ManagedSessionSelection { readonly supervisor: SupervisorReference; readonly target: CurrentUserSessionTarget }
export interface ManagedSessionsQuery { readonly query?: string; readonly after?: string; readonly limit?: number }
export interface LegacyManagedLink {
  readonly revision: number
  readonly enabled: boolean
  readonly target_created_at: string
  readonly target_project_id: string
  readonly target_metadata_version: number
}
export interface ManagedSessionsResponse {
  readonly capabilities: { readonly managed_sessions_http_v1: true; readonly supervisor_current_user_scope_v1?: true }
  readonly scope: { readonly supervisor: SupervisorReference; readonly state_revision: number; readonly allowed_projects: readonly string[] }
  readonly sessions: readonly ManagedSessionLink[]
  readonly management_access?: { readonly kind: "current_user"; readonly requires_session_attachment: false }
  readonly next_after?: string | null
  readonly legacy_links?: Readonly<Record<string, LegacyManagedLink>>
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
  /** Display metadata is bound to the observed identity and never grants access. */
  readonly observedTarget?: CurrentUserSessionTarget
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
const locator = (value: unknown): value is string => value === "bamboo-default-supervisor" || managedSessionId(value)
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value))
function currentUserEntry(value: unknown): ManagedSessionLink {
  const entry = record(value), target = record(entry?.current_user_target)
  if (!entry || !target || !managedSessionId(entry.session_id) || entry.link_revision !== 0 || entry.enabled !== true || entry.authorized !== true
    || entry.authorization_error !== null || !timestamp(entry.target_created_at) || !safeRevision(entry.target_metadata_version)
    || entry.target_project_id !== null && !projectId(entry.target_project_id)
    || target.session_id !== entry.session_id || target.created_at !== entry.target_created_at || target.metadata_version !== entry.target_metadata_version || target.project_id !== entry.target_project_id
    || (target.kind !== "root" && target.kind !== "child") || entry.kind !== target.kind
    || !locator(target.root_session_id) || entry.root_session_id !== target.root_session_id || entry.parent_session_id !== target.parent_session_id
    || (target.kind === "root" ? target.root_session_id !== target.session_id || target.parent_session_id !== null
      : !locator(target.parent_session_id) || target.parent_session_id === target.session_id)
    || typeof target.authority_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(target.authority_sha256)
    || typeof target.ancestry_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(target.ancestry_sha256)) return invalid()
  const parent = target.parent_session_id
  if (parent !== null && !locator(parent)) return invalid()
  return { session_id: entry.session_id, link_revision: 0, enabled: true, authorized: true,
    target_created_at: entry.target_created_at, target_project_id: entry.target_project_id, target_metadata_version: entry.target_metadata_version,
    kind: target.kind, root_session_id: target.root_session_id, parent_session_id: parent, authorization_error: null,
    current_user_target: { session_id: target.session_id, created_at: entry.target_created_at, kind: target.kind,
      root_session_id: target.root_session_id, parent_session_id: parent, authority_sha256: target.authority_sha256,
      ancestry_sha256: target.ancestry_sha256, metadata_version: entry.target_metadata_version, project_id: entry.target_project_id } }
}
export function decodeManagedSessions(value: unknown): ManagedSessionsResponse {
  const body = record(value), scope = record(body?.scope), caps = record(body?.capabilities), owner = record(body?.owner_authorization)
  const projects = scope?.allowed_projects, links = body?.sessions
  if (!body || !scope || !reference(scope.supervisor) || !safeRevision(scope.state_revision)
    || !Array.isArray(projects) || projects.length > 64 || !projects.every(projectId) || new Set(projects).size !== projects.length
    || caps?.managed_sessions_http_v1 !== true || !Array.isArray(links) || links.length > 256
    || typeof owner?.available !== "boolean" || owner.required !== true || owner.kind !== "existing_access" || owner.http_registration !== false || owner.code !== null) return invalid()
  const management = record(body?.management_access)
  if (management || caps.supervisor_current_user_scope_v1 !== undefined) {
    if (management?.kind !== "current_user" || management.requires_session_attachment !== false || caps.supervisor_current_user_scope_v1 !== true
      || links.length > 20 || body?.next_after !== null && !managedSessionId(body?.next_after) || !record(body?.legacy_links)) return invalid()
    const sessions = links.map(currentUserEntry)
    if (new Set(sessions.map((session) => session.session_id)).size !== sessions.length) return invalid()
    const legacyEntries = Object.entries(record(body.legacy_links)!)
    if (legacyEntries.length > 256) return invalid()
    const stateRevision = scope.state_revision
    const legacy = Object.fromEntries(legacyEntries.map(([id, value]) => {
      const link = record(value)
      if (!managedSessionId(id) || !link || !safeRevision(link.revision) || link.revision === 0 || link.revision > stateRevision
        || typeof link.enabled !== "boolean" || !timestamp(link.target_created_at) || !projectId(link.target_project_id) || !safeRevision(link.target_metadata_version)) return invalid()
      return [id, { revision: link.revision, enabled: link.enabled, target_created_at: link.target_created_at,
        target_project_id: link.target_project_id, target_metadata_version: link.target_metadata_version }]
    }))
    return { scope: { supervisor: { ...scope.supervisor }, state_revision: scope.state_revision, allowed_projects: [...projects].sort() },
      capabilities: { managed_sessions_http_v1: true, supervisor_current_user_scope_v1: true },
      owner_authorization: { available: owner.available, required: true, kind: "existing_access", http_registration: false, code: null },
      management_access: { kind: "current_user", requires_session_attachment: false }, sessions,
      next_after: body.next_after as string | null, legacy_links: legacy }
  }
  if (body?.management_access !== undefined || body?.legacy_links !== undefined || body?.next_after !== undefined) return invalid()
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
export const canWriteManagedSessions = (value: ManagedSessionsResponse | null) => value?.management_access === undefined
  && value?.capabilities.managed_sessions_http_v1 === true && value.owner_authorization.available
export function managedSessionsProblem(error: unknown): ScopeProblem {
  if (error instanceof InvalidManagedSessions) return { kind: "invalid" }
  if (isApiError(error) && error.status === 501) return { kind: "unsupported" }
  return scopeProblem(error)
}
export const managedSessionsClient = {
  async read(signal?: AbortSignal, page?: ManagedSessionsQuery) {
    const params = new URLSearchParams()
    if (page) {
      const limit = page.limit ?? 20
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20 || page.after !== undefined && !managedSessionId(page.after)
        || page.query !== undefined && typeof page.query !== "string") return invalid()
      params.set("limit", String(limit))
      if (page.after !== undefined) params.set("after", page.after)
      if (page.query !== undefined) params.set("query", page.query)
    }
    const response = decodeManagedSessions(await apiClient.get<unknown>(`supervisor/default/sessions${page ? `?${params}` : ""}`, { signal }))
    if (page?.after !== undefined && response.next_after === page.after) return invalid()
    return response
  },
  async describe(links: readonly ManagedSessionLink[], signal?: AbortSignal): Promise<readonly SessionCandidate[]> {
    return (await import("./sessionLabels")).describe(links, signal)
  },
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


/** Re-read the observed directory identity before opening it; this is not an atomic history read or an access grant. */
export async function revalidateManagedSelection(selection: ManagedSessionSelection, current: () => boolean): Promise<boolean> {
  const { target, supervisor } = selection
  // The producer bounds directory queries in UTF-8 bytes, not JavaScript code units.
  if (new TextEncoder().encode(target.session_id).length > 128) return false
  let after: string | undefined
  for (let pageIndex = 0; pageIndex < 20 && current(); pageIndex++) {
    const page = await managedSessionsClient.read(undefined, { query: target.session_id, limit: 20, ...(after ? { after } : {}) })
    if (!current() || page.management_access?.kind !== "current_user" || !page.owner_authorization.available
      || !sameSupervisor(supervisor, page.scope.supervisor)) return false
    const found = page.sessions.find((entry) => entry.session_id === target.session_id)?.current_user_target
    if (found) return found.session_id === target.session_id && found.created_at === target.created_at && found.kind === target.kind
      && found.root_session_id === target.root_session_id && found.parent_session_id === target.parent_session_id
      && found.project_id === target.project_id && found.metadata_version === target.metadata_version
      && found.authority_sha256 === target.authority_sha256 && found.ancestry_sha256 === target.ancestry_sha256
    if (!page.next_after || page.next_after === after) return false
    after = page.next_after
  }
  return false
}
