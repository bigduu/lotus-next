import { useRef } from "react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import type { SnapshotRef } from "@services/tickets/types"
import type { SprintCounts, SprintFilter, SprintStatus } from "@services/tickets/sprints"
import { useProjectSprints } from "@/hooks/useProjectSprints"
import { Button } from "@/components/ui/button"
import { SprintOwnerControls } from "./SprintOwnerControls"
import { sprintOwnerControlsCopy } from "./sprintOwnerControlsCopy"

const statusText = (status: SprintStatus) => uiText(({ planned: "project_sprint_planned", active: "project_sprint_active", closed: "project_sprint_closed" } as const)[status])
const countsText = (counts: SprintCounts) => uiText("project_sprint_counts", { ...counts })
export function ProjectSprintPanel({ projectId, projectActive, snapshot, owner, filter, onFilterChange, onRefresh }: {
  projectId: string; projectActive: boolean; snapshot: SnapshotRef | null; owner: boolean; filter: SprintFilter | null
  onFilterChange: (filter: SprintFilter | null) => void; onRefresh: () => void
}) {
  useUiLocale()
  const selectedId = filter?.kind === "sprint" ? filter.sprint_id : null
  const sprints = useProjectSprints(projectId, snapshot, selectedId, owner, onRefresh)
  const selected = sprints.inspection?.data
  const retained = useRef<{ projectId: string; selectedId: string | null; view: typeof selected; list: NonNullable<typeof sprints.list>["data"] } | null>(null)
  if (sprints.status === "available") retained.current = { projectId, selectedId, view: selected, list: sprints.list?.data ?? [] }
  const editor = retained.current?.projectId === projectId && retained.current.selectedId === selectedId ? retained.current : null
  const value = selectedId ? `sprint:${selectedId}` : filter?.kind ?? "all"
  const change = (value: string) => onFilterChange(value === "all" ? null : value === "backlog" ? { kind: "backlog" } : { kind: "sprint", sprint_id: value.slice(7) })
  return <section className="mb-3 min-w-0 rounded-lg border p-3 text-sm" aria-label={uiText("project_sprint_title")} data-testid="project-sprint-panel">
    <label className="flex flex-wrap items-center gap-2"><span className="font-medium">{uiText("project_sprint_filter")}</span>
      <select aria-label={uiText("project_sprint_filter")} value={value} disabled={!owner} onChange={(event) => change(event.target.value)} className="min-w-0 max-w-xs rounded-md border bg-background p-2 text-sm focus-visible:ring-2 focus-visible:ring-ring" data-testid="project-sprint-filter">
        <option value="all">{uiText("project_sprint_all")}</option>
        <option value="backlog" disabled={sprints.status !== "available"}>{uiText("project_sprint_backlog")}</option>
        {selectedId && !sprints.list?.data.some((item) => item.id === selectedId) ? <option value={value}>{selectedId}</option> : null}
        {sprints.list?.data.map((item) => <option key={item.id} value={`sprint:${item.id}`}>{item.definition.name} · {statusText(item.status)}</option>)}
      </select>
      {sprints.list?.next_cursor ? <Button size="sm" variant="outline" disabled={sprints.moreBusy} onClick={() => void sprints.loadMore()}>{uiText("project_sprint_more")}</Button> : null}
    </label>
    {sprints.status === "unsupported" && owner ? <p role="status" className="mt-2 text-xs text-muted-foreground">{uiText("project_sprint_unsupported")}</p> : null}
    {sprints.error ? <p role="status" className="mt-2 break-words text-xs text-destructive">{uiText("project_sprint_error")} {sprints.error}</p> : null}
    {sprints.status === "loading" && owner ? <p role="status" className="mt-2 text-xs text-muted-foreground">{uiText("project_work_loading")}</p> : null}
    {sprints.list && !sprints.list.data.length ? <p className="mt-2 text-xs text-muted-foreground">{uiText("project_sprint_no_sprints")}</p> : null}
    {filter?.kind === "backlog" ? <p className="mt-2 text-xs text-muted-foreground">{uiText("project_sprint_backlog_hint")}</p> : null}
    {selected ? <div className="mt-3 min-w-0 space-y-2" data-testid="project-sprint-summary">
      <h3 className="break-words font-semibold">{selected.sprint.definition.name} · {statusText(selected.sprint.status)}</h3>
      <p className="whitespace-pre-wrap break-words">{selected.sprint.definition.goal}</p>
      {selected.sprint.status === "closed" ? <p className="text-xs text-muted-foreground">{uiText("project_sprint_closed_hint")}</p> : null}
      <dl className="grid min-w-0 gap-1 break-words text-xs">
        <dt className="font-medium">{uiText("project_sprint_current")}</dt><dd data-testid="project-sprint-current-counts">{countsText(selected.current_counts)}</dd>
        <dd className="break-all text-muted-foreground">{uiText("project_sprint_snapshot", { seq: sprints.inspection!.snapshot.seq, commit: sprints.inspection!.snapshot.commit })}</dd>
        {selected.sprint.closure ? <><dt className="mt-2 font-medium">{uiText("project_sprint_closure")}</dt><dd data-testid="project-sprint-closure-counts">{countsText(selected.sprint.closure.counts)}</dd>
          <dd className="break-all text-muted-foreground">{uiText("project_sprint_closing_snapshot", { closed: selected.sprint.closure.closed_seq, source: selected.sprint.closure.source_seq, commit: selected.sprint.closure.source_commit })}</dd></> : null}
      </dl>
      <details><summary className="cursor-pointer text-xs">{uiText("project_sprint_history")} · {uiText("project_sprint_members", { count: selected.sprint.members.length })}</summary>
        <ul className="mt-2 space-y-2 text-xs">{selected.sprint.history.map((event, index) => <li key={`${event.operation_id}:${event.work_id}:${index}`} className="break-all">
          {uiText(({ added: "project_sprint_history_added", removed: "project_sprint_history_removed", carried_in: "project_sprint_history_carried_in", carried_out: "project_sprint_history_carried_out" } as const)[event.change.kind])} · {event.work_id}
          {event.change.kind === "carried_in" ? ` ← ${event.change.from}` : event.change.kind === "carried_out" ? ` → ${event.change.to ?? uiText("project_sprint_backlog")}` : ""}
          <span className="block text-muted-foreground">{event.principal} · {event.source}</span>
        </li>)}</ul>
      </details>
    </div> : null}
    {editor && owner ? <div className="mt-3"><p className="mb-2 text-xs text-muted-foreground">{uiText("project_sprint_scope_hint")}</p>
      {!sprints.canWrite && !sprints.sending && !sprints.request ? <p role="status" className="mb-2 text-xs text-muted-foreground">{uiText("project_sprint_scope_stale")}</p> : null}
      <SprintOwnerControls projectId={projectId} view={editor.view ?? null} sprints={editor.list} canWrite={sprints.canWrite && projectActive} busy={sprints.sending}
        request={sprints.request} onCommand={async (id, action) => { if (projectActive) await sprints.command(id, action) }} onReconcile={sprints.reconcile} onReviewLatest={sprints.reviewLatest} copy={sprintOwnerControlsCopy()} />
    </div> : null}
  </section>
}
