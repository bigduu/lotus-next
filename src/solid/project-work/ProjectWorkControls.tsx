import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js"
import type { WorkState } from "@services/tickets/types"
import {
  commandMatches, deadlineInstant, planningValue, workDeadlineStatus, workPriorities,
  type ControlCapability, type WorkCommandContext, type WorkControlCopy, type WorkPlanningDraft,
  type WorkPlanningQuery, type WorkPlanningValue, type WorkRequestReceipt, type WorkRequestStatus,
} from "@/components/app/project-work/projectWorkControls"
import { Button } from "../ui/button"

type WorkIdentity = { id: string; generation: number; recordRevision: number; state: WorkState }
const controlClass = "min-w-0 w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring"

function capabilityReason(capability: ControlCapability, fallback: string) {
  return capability.available ? null : capability.reason || fallback
}

function createWorkRequestGuard(activeIds: () => readonly string[]) {
  const sent = new Set<string>()
  let inFlight: string | undefined
  const [local, setLocal] = createSignal<{ id: string; phase: "submitting" | "uncertain" } | null>(null)
  const relevant = createMemo(() => {
    const status = local()
    return status && activeIds().includes(status.id) ? status : null
  })
  const send = async (id: string, callback: () => Promise<WorkRequestReceipt>) => {
    if (activeIds().some((active) => sent.has(active)) || (inFlight && activeIds().includes(inFlight))) return
    sent.add(id)
    inFlight = id
    setLocal({ id, phase: "submitting" })
    try {
      const receipt = await callback()
      // Delivery evidence alone does not change authoritative Work state.
      if (receipt.operationId !== id) throw new Error("Mismatched operation receipt")
      setLocal((current) => current?.id === id ? null : current)
    } catch {
      setLocal((current) => current?.id === id ? { id, phase: "uncertain" } : current)
    } finally {
      if (inFlight === id) inFlight = undefined
    }
  }
  return {
    send,
    sent: (id?: string) => Boolean(id && sent.has(id)),
    operationId: () => relevant()?.id ?? null,
    submitting: () => relevant()?.phase === "submitting",
    uncertain: () => relevant()?.phase === "uncertain",
  }
}
type RequestGuard = ReturnType<typeof createWorkRequestGuard>

function WorkRequestFeedback(props: {
  status: WorkRequestStatus
  guard: RequestGuard
  copy: WorkControlCopy
  onReload: () => void
  onReconcile?: (operationId: string) => void
}) {
  const status = createMemo<WorkRequestStatus>(() => {
    const id = props.guard.operationId()
    if (id && props.guard.uncertain() && ["idle", "requested", "awaiting_ack"].includes(props.status.phase)) {
      return { phase: "outcome_unknown", operationId: id }
    }
    return props.status
  })
  const result = () => {
    const value = status()
    return value.phase === "idle" ? null : value
  }
  const reload = () => ["conflict", "denied", "outcome_unknown", "failed"].includes(status().phase)
  const label = (phase: Exclude<WorkRequestStatus["phase"], "idle">) => ({
    requested: props.copy.requestSent, awaiting_ack: props.copy.awaitingAck, acknowledged: props.copy.acknowledged,
    conflict: props.copy.conflict, denied: props.copy.denied, outcome_unknown: props.copy.outcomeUnknown, failed: props.copy.failed,
  })[phase]
  return (
    <div class="space-y-2 text-sm">
      <Show when={props.guard.submitting()}><p role="status">{props.copy.submitting}</p></Show>
      <Show when={result()}>{(value) => (
        <div role={reload() ? "alert" : "status"} class="break-words">
          <p>{label(value().phase)}</p>
          <p class="text-xs text-muted-foreground">{props.copy.operation}: <span class="break-all">{value().operationId}</span></p>
          <Show when={value().detail}><p>{value().detail}</p></Show>
        </div>
      )}</Show>
      <Show when={reload()}>
        <div class="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={props.onReload}>{props.copy.reload}</Button>
          <Show when={props.onReconcile && result()}>{(value) => (
            <Button type="button" variant="outline" onClick={() => props.onReconcile?.(value().operationId)}>{props.copy.reconcile}</Button>
          )}</Show>
        </div>
      </Show>
    </div>
  )
}

export interface ProjectWorkPlanningControlsProps {
  work: WorkIdentity
  current: WorkPlanningValue | null
  draft: WorkPlanningDraft
  query: WorkPlanningQuery
  owner: boolean
  editCapability: ControlCapability
  queryCapability: ControlCapability
  command: WorkCommandContext | null
  request: WorkRequestStatus
  copy: WorkControlCopy
  onDraftChange: (value: WorkPlanningDraft) => void
  onQueryChange: (query: WorkPlanningQuery) => void
  onSavePlanning: (value: WorkPlanningValue, context: WorkCommandContext) => Promise<WorkRequestReceipt>
  onReload: () => void
  onReconcile?: (operationId: string) => void
}

export function ProjectWorkPlanningControls(props: ProjectWorkPlanningControlsProps) {
  const id = createUniqueId()
  const copy = () => props.copy
  const guard = createWorkRequestGuard(() => props.command ? [props.command.operationId] : [])
  const value = createMemo(() => planningValue(props.draft))
  const busy = () => props.request.phase !== "idle" || guard.submitting() || guard.uncertain() || guard.sent(props.command?.operationId)
  const writable = () => props.owner && props.editCapability.available && props.current !== null && commandMatches(props.command, props.work) && !busy()
  const unchanged = () => Boolean(value() && props.current && value()!.priority === props.current.priority
    && value()!.expectedCompletionAt === props.current.expectedCompletionAt)
  const deadline = () => workDeadlineStatus(props.current?.expectedCompletionAt, props.query.asOf, props.work.state)
  const deadlineLabel = () => ({ unknown: copy().deadlineUnknown, unset: copy().deadlineUnset, invalid: copy().deadlineInvalid,
    as_of_unknown: copy().asOfUnknown, overdue: copy().overdue, within_deadline: copy().withinDeadline, terminal: copy().terminalDeadline })[deadline()]
  const editReason = () => !props.owner ? copy().ownerRequired : !props.editCapability.available ? props.editCapability.reason || copy().unsupported
    : props.current === null ? copy().unsupported : !commandMatches(props.command, props.work) ? copy().unavailableContext : null
  const updateDraft = (value: Partial<WorkPlanningDraft>) => props.onDraftChange({ ...props.draft, ...value })
  const updateQuery = (query: Partial<WorkPlanningQuery>) => props.onQueryChange({ ...props.query, ...query })
  const save = () => {
    const planning = value(), command = props.command
    if (writable() && planning && !unchanged() && command) void guard.send(command.operationId, () => props.onSavePlanning(planning, command))
  }
  return (
    <section aria-labelledby={`${id}-title`} class="min-w-0 space-y-4 rounded-xl border bg-background p-4 text-sm" data-testid="project-work-planning-controls">
      <h3 id={`${id}-title`} class="font-semibold">{copy().planning}</h3>
      <div class="space-y-1 break-words" aria-label={copy().currentPlanning}>
        <p>{copy().priority}: {props.current ? copy().priorities[props.current.priority] : copy().unsupported}</p>
        <p>{copy().desiredDeadline}: <Show when={props.current} fallback={copy().deadlineUnknown}>{(current) => (
          <Show when={current().expectedCompletionAt !== null} fallback={copy().deadlineUnset}>
            <time class="break-all" datetime={deadlineInstant(current().expectedCompletionAt) !== null ? current().expectedCompletionAt! : undefined}>
              {current().expectedCompletionAt || copy().deadlineInvalid}
            </time>
          </Show>
        )}</Show></p>
        <p class={deadline() === "overdue" ? "font-medium text-destructive" : "text-muted-foreground"} data-deadline-status={deadline()}>{deadlineLabel()}</p>
      </div>
      <form class="space-y-3" onSubmit={(event) => { event.preventDefault(); save() }}>
        <fieldset disabled={!writable()} class="grid min-w-0 gap-3 sm:grid-cols-2">
          <label class="min-w-0 space-y-1">
            <span>{copy().priority}</span>
            <select class={controlClass} value={props.draft.priority}
              onChange={(event) => updateDraft({ priority: event.currentTarget.value as WorkPlanningDraft["priority"] })}>
              <For each={workPriorities}>{(priority) => <option value={priority}>{copy().priorities[priority]}</option>}</For>
            </select>
          </label>
          <div class="min-w-0 space-y-1">
            <label for={`${id}-deadline`}>{copy().desiredDeadline}</label>
            <input id={`${id}-deadline`} class={controlClass} type="text" value={props.draft.expectedCompletionAt}
              placeholder="2026-10-18T18:00:00+08:00" aria-describedby={`${id}-deadline-help${value() ? "" : ` ${id}-deadline-error`}`}
              aria-invalid={value() ? "false" : "true"} onInput={(event) => updateDraft({ expectedCompletionAt: event.currentTarget.value })} />
            <button type="button" class="rounded px-1 py-1 text-xs underline disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={!props.draft.expectedCompletionAt} onClick={() => updateDraft({ expectedCompletionAt: "" })}>{copy().clearDeadline}</button>
          </div>
        </fieldset>
        <p id={`${id}-deadline-help`} class="text-xs text-muted-foreground">{copy().deadlineHelp}</p>
        <Show when={!value()}><p id={`${id}-deadline-error`} role="alert" class="text-destructive">{copy().invalidDeadline}</p></Show>
        <Show when={editReason()}><p role="status" class="text-muted-foreground">{editReason()}</p></Show>
        <Button type="submit" size="sm" disabled={!writable() || !value() || unchanged()}>{copy().savePlanning}</Button>
      </form>
      <WorkRequestFeedback status={props.request} guard={guard} copy={copy()} onReload={props.onReload} onReconcile={props.onReconcile} />
      <fieldset disabled={!props.queryCapability.available} aria-labelledby={`${id}-query`} class="grid min-w-0 gap-3 border-t pt-3 sm:grid-cols-2">
        <legend id={`${id}-query`} class="px-1 font-medium">{copy().query}</legend>
        <label class="min-w-0 space-y-1">
          <span>{copy().order}</span>
          <select class={controlClass} value={props.query.order} onChange={(event) => updateQuery({ order: event.currentTarget.value as WorkPlanningQuery["order"] })}>
            <option value="updated">{copy().orderUpdated}</option><option value="priority">{copy().orderPriority}</option>
            <option value="expected_completion">{copy().orderDeadline}</option>
          </select>
        </label>
        <label class="min-w-0 space-y-1">
          <span>{copy().filterPriority}</span>
          <select class={controlClass} value={props.query.priority ?? "all"} onChange={(event) => {
            const priority = event.currentTarget.value
            updateQuery({ priority: priority === "all" ? null : priority as WorkPlanningDraft["priority"] })
          }}>
            <option value="all">{copy().allPriorities}</option>
            <For each={workPriorities}>{(priority) => <option value={priority}>{copy().priorities[priority]}</option>}</For>
          </select>
        </label>
        <label class="min-w-0 space-y-1">
          <span>{copy().filterDeadline}</span>
          <select class={controlClass} value={props.query.deadline}
            onChange={(event) => updateQuery({ deadline: event.currentTarget.value as WorkPlanningQuery["deadline"] })}>
            <option value="any">{copy().anyDeadline}</option>
            <option value="overdue" disabled={deadlineInstant(props.query.asOf) === null}>{copy().overdueOnly}</option>
            <option value="unset">{copy().unsetOnly}</option>
          </select>
        </label>
      </fieldset>
      <p class="text-xs text-muted-foreground">{copy().serverQueryHelp}</p>
      <Show when={!props.queryCapability.available}>
        <p role="status" class="text-xs text-muted-foreground">{capabilityReason(props.queryCapability, copy().unsupported)}</p>
      </Show>
      <p class="break-all text-xs text-muted-foreground">{copy().asOf}: {
        deadlineInstant(props.query.asOf) !== null ? <time datetime={props.query.asOf!}>{props.query.asOf}</time> : copy().asOfUnknown
      }</p>
    </section>
  )
}

export type WorkOwnerAction = "pause" | "resume" | "cancel" | "accept"
export interface WorkUserAcceptance {
  submissionId: string
  generation: number
  contractRevision: number
  stale: boolean
  stopGuardEnforced: boolean
  processStopped: boolean | null
  evidence: readonly string[]
  unverifiedItems: readonly string[]
}
export type WorkAcceptanceConfirmation = Pick<WorkUserAcceptance, "submissionId" | "generation" | "contractRevision">
export type WorkOwnerIntent = { kind: "pause" | "resume" | "cancel" }
  | { kind: "accept"; source: "user"; submissionId: string; generation: number; contractRevision: number; unverifiedItems: readonly string[] }

export interface ProjectWorkOwnerControlsProps {
  work: WorkIdentity & { contractRevision: number; currentSubmissionId: string | null; paused: boolean | null }
  owner: boolean
  capabilities: Record<WorkOwnerAction, ControlCapability>
  commands: Partial<Record<WorkOwnerAction, WorkCommandContext>>
  request: WorkRequestStatus
  acceptance: WorkUserAcceptance | null
  acceptanceConfirmation: WorkAcceptanceConfirmation | null
  acceptedByUser: boolean
  copy: WorkControlCopy
  onAcceptanceConfirmationChange: (confirmation: WorkAcceptanceConfirmation | null) => void
  onRequestAction: (intent: WorkOwnerIntent, context: WorkCommandContext) => Promise<WorkRequestReceipt>
  onReload: () => void
  onReconcile?: (operationId: string) => void
}

export function ProjectWorkOwnerControls(props: ProjectWorkOwnerControlsProps) {
  const id = createUniqueId()
  const copy = () => props.copy
  const ids = createMemo(() => Object.values(props.commands).map((command) => command.operationId))
  const guard = createWorkRequestGuard(ids)
  const busy = () => props.request.phase !== "idle" || guard.submitting() || guard.uncertain() || ids().some(guard.sent)
  const acceptanceSafe = createMemo(() => {
    const current = props.acceptance
    return Boolean(current && current.stopGuardEnforced === true && current.processStopped === true && !current.stale
      && current.generation === props.work.generation && current.submissionId && current.submissionId === props.work.currentSubmissionId
      && current.contractRevision === props.work.contractRevision && Number.isSafeInteger(current.contractRevision) && current.contractRevision >= 1)
  })
  const confirmed = createMemo(() => {
    const current = props.acceptance, confirmation = props.acceptanceConfirmation
    return Boolean(current && confirmation && current.submissionId === confirmation.submissionId
      && current.generation === confirmation.generation && current.contractRevision === confirmation.contractRevision)
  })
  const allowed = (action: WorkOwnerAction) => props.owner && props.capabilities[action].available && commandMatches(props.commands[action], props.work)
    && !busy() && (action !== "accept" || (acceptanceSafe() && confirmed()))
  const requestAction = (action: WorkOwnerAction) => {
    const command = props.commands[action]
    if (!allowed(action) || !command) return
    const current = props.acceptance
    const intent: WorkOwnerIntent | null = action !== "accept" ? { kind: action } : current ? { kind: "accept", source: "user",
      submissionId: current.submissionId, generation: current.generation,
      contractRevision: current.contractRevision, unverifiedItems: [...current.unverifiedItems],
    } : null
    if (intent) void guard.send(command.operationId, () => props.onRequestAction(intent, command))
  }
  const confirm = (checked: boolean) => {
    const current = props.acceptance
    props.onAcceptanceConfirmationChange(checked && current ? {
      submissionId: current.submissionId, generation: current.generation, contractRevision: current.contractRevision,
    } : null)
  }
  return (
    <section aria-labelledby={`${id}-title`} class="min-w-0 space-y-3 rounded-xl border bg-background p-4 text-sm" data-testid="project-work-owner-controls">
      <h3 id={`${id}-title`} class="font-semibold">{copy().ownerControls}</h3>
      <p>{copy().actualState}: <strong data-testid="work-authoritative-state">{copy().states[props.work.state]}</strong>{
        props.work.paused === true ? ` · ${copy().paused}` : props.work.paused === null ? ` · ${copy().pauseUnknown}` : ""
      }</p>
      <p class="text-xs text-muted-foreground">{copy().actualStateHelp}</p>
      <Show when={!props.owner}><p role="status">{copy().ownerRequired}</p></Show>
      <div class="flex flex-wrap gap-2">
        <For each={["pause", "resume", "cancel"] as const}>{(action) => (
          <div class="min-w-0 max-w-full space-y-1">
            <Button type="button" size="sm" variant={action === "cancel" ? "destructive" : "outline"}
              disabled={!allowed(action)} onClick={() => requestAction(action)}>{copy()[action]}</Button>
            <Show when={!props.capabilities[action].available} fallback={
              <Show when={!commandMatches(props.commands[action], props.work)}><p class="max-w-xs text-xs text-muted-foreground">{copy().unavailableContext}</p></Show>
            }><p class="max-w-xs break-words text-xs text-muted-foreground">{capabilityReason(props.capabilities[action], copy().unsupported)}</p></Show>
          </div>
        )}</For>
      </div>
      <div class="min-w-0 space-y-2 border-t pt-3">
        <Show when={props.acceptance}>{(current) => (
          <>
            <p class="break-all">{copy().submission}: {current().submissionId}</p>
            <p class="font-medium">{copy().evidence}</p>
            <Show when={current().evidence.length} fallback={<p>{copy().evidenceNotRecorded}</p>}>
              <ul class="list-inside list-disc break-words"><For each={current().evidence}>{(item) => <li>{item}</li>}</For></ul>
            </Show>
            <p class="font-medium">{copy().unverified}</p>
            <Show when={current().unverifiedItems.length} fallback={<p class="text-muted-foreground">{copy().noUnverifiedRecorded}</p>}>
              <ul class="list-inside list-disc break-words"><For each={current().unverifiedItems}>{(item) => <li>{item}</li>}</For></ul>
            </Show>
          </>
        )}</Show>
        <p class="text-xs text-muted-foreground">{copy().userAcceptance}</p>
        <Show when={!acceptanceSafe()}><p role="status" class="text-xs text-muted-foreground">{copy().completionGuard}</p></Show>
        <Show when={!props.capabilities.accept.available}><p role="status" class="text-xs text-muted-foreground">{capabilityReason(props.capabilities.accept, copy().unsupported)}</p></Show>
        <label class="flex items-start gap-2">
          <input type="checkbox" class="mt-1" checked={confirmed()} disabled={!props.owner || !props.capabilities.accept.available || !acceptanceSafe() || busy()}
            onChange={(event) => confirm(event.currentTarget.checked)} />
          <span>{copy().acceptanceConfirmation}</span>
        </label>
        <Button type="button" size="sm" disabled={!allowed("accept")} onClick={() => requestAction("accept")}>{copy().accept}</Button>
        <Show when={props.work.state === "accepted" && props.acceptedByUser}><p class="font-medium">{copy().acceptedByUser}</p></Show>
      </div>
      <WorkRequestFeedback status={props.request} guard={guard} copy={copy()} onReload={props.onReload} onReconcile={props.onReconcile} />
    </section>
  )
}
