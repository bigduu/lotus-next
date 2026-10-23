import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { changeLocale } from "@shared/i18n"
import { ApiError } from "@services/api"
import type { ProjectManifest } from "@services/project"
import { projectBoardClient, type BoardWorkView, type ProjectBoardPage } from "@services/tickets/projectBoard"
import { sprintClient, type SprintCommand, type SprintInspection, type SprintPage, type SprintReceipt, type SprintSummary, type SprintWorkVersion } from "@services/tickets/sprints"
import type { SnapshotRef, TicketScope } from "@services/tickets/types"
import { ticketSnapshot } from "@services/tickets/testFixtures"
import { OwnerAccessContext } from "@/hooks/ownerAccessContext"
import { sprintOwnerControlsEnglish as copy } from "./project-work/SprintOwnerControls.copy"
import { ProjectWorkBoard } from "./ProjectWorkBoard"

// Keep the real Board, Sprint panel, both hooks, controls and locale adapters.
// These mocks are the transport ports, not alternate component implementations.
vi.mock("@services/tickets/projectBoard", async (original) => ({ ...await original<typeof import("@services/tickets/projectBoard")>(),
  projectBoardClient: { page: vi.fn(), inspect: vi.fn() } }))
vi.mock("@services/tickets/sprints", async (original) => ({ ...await original<typeof import("@services/tickets/sprints")>(),
  sprintClient: { list: vi.fn(), inspect: vi.fn(), scope: vi.fn(), command: vi.fn() } }))

let root: Root
let project: ProjectManifest
let at: SnapshotRef
let inspectRevision: number
let projectNumber = 0
const snapshot = (seq = 10): SnapshotRef => ({ commit: `commit-${seq}`, seq, authority_epoch: 1 })
const envelope = <Data,>(data: Data, fixed = at) => ({ snapshot: { ...fixed }, index_seq: fixed.seq, coverage: "authoritative_scope",
  truncated: false, omitted_count: 0, next_cursor: null, data })
function boardPage(fixed = at, ids = ["work-a"]): ProjectBoardPage {
  return envelope({ project_id: project.id,
    counts: { todo: ids.length, doing: 0, testing: 0, done: 0, blocked: 0, cancelled: 0, total: ids.length },
    rows: ids.map((id) => ({ ticket: { ...ticketSnapshot().views[0].ticket, id, state: "ready" as const,
      contract: { title: `Canonical ${id}`, objective: "Existing Work", constraints: [], acceptance: ["Verified evidence"] },
      scope_id: `scope-${project.id}`, depends_on: [], blocked: null, active_assignment: null, paused: false,
    }, stage: "todo" as const, context: null, adopted_context: null })),
  }, fixed)
}
function scope(fixed = at): TicketScope {
  return { ...ticketSnapshot(fixed.seq).scope, available: true, mutation_enabled: true, dispatch_enabled: false,
    binding: { scope_id: `scope-${project.id}`, supervisor_session_id: "owner-root", binding_revision: 1 },
    overview: { ...ticketSnapshot(fixed.seq).scope.overview!, snapshot: { ...fixed }, index_seq: fixed.seq } }
}
const summary = (id = "sprint-active", status: SprintSummary["status"] = "active", revision = inspectRevision): SprintSummary => ({
  id, project_id: project.id, definition: { name: `Canonical ${id}`, goal: `Goal for ${id}`, starts_at: null, ends_at: null },
  status, revision, created_seq: 1, updated_seq: 5, member_count: 1, closure_counts: null,
})
const sprintPage = (fixed = at): SprintPage => envelope([summary(), summary("sprint-next", "planned", 2)], fixed)
const member = (accepted = false): SprintWorkVersion => ({ record_revision: 2, contract_revision: 1, generation: 1,
  state: accepted ? "accepted" : "ready", blocked_resume_state: null, paused: false, archived: false,
  current_submission: accepted ? "submission-a" : null, accepted_submission: accepted ? "submission-a" : null,
  active_assignment: null, context_hash: null, accepted })
function inspection(sprintId = "sprint-active", fixed = at): SprintInspection {
  const item = summary(sprintId, sprintId === "sprint-next" ? "planned" : "active", sprintId === "sprint-next" ? 2 : inspectRevision)
  const { member_count: _memberCount, closure_counts: _closureCounts, ...sprint } = item
  return envelope({ sprint: { ...sprint, members: ["work-a"], history: [], closure: null },
    current_members: { "work-a": member() },
    current_counts: { total: 1, accepted: 0, pending_acceptance: 0, blocked: 0, cancelled: 0, unfinished: 1 } }, fixed)
}
const receipt = (command: SprintCommand): SprintReceipt => ({ operation: { operation_id: command.operation_id,
  committed_seq: command.expected_seq + 1, ids: { sprint: command.sprint_id }, principal: "user:owner",
  request_hash: "test-command-hash", canonical_request: JSON.stringify(["sprint", command]) }, closure: null })
const render = async (owner = true) => act(async () => root.render(<OwnerAccessContext.Provider value={owner}><ProjectWorkBoard key={project.id} project={project} /></OwnerAccessContext.Provider>))
const findButton = (label: string) => [...document.querySelectorAll("button")].find((element) => element.textContent === label)
const click = async (label: string) => act(async () => {
  const element = findButton(label)
  if (!element) throw new Error(`Missing real button: ${label}`)
  element.click()
})
const field = (label: string) => [...document.querySelectorAll("label")].find((element) => element.querySelector("span")?.textContent === label)!.querySelector("input,textarea") as HTMLInputElement
const input = async (element: HTMLInputElement, value: string) => act(async () => {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
})
const chooseFilter = async (value: string) => act(async () => {
  const select = document.querySelector('[data-testid="project-sprint-filter"]') as HTMLSelectElement
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value)
  select.dispatchEvent(new Event("change", { bubbles: true }))
})
const openWork = async () => act(async () => (document.querySelector('[data-testid="project-work-work-a"]') as HTMLButtonElement).click())

beforeEach(async () => {
  await changeLocale("en-US")
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.body.replaceChildren()
  root = createRoot(document.body.appendChild(document.createElement("div")))
  // The production journal is intentionally tab-local and persists across mounts.
  // Distinct Project identities keep these real-parent tests independent.
  project = { id: `sprint-parent-${++projectNumber}`, name: "Canonical Project", status: "active", revision: 2, resource_revision: 1,
    workspace_bindings: [{ path: "/isolated/fixture" }] } as ProjectManifest
  at = snapshot()
  inspectRevision = 3
  vi.mocked(projectBoardClient.page).mockReset().mockImplementation(async () => boardPage())
  vi.mocked(projectBoardClient.inspect).mockReset().mockImplementation(async (id) => ({ ticket: boardPage().data.rows.find((row) => row.ticket.id === id)!.ticket,
    assignments: [], requests: [], submissions: [] } as BoardWorkView))
  vi.mocked(sprintClient.list).mockReset().mockImplementation(async (_id, _previous, fixed) => sprintPage(fixed))
  vi.mocked(sprintClient.inspect).mockReset().mockImplementation(async (_id, sprintId, fixed) => inspection(sprintId, fixed))
  vi.mocked(sprintClient.scope).mockReset().mockImplementation(async () => scope())
  vi.mocked(sprintClient.command).mockReset().mockImplementation(async (command) => receipt(command))
})
afterEach(() => act(() => root?.unmount()))

it("does not read or expose Sprint planning writes outside verified owner access", async () => {
  await render(false)
  expect(projectBoardClient.page).not.toHaveBeenCalled()
  expect(sprintClient.list).not.toHaveBeenCalled()
  expect(sprintClient.scope).not.toHaveBeenCalled()
  expect(sprintClient.inspect).not.toHaveBeenCalled()
  expect(sprintClient.command).not.toHaveBeenCalled()
  expect((document.querySelector('[data-testid="project-sprint-filter"]') as HTMLSelectElement).disabled).toBe(true)
  expect(document.querySelector('[data-testid="sprint-owner-controls"]')).toBeNull()
})

it.each([404, 405, 501])("keeps canonical All Work usable when the Sprint route returns %s", async (status) => {
  vi.mocked(sprintClient.list).mockRejectedValue(new ApiError("unsupported", status, "Unsupported"))
  await render()
  expect(document.body.textContent).toContain("This backend does not support Sprint planning. All Work is still available.")
  expect(document.querySelector('[data-testid="project-work-work-a"]')?.textContent).toContain("Canonical work-a")
  expect((document.querySelector('[data-testid="project-sprint-filter"]') as HTMLSelectElement).value).toBe("all")
  expect((document.querySelector('option[value="backlog"]') as HTMLOptionElement).disabled).toBe(true)
  expect(document.querySelector('[data-testid="sprint-owner-controls"]')).toBeNull()
  await openWork()
  expect(projectBoardClient.inspect).toHaveBeenCalledExactlyOnceWith("work-a", at, expect.any(AbortSignal))
  expect(document.querySelector('[data-testid="project-work-details"]')).not.toBeNull()
  expect(sprintClient.command).not.toHaveBeenCalled()
})

it("clears selected Work and starts a fresh cursor when changing All Work, Backlog and Sprint filters", async () => {
  const first = boardPage()
  first.next_cursor = { commit: at.commit, offset: 1, query_hash: "all-work-query" }
  const merged = boardPage(at, ["work-a", "work-b"])
  let finishBacklog!: (result: ProjectBoardPage) => void
  let finishSprint!: (result: ProjectBoardPage) => void
  vi.mocked(projectBoardClient.page).mockResolvedValueOnce(first).mockResolvedValueOnce(merged)
    .mockImplementationOnce(() => new Promise((resolve) => { finishBacklog = resolve }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishSprint = resolve }))
  await render()
  await click("Load more")
  expect(vi.mocked(projectBoardClient.page).mock.calls[1][2]).toBe(first)
  await openWork()
  expect(document.querySelector('[data-testid="project-work-details"]')).not.toBeNull()
  const allSignal = vi.mocked(projectBoardClient.page).mock.calls[0][3]!
  await chooseFilter("backlog")
  expect(allSignal.aborted).toBe(true)
  expect(document.querySelector('[data-testid="project-work-details"]')).toBeNull()
  expect(vi.mocked(projectBoardClient.page).mock.calls[2]).toEqual([project.id, false, undefined, expect.any(AbortSignal), { kind: "backlog" }])
  await act(async () => finishBacklog(boardPage()))
  expect(document.querySelector('[data-testid="project-work-work-a"]')).not.toBeNull()
  expect(document.querySelector('[data-testid="project-work-details"]')).toBeNull()
  await openWork()
  await chooseFilter("sprint:sprint-active")
  expect(document.querySelector('[data-testid="project-work-details"]')).toBeNull()
  expect(vi.mocked(projectBoardClient.page).mock.calls[3]).toEqual([project.id, false, undefined, expect.any(AbortSignal), { kind: "sprint", sprint_id: "sprint-active" }])
  await act(async () => finishSprint(boardPage()))
  expect(document.querySelector('[data-testid="project-work-details"]')).toBeNull()
  expect(sprintClient.inspect).toHaveBeenCalledWith(project.id, "sprint-active", at, expect.any(AbortSignal))
  expect(sprintClient.command).not.toHaveBeenCalled()
})

it("labels closed Sprint current counts separately from frozen closure and keeps planning controls read only", async () => {
  const closed = inspection()
  closed.data.sprint.status = "closed"
  closed.data.sprint.revision = 4
  closed.data.current_members["work-a"] = member(true)
  closed.data.current_counts = { total: 1, accepted: 1, pending_acceptance: 0, blocked: 0, cancelled: 0, unfinished: 0 }
  closed.data.sprint.closure = { source_commit: "frozen-closing-commit", source_seq: 8, closed_seq: 9,
    counts: { total: 1, accepted: 0, pending_acceptance: 0, blocked: 0, cancelled: 0, unfinished: 1 },
    members: { "work-a": { version: member(), disposition: { disposition: "backlog" } } } }
  closed.data.sprint.history = [{ work_id: "work-a", work_revision: 2, seq: 3, operation_id: "membership-add",
    principal: "user:owner", source: "Explicit owner membership", change: { kind: "added" } },
  { work_id: "work-a", work_revision: 2, seq: 9, operation_id: "membership-close", principal: "user:owner",
    source: "Explicit owner close", change: { kind: "carried_out", to: null } }]
  const list = sprintPage()
  list.data[0] = { ...list.data[0], status: "closed", revision: 4, closure_counts: closed.data.sprint.closure.counts }
  const currentBoard = boardPage()
  currentBoard.data.rows[0].ticket.state = "accepted"
  currentBoard.data.rows[0].ticket.current_submission = "submission-a"
  currentBoard.data.rows[0].ticket.accepted_submission = "submission-a"
  currentBoard.data.rows[0].stage = "done"
  currentBoard.data.counts.todo = 0
  currentBoard.data.counts.done = 1
  vi.mocked(projectBoardClient.page).mockResolvedValue(currentBoard)
  vi.mocked(sprintClient.list).mockResolvedValue(list)
  vi.mocked(sprintClient.inspect).mockResolvedValue(closed)
  await render()
  await chooseFilter("sprint:sprint-active")
  const current = document.querySelector('[data-testid="project-sprint-current-counts"]')!
  const closure = document.querySelector('[data-testid="project-sprint-closure-counts"]')!
  expect(current.previousElementSibling?.textContent).toBe("Current Work at this snapshot")
  expect(closure.previousElementSibling?.textContent).toBe("Work frozen when the Sprint closed")
  expect(current.textContent).toContain("Accepted 1")
  expect(current.textContent).toContain("Unfinished 0")
  expect(closure.textContent).toContain("Accepted 0")
  expect(closure.textContent).toContain("Unfinished 1")
  expect(document.body.textContent).toContain(`Snapshot sequence ${at.seq} · ${at.commit}`)
  expect(document.body.textContent).toContain("Closed at sequence 9 from sequence 8 · frozen-closing-commit")
  expect(document.body.textContent).toContain("Carried out · work-a → Backlog")
  expect(document.body.textContent).toContain("Explicit owner close")
  const controls = document.querySelector('[data-testid="sprint-owner-controls"]')!
  expect(controls.textContent).toContain(copy.closedReadOnly)
  expect(controls.querySelectorAll("input,select,textarea,form")).toHaveLength(0)
  expect(findButton(copy.close)).toBeUndefined()
  expect(sprintClient.command).not.toHaveBeenCalled()
})

it("preserves a conflicting edit through real parent refresh and requires another explicit review after the new revision arrives", async () => {
  vi.mocked(sprintClient.command).mockRejectedValueOnce(new ApiError("revision conflict", 409, "Conflict"))
  await render()
  await chooseFilter("sprint:sprint-active")
  const goal = field(copy.goal)
  await input(goal, "Preserve this owner draft")
  await click(copy.save)
  expect(sprintClient.command).toHaveBeenCalledTimes(1)
  expect(document.body.textContent).toContain(copy.conflict)
  expect(projectBoardClient.page).toHaveBeenCalledTimes(2)
  let finishRefresh!: (result: ProjectBoardPage) => void
  vi.mocked(projectBoardClient.page).mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve }))
  await click(copy.reviewLatest)
  expect(goal.isConnected).toBe(true)
  expect(field(copy.goal)).toBe(goal)
  expect(goal.value).toBe("Preserve this owner draft")
  expect(findButton(copy.save)!.disabled).toBe(true)
  expect(sprintClient.command).toHaveBeenCalledTimes(1)
  at = snapshot(11)
  inspectRevision = 4
  await act(async () => finishRefresh(boardPage()))
  expect(field(copy.goal)).toBe(goal)
  expect(goal.value).toBe("Preserve this owner draft")
  expect(document.body.textContent).toContain(copy.draftStale)
  expect(findButton(copy.save)!.disabled).toBe(true)
  expect(sprintClient.command).toHaveBeenCalledTimes(1)
  await click(copy.reviewLatest)
  expect(field(copy.goal)).toBe(goal)
  expect(findButton(copy.save)!.disabled).toBe(false)
  expect(sprintClient.command).toHaveBeenCalledTimes(1)
  await click(copy.save)
  expect(sprintClient.command).toHaveBeenCalledTimes(2)
  const [first, second] = vi.mocked(sprintClient.command).mock.calls.map(([command]) => command)
  expect(first).toMatchObject({ expected_seq: 10, expected_epoch: 1, action: { op: "edit", expected_revision: 3 } })
  expect(second).toMatchObject({ expected_seq: 11, expected_epoch: 1, action: { op: "edit", expected_revision: 4,
    definition: { goal: "Preserve this owner draft" } } })
  expect(second.operation_id).not.toBe(first.operation_id)
})

it("keeps the original create Sprint ID and draft through a 409 parent loading cycle", async () => {
  vi.mocked(sprintClient.command).mockRejectedValueOnce(new ApiError("scope conflict", 409, "Conflict"))
  await render()
  const name = field(copy.name)
  const goal = field(copy.goal)
  await input(name, "Preserved new Sprint")
  await input(goal, "Reviewed planning goal")
  await click(copy.create)
  const original = structuredClone(vi.mocked(sprintClient.command).mock.calls[0][0])
  let finishRefresh!: (result: ProjectBoardPage) => void
  vi.mocked(projectBoardClient.page).mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve }))
  await click(copy.reviewLatest)
  expect(name.isConnected).toBe(true)
  expect(field(copy.name)).toBe(name)
  expect(field(copy.goal)).toBe(goal)
  expect(findButton(copy.create)!.disabled).toBe(true)
  expect(sprintClient.command).toHaveBeenCalledTimes(1)
  at = snapshot(11)
  await act(async () => finishRefresh(boardPage()))
  expect(field(copy.name).value).toBe("Preserved new Sprint")
  expect(field(copy.goal).value).toBe("Reviewed planning goal")
  expect(sprintClient.command).toHaveBeenCalledTimes(1)
  await click(copy.create)
  expect(sprintClient.command).toHaveBeenCalledTimes(2)
  const next = vi.mocked(sprintClient.command).mock.calls[1][0]
  expect(next.sprint_id).toBe(original.sprint_id)
  expect(next.operation_id).not.toBe(original.operation_id)
  expect(next.expected_seq).toBe(11)
  expect(next.action).toEqual(original.action)
})

it("reconciles an unknown result only by explicit user action using the exact original whole command", async () => {
  vi.mocked(sprintClient.command).mockRejectedValueOnce(new TypeError("network lost after write"))
  await render()
  await input(field(copy.name), "Unknown receipt Sprint")
  await input(field(copy.goal), "Keep original operation")
  await click(copy.create)
  const original = structuredClone(vi.mocked(sprintClient.command).mock.calls[0][0])
  expect(document.body.textContent).toContain(copy.unknown)
  expect(findButton(copy.create)!.disabled).toBe(true)
  expect(findButton(copy.reviewLatest)).toBeUndefined()
  expect(projectBoardClient.page).toHaveBeenCalledTimes(1)
  expect(sprintClient.command).toHaveBeenCalledTimes(1)
  await act(async () => { findButton(copy.reconcile)!.click(); findButton(copy.reconcile)!.click() })
  expect(sprintClient.command).toHaveBeenCalledTimes(2)
  expect(vi.mocked(sprintClient.command).mock.calls[1][0]).toEqual(original)
  expect(document.body.textContent).toContain(copy.committed)
  expect(document.body.textContent).toContain(copy.receiptHelp)
})

it.each(["unavailable", "mutation-disabled", "epoch-mismatch", "capability-missing", "partial-overview"] as const)("does not grant planning writes when canonical scope is %s", async (reason) => {
  const denied = scope()
  if (reason === "unavailable") denied.available = false
  else if (reason === "mutation-disabled") denied.mutation_enabled = false
  else if (reason === "epoch-mismatch") denied.overview!.snapshot.authority_epoch++
  else if (reason === "capability-missing") denied.capabilities!.ticket_scope_v1 = false
  else denied.overview!.coverage = "partial"
  vi.mocked(sprintClient.scope).mockResolvedValue(denied)
  await render()
  expect(document.querySelector('[data-testid="project-work-work-a"]')).not.toBeNull()
  expect(document.querySelector('[data-testid="sprint-owner-controls"]')).not.toBeNull()
  expect(findButton(copy.create)!.disabled).toBe(true)
  await act(async () => document.querySelector('[data-testid="sprint-owner-controls"] form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  expect(sprintClient.command).not.toHaveBeenCalled()
  await chooseFilter("sprint:sprint-active")
  expect(findButton(copy.add)!.disabled).toBe(true)
  expect(findButton(copy.close)!.disabled).toBe(true)
  expect(sprintClient.command).not.toHaveBeenCalled()
})

it.each(["archived", undefined])("keeps canonical Project status %s read only without hiding Sprint and Work reads", async (status) => {
  project = { ...project, status } as ProjectManifest
  await render()
  expect(document.querySelector('[data-testid="project-work-work-a"]')).not.toBeNull()
  expect(sprintClient.list).toHaveBeenCalledOnce()
  expect(findButton(copy.create)!.disabled).toBe(true)
  await chooseFilter("sprint:sprint-active")
  expect(sprintClient.inspect).toHaveBeenCalledWith(project.id, "sprint-active", at, expect.any(AbortSignal))
  expect(findButton(copy.save)!.disabled).toBe(true)
  expect(findButton(copy.add)!.disabled).toBe(true)
  expect(findButton(copy.close)!.disabled).toBe(true)
  expect(sprintClient.command).not.toHaveBeenCalled()
})

it("hides retained planning controls immediately after owner access is revoked", async () => {
  await render()
  await chooseFilter("sprint:sprint-active")
  expect(document.querySelector('[data-testid="sprint-owner-controls"]')).not.toBeNull()
  const reads = vi.mocked(sprintClient.list).mock.calls.length
  await render(false)
  expect(document.querySelector('[data-testid="sprint-owner-controls"]')).toBeNull()
  expect(sprintClient.list).toHaveBeenCalledTimes(reads)
  expect(sprintClient.command).not.toHaveBeenCalled()
})
