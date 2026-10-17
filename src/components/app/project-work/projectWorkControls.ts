import type { ScopeBinding, WorkState } from "@services/tickets/types"

// Presentation ports only. These names are not an HTTP/operation DTO.
export const workPriorities = ["low", "medium", "high", "critical"] as const
export type WorkPriority = typeof workPriorities[number]
export interface WorkPlanningValue { priority: WorkPriority; expectedCompletionAt: string | null }
export interface WorkPlanningDraft { priority: WorkPriority; expectedCompletionAt: string }
export interface WorkPlanningQuery {
  order: "updated" | "priority" | "expected_completion"
  priority: WorkPriority | null
  deadline: "any" | "overdue" | "unset"
  asOf: string | null
}
export type ControlCapability = { available: true } | { available: false; reason?: string }
export interface WorkCommandContext {
  operationId: string
  workId: string
  generation: number
  recordRevision: number
  binding: ScopeBinding
  expectedSeq: number
  expectedEpoch: number
}
export interface WorkRequestReceipt { operationId: string }
export type WorkRequestStatus =
  | { phase: "idle" }
  | { phase: "requested" | "awaiting_ack" | "acknowledged" | "conflict" | "denied" | "outcome_unknown" | "failed"; operationId: string; detail?: string }
export interface WorkControlCopy {
  planning: string; priority: string; desiredDeadline: string; deadlineHelp: string; clearDeadline: string
  currentPlanning: string; savePlanning: string; unsupported: string; ownerRequired: string; unavailableContext: string
  invalidDeadline: string; deadlineUnknown: string; deadlineUnset: string; deadlineInvalid: string
  overdue: string; withinDeadline: string; terminalDeadline: string; asOfUnknown: string; asOf: string
  query: string; order: string; orderUpdated: string; orderPriority: string; orderDeadline: string
  filterPriority: string; allPriorities: string; filterDeadline: string; anyDeadline: string; overdueOnly: string; unsetOnly: string
  serverQueryHelp: string; ownerControls: string; actualState: string; paused: string; pauseUnknown: string
  pause: string; resume: string; cancel: string; accept: string; submitting: string; requestSent: string
  awaitingAck: string; acknowledged: string; conflict: string; denied: string; outcomeUnknown: string; failed: string
  reload: string; reconcile: string; operation: string; actualStateHelp: string; completionGuard: string
  submission: string; evidence: string; unverified: string; evidenceNotRecorded: string; noUnverifiedRecorded: string
  userAcceptance: string; acceptanceConfirmation: string; acceptedByUser: string
  priorities: Record<WorkPriority, string>
  states: Record<WorkState, string>
}

/** A known offset is required. In RFC3339, -00:00 means the offset is unknown. */
export function deadlineInstant(value: string | null | undefined): bigint | null {
  if (typeof value !== "string") return null
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?([Zz]|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match || match[8] === "-00:00") return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offset] = match
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59
    || (offset.toUpperCase() !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59))) return null
  const instant = Date.parse(value)
  if (!Number.isFinite(instant)) return null
  // Preserve RFC3339 sub-millisecond ordering at the explicit snapshot boundary.
  const fraction = (match[7] ?? "").padEnd(9, "0")
  return BigInt(instant) * 1_000_000n + BigInt(fraction.slice(3))
}
export type DeadlineStatus = "unknown" | "unset" | "invalid" | "as_of_unknown" | "overdue" | "within_deadline" | "terminal"
export function workDeadlineStatus(value: string | null | undefined, asOf: string | null, state: WorkState): DeadlineStatus {
  if (value === undefined) return "unknown"
  if (value === null) return "unset"
  const instant = deadlineInstant(value)
  if (instant === null) return "invalid"
  if (state === "accepted" || state === "cancelled") return "terminal"
  const reference = deadlineInstant(asOf)
  if (reference === null) return "as_of_unknown"
  return instant < reference ? "overdue" : "within_deadline"
}
export function planningValue(draft: WorkPlanningDraft): WorkPlanningValue | null {
  if (!workPriorities.includes(draft.priority)) return null
  const value = draft.expectedCompletionAt.trim()
  if (value && deadlineInstant(value) === null) return null
  return { priority: draft.priority, expectedCompletionAt: value || null }
}
export function commandMatches(context: WorkCommandContext | null | undefined, work: { id: string; generation: number; recordRevision: number }): context is WorkCommandContext {
  return !!context?.operationId && context.workId === work.id && context.generation === work.generation
    && context.recordRevision === work.recordRevision && !!context.binding?.scope_id
    && Number.isSafeInteger(context.generation) && context.generation >= 1
    && Number.isSafeInteger(context.recordRevision) && context.recordRevision >= 1
    && !!context.binding.supervisor_session_id && Number.isSafeInteger(context.binding.binding_revision) && context.binding.binding_revision >= 1
    && Number.isSafeInteger(context.expectedSeq) && context.expectedSeq >= 0
    && Number.isSafeInteger(context.expectedEpoch) && context.expectedEpoch >= 1
}
