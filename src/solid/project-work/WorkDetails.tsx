import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"

import { runtimeObservationTarget, savedPatrolTarget, type HealthRead } from "@/lib/project-work/assignmentHealth"
import { getErrorMessage } from "@services/api"
import type { AssignmentSessionTarget } from "@services/tickets/assignmentSessions"
import { readPatrolStatus, type PatrolStatusRead } from "@services/tickets/patrolStatus"
import { projectBoardClient, type BoardAssignment, type BoardWorkView, type ProjectBoardRow, type ProjectContext } from "@services/tickets/projectBoard"
import { readRuntimeObservation, type RuntimeObservationRead } from "@services/tickets/runtimeObservation"
import type { SnapshotRef } from "@services/tickets/types"

import { createUiLocale, createUiText } from "../shell/uiText"
import { Button } from "../ui/button"
import { AssignmentHealthPanel } from "./AssignmentHealthPanel"
import { makeAssignmentHealthCopy } from "./assignmentHealthCopy"
import { CodexWorkHandoff } from "./CodexWorkHandoff"
import { createAssignmentSessions } from "./createAssignmentSessions"

export type OpenWorkSession = (id: string, verifyAccess: () => Promise<boolean>) => Promise<boolean>

export function ContextRevision(props: { context: Pick<ProjectContext, "project_id" | "project_revision" | "resource_revision"> | null }) {
  const text = createUiText()
  return <span>{props.context ? text("project_work_revision", {
    project: props.context.project_revision, resources: props.context.resource_revision,
  }) : text("project_work_unknown")}</span>
}

function ContextDetails(props: { context: ProjectContext | null; label: string; name: string }) {
  const text = createUiText()
  return <>
    <dt class="font-medium">{props.label}</dt>
    <dd data-testid={`project-work-context-${props.name}`}>
      <ContextRevision context={props.context} />
      <Show when={props.context}>{(context) => (
        <><span class="block">{text("project_work_contract_revision", { revision: context().contract_revision })}</span>
          <span class="block break-all">{context().workspace_binding.path}</span></>
      )}</Show>
    </dd>
  </>
}

export function WorkDetails(props: {
  row: ProjectBoardRow
  snapshot: SnapshotRef
  projectId: string
  canHandoff: boolean
  onClose: () => void
  onOpenSession?: OpenWorkSession
}) {
  const text = createUiText()
  const locale = createUiLocale()
  const ticket = () => props.row.ticket
  const [view, setView] = createSignal<BoardWorkView | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [observation, setObservation] = createSignal<RuntimeObservationRead>({ status: "unknown" })
  const [patrolStatus, setPatrolStatus] = createSignal<PatrolStatusRead>({ status: "unknown" })
  const [navigationError, setNavigationError] = createSignal<string | null>(null)
  const [opening, setOpening] = createSignal(false)
  let navigating = false
  let alive = true
  onCleanup(() => { alive = false })

  const sessions = createAssignmentSessions(() => view()?.assignments, () => ticket().id,
    () => props.projectId, () => Boolean(props.onOpenSession))
  const openSession = async (target: AssignmentSessionTarget) => {
    const navigate = props.onOpenSession
    if (!alive || !navigate || navigating || !navigator.onLine) return
    navigating = true
    setOpening(true)
    setNavigationError(null)
    try { await navigate(target.session_id, () => alive ? sessions.recheck(target) : Promise.resolve(false)) }
    catch (failure) { if (alive) setNavigationError(getErrorMessage(failure)) }
    finally { navigating = false; if (alive) setOpening(false) }
  }

  const scope = createMemo(() => ({
    id: ticket().id, projectId: props.projectId,
    snapshot: { commit: props.snapshot.commit, seq: props.snapshot.seq, authority_epoch: props.snapshot.authority_epoch },
  }))
  createEffect(scope, (query) => {
    const request = new AbortController()
    const current = () => !request.signal.aborted && scope() === query
    setView(null)
    setError(null)
    void projectBoardClient.inspect(query.id, query.snapshot, request.signal)
      .then((result) => { if (current()) setView(result) })
      .catch((failure) => { if (current()) setError(getErrorMessage(failure)) })
    return () => request.abort()
  })

  const attempts = createMemo<HealthRead<readonly BoardAssignment[]>>(() => view() && sessions.online()
    ? { status: "available", value: view()!.assignments, updatedAt: null }
    : { status: "unknown", reason: error() ?? (sessions.online() ? text("project_work_loading") : text("assignment_health_stale_hint")) })
  const readTargets = createMemo(() => {
    const confirmed = view()
    if (!confirmed || !sessions.online()) return null
    const { authority_epoch } = scope().snapshot
    const now = Date.now()
    return {
      observation: runtimeObservationTarget(ticket(), confirmed, authority_epoch, now),
      patrol: savedPatrolTarget(ticket(), confirmed, authority_epoch, now),
    }
  })
  createEffect(readTargets, (targets) => {
    const request = new AbortController()
    setObservation({ status: "unknown" })
    setPatrolStatus({ status: "unknown" })
    if (!targets) return
    const query = scope()
    const common = { projectId: query.projectId, workId: query.id, generation: ticket().generation, snapshot: query.snapshot }
    const current = () => !request.signal.aborted && readTargets() === targets && scope() === query && navigator.onLine
    if (targets.observation) void readRuntimeObservation({ ...common, ...targets.observation }, request.signal)
      .then((result) => { if (current()) setObservation(result) })
    if (targets.patrol) void readPatrolStatus({ ...common, ...targets.patrol }, request.signal)
      .then((result) => { if (current()) setPatrolStatus(result) })
    return () => request.abort()
  })

  const assignment = createMemo(() => view()?.assignments.find((item) => item.id === ticket().active_assignment))
  const submissions = createMemo(() => view()?.submissions.filter((submission) =>
    [ticket().current_submission, ticket().accepted_submission].includes(submission.id)) ?? [])
  const healthCopy = createMemo(() => makeAssignmentHealthCopy(text))
  const canHandoff = () => props.canHandoff && sessions.online() && view() && !["accepted", "cancelled"].includes(ticket().state)

  return (
    <section aria-label={ticket().contract.title} class="min-w-0 rounded-xl border bg-background p-4 text-sm" data-testid="project-work-details">
      <div class="flex items-start justify-between gap-3">
        <h3 class="min-w-0 break-words font-semibold">{ticket().contract.title}</h3>
        <Button size="sm" variant="ghost" onClick={props.onClose}>{text("project_work_close_details")}</Button>
      </div>
      <h4 class="mt-3 font-medium">{text("project_work_contract")}</h4>
      <p class="whitespace-pre-wrap break-words">{ticket().contract.objective}</p>
      <ul class="list-inside list-disc break-words">
        <For each={[...ticket().contract.constraints, ...ticket().contract.acceptance]}>{(line) => <li>{line}</li>}</For>
      </ul>
      <dl class="mt-3 grid gap-1 break-words">
        <dt class="font-medium">{text("project_work_dependencies")}</dt><dd>{ticket().depends_on.join(", ") || "—"}</dd>
        <ContextDetails context={props.row.context} label={text("project_work_candidate")} name="candidate" />
        <Show when={props.row.pending_context}>{(pending) => (
          <><ContextDetails context={pending()} label={text("project_work_pending")} name="pending" />
            <dd class="text-xs text-muted-foreground">{text("project_work_pending_hint")}</dd></>
        )}</Show>
        <ContextDetails context={props.row.adopted_context} label={text("project_work_adopted")} name="adopted" />
        <Show when={assignment()?.workspace}>{(workspace) => (
          <><dt>{text("project_work_repos")}</dt><dd class="break-all">{workspace().repo}<br />{workspace().branch}<br />{workspace().worktree}</dd></>
        )}</Show>
      </dl>
      <div class="mt-4">
        <AssignmentHealthPanel workId={ticket().id} generation={ticket().generation} authorityEpoch={scope().snapshot.authority_epoch}
          currentAssignmentId={ticket().active_assignment} attempts={attempts()}
          patrolStatus={readTargets()?.patrol ? patrolStatus() : { status: "unknown" }}
          runtimeObservation={readTargets()?.observation ? observation() : { status: "unknown" }} sessions={sessions.sessions()}
          blockReason={ticket().blocked?.reason} nowMs={Date.now()} locale={locale()} copy={healthCopy()}
          onOpenSession={props.onOpenSession && sessions.online() ? (target) => void openSession(target) : undefined} />
      </div>
      <Show when={opening()}><p role="status" class="mt-2 text-xs">{text("assignment_health_opening_session")}</p></Show>
      <Show when={navigationError()}><p role="alert" class="mt-2 text-destructive">{navigationError()}</p></Show>
      <Show when={canHandoff()}>
        <CodexWorkHandoff selector={{ project_id: props.projectId, work_id: ticket().id,
          generation: ticket().generation, record_revision: ticket().record_revision, authority_epoch: scope().snapshot.authority_epoch }} />
      </Show>
      <Show when={view()} fallback={
        <Show when={error()} fallback={<p role="status">{text("project_work_loading")}</p>}>
          <p role="alert" class="mt-2 text-destructive">{error()}</p>
        </Show>
      }>{(inspection) => (
        <>
          <Show when={inspection().requests.some((request) => request.status === "open")}>
            <p class="mt-2">{text("project_work_waiting")}</p>
          </Show>
          <h4 class="mt-3 font-medium">{text("project_work_evidence")}</h4>
          <For each={submissions()} keyed={(submission) => submission.id}>{(submission) => (
            <div class="mt-2 break-words">
              <p>{text(submission().stale ? "ticket_previous_submission_for_reference_only_8540a39f"
                : submission().id === ticket().accepted_submission ? "ticket_accepted_submission_a269d4af" : "ticket_submitted_awaiting_acceptance_14447588")}</p>
              <ul class="list-inside list-disc"><For each={submission().evidence}>{(evidence) => <li>{evidence}</li>}</For></ul>
              <p class="text-xs text-muted-foreground">{text("supervisor_work_result_count", { count: submission().artifacts.length })}</p>
            </div>
          )}</For>
          <Show when={!ticket().current_submission && !ticket().accepted_submission}><p>{text("project_work_evidence_none")}</p></Show>
        </>
      )}</Show>
    </section>
  )
}
