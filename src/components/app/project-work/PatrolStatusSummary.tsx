import { uiText } from "@shared/i18n/ui"
import type { PatrolStatusRead } from "@services/tickets/patrolStatus"

const states = {
  available: "patrol_status_saved", stale: "patrol_status_stale", unknown: "assignment_health_unknown",
  denied: "patrol_status_denied", unavailable: "patrol_status_unavailable", not_checked: "patrol_status_not_checked",
  busy: "patrol_status_busy", corrupt: "patrol_status_corrupt", unsupported: "assignment_health_unsupported",
} as const

const phases = {
  open: "assignment_health_open", diagnosing: "assignment_health_diagnosing", cooldown: "assignment_health_cooldown",
  blocked: "assignment_health_blocked", resolved: "patrol_status_resolved",
} as const

const reasons = {
  no_progress: "patrol_status_no_progress", repeated_errors: "patrol_status_repeated_errors",
  missing_heartbeat: "patrol_status_missing_heartbeat", wait_expired: "patrol_status_wait_expired",
  execution_unknown: "patrol_status_execution_unknown", evidence_unknown: "patrol_status_evidence_unknown",
} as const

export function PatrolStatusSummary({ read, locale }: { read: PatrolStatusRead; locale?: string }) {
  const checkpoint = "checkpoint" in read ? read.checkpoint : undefined
  const incident = checkpoint?.incident
  const escalation = incident?.escalation
  const format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "long" })
  const time = (at: number | null) => at === null ? uiText("assignment_health_unknown")
    : <time dateTime={new Date(at).toISOString()}>{format.format(at)}</time>

  const fields = checkpoint ? [
    ["patrol_status_last_check", time(checkpoint.lastCheck)],
    ["patrol_status_next_check", time(checkpoint.nextCheck)],
    ...(incident ? [
      ["assignment_health_assignment", <code key="assignment" className="break-all text-xs">{incident.assignmentId}</code>],
      ["patrol_status_incident_sequence", incident.progressSequence],
      ["patrol_status_incident_reason", uiText(reasons[incident.reason])],
      ["patrol_status_incident_phase", uiText(phases[incident.phase])],
      ["assignment_health_diagnosis_attempts", incident.attempts],
      ["patrol_status_last_diagnosis", time(incident.lastDiagnosis)],
    ] as const : []),
    ...(incident?.blockedReason ? [["patrol_status_block_reason", <code key="block-reason">{incident.blockedReason}</code>]] as const : []),
    ...(escalation ? [
      ["assignment_health_escalation", uiText(escalation.queued ? "patrol_status_escalation_queued" : "patrol_status_escalation_unconfirmed")],
      ["patrol_status_escalation_reason", <code key="escalation-reason">{escalation.reason}</code>],
      ["patrol_status_escalation_attempts", escalation.deliveries],
    ] as const : []),
    ...(escalation && !escalation.queued ? [["patrol_status_escalation_next", time(escalation.nextDelivery)]] as const : []),
  ] as const : []

  return <div className="mt-4 min-w-0 border-t pt-3" data-testid="assignment-patrol">
    <div className="flex flex-wrap items-center gap-2">
      <h5 className="font-medium">{uiText("patrol_status_heading")}</h5>
      <span className="rounded-md border px-2 py-0.5 text-xs" data-testid="patrol-checkpoint-state">{uiText(states[read.status])}</span>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{uiText("patrol_status_hint")}</p>
    {read.status === "stale" ? <p className="mt-2 text-xs">{uiText("patrol_status_historical_hint")}</p> : null}
    {checkpoint ? <dl className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map(([label, value]) => <div className="min-w-0" key={label}>
        <dt className="text-xs text-muted-foreground">{uiText(label)}</dt>
        <dd className="mt-0.5 min-w-0 break-words [overflow-wrap:anywhere]">{value}</dd>
      </div>)}
    </dl> : null}
    {checkpoint && !incident && read.status === "available" ? <p className="mt-2">{uiText("assignment_health_no_incidents")}</p> : null}
    {incident?.accountingPending ? <p className="mt-2">{uiText("patrol_status_accounting_pending")}</p> : null}
  </div>
}
