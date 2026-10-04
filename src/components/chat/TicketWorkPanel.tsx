import { uiText, useUiLocale, uiLanguage } from "@shared/i18n/ui"
import { useState } from "react"
import { ticketClient } from "@services/tickets/client"
import { artifactDownloadName } from "@services/tickets/artifactDownload"
import { effectiveStatus, type TicketState } from "@services/tickets/state"
import type { PendingRequest, WorkState } from "@services/tickets/types"
import type { useTicketWork } from "@/hooks/useTicketWork"

const labels: Record<WorkState, string> = { get draft() { return uiText("ticket_draft_2a2fd29b") }, get ready() { return uiText("ticket_ready_to_dispatch_918dbc75") }, get active() { return uiText("ticket_in_progress_5026a63b") }, get submitted() { return uiText("ticket_awaiting_acceptance_3aabdf81") }, get accepted() { return uiText("ticket_accepted_2b9fcea2") }, get blocked() { return uiText("ticket_blocked_9059acb4") }, get cancelled() { return uiText("cancelled_a37778f1") } }
const requestLabels = { get open() { return uiText("ticket_pending_999a459c") }, get answered() { return uiText("ticket_answered_474c9878") }, get approved() { return uiText("ticket_approved_b42cb548") }, get denied() { return uiText("ticket_denied_f098218a") }, get superseded() { return uiText("ticket_superseded_30474a79") }, get expired() { return uiText("ticket_expired_2fe0e333") }, get consumed() { return uiText("ticket_authorization_used_c8eb44e4") } }
type Controller = ReturnType<typeof useTicketWork>

function RequestCard({ controller, state, request }: { controller: Controller; state: TicketState; request: PendingRequest }) {
  useUiLocale()
  const [answer, setAnswer] = useState("")
  const status = effectiveStatus(state, request)
  const title = state.works[request.work_id]?.ticket.contract.title ?? request.work_id
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
      <dt>{uiText("ticket_data_5440f742")}</dt><dd className="break-all font-mono">{approval.action.data_hash}</dd>
      <dt>{uiText("permission_978cbca6")}</dt><dd>{new Intl.ListFormat(uiLanguage()).format(approval.action.permissions) || uiText("ticket_no_additional_permissions_25c9693a")}</dd>
      <dt>{uiText("ticket_risk_af75e78c")}</dt><dd>{approval.action.risk}</dd>
    </dl> : null}
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

export function TicketWorkPanel({ controller, onReference }: { controller: Controller; onReference?: (request: PendingRequest) => void }) {
  useUiLocale()
  const state = controller.state
  const [artifactError, setArtifactError] = useState<string | null>(null)
  if (!state) return null
  const overview = state.current.scope.overview.data
  const open = Object.values(state.requests).filter((q) => effectiveStatus(state, q) === "open")
  const history = Object.values(state.requests).filter((q) => effectiveStatus(state, q) !== "open")
  return <aside aria-label={uiText("ticket_work_overview_223a6f34")} data-testid="ticket-work-overview" style={{ maxHeight: "45vh" }} className="mx-4 mb-3 overflow-y-auto rounded-xl border bg-muted/20 p-3">
    <div className="flex items-center justify-between gap-3"><strong>{uiText("ticket_work_overview_223a6f34")}</strong><button type="button" className="text-xs underline" onClick={() => void controller.refresh()}>{uiText("refresh_aee88743")}</button></div>
    <p className="my-2 text-xs text-muted-foreground">{uiText("ticket_work_count", { count: overview.work_count })} · {uiText("ticket_question_count", { count: overview.open_questions })} · {uiText("ticket_approval_count", { count: overview.open_approvals })} · {uiText("ticket_acceptance_count", { count: overview.needs_acceptance })}</p>
    {!state.current.complete ? <p role="status" className="text-sm text-muted-foreground">{uiText("ticket_only_some_work_is_shown_other_work_may_still__ee267ea7")}</p> : null}
    {!controller.connected ? <p role="status" className="text-sm text-muted-foreground">{uiText("ticket_the_connection_is_not_confirmed_answers_and_a_aaac8c0d")}</p> : null}
    {!state.current.scope.mutation_enabled || state.current.scope.health !== "writable" ? <p className="text-sm text-muted-foreground">{uiText("ticket_this_ticket_is_read_only__4b7b2251")}</p> : null}
    {controller.error ? <p role="alert" className="my-2 text-sm text-destructive">{controller.error}</p> : null}
    <div className="grid gap-2 sm:grid-cols-2">
      {Object.values(state.works).filter((v) => !v.ticket.archived).map((view) => <section key={view.ticket.id} className="rounded-lg border p-2 text-xs">
        <div className="flex justify-between gap-2"><strong>{view.ticket.contract.title}</strong><span>{labels[view.ticket.state]}</span></div>
        <p className="mt-1 break-words text-muted-foreground">{view.ticket.contract.objective}</p>
        {view.ticket.blocked ? <p className="mt-1 text-muted-foreground">{view.ticket.blocked.reason}</p> : null}
        {view.submissions.filter((s) => s.id === view.ticket.accepted_submission || s.id === view.ticket.current_submission).map((submission) => <div key={submission.id} className="mt-2">
          <p>{submission.stale ? uiText("ticket_previous_submission_for_reference_only_8540a39f") : submission.id === view.ticket.accepted_submission ? uiText("ticket_accepted_submission_a269d4af") : uiText("ticket_submitted_awaiting_acceptance_14447588")}</p>
          {submission.evidence.map((line, index) => <p key={index} className="break-words">{line}</p>)}
          {submission.artifacts.map((artifact, index) => <button type="button" key={artifact.sha256} style={{ marginRight: "0.5rem" }} className="underline" onClick={() => {
            void ticketClient.artifact(artifact.sha256).then((blob) => {
              const href = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = href; link.download = artifactDownloadName(artifact.sha256, artifact.uri, blob.type); link.click(); URL.revokeObjectURL(href)
            }).catch(() => setArtifactError(uiText("ticket_the_artifact_could_not_be_read_refresh_and_tr_d3969eb3")))
          }}>{uiText("ticket_artifact_label", { number: index + 1 })}</button>)}
        </div>)}
      </section>)}
    </div>
    {artifactError ? <p role="alert">{artifactError}</p> : null}
    {open.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{open.map((request) => <div key={request.id}>
      <RequestCard controller={controller} state={state} request={request} />
      {onReference ? <button type="button" className="mt-1 text-xs underline" onClick={() => onReference(request)}>{uiText("ticket_reference_this_request_in_the_message_box_b3e84d5b")}</button> : null}
    </div>)}</div> : null}
    {history.length ? <details className="mt-3"><summary className="cursor-pointer text-xs">{uiText("ticket_history_label", { count: history.length })}</summary><div className="mt-2 grid gap-2 sm:grid-cols-2">{history.map((request) => <RequestCard key={request.id} controller={controller} state={state} request={request} />)}</div></details> : null}
  </aside>
}
