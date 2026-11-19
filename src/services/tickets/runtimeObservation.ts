import { matchesPatrolScope, nonNegativeInteger, object, readPatrol, timestamp, type PatrolReadTarget } from "./patrolRead"

type WaitKind = "user" | "dependency" | "running_tool"

interface RuntimeFacts {
  startedAt: number | null
  heartbeatAt: number | null
  progress: { sequence: number; at: number } | null
  wait: { kind: WaitKind; issuedAt: number; allowanceUntil: number } | null
  outcomeUnknown: boolean
}

export type RuntimeObservationRead =
  | { status: "sample"; facts: RuntimeFacts }
  | { status: "unknown" | "denied" | "unavailable" }

export type RuntimeObservationMode = "active" | "yielded_question" | "outcome_unknown"

interface ObservationTarget extends PatrolReadTarget {
  mode: RuntimeObservationMode
}

function decode(value: unknown, target: ObservationTarget): RuntimeObservationRead {
  const data = object(value)
  const { snapshot } = target
  if (!data || !matchesPatrolScope(data.scope, target) || data.ticket_commit !== snapshot.commit
    || typeof data.execution_outcome_unknown !== "boolean") return { status: "unknown" }

  const { started_at_ms: startedAt, heartbeat_at_ms: heartbeatAt, execution_outcome_unknown: outcomeUnknown } = data
  if ((startedAt !== null && !timestamp(startedAt)) || (heartbeatAt !== null && !timestamp(heartbeatAt))) return { status: "unknown" }

  let progress: RuntimeFacts["progress"] = null
  if (data.progress !== null) {
    const item = object(data.progress)
    if (!item || !timestamp(item.at_ms) || !nonNegativeInteger(item.sequence)
      || item.sequence < 1 || item.sequence > snapshot.seq) return { status: "unknown" }
    progress = { at: item.at_ms, sequence: item.sequence }
  }
  let wait: RuntimeFacts["wait"] = null
  if (data.expected_wait !== null) {
    const item = object(data.expected_wait)
    if (!item || (item.kind !== "user" && item.kind !== "dependency" && item.kind !== "running_tool")
      || !timestamp(item.issued_at_ms) || !timestamp(item.diagnostic_allowance_until_ms)
      || item.diagnostic_allowance_until_ms <= item.issued_at_ms) return { status: "unknown" }
    wait = { kind: item.kind, issuedAt: item.issued_at_ms, allowanceUntil: item.diagnostic_allowance_until_ms }
  }

  const observed = startedAt !== null || heartbeatAt !== null || progress !== null || wait !== null
  if (data.state !== (observed ? "observed" : "unknown") || (outcomeUnknown && observed)
    || startedAt === 0
    || (heartbeatAt !== null && (startedAt === null || heartbeatAt < startedAt))
    || (progress && (startedAt === null || progress.at < startedAt))
    || (target.mode === "yielded_question" && (startedAt !== null || (wait && wait.kind !== "user")))
    || (wait?.kind === "user" && target.mode !== "yielded_question")
    || (target.mode === "outcome_unknown" && !outcomeUnknown)) return { status: "unknown" }
  return { status: "sample", facts: { startedAt, heartbeatAt, progress, wait, outcomeUnknown } }
}

export async function readRuntimeObservation(target: ObservationTarget, signal: AbortSignal): Promise<RuntimeObservationRead> {
  return readPatrol("observation", target, signal, (value) => decode(value, target))
}
