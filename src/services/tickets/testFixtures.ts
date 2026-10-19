import type { TicketScope, TicketSnapshot, WorkView } from "./types"

export function ticketSnapshot(seq = 10): TicketSnapshot {
  const stamp = { seq, authority_epoch: 1, commit: "commit-" + seq }
  const views: WorkView[] = ["A", "B", "C", "D", "E"].map((id) => ({
    ticket: { id, kind: "work", state: "blocked", generation: 1, record_revision: 2, contract_revision: 1,
      updated_seq: 5, archived: false, contract: { title: "报告" + id, objective: "独立报告", constraints: [], acceptance: ["证据"] },
      blocked: { reason: "等待用户" }, active_assignment: "assignment-" + id, current_submission: null, accepted_submission: null },
    requests: [{ id: "q-" + id, work_id: id, assignment_id: "assignment-" + id, generation: 1,
      contract_revision: 1, prompt_revision: 1, updated_seq: 5, kind: { kind: "question" }, prompt: "颜色？", status: "open", answer: null }],
    submissions: [],
  }))
  const overview = { snapshot: stamp, index_seq: seq, coverage: "authoritative_scope", truncated: false, omitted_count: 0, next_cursor: null,
    data: { ticket_count: 5, work_count: 5, states: { blocked: 5 }, open_questions: 5, open_approvals: 0, needs_acceptance: 0 } }
  return { snapshot: stamp, views, complete: true, scope: { available: true, mutation_enabled: true, dispatch_enabled: true, health: "writable",
    binding: { scope_id: "scope", supervisor_session_id: "root", binding_revision: 1 }, overview,
    capabilities: { ticket_scope_v1: true, multi_pending_v1: true, precise_request_response_v1: true, message_references_v1: true, semantic_messages_v1: true } } }
}

export function initializableTicketScope(): TicketScope {
  return { available: false, readable: false, mutation_enabled: true, dispatch_enabled: false,
    availability: { kind: "uninitialized", reason_code: "scope_uninitialized" }, can_initialize: true,
    capabilities: { scope_initialize_v1: true },
    initialization: { supervisor_session_id: "root", incarnation_id: "11111111-1111-4111-8111-111111111111", binding_revision: 1 } }
}

export function readyTicketScopeV1(): TicketSnapshot["scope"] {
  const scope = ticketSnapshot().scope
  const confirmation = initializableTicketScope().initialization!
  return { ...scope, readable: true, availability: { kind: "ready", reason_code: "scope_ready" },
    can_initialize: false, initialization: null, capabilities: { ...scope.capabilities, scope_initialize_v1: true },
    binding: { ...scope.binding, scope_id: "supervisor/" + confirmation.incarnation_id } }
}
