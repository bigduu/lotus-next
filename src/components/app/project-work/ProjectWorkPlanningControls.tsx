import { useId } from "react"
import type { WorkState } from "@services/tickets/types"
import { Button } from "@/components/ui/button"
import { WorkRequestFeedback } from "./WorkRequestFeedback"
import { useWorkRequestGuard } from "./useWorkRequestGuard"
import { commandMatches, deadlineInstant, planningValue, workDeadlineStatus, workPriorities,
  type ControlCapability, type WorkCommandContext, type WorkControlCopy, type WorkPlanningDraft,
  type WorkPlanningQuery, type WorkPlanningValue, type WorkRequestReceipt, type WorkRequestStatus } from "./projectWorkControls"

export interface ProjectWorkPlanningControlsProps {
  work: { id: string; generation: number; recordRevision: number; state: WorkState }
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
const controlClass = "min-w-0 w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring"
export function ProjectWorkPlanningControls(props: ProjectWorkPlanningControlsProps) {
  const { work, current, draft, query, owner, editCapability, queryCapability, command, request, copy,
    onDraftChange, onQueryChange, onSavePlanning, onReload, onReconcile } = props
  const id = useId()
  const guard = useWorkRequestGuard(command ? [command.operationId] : [])
  const value = planningValue(draft)
  const busy = request.phase !== "idle" || guard.submitting || guard.uncertain || guard.sent(command?.operationId)
  const writable = owner && editCapability.available && current !== null && commandMatches(command, work) && !busy
  const unchanged = !!value && !!current && value.priority === current.priority && value.expectedCompletionAt === current.expectedCompletionAt
  const deadline = workDeadlineStatus(current?.expectedCompletionAt, query.asOf, work.state)
  const deadlineLabel = { unknown: copy.deadlineUnknown, unset: copy.deadlineUnset, invalid: copy.deadlineInvalid,
    as_of_unknown: copy.asOfUnknown, overdue: copy.overdue, within_deadline: copy.withinDeadline, terminal: copy.terminalDeadline }[deadline]
  const editReason = !owner ? copy.ownerRequired : !editCapability.available ? editCapability.reason || copy.unsupported
    : current === null ? copy.unsupported : !commandMatches(command, work) ? copy.unavailableContext : null
  return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-4 rounded-xl border bg-background p-4 text-sm" data-testid="project-work-planning-controls">
    <h3 id={`${id}-title`} className="font-semibold">{copy.planning}</h3>
    <div className="space-y-1 break-words" aria-label={copy.currentPlanning}>
      <p>{copy.priority}: {current ? copy.priorities[current.priority] : copy.unsupported}</p>
      <p>{copy.desiredDeadline}: {current ? current.expectedCompletionAt === null ? copy.deadlineUnset : <time className="break-all" dateTime={deadlineInstant(current.expectedCompletionAt) !== null ? current.expectedCompletionAt : undefined}>{current.expectedCompletionAt || copy.deadlineInvalid}</time> : copy.deadlineUnknown}</p>
      <p className={deadline === "overdue" ? "font-medium text-destructive" : "text-muted-foreground"} data-deadline-status={deadline}>{deadlineLabel}</p>
    </div>
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (writable && value && !unchanged && command) void guard.send(command.operationId, () => onSavePlanning(value, command)) }}>
      <fieldset disabled={!writable} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 space-y-1"><span>{copy.priority}</span><select className={controlClass} value={draft.priority} onChange={(event) => onDraftChange({ ...draft, priority: event.target.value as WorkPlanningDraft["priority"] })}>{workPriorities.map((priority) => <option key={priority} value={priority}>{copy.priorities[priority]}</option>)}</select></label>
        <div className="min-w-0 space-y-1"><label htmlFor={`${id}-deadline`}>{copy.desiredDeadline}</label><input id={`${id}-deadline`} className={controlClass} type="text" value={draft.expectedCompletionAt} placeholder="2026-10-18T18:00:00+08:00" aria-describedby={`${id}-deadline-help${value ? "" : ` ${id}-deadline-error`}`} aria-invalid={!value} onChange={(event) => onDraftChange({ ...draft, expectedCompletionAt: event.target.value })} />
          <button type="button" className="rounded px-1 py-1 text-xs underline disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={!draft.expectedCompletionAt} onClick={() => onDraftChange({ ...draft, expectedCompletionAt: "" })}>{copy.clearDeadline}</button>
        </div>
      </fieldset>
      <p id={`${id}-deadline-help`} className="text-xs text-muted-foreground">{copy.deadlineHelp}</p>
      {!value ? <p id={`${id}-deadline-error`} role="alert" className="text-destructive">{copy.invalidDeadline}</p> : null}
      {editReason ? <p role="status" className="text-muted-foreground">{editReason}</p> : null}
      <Button type="submit" size="sm" disabled={!writable || !value || unchanged}>{copy.savePlanning}</Button>
    </form>
    <WorkRequestFeedback status={guard.uncertain && (request.phase === "idle" || request.phase === "requested" || request.phase === "awaiting_ack") ? { phase: "outcome_unknown", operationId: guard.operationId! } : request} submitting={guard.submitting} uncertain={false} copy={copy} onReload={onReload} onReconcile={onReconcile} />
    <fieldset disabled={!queryCapability.available} aria-labelledby={`${id}-query`} className="grid min-w-0 gap-3 border-t pt-3 sm:grid-cols-2">
      <legend id={`${id}-query`} className="px-1 font-medium">{copy.query}</legend>
      <label className="min-w-0 space-y-1"><span>{copy.order}</span><select className={controlClass} value={query.order} onChange={(event) => onQueryChange({ ...query, order: event.target.value as WorkPlanningQuery["order"] })}><option value="updated">{copy.orderUpdated}</option><option value="priority">{copy.orderPriority}</option><option value="expected_completion">{copy.orderDeadline}</option></select></label>
      <label className="min-w-0 space-y-1"><span>{copy.filterPriority}</span><select className={controlClass} value={query.priority ?? "all"} onChange={(event) => onQueryChange({ ...query, priority: event.target.value === "all" ? null : event.target.value as WorkPlanningDraft["priority"] })}><option value="all">{copy.allPriorities}</option>{workPriorities.map((priority) => <option key={priority} value={priority}>{copy.priorities[priority]}</option>)}</select></label>
      <label className="min-w-0 space-y-1"><span>{copy.filterDeadline}</span><select className={controlClass} value={query.deadline} onChange={(event) => onQueryChange({ ...query, deadline: event.target.value as WorkPlanningQuery["deadline"] })}><option value="any">{copy.anyDeadline}</option><option value="overdue" disabled={deadlineInstant(query.asOf) === null}>{copy.overdueOnly}</option><option value="unset">{copy.unsetOnly}</option></select></label>
    </fieldset>
    <p className="text-xs text-muted-foreground">{copy.serverQueryHelp}</p>
    {!queryCapability.available ? <p role="status" className="text-xs text-muted-foreground">{queryCapability.reason || copy.unsupported}</p> : null}
    <p className="break-all text-xs text-muted-foreground">{copy.asOf}: {deadlineInstant(query.asOf) !== null ? <time dateTime={query.asOf!}>{query.asOf}</time> : copy.asOfUnknown}</p>
  </section>
}
