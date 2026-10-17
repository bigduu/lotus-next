import { apiClient } from "@services/api"
import { uiText } from "@shared/i18n/ui"
import type { Cursor, ReadEnvelope, SnapshotRef, Work, WorkView } from "./types"

export type BoardStage = "todo" | "doing" | "testing" | "done"
export interface ProjectBoardTicket extends Work {
  scope_id: string
  depends_on: string[]
  paused?: boolean
}
// Project context is an immutable backend-owned reference, not a second Work state.
export interface ProjectBoardRow {
  ticket: ProjectBoardTicket
  stage: BoardStage | null
  context: ProjectContext | null
  // Absent on older backends. Only the server can authorize pending adoption.
  pending_context?: ProjectContext | null
  adopted_context: ProjectContext | null
}
export interface ProjectContext {
  project_id: string
  project_revision: number
  resource_revision: number
  workspace_binding: { path: string; label?: string | null; git_common_dir?: string | null }
  contract_revision: number
  contract: Work["contract"]
  sources: Record<string, string>
}
export interface ProjectBoardData {
  project_id: string
  counts: Record<BoardStage | "blocked" | "cancelled" | "total", number>
  rows: ProjectBoardRow[]
}
export type ProjectBoardPage = ReadEnvelope<ProjectBoardData>
export interface BoardAssignment {
  id: string
  state: string
  runtime: { session_id: string; run_id: string } | null
  awaiting_request?: string | null
  workspace: { repo: string; branch: string; worktree: string; base_commit: string } | null
}
export interface BoardWorkView extends WorkView { assignments: BoardAssignment[] }

function validateSnapshot(actual: SnapshotRef, expected: SnapshotRef) {
  if (actual.commit !== expected.commit || actual.seq !== expected.seq || actual.authority_epoch !== expected.authority_epoch
    || !actual.commit || !Number.isSafeInteger(actual.seq) || actual.seq < 0
    || !Number.isSafeInteger(actual.authority_epoch) || actual.authority_epoch < 1) {
    throw new Error(uiText("ticket_the_ticket_snapshot_is_inconsistent_refresh_a_4e2cb547"))
  }
}
export function boardCountsKnown(page: ProjectBoardPage) {
  // The board computes full counts before paginating rows. Bamboo marks
  // remaining rows as truncated/omitted even when its next cursor is valid.
  const ordinaryPagination = page.next_cursor !== null
  return ["complete", "authoritative_scope"].includes(page.coverage)
    && (ordinaryPagination || (!page.truncated && page.omitted_count === 0))
    && page.index_seq >= page.snapshot.seq
}
export const projectBoardClient = {
  async page(projectId: string, includeCancelled: boolean, previous?: ProjectBoardPage, signal?: AbortSignal): Promise<ProjectBoardPage> {
    const result = await apiClient.post<ProjectBoardPage>("tickets/project-board", {
      project_id: projectId, include_cancelled: includeCancelled, include_archived: false,
      limit: 100, cursor: previous?.next_cursor ?? null, fixed_commit: previous?.snapshot.commit ?? null,
    }, { signal })
    validateSnapshot(result.snapshot, previous?.snapshot ?? result.snapshot)
    if (["todo", "doing", "testing", "done", "blocked", "cancelled", "total"].some((key) => { const value = result.data.counts[key as keyof ProjectBoardData["counts"]]; return !Number.isSafeInteger(value) || value < 0 })
      || result.data.project_id !== projectId || result.data.rows.some((row) => !row.ticket.id)
      || new Set(result.data.rows.map((row) => row.ticket.id)).size !== result.data.rows.length) {
      throw new Error(uiText("project_work_inconsistent"))
    }
    const cursor: Cursor | null = result.next_cursor
    if (cursor && (cursor.commit !== result.snapshot.commit || !Number.isSafeInteger(cursor.offset)
      || cursor.offset <= (previous?.next_cursor?.offset ?? 0)
      || (previous?.next_cursor && cursor.query_hash !== previous.next_cursor.query_hash))) throw new Error(uiText("project_work_inconsistent"))
    if (!previous) return result
    if (Object.keys(previous.data.counts).some((key) => result.data.counts[key as keyof ProjectBoardData["counts"]] !== previous.data.counts[key as keyof ProjectBoardData["counts"]])
      || result.data.rows.some((row) => previous.data.rows.some((old) => old.ticket.id === row.ticket.id))) throw new Error(uiText("project_work_inconsistent"))
    return { ...result, data: { ...result.data, rows: [...previous.data.rows, ...result.data.rows] } }
  },
  async inspect(id: string, snapshot: SnapshotRef, signal?: AbortSignal): Promise<BoardWorkView> {
    const result = await apiClient.post<ReadEnvelope<BoardWorkView[]>>("tickets/inspect", {
      ids: [id], sections: ["assignments", "requests", "submissions"], depth: 0,
      budget_bytes: 65536, fixed_commit: snapshot.commit,
    }, { signal })
    validateSnapshot(result.snapshot, snapshot)
    if (!["complete", "authoritative_scope"].includes(result.coverage) || result.index_seq < snapshot.seq || result.truncated || result.omitted_count || result.data.length !== 1 || result.data[0].ticket.id !== id) throw new Error(uiText("project_work_inconsistent"))
    return result.data[0]
  },
}
