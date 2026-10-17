import { beforeEach, expect, it, vi } from "vitest"
import { apiClient } from "@services/api"
import { boardCountsKnown, projectBoardClient, type ProjectBoardPage } from "./projectBoard"
import { ticketSnapshot } from "./testFixtures"
vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(), apiClient: { post: vi.fn() } }))
export const page = (): ProjectBoardPage => ({ ...ticketSnapshot().scope.overview, data: {
  project_id: "project", counts: { todo: 1, doing: 1, testing: 0, done: 0, blocked: 1, cancelled: 1, total: 3 },
  rows: [{ ticket: { ...ticketSnapshot().views[0].ticket, scope_id: "scope", depends_on: [] }, stage: "doing", context: null, adopted_context: null }],
} })
beforeEach(() => vi.resetAllMocks())
it("uses explicit project identity and pins every following page to its original snapshot", async () => {
  const first = page(); first.next_cursor = { commit: first.snapshot.commit, offset: 1, query_hash: "q" }
  const second = page(); second.data.rows[0].ticket.id = "B"
  vi.mocked(apiClient.post).mockResolvedValueOnce(first).mockResolvedValueOnce(second)
  const loaded = await projectBoardClient.page("project", false)
  expect((await projectBoardClient.page("project", false, loaded)).data.rows.map((row) => row.ticket.id)).toEqual(["A", "B"])
  expect(apiClient.post).toHaveBeenLastCalledWith("tickets/project-board", { project_id: "project", include_cancelled: false, include_archived: false, limit: 100, cursor: first.next_cursor, fixed_commit: first.snapshot.commit }, { signal: undefined })
})
it.each(["snapshot", "project", "duplicate", "cursor", "counts"])("rejects inconsistent %s instead of merging silently", async (kind) => {
  const first = page(); first.next_cursor = { commit: first.snapshot.commit, offset: 1, query_hash: "q" }
  const second = page(); second.data.rows[0].ticket.id = "B"
  if (kind === "snapshot") second.snapshot = { ...second.snapshot, seq: 11 }
  if (kind === "project") second.data.project_id = "another"
  if (kind === "duplicate") second.data.rows[0].ticket.id = "A"
  if (kind === "cursor") second.next_cursor = first.next_cursor
  if (kind === "counts") second.data.counts.done++
  vi.mocked(apiClient.post).mockResolvedValue(second)
  await expect(projectBoardClient.page("project", false, first)).rejects.toThrow()
})
it("does not confuse pagination with unknown counts but marks lagging coverage unknown", () => {
  const value = page(); value.next_cursor = { commit: value.snapshot.commit, offset: 1, query_hash: "q" }
  value.truncated = true; value.omitted_count = 1
  expect(boardCountsKnown(value)).toBe(true)
  value.index_seq = 1; expect(boardCountsKnown(value)).toBe(false)
  value.index_seq = 10; value.next_cursor = null; expect(boardCountsKnown(value)).toBe(false)
})
it("inspects only the selected Work at the same snapshot, rejecting omitted evidence", async () => {
  const value = page()
  vi.mocked(apiClient.post).mockResolvedValue({ ...value, data: [{ ...ticketSnapshot().views[0], assignments: [] }] })
  expect((await projectBoardClient.inspect("A", value.snapshot)).ticket.id).toBe("A")
  expect(apiClient.post).toHaveBeenCalledWith("tickets/inspect", expect.objectContaining({ sections: ["assignments", "requests", "submissions"], fixed_commit: value.snapshot.commit }), { signal: undefined })
  vi.mocked(apiClient.post).mockResolvedValue({ ...value, data: [], omitted_count: 1 })
  await expect(projectBoardClient.inspect("A", value.snapshot)).rejects.toThrow()
})
