import { createMemo, createSignal, For, Show } from "solid-js"

import "@/lib/project-work/ProjectWorkBoard.css"
import type { WorkCommandContext } from "@/lib/project-work/projectWorkControls"
import { ticketWorkLabels } from "@services/tickets/ticketWorkLabels"
import type { ProjectManifest } from "@services/project"
import { boardCountsKnown, type BoardStage, type ProjectBoardRow } from "@services/tickets/projectBoard"
import type { SprintFilter } from "@services/tickets/sprints"
import type { SnapshotRef } from "@services/tickets/types"

import { createUiLocale, createUiText } from "../shell/uiText"
import { Button } from "../ui/button"
import { createProjectWorkBoard } from "./createProjectWorkBoard"
import { ProjectSprintPanel } from "./ProjectSprintPanel"
import { ProjectWorkOwnerControls, ProjectWorkPlanningControls, type ProjectWorkOwnerControlsProps, type ProjectWorkPlanningControlsProps } from "./ProjectWorkControls"
import { projectWorkControlsCopy } from "./projectWorkControlsCopy"
import { ContextRevision, WorkDetails, type OpenWorkSession } from "./WorkDetails"

export type { OpenWorkSession } from "./WorkDetails"
export interface ProjectWorkBoardControls {
  planning?: Omit<ProjectWorkPlanningControlsProps, "copy"> | null
  owner?: Omit<ProjectWorkOwnerControlsProps, "copy"> | null
}

export interface ProjectWorkBoardProps {
  project: ProjectManifest
  ownerAccess: boolean
  controls?: ProjectWorkBoardControls
  onOpenSession?: OpenWorkSession
}

const stages = { todo: "project_work_todo", doing: "project_work_doing", testing: "project_work_testing", done: "project_work_done" } as const
const stageNames = Object.keys(stages) as BoardStage[]

function matchesSelectedWork(work: ProjectWorkPlanningControlsProps["work"], row: ProjectBoardRow) {
  return work.id === row.ticket.id && work.generation === row.ticket.generation
    && work.recordRevision === row.ticket.record_revision && work.state === row.ticket.state
}

function commandAtSnapshot(command: WorkCommandContext | null | undefined, row: ProjectBoardRow, snapshot: SnapshotRef) {
  return command?.binding?.scope_id === row.ticket.scope_id && command.expectedSeq === snapshot.seq
    && command.expectedEpoch === snapshot.authority_epoch ? command : null
}

export function ProjectWorkBoard(props: ProjectWorkBoardProps) {
  const text = createUiText()
  const locale = createUiLocale()
  const [mode, setMode] = createSignal<"list" | "board">("board")
  const [cancelled, setCancelled] = createSignal(false)
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [filter, setFilter] = createSignal<SprintFilter | null>(null)
  const [planningOpen, setPlanningOpen] = createSignal(false)
  const board = createProjectWorkBoard(
    () => props.project.id, cancelled, filter, () => props.ownerAccess,
    (displayed) => {
      const id = selectedId()
      return !planningOpen() && (!id || !displayed.data.rows.some((row) => row.ticket.id === id))
    },
  )
  const page = board.page
  const rows = () => page()?.data.rows ?? []
  const unplaced = createMemo(() => rows().filter((row) => row.stage === null))
  const selected = createMemo(() => rows().find((row) => row.ticket.id === selectedId()))
  const detailKey = createMemo(() => {
    const item = selected()?.ticket
    const snapshot = page()?.snapshot
    return item && snapshot ? JSON.stringify([
      props.project.id, snapshot.commit, snapshot.seq, snapshot.authority_epoch, item.id, item.generation,
      item.active_assignment, item.record_revision,
    ]) : null
  })
  const planning = createMemo(() => {
    const row = selected(), controls = props.controls?.planning
    return row && controls && matchesSelectedWork(controls.work, row) ? controls : null
  })
  const ownerControls = createMemo(() => {
    const row = selected(), controls = props.controls?.owner
    return row && controls && matchesSelectedWork(controls.work, row)
      && controls.work.contractRevision === row.ticket.contract_revision
      && controls.work.currentSubmissionId === row.ticket.current_submission ? controls : null
  })
  const staleControls = () => {
    const id = selected()?.ticket.id
    return id && ((props.controls?.planning?.work.id === id && !planning()) || (props.controls?.owner?.work.id === id && !ownerControls()))
  }
  const ownerCommands = createMemo(() => {
    const commands = ownerControls()?.commands, row = selected(), snapshot = page()?.snapshot
    return commands && row && snapshot
      ? Object.fromEntries(Object.entries(commands).filter(([, command]) => commandAtSnapshot(command, row, snapshot))) : {}
  })
  const count = (key: keyof NonNullable<ReturnType<typeof page>>["data"]["counts"]) => {
    const current = page()
    return current && boardCountsKnown(current) ? current.data.counts[key] : "?"
  }
  const stageLabel = (stage: BoardStage) => text(stages[stage])
  const workStatus = (row: ProjectBoardRow) => { locale(); return ticketWorkLabels[row.ticket.state] }
  const controlsCopy = createMemo(() => projectWorkControlsCopy(text))
  const bindings = () => props.project.workspace_bindings ?? []
  let root: HTMLDivElement | undefined
  const closeDetails = () => {
    const id = selectedId()
    setSelectedId(null)
    if (id) requestAnimationFrame(() => {
      if (!selectedId() && root?.isConnected) root.querySelector<HTMLButtonElement>(`[data-testid="project-work-${CSS.escape(id)}"]`)?.focus()
    })
  }
  const cards = (items: () => ProjectBoardRow[]) => (
    <div class="grid gap-2">
      <For each={items()} keyed={(row) => row.ticket.id}>{(row) => (
        <button type="button" aria-pressed={selectedId() === row().ticket.id ? "true" : "false"}
          onClick={() => setSelectedId(row().ticket.id)}
          class="min-w-0 w-full rounded-lg border bg-background p-3 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={`project-work-${row().ticket.id}`}>
          <span class="block break-words font-medium">{row().ticket.contract.title}</span>
          <span class="block text-xs text-muted-foreground">{workStatus(row())}</span>
          <Show when={row().ticket.blocked}>{(blocked) => (
            <span class="mt-1 block break-words">{text("ticket_blocked_9059acb4")}: {blocked().reason}</span>
          )}</Show>
          <Show when={row().ticket.paused}><span class="block">{text("project_work_paused")}</span></Show>
          <span class="mt-2 block text-xs text-muted-foreground">
            {text(row().ticket.current_submission || row().ticket.accepted_submission ? "project_work_evidence_pending" : "project_work_evidence_none")}
          </span>
          <Show when={row().pending_context}><span class="block text-xs">{text("project_work_pending")}</span></Show>
        </button>
      )}</For>
    </div>
  )
  return (
    <div ref={(element) => { root = element }} class="min-h-0 overflow-y-auto p-4" data-testid="project-work-board">
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <For each={["list", "board"] as const}>{(choice) => (
          <Button size="sm" variant={mode() === choice ? "default" : "outline"} aria-pressed={mode() === choice ? "true" : "false"}
            onClick={() => setMode(choice)}>{text(choice === "list" ? "project_work_list" : "project_work_board")}</Button>
        )}</For>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cancelled()} onChange={(event) => { setSelectedId(null); setCancelled(event.currentTarget.checked) }} />
          {text("project_work_cancelled")}
        </label>
        <Button size="sm" variant="ghost" disabled={board.busy() || !props.ownerAccess} onClick={board.refresh}>{text("refresh_aee88743")}</Button>
      </div>
      <ProjectSprintPanel projectId={props.project.id} projectActive={props.project.status === "active"} snapshot={page()?.snapshot ?? null}
        owner={props.ownerAccess} filter={filter()} onRefresh={board.refresh}
        planningOpen={planningOpen()} onPlanningToggle={setPlanningOpen}
        onFilterChange={(next) => { setSelectedId(null); setPlanningOpen(false); setFilter(next) }} />
      <details class="mb-3 rounded-lg border p-3 text-xs">
        <summary class="cursor-pointer">{text("project_work_context")}</summary>
        <p class="mt-2"><ContextRevision context={{ project_id: props.project.id, project_revision: props.project.revision, resource_revision: props.project.resource_revision }} /></p>
        <p class="mt-2 font-medium">{text("project_work_repos")}</p>
        <ul>
          <Show when={props.project.project_path && !bindings().some((binding) => binding.path === props.project.project_path)}>
            <li class="break-all">{props.project.project_path}</li>
          </Show>
          <For each={bindings()} keyed={(binding) => binding.path}>{(binding) => (
            <li class="break-all">{binding().label ? `${binding().label}: ` : ""}{binding().path}</li>
          )}</For>
        </ul>
      </details>
      <Show when={!props.ownerAccess}><p role="status">{text("project_work_access")}</p></Show>
      <Show when={board.error()}><p role="alert" class="mb-3 text-sm text-destructive">{board.error()}</p></Show>
      <Show when={page()}>{(current) => (
        <>
          <Show when={!boardCountsKnown(current())}>
            <p role="status" class="mb-3 text-sm">{text("project_work_partial")}</p>
          </Show>
          <p class="mb-3 text-xs text-muted-foreground">
            {stageNames.map((stage) => `${stageLabel(stage)}: ${count(stage)}`).join(" · ")} · {text("ticket_blocked_9059acb4")}: {count("blocked")} · {text("cancelled_a37778f1")}: {count("cancelled")}
          </p>
        </>
      )}</Show>
      <Show when={mode() === "board"} fallback={cards(rows)}>
        <div class="project-work-stages grid grid-cols-1 gap-3">
          <For each={stageNames}>{(stage) => (
            <section aria-label={stageLabel(stage)} class="min-w-0 rounded-xl bg-muted/40 p-2">
              <h3 class="mb-2 text-sm font-medium">{stageLabel(stage)}</h3>
              {cards(() => rows().filter((row) => row.stage === stage))}
            </section>
          )}</For>
        </div>
        <Show when={unplaced().length}>
          <section class="mt-3">
            <h3 class="mb-2 text-sm font-medium">{text("project_work_other")}</h3>
            {cards(unplaced)}
          </section>
        </Show>
      </Show>
      <Show when={page() && !rows().length}><p class="py-4 text-sm text-muted-foreground">{text("project_work_empty")}</p></Show>
      <Show when={board.busy()}><p role="status" class="mt-3 text-sm">{text("project_work_loading")}</p></Show>
      <Show when={page()?.next_cursor}>
        <Button class="mt-3" variant="outline" disabled={board.busy()} onClick={() => void board.loadMore()}>{text("project_work_more")}</Button>
      </Show>
      <Show when={detailKey()} keyed>{(_scope) => (
        <div class="mt-4 space-y-3">
          <WorkDetails row={selected()!} snapshot={page()!.snapshot} projectId={props.project.id}
            canHandoff={props.ownerAccess && page()?.codex_handoff_available === true}
            onOpenSession={props.onOpenSession} onClose={closeDetails} />
          <Show when={staleControls()}>
            <p role="status" class="text-sm text-muted-foreground">{text("project_work_controls_unavailable_context")}</p>
          </Show>
          <Show when={planning()}>{(controls) => (
            <ProjectWorkPlanningControls {...controls()} owner={props.ownerAccess && controls().owner}
              command={commandAtSnapshot(controls().command, selected()!, page()!.snapshot)} copy={controlsCopy()} />
          )}</Show>
          <Show when={ownerControls()}>{(controls) => (
            <ProjectWorkOwnerControls {...controls()} owner={props.ownerAccess && controls().owner} commands={ownerCommands()} copy={controlsCopy()} />
          )}</Show>
        </div>
      )}</Show>
    </div>
  )
}
