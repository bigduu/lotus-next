import { matchesPatrolScope, nonNegativeInteger, object, readPatrol, timestamp, type PatrolReadTarget } from "./patrolRead"

const phases = ["open", "diagnosing", "cooldown", "blocked", "resolved"] as const
const reasons = ["no_progress", "repeated_errors", "missing_heartbeat", "wait_expired", "execution_unknown", "evidence_unknown"] as const

interface SavedIncident {
  assignmentId: string
  progressSequence: number
  reason: typeof reasons[number]
  phase: typeof phases[number]
  attempts: number
  lastDiagnosis: number | null
  blockedReason: string | null
  accountingPending: boolean
  escalation: { reason: string; deliveries: number; queued: boolean; nextDelivery: number } | null
}

interface SavedCheckpoint {
  lastCheck: number
  nextCheck: number
  incident: SavedIncident | null
}

export type PatrolStatusRead =
  | { status: "available" | "stale"; checkpoint: SavedCheckpoint }
  | { status: "unknown" | "denied" | "unavailable" | "not_checked" | "busy" | "corrupt" | "unsupported" }

const enumValue = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === "string" && values.some((item) => item === value)
const reasonCode = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z_]{0,63}$/.test(value)
const counter = (value: unknown): value is number => nonNegativeInteger(value) && value <= 8
const absentStates = ["not_checked", "busy", "corrupt", "unavailable", "unsupported"] as const

function decodeIncident(value: unknown, target: PatrolReadTarget, cursor: number, lastCheck: number): SavedIncident | undefined {
  const item = object(value)
  const identity = object(item?.id)
  const sequence = identity?.progress_sequence
  if (!item || !matchesPatrolScope(identity?.scope, target) || !nonNegativeInteger(sequence) || sequence > cursor
    || !enumValue(item.reason, reasons) || !enumValue(item.phase, phases) || !counter(item.attempts)
    || (item.last_diagnosis_at_ms !== null && (!timestamp(item.last_diagnosis_at_ms) || item.last_diagnosis_at_ms > lastCheck))
    || typeof item.accounting_pending !== "boolean"
    || (item.attempts === 0 && (item.phase === "diagnosing" || item.last_diagnosis_at_ms !== null || item.accounting_pending))) return

  const block = item.blocked_reason
  const budget = object(block)?.budget
  const blockedReason = reasonCode(block) ? block : reasonCode(budget) ? `budget/${budget}` : null
  if (item.phase === "blocked" ? blockedReason === null : block !== null) return

  let escalation: SavedIncident["escalation"] = null
  if (item.escalation !== null) {
    const entry = object(item.escalation)
    const operation = object(entry?.operation)
    const incident = object(operation?.incident)
    if (!entry || operation?.kind !== "escalation" || !matchesPatrolScope(incident?.scope, target)
      || incident?.progress_sequence !== sequence || !reasonCode(entry.reason) || !counter(entry.deliveries)
      || typeof entry.queued !== "boolean" || (entry.queued && entry.deliveries === 0) || !timestamp(entry.next_delivery_ms)) return
    escalation = { reason: entry.reason, deliveries: entry.deliveries, queued: entry.queued, nextDelivery: entry.next_delivery_ms }
  }

  return {
    assignmentId: target.assignmentId, progressSequence: sequence, reason: item.reason, phase: item.phase,
    attempts: item.attempts, lastDiagnosis: item.last_diagnosis_at_ms, blockedReason,
    accountingPending: item.accounting_pending, escalation,
  }
}

function decode(value: unknown, target: PatrolReadTarget): PatrolStatusRead {
  const data = object(value)
  if (!data || !matchesPatrolScope(data.scope, target) || data.ticket_commit !== target.snapshot.commit
    || data.ticket_cursor !== target.snapshot.seq || !nonNegativeInteger(data.execution_facts_revision)
    || data.execution_facts_revision > target.snapshot.seq) return { status: "unknown" }

  if (enumValue(data.state, absentStates) && data.checkpoint === null) return { status: data.state }
  const cp = object(data.checkpoint)
  if (!cp || !nonNegativeInteger(cp.version) || cp.version < 1
    || !nonNegativeInteger(cp.cursor) || cp.cursor > target.snapshot.seq
    || !nonNegativeInteger(cp.source_revision) || cp.source_revision > data.execution_facts_revision
    || !timestamp(cp.last_check_ms) || !timestamp(cp.next_check_ms) || cp.next_check_ms < cp.last_check_ms) return { status: "unknown" }
  const matches = cp.source_revision === data.execution_facts_revision
  const status = matches ? "available" : "stale"
  if (cp.execution_facts_match !== matches || data.state !== status) return { status: "unknown" }

  const incident = cp.incident === null ? null : decodeIncident(cp.incident, target, cp.cursor, cp.last_check_ms)
  if (incident === undefined) return { status: "unknown" }
  return { status, checkpoint: { lastCheck: cp.last_check_ms, nextCheck: cp.next_check_ms, incident } }
}

export function readPatrolStatus(target: PatrolReadTarget, signal: AbortSignal): Promise<PatrolStatusRead> {
  return readPatrol("status", target, signal, (value) => decode(value, target))
}
