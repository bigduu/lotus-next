import type { BoardAssignment } from "@services/tickets/projectBoard"

// Presentation inputs only. The parent owns authenticated reads, fixed snapshots,
// freshness and navigation checks; this module never grants or persists ownership.
export type HealthRead<T> =
  | { status: "available"; value: T; updatedAt: string | null; validUntil?: string | null }
  | { status: "unsupported" | "unknown"; reason?: string; updatedAt?: string | null }

export interface AssignmentAttempt extends BoardAssignment {
  work_id?: string
  generation?: number
  authority_epoch?: number
  process_stopped?: boolean
  step_id?: string | null
  attempt_id?: string | null
  // An Assignment proves executor association. Other roles require an explicit
  // canonical association supplied by the parent, never a session-name heuristic.
  role?: "executor" | "collaborator" | "reviewer"
  claimed_at?: string | null
  end_reason?: string | null
}

export interface AssignmentFence {
  work_id: string
  assignment_id: string
  generation: number
  authority_epoch: number
}

// Optional host-verified observations, not an implemented Bamboo wire DTO.
export interface AssignmentObservation extends AssignmentFence {
  session_id: string
  run_id: string
  execution: "running" | "waiting" | "blocked" | "unknown"
  heartbeat_at?: string | null
  progress?: { sequence: number; at: string; evidence_ref: string } | null
  wait_reason?: string | null
  block_reason?: string | null
  next_check_at?: string | null
  terminal?: { at: string; state: string; evidence_ref: string } | null
}

export interface SessionAccessRef {
  assignment_id: string
  session_id: string
  run_id: string
  access: "accessible" | "denied" | "missing" | "unknown"
}

// Patrol currently exposes pure Rust ports, not HTTP. Keep this capability
// unsupported until an adapter can provide scoped, persisted evidence.
export interface PatrolIncident extends AssignmentFence {
  id: string
  fingerprint?: string | null
  source_revision: string
  evidence_ref: string
  opened_at: string
  progress_sequence: number | null
  phase: "open" | "diagnosing" | "cooldown" | "blocked" | "resolved"
  reason: string
  attempts?: number | null
  findings?: string | null
  uncertainty?: string | null
  escalation?: string | null
  next_check_at?: string | null
  recovery?: { requested_at?: string | null; acknowledged_at?: string | null } | null
}

export function timestampMs(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const result = Date.parse(value)
  return Number.isFinite(result) ? result : null
}

export function healthReadStatus<T>(read: HealthRead<T> | undefined, nowMs: number, requireWindow = false): "available" | "unsupported" | "unknown" {
  if (!read) return "unsupported"
  if (read.status !== "available") return read.status
  if (!Number.isFinite(nowMs)) return "unknown"
  const updated = timestampMs(read.updatedAt)
  const until = timestampMs(read.validUntil)
  if ((read.updatedAt != null && (updated === null || updated > nowMs))
    || (read.validUntil != null && (until === null || until <= nowMs || (updated !== null && until <= updated)))
    || (requireWindow && (updated === null || until === null))) return "unknown"
  return "available"
}

export function sameFence(value: AssignmentFence, expected: AssignmentFence): boolean {
  return value.work_id === expected.work_id && value.assignment_id === expected.assignment_id
    && value.generation === expected.generation && value.authority_epoch === expected.authority_epoch
}

export function currentAssignment(input: {
  workId: string; generation: number; authorityEpoch: number; currentAssignmentId: string | null
  attempts: HealthRead<readonly AssignmentAttempt[]>; nowMs: number
}): { status: "confirmed" | "none" | "unsupported" | "unknown"; attempt?: AssignmentAttempt } {
  const status = healthReadStatus(input.attempts, input.nowMs)
  if (status !== "available") return { status }
  if (input.currentAssignmentId === null) return { status: "none" }
  const matches = input.attempts.status === "available" ? input.attempts.value.filter((item) => item.id === input.currentAssignmentId) : []
  if (matches.length !== 1) return { status: "unknown" }
  const attempt = matches[0]
  const supportedState = ["admitted", "running", "blocked", "cancelling", "outcome_unknown"].includes(attempt.state)
  if (attempt.work_id !== input.workId || attempt.generation !== input.generation || attempt.authority_epoch !== input.authorityEpoch
    || !Number.isSafeInteger(input.generation) || input.generation < 1 || !Number.isSafeInteger(input.authorityEpoch) || input.authorityEpoch < 1
    || (attempt.role !== undefined && attempt.role !== "executor") || attempt.process_stopped || !supportedState
    || !attempt.runtime?.session_id || !attempt.runtime.run_id) return { status: "unknown" }
  return { status: "confirmed", attempt }
}

export function verifiedObservation(attempt: AssignmentAttempt, read: HealthRead<readonly AssignmentObservation[]> | undefined, nowMs: number): AssignmentObservation | undefined {
  if (healthReadStatus(read, nowMs, true) !== "available" || read?.status !== "available" || !attempt.runtime
    || attempt.work_id === undefined || attempt.generation === undefined || attempt.authority_epoch === undefined) return
  const { work_id, generation, authority_epoch, runtime } = attempt
  const values = read.value.filter((item) => sameFence(item, {
    work_id, assignment_id: attempt.id, generation, authority_epoch,
  }) && item.session_id === runtime.session_id && item.run_id === runtime.run_id)
  // Duplicate/conflicting evidence must be re-read by the parent, not sorted.
  if (values.length !== 1) return
  const value = values[0]
  const updated = timestampMs(read.updatedAt)!
  const eventTimes = [value.heartbeat_at, value.progress?.at, value.terminal?.at].filter((time) => time != null)
  if (eventTimes.some((time) => { const at = timestampMs(time); return at === null || at > updated })) return
  if (value.progress && (!Number.isSafeInteger(value.progress.sequence) || value.progress.sequence < 0 || !value.progress.evidence_ref.trim())) return
  if (value.terminal && !value.terminal.evidence_ref.trim()) return
  return value
}

export function sessionAccess(attempt: AssignmentAttempt, read: HealthRead<readonly SessionAccessRef[]> | undefined, nowMs: number): SessionAccessRef["access"] {
  if (!attempt.runtime || healthReadStatus(read, nowMs) !== "available" || read?.status !== "available") return "unknown"
  const refs = read.value.filter((item) => item.assignment_id === attempt.id && item.session_id === attempt.runtime!.session_id && item.run_id === attempt.runtime!.run_id)
  return refs.length === 1 ? refs[0].access : "unknown"
}

export type RecoveryState = "not_recorded" | "requested" | "acknowledged" | "progress_observed" | "terminal_observed" | "unconfirmed"
export function recoveryState(incident: PatrolIncident, observation: AssignmentObservation | undefined, nowMs: number): RecoveryState {
  const opened = timestampMs(incident.opened_at)
  const requested = timestampMs(incident.recovery?.requested_at)
  const acknowledged = timestampMs(incident.recovery?.acknowledged_at)
  if (opened === null || opened > nowMs || (incident.recovery?.requested_at != null && (requested === null || requested < opened || requested > nowMs))
    || (incident.recovery?.acknowledged_at != null && (acknowledged === null || requested === null || acknowledged < requested || acknowledged > nowMs))) return "unconfirmed"
  const threshold = requested ?? opened
  if (observation && sameFence(incident, observation)) {
    const terminalAt = timestampMs(observation.terminal?.at)
    if (terminalAt !== null && terminalAt >= threshold && terminalAt <= nowMs && observation.terminal?.evidence_ref.trim()) return "terminal_observed"
    const progressAt = timestampMs(observation.progress?.at)
    if (incident.progress_sequence !== null && Number.isSafeInteger(incident.progress_sequence) && incident.progress_sequence >= 0
      && observation.progress && Number.isSafeInteger(observation.progress.sequence) && observation.progress.sequence > incident.progress_sequence
      && progressAt !== null && progressAt > opened && progressAt >= threshold && progressAt <= nowMs && observation.progress.evidence_ref.trim()) return "progress_observed"
  }
  if (incident.phase === "resolved") return "unconfirmed"
  return acknowledged !== null ? "acknowledged" : requested !== null ? "requested" : "not_recorded"
}

export const assignmentHealthCopyKeys = [
  "title", "updatedAt", "available", "unsupported", "unknown", "notRecorded", "staleHint", "currentExecutor", "confirmed", "noCurrentExecutor", "noCurrentHint", "ownerUnknown", "assignment", "work", "generation", "authorityEpoch", "step", "attempt", "session", "run", "role", "executor", "collaborator", "reviewer", "claimedAt", "processStopped", "stoppedConfirmed", "stopUnconfirmed", "heartbeat", "progress", "heartbeatHint", "waitReason", "blockReason", "awaitingRequest", "nextCheck", "endReason", "history", "emptyHistory", "openSession", "sessionDenied", "sessionMissing", "sessionUnknown", "navigationUnavailable", "patrol", "patrolUnsupported", "noIncidents", "incident", "historicalIncident", "sourceRevision", "evidence", "fingerprint", "diagnosisAttempts", "findings", "uncertainty", "escalation", "recovery", "requestedAt", "acknowledgedAt", "recoveryHint", "running", "waiting", "blocked", "open", "diagnosing", "cooldown", "resolved", "requested", "acknowledged", "progress_observed", "terminal_observed", "unconfirmed", "not_recorded",
] as const
export type AssignmentHealthCopy = Record<typeof assignmentHealthCopyKeys[number], string>
