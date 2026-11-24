import { createEffect, createSignal, For, Show } from "solid-js"
import type { SprintCounts, SprintFilter, SprintStatus, SprintSummary, SprintView } from "@services/tickets/sprints"
import type { SnapshotRef } from "@services/tickets/types"

import { createUiText } from "../shell/uiText"
import { Button } from "../ui/button"
import { createProjectSprints } from "./createProjectSprints"
import { SprintOwnerControls } from "./SprintOwnerControls"
import { sprintOwnerControlsCopy } from "./sprintOwnerControlsCopy"

const statusKeys = { planned: "project_sprint_planned", active: "project_sprint_active", closed: "project_sprint_closed" } as const
const historyKeys = { added: "project_sprint_history_added", removed: "project_sprint_history_removed",
  carried_in: "project_sprint_history_carried_in", carried_out: "project_sprint_history_carried_out" } as const

export function ProjectSprintPanel(props: {
  projectId: string
  projectActive: boolean
  snapshot: SnapshotRef | null
  owner: boolean
  filter: SprintFilter | null
  onFilterChange: (filter: SprintFilter | null) => void
  onRefresh: () => void
}) {
  const text = createUiText()
  const statusText = (status: SprintStatus) => text(statusKeys[status])
  const countsText = (counts: SprintCounts) => text("project_sprint_counts", { ...counts })
  const selectedId = () => props.filter?.kind === "sprint" ? props.filter.sprint_id : null
  const sprints = createProjectSprints(() => props.projectId, () => props.snapshot, selectedId, () => props.owner, props.onRefresh)
  const selected = () => sprints.inspection()?.data
  const [retained, setRetained] = createSignal<{ projectId: string; selectedId: string | null; view: SprintView | null; list: SprintSummary[] } | null>(null)
  createEffect(() => sprints.status() === "available" ? {
    projectId: props.projectId, selectedId: selectedId(), view: selected() ?? null, list: sprints.list()?.data ?? [],
  } : null, (available) => { if (available) setRetained(available) })
  const editor = () => {
    const candidate = retained()
    return candidate?.projectId === props.projectId && candidate.selectedId === selectedId() ? candidate : null
  }
  const value = () => selectedId() ? `sprint:${selectedId()}` : props.filter?.kind ?? "all"
  const change = (value: string) => props.onFilterChange(value === "all" ? null
    : value === "backlog" ? { kind: "backlog" } : { kind: "sprint", sprint_id: value.slice(7) })

  return (
    <section class="mb-3 min-w-0 rounded-lg border p-3 text-sm" aria-label={text("project_sprint_title")} data-testid="project-sprint-panel">
      <label class="flex flex-wrap items-center gap-2">
        <span class="font-medium">{text("project_sprint_filter")}</span>
        <select aria-label={text("project_sprint_filter")} value={value()} disabled={!props.owner}
          onChange={(event) => change(event.currentTarget.value)}
          class="min-w-0 max-w-xs rounded-md border bg-background p-2 text-sm focus-visible:ring-2 focus-visible:ring-ring" data-testid="project-sprint-filter">
          <option value="all" selected={value() === "all"}>{text("project_sprint_all")}</option>
          <option value="backlog" selected={value() === "backlog"} disabled={sprints.status() !== "available"}>{text("project_sprint_backlog")}</option>
          <Show when={selectedId() && !sprints.list()?.data.some((item) => item.id === selectedId())}>
            <option value={value()} selected>{selectedId()}</option>
          </Show>
          <For each={sprints.list()?.data ?? []} keyed={(item) => item.id}>{(item) => (
            <option value={`sprint:${item().id}`} selected={value() === `sprint:${item().id}`}>
              {item().definition.name} · {statusText(item().status)}
            </option>
          )}</For>
        </select>
        <Show when={sprints.list()?.next_cursor}>
          <Button size="sm" variant="outline" disabled={sprints.moreBusy()} onClick={() => void sprints.loadMore()}>{text("project_sprint_more")}</Button>
        </Show>
      </label>
      <Show when={sprints.status() === "unsupported" && props.owner}>
        <p role="status" class="mt-2 text-xs text-muted-foreground">{text("project_sprint_unsupported")}</p>
      </Show>
      <Show when={sprints.error()}><p role="status" class="mt-2 break-words text-xs text-destructive">{text("project_sprint_error")} {sprints.error()}</p></Show>
      <Show when={sprints.status() === "loading" && props.owner}>
        <p role="status" class="mt-2 text-xs text-muted-foreground">{text("project_work_loading")}</p>
      </Show>
      <Show when={sprints.list() && !sprints.list()!.data.length}>
        <p class="mt-2 text-xs text-muted-foreground">{text("project_sprint_no_sprints")}</p>
      </Show>
      <Show when={props.filter?.kind === "backlog"}><p class="mt-2 text-xs text-muted-foreground">{text("project_sprint_backlog_hint")}</p></Show>
      <Show when={selected()}>{(selection) => (
        <div class="mt-3 min-w-0 space-y-2" data-testid="project-sprint-summary">
          <h3 class="break-words font-semibold">{selection().sprint.definition.name} · {statusText(selection().sprint.status)}</h3>
          <p class="whitespace-pre-wrap break-words">{selection().sprint.definition.goal}</p>
          <Show when={selection().sprint.status === "closed"}>
            <p class="text-xs text-muted-foreground">{text("project_sprint_closed_hint")}</p>
          </Show>
          <dl class="grid min-w-0 gap-1 break-words text-xs">
            <dt class="font-medium">{text("project_sprint_current")}</dt>
            <dd data-testid="project-sprint-current-counts">{countsText(selection().current_counts)}</dd>
            <dd class="break-all text-muted-foreground">{text("project_sprint_snapshot", {
              seq: sprints.inspection()?.snapshot.seq, commit: sprints.inspection()?.snapshot.commit,
            })}</dd>
            <Show when={selection().sprint.closure}>{(closure) => (
              <>
                <dt class="mt-2 font-medium">{text("project_sprint_closure")}</dt>
                <dd data-testid="project-sprint-closure-counts">{countsText(closure().counts)}</dd>
                <dd class="break-all text-muted-foreground">{text("project_sprint_closing_snapshot", {
                  closed: closure().closed_seq, source: closure().source_seq, commit: closure().source_commit,
                })}</dd>
              </>
            )}</Show>
          </dl>
          <details>
            <summary class="cursor-pointer text-xs">
              {text("project_sprint_history")} · {text("project_sprint_members", { count: selection().sprint.members.length })}
            </summary>
            <ul class="mt-2 space-y-2 text-xs">
              <For each={selection().sprint.history}>{(event) => (
                <li class="break-all">
                  {text(historyKeys[event.change.kind])} · {event.work_id}
                  {event.change.kind === "carried_in" ? ` ← ${event.change.from}`
                    : event.change.kind === "carried_out" ? ` → ${event.change.to ?? text("project_sprint_backlog")}` : ""}
                  <span class="block text-muted-foreground">{event.principal} · {event.source}</span>
                </li>
              )}</For>
            </ul>
          </details>
        </div>
      )}</Show>
      <Show when={props.owner && editor()}>{(current) => (
        <div class="mt-3">
          <p class="mb-2 text-xs text-muted-foreground">{text("project_sprint_scope_hint")}</p>
          <Show when={!sprints.canWrite() && !sprints.sending() && !sprints.request()}>
            <p role="status" class="mb-2 text-xs text-muted-foreground">{text("project_sprint_scope_stale")}</p>
          </Show>
          <SprintOwnerControls projectId={props.projectId} view={current().view} sprints={current().list}
            canWrite={sprints.canWrite() && props.projectActive} busy={sprints.sending()} request={sprints.request()}
            onCommand={async (id, action) => { if (props.projectActive) await sprints.command(id, action) }}
            onReconcile={sprints.reconcile} onReviewLatest={sprints.reviewLatest} copy={sprintOwnerControlsCopy(text)} />
        </div>
      )}</Show>
    </section>
  )
}
