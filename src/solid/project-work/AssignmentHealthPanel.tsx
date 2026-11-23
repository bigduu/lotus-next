import { createMemo, createUniqueId, For, Show } from "solid-js"
import type { JSX } from "@solidjs/web"

import {
  currentAssignment, healthReadStatus, sessionAccess, timestampMs,
  type AssignmentAttempt, type AssignmentHealthCopy, type HealthRead, type SessionAccessRef,
} from "@/components/app/project-work/assignmentHealth"
import type { AssignmentSessionTarget } from "@services/tickets/assignmentSessions"
import type { PatrolStatusRead } from "@services/tickets/patrolStatus"
import type { RuntimeObservationRead } from "@services/tickets/runtimeObservation"

import { Button } from "../ui/button"
import { PatrolStatusSummary } from "./PatrolStatusSummary"

export interface AssignmentHealthPanelProps {
  workId: string
  generation: number
  authorityEpoch: number
  currentAssignmentId: string | null
  attempts: HealthRead<readonly AssignmentAttempt[]>
  runtimeObservation: RuntimeObservationRead
  patrolStatus: PatrolStatusRead
  sessions: HealthRead<readonly SessionAccessRef[]>
  blockReason?: string | null
  nowMs: number
  locale?: string
  copy: AssignmentHealthCopy
  onOpenSession?: (target: AssignmentSessionTarget) => void
}

const grid = "grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"

function Fact(props: { label: string; children: JSX.Element }) {
  return (
    <div class="min-w-0">
      <dt class="text-xs text-muted-foreground">{props.label}</dt>
      <dd class="mt-0.5 min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{props.children}</dd>
    </div>
  )
}

function AttemptFacts(props: Pick<AssignmentHealthPanelProps, "copy" | "sessions" | "nowMs" | "onOpenSession"> & {
  attempt: AssignmentAttempt
  time: (value: string | null | undefined) => JSX.Element
}) {
  const access = () => sessionAccess(props.attempt, props.sessions, props.nowMs)
  const session = () => props.attempt.runtime?.session_id
  const target = () => {
    const attempt = props.attempt
    return access() === "accessible" && props.onOpenSession && attempt.runtime ? {
      assignment_id: attempt.id, session_id: attempt.runtime.session_id, run_id: attempt.runtime.run_id,
    } : null
  }
  const copy = () => props.copy
  const identifier = (value: string | null | undefined) => value
    ? <code class="break-all text-xs">{value}</code> : <span class="text-muted-foreground">{copy().notRecorded}</span>
  const reason = () => access() === "denied" ? copy().sessionDenied : access() === "missing" ? copy().sessionMissing
    : access() === "accessible" ? copy().navigationUnavailable : copy().sessionUnknown
  return (
    <dl class={grid}>
      <Fact label={copy().assignment}>{identifier(props.attempt.id)}</Fact>
      <Fact label={copy().role}>{copy()[props.attempt.role ?? "executor"]}</Fact>
      <Fact label={copy().generation}>{Number.isSafeInteger(props.attempt.generation) ? props.attempt.generation : copy().notRecorded}</Fact>
      <Fact label={copy().authorityEpoch}>{Number.isSafeInteger(props.attempt.authority_epoch) ? props.attempt.authority_epoch : copy().notRecorded}</Fact>
      <Show when={props.attempt.step_id}><Fact label={copy().step}>{identifier(props.attempt.step_id)}</Fact></Show>
      <Fact label={copy().attempt}>{identifier(props.attempt.attempt_id)}</Fact>
      <Fact label={copy().session}>
        <div class="min-w-0 space-y-1">
          {identifier(session())}
          <Show when={target()} fallback={<p class="text-xs text-muted-foreground">{reason()}</p>}>{(checkedTarget) => (
            <Button type="button" size="sm" variant="outline" class="ml-2 h-auto max-w-full whitespace-normal text-left"
              onClick={() => props.onOpenSession?.(checkedTarget())}>{copy().openSession}</Button>
          )}</Show>
        </div>
      </Fact>
      <Fact label={copy().run}>{identifier(props.attempt.runtime?.run_id)}</Fact>
      <Fact label={copy().claimedAt}>{props.time(props.attempt.claimed_at)}</Fact>
      <Fact label={copy().processStopped}>{props.attempt.process_stopped === true ? copy().stoppedConfirmed : copy().stopUnconfirmed}</Fact>
      <Fact label={copy().endReason}>{props.attempt.end_reason || copy().notRecorded}</Fact>
      <Show when={props.attempt.awaiting_request}><Fact label={copy().awaitingRequest}>{identifier(props.attempt.awaiting_request)}</Fact></Show>
    </dl>
  )
}

export function AssignmentHealthPanel(props: AssignmentHealthPanelProps) {
  const copy = () => props.copy
  const titleId = createUniqueId()
  const attemptRead = createMemo<HealthRead<readonly AssignmentAttempt[]>>(() => {
    const read = props.attempts
    return read.status === "available" && read.value.some((item) => item.work_id !== undefined && item.work_id !== props.workId)
      ? { status: "unknown", updatedAt: read.updatedAt } : read
  })
  const owner = createMemo(() => currentAssignment({
    workId: props.workId, generation: props.generation, authorityEpoch: props.authorityEpoch,
    currentAssignmentId: props.currentAssignmentId, attempts: attemptRead(), nowMs: props.nowMs,
  }))
  const status = () => healthReadStatus(attemptRead(), props.nowMs)
  const reason = () => {
    const read = props.attempts
    return read.status !== "available" && read.reason ? read.reason : copy().staleHint
  }
  const history = createMemo(() => {
    const read = props.attempts
    return read.status === "available" ? read.value.filter((item) =>
      (item.work_id === undefined || item.work_id === props.workId) && item !== owner().attempt,
    ) : []
  })
  // An observed HTTP snapshot does not assert execution or recovery state.
  const runtime = createMemo(() => props.runtimeObservation.status === "sample" ? props.runtimeObservation.facts : undefined)
  const wait = () => runtime()?.wait
  const format = createMemo(() => new Intl.DateTimeFormat(props.locale, { dateStyle: "medium", timeStyle: "long" }))
  const time = (value: string | null | undefined) => {
    const at = timestampMs(value)
    return at === null ? <span class="text-muted-foreground">{copy().notRecorded}</span>
      : <time datetime={value!}>{format().format(at)}</time>
  }
  const runtimeTime = (value: number | null | undefined) => value == null
    ? <span class="text-muted-foreground">{copy().unknown}</span> : time(new Date(value).toISOString())

  return (
    <section aria-labelledby={titleId} class="min-w-0 rounded-xl border bg-background p-4 text-sm" data-testid="assignment-health-panel">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <h4 id={titleId} class="font-semibold">{copy().title}</h4>
        <span class="rounded-md border px-2 py-0.5 text-xs" data-testid="assignment-source-status">{copy()[status()]}</span>
      </div>
      <p class="mt-1 break-words text-xs text-muted-foreground">{copy().updatedAt}: {time(props.attempts.updatedAt)}</p>
      <Show when={status() !== "available"}><p role="status" class="mt-2 break-words">{reason()}</p></Show>

      <div class="mt-4 min-w-0" data-testid="assignment-current">
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <h5 class="font-medium">{copy().currentExecutor}</h5>
          <span class="rounded-md bg-muted px-2 py-0.5 text-xs" data-testid="assignment-owner-status">
            {owner().status === "confirmed" ? copy().confirmed : owner().status === "none" ? copy().noCurrentExecutor : copy().ownerUnknown}
          </span>
        </div>
        <Show when={owner().status === "none"}><p class="mb-3 text-xs text-muted-foreground">{copy().noCurrentHint}</p></Show>
        <Show when={owner().attempt} fallback={
          <Show when={props.currentAssignmentId}><dl><Fact label={copy().assignment}><code class="break-all text-xs">{props.currentAssignmentId}</code></Fact></dl></Show>
        }>{(attempt) => (
          <AttemptFacts attempt={attempt()} copy={copy()} sessions={props.sessions} nowMs={props.nowMs} onOpenSession={props.onOpenSession} time={time} />
        )}</Show>
        <div class="mt-3 rounded-lg bg-muted/40 p-3" data-testid="assignment-observation">
          <h6 class="mb-2 font-medium">{copy().runtimeTitle}</h6>
          <p class="mb-3 text-xs text-muted-foreground">{copy().runtimeSnapshot}</p>
          <dl class={grid}>
            <Fact label={copy().taskEntry}>{runtimeTime(runtime()?.startedAt)}</Fact>
            <Fact label={copy().heartbeat}>{runtimeTime(runtime()?.heartbeatAt)}</Fact>
            <Fact label={copy().progress}>{runtimeTime(runtime()?.progress?.at)}</Fact>
            <Show when={runtime()?.progress}>{(progress) => <Fact label={copy().progressSequence}>{progress().sequence}</Fact>}</Show>
            <Fact label={copy().waitReason}>{wait() ? copy()[wait()!.kind] : copy().unknown}</Fact>
            <Fact label={copy().blockReason}>{props.blockReason || copy().notRecorded}</Fact>
            <Show when={wait()}>{(value) => (
              <><Fact label={copy().waitIssued}>{runtimeTime(value().issuedAt)}</Fact>
              <Fact label={copy().diagnosticAllowance}>{runtimeTime(value().allowanceUntil)}</Fact></>
            )}</Show>
          </dl>
          <Show when={runtime()?.outcomeUnknown}><p class="mt-3 text-xs">{copy().outcomeUnknown}</p></Show>
          <Show when={props.runtimeObservation.status === "denied" || props.runtimeObservation.status === "unavailable"}>
            <p class="mt-1 text-xs" data-testid="assignment-observation-status">
              {props.runtimeObservation.status === "denied" ? copy().runtimeDenied : copy().runtimeUnavailable}
            </p>
          </Show>
          <p class="mt-3 text-xs text-muted-foreground">{copy().heartbeatHint}</p>
        </div>
      </div>

      <details class="mt-4 min-w-0 rounded-lg border p-3" data-testid="assignment-history">
        <summary class="cursor-pointer font-medium">{copy().history} ({history().length})</summary>
        <Show when={history().length} fallback={<p class="mt-2 text-muted-foreground">{status() === "available" ? copy().emptyHistory : copy()[status()]}</p>}>
          <ul class="mt-3 grid min-w-0 gap-3">
            <For each={history()}>{(attempt) => (
              <li class="min-w-0 rounded-lg bg-muted/30 p-3">
                <AttemptFacts attempt={attempt} copy={copy()} sessions={props.sessions} nowMs={props.nowMs} onOpenSession={props.onOpenSession} time={time} />
              </li>
            )}</For>
          </ul>
        </Show>
      </details>
      <PatrolStatusSummary read={props.patrolStatus} locale={props.locale} />
    </section>
  )
}
