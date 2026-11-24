import { createMemo, For } from "solid-js"
import { createUiText } from "../shell/uiText"
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

export function PatrolStatusSummary(props: { read: PatrolStatusRead; locale?: string }) {
  const uiText = createUiText()
  const checkpoint = () => "checkpoint" in props.read ? props.read.checkpoint : undefined
  const incident = () => checkpoint()?.incident
  const format = createMemo(() => new Intl.DateTimeFormat(props.locale, { dateStyle: "medium", timeStyle: "long" }))
  const time = (at: number | null) => at === null ? uiText("assignment_health_unknown")
    : <time datetime={new Date(at).toISOString()}>{format().format(at)}</time>

  const fields = createMemo(() => {
    const sample = checkpoint()
    const incident = sample?.incident
    const escalation = incident?.escalation
    return sample ? [
      ["patrol_status_last_check", time(sample.lastCheck)],
      ["patrol_status_next_check", time(sample.nextCheck)],
      ...(incident ? [
        ["assignment_health_assignment", <code class="break-all text-xs">{incident.assignmentId}</code>],
        ["patrol_status_incident_sequence", incident.progressSequence],
        ["patrol_status_incident_reason", uiText(reasons[incident.reason])],
        ["patrol_status_incident_phase", uiText(phases[incident.phase])],
        ["assignment_health_diagnosis_attempts", incident.attempts],
        ["patrol_status_last_diagnosis", time(incident.lastDiagnosis)],
      ] as const : []),
      ...(incident?.blockedReason ? [["patrol_status_block_reason", <code>{incident.blockedReason}</code>]] as const : []),
      ...(escalation ? [
        ["assignment_health_escalation", uiText(escalation.queued ? "patrol_status_escalation_queued" : "patrol_status_escalation_unconfirmed")],
        ["patrol_status_escalation_reason", <code>{escalation.reason}</code>],
        ["patrol_status_escalation_attempts", escalation.deliveries],
      ] as const : []),
      ...(escalation && !escalation.queued ? [["patrol_status_escalation_next", time(escalation.nextDelivery)]] as const : []),
    ] as const : []
  })

  return <div class="mt-4 min-w-0 border-t pt-3" data-testid="assignment-patrol">
    <div class="flex flex-wrap items-center gap-2">
      <h5 class="font-medium">{uiText("patrol_status_heading")}</h5>
      <span class="rounded-md border px-2 py-0.5 text-xs" data-testid="patrol-checkpoint-state">{uiText(states[props.read.status])}</span>
    </div>
    <p class="mt-2 text-xs text-muted-foreground">{uiText("patrol_status_hint")}</p>
    {props.read.status === "stale" ? <p class="mt-2 text-xs">{uiText("patrol_status_historical_hint")}</p> : null}
    {checkpoint() ? <dl class="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <For each={fields()}>{([label, value]) => <div class="min-w-0">
        <dt class="text-xs text-muted-foreground">{uiText(label)}</dt>
        <dd class="mt-0.5 min-w-0 break-words [overflow-wrap:anywhere]">{value}</dd>
      </div>}</For>
    </dl> : null}
    {checkpoint() && !incident() && props.read.status === "available" ? <p class="mt-2">{uiText("assignment_health_no_incidents")}</p> : null}
    {incident()?.accountingPending ? <p class="mt-2">{uiText("patrol_status_accounting_pending")}</p> : null}
  </div>
}
