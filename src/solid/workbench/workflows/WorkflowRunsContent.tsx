import { createMemo, createSignal, For, lazy, Loading, onSettled, Show } from "solid-js"
import { ArrowLeft, Plus } from "@lucide/solid"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Textarea } from "../../ui/textarea"
import { getErrorMessage } from "@services/api/errors"
import type { TypedWorkflowDraft } from "@services/command/workflowCatalog"
import { isWorkflowRunTerminal, prepareWorkflowRun, workflowRunError, workflowRuns, workflowRunUnavailableReason,
  type WorkflowRunSnapshot, type WorkflowStepStatus, type WorkflowRunEvent } from "@services/workflow/workflowRuns"
import { SKILL_CURATOR_ID, type PublishedWorkflow } from "@services/workflow/workflowProposals"
import { createWorkflowCatalog } from "./createWorkflowCatalog"

const WorkflowAuthoring = lazy(() => import("./WorkflowAuthoring"))
const entryKey = (entry: TypedWorkflowDraft["entry"]) => `${entry.source}:${entry.id}:${entry.revision}`

export interface WorkflowRunsContentProps {
  sessionId: string
  projectId?: string | null
  projectName?: string
}

export default function WorkflowRunsContent(props: WorkflowRunsContentProps) {
  const text = createUiText()
  const statusLabel = (status: WorkflowStepStatus) => text(`workflow_run_status_${status}`)
  const sessionId = props.sessionId
  const catalog = createWorkflowCatalog(() => sessionId)
  const [manualDraft, setDraft] = createSignal<TypedWorkflowDraft | null>(null)
  const [authoring, setAuthoring] = createSignal<{ runId?: string } | null>(null)
  const [publication, setPublication] = createSignal<PublishedWorkflow | null>(null)
  const entries = createMemo(() => catalog.catalog()?.entries.filter((entry) =>
    entry.kind === "orchestration" && entry.id !== SKILL_CURATOR_ID) ?? [])
  const publishedEntry = createMemo(() => {
    const saved = publication()
    return saved && entries().find((entry) => entry.source === "project" && entry.id === saved.id
      && entry.revision === saved.revision && workflowRunUnavailableReason(entry) === null)
  })
  const draft = createMemo(() => {
    const entry = publishedEntry()
    return manualDraft() ?? (entry ? { entry, argsText: "{}" } : null)
  })
  const [runs, setRuns] = createSignal<WorkflowRunSnapshot[]>([])
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [phase, setPhase] = createSignal<WorkflowRunEvent["phase"] | null>(null)
  const [loaded, setLoaded] = createSignal(false)
  const [refreshing, setRefreshing] = createSignal(false)
  const [readError, setReadError] = createSignal<string | null>(null)
  const [actionError, setActionError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal<string | null>(null)
  let runSnapshots: WorkflowRunSnapshot[] = []
  let selectedRunId: string | null = null
  let eventCursor = { runId: "", sequence: 0 }
  const life = { alive: true, epoch: 0, reading: false, mutation: false, controller: new AbortController() }

  const adopt = (snapshot: WorkflowRunSnapshot) => {
    const old = runSnapshots.find((run) => run.run_id === snapshot.run_id)
    if (old && old.last_sequence >= snapshot.last_sequence) return
    const next = [snapshot, ...runSnapshots.filter((run) => run.run_id !== snapshot.run_id)]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    runSnapshots = next
    setRuns(next)
  }

  const sync = async () => {
    if (!life.alive || life.reading) return
    life.reading = true
    const epoch = life.epoch
    const current = () => life.alive && life.epoch === epoch
    setRefreshing(true)
    try {
      const snapshots = await workflowRuns.list(sessionId, life.controller.signal)
      if (!current()) return
      const next = snapshots.map((snapshot) => {
        const old = runSnapshots.find((run) => run.run_id === snapshot.run_id)
        return old && old.last_sequence >= snapshot.last_sequence ? old : snapshot
      })
      runSnapshots = next
      setRuns(next)
      setLoaded(true)
      setReadError(null)
      const runId = selectedRunId ?? next[0]?.run_id ?? null
      if (!runId) return
      if (!next.some((run) => run.run_id === runId)) {
        selectedRunId = null
        setSelectedId(null)
        setPhase(null)
        return
      }
      selectedRunId = runId
      setSelectedId(runId)
      if (eventCursor.runId !== runId) eventCursor = { runId, sequence: 0 }
      const cursor = eventCursor.sequence
      const [snapshot, eventTail] = await Promise.allSettled([
        workflowRuns.detail(sessionId, runId, life.controller.signal),
        workflowRuns.events(sessionId, runId, cursor, life.controller.signal),
      ])
      if (!current() || selectedRunId !== runId) return
      // Events are progress hints. Snapshot is the authority even when a tail is missing.
      if (snapshot.status === "fulfilled") adopt(snapshot.value)
      if (eventTail.status === "fulfilled") {
        const events = eventTail.value
        const lastPhase = events.findLast((event) => event.phase)
        if (lastPhase) setPhase(lastPhase.phase!)
        if (events.length) eventCursor = { runId, sequence: events.at(-1)!.sequence }
      }
      if (snapshot.status === "rejected" || eventTail.status === "rejected") setReadError(text("workflow_run_unavailable"))
    } catch (error) {
      if (current()) { setReadError(workflowRunError(error)); setLoaded(true) }
    } finally {
      life.reading = false
      if (life.alive) {
        setRefreshing(false)
        // A completed mutation fences a list that began before that mutation.
        if (life.epoch !== epoch) queueMicrotask(() => { if (life.alive) void sync() })
      }
    }
  }

  onSettled(() => {
    void sync()
    const timer = window.setInterval(() => { if (!life.mutation) void sync() }, 2_000)
    return () => { life.epoch++; life.alive = false; life.controller.abort(); window.clearInterval(timer) }
  })

  const chooseRun = (runId: string) => {
    selectedRunId = runId
    eventCursor = { runId, sequence: 0 }
    setSelectedId(runId)
    setPhase(null)
    life.epoch++
    void sync()
  }
  const actOnRun = async (trigger: HTMLButtonElement, runId?: string) => {
    const pendingDraft = draft()
    if (life.mutation || (!runId && !pendingDraft)) return
    // The action becomes disabled while its receipt is pending. Keep keyboard
    // focus within the dialog even if that button is removed after completion.
    if (trigger.ownerDocument.activeElement === trigger) {
      trigger.closest<HTMLElement>("[role=dialog]")?.focus({ preventScroll: true })
    }
    life.mutation = true
    setBusy(runId ?? "start")
    setActionError(null)
    try {
      const snapshot = runId ? await workflowRuns.cancel(sessionId, runId) : await workflowRuns.start(sessionId, pendingDraft!)
      if (!life.alive) return
      life.epoch++
      adopt(snapshot)
      selectedRunId = snapshot.run_id
      setSelectedId(snapshot.run_id)
      if (eventCursor.runId !== snapshot.run_id) {
        eventCursor = { runId: snapshot.run_id, sequence: 0 }
        setPhase(null)
      }
    } catch (error) {
      if (life.alive) setActionError(workflowRunError(error, true))
    } finally {
      life.mutation = false
      if (life.alive) { life.epoch++; setBusy(null); void sync() }
    }
  }
  const argsError = createMemo(() => {
    const current = draft()
    if (current) {
      try { prepareWorkflowRun(current) }
      catch (failure) { return getErrorMessage(failure) }
    }
    return null
  })
  const draftIsListed = createMemo(() => {
    const current = draft()
    return !current || entries().some((entry) => entryKey(entry) === entryKey(current.entry))
  })

  const RunsView = () => (
    <div class="min-h-0 overflow-y-auto px-5 py-4 text-sm">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p class="text-xs text-muted-foreground">{text("workflow_run_hint")}</p>
        <div class="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={refreshing() || busy() !== null} onClick={() => { catalog.refresh(); void sync() }}>
            {refreshing() ? text("refreshing_71659de8") : text("workflow_run_refresh")}
          </Button>
          <Button size="sm" onClick={() => setAuthoring({})}>
            <Plus aria-hidden="true" class="size-4" />{text("workflow_authoring_title")}
          </Button>
        </div>
      </div>
      <section class="space-y-3 rounded-xl border bg-muted/20 p-3" aria-label={text("workflow_run_start_section")}>
        <Show when={catalog.error()}>
          <p role="alert" class="text-xs text-destructive">{text("workflow_run_catalog_unavailable")}</p>
        </Show>
        <label class="block space-y-1.5">
          <span class="text-xs font-medium">{text("workflow_run_choose")}</span>
          <select class="h-9 w-full rounded-md border bg-background px-2 text-sm" disabled={catalog.loading() || busy() !== null}
            value={draft() ? entryKey(draft()!.entry) : ""} onChange={(event) => {
              const value = event.currentTarget.value
              const entry = entries().find((entry) => entryKey(entry) === value)
              setPublication(null)
              setDraft(entry ? { entry, argsText: "{}" } : null)
              setActionError(null)
            }}>
            <option value="">{catalog.loading() ? text("workflow_run_loading") : text("workflow_run_choose")}</option>
            <Show when={!draftIsListed() && draft()}>{(current) => (
              <option value={entryKey(current().entry)} selected>{current().entry.name} · r{current().entry.revision}</option>
            )}</Show>
            <For each={entries()} keyed={entryKey}>{(entry) => (
              <option value={entryKey(entry())} selected={!!draft() && entryKey(entry()) === entryKey(draft()!.entry)}
                disabled={workflowRunUnavailableReason(entry()) !== null}>{entry().name} · {entry().source} · r{entry().revision}</option>
            )}</For>
          </select>
        </label>
        <Show when={!catalog.loading() && !catalog.error() && !entries().length}>
          <p class="text-xs text-muted-foreground">{text("workflow_run_no_definitions")}</p>
        </Show>
        <Show when={draft()}>{(current) => (
          <>
            <p class="break-words text-xs text-muted-foreground">{current().entry.description}</p>
            <label class="block space-y-1.5">
              <span class="text-xs font-medium">{text("workflow_run_arguments")}</span>
              <Textarea rows={3} class="font-mono text-xs" disabled={busy() !== null} value={current().argsText}
                onInput={(event) => setDraft({ ...current(), argsText: event.currentTarget.value })} />
            </label>
            <Show when={argsError()}>
              <p role="alert" class="break-words text-xs text-destructive">{argsError()}</p>
            </Show>
          </>
        )}</Show>
        <Button size="sm" disabled={!draft() || argsError() !== null || busy() !== null}
          onClick={(event) => void actOnRun(event.currentTarget)}>
          {busy() === "start" ? text("workflow_run_starting") : text("workflow_run_start")}
        </Button>
        <Show when={actionError()}>
          <p role="alert" class="break-words text-xs text-destructive">{actionError()}</p>
        </Show>
      </section>
      <section class="mt-5 space-y-3" aria-label={text("workflow_run_history")}>
        <h3 class="text-sm font-medium">{text("workflow_run_history")}</h3>
        <Show when={readError()}><p role="alert" class="text-xs text-destructive">{readError()}</p></Show>
        <Show when={loaded()} fallback={<p role="status" class="text-xs text-muted-foreground">{text("workflow_run_loading")}</p>}>
          <Show when={!readError() && !runs().length}><p class="text-xs text-muted-foreground">{text("workflow_run_empty")}</p></Show>
        </Show>
        <ul class="space-y-2">
          <For each={runs()} keyed={(run) => run.run_id}>{(run) => {
            const selected = () => run().run_id === selectedId()
            return (
              <li class="rounded-lg border">
                <button type="button" class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent"
                  aria-expanded={selected() ? "true" : "false"} onClick={() => chooseRun(run().run_id)}>
                  <span class="min-w-0 break-all text-xs font-medium">{run().workflow_id} · r{run().workflow_revision}</span>
                  <span class="shrink-0 text-xs" role="status">{statusLabel(run().status)}</span>
                </button>
                <Show when={selected()}>
                  <div class="space-y-3 border-t px-3 py-3">
                    <p class="break-all font-mono text-[10px] text-muted-foreground">{run().run_id}</p>
                    <Show when={phase()}>{(current) => <p class="text-xs text-muted-foreground">{text(`workflow_run_phase_${current()}`)}</p>}</Show>
                    <div class="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <span>{text("workflow_run_steps")}: {run().usage.steps}/{run().budget.max_steps}</span>
                      <span>{text("workflow_run_retries")}: {run().usage.retries}/{run().budget.max_retries}</span>
                      <span>{text("workflow_run_agents")}: {run().usage.agents}/{run().budget.max_agents}</span>
                      <span>{text("workflow_run_time_budget")}: {run().budget.wall_time_ms / 1_000}s</span>
                      <span>{text("workflow_run_tokens")}: {run().usage.tokens}{run().budget.max_tokens === null ? "" : `/${run().budget.max_tokens}`}</span>
                      <span>{run().usage.cost_micros === null ? text("workflow_run_cost_unmetered")
                        : `${text("workflow_run_cost_metered")}: ${run().usage.cost_micros}${run().budget.max_cost_micros === null ? "" : `/${run().budget.max_cost_micros}`}`}</span>
                    </div>
                    <Show when={run().suspension}>{(suspension) => <p class="text-xs">{text(`workflow_run_suspension_${suspension()}`)}</p>}</Show>
                    <Show when={run().failure}>{(failure) => <p class="text-xs text-destructive">{text(`workflow_run_failure_${failure().code}`)}</p>}</Show>
                    <ul class="space-y-1" aria-label={text("workflow_run_steps")}>
                      <For each={run().steps} keyed={(step) => step.id}>{(step) => (
                        <li class="flex flex-wrap justify-between gap-2 rounded bg-muted/40 px-2 py-1 text-xs">
                          <span class="break-all">{step().id}</span>
                          <span>{statusLabel(step().status)} · {text("workflow_run_attempts", { count: step().attempts })}</span>
                        </li>
                      )}</For>
                    </ul>
                    <Show when={run().workflow_id === SKILL_CURATOR_ID}>
                      <Button size="sm" variant="outline" onClick={() => setAuthoring({ runId: run().run_id })}>
                        {text("workflow_authoring_review")}
                      </Button>
                    </Show>
                    <Show when={run().can_cancel && !isWorkflowRunTerminal(run())}>
                      <Button size="sm" variant="outline" disabled={busy() !== null}
                        onClick={(event) => void actOnRun(event.currentTarget, run().run_id)}>
                        {busy() === run().run_id ? text("workflow_run_cancelling") : text("workflow_run_cancel")}
                      </Button>
                    </Show>
                  </div>
                </Show>
              </li>
            )
          }}</For>
        </ul>
      </section>
    </div>
  )
  return (
    <Show when={authoring()} keyed fallback={<RunsView />}>{(mode) => (
      <div class="min-h-0 space-y-3 overflow-y-auto px-5 py-4">
        <Button type="button" size="sm" variant="ghost" onClick={() => setAuthoring(null)}>
          <ArrowLeft aria-hidden="true" class="size-4" />{text("workflow_run_title")}
        </Button>
        <Loading fallback={<p role="status" class="text-sm text-muted-foreground">{text("workflow_run_loading")}</p>}>
          <WorkflowAuthoring sessionId={sessionId} projectId={props.projectId} projectName={props.projectName}
            initialRunId={mode.runId} entries={entries().filter((entry) => entry.source === "project" && entry.winner && entry.status === "valid")}
            onUse={(saved) => {
              setDraft(null)
              setPublication(saved)
              catalog.refresh()
              setAuthoring(null)
            }} />
        </Loading>
      </div>
    )}</Show>
  )
}
