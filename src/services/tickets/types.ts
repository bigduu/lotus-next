export type WorkState = "draft" | "ready" | "active" | "submitted" | "accepted" | "blocked" | "cancelled"
export type RequestStatus = "open" | "answered" | "approved" | "denied" | "superseded" | "expired" | "consumed"
export interface ScopeBinding { scope_id: string; supervisor_session_id: string; binding_revision: number }
export interface SnapshotRef { commit: string; seq: number; authority_epoch: number }
export interface Cursor { commit: string; query_hash: string; offset: number }
export interface ReadEnvelope<T> {
  snapshot: SnapshotRef; index_seq: number; coverage: string; truncated: boolean
  omitted_count: number; next_cursor: Cursor | null; data: T
}
export interface Overview {
  ticket_count: number; work_count: number; states: Partial<Record<WorkState, number>>
  open_questions: number; open_approvals: number; needs_acceptance: number
}
export interface TicketScope {
  available: boolean; reason?: string; health?: string; binding?: ScopeBinding
  mutation_enabled: boolean; dispatch_enabled: boolean; overview?: ReadEnvelope<Overview>
  capabilities?: { ticket_scope_v1?: boolean; multi_pending_v1?: boolean; precise_request_response_v1?: boolean; message_references_v1?: boolean; semantic_messages_v1?: boolean }
}
export interface Work {
  id: string; kind: "work" | "goal" | "step"; state: WorkState; generation: number
  record_revision: number; contract_revision: number; updated_seq: number; archived: boolean
  contract: { title: string; objective: string; constraints: string[]; acceptance: string[] }
  blocked: { reason: string } | null; active_assignment: string | null
  current_submission: string | null; accepted_submission: string | null
}
export interface Action { kind: string; target: string; data_hash: string; amount: string | null; permissions: string[]; risk: string }
export interface PendingRequest {
  id: string; work_id: string; assignment_id: string | null; generation: number
  contract_revision: number; prompt_revision: number; updated_seq: number
  kind: { kind: "question" } | { kind: "approval"; fingerprint: string; action: Action }
  prompt: string; status: RequestStatus; answer: string | null
}
export interface Submission {
  id: string; work_id: string; generation: number; contract_revision: number; stale: boolean
  artifacts: { uri: string; sha256: string }[]; evidence: string[]; updated_seq: number
}
export interface WorkView { ticket: Work; requests: PendingRequest[]; submissions: Submission[] }
export interface TicketSnapshot {
  scope: TicketScope & { binding: ScopeBinding; overview: ReadEnvelope<Overview> }
  snapshot: SnapshotRef; views: WorkView[]; complete: boolean
}
export type Decision = { kind: "question"; answer: string } | { kind: "approval"; fingerprint: string; approve: boolean }
export interface ResponseCommand {
  operation_id: string; binding: ScopeBinding; expected_seq: number; expected_epoch: number
  target: { request_id: string; work_id: string; assignment_id: string | null; generation: number; contract_revision: number; prompt_revision: number }
  decision: Decision
}
