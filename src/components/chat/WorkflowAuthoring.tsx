import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, CircleHelp, GitCompareArrows, Plus, Workflow } from "lucide-react"
import { uiText } from "@shared/i18n/ui"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { WorkflowCatalogEntry } from "@services/command/workflowCatalog"
import {
  workflowProposalError, workflowProposals,
  type PublishedWorkflow, type WorkflowDraftProposal, type WorkflowProposal,
} from "@services/workflow/workflowProposals"

const isPending = (run: WorkflowProposal) => run.status === "queued" || run.status === "running"
const formatJson = (value: unknown) => JSON.stringify(value, null, 2)
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

type FieldChange = { field: string; before: unknown; after: unknown }
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>, prefix = ""): FieldChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].flatMap((key) => {
    const previous = before[key], next = after[key]
    if (sameJson(previous, next)) return []
    if (!prefix && isRecord(previous) && isRecord(next)) return changedFields(previous, next, `${key}.`)
    return [{ field: `${prefix}${key}`, before: previous, after: next }]
  })
}

function fieldValue(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? "—")
}

function ProposalReview({ proposal, projectName }: { proposal: WorkflowDraftProposal; projectName?: string }) {
  const { definition, base } = proposal
  const before = base?.definition
  const oldSteps = new Map(before?.steps.map((step) => [step.id, step]))
  const nextIds = new Set(definition.steps.map((step) => step.id))
  const removed = before?.steps.filter((step) => !nextIds.has(step.id)) ?? []
  const changedSections = before ? [
    !sameJson(before.plan, definition.plan) && uiText("workflow_authoring_plan"),
    !sameJson(before.input_schema, definition.input_schema) && uiText("workflow_authoring_inputs"),
    !sameJson(before.output_schema, definition.output_schema) && uiText("workflow_authoring_outputs"),
    !sameJson(before.budgets, definition.budgets) && uiText("workflow_authoring_budgets"),
  ].filter(Boolean) : []
  return <div className="space-y-4">
    <div className="flex items-start gap-3">
      <div className="rounded-lg bg-primary/10 p-2 text-primary"><Workflow aria-hidden="true" className="size-5" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{projectName ?? proposal.project_id}</span>
          <span className="rounded-full bg-muted px-2 py-0.5">
            {before ? `r${before.revision} → r${definition.revision}` : `r${definition.revision}`}
          </span>
        </div>
        <h3 className="break-words text-base font-semibold">{definition.id}</h3>
        {base && base.description !== proposal.description ? <div className="mt-1 grid gap-1 rounded-md bg-muted p-2 text-sm sm:grid-cols-2">
          <p className="min-w-0 break-words text-muted-foreground">r{base.definition.revision} · {base.description}</p>
          <p className="min-w-0 break-words">r{definition.revision} · {proposal.description}</p>
        </div> : <p className="break-words text-sm text-muted-foreground">{proposal.description}</p>}
      </div>
    </div>
    <ol className="divide-y rounded-lg border bg-background" aria-label={uiText("workflow_authoring_proposed_steps")}>
      {definition.steps.map((step, index) => {
        const old = oldSteps.get(step.id)
        const changes = old ? changedFields(old, step) : []
        const change = before && (!old ? uiText("workflow_authoring_added")
          : changes.length ? uiText("workflow_authoring_changed") : null)
        return <li key={step.id}>
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="w-8 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 flex-1 break-words font-medium">{step.id}</span>
            <span className="min-w-0 break-words text-xs text-muted-foreground">{step.tool ?? step.agent ?? step.type}</span>
            {change ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{change}</span> : null}
          </div>
          {before && changes.length ? <dl className="space-y-2 px-3 pb-3 text-xs">
            {changes.slice(0, 4).map(({ field, before: previous, after: next }) => <div key={field} className="rounded-md bg-muted p-2">
              <dt className="break-all font-mono font-medium">{field}</dt>
              <dd className="mt-1 grid gap-1 sm:grid-cols-2">
                <span className="min-w-0 break-all text-muted-foreground">r{before.revision} · {fieldValue(previous)}</span>
                <span className="min-w-0 break-all">r{definition.revision} · {fieldValue(next)}</span>
              </dd>
            </div>)}
          </dl> : null}
        </li>
      })}
      {removed.map((step) => <li key={step.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
        <span className="min-w-0 break-words text-muted-foreground line-through">{step.id}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{uiText("workflow_authoring_removed")}</span>
      </li>)}
    </ol>
    {changedSections.length ? <p className="text-xs text-muted-foreground">{changedSections.join(" · ")}</p> : null}
    <details className="rounded-lg border bg-background text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium">
        {base ? <GitCompareArrows aria-hidden="true" className="size-4" /> : <ChevronDown aria-hidden="true" className="size-4" />}
        {uiText(base ? "workflow_authoring_compare" : "workflow_authoring_definition")}
      </summary>
      <div className={`grid gap-3 border-t p-3 ${base ? "sm:grid-cols-2" : ""}`}>
        {before ? <div className="min-w-0">
          <p className="mb-1 text-xs text-muted-foreground">r{before.revision}</p>
          <pre className="max-h-52 overflow-auto rounded-md bg-muted p-2 text-xs">{formatJson(before)}</pre>
        </div> : null}
        <div className="min-w-0">
          <p className="mb-1 text-xs text-muted-foreground">r{definition.revision}</p>
          <pre className="max-h-52 overflow-auto rounded-md bg-muted p-2 text-xs">{formatJson(definition)}</pre>
        </div>
      </div>
    </details>
  </div>
}

export default function WorkflowAuthoring({ sessionId, projectName, projectId, entries, initialRunId, onUse }: {
  sessionId: string
  projectName?: string
  projectId?: string | null
  entries: WorkflowCatalogEntry[]
  initialRunId?: string
  onUse: (publication: PublishedWorkflow) => void
}) {
  const [instruction, setInstruction] = useState("")
  const [target, setTarget] = useState("")
  const [runId, setRunId] = useState(initialRunId)
  const [run, setRun] = useState<WorkflowProposal | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [retryRead, setRetryRead] = useState(0)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [published, setPublished] = useState<PublishedWorkflow | null>(null)
  const mounted = useRef(false)
  const pendingRequest = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (!runId) return
    const controller = new AbortController()
    let timeout: number | undefined
    const read = async () => {
      try {
        const latest = await workflowProposals.read(sessionId, runId, controller.signal)
        if (controller.signal.aborted) return
        setRun(latest)
        if (isPending(latest)) timeout = window.setTimeout(() => { void read() }, 1_250)
      } catch (error) {
        if (!controller.signal.aborted) setReadError(workflowProposalError(error, "read"))
      }
    }
    void read()
    return () => { controller.abort(); window.clearTimeout(timeout) }
  }, [sessionId, runId, retryRead])

  const generate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!instruction.trim() || pendingRequest.current || projectId === null) return
    pendingRequest.current = true
    setGenerating(true)
    setWriteError(null)
    try {
      const started = await workflowProposals.start(sessionId, instruction.trim(), target || undefined)
      if (mounted.current) { setRun(started); setRunId(started.run_id) }
    } catch (error) {
      if (mounted.current) setWriteError(workflowProposalError(error, "start"))
    } finally {
      pendingRequest.current = false
      if (mounted.current) setGenerating(false)
    }
  }
  const publish = async (proposal: WorkflowDraftProposal) => {
    if (pendingRequest.current || published || writeError) return
    pendingRequest.current = true
    setSaving(true)
    try {
      const saved = await workflowProposals.publish(sessionId, proposal)
      if (mounted.current) setPublished(saved)
    } catch (error) {
      if (mounted.current) setWriteError(workflowProposalError(error, "save"))
    } finally {
      pendingRequest.current = false
      if (mounted.current) setSaving(false)
    }
  }
  const edit = () => {
    setRunId(undefined)
    setRun(null)
    setReadError(null)
    setWriteError(null)
    setPublished(null)
  }

  const result = run?.result
  const draft = result?.decision === "draft" ? result : null
  const busy = saving || generating

  return <section className="space-y-4 rounded-xl border bg-muted/20 p-4" aria-labelledby="workflow-authoring-heading">
    <div>
      <h2 id="workflow-authoring-heading" className="text-base font-semibold">{uiText(draft ? "workflow_authoring_review" : "workflow_authoring_title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{uiText("workflow_authoring_hint")}</p>
    </div>
    {runId ? <>
      {readError ? <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">{readError}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => { setReadError(null); setRetryRead((value) => value + 1) }}>
          {uiText("workflow_run_refresh")}
        </Button>
      </div> : !run || isPending(run) ? <p role="status" className="text-sm text-muted-foreground">
        {uiText("workflow_authoring_generating")}
      </p> : draft ? <ProposalReview proposal={draft} projectName={projectId === draft.project_id ? projectName : undefined} />
        : result?.decision === "clarify" ? <div className="flex items-start gap-2 rounded-lg border bg-background p-3 text-sm">
          <CircleHelp aria-hidden="true" className="size-4 shrink-0" /><p className="break-words">{result.question}</p>
        </div> : result?.decision === "no_change" ? <p role="status" className="text-sm text-muted-foreground">
          {uiText("workflow_authoring_no_change")}
        </p> : <p role="alert" className="text-sm text-destructive">{uiText("workflow_authoring_draft_failed")}</p>}
      {published ? <p role="status" className="flex items-center gap-2 text-sm text-foreground">
        <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
        {uiText(published.catalogAvailable ? "workflow_authoring_saved" : "workflow_authoring_saved_refresh", { v0: published.revision })}
      </p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={edit}>
          {uiText("workflow_authoring_edit")}
        </Button>
        {published ? <Button type="button" size="sm" onClick={() => onUse(published)}>{uiText("workflow_authoring_view_run")}</Button>
          : draft ? <Button type="button" size="sm" disabled={busy || !!writeError} onClick={() => { void publish(draft) }}>
            {uiText(saving ? "workflow_authoring_saving" : "workflow_authoring_save")}
          </Button> : null}
      </div>
    </> : <form className="space-y-3" onSubmit={generate}>
      {projectId === null ? <p className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
        {uiText("workflow_authoring_project_required")}
      </p> : <>
        {projectName ? <p className="text-xs text-muted-foreground">{uiText("workflow_authoring_project", { v0: projectName })}</p> : null}
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">{uiText("workflow_authoring_target")}</span>
          <select className="h-9 w-full rounded-md border bg-background px-2" value={target} disabled={busy}
            onChange={(event) => setTarget(event.target.value)}>
            <option value="">{uiText("workflow_authoring_new")}</option>
            {entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · r{entry.revision}</option>)}
          </select>
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">{uiText("workflow_authoring_instruction")}</span>
          <Textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={4}
            maxLength={2_000} disabled={busy} placeholder={uiText("workflow_authoring_example")} />
        </label>
        <Button type="submit" size="sm" disabled={busy || !instruction.trim()}>
          <Plus aria-hidden="true" className="size-4" />
          {uiText(generating ? "workflow_authoring_generating" : "workflow_authoring_generate")}
        </Button>
      </>}
    </form>}
    {writeError ? <p role="alert" className="text-sm text-destructive">{writeError}</p> : null}
  </section>
}
