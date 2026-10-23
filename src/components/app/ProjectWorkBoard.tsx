import { useEffect, useState } from "react"
import "./project-work/ProjectWorkBoard.css"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import type { ProjectManifest } from "@services/project"
import { getErrorMessage } from "@services/api"
import { boardCountsKnown, projectBoardClient, type BoardStage, type BoardWorkView, type ProjectBoardRow, type ProjectContext } from "@services/tickets/projectBoard"
import type { SnapshotRef } from "@services/tickets/types"
import { useProjectWorkBoard } from "@/hooks/useProjectWorkBoard"
import { ticketWorkLabels } from "@/components/chat/ticketWorkLabels"
import { Button } from "@/components/ui/button"

const stages: BoardStage[] = ["todo", "doing", "testing", "done"]
const stageLabel = (stage: BoardStage) => uiText(({ todo: "project_work_todo", doing: "project_work_doing", testing: "project_work_testing", done: "project_work_done" } as const)[stage])
function ContextRevision({ context }: { context: Pick<ProjectContext, "project_id" | "project_revision" | "resource_revision"> | null }) {
  return <span>{context ? uiText("project_work_revision", { project: context.project_revision, resources: context.resource_revision }) : uiText("project_work_unknown")}</span>
}
function ContextDetails({ context, label, name }: { context: ProjectContext | null; label: string; name: string }) {
  return <>
    <dt className="font-medium">{label}</dt>
    <dd data-testid={`project-work-context-${name}`}><ContextRevision context={context} />{context ? <><span className="block">{uiText("project_work_contract_revision", { revision: context.contract_revision })}</span><span className="block break-all">{context.workspace_binding.path}</span></> : null}</dd>
  </>
}
function WorkDetails({ row, snapshot, onClose }: { row: ProjectBoardRow; snapshot: SnapshotRef; onClose: () => void }) {
  const [view, setView] = useState<BoardWorkView | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void projectBoardClient.inspect(row.ticket.id, snapshot, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setView(result) })
      .catch((failure) => { if (!controller.signal.aborted) setError(getErrorMessage(failure)) })
    return () => controller.abort()
  }, [row.ticket.id, snapshot])
  const assignment = view?.assignments.find((item) => item.id === row.ticket.active_assignment)
  return <section aria-label={row.ticket.contract.title} className="min-w-0 rounded-xl border bg-background p-4 text-sm" data-testid="project-work-details">
    <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 break-words font-semibold">{row.ticket.contract.title}</h3><Button size="sm" variant="ghost" onClick={onClose}>{uiText("project_work_close_details")}</Button></div>
    <h4 className="mt-3 font-medium">{uiText("project_work_contract")}</h4>
    <p className="whitespace-pre-wrap break-words">{row.ticket.contract.objective}</p>
    <ul className="list-inside list-disc break-words">{[...row.ticket.contract.constraints, ...row.ticket.contract.acceptance].map((line, i) => <li key={i}>{line}</li>)}</ul>
    <dl className="mt-3 grid gap-1 break-words">
      <dt className="font-medium">{uiText("project_work_dependencies")}</dt><dd>{row.ticket.depends_on.join(", ") || "—"}</dd>
      <ContextDetails context={row.context} label={uiText("project_work_candidate")} name="candidate" />
      {row.pending_context ? <><ContextDetails context={row.pending_context} label={uiText("project_work_pending")} name="pending" /><dd className="text-xs text-muted-foreground">{uiText("project_work_pending_hint")}</dd></> : null}
      <ContextDetails context={row.adopted_context} label={uiText("project_work_adopted")} name="adopted" />
      <dt className="font-medium">{uiText("project_work_assignment")}</dt><dd>{row.ticket.active_assignment ?? uiText("project_work_unknown")}</dd>
      {assignment ? <><dt>{uiText("project_work_session")}</dt><dd>{assignment.runtime?.session_id ?? uiText("project_work_unknown")}</dd><dt>{uiText("project_work_run")}</dt><dd>{assignment.runtime?.run_id ?? uiText("project_work_unknown")}</dd>
        {assignment.awaiting_request ? <dd>{uiText("project_work_waiting")}</dd> : null}
        {assignment.workspace ? <><dt>{uiText("project_work_repos")}</dt><dd className="break-all">{assignment.workspace.repo}<br />{assignment.workspace.branch}<br />{assignment.workspace.worktree}</dd></> : null}</> : null}
    </dl>
    {error ? <p role="alert" className="mt-2 text-destructive">{error}</p> : !view ? <p role="status">{uiText("project_work_loading")}</p> : <>
      {view.requests.some((request) => request.status === "open") ? <p className="mt-2">{uiText("project_work_waiting")}</p> : null}
      <h4 className="mt-3 font-medium">{uiText("project_work_evidence")}</h4>
      {view.submissions.filter((submission) => [row.ticket.current_submission, row.ticket.accepted_submission].includes(submission.id)).map((submission) => <div key={submission.id} className="mt-2 break-words">
        <p>{submission.stale ? uiText("ticket_previous_submission_for_reference_only_8540a39f") : submission.id === row.ticket.accepted_submission ? uiText("ticket_accepted_submission_a269d4af") : uiText("ticket_submitted_awaiting_acceptance_14447588")}</p>
        <ul className="list-inside list-disc">{submission.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul>
        <p className="text-xs text-muted-foreground">{uiText("supervisor_work_result_count", { count: submission.artifacts.length })}</p>
      </div>)}
      {!row.ticket.current_submission && !row.ticket.accepted_submission ? <p>{uiText("project_work_evidence_none")}</p> : null}
    </>}
  </section>
}
export function ProjectWorkBoard({ project }: { project: ProjectManifest }) {
  useUiLocale()
  const [mode, setMode] = useState<"list" | "board">("list")
  const [cancelled, setCancelled] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { page, error, busy, owner, refresh, loadMore } = useProjectWorkBoard(project.id, cancelled)
  const rows = page?.data.rows ?? []
  const selected = rows.find((row) => row.ticket.id === selectedId)
  const known = page && boardCountsKnown(page)
  const card = (row: ProjectBoardRow) => <button key={row.ticket.id} type="button" aria-pressed={selectedId === row.ticket.id} onClick={() => setSelectedId(row.ticket.id)} className="min-w-0 w-full rounded-lg border bg-background p-3 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" data-testid={`project-work-${row.ticket.id}`}>
    <span className="block break-words font-medium">{row.ticket.contract.title}</span>
    <span className="block text-xs text-muted-foreground">{ticketWorkLabels[row.ticket.state]}</span>
    {row.ticket.blocked ? <span className="mt-1 block break-words">{uiText("ticket_blocked_9059acb4")}: {row.ticket.blocked.reason}</span> : null}
    {row.ticket.paused ? <span className="block">{uiText("project_work_paused")}</span> : null}
    <span className="mt-2 block text-xs text-muted-foreground">{row.ticket.current_submission || row.ticket.accepted_submission ? uiText("project_work_evidence_pending") : uiText("project_work_evidence_none")}</span>
    {row.pending_context ? <span className="block text-xs">{uiText("project_work_pending")}</span> : null}
  </button>
  return <div className="min-h-0 overflow-y-auto p-4" data-testid="project-work-board">
    <p className="mb-3 text-xs text-muted-foreground">{uiText("project_work_readonly")}</p>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Button size="sm" variant={mode === "list" ? "default" : "outline"} aria-pressed={mode === "list"} onClick={() => setMode("list")}>{uiText("project_work_list")}</Button>
      <Button size="sm" variant={mode === "board" ? "default" : "outline"} aria-pressed={mode === "board"} onClick={() => setMode("board")}>{uiText("project_work_board")}</Button>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cancelled} onChange={(event) => { setSelectedId(null); setCancelled(event.target.checked) }} />{uiText("project_work_cancelled")}</label>
      <Button size="sm" variant="ghost" disabled={busy || !owner} onClick={refresh}>{uiText("refresh_aee88743")}</Button>
    </div>
    <details className="mb-3 rounded-lg border p-3 text-xs"><summary className="cursor-pointer">{uiText("project_work_context")}</summary>
      <p className="mt-2"><ContextRevision context={{ project_id: project.id, project_revision: project.revision, resource_revision: project.resource_revision }} /></p>
      <p className="mt-2 font-medium">{uiText("project_work_repos")}</p>
      <ul>{project.project_path && !project.workspace_bindings.some((binding) => binding.path === project.project_path) ? <li className="break-all">{project.project_path}</li> : null}{project.workspace_bindings.map((binding) => <li key={binding.path} className="break-all">{binding.label ? `${binding.label}: ` : ""}{binding.path}</li>)}</ul>
    </details>
    {!owner ? <p role="status">{uiText("project_work_access")}</p> : null}
    {error ? <p role="alert" className="mb-3 text-sm text-destructive">{error}</p> : null}
    {page && !known ? <p role="status" className="mb-3 text-sm">{uiText("project_work_partial")}</p> : null}
    {page ? <p className="mb-3 text-xs text-muted-foreground">{stages.map((stage) => `${stageLabel(stage)}: ${known ? page.data.counts[stage] : "?"}`).join(" · ")} · {uiText("ticket_blocked_9059acb4")}: {known ? page.data.counts.blocked : "?"} · {uiText("cancelled_a37778f1")}: {known ? page.data.counts.cancelled : "?"}</p> : null}
    {mode === "list" ? <div className="grid gap-2">{rows.map(card)}</div> : <div className="project-work-stages grid grid-cols-1 gap-3">{stages.map((stage) => <section key={stage} aria-label={stageLabel(stage)} className="min-w-0 rounded-xl bg-muted/40 p-2"><h3 className="mb-2 text-sm font-medium">{stageLabel(stage)}</h3><div className="grid gap-2">{rows.filter((row) => row.stage === stage).map(card)}</div></section>)}</div>}
    {mode === "board" && rows.some((row) => row.stage === null) ? <section className="mt-3"><h3 className="mb-2 text-sm font-medium">{uiText("project_work_other")}</h3><div className="grid gap-2">{rows.filter((row) => row.stage === null).map(card)}</div></section> : null}
    {page && !rows.length ? <p className="py-4 text-sm text-muted-foreground">{uiText("project_work_empty")}</p> : null}
    {busy ? <p role="status" className="mt-3 text-sm">{uiText("project_work_loading")}</p> : null}
    {page?.next_cursor ? <Button className="mt-3" variant="outline" disabled={busy} onClick={() => void loadMore()}>{uiText("project_work_more")}</Button> : null}
    {selected && page ? <div className="mt-4"><WorkDetails key={`${page.snapshot.commit}:${selected.ticket.id}`} row={selected} snapshot={page.snapshot} onClose={() => setSelectedId(null)} /></div> : null}
  </div>
}
