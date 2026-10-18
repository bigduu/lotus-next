import { useId, useRef, useState } from "react"
import type { SprintAction, SprintCommandResult, SprintDefinition, SprintDestination, SprintSummary, SprintView } from "@services/tickets/sprints"
import { Button } from "@/components/ui/button"
import type { SprintOwnerControlsCopy } from "./SprintOwnerControls.copy"
import { formatSprintUtcDateTime, parseSprintUtcDateTime } from "./sprintUtcDateTime"

export interface SprintOwnerControlsProps {
  projectId: string
  view: SprintView | null
  sprints: readonly SprintSummary[]
  canWrite: boolean
  busy: boolean
  request: SprintCommandResult | null
  copy: SprintOwnerControlsCopy
  onCommand: (sprintId: string, action: SprintAction) => Promise<void>
  onReconcile: () => Promise<void>
  onReviewLatest: () => void
}

interface DateDraft { value: string; original: number | null; edited: boolean; cleared: boolean; invalid: boolean }
interface DefinitionDraft { name: string; goal: string; startsAt: DateDraft; endsAt: DateDraft }
type DestinationDraft = { destination: "backlog" } | { destination: "sprint"; sprint_id: string; revision: number }
const inputClass = "w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
const dateDraft = (original: number | null): DateDraft => ({ value: formatSprintUtcDateTime(original) ?? "", original, edited: false, cleared: false, invalid: false })
const definitionDraft = (view: SprintView | null): DefinitionDraft => ({
  name: view?.sprint.definition.name ?? "", goal: view?.sprint.definition.goal ?? "",
  startsAt: dateDraft(view?.sprint.definition.starts_at ?? null), endsAt: dateDraft(view?.sprint.definition.ends_at ?? null),
})
function dateValue(draft: DateDraft): number | null | undefined {
  if (!draft.edited) return draft.original
  if (draft.cleared) return null
  return draft.invalid ? undefined : parseSprintUtcDateTime(draft.value)
}
function definitionValue(draft: DefinitionDraft): SprintDefinition | null {
  const starts_at = dateValue(draft.startsAt), ends_at = dateValue(draft.endsAt)
  const bytes = new TextEncoder()
  if (!draft.name.trim() || bytes.encode(draft.name).length > 256 || !draft.goal.trim() || bytes.encode(draft.goal).length > 4096
    || starts_at === undefined || ends_at === undefined || (starts_at !== null && ends_at !== null && ends_at < starts_at)) return null
  return { name: draft.name, goal: draft.goal, starts_at, ends_at }
}

/** Receives verified authority/snapshots from its parent; it owns no Work or runtime authority. */
export function SprintOwnerControls(props: SprintOwnerControlsProps) {
  return <SprintOwnerEditor key={`${props.projectId}:${props.view?.sprint.id ?? "create"}`} {...props} />
}

function SprintOwnerEditor({ projectId, view, sprints, canWrite, busy, request, copy, onCommand, onReconcile, onReviewLatest }: SprintOwnerControlsProps) {
  const id = useId()
  const [draft, setDraft] = useState(() => definitionDraft(view))
  const [baseRevision, setBaseRevision] = useState(view?.sprint.revision ?? null)
  const [workId, setWorkId] = useState("")
  const [destinations, setDestinations] = useState<Record<string, DestinationDraft>>({})
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [localUnknown, setLocalUnknown] = useState(false)
  const [idUnavailable, setIdUnavailable] = useState(false)
  const createId = useRef<string | null>(null)
  const inFlight = useRef(false)
  const sentGuard = useRef(false)
  const sprint = view?.sprint
  const matchingView = !!projectId && (!sprint || (sprint.project_id === projectId && Number.isSafeInteger(sprint.revision) && sprint.revision > 0))
  const targets = sprints.filter((target) => target.project_id === projectId && target.id !== sprint?.id
    && (target.status === "planned" || target.status === "active") && Number.isSafeInteger(target.revision) && target.revision > 0)
  const targetChanged = Object.values(destinations).some((choice) => choice.destination === "sprint"
    && !targets.some((target) => target.id === choice.sprint_id && target.revision === choice.revision))
  const draftStale = baseRevision !== (sprint?.revision ?? null) || targetChanged
  const uncertain = request?.status === "unknown" || (!request && (localUnknown || (sent && !submitting)))
  const requestBlocked = !!request && request.status !== "committed"
  const requestMessage = request && "message" in request ? request.message : ""
  const disabled = !canWrite || !matchingView || busy || submitting || sent || requestBlocked || uncertain || draftStale || sprint?.status === "closed"
  const definition = definitionValue(draft)
  const unchanged = !!sprint && !!definition && Object.entries(definition).every(([key, value]) => sprint.definition[key as keyof SprintDefinition] === value)
  const workIdValid = !!workId.trim() && workId === workId.trim()
  const members = sprint?.members ?? []
  const inspectComplete = !!view && matchingView && new Set(members).size === members.length
    && Object.keys(view.current_members).length === members.length
    && members.every((memberId) => !!view.current_members[memberId] && typeof view.current_members[memberId].accepted === "boolean")
  const unfinished = inspectComplete ? members.filter((memberId) => !view!.current_members[memberId].accepted && view!.current_members[memberId].state !== "cancelled") : []
  const dispositionsComplete = inspectComplete && unfinished.every((memberId) => {
    const choice = destinations[memberId]
    return choice?.destination === "backlog" || (choice?.destination === "sprint"
      && targets.some((target) => target.id === choice.sprint_id && target.revision === choice.revision))
  })
  const otherActive = sprints.some((target) => target.project_id === projectId && target.id !== sprint?.id && target.status === "active")

  const send = async (sprintId: string, action: SprintAction) => {
    if (disabled || inFlight.current || sentGuard.current) return
    inFlight.current = true
    sentGuard.current = true
    setSubmitting(true)
    setSent(true)
    setLocalUnknown(false)
    try { await onCommand(sprintId, action) } catch { setLocalUnknown(true) }
    finally { inFlight.current = false; setSubmitting(false) }
  }
  const saveDefinition = () => {
    if (disabled || !definition || unchanged) return
    if (sprint) {
      void send(sprint.id, { op: "edit", expected_revision: baseRevision!, definition })
      return
    }
    if (!createId.current) {
      try { createId.current = globalThis.crypto.randomUUID() } catch { setIdUnavailable(true); return }
    }
    void send(createId.current, { op: "create", definition })
  }
  const close = () => {
    if (!sprint || sprint.status !== "active" || disabled || !dispositionsComplete) return
    const dispositions: [string, SprintDestination][] = []
    const targetRevisions = new Map<string, number>()
    for (const memberId of unfinished) {
      const choice = destinations[memberId]
      if (choice.destination === "backlog") dispositions.push([memberId, { destination: "backlog" }])
      else {
        dispositions.push([memberId, { destination: "sprint", sprint_id: choice.sprint_id }])
        targetRevisions.set(choice.sprint_id, choice.revision)
      }
    }
    void send(sprint.id, { op: "close", expected_revision: baseRevision!, dispositions: Object.fromEntries(dispositions), target_revisions: Object.fromEntries(targetRevisions) })
  }
  const reconcile = async () => {
    if (busy || inFlight.current || !uncertain) return
    inFlight.current = true
    setSubmitting(true)
    try { await onReconcile() } catch { setLocalUnknown(true) }
    finally { inFlight.current = false; setSubmitting(false) }
  }
  const reviewLatest = () => {
    if (busy || inFlight.current || uncertain) return
    if (!sprint && request?.status === "committed") createId.current = null
    // This explicit user action preserves content while acknowledging only the revisions currently displayed.
    setBaseRevision(sprint?.revision ?? null)
    setDestinations((previous) => Object.fromEntries(Object.entries(previous).flatMap<[string, DestinationDraft]>(([memberId, choice]) => {
      if (choice.destination === "backlog") return [[memberId, choice]]
      const target = targets.find((candidate) => candidate.id === choice.sprint_id)
      return target ? [[memberId, { ...choice, revision: target.revision }]] : []
    })))
    sentGuard.current = false
    setSent(false)
    setLocalUnknown(false)
    onReviewLatest()
  }
  return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-3 rounded-xl border bg-background p-4 text-sm" data-testid="sprint-owner-controls">
    <h3 id={`${id}-title`} className="font-semibold">{copy.title}</h3>
    <p className="text-xs text-muted-foreground">{copy.planningHelp}</p>
    {!canWrite || !matchingView ? <p role="status" className="text-muted-foreground">{copy.ownerRequired}</p> : null}
    {sprint ? <p className="break-all text-xs text-muted-foreground">{copy.revision}: {sprint.revision}</p> : null}
    {sprint?.status === "closed" ? <p role="status">{copy.closedReadOnly}</p> : <>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); saveDefinition() }}>
        <fieldset disabled={disabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="min-w-0 space-y-1"><span>{copy.name}</span><input className={inputClass} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className="min-w-0 space-y-1"><span>{copy.goal}</span><textarea className={inputClass} value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} /></label>
          {(["startsAt", "endsAt"] as const).map((key) => <div key={key} className="min-w-0 space-y-1">
            <label><span>{copy[key]}</span><input className={inputClass} type="datetime-local" step="1" min="0001-01-01T00:00:00" max="9999-12-31T23:59:59" value={draft[key].value} aria-invalid={dateValue(draft[key]) === undefined} aria-describedby={`${id}-dates-help`} onChange={(event) => {
              const { value, validity } = event.currentTarget
              setDraft({ ...draft, [key]: { ...draft[key], value, edited: true, cleared: false, invalid: !validity.valid } })
            }} /></label>
            <Button type="button" size="sm" variant="outline" disabled={draft[key].original === null && !draft[key].value && !draft[key].edited}
              onClick={() => setDraft({ ...draft, [key]: { ...draft[key], value: "", edited: true, cleared: true, invalid: false } })}>{copy[key === "startsAt" ? "clearStart" : "clearEnd"]}</Button>
          </div>)}
        </fieldset>
        <p id={`${id}-dates-help`} className="text-xs text-muted-foreground">{copy.datesHelp}</p>
        {!definition && (draft.name || draft.goal || draft.startsAt.edited || draft.endsAt.edited) ? <p role="alert" className="text-destructive">{copy.invalidDefinition}</p> : null}
        {idUnavailable ? <p role="alert" className="text-destructive">{copy.createIdUnavailable}</p> : null}
        <Button type="submit" size="sm" disabled={disabled || !definition || unchanged}>{sprint ? copy.save : copy.create}</Button>
      </form>
      {sprint?.status === "planned" ? <div className="space-y-1"><Button type="button" size="sm" variant="outline" disabled={disabled || otherActive} onClick={() => void send(sprint.id, { op: "start", expected_revision: baseRevision! })}>{copy.start}</Button>{otherActive ? <p role="status" className="text-xs text-muted-foreground">{copy.activeExists}</p> : null}</div> : null}
      {sprint ? <div className="min-w-0 space-y-2 border-t pt-3">
        <label className="block min-w-0 space-y-1"><span>{copy.workId}</span><input className={inputClass} disabled={disabled} value={workId} aria-describedby={`${id}-work-help`} onChange={(event) => setWorkId(event.target.value)} /></label>
        <p id={`${id}-work-help`} className="text-xs text-muted-foreground">{copy.workIdHelp}</p>
        {workId && !workIdValid ? <p role="alert" className="text-destructive">{copy.invalidWorkId}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={disabled || !workIdValid || members.includes(workId)} onClick={() => { if (workIdValid && !members.includes(workId)) void send(sprint.id, { op: "add", expected_revision: baseRevision!, work_id: workId }) }}>{copy.add}</Button>
          <Button type="button" size="sm" variant="outline" disabled={disabled || !workIdValid || !members.includes(workId)} onClick={() => { if (workIdValid && members.includes(workId)) void send(sprint.id, { op: "remove", expected_revision: baseRevision!, work_id: workId }) }}>{copy.remove}</Button>
        </div>
      </div> : null}
      {sprint?.status === "active" ? <div className="min-w-0 space-y-3 border-t pt-3">
        <p className="text-xs text-muted-foreground">{copy.closeHelp}</p>
        {!inspectComplete ? <p role="status">{copy.incompleteInspect}</p> : unfinished.map((memberId) => {
          const choice = destinations[memberId]
          return <div key={memberId} className="min-w-0 space-y-1">
            <label className="block min-w-0 space-y-1"><span className="block break-all">{copy.destination}: {memberId}</span>
              <select className={inputClass} disabled={disabled} value={choice?.destination === "backlog" ? "backlog" : choice?.destination === "sprint" ? `sprint:${choice.sprint_id}` : ""} onChange={(event) => {
                const target = targets.find((candidate) => `sprint:${candidate.id}` === event.target.value)
                const choice: DestinationDraft | null = event.target.value === "backlog" ? { destination: "backlog" }
                  : target ? { destination: "sprint", sprint_id: target.id, revision: target.revision } : null
                setDestinations((previous) => Object.fromEntries([...Object.entries(previous).filter(([key]) => key !== memberId), ...(choice ? [[memberId, choice] as const] : [])]))
              }}>
                <option value="">{copy.chooseDestination}</option><option value="backlog">{copy.backlog}</option>
                {targets.map((target) => <option key={target.id} value={`sprint:${target.id}`}>{target.definition.name} · {target.id} · {copy.targetRevision} {target.revision}</option>)}
              </select>
            </label>
            {choice?.destination === "sprint" ? <p className="text-xs text-muted-foreground">{copy.targetRevision}: {choice.revision}</p> : null}
          </div>
        })}
        {!dispositionsComplete ? <p role="status" className="text-xs text-muted-foreground">{copy.incompleteDispositions}</p> : null}
        <Button type="button" size="sm" variant="destructive" disabled={disabled || !dispositionsComplete} onClick={close}>{copy.close}</Button>
      </div> : null}
    </>}
    {draftStale ? <p role="status" className="text-muted-foreground">{copy.draftStale}</p> : null}
    {submitting ? <p role="status">{copy.submitting}</p> : sent && !request && !localUnknown && !uncertain ? <p role="status">{copy.awaitingReceipt}</p> : null}
    {request?.status === "committed" ? <p role="status" className="break-all">{copy.committed}: {request.operationId} · {request.committedSeq}</p> : null}
    {uncertain || (request && request.status !== "committed") ? <p role="alert" className="break-words text-destructive">{uncertain ? copy.unknown : request?.status === "conflict" ? copy.conflict : copy.rejected}{requestMessage ? ` ${requestMessage}` : ""}</p> : null}
    {uncertain ? <Button type="button" size="sm" variant="outline" disabled={busy || submitting} onClick={() => void reconcile()}>{copy.reconcile}</Button> : null}
    {!uncertain && (draftStale || request?.status === "conflict" || request?.status === "rejected" || sent || request?.status === "committed") && sprint?.status !== "closed" ? <div className="space-y-1">
      <Button type="button" size="sm" variant="outline" disabled={busy || submitting} onClick={reviewLatest}>{copy.reviewLatest}</Button>
      <p className="text-xs text-muted-foreground">{copy.reviewHelp}</p>
    </div> : null}
    <p className="text-xs text-muted-foreground">{copy.receiptHelp}</p>
  </section>
}
