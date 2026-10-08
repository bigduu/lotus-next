import { useCallback, useEffect, useRef, useState } from "react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog"
import { getErrorMessage } from "@services/api/errors"
import type { TypedWorkflowDraft } from "@services/command/workflowCatalog"
import { isWorkflowRunTerminal, prepareWorkflowRun, workflowRunError, workflowRuns, workflowRunUnavailableReason,
  type WorkflowRunSnapshot, type WorkflowStepStatus, type WorkflowRunEvent } from "@services/workflow/workflowRuns"
import { useWorkflowCatalog } from "./useWorkflowCatalog"

const statusLabel = (status: WorkflowStepStatus) => uiText(`workflow_run_status_${status}`)

/** This dialog owns only its visible session; reopening reads the durable server state. */
export function WorkflowRunsDialog({ sessionId, sessionTitle, onClose }: {
  sessionId: string; sessionTitle: string; onClose: () => void
}) {
  useUiLocale()
  return <ResponsiveDialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <ResponsiveDialogContent className="sm:max-w-2xl">
      <div className="shrink-0 border-b px-5 py-4 pr-12">
        <ResponsiveDialogTitle>{uiText("workflow_run_title")}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="mt-2 break-words">{sessionTitle}</ResponsiveDialogDescription>
      </div>
      <RunSession key={sessionId} sessionId={sessionId} />
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}

function RunSession({ sessionId }: { sessionId: string }) {
  const catalog = useWorkflowCatalog(sessionId, true)
  const [draft, setDraft] = useState<TypedWorkflowDraft | null>(null)
  const [runs, setRuns] = useState<WorkflowRunSnapshot[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [phase, setPhase] = useState<WorkflowRunEvent["phase"] | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const runRef = useRef<WorkflowRunSnapshot[]>([])
  const selectedRef = useRef<string | null>(null)
  const eventCursor = useRef({ runId: "", sequence: 0 })
  const lifecycle = useRef({ alive: true, epoch: 0, reading: false, mutation: false, controller: new AbortController() })

  const adopt = useCallback((snapshot: WorkflowRunSnapshot) => {
    const old = runRef.current.find((run) => run.run_id === snapshot.run_id)
    if (old && old.last_sequence >= snapshot.last_sequence) return
    const next = [snapshot, ...runRef.current.filter((run) => run.run_id !== snapshot.run_id)]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    runRef.current = next
    setRuns(next)
  }, [])

  const sync = useCallback(async () => {
    const life = lifecycle.current
    if (!life.alive || life.reading) return
    life.reading = true
    const epoch = life.epoch
    const current = () => life.alive && life.epoch === epoch
    setRefreshing(true)
    try {
      const snapshots = await workflowRuns.list(sessionId, life.controller.signal)
      if (!current()) return
      const next = snapshots.map((snapshot) => {
        const old = runRef.current.find((run) => run.run_id === snapshot.run_id)
        return old && old.last_sequence >= snapshot.last_sequence ? old : snapshot
      })
      runRef.current = next
      setRuns(next)
      setLoaded(true)
      setReadError(null)
      const runId = selectedRef.current ?? next[0]?.run_id ?? null
      if (!runId) return
      if (!next.some((run) => run.run_id === runId)) {
        selectedRef.current = null
        setSelectedId(null)
        setPhase(null)
        return
      }
      selectedRef.current = runId
      setSelectedId(runId)
      if (eventCursor.current.runId !== runId) eventCursor.current = { runId, sequence: 0 }
      const cursor = eventCursor.current.sequence
      const [snapshot, eventTail] = await Promise.allSettled([
        workflowRuns.detail(sessionId, runId, life.controller.signal),
        workflowRuns.events(sessionId, runId, cursor, life.controller.signal),
      ])
      if (!current() || selectedRef.current !== runId) return
      // Events are progress hints. Snapshot is the authority even when a tail is missing.
      if (snapshot.status === "fulfilled") adopt(snapshot.value)
      if (eventTail.status === "fulfilled") {
        const events = eventTail.value
        const lastPhase = events.findLast((event) => event.phase)
        if (lastPhase) setPhase(lastPhase.phase!)
        if (events.length) eventCursor.current = { runId, sequence: events.at(-1)!.sequence }
      }
      if (snapshot.status === "rejected" || eventTail.status === "rejected") setReadError(uiText("workflow_run_unavailable"))
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
  }, [sessionId, adopt])

  useEffect(() => {
    const life = lifecycle.current
    life.epoch++
    life.alive = true
    life.controller = new AbortController()
    void sync()
    const timer = window.setInterval(() => { if (!life.mutation) void sync() }, 2_000)
    return () => { life.epoch++; life.alive = false; life.controller.abort(); window.clearInterval(timer) }
  }, [sync])

  const chooseRun = (runId: string) => {
    selectedRef.current = runId
    eventCursor.current = { runId, sequence: 0 }
    setSelectedId(runId)
    setPhase(null)
    lifecycle.current.epoch++
    void sync()
  }
  const actOnRun = async (runId?: string) => {
    const life = lifecycle.current
    if (life.mutation || (!runId && !draft)) return
    life.mutation = true
    setBusy(runId ?? "start")
    setActionError(null)
    try {
      const snapshot = runId ? await workflowRuns.cancel(sessionId, runId) : await workflowRuns.start(sessionId, draft!)
      if (!life.alive) return
      life.epoch++
      adopt(snapshot)
      selectedRef.current = snapshot.run_id
      setSelectedId(snapshot.run_id)
      if (eventCursor.current.runId !== snapshot.run_id) {
        eventCursor.current = { runId: snapshot.run_id, sequence: 0 }
        setPhase(null)
      }
    } catch (error) {
      if (life.alive) setActionError(workflowRunError(error, true))
    } finally {
      life.mutation = false
      if (life.alive) { life.epoch++; setBusy(null); void sync() }
    }
  }
  let argsError: string | null = null
  if (draft) { try { prepareWorkflowRun(draft) } catch (error) { argsError = getErrorMessage(error) } }
  const entries = catalog.catalog?.entries.filter((entry) => entry.kind === "orchestration") ?? []
  const selected = runs.find((run) => run.run_id === selectedId)
  return <div className="min-h-0 overflow-y-auto px-5 py-4 text-sm">
    <div className="mb-4 flex items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">{uiText("workflow_run_hint")}</p>
      <Button size="sm" variant="outline" disabled={refreshing || busy !== null} onClick={() => { catalog.refresh(); void sync() }}>
        {refreshing ? uiText("refreshing_71659de8") : uiText("workflow_run_refresh")}
      </Button>
    </div>
    <section className="space-y-3 rounded-xl border bg-muted/20 p-3" aria-label={uiText("workflow_run_start_section")}>
      {catalog.error && <p role="alert" className="text-xs text-destructive">{uiText("workflow_run_catalog_unavailable")}</p>}
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">{uiText("workflow_run_choose")}</span>
        <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" disabled={catalog.loading || busy !== null}
          value={draft ? `${draft.entry.source}:${draft.entry.id}:${draft.entry.revision}` : ""}
          onChange={(event) => {
            const entry = entries.find((entry) => `${entry.source}:${entry.id}:${entry.revision}` === event.target.value)
            setDraft(entry ? { entry, argsText: "{}" } : null)
            setActionError(null)
          }}>
          <option value="">{catalog.loading ? uiText("workflow_run_loading") : uiText("workflow_run_choose")}</option>
          {draft && !entries.some((entry) => entry.id === draft.entry.id && entry.source === draft.entry.source && entry.revision === draft.entry.revision)
            ? <option value={`${draft.entry.source}:${draft.entry.id}:${draft.entry.revision}`}>{draft.entry.name} · r{draft.entry.revision}</option> : null}
          {entries.map((entry) => <option key={`${entry.source}:${entry.id}:${entry.revision}`} value={`${entry.source}:${entry.id}:${entry.revision}`}
            disabled={workflowRunUnavailableReason(entry) !== null}>{entry.name} · {entry.source} · r{entry.revision}</option>)}
        </select>
      </label>
      {!catalog.loading && !catalog.error && !entries.length ? <p className="text-xs text-muted-foreground">{uiText("workflow_run_no_definitions")}</p> : null}
      {draft ? <>
        <p className="break-words text-xs text-muted-foreground">{draft.entry.description}</p>
        <label className="block space-y-1.5"><span className="text-xs font-medium">{uiText("workflow_run_arguments")}</span>
          <Textarea rows={3} className="font-mono text-xs" disabled={busy !== null} value={draft.argsText}
            onChange={(event) => setDraft({ ...draft, argsText: event.target.value })} />
        </label>
        {argsError ? <p role="alert" className="break-words text-xs text-destructive">{argsError}</p> : null}
      </> : null}
      <Button size="sm" disabled={!draft || argsError !== null || busy !== null} onClick={() => void actOnRun()}>
        {busy === "start" ? uiText("workflow_run_starting") : uiText("workflow_run_start")}
      </Button>
      {actionError ? <p role="alert" className="break-words text-xs text-destructive">{actionError}</p> : null}
    </section>
    <section className="mt-5 space-y-3" aria-label={uiText("workflow_run_history")}>
      <h3 className="text-sm font-medium">{uiText("workflow_run_history")}</h3>
      {readError ? <p role="alert" className="text-xs text-destructive">{readError}</p> : null}
      {!loaded ? <p role="status" className="text-xs text-muted-foreground">{uiText("workflow_run_loading")}</p>
        : !readError && !runs.length ? <p className="text-xs text-muted-foreground">{uiText("workflow_run_empty")}</p> : null}
      <ul className="space-y-2">
        {runs.map((run) => <li key={run.run_id} className="rounded-lg border">
          <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent"
            aria-expanded={run.run_id === selectedId} onClick={() => chooseRun(run.run_id)}>
            <span className="min-w-0 break-all text-xs font-medium">{run.workflow_id} · r{run.workflow_revision}</span>
            <span className="shrink-0 text-xs" role="status">{statusLabel(run.status)}</span>
          </button>
          {selected?.run_id === run.run_id ? <div className="space-y-3 border-t px-3 py-3">
            <p className="break-all font-mono text-[10px] text-muted-foreground">{run.run_id}</p>
            {phase ? <p className="text-xs text-muted-foreground">{uiText(`workflow_run_phase_${phase}`)}</p> : null}
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>{uiText("workflow_run_steps")}: {run.usage.steps}/{run.budget.max_steps}</span>
              <span>{uiText("workflow_run_retries")}: {run.usage.retries}/{run.budget.max_retries}</span>
              <span>{uiText("workflow_run_agents")}: {run.usage.agents}/{run.budget.max_agents}</span>
              <span>{uiText("workflow_run_time_budget")}: {run.budget.wall_time_ms / 1_000}s</span>
              <span>{uiText("workflow_run_tokens")}: {run.usage.tokens}{run.budget.max_tokens === null ? "" : `/${run.budget.max_tokens}`}</span>
              <span>{run.usage.cost_micros === null ? uiText("workflow_run_cost_unmetered")
                : `${uiText("workflow_run_cost_metered")}: ${run.usage.cost_micros}${run.budget.max_cost_micros === null ? "" : `/${run.budget.max_cost_micros}`}`}</span>
            </div>
            {run.suspension ? <p className="text-xs">{uiText(`workflow_run_suspension_${run.suspension}`)}</p> : null}
            {run.failure ? <p className="text-xs text-destructive">{uiText(`workflow_run_failure_${run.failure.code}`)}</p> : null}
            <ul className="space-y-1" aria-label={uiText("workflow_run_steps")}>
              {run.steps.map((step) => <li key={step.id} className="flex flex-wrap justify-between gap-2 rounded bg-muted/40 px-2 py-1 text-xs">
                <span className="break-all">{step.id}</span><span>{statusLabel(step.status)} · {uiText("workflow_run_attempts", { count: step.attempts })}</span>
              </li>)}
            </ul>
            {run.can_cancel && !isWorkflowRunTerminal(run) ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void actOnRun(run.run_id)}>
              {busy === run.run_id ? uiText("workflow_run_cancelling") : uiText("workflow_run_cancel")}
            </Button> : null}
          </div> : null}
        </li>)}
      </ul>
    </section>
  </div>
}
