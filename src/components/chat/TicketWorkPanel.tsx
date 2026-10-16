import { uiText, useUiLocale, uiLanguage } from "@shared/i18n/ui"
import { useEffect, useRef, useState } from "react"
import { ticketClient } from "@services/tickets/client"
import { artifactDownloadName } from "@services/tickets/artifactDownload"
import { effectiveStatus, type TicketState } from "@services/tickets/state"
import type { Assignment, AssignmentState, PendingRequest, WorkView } from "@services/tickets/types"
import type { useTicketWork } from "@/hooks/useTicketWork"
import { ticketWorkLabels } from "./ticketWorkLabels"

const requestLabels = { get open() { return uiText("ticket_pending_999a459c") }, get answered() { return uiText("ticket_answered_474c9878") }, get approved() { return uiText("ticket_approved_b42cb548") }, get denied() { return uiText("ticket_denied_f098218a") }, get superseded() { return uiText("ticket_superseded_30474a79") }, get expired() { return uiText("ticket_expired_2fe0e333") }, get consumed() { return uiText("ticket_authorization_used_c8eb44e4") } }
type Controller = ReturnType<typeof useTicketWork>

function RequestCard({ controller, state, request }: { controller: Controller; state: TicketState; request: PendingRequest }) {
  useUiLocale()
  const [answer, setAnswer] = useState("")
  const status = effectiveStatus(state, request)
  const title = state.works[request.work_id]?.ticket.contract.title ?? uiText("supervisor_work_tab")
  const retry = controller.uncertain[request.id]
  const busy = controller.busy[request.id] === true
  const disabled = !controller.canRespond || busy || status !== "open" || !!retry
  const approval = request.kind.kind === "approval" ? request.kind : null
  return <article data-testid={"ticket-request-" + request.id} className="rounded-xl border bg-background p-3 text-sm">
    <div className="flex items-center justify-between gap-2"><strong>{title}</strong><span>{requestLabels[status]}</span></div>
    <div className="mb-2 text-xs text-muted-foreground">{uiText("ticket_request_metadata", { kind: approval ? uiText("approve_8cbe697b") : uiText("ticket_question_33a8618c"), generation: request.generation, revision: request.prompt_revision })}</div>
    <p className="whitespace-pre-wrap break-words">{request.prompt}</p>
    {approval ? <dl className="my-2 grid grid-cols-2 gap-2 text-xs">
      <dt>{uiText("ticket_action_be37d841")}</dt><dd>{approval.action.kind} → {approval.action.target}</dd>
      {approval.action.amount ? <><dt>{uiText("ticket_amount_ffc62430")}</dt><dd>{approval.action.amount}</dd></> : null}
      <dt>{uiText("permission_978cbca6")}</dt><dd>{new Intl.ListFormat(uiLanguage()).format(approval.action.permissions) || uiText("ticket_no_additional_permissions_25c9693a")}</dd>
      <dt>{uiText("ticket_risk_af75e78c")}</dt><dd>{approval.action.risk}</dd>
    </dl> : null}
    {approval ? <details className="my-2 text-xs text-muted-foreground"><summary className="cursor-pointer">{uiText("supervisor_work_submission_diagnostics")}</summary><dl className="mt-1"><dt>{uiText("ticket_data_5440f742")}</dt><dd className="break-all font-mono">{approval.action.data_hash}</dd></dl></details> : null}
    {status === "open" && !approval ? <form className="mt-2 flex gap-2" onSubmit={(event) => {
      event.preventDefault(); if (!answer.trim() || disabled) return
      void controller.respond(request, { kind: "question", answer: answer.trim() }).then((ok) => { if (ok) setAnswer("") })
    }}>
      <input aria-label={uiText("ticket_answer_label", { title })} value={answer} onChange={(event) => setAnswer(event.target.value)} disabled={disabled} className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1" />
      <button type="submit" disabled={disabled || !answer.trim()} className="rounded-md border px-2 py-1 disabled:opacity-50">{busy ? uiText("sending_364970d8") : uiText("ticket_answer_f3f51264")}</button>
    </form> : null}
    {status === "open" && approval ? <div className="mt-2 flex gap-2">
      <button type="button" disabled={disabled} className="rounded-md border px-2 py-1 disabled:opacity-50" onClick={() => void controller.respond(request, { kind: "approval", fingerprint: approval.fingerprint, approve: true })}>{uiText("ticket_approve_this_action_5615724b")}</button>
      <button type="button" disabled={disabled} className="rounded-md border px-2 py-1 disabled:opacity-50" onClick={() => void controller.respond(request, { kind: "approval", fingerprint: approval.fingerprint, approve: false })}>{uiText("deny_136de7a8")}</button>
    </div> : null}
    {retry ? <div className="mt-2 text-muted-foreground"><p>{uiText("ticket_the_previous_send_is_not_confirmed__e67f22cb")}</p><button type="button" disabled={!controller.connected || busy} className="underline disabled:opacity-50" onClick={() => void controller.respond(request, retry.decision)}>{uiText("ticket_confirm_the_outcome_of_this_request_26ab1d31")}</button></div> : null}
    {request.answer ? <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{uiText("ticket_saved__cfe6f505")}{request.answer}</p> : null}
  </article>
}

const executionLabels = {
  planned: "work_execution_planned", dispatch_pending: "work_execution_dispatch_pending",
  admitted: "work_execution_admitted", running: "running_1f0eb99b",
  submitted: "work_execution_submitted", blocked: "ticket_blocked_9059acb4",
  failed: "failed_28384d7a", cancelling: "work_execution_cancelling",
  cancelled: "cancelled_a37778f1", outcome_unknown: "work_execution_unknown",
} as const satisfies Record<AssignmentState, string>

function ExecutionRecord({ view }: { view: WorkView }) {
  const work = view.ticket
  const matchesWork = (item: Pick<Assignment, "work_id" | "generation" | "contract_revision">) => item.work_id === work.id
    && item.generation === work.generation && item.contract_revision === work.contract_revision
  const result = view.submissions.find((submission) => !submission.stale && matchesWork(submission)
    && submission.id === (work.accepted_submission ?? work.current_submission))
  const id = work.active_assignment ?? result?.assignment_id
  const included = view.sections?.includes("assignments") === true && Array.isArray(view.assignments)
  const assignment = included ? view.assignments?.find((item) => item.id === id && matchesWork(item)) : undefined
  const session = typeof assignment?.runtime?.session_id === "string" ? assignment.runtime.session_id.trim() : ""
  return <dl className="my-2 text-xs text-muted-foreground">
    <dt>{uiText("work_execution_session")}</dt>
    <dd className="break-all">{session || uiText(included && !id ? "work_execution_none" : "work_execution_unconfirmed")}</dd>
    {assignment ? <><dt>{uiText("work_execution_record")}</dt><dd>{uiText(Object.hasOwn(executionLabels, assignment.state)
      ? executionLabels[assignment.state] : "work_execution_unknown")}</dd></> : null}
    {assignment?.process_stopped === true ? <dd>{uiText("work_execution_stopped")}</dd> : null}
  </dl>
}

export function TicketWorkPanel({ controller, onReference, selectedWorkId, onShowAll, onReady }: {
  controller: Controller; onReference?: (request: PendingRequest) => void
  selectedWorkId?: string | null; onShowAll?: () => void; onReady?: () => void
}) {
  useUiLocale()
  const state = controller.state
  const ready = useRef(onReady)
  ready.current = onReady
  const hasState = !!state
  useEffect(() => { if (hasState) ready.current?.() }, [hasState])
  const [artifactError, setArtifactError] = useState<string | null>(null)
  if (!state) return null
  const selected = selectedWorkId && !state.works[selectedWorkId]?.ticket.archived ? state.works[selectedWorkId]?.ticket : undefined
  const overview = state.current.scope.overview.data
  const open = Object.values(state.requests).filter((q) => effectiveStatus(state, q) === "open")
  const visibleWorks = Object.values(state.works).filter((view) => !view.ticket.archived)
  const history = Object.values(state.requests).filter((q) => effectiveStatus(state, q) !== "open")
  return <section aria-label={uiText("ticket_work_overview_223a6f34")} data-testid="ticket-work-overview" tabIndex={-1} className="p-4 outline-none">
    {selected && onShowAll ? <button type="button" onClick={onShowAll} className="mb-3 text-xs text-muted-foreground underline">{uiText("supervisor_work_back")}</button> : null}
    <div className="flex items-center justify-between gap-3"><strong>{uiText("ticket_work_overview_223a6f34")}</strong><button type="button" className="text-xs underline" disabled={controller.refreshing} onClick={() => void controller.refresh()}>{uiText("refresh_aee88743")}</button></div>
    <p className="my-2 text-xs text-muted-foreground">{uiText("ticket_work_count", { count: overview.work_count })} · {uiText("ticket_question_count", { count: overview.open_questions })} · {uiText("ticket_approval_count", { count: overview.open_approvals })} · {uiText("ticket_acceptance_count", { count: overview.needs_acceptance })}</p>
    <p className="my-2 text-xs text-muted-foreground">{uiText("supervisor_work_management_scope")}</p>
    {!state.current.complete ? <p role="status" className="text-sm text-muted-foreground">{uiText("ticket_only_some_work_is_shown_other_work_may_still__ee267ea7")}</p> : null}
    {!controller.connected ? <p role="status" className="text-sm text-muted-foreground">{uiText("ticket_the_connection_is_not_confirmed_answers_and_a_aaac8c0d")}</p> : null}
    {!state.current.scope.mutation_enabled || state.current.scope.health !== "writable" ? <p role="status" className="text-sm text-muted-foreground">{uiText(!state.current.scope.mutation_enabled ? "supervisor_work_mutation_disabled" : "ticket_this_ticket_is_read_only__4b7b2251")}</p> : null}
    {!state.current.scope.dispatch_enabled ? <p role="status" className="text-sm text-muted-foreground">{uiText("supervisor_work_dispatch_disabled")}</p> : null}
    {state.current.complete && controller.connected && overview.ticket_count === 0 && visibleWorks.length === 0 ? <p role="status" className="my-2 text-sm text-muted-foreground">{uiText("supervisor_work_empty")}</p> : null}
    {controller.error ? <p role="alert" className="my-2 text-sm text-destructive">{controller.error}</p> : null}
    <div className="grid gap-3">
      {visibleWorks.map((view) => <section key={view.ticket.id} hidden={!!selected && selected.id !== view.ticket.id} className="rounded-xl border bg-background p-3 text-sm">
        <div className="flex justify-between gap-2"><strong className="min-w-0 break-words">{view.ticket.contract.title}</strong><span className="shrink-0 text-xs text-muted-foreground">{ticketWorkLabels[view.ticket.state]}</span></div>
        <p className="mt-1 whitespace-pre-wrap break-words">{view.ticket.contract.objective}</p>
        <ExecutionRecord view={view} />
        {view.ticket.blocked ? <p className="mt-1 text-muted-foreground">{view.ticket.blocked.reason}</p> : null}
        {view.submissions.filter((s) => s.id === view.ticket.accepted_submission || s.id === view.ticket.current_submission).map((submission) => <div key={submission.id} className="mt-2">
          <p>{submission.stale ? uiText("ticket_previous_submission_for_reference_only_8540a39f") : submission.id === view.ticket.accepted_submission ? uiText("ticket_accepted_submission_a269d4af") : uiText("ticket_submitted_awaiting_acceptance_14447588")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{uiText("supervisor_work_result_count", { count: submission.artifacts.length })}</p>
          {submission.artifacts.map((artifact, index) => <button type="button" key={artifact.sha256} style={{ marginRight: "0.5rem" }} className="underline" onClick={() => {
            void ticketClient.artifact(artifact.sha256).then((blob) => {
              const href = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = href; link.download = artifactDownloadName(artifact.sha256, artifact.uri, blob.type); link.click(); URL.revokeObjectURL(href)
            }).catch(() => setArtifactError(uiText("ticket_the_artifact_could_not_be_read_refresh_and_tr_d3969eb3")))
          }}>{uiText("ticket_artifact_label", { number: index + 1 })}</button>)}
          <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">{uiText("supervisor_work_submission_diagnostics")}</summary>
            <p className="mt-1 break-all font-mono">{submission.id}</p>
            {submission.evidence.map((line, index) => <p key={index} className="break-words">{line}</p>)}
          </details>
        </div>)}
        <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">{uiText("supervisor_work_diagnostics")}</summary>
          <p className="mt-1 break-all font-mono">{view.ticket.id}</p>
        </details>
      </section>)}
    </div>
    {artifactError ? <p role="alert">{artifactError}</p> : null}
    {open.length ? <div className="mt-3 grid gap-3">{open.map((request) => <div key={request.id} hidden={!!selected && selected.id !== request.work_id}>
      <RequestCard controller={controller} state={state} request={request} />
      {onReference ? <button type="button" className="mt-1 text-xs underline" onClick={() => onReference(request)}>{uiText("ticket_reference_this_request_in_the_message_box_b3e84d5b")}</button> : null}
    </div>)}</div> : null}
    {history.length ? <details className="mt-3"><summary className="cursor-pointer text-xs">{uiText("ticket_history_label", { count: history.length })}</summary><div className="mt-2 grid gap-3">{history.map((request) => <div key={request.id} hidden={!!selected && selected.id !== request.work_id}><RequestCard controller={controller} state={state} request={request} /></div>)}</div></details> : null}
  </section>
}
