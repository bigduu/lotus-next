import { useId, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  currentAssignment, healthReadStatus, recoveryState, sameFence, sessionAccess, timestampMs, verifiedObservation,
  type AssignmentAttempt, type AssignmentHealthCopy, type AssignmentObservation, type HealthRead, type PatrolIncident, type SessionAccessRef,
} from "./assignmentHealth"

export interface AssignmentHealthPanelProps {
  workId: string
  generation: number
  authorityEpoch: number
  currentAssignmentId: string | null
  attempts: HealthRead<readonly AssignmentAttempt[]>
  observations?: HealthRead<readonly AssignmentObservation[]>
  incidents?: HealthRead<readonly PatrolIncident[]>
  sessions?: HealthRead<readonly SessionAccessRef[]>
  blockReason?: string | null
  nowMs: number
  locale?: string
  copy: AssignmentHealthCopy
  onOpenSession?: (exactSessionId: string) => void
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{children}</dd></div>
}

export function AssignmentHealthPanel(props: AssignmentHealthPanelProps) {
  const { copy, nowMs, locale, workId } = props
  const titleId = useId()
  const scopeMismatch = props.attempts.status === "available" && props.attempts.value.some((item) => item.work_id !== undefined && item.work_id !== workId)
  const attemptRead: AssignmentHealthPanelProps["attempts"] = scopeMismatch ? { status: "unknown", updatedAt: props.attempts.updatedAt } : props.attempts
  const owner = currentAssignment({ ...props, attempts: attemptRead })
  const status = healthReadStatus(attemptRead, nowMs)
  const attempts = props.attempts.status === "available" ? props.attempts.value.filter((item) => item.work_id === undefined || item.work_id === workId) : []
  const observation = owner.attempt ? verifiedObservation(owner.attempt, props.observations, nowMs) : undefined
  const history = attempts.filter((item) => item !== owner.attempt)
  const incidentScopeMismatch = props.incidents?.status === "available" && props.incidents.value.some((item) => item.work_id !== workId)
  const incidentStatus = incidentScopeMismatch ? "unknown" : healthReadStatus(props.incidents, nowMs, true)
  const incidents = props.incidents?.status === "available" ? props.incidents.value.filter((item) => item.work_id === workId) : []
  const incidentCounts = new Map<string, number>()
  for (const incident of incidents) incidentCounts.set(incident.id, (incidentCounts.get(incident.id) ?? 0) + 1)

  const time = (value: string | null | undefined) => {
    const at = timestampMs(value)
    return at === null ? <span className="text-muted-foreground">{copy.notRecorded}</span>
      : <time dateTime={value!}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "long" }).format(at)}</time>
  }
  const identifier = (value: string | null | undefined) => value ? <code className="break-all text-xs">{value}</code> : <span className="text-muted-foreground">{copy.notRecorded}</span>
  const session = (attempt: AssignmentAttempt) => {
    const access = sessionAccess(attempt, props.sessions, nowMs)
    const canOpen = access === "accessible" && props.onOpenSession && attempt.runtime?.session_id
    const reason = access === "denied" ? copy.sessionDenied : access === "missing" ? copy.sessionMissing : access === "accessible" ? copy.navigationUnavailable : copy.sessionUnknown
    return <div className="min-w-0 space-y-1">
      {identifier(attempt.runtime?.session_id)}
      {canOpen ? <Button type="button" size="sm" variant="outline" className="ml-2 h-auto max-w-full whitespace-normal text-left" onClick={() => props.onOpenSession!(attempt.runtime!.session_id)}>{copy.openSession}</Button>
        : <p className="text-xs text-muted-foreground">{reason}</p>}
    </div>
  }
  const attemptFacts = (attempt: AssignmentAttempt) => <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
    <Fact label={copy.assignment}>{identifier(attempt.id)}</Fact>
    <Fact label={copy.role}>{copy[attempt.role ?? "executor"]}</Fact>
    <Fact label={copy.generation}>{Number.isSafeInteger(attempt.generation) ? attempt.generation : copy.notRecorded}</Fact>
    <Fact label={copy.authorityEpoch}>{Number.isSafeInteger(attempt.authority_epoch) ? attempt.authority_epoch : copy.notRecorded}</Fact>
    {attempt.step_id ? <Fact label={copy.step}>{identifier(attempt.step_id)}</Fact> : null}
    <Fact label={copy.attempt}>{identifier(attempt.attempt_id)}</Fact>
    <Fact label={copy.session}>{session(attempt)}</Fact>
    <Fact label={copy.run}>{identifier(attempt.runtime?.run_id)}</Fact>
    <Fact label={copy.claimedAt}>{time(attempt.claimed_at)}</Fact>
    <Fact label={copy.processStopped}>{attempt.process_stopped === true ? copy.stoppedConfirmed : copy.stopUnconfirmed}</Fact>
    <Fact label={copy.endReason}>{attempt.end_reason || copy.notRecorded}</Fact>
    {attempt.awaiting_request ? <Fact label={copy.awaitingRequest}>{identifier(attempt.awaiting_request)}</Fact> : null}
  </dl>
  let execution: "unknown" | AssignmentObservation["execution"] | "terminal_observed" = "unknown"
  if (observation && owner.attempt && !["cancelling", "outcome_unknown"].includes(owner.attempt.state)) {
    execution = observation.terminal ? "terminal_observed" : observation.execution === "running" && owner.attempt.state !== "running" ? "unknown" : observation.execution
  }

  return <section aria-labelledby={titleId} className="min-w-0 rounded-xl border bg-background p-4 text-sm" data-testid="assignment-health-panel">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h4 id={titleId} className="font-semibold">{copy.title}</h4>
      <span className="rounded-md border px-2 py-0.5 text-xs" data-testid="assignment-source-status">{copy[status]}</span>
    </div>
    <p className="mt-1 break-words text-xs text-muted-foreground">{copy.updatedAt}: {time(props.attempts.updatedAt)}</p>
    {status !== "available" ? <p role="status" className="mt-2 break-words">{props.attempts.status !== "available" && props.attempts.reason ? props.attempts.reason : copy.staleHint}</p> : null}

    <div className="mt-4 min-w-0" data-testid="assignment-current">
      <div className="mb-3 flex flex-wrap items-center gap-2"><h5 className="font-medium">{copy.currentExecutor}</h5><span className="rounded-md bg-muted px-2 py-0.5 text-xs" data-testid="assignment-owner-status">{owner.status === "confirmed" ? copy.confirmed : owner.status === "none" ? copy.noCurrentExecutor : copy.ownerUnknown}</span></div>
      {owner.status === "none" ? <p className="mb-3 text-xs text-muted-foreground">{copy.noCurrentHint}</p> : null}
      {owner.attempt ? attemptFacts(owner.attempt) : props.currentAssignmentId ? <dl><Fact label={copy.assignment}>{identifier(props.currentAssignmentId)}</Fact></dl> : null}
      <div className="mt-3 rounded-lg bg-muted/40 p-3" data-testid="assignment-observation">
        <p className="mb-2 font-medium" data-testid="assignment-execution-status">{copy[execution]}</p>
        <p className="mb-3 text-xs text-muted-foreground">{copy.updatedAt}: {time(observation ? props.observations?.updatedAt : null)}</p>
        <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <Fact label={copy.heartbeat}>{time(observation?.heartbeat_at)}</Fact>
          <Fact label={copy.progress}>{time(observation?.progress?.at)}</Fact>
          <Fact label={copy.waitReason}>{observation?.wait_reason || copy.notRecorded}</Fact>
          <Fact label={copy.blockReason}>{props.blockReason || observation?.block_reason || copy.notRecorded}</Fact>
          <Fact label={copy.nextCheck}>{time(observation?.next_check_at)}</Fact>
          {observation?.progress ? <Fact label={copy.evidence}>{identifier(observation.progress.evidence_ref)}</Fact> : null}
          {observation?.terminal ? <><Fact label={copy.terminal_observed}>{observation.terminal.state}</Fact><Fact label={copy.evidence}>{identifier(observation.terminal.evidence_ref)}</Fact></> : null}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">{copy.heartbeatHint}</p>
        {healthReadStatus(props.observations, nowMs, true) !== "available" ? <p className="mt-1 text-xs" data-testid="assignment-observation-status">{copy[healthReadStatus(props.observations, nowMs, true)]}</p> : null}
      </div>
    </div>

    <details className="mt-4 min-w-0 rounded-lg border p-3" data-testid="assignment-history">
      <summary className="cursor-pointer font-medium">{copy.history} ({history.length})</summary>
      {history.length ? <ul className="mt-3 grid min-w-0 gap-3">{history.map((attempt, index) => <li key={`${attempt.id}:${index}`} className="min-w-0 rounded-lg bg-muted/30 p-3">{attemptFacts(attempt)}</li>)}</ul>
        : <p className="mt-2 text-muted-foreground">{status === "available" ? copy.emptyHistory : copy[status]}</p>}
    </details>

    <div className="mt-4 min-w-0 border-t pt-3" data-testid="assignment-patrol">
      <div className="flex flex-wrap items-center gap-2"><h5 className="font-medium">{copy.patrol}</h5><span className="rounded-md border px-2 py-0.5 text-xs">{copy[incidentStatus]}</span></div>
      <p className="mt-1 text-xs text-muted-foreground">{copy.updatedAt}: {time(props.incidents?.updatedAt)}</p>
      {incidentStatus === "unsupported" ? <p className="mt-2">{copy.patrolUnsupported}</p> : incidentStatus === "unknown" ? <p className="mt-2">{copy.staleHint}</p> : !incidents.length ? <p className="mt-2">{copy.noIncidents}</p> : null}
      {props.incidents?.status !== "available" && props.incidents?.reason ? <p className="mt-1 text-xs text-muted-foreground">{props.incidents.reason}</p> : null}
      <ul className="mt-3 grid min-w-0 gap-3">{incidents.map((incident, index) => {
        const isCurrent = owner.attempt && sameFence(incident, { work_id: workId, assignment_id: owner.attempt.id, generation: props.generation, authority_epoch: props.authorityEpoch })
        const trustworthy = isCurrent && incidentStatus === "available" && incidentCounts.get(incident.id) === 1
        const recovery = trustworthy ? recoveryState(incident, observation, nowMs) : "unconfirmed"
        const resolutionProven = recovery === "progress_observed" || recovery === "terminal_observed"
        const phase = !trustworthy || (incident.phase === "resolved" && !resolutionProven) ? "unconfirmed" : incident.phase
        return <li key={`${incident.id}:${index}`} className="min-w-0 rounded-lg border p-3" data-testid="assignment-incident">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h6 className="font-medium">{isCurrent ? copy.incident : copy.historicalIncident}</h6><span className="rounded-md bg-muted px-2 py-0.5 text-xs" data-testid="assignment-incident-phase">{copy[phase]}</span></div>
          <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <Fact label={copy.incident}>{identifier(incident.id)}</Fact>
            <Fact label={copy.work}>{identifier(incident.work_id)}</Fact>
            <Fact label={copy.assignment}>{identifier(incident.assignment_id)}</Fact>
            <Fact label={copy.generation}>{incident.generation}</Fact>
            <Fact label={copy.authorityEpoch}>{incident.authority_epoch}</Fact>
            <Fact label={copy.fingerprint}>{identifier(incident.fingerprint)}</Fact>
            <Fact label={copy.sourceRevision}>{identifier(incident.source_revision)}</Fact>
            <Fact label={copy.evidence}>{identifier(incident.evidence_ref)}</Fact>
            <Fact label={copy.blockReason}>{incident.reason}</Fact>
            <Fact label={copy.diagnosisAttempts}>{Number.isSafeInteger(incident.attempts) && incident.attempts! >= 0 ? incident.attempts : copy.notRecorded}</Fact>
            <Fact label={copy.findings}>{incident.findings || copy.notRecorded}</Fact>
            <Fact label={copy.uncertainty}>{incident.uncertainty || copy.notRecorded}</Fact>
            <Fact label={copy.escalation}>{incident.escalation || copy.notRecorded}</Fact>
            <Fact label={copy.nextCheck}>{time(incident.next_check_at)}</Fact>
            <Fact label={copy.recovery}><span data-testid="assignment-recovery-status">{copy[recovery]}</span></Fact>
            <Fact label={copy.requestedAt}>{time(incident.recovery?.requested_at)}</Fact>
            <Fact label={copy.acknowledgedAt}>{time(incident.recovery?.acknowledged_at)}</Fact>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{copy.recoveryHint}</p>
        </li>
      })}</ul>
    </div>
  </section>
}
