import { createMemo, createSignal, createUniqueId, For, Show, untrack } from "solid-js"
import type { SprintAction, SprintCommandResult, SprintDefinition, SprintDestination, SprintSummary, SprintView } from "@services/tickets/sprints"
import { Button } from "../ui/button"
import type { SprintOwnerControlsCopy } from "@/components/app/project-work/SprintOwnerControls.copy"
import { formatSprintUtcDateTime, parseSprintUtcDateTime } from "@/components/app/project-work/sprintUtcDateTime"

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

/** Receives verified authority and snapshots from its parent. */
export function SprintOwnerControls(props: SprintOwnerControlsProps) {
  const scope = () => props.projectId ? JSON.stringify([props.projectId, props.view?.sprint.id ?? null]) : null
  return <Show when={scope()} keyed>
    {(_scope) => <SprintOwnerEditor {...props} />}
  </Show>
}

function SprintOwnerEditor(props: SprintOwnerControlsProps) {
  const id = createUniqueId()
  const initialView = untrack(() => props.view)
  const [draft, setDraft] = createSignal(definitionDraft(initialView))
  const [baseRevision, setBaseRevision] = createSignal(initialView?.sprint.revision ?? null)
  const [workId, setWorkId] = createSignal("")
  const [destinations, setDestinations] = createSignal<Record<string, DestinationDraft>>({})
  const [submitting, setSubmitting] = createSignal(false)
  const [sent, setSent] = createSignal(false)
  const [localUnknown, setLocalUnknown] = createSignal(false)
  const [idUnavailable, setIdUnavailable] = createSignal(false)
  let createId: string | undefined
  let inFlight = false
  let sentGuard = false
  const copy = () => props.copy
  const sprint = () => props.view?.sprint
  const matchingView = () => {
    const item = sprint()
    return Boolean(props.projectId && (!item || (item.project_id === props.projectId && Number.isSafeInteger(item.revision) && item.revision > 0)))
  }
  const targets = createMemo(() => props.sprints.filter((target) => target.project_id === props.projectId && target.id !== sprint()?.id
    && (target.status === "planned" || target.status === "active") && Number.isSafeInteger(target.revision) && target.revision > 0))
  const hasTarget = (choice: Extract<DestinationDraft, { destination: "sprint" }>) =>
    targets().some((target) => target.id === choice.sprint_id && target.revision === choice.revision)
  const draftStale = () => baseRevision() !== (sprint()?.revision ?? null) ||
    Object.values(destinations()).some((choice) => choice.destination === "sprint" && !hasTarget(choice))
  const uncertain = () => props.request?.status === "unknown" || (!props.request && (localUnknown() || (sent() && !submitting())))
  const requestBlocked = () => props.request && props.request.status !== "committed"
  const requestMessage = () => props.request && "message" in props.request ? props.request.message : ""
  const disabled = () => !props.canWrite || !matchingView() || props.busy || submitting() || sent()
    || Boolean(requestBlocked()) || uncertain() || draftStale() || sprint()?.status === "closed"
  const definition = createMemo(() => definitionValue(draft()))
  const unchanged = () => {
    const item = sprint()
    const data = definition()
    return Boolean(item && data && Object.entries(data).every(([key, value]) => item.definition[key as keyof SprintDefinition] === value))
  }
  const workIdValid = () => !!workId().trim() && workId() === workId().trim()
  const members = () => sprint()?.members ?? []
  const currentMembers = () => props.view?.current_members
  const inspectComplete = createMemo(() => {
    const inspection = currentMembers()
    const ids = members()
    return Boolean(inspection && matchingView() && new Set(ids).size === ids.length
      && Object.keys(inspection).length === ids.length
      && ids.every((id) => typeof inspection[id]?.accepted === "boolean" && typeof inspection[id].archived === "boolean"))
  })
  const unfinished = createMemo(() => inspectComplete() ? members().filter((id) =>
    !currentMembers()![id].accepted && currentMembers()![id].state !== "cancelled") : [])
  const dispositionsComplete = () => inspectComplete() && unfinished().every((id) => {
    const choice = destinations()[id]
    return choice?.destination === "backlog" || (choice?.destination === "sprint" && !currentMembers()?.[id]?.archived && hasTarget(choice))
  })
  const otherActive = () => props.sprints.some((target) => target.project_id === props.projectId && target.id !== sprint()?.id && target.status === "active")

  const send = async (sprintId: string, action: SprintAction) => {
    if (disabled() || inFlight || sentGuard) return
    inFlight = true
    sentGuard = true
    setSubmitting(true)
    setSent(true)
    setLocalUnknown(false)
    try { await props.onCommand(sprintId, action) }
    catch { setLocalUnknown(true) }
    finally { inFlight = false; setSubmitting(false) }
  }
  const saveDefinition = () => {
    const data = definition()
    const item = sprint()
    if (disabled() || !data || unchanged()) return
    if (item) {
      void send(item.id, { op: "edit", expected_revision: baseRevision()!, definition: data })
      return
    }
    if (!createId) {
      try { createId = globalThis.crypto.randomUUID() }
      catch { setIdUnavailable(true); return }
    }
    void send(createId, { op: "create", definition: data })
  }
  const close = () => {
    const item = sprint()
    if (!item || item.status !== "active" || disabled() || !dispositionsComplete()) return
    const dispositions: [string, SprintDestination][] = []
    const targetRevisions = new Map<string, number>()
    for (const memberId of unfinished()) {
      const choice = destinations()[memberId]
      if (choice.destination === "backlog") dispositions.push([memberId, { destination: "backlog" }])
      else {
        dispositions.push([memberId, { destination: "sprint", sprint_id: choice.sprint_id }])
        targetRevisions.set(choice.sprint_id, choice.revision)
      }
    }
    void send(item.id, { op: "close", expected_revision: baseRevision()!, dispositions: Object.fromEntries(dispositions), target_revisions: Object.fromEntries(targetRevisions) })
  }
  const reconcile = async () => {
    if (props.busy || inFlight || !uncertain()) return
    inFlight = true
    setSubmitting(true)
    try { await props.onReconcile() }
    catch { setLocalUnknown(true) }
    finally { inFlight = false; setSubmitting(false) }
  }
  const reviewLatest = () => {
    if (props.busy || inFlight || uncertain()) return
    if (!sprint() && props.request?.status === "committed") createId = undefined
    // The user accepts current revisions while keeping their draft content.
    setBaseRevision(sprint()?.revision ?? null)
    setDestinations((previous) => Object.fromEntries(Object.entries(previous).flatMap<[string, DestinationDraft]>(([memberId, choice]) => {
      if (choice.destination === "backlog") return [[memberId, choice]]
      const target = targets().find((candidate) => candidate.id === choice.sprint_id)
      return target ? [[memberId, { ...choice, revision: target.revision }]] : []
    })))
    sentGuard = false
    setSent(false)
    setLocalUnknown(false)
    props.onReviewLatest()
  }
  const updateDate = (key: "startsAt" | "endsAt", patch: Partial<DateDraft>) =>
    setDraft((previous) => ({ ...previous, [key]: { ...previous[key], ...patch } }))
  const setDestination = (memberId: string, value: string) => {
    const target = targets().find((candidate) => `sprint:${candidate.id}` === value)
    const choice: DestinationDraft | null = value === "backlog" ? { destination: "backlog" }
      : target ? { destination: "sprint", sprint_id: target.id, revision: target.revision } : null
    setDestinations((previous) => {
      const next = { ...previous }
      if (choice) next[memberId] = choice
      else delete next[memberId]
      return next
    })
  }
  const updateMembers = (action: "add" | "remove") => {
    const item = sprint()
    if (!item || !workIdValid() || (action === "add") === members().includes(workId())) return
    void send(item.id, { op: action, expected_revision: baseRevision()!, work_id: workId() })
  }

  return (
    <section aria-labelledby={`${id}-title`} class="min-w-0 space-y-3 rounded-xl border bg-background p-4 text-sm" data-testid="sprint-owner-controls">
      <h3 id={`${id}-title`} class="font-semibold">{copy().title}</h3>
      <p class="text-xs text-muted-foreground">{copy().planningHelp}</p>
      <Show when={!props.canWrite || !matchingView()}><p role="status" class="text-muted-foreground">{copy().ownerRequired}</p></Show>
      <Show when={sprint()}>{(item) => <p class="break-all text-xs text-muted-foreground">{copy().revision}: {item().revision}</p>}</Show>
      <Show when={sprint()?.status !== "closed"} fallback={<p role="status">{copy().closedReadOnly}</p>}>
        <form class="space-y-3" onSubmit={(event) => { event.preventDefault(); saveDefinition() }}>
          <fieldset disabled={disabled()} class="grid min-w-0 gap-3 sm:grid-cols-2">
            <label class="min-w-0 space-y-1">
              <span>{copy().name}</span><input class={inputClass} value={draft().name}
                onInput={(event) => { const value = event.currentTarget.value; setDraft((old) => ({ ...old, name: value })) }} />
            </label>
            <label class="min-w-0 space-y-1">
              <span>{copy().goal}</span><textarea class={inputClass} value={draft().goal}
                onInput={(event) => { const value = event.currentTarget.value; setDraft((old) => ({ ...old, goal: value })) }} />
            </label>
            <For each={["startsAt", "endsAt"] as const}>{(key) => (
              <div class="min-w-0 space-y-1">
                <label><span>{copy()[key]}</span>
                  <input class={inputClass} style={{ "color-scheme": "var(--native-scheme)" }} type="datetime-local"
                    step="1" min="0001-01-01T00:00:00" max="9999-12-31T23:59:59" value={draft()[key].value}
                    aria-invalid={dateValue(draft()[key]) === undefined ? "true" : "false"} aria-describedby={`${id}-dates-help`}
                    onInput={(event) => {
                      const { value, validity } = event.currentTarget
                      updateDate(key, { value, edited: true, cleared: false, invalid: !validity.valid })
                    }} />
                </label>
                <Button type="button" size="sm" variant="outline" disabled={draft()[key].original === null && !draft()[key].value && !draft()[key].edited}
                  onClick={() => updateDate(key, { value: "", edited: true, cleared: true, invalid: false })}>
                  {copy()[key === "startsAt" ? "clearStart" : "clearEnd"]}
                </Button>
              </div>
            )}</For>
          </fieldset>
          <p id={`${id}-dates-help`} class="text-xs text-muted-foreground">{copy().datesHelp}</p>
          <Show when={!definition() && (draft().name || draft().goal || draft().startsAt.edited || draft().endsAt.edited)}>
            <p role="alert" class="text-destructive">{copy().invalidDefinition}</p>
          </Show>
          <Show when={idUnavailable()}><p role="alert" class="text-destructive">{copy().createIdUnavailable}</p></Show>
          <Button type="submit" size="sm" disabled={disabled() || !definition() || unchanged()}>{sprint() ? copy().save : copy().create}</Button>
        </form>
        <Show when={sprint()?.status === "planned" && sprint()}>{(item) => (
          <div class="space-y-1">
            <Button type="button" size="sm" variant="outline" disabled={disabled() || otherActive()}
              onClick={() => void send(item().id, { op: "start", expected_revision: baseRevision()! })}>{copy().start}</Button>
            <Show when={otherActive()}><p role="status" class="text-xs text-muted-foreground">{copy().activeExists}</p></Show>
          </div>
        )}</Show>
        <Show when={sprint()}>
          <div class="min-w-0 space-y-2 border-t pt-3">
            <label class="block min-w-0 space-y-1"><span>{copy().workId}</span>
              <input class={inputClass} disabled={disabled()} value={workId()} aria-describedby={`${id}-work-help`}
                onInput={(event) => setWorkId(event.currentTarget.value)} />
            </label>
            <p id={`${id}-work-help`} class="text-xs text-muted-foreground">{copy().workIdHelp}</p>
            <Show when={workId() && !workIdValid()}><p role="alert" class="text-destructive">{copy().invalidWorkId}</p></Show>
            <div class="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={disabled() || !workIdValid() || members().includes(workId())}
                onClick={() => updateMembers("add")}>{copy().add}</Button>
              <Button type="button" size="sm" variant="outline" disabled={disabled() || !workIdValid() || !members().includes(workId())}
                onClick={() => updateMembers("remove")}>{copy().remove}</Button>
            </div>
          </div>
        </Show>
        <Show when={sprint()?.status === "active"}>
          <div class="min-w-0 space-y-3 border-t pt-3">
            <p class="text-xs text-muted-foreground">{copy().closeHelp}</p>
            <Show when={inspectComplete()} fallback={<p role="status">{copy().incompleteInspect}</p>}>
              <For each={unfinished()}>{(memberId) => {
                const choice = () => destinations()[memberId]
                const selected = () => {
                  const value = choice()
                  return value?.destination === "backlog" ? "backlog" : value?.destination === "sprint" ? `sprint:${value.sprint_id}` : ""
                }
                return (
                  <div class="min-w-0 space-y-1">
                    <label class="block min-w-0 space-y-1">
                      <span class="block break-all">{copy().destination}: {memberId}</span>
                      <select class={inputClass} disabled={disabled()} value={selected()}
                        onChange={(event) => setDestination(memberId, event.currentTarget.value)}>
                        <option value="">{copy().chooseDestination}</option><option value="backlog">{copy().backlog}</option>
                        <For each={targets()} keyed={(target) => target.id}>{(target) => (
                          <option value={`sprint:${target().id}`} selected={selected() === `sprint:${target().id}`}
                            disabled={currentMembers()?.[memberId]?.archived}>
                            {target().definition.name} · {target().id} · {copy().targetRevision} {target().revision}
                          </option>
                        )}</For>
                      </select>
                    </label>
                    <Show when={choice()?.destination === "sprint" ? choice() as Extract<DestinationDraft, { destination: "sprint" }> : null}>
                      {(target) => <p class="text-xs text-muted-foreground">{copy().targetRevision}: {target().revision}</p>}
                    </Show>
                  </div>
                )
              }}</For>
            </Show>
            <Show when={!dispositionsComplete()}><p role="status" class="text-xs text-muted-foreground">{copy().incompleteDispositions}</p></Show>
            <Button type="button" size="sm" variant="destructive" disabled={disabled() || !dispositionsComplete()} onClick={close}>{copy().close}</Button>
          </div>
        </Show>
      </Show>
      <Show when={draftStale()}><p role="status" class="text-muted-foreground">{copy().draftStale}</p></Show>
      <Show when={submitting()} fallback={
        <Show when={sent() && !props.request && !localUnknown() && !uncertain()}><p role="status">{copy().awaitingReceipt}</p></Show>
      }><p role="status">{copy().submitting}</p></Show>
      <Show when={props.request?.status === "committed" ? props.request : null}>{(receipt) => (
        <p role="status" class="break-all">{copy().committed}: {receipt().operationId} · {receipt().committedSeq}</p>
      )}</Show>
      <Show when={uncertain() || requestBlocked()}>
        <p role="alert" class="break-words text-destructive">
          {uncertain() ? copy().unknown : props.request?.status === "conflict" ? copy().conflict : copy().rejected}
          {requestMessage() ? ` ${requestMessage()}` : ""}
        </p>
      </Show>
      <Show when={uncertain()}>
        <Button type="button" size="sm" variant="outline" disabled={props.busy || submitting()} onClick={() => void reconcile()}>{copy().reconcile}</Button>
      </Show>
      <Show when={!uncertain() && (draftStale() || props.request?.status === "conflict" || props.request?.status === "rejected" || sent() || props.request?.status === "committed") && sprint()?.status !== "closed"}>
        <div class="space-y-1">
          <Button type="button" size="sm" variant="outline" disabled={props.busy || submitting()} onClick={reviewLatest}>{copy().reviewLatest}</Button>
          <p class="text-xs text-muted-foreground">{copy().reviewHelp}</p>
        </div>
      </Show>
      <p class="text-xs text-muted-foreground">{copy().receiptHelp}</p>
    </section>
  )
}
