import { beforeEach, expect, it, vi } from "vitest"
import { apiClient, ApiError } from "@services/api"
import payload from "@/test/fixtures/sprintContract/producer-http-payload.json"
import { sprintClient, type SprintCommand, type SprintInspection, type SprintPage } from "./sprints"
vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(), apiClient: { post: vi.fn(), postOnce: vi.fn(), get: vi.fn() } }))
const sample = payload.requests_and_actual_responses
const list = () => structuredClone(sample.list_response) as SprintPage
const inspection = () => structuredClone(sample.inspect_response) as SprintInspection
const project = sample.list_request.project_id
beforeEach(() => vi.resetAllMocks())
it("reads the actual producer list shape and pins the next page to the first snapshot", async () => {
  const first = list(); first.next_cursor = { commit: first.snapshot.commit, query_hash: "sprints", offset: 1 }; first.truncated = true; first.omitted_count = 1
  const second = list(); second.data[0].id = "b"
  vi.mocked(apiClient.post).mockResolvedValueOnce(first).mockResolvedValueOnce(second)
  const value = await sprintClient.list(project)
  expect((await sprintClient.list(project, value)).data.map((row) => row.id)).toEqual(["a", "b"])
  expect(apiClient.post).toHaveBeenLastCalledWith("tickets/sprints/list", { project_id: project, status: null, limit: 100, cursor: first.next_cursor, fixed_commit: first.snapshot.commit }, { signal: undefined })
})
it.each(["project", "snapshot", "cursor", "duplicate", "counts", "coverage"])("rejects a %s inconsistency instead of stitching another membership snapshot", async (kind) => {
  const first = list(); first.next_cursor = { commit: first.snapshot.commit, query_hash: "sprints", offset: 1 }
  const second = list(); second.data[0].id = "b"
  if (kind === "project") second.data[0].project_id = "foreign"
  if (kind === "snapshot") second.snapshot.seq++
  if (kind === "cursor") second.next_cursor = { ...first.next_cursor, query_hash: "another-filter", offset: 2 }
  if (kind === "duplicate") second.data[0].id = "a"
  if (kind === "counts") { second.data[0].status = "closed"; second.data[0].closure_counts = { total: 1, accepted: 1, cancelled: 1, unfinished: 0, blocked: 0, pending_acceptance: 0 } }
  if (kind === "coverage") second.coverage = "partial"
  vi.mocked(apiClient.post).mockResolvedValue(second)
  await expect(sprintClient.list(project, first)).rejects.toThrow()
})
it("keeps closed members and current facts separate from the immutable closure", async () => {
  const result = inspection()
  const member = Object.keys(result.data.current_members)[0]
  result.data.current_members[member].state = "accepted"; result.data.current_members[member].accepted = true
  result.data.current_counts.accepted = 1; result.data.current_counts.unfinished = 0
  // A controlled later-read variation, not another captured HTTP result.
  result.snapshot = { ...result.snapshot, seq: 8, commit: "later-synthetic-snapshot" }; result.index_seq = 8
  vi.mocked(apiClient.post).mockResolvedValue(result)
  const value = await sprintClient.inspect(project, "a", result.snapshot)
  expect(value.data.current_counts.accepted).toBe(1)
  expect(value.data.sprint.closure!.counts.accepted).toBe(0)
  expect(value.data.sprint.closure!.members[member].version.state).toBe("draft")
  expect(value.data.sprint.members).toContain(member)
  expect(apiClient.post).toHaveBeenCalledWith("tickets/sprints/inspect", { project_id: project, sprint_id: "a", fixed_commit: result.snapshot.commit }, { signal: undefined })
})
it.each(["missing member", "foreign project", "wrong sprint", "closure future", "partial"])("rejects %s in inspect so it cannot authorize owner controls", async (kind) => {
  const value = inspection()
  if (kind === "missing member") value.data.current_members = {}
  if (kind === "foreign project") value.data.sprint.project_id = "foreign"
  if (kind === "wrong sprint") value.data.sprint.id = "other"
  if (kind === "closure future") value.data.sprint.closure!.closed_seq = 100
  if (kind === "partial") value.truncated = true
  vi.mocked(apiClient.post).mockResolvedValue(value)
  await expect(sprintClient.inspect(project, "a", value.snapshot)).rejects.toThrow()
})
it.each(["constructor", "__proto__"])("does not mistake an inherited %s property for a canonical member observation", async (id) => {
  const value = inspection(); value.data.sprint.members = [id]
  vi.mocked(apiClient.post).mockResolvedValue(value)
  await expect(sprintClient.inspect(project, "a", value.snapshot)).rejects.toThrow()
})
it.each(["create", "close"] as const)("checks the exact %s receipt without treating it as Work completion", async (op) => {
  const receipt = structuredClone(op === "create" ? sample.create_response : sample.close_response)
  const command = JSON.parse(receipt.operation.canonical_request)[1] as SprintCommand
  vi.mocked(apiClient.postOnce).mockResolvedValue(receipt)
  expect(await sprintClient.command(command)).toEqual(receipt)
  expect(apiClient.postOnce).toHaveBeenCalledExactlyOnceWith("tickets/sprints/command", command)
})
it.each(["operation", "payload", "sprint", "sequence", "closure"])("rejects a mismatched command %s receipt", async (kind) => {
  const receipt = structuredClone(sample.close_response)
  const command = JSON.parse(receipt.operation.canonical_request)[1] as SprintCommand
  if (kind === "operation") receipt.operation.operation_id = "late-command"
  if (kind === "payload") receipt.operation.canonical_request = JSON.stringify(["sprint", { ...command, expected_seq: 99 }])
  if (kind === "sprint") receipt.operation.ids.sprint = "foreign"
  if (kind === "sequence") receipt.operation.committed_seq = command.expected_seq
  if (kind === "closure") receipt.closure.counts.total = 99
  vi.mocked(apiClient.postOnce).mockResolvedValue(receipt)
  await expect(sprintClient.command(command)).rejects.toThrow()
})
it("propagates CAS/owner denials without automatic retries", async () => {
  const command = JSON.parse(sample.create_response.operation.canonical_request)[1] as SprintCommand
  vi.mocked(apiClient.postOnce).mockRejectedValue(new ApiError("stale_snapshot", 409, "Conflict"))
  await expect(sprintClient.command(command)).rejects.toMatchObject({ status: 409 })
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
})
