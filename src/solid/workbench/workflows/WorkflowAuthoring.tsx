import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { Check, ChevronDown, CircleHelp, GitCompareArrows, Plus, Workflow } from "@lucide/solid"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Textarea } from "../../ui/textarea"
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

function ProposalReview(props: { proposal: WorkflowDraftProposal; projectName?: string }) {
  const text = createUiText()
  const { definition, base } = props.proposal
  const before = base?.definition
  const oldSteps = new Map(before?.steps.map((step) => [step.id, step]))
  const nextIds = new Set(definition.steps.map((step) => step.id))
  const removed = before?.steps.filter((step) => !nextIds.has(step.id)) ?? []
  const changedSections = createMemo(() => before ? [
    !sameJson(before.plan, definition.plan) && text("workflow_authoring_plan"),
    !sameJson(before.input_schema, definition.input_schema) && text("workflow_authoring_inputs"),
    !sameJson(before.output_schema, definition.output_schema) && text("workflow_authoring_outputs"),
    !sameJson(before.budgets, definition.budgets) && text("workflow_authoring_budgets"),
  ].filter(Boolean) : [])
  return <div class="space-y-4">
    <div class="flex items-start gap-3">
      <div class="rounded-lg bg-primary/10 p-2 text-primary"><Workflow aria-hidden="true" class="size-5" /></div>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{props.projectName ?? props.proposal.project_id}</span>
          <span class="rounded-full bg-muted px-2 py-0.5">
            {before ? `r${before.revision} → r${definition.revision}` : `r${definition.revision}`}
          </span>
        </div>
        <h3 class="break-words text-base font-semibold">{definition.id}</h3>
        {base && base.description !== props.proposal.description ? <div class="mt-1 grid gap-1 rounded-md bg-muted p-2 text-sm sm:grid-cols-2">
          <p class="min-w-0 break-words text-muted-foreground">r{base.definition.revision} · {base.description}</p>
          <p class="min-w-0 break-words">r{definition.revision} · {props.proposal.description}</p>
        </div> : <p class="break-words text-sm text-muted-foreground">{props.proposal.description}</p>}
      </div>
    </div>
    <ol class="divide-y rounded-lg border bg-background" aria-label={text("workflow_authoring_proposed_steps")}>
      <For each={definition.steps}>{(step, index) => {
        const old = oldSteps.get(step.id)
        const changes = old ? changedFields(old, step) : []
        const change = () => before && (!old ? text("workflow_authoring_added")
          : changes.length ? text("workflow_authoring_changed") : null)
        return <li>
          <div class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span class="w-8 shrink-0 text-xs tabular-nums text-muted-foreground">{index() + 1}</span>
            <span class="min-w-0 flex-1 break-words font-medium">{step.id}</span>
            <span class="min-w-0 break-words text-xs text-muted-foreground">{step.tool ?? step.agent ?? step.type}</span>
            {change() ? <span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{change()}</span> : null}
          </div>
          {before && changes.length ? <dl class="space-y-2 px-3 pb-3 text-xs">
            <For each={changes.slice(0, 4)}>{({ field, before: previous, after: next }) => <div class="rounded-md bg-muted p-2">
              <dt class="break-all font-mono font-medium">{field}</dt>
              <dd class="mt-1 grid gap-1 sm:grid-cols-2">
                <span class="min-w-0 break-all text-muted-foreground">r{before.revision} · {fieldValue(previous)}</span>
                <span class="min-w-0 break-all">r{definition.revision} · {fieldValue(next)}</span>
              </dd>
            </div>}</For>
          </dl> : null}
        </li>
      }}</For>
      <For each={removed}>{(step) => <li class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
        <span class="min-w-0 break-words text-muted-foreground line-through">{step.id}</span>
        <span class="shrink-0 text-xs text-muted-foreground">{text("workflow_authoring_removed")}</span>
      </li>}</For>
    </ol>
    {changedSections().length ? <p class="text-xs text-muted-foreground">{changedSections().join(" · ")}</p> : null}
    <details class="rounded-lg border bg-background text-sm">
      <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium">
        {base ? <GitCompareArrows aria-hidden="true" class="size-4" /> : <ChevronDown aria-hidden="true" class="size-4" />}
        {text(base ? "workflow_authoring_compare" : "workflow_authoring_definition")}
      </summary>
      <div class={`grid gap-3 border-t p-3 ${base ? "sm:grid-cols-2" : ""}`}>
        {before ? <div class="min-w-0">
          <p class="mb-1 text-xs text-muted-foreground">r{before.revision}</p>
          <pre class="max-h-52 overflow-auto rounded-md bg-muted p-2 text-xs">{formatJson(before)}</pre>
        </div> : null}
        <div class="min-w-0">
          <p class="mb-1 text-xs text-muted-foreground">r{definition.revision}</p>
          <pre class="max-h-52 overflow-auto rounded-md bg-muted p-2 text-xs">{formatJson(definition)}</pre>
        </div>
      </div>
    </details>
  </div>
}

export default function WorkflowAuthoring(props: {
  sessionId: string
  projectName?: string
  projectId?: string | null
  entries: WorkflowCatalogEntry[]
  initialRunId?: string
  onUse: (publication: PublishedWorkflow) => void
}) {
  const text = createUiText()
  const sessionId = props.sessionId
  const [instruction, setInstruction] = createSignal("")
  const [target, setTarget] = createSignal("")
  const [runId, setRunId] = createSignal(props.initialRunId)
  const [run, setRun] = createSignal<WorkflowProposal | null>(null)
  const [readError, setReadError] = createSignal<string | null>(null)
  const [retryRead, setRetryRead] = createSignal(0)
  const [writeError, setWriteError] = createSignal<string | null>(null)
  const [saving, setSaving] = createSignal(false)
  const [generating, setGenerating] = createSignal(false)
  const [published, setPublished] = createSignal<PublishedWorkflow | null>(null)
  let mounted = true
  let pendingRequest = false
  onCleanup(() => { mounted = false })

  createEffect(() => [runId(), retryRead()] as const, ([id]) => {
    if (!id) return
    const controller = new AbortController()
    let timeout: number | undefined
    const read = async () => {
      try {
        const latest = await workflowProposals.read(sessionId, id, controller.signal)
        if (controller.signal.aborted || id !== runId()) return
        setRun(latest)
        if (isPending(latest)) timeout = window.setTimeout(() => { void read() }, 1_250)
      } catch (error) {
        if (!controller.signal.aborted && id === runId()) setReadError(workflowProposalError(error, "read"))
      }
    }
    void read()
    return () => { controller.abort(); window.clearTimeout(timeout) }
  })

  const generate = async (event: SubmitEvent & { currentTarget: HTMLFormElement }) => {
    event.preventDefault()
    if (!instruction().trim() || pendingRequest || props.projectId === null) return
    pendingRequest = true
    setGenerating(true)
    setWriteError(null)
    try {
      const started = await workflowProposals.start(sessionId, instruction().trim(), target() || undefined)
      if (mounted) { setRun(started); setRunId(started.run_id) }
    } catch (error) {
      if (mounted) setWriteError(workflowProposalError(error, "start"))
    } finally {
      pendingRequest = false
      if (mounted) setGenerating(false)
    }
  }
  const publish = async (proposal: WorkflowDraftProposal) => {
    if (pendingRequest || published() || writeError()) return
    pendingRequest = true
    setSaving(true)
    try {
      const saved = await workflowProposals.publish(sessionId, proposal)
      if (mounted) setPublished(saved)
    } catch (error) {
      if (mounted) setWriteError(workflowProposalError(error, "save"))
    } finally {
      pendingRequest = false
      if (mounted) setSaving(false)
    }
  }
  const edit = () => {
    setRunId(undefined)
    setRun(null)
    setReadError(null)
    setWriteError(null)
    setPublished(null)
  }

  const result = () => run()?.result
  const draft = createMemo(() => {
    const value = result()
    return value?.decision === "draft" ? value : null
  })
  const clarification = createMemo(() => {
    const value = result()
    return value?.decision === "clarify" ? value : null
  })
  const busy = () => saving() || generating()

  return (
    <section class="space-y-4 rounded-xl border bg-muted/20 p-4" aria-labelledby="workflow-authoring-heading">
      <div>
        <h2 id="workflow-authoring-heading" class="text-base font-semibold">{text(draft() ? "workflow_authoring_review" : "workflow_authoring_title")}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{text("workflow_authoring_hint")}</p>
      </div>
      <Show when={runId()} fallback={
        <form class="space-y-3" onSubmit={(event) => void generate(event)}>
          <Show when={props.projectId !== null} fallback={
            <p class="rounded-lg border bg-background p-3 text-sm text-muted-foreground">{text("workflow_authoring_project_required")}</p>
          }>
            <Show when={props.projectName}>{(name) => (
              <p class="text-xs text-muted-foreground">{text("workflow_authoring_project", { v0: name() })}</p>
            )}</Show>
            <label class="block space-y-1.5 text-sm">
              <span class="font-medium">{text("workflow_authoring_target")}</span>
              <select class="h-9 w-full rounded-md border bg-background px-2" value={target()} disabled={busy()}
                onChange={(event) => setTarget(event.currentTarget.value)}>
                <option value="">{text("workflow_authoring_new")}</option>
                <For each={props.entries} keyed={(entry) => entry.id}>{(entry) => (
                  <option value={entry().id} selected={entry().id === target()}>{entry().name} · r{entry().revision}</option>
                )}</For>
              </select>
            </label>
            <label class="block space-y-1.5 text-sm">
              <span class="font-medium">{text("workflow_authoring_instruction")}</span>
              <Textarea value={instruction()} onInput={(event) => setInstruction(event.currentTarget.value)} rows={4}
                maxlength={2_000} disabled={busy()} placeholder={text("workflow_authoring_example")} />
            </label>
            <Button type="submit" size="sm" disabled={busy() || !instruction().trim()}>
              <Plus aria-hidden="true" class="size-4" />
              {text(generating() ? "workflow_authoring_generating" : "workflow_authoring_generate")}
            </Button>
          </Show>
        </form>
      }>
        <Switch fallback={<p role="alert" class="text-sm text-destructive">{text("workflow_authoring_draft_failed")}</p>}>
          <Match when={readError()}>
            <div class="space-y-2">
              <p role="alert" class="text-sm text-destructive">{readError()}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => { setReadError(null); setRetryRead((value) => value + 1) }}>
                {text("workflow_run_refresh")}
              </Button>
            </div>
          </Match>
          <Match when={!run() || isPending(run()!)}>
            <p role="status" class="text-sm text-muted-foreground">{text("workflow_authoring_generating")}</p>
          </Match>
          <Match when={draft()} keyed>{(proposal) => (
            <ProposalReview proposal={proposal} projectName={props.projectId === proposal.project_id ? props.projectName : undefined} />
          )}</Match>
          <Match when={clarification()}>{(current) => (
            <div class="flex items-start gap-2 rounded-lg border bg-background p-3 text-sm">
              <CircleHelp aria-hidden="true" class="size-4 shrink-0" /><p class="break-words">{current().question}</p>
            </div>
          )}</Match>
          <Match when={result()?.decision === "no_change"}>
            <p role="status" class="text-sm text-muted-foreground">{text("workflow_authoring_no_change")}</p>
          </Match>
        </Switch>
        <Show when={published()}>{(saved) => (
          <p role="status" class="flex items-center gap-2 text-sm text-foreground">
            <Check aria-hidden="true" class="size-4 shrink-0 text-primary" />
            {text(saved().catalogAvailable ? "workflow_authoring_saved" : "workflow_authoring_saved_refresh", { v0: saved().revision })}
          </p>
        )}</Show>
        <div class="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy()} onClick={edit}>
            {text("workflow_authoring_edit")}
          </Button>
          <Show when={published()} fallback={
            <Show when={draft()}>{(proposal) => (
              <Button type="button" size="sm" disabled={busy() || !!writeError()} onClick={() => void publish(proposal())}>
                {text(saving() ? "workflow_authoring_saving" : "workflow_authoring_save")}
              </Button>
            )}</Show>
          }>{(saved) => (
            <Button type="button" size="sm" onClick={() => props.onUse(saved())}>{text("workflow_authoring_view_run")}</Button>
          )}</Show>
        </div>
      </Show>
      <Show when={writeError()}><p role="alert" class="text-sm text-destructive">{writeError()}</p></Show>
    </section>
  )
}
