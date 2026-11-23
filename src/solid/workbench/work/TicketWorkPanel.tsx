import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { getErrorMessage } from "@services/api"
import { ticketClient } from "@services/tickets/client"
import { artifactDownloadName } from "@services/tickets/artifactDownload"
import { effectiveStatus, type TicketState } from "@services/tickets/state"
import type { AssignmentState, IngressPreview, PendingIngressMessage, PendingRequest, ScopeBinding, WorkView } from "@services/tickets/types"
import { ticketWorkStatusLabel, workExecutionRecord } from "@services/tickets/ticketWorkLabels"
import { createUiLocale, createUiText } from "../../shell/uiText"
import type { TicketWorkController } from "./createTicketWork"

const requestLabels = {
  open: "ticket_pending_999a459c", answered: "ticket_answered_474c9878", approved: "ticket_approved_b42cb548",
  denied: "ticket_denied_f098218a", superseded: "ticket_superseded_30474a79", expired: "ticket_expired_2fe0e333",
  consumed: "ticket_authorization_used_c8eb44e4",
} as const

function RequestCard(props: { controller: TicketWorkController; state: TicketState; request: PendingRequest }) {
  const text = createUiText()
  const locale = createUiLocale()
  const answer = () => props.controller.answerDraft(props.request)
  const setAnswer = (value: string) => props.controller.setAnswerDraft(props.request, value)
  const status = () => effectiveStatus(props.state, props.request)
  const title = () => props.state.works[props.request.work_id]?.ticket.contract.title ?? text("supervisor_work_tab")
  const retry = () => props.controller.uncertain[props.request.id]
  const busy = () => props.controller.busy[props.request.id] === true
  const disabled = () => !props.controller.canRespond || busy() || status() !== "open" || !!retry()
  const approval = createMemo(() => props.request.kind.kind === "approval" ? props.request.kind : null)
  return <article data-testid={"ticket-request-" + props.request.id} class="rounded-xl border bg-background p-3 text-sm">
    <div class="flex items-center justify-between gap-2"><strong>{title()}</strong><span>{text(requestLabels[status()])}</span></div>
    <div class="mb-2 text-xs text-muted-foreground">{text("ticket_request_metadata", { kind: approval() ? text("approve_8cbe697b") : text("ticket_question_33a8618c"), generation: props.request.generation, revision: props.request.prompt_revision })}</div>
    <p class="whitespace-pre-wrap break-words">{props.request.prompt}</p>

    <Show when={approval()}>{(detail) => <>
      <dl class="my-2 grid grid-cols-2 gap-2 text-xs">
        <dt>{text("ticket_action_be37d841")}</dt><dd>{detail().action.kind} → {detail().action.target}</dd>
        <Show when={detail().action.amount}><dt>{text("ticket_amount_ffc62430")}</dt><dd>{detail().action.amount}</dd></Show>
        <dt>{text("permission_978cbca6")}</dt><dd>{new Intl.ListFormat(locale()).format(detail().action.permissions) || text("ticket_no_additional_permissions_25c9693a")}</dd>
        <dt>{text("ticket_risk_af75e78c")}</dt><dd>{detail().action.risk}</dd>
      </dl>
      <details class="my-2 text-xs text-muted-foreground">
        <summary class="cursor-pointer">{text("supervisor_work_submission_diagnostics")}</summary>
        <dl class="mt-1"><dt>{text("ticket_data_5440f742")}</dt><dd class="break-all font-mono">{detail().action.data_hash}</dd></dl>
      </details>
      <Show when={status() === "open"}>
        <div class="mt-2 flex gap-2">
          <button type="button" disabled={disabled()} class="rounded-md border px-2 py-1 disabled:opacity-50" onClick={() => void props.controller.respond(props.request, { kind: "approval", fingerprint: detail().fingerprint, approve: true })}>{text("ticket_approve_this_action_5615724b")}</button>
          <button type="button" disabled={disabled()} class="rounded-md border px-2 py-1 disabled:opacity-50" onClick={() => void props.controller.respond(props.request, { kind: "approval", fingerprint: detail().fingerprint, approve: false })}>{text("deny_136de7a8")}</button>
        </div>
      </Show>
    </>}</Show>

    <Show when={status() === "open" && !approval()}>
      <form class="mt-2 flex gap-2" onSubmit={(event) => {
        event.preventDefault()
        const request = props.request
        const value = answer().trim()
        if (!value || disabled()) return
        void props.controller.respond(request, { kind: "question", answer: value }).then((ok) => {
          if (ok) props.controller.setAnswerDraft(request, "")
        })
      }}>
        <input aria-label={text("ticket_answer_label", { title: title() })} value={answer()} onInput={(event) => setAnswer(event.currentTarget.value)} disabled={disabled()} class="min-w-0 flex-1 rounded-md border bg-background px-2 py-1" />
        <button type="submit" disabled={disabled() || !answer().trim()} class="rounded-md border px-2 py-1 disabled:opacity-50">{text(busy() ? "sending_364970d8" : "ticket_answer_f3f51264")}</button>
      </form>
    </Show>
    <Show when={retry()}>{(command) =>
      <div class="mt-2 text-muted-foreground">
        <p>{text("ticket_the_previous_send_is_not_confirmed__e67f22cb")}</p>
        <button type="button" disabled={!props.controller.canRespond || busy()} class="underline disabled:opacity-50" onClick={() => void props.controller.respond(props.request, command().decision)}>{text("ticket_confirm_the_outcome_of_this_request_26ab1d31")}</button>
      </div>
    }</Show>
    <Show when={props.request.answer}><p class="mt-2 whitespace-pre-wrap text-muted-foreground">{text("ticket_saved__cfe6f505")}{props.request.answer}</p></Show>
  </article>
}

const executionLabels = {
  planned: "work_execution_planned", dispatch_pending: "work_execution_dispatch_pending",
  admitted: "work_execution_admitted", running: "running_1f0eb99b",
  submitted: "work_execution_submitted", blocked: "ticket_blocked_9059acb4",
  failed: "failed_28384d7a", cancelling: "work_execution_cancelling",
  cancelled: "cancelled_a37778f1", outcome_unknown: "work_execution_unknown",
} as const satisfies Record<AssignmentState, string>

function ExecutionRecord(props: { view: WorkView }) {
  const text = createUiText()
  const record = createMemo(() => workExecutionRecord(props.view))
  const session = () => {
    const value = record().assignment?.runtime?.session_id
    return typeof value === "string" ? value.trim() : ""
  }
  return <dl class="my-2 text-xs text-muted-foreground">
    <dt>{text("work_execution_session")}</dt>
    <dd class="break-all">{session() || text(record().included && !record().id ? "work_execution_none" : "work_execution_unconfirmed")}</dd>
    <Show when={record().assignment}>{(assignment) => <>
      <dt>{text("work_execution_record")}</dt>
      <dd>{text(Object.hasOwn(executionLabels, assignment().state) ? executionLabels[assignment().state] : "work_execution_unknown")}</dd>
    </>}</Show>
    <Show when={record().assignment?.process_stopped === true}><dd>{text("work_execution_stopped")}</dd></Show>
  </dl>
}

function IngressReview(props: { binding: ScopeBinding; oldest: PendingIngressMessage; controller: TicketWorkController }) {
  const text = createUiText()
  const [message, setMessage] = createSignal<IngressPreview | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [dismissed, setDismissed] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let active = true
  onSettled(() => () => { active = false })

  async function review() {
    if (!props.controller.connected || busy()) return
    setBusy(true)
    setError(null)
    try {
      const preview = await ticketClient.inspectIngress(props.oldest.message_id)
      if (active && props.controller.connected && preview.message_id === props.oldest.message_id) setMessage(preview)
    } catch (failure) {
      if (active) setError(getErrorMessage(failure))
    } finally {
      if (active) setBusy(false)
    }
  }

  async function dismiss() {
    const current = message()
    if (!current || !props.controller.canSendIngress || current.proposal_saved || props.oldest.proposal_saved || busy() || dismissed()) return
    if (current.message_id !== props.oldest.message_id) return
    setBusy(true)
    setError(null)
    try {
      await ticketClient.dismissIngress(props.binding, current.message_id)
      if (active) setDismissed(true)
    } catch (failure) {
      if (active) setError(getErrorMessage(failure))
    } finally {
      if (active) await props.controller.refresh()
      if (active) setBusy(false)
    }
  }

  return <div class="mt-2 text-sm">
    <Show when={message()} fallback={
      <button type="button" class="underline disabled:opacity-50" disabled={!props.controller.connected || busy()} onClick={() => void review()}>
        {text("supervisor_work_ingress_review")}
      </button>
    }>{(preview) => <>
      <p class="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2">{preview().text}</p>
      <code class="my-1 block break-all text-xs text-muted-foreground">{preview().message_id}</code>
      <Show when={props.oldest.proposal_saved || preview().proposal_saved} fallback={
        <button type="button" class="underline disabled:opacity-50" disabled={!props.controller.canSendIngress || busy() || dismissed()} onClick={() => void dismiss()}>
          {text(dismissed() ? "supervisor_work_ingress_marked" : "supervisor_work_ingress_mark_chat")}
        </button>
      }><p class="text-muted-foreground">{text("supervisor_work_ingress_saved_proposal")}</p></Show>
    </>}</Show>
    <Show when={error()}><p role="alert" class="mt-1 text-destructive">{error()}</p></Show>
  </div>
}

interface TicketWorkPanelProps {
  controller: TicketWorkController
  onReference?: (request: PendingRequest) => void
  selectedWorkId?: string | null
  onShowAll?: () => void
  onReady?: () => void
}

export function TicketWorkPanel(props: TicketWorkPanelProps) {
  const bindingKey = createMemo(() => {
    const binding = props.controller.state?.current.scope.binding
    return binding ? JSON.stringify([binding.supervisor_session_id, binding.scope_id, binding.binding_revision]) : null
  })
  createEffect(() => !!bindingKey(), (hasState) => { if (hasState) props.onReady?.() })
  return <Show when={bindingKey()} keyed>
    <Show when={props.controller.state}>{(state) =>
      <WorkOverview state={state()} controller={props.controller} onReference={props.onReference} selectedWorkId={props.selectedWorkId} onShowAll={props.onShowAll} />
    }</Show>
  </Show>
}

function WorkOverview(props: TicketWorkPanelProps & { state: TicketState }) {
  const text = createUiText()
  const locale = createUiLocale()
  const [artifactError, setArtifactError] = createSignal<string | null>(null)
  const binding = () => props.state.current.scope.binding
  const scope = () => props.state.current.scope
  const overview = () => scope().overview.data
  const pending = () => overview().pending_ingress
  const oldestKey = () => pending()?.oldest?.message_id ?? null
  const selected = () => {
    const id = props.selectedWorkId
    const selectedTicket = id ? props.state.works[id]?.ticket : undefined
    return selectedTicket?.archived ? undefined : selectedTicket
  }
  const open = createMemo(() => Object.values(props.state.requests).filter((request) => effectiveStatus(props.state, request) === "open"))
  const history = createMemo(() => Object.values(props.state.requests).filter((request) => effectiveStatus(props.state, request) !== "open"))
  const works = createMemo(() => Object.values(props.state.works).filter((view) => !view.ticket.archived))
  let active = true
  onSettled(() => () => { active = false })

  const isHidden = (workId: string) => !!selected() && selected()?.id !== workId
  const statusLabel = (view: WorkView) => { locale(); return ticketWorkStatusLabel(view) }

  async function downloadArtifact(hash: string, uri: string) {
    try {
      const blob = await ticketClient.artifact(hash)
      if (!active) return
      const href = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = href
      link.download = artifactDownloadName(hash, uri, blob.type)
      link.click()
      URL.revokeObjectURL(href)
    } catch {
      if (active) setArtifactError(text("ticket_the_artifact_could_not_be_read_refresh_and_tr_d3969eb3"))
    }
  }

  return <section aria-label={text("ticket_work_overview_223a6f34")} data-testid="ticket-work-overview" tabindex={-1} class="w-full min-w-0 overflow-y-auto p-4 outline-none">
    <Show when={selected() && props.onShowAll}>
      <button type="button" onClick={() => props.onShowAll?.()} class="mb-3 text-xs text-muted-foreground underline">{text("supervisor_work_back")}</button>
    </Show>
    <div class="flex items-center justify-between gap-3">
      <strong>{text("ticket_work_overview_223a6f34")}</strong>
      <button type="button" class="text-xs underline" disabled={props.controller.refreshing} onClick={() => void props.controller.refresh()}>{text("refresh_aee88743")}</button>
    </div>
    <p class="my-2 text-xs text-muted-foreground">{text("ticket_work_count", { count: overview().work_count })} · {text("ticket_question_count", { count: overview().open_questions })} · {text("ticket_approval_count", { count: overview().open_approvals })} · {text("ticket_acceptance_count", { count: overview().needs_acceptance })}</p>
    <p class="my-2 text-xs text-muted-foreground">{text("supervisor_work_management_scope")}</p>
    <Show when={!props.state.current.complete}><p role="status" class="text-sm text-muted-foreground">{text("ticket_only_some_work_is_shown_other_work_may_still__ee267ea7")}</p></Show>
    <Show when={!props.controller.connected}><p role="status" class="text-sm text-muted-foreground">{text("ticket_the_connection_is_not_confirmed_answers_and_a_aaac8c0d")}</p></Show>
    <Show when={!scope().mutation_enabled}><p role="status" class="text-sm text-muted-foreground">{text("supervisor_work_mutation_disabled")}</p></Show>
    <Show when={scope().health !== "writable"}><p role="status" class="text-sm text-muted-foreground">{text(scope().health === "read_only" ? "supervisor_work_storage_read_only" : "supervisor_work_storage_unconfirmed")}</p></Show>
    <Show when={!scope().dispatch_enabled}><p role="status" class="text-sm text-muted-foreground">{text("supervisor_work_dispatch_disabled")}</p></Show>
    <Show when={(pending()?.count ?? 0) > 0}>
      <div class="my-3 rounded-lg border bg-background p-3">
        <p role="status" class="text-sm">{text("supervisor_work_pending_ingress", { count: pending()?.count })}</p>
        <Show when={oldestKey()} keyed>
          <Show when={pending()?.oldest}>{(oldest) => <IngressReview binding={binding()} oldest={oldest()} controller={props.controller} />}</Show>
        </Show>
      </div>
    </Show>
    <Show when={props.state.current.complete && props.controller.connected && overview().ticket_count === 0 && works().length === 0}>
      <p role="status" class="my-2 text-sm text-muted-foreground">{text("supervisor_work_empty")}</p>
    </Show>
    <Show when={props.controller.error}><p role="alert" class="my-2 text-sm text-destructive">{props.controller.error}</p></Show>
    <div class="grid gap-3">
      <For each={works()} keyed={(view) => view.ticket.id}>{(view) => (
        <section data-testid={"ticket-work-" + view().ticket.id} hidden={isHidden(view().ticket.id)} class="rounded-xl border bg-background p-3 text-sm">
          <div class="flex justify-between gap-2"><strong class="min-w-0 break-words">{view().ticket.contract.title}</strong><span class="shrink-0 text-xs text-muted-foreground">{statusLabel(view())}</span></div>
          <p class="mt-1 whitespace-pre-wrap break-words">{view().ticket.contract.objective}</p>
          <ExecutionRecord view={view()} />
          <Show when={view().ticket.blocked}><p class="mt-1 text-muted-foreground">{view().ticket.blocked?.reason}</p></Show>
          <For each={view().submissions.filter((submission) => submission.id === view().ticket.accepted_submission || submission.id === view().ticket.current_submission)} keyed={(submission) => submission.id}>{(submission) =>
            <div class="mt-2">
              <p>{text(submission().stale ? "ticket_previous_submission_for_reference_only_8540a39f" : submission().id === view().ticket.accepted_submission ? "ticket_accepted_submission_a269d4af" : "ticket_submitted_awaiting_acceptance_14447588")}</p>
              <p class="mt-1 text-xs text-muted-foreground">{text("supervisor_work_result_count", { count: submission().artifacts.length })}</p>
              <For each={submission().artifacts} keyed={(artifact) => artifact.sha256}>{(artifact, index) =>
                <button type="button" class="mr-2 underline" onClick={() => void downloadArtifact(artifact().sha256, artifact().uri)}>
                  {text("ticket_artifact_label", { number: index() + 1 })}
                </button>
              }</For>
              <details class="mt-2 text-xs text-muted-foreground">
                <summary class="cursor-pointer">{text("supervisor_work_submission_diagnostics")}</summary>
                <p class="mt-1 break-all font-mono">{submission().id}</p>
                <For each={submission().evidence} keyed={false}>{(line) => <p class="break-words">{line()}</p>}</For>
              </details>
            </div>
          }</For>
          <details class="mt-2 text-xs text-muted-foreground">
            <summary class="cursor-pointer">{text("supervisor_work_diagnostics")}</summary>
            <p class="mt-1 break-all font-mono">{view().ticket.id}</p>
          </details>
        </section>
      )}</For>
    </div>
    <Show when={artifactError()}><p role="alert">{artifactError()}</p></Show>
    <Show when={open().length > 0}>
      <div class="mt-3 grid gap-3">
        <For each={open()} keyed={(request) => request.id}>{(request) =>
          <div hidden={isHidden(request().work_id)}>
            <RequestCard controller={props.controller} state={props.state} request={request()} />
            <Show when={props.onReference}><button type="button" class="mt-1 text-xs underline" onClick={() => props.onReference?.(request())}>{text("ticket_reference_this_request_in_the_message_box_b3e84d5b")}</button></Show>
          </div>
        }</For>
      </div>
    </Show>
    <Show when={history().length > 0}>
      <details class="mt-3">
        <summary class="cursor-pointer text-xs">{text("ticket_history_label", { count: history().length })}</summary>
        <div class="mt-2 grid gap-3">
          <For each={history()} keyed={(request) => request.id}>{(request) =>
            <div hidden={isHidden(request().work_id)}><RequestCard controller={props.controller} state={props.state} request={request()} /></div>
          }</For>
        </div>
      </details>
    </Show>
  </section>
}
