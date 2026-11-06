import { uiText } from "@shared/i18n/ui"
import type { Assignment, WorkState, WorkView } from "@services/tickets/types"

export const ticketWorkLabels: Record<WorkState, string> = { get draft() { return uiText("ticket_draft_2a2fd29b") }, get ready() { return uiText("ticket_ready_to_dispatch_918dbc75") }, get active() { return uiText("ticket_in_progress_5026a63b") }, get submitted() { return uiText("ticket_awaiting_acceptance_3aabdf81") }, get accepted() { return uiText("ticket_accepted_2b9fcea2") }, get blocked() { return uiText("ticket_blocked_9059acb4") }, get cancelled() { return uiText("cancelled_a37778f1") } }

export function workExecutionRecord(view: WorkView) {
  const work = view.ticket
  const matches = (item: Pick<Assignment, "work_id" | "generation" | "contract_revision">) => item.work_id === work.id
    && item.generation === work.generation && item.contract_revision === work.contract_revision
  const result = view.submissions.find((submission) => !submission.stale && matches(submission)
    && submission.id === (work.accepted_submission ?? work.current_submission))
  const id = work.active_assignment ?? result?.assignment_id
  const included = view.sections?.includes("assignments") === true && Array.isArray(view.assignments)
  const assignment = included ? view.assignments?.find((item) => item.id === id && matches(item)) : undefined
  return { id, included, assignment }
}

export function ticketWorkStatusLabel(view: WorkView): string {
  const work = view.ticket
  if (work.state !== "active" || work.kind !== "work") return ticketWorkLabels[work.state]
  const { assignment } = workExecutionRecord(view)
  if (!assignment) return uiText("work_execution_unconfirmed")
  if (assignment.process_stopped === true) return uiText("work_execution_stopped")
  if (assignment.state === "dispatch_pending") return uiText("work_execution_dispatch_pending")
  if (assignment.state === "outcome_unknown") return uiText("work_execution_unknown")
  if (assignment.state === "cancelling") return uiText("work_execution_cancelling")
  if (assignment.state === "planned") return uiText("work_execution_planned")
  if (assignment.state === "blocked") return uiText("ticket_blocked_9059acb4")
  if (assignment.state === "failed") return uiText("failed_28384d7a")
  if (assignment.state === "cancelled") return uiText("cancelled_a37778f1")
  if (!assignment.runtime?.session_id?.trim() || !assignment.runtime.run_id?.trim()) return uiText("work_execution_unconfirmed")
  if (assignment.state === "admitted") return uiText("work_execution_admitted")
  // An Assignment is a saved checkpoint; active/running alone is not a live
  // observation. Keep the Work's business label and the explicit record below.
  return ticketWorkLabels[work.state]
}
