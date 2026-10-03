import type { Decision, PendingRequest, ResponseCommand, TicketSnapshot, WorkView } from "./types"

export interface TicketState {
  current: TicketSnapshot; works: Record<string, WorkView>; requests: Record<string, PendingRequest>
}

export function applyTicketSnapshot(previous: TicketState | null, next: TicketSnapshot): TicketState {
  const sameScope = previous?.current.scope.binding.scope_id === next.scope.binding.scope_id
    && previous.current.scope.binding.supervisor_session_id === next.scope.binding.supervisor_session_id
    && previous.current.scope.binding.binding_revision === next.scope.binding.binding_revision
  if (sameScope && previous) {
    if (next.snapshot.authority_epoch < previous.current.snapshot.authority_epoch
      || next.snapshot.seq < previous.current.snapshot.seq) return previous
    if (next.snapshot.seq === previous.current.snapshot.seq
      && next.snapshot.commit !== previous.current.snapshot.commit) throw new Error("工单快照需要重新同步。")
  }
  const requests = sameScope && previous ? { ...previous.requests } : {}
  const works = sameScope && previous && !next.complete ? { ...previous.works } : {}
  for (const view of next.views) {
    works[view.ticket.id] = view
    for (const request of view.requests) {
      const old = requests[request.id]
      if (old && old.status !== "open" && request.status === "open") continue
      if (old && (old.generation > request.generation || old.prompt_revision > request.prompt_revision
        || old.contract_revision > request.contract_revision || old.updated_seq > request.updated_seq)) continue
      if (old && old.updated_seq === request.updated_seq && old.status !== request.status) {
        throw new Error("请求状态存在冲突，请刷新工单。")
      }
      requests[request.id] = request
    }
  }
  // Keep closed requests as tombstones/history; an old event cannot revive one.
  return { current: next, works, requests }
}

export function effectiveStatus(state: TicketState, request: PendingRequest) {
  if (request.status !== "open") return request.status
  const work = state.works[request.work_id]?.ticket
  if (!work || work.archived || work.state === "cancelled"
    || work.generation !== request.generation || work.contract_revision !== request.contract_revision) return "superseded"
  return "open"
}

export function responseCommand(state: TicketState, request: PendingRequest, decision: Decision, operationId: string): ResponseCommand {
  const current = state.requests[request.id]
  if (!current || current.updated_seq !== request.updated_seq || current.prompt_revision !== request.prompt_revision
    || current.generation !== request.generation || current.contract_revision !== request.contract_revision
    || current.assignment_id !== request.assignment_id || effectiveStatus(state, current) !== "open") throw new Error("这个请求已失效，请使用当前请求。")
  if (request.kind.kind !== decision.kind || (request.kind.kind === "approval" && decision.kind === "approval"
    && request.kind.fingerprint !== decision.fingerprint)) throw new Error("动作或批准范围已变化。")
  return { operation_id: operationId, binding: state.current.scope.binding,
    expected_seq: state.current.snapshot.seq, expected_epoch: state.current.snapshot.authority_epoch,
    target: { request_id: request.id, work_id: request.work_id, assignment_id: request.assignment_id,
      generation: request.generation, contract_revision: request.contract_revision, prompt_revision: request.prompt_revision }, decision }
}
