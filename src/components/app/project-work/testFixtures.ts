import { vi } from "vitest"
import type { ProjectWorkPlanningControlsProps } from "./ProjectWorkPlanningControls"
import type { ProjectWorkOwnerControlsProps } from "./ProjectWorkOwnerControls"
import type { WorkCommandContext, WorkControlCopy } from "./projectWorkControls"

export const controlCopy: WorkControlCopy = {
  planning: "Work planning", priority: "Priority", desiredDeadline: "Desired deadline",
  deadlineHelp: "Enter RFC3339 with Z or an explicit UTC offset. This is your desired deadline, not a model ETA or a promise.",
  clearDeadline: "Clear deadline", currentPlanning: "Saved planning", savePlanning: "Request planning update",
  unsupported: "This capability is unavailable on the connected backend.", ownerRequired: "Owner access is required.",
  unavailableContext: "Refresh to obtain the authoritative binding and revision.",
  invalidDeadline: "Use a valid date and time with seconds and a known UTC offset, or clear the deadline.",
  deadlineUnknown: "Deadline not provided by the backend.", deadlineUnset: "No desired deadline.", deadlineInvalid: "Invalid deadline; overdue status is unknown.",
  overdue: "Overdue at this snapshot time.", withinDeadline: "Within the desired deadline at this snapshot time.",
  terminalDeadline: "This Work is terminal; no active overdue warning.", asOfUnknown: "Snapshot time is unknown; overdue status is unavailable.", asOf: "Snapshot time",
  query: "Snapshot sort and filters", order: "Sort", orderUpdated: "Recently updated", orderPriority: "Priority, highest first",
  orderDeadline: "Desired deadline, earliest first", filterPriority: "Priority filter", allPriorities: "All priorities",
  filterDeadline: "Deadline filter", anyDeadline: "Any deadline", overdueOnly: "Overdue", unsetOnly: "No deadline",
  serverQueryHelp: "Sort and filters request a new server snapshot across all Work. The current partial page is never sorted locally.",
  ownerControls: "Owner Work controls", actualState: "Actual Work state", paused: "Paused", pauseUnknown: "Pause status unknown",
  pause: "Request pause", resume: "Request resume", cancel: "Request cancellation", accept: "Accept as User",
  submitting: "Submitting request…", requestSent: "Request received. Actual Work state has not been confirmed.",
  awaitingAck: "Waiting for runtime confirmation. Actual Work state remains authoritative.",
  acknowledged: "Runtime acknowledged the request. The actual Work state is shown above.",
  conflict: "The scope changed. Reload before making a new request.", denied: "The backend denied this request.",
  outcomeUnknown: "Request outcome is unknown. Reconcile the same operation before retrying.", failed: "The request failed. Reload the authoritative state.",
  reload: "Reload Work", reconcile: "Reconcile same operation", operation: "Operation",
  actualStateHelp: "A request receipt or runtime ACK alone does not mean the Work is paused, cancelled or complete.",
  completionGuard: "User acceptance requires the backend stop guard and a confirmed stopped process for the exact current submission.",
  submission: "Submission", evidence: "Recorded evidence", unverified: "Unverified items", evidenceNotRecorded: "No evidence was recorded.",
  noUnverifiedRecorded: "No unverified items were recorded. This does not establish test success.",
  userAcceptance: "User acceptance preserves evidence and unverified items. It does not claim that automated tests passed.",
  acceptanceConfirmation: "I accept this exact submission as the User, including the listed unverified items.",
  acceptedByUser: "Accepted by User; recorded evidence and unverified items remain visible.",
  priorities: { low: "Low", medium: "Medium", high: "High", critical: "Critical" },
  states: { draft: "Draft", ready: "Ready", active: "Active", submitted: "Submitted", accepted: "Accepted", blocked: "Blocked", cancelled: "Cancelled" },
}
export const commandContext = (operationId = "operation-planning"): WorkCommandContext => ({ operationId,
  workId: "work-1", generation: 3, recordRevision: 8,
  binding: { scope_id: "scope-1", supervisor_session_id: "owner-1", binding_revision: 2 }, expectedSeq: 19, expectedEpoch: 4 })
export const planningProps = (): ProjectWorkPlanningControlsProps => ({
  work: { id: "work-1", generation: 3, recordRevision: 8, state: "active" },
  current: { priority: "medium", expectedCompletionAt: "2026-10-18T00:00:00+08:00" },
  draft: { priority: "high", expectedCompletionAt: "2026-10-19T09:15:00-07:00" },
  query: { order: "updated", priority: null, deadline: "any", asOf: "2026-10-17T17:00:00Z" },
  owner: true, editCapability: { available: true }, queryCapability: { available: true },
  command: commandContext(), request: { phase: "idle" }, copy: controlCopy,
  onDraftChange: vi.fn(), onQueryChange: vi.fn(),
  onSavePlanning: vi.fn(async (_value, context) => ({ operationId: context.operationId })), onReload: vi.fn(), onReconcile: vi.fn(),
})
export const ownerProps = (): ProjectWorkOwnerControlsProps => ({
  work: { id: "work-1", generation: 3, recordRevision: 8, contractRevision: 5, currentSubmissionId: "submission-1", state: "submitted", paused: false },
  owner: true, capabilities: { pause: { available: true }, resume: { available: true }, cancel: { available: true }, accept: { available: true } },
  commands: { pause: commandContext("operation-pause"), resume: commandContext("operation-resume"), cancel: commandContext("operation-cancel"), accept: commandContext("operation-accept") },
  request: { phase: "idle" }, acceptance: { submissionId: "submission-1", generation: 3, contractRevision: 5,
    stale: false, stopGuardEnforced: true, processStopped: true, evidence: ["Recorded source review"], unverifiedItems: ["Live backend integration has not been verified"] },
  acceptanceConfirmation: { submissionId: "submission-1", generation: 3, contractRevision: 5 }, acceptedByUser: false, copy: controlCopy, onAcceptanceConfirmationChange: vi.fn(),
  onRequestAction: vi.fn(async (_intent, context) => ({ operationId: context.operationId })), onReload: vi.fn(), onReconcile: vi.fn(),
})
