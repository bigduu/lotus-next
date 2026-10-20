import { apiClient } from "@services/api"
import { uiText } from "@shared/i18n/ui"
import type { ReadEnvelope, ScopeBinding, SnapshotRef, TicketScope, WorkState } from "./types"

export type SprintStatus = "planned" | "active" | "closed"
export type SprintFilter = { kind: "backlog" } | { kind: "sprint"; sprint_id: string }
export interface SprintDefinition { name: string; goal: string; starts_at: number | null; ends_at: number | null }
export interface SprintCounts { total: number; accepted: number; pending_acceptance: number; blocked: number; cancelled: number; unfinished: number }
export interface SprintWorkVersion {
  record_revision: number; contract_revision: number; generation: number; state: WorkState
  blocked_resume_state: WorkState | null; paused: boolean; archived: boolean
  current_submission: string | null; accepted_submission: string | null; active_assignment: string | null
  context_hash: string | null; accepted: boolean
}
export type SprintDestination = { destination: "backlog" } | { destination: "sprint"; sprint_id: string }
export type SprintDisposition = { disposition: "accepted" | "cancelled" | "backlog" } | { disposition: "sprint"; sprint_id: string }
export interface SprintClosure {
  source_commit: string; source_seq: number; closed_seq: number; counts: SprintCounts
  members: Record<string, { version: SprintWorkVersion; disposition: SprintDisposition }>
}
export interface SprintSummary {
  id: string; project_id: string; definition: SprintDefinition; status: SprintStatus; revision: number
  created_seq: number; updated_seq: number; member_count: number; closure_counts: SprintCounts | null
}
export interface SprintMembershipEvent {
  work_id: string; work_revision: number; seq: number; operation_id: string; principal: string; source: string
  change: { kind: "added" | "removed" } | { kind: "carried_in"; from: string } | { kind: "carried_out"; to: string | null }
}
export interface Sprint extends Omit<SprintSummary, "member_count" | "closure_counts"> {
  members: string[]; history: SprintMembershipEvent[]; closure: SprintClosure | null
}
export interface SprintView { sprint: Sprint; current_members: Record<string, SprintWorkVersion>; current_counts: SprintCounts }
export type SprintPage = ReadEnvelope<SprintSummary[]>
export type SprintInspection = ReadEnvelope<SprintView>
export type SprintAction =
  | { op: "create"; definition: SprintDefinition }
  | { op: "edit"; expected_revision: number; definition: SprintDefinition }
  | { op: "start"; expected_revision: number }
  | { op: "add" | "remove"; expected_revision: number; work_id: string }
  | { op: "close"; expected_revision: number; dispositions: Record<string, SprintDestination>; target_revisions: Record<string, number> }
export interface SprintCommand {
  operation_id: string; binding: ScopeBinding; expected_seq: number; expected_epoch: number
  project_id: string; sprint_id: string; source: string; action: SprintAction
}
export interface SprintReceipt {
  operation: { operation_id: string; committed_seq: number; ids: Record<string, string>; principal: string; request_hash: string; canonical_request: string }
  closure: SprintClosure | null
}
export type SprintCommandResult = { status: "committed"; operationId: string; committedSeq: number }
  | { status: "conflict" | "unknown" | "rejected"; message: string }

const inconsistent = () => new Error(uiText("project_work_inconsistent"))
const integer = (value: number, minimum = 0) => Number.isSafeInteger(value) && value >= minimum
export const sprintFilterKey = (filter: SprintFilter | null | undefined) => filter?.kind === "sprint" ? JSON.stringify(["sprint", filter.sprint_id]) : filter?.kind ?? "all"
export function assertSprintSnapshot(actual: SnapshotRef, expected?: SnapshotRef) {
  if (!actual || !actual.commit || !integer(actual.seq) || !integer(actual.authority_epoch, 1)
    || (expected && (actual.commit !== expected.commit || actual.seq !== expected.seq || actual.authority_epoch !== expected.authority_epoch))) throw inconsistent()
}
function assertEnvelope(result: ReadEnvelope<unknown>, expected?: SnapshotRef) {
  assertSprintSnapshot(result.snapshot, expected)
  if (!["complete", "authoritative_scope"].includes(result.coverage) || !integer(result.index_seq) || result.index_seq < result.snapshot.seq
    || !integer(result.omitted_count)) throw inconsistent()
}
function assertCounts(counts: SprintCounts) {
  if (!counts || ["total", "accepted", "pending_acceptance", "blocked", "cancelled", "unfinished"].some((key) => !integer(counts[key as keyof SprintCounts]))
    || counts.total !== counts.accepted + counts.cancelled + counts.unfinished || counts.pending_acceptance > counts.unfinished || counts.blocked > counts.unfinished) throw inconsistent()
}
function assertDefinition(definition: SprintDefinition) {
  if (!definition || typeof definition.name !== "string" || !definition.name.trim() || typeof definition.goal !== "string"
    || !definition.goal.trim() || [definition.starts_at, definition.ends_at].some((date) => date !== null && !Number.isSafeInteger(date))
    || (definition.starts_at !== null && definition.ends_at !== null && definition.ends_at < definition.starts_at)) throw inconsistent()
}
function assertVersion(version: SprintWorkVersion) {
  if (!version || !integer(version.record_revision, 1) || !integer(version.contract_revision, 1) || !integer(version.generation)
    || !["draft", "ready", "active", "submitted", "accepted", "blocked", "cancelled"].includes(version.state)
    || typeof version.accepted !== "boolean" || typeof version.paused !== "boolean" || typeof version.archived !== "boolean") throw inconsistent()
}
function assertClosure(closure: SprintClosure) {
  if (!closure?.source_commit || !integer(closure.source_seq) || !integer(closure.closed_seq) || closure.closed_seq <= closure.source_seq || !closure.members) throw inconsistent()
  assertCounts(closure.counts)
  if (Object.keys(closure.members).length !== closure.counts.total) throw inconsistent()
  for (const member of Object.values(closure.members)) {
    assertVersion(member.version)
    if (!["accepted", "cancelled", "backlog", "sprint"].includes(member.disposition?.disposition)
      || (member.disposition.disposition === "sprint" && !member.disposition.sprint_id)) throw inconsistent()
  }
}
function assertSummary(row: Omit<SprintSummary, "member_count" | "closure_counts">, projectId: string) {
  if (!row?.id || row.project_id !== projectId || !["planned", "active", "closed"].includes(row.status)
    || !integer(row.revision, 1) || !integer(row.created_seq) || !integer(row.updated_seq) || row.updated_seq < row.created_seq) throw inconsistent()
  assertDefinition(row.definition)
}
const stableJson = (value: unknown): string => JSON.stringify(value && typeof value === "object"
  ? Array.isArray(value) ? value.map((item) => JSON.parse(stableJson(item))) : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, JSON.parse(stableJson(item))]))
  : value)

export const sprintClient = {
  async list(projectId: string, previous?: SprintPage, fixed?: SnapshotRef, signal?: AbortSignal): Promise<SprintPage> {
    const expected = previous?.snapshot ?? fixed
    const result = await apiClient.post<SprintPage>("tickets/sprints/list", {
      project_id: projectId, status: null, limit: 100, cursor: previous?.next_cursor ?? null, fixed_commit: expected?.commit ?? null,
    }, { signal })
    assertEnvelope(result, expected)
    if (!Array.isArray(result.data) || new Set(result.data.map((item) => item.id)).size !== result.data.length) throw inconsistent()
    for (const row of result.data) {
      assertSummary(row, projectId)
      if (!integer(row.member_count)) throw inconsistent()
      if (row.closure_counts) assertCounts(row.closure_counts)
      if ((row.status === "closed") !== (row.closure_counts !== null)) throw inconsistent()
    }
    const cursor = result.next_cursor
    if (cursor && (cursor.commit !== result.snapshot.commit || !cursor.query_hash || !integer(cursor.offset, 1)
      || cursor.offset <= (previous?.next_cursor?.offset ?? 0) || (previous?.next_cursor && cursor.query_hash !== previous.next_cursor.query_hash))) throw inconsistent()
    if (!cursor && (result.truncated || result.omitted_count !== 0)) throw inconsistent()
    if (!previous) return result
    if (result.data.some((row) => previous.data.some((old) => old.id === row.id))) throw inconsistent()
    return { ...result, data: [...previous.data, ...result.data] }
  },
  async inspect(projectId: string, sprintId: string, snapshot: SnapshotRef, signal?: AbortSignal): Promise<SprintInspection> {
    const result = await apiClient.post<SprintInspection>("tickets/sprints/inspect", { project_id: projectId, sprint_id: sprintId, fixed_commit: snapshot.commit }, { signal })
    assertEnvelope(result, snapshot)
    if (result.next_cursor || result.truncated || result.omitted_count !== 0 || result.data.sprint.id !== sprintId) throw inconsistent()
    const { sprint, current_members: members, current_counts: counts } = result.data
    assertSummary(sprint, projectId); assertCounts(counts)
    if (!Array.isArray(sprint.members) || new Set(sprint.members).size !== sprint.members.length || !Array.isArray(sprint.history)
      || !members || Object.keys(members).length !== sprint.members.length || counts.total !== sprint.members.length
      || sprint.members.some((id) => !Object.hasOwn(members, id))) throw inconsistent()
    for (const version of Object.values(members)) assertVersion(version)
    if ((sprint.status === "closed") !== (sprint.closure !== null)) throw inconsistent()
    if (sprint.closure) {
      assertClosure(sprint.closure)
      if (sprint.closure.closed_seq > snapshot.seq || sprint.members.some((id) => !Object.hasOwn(sprint.closure!.members, id))) throw inconsistent()
    }
    return result
  },
  async scope(signal?: AbortSignal): Promise<TicketScope> {
    const scope = await apiClient.get<TicketScope>("tickets/scope", { signal })
    if (scope.available && scope.binding && (!scope.binding.scope_id || !scope.binding.supervisor_session_id || !integer(scope.binding.binding_revision, 1))) throw inconsistent()
    return scope
  },
  async command(command: SprintCommand): Promise<SprintReceipt> {
    // One attempt only. The caller retains this exact command for an explicit
    // uncertain-outcome check; a conflict never silently adopts a new CAS.
    const result = await apiClient.postOnce<SprintReceipt>("tickets/sprints/command", command)
    const operation = result.operation
    if (!operation || operation.operation_id !== command.operation_id || operation.ids?.sprint !== command.sprint_id
      || !integer(operation.committed_seq) || operation.committed_seq <= command.expected_seq || !operation.request_hash || !operation.principal) throw inconsistent()
    let canonical: unknown
    try { canonical = JSON.parse(operation.canonical_request) } catch { throw inconsistent() }
    if (!Array.isArray(canonical) || canonical[0] !== "sprint" || stableJson(canonical[1]) !== stableJson(command)) throw inconsistent()
    if ((command.action.op === "close") !== (result.closure !== null)) throw inconsistent()
    if (result.closure) assertClosure(result.closure)
    return result
  },
}
