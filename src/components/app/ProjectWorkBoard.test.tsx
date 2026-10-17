import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { changeLocale } from "@shared/i18n"
import { ApiError } from "@services/api"
import type { ProjectManifest } from "@services/project"
import { projectBoardClient, type ProjectBoardPage } from "@services/tickets/projectBoard"
import { ticketSnapshot } from "@services/tickets/testFixtures"
import { OwnerAccessContext } from "@/hooks/ownerAccessContext"
import { ProjectWorkBoard } from "./ProjectWorkBoard"
vi.mock("@services/tickets/projectBoard", async (original) => ({ ...await original<typeof import("@services/tickets/projectBoard")>(), projectBoardClient: { page: vi.fn(), inspect: vi.fn() } }))
let root: Root
const project = { id: "project", name: "Project", revision: 3, resource_revision: 2, workspace_bindings: [{ path: "/repo/a" }, { path: "/repo/b" }] } as ProjectManifest
const page = (): ProjectBoardPage => ({ ...ticketSnapshot().scope.overview, data: {
  project_id: "project", counts: { todo: 1, doing: 1, testing: 1, done: 1, blocked: 1, cancelled: 1, total: 5 },
  rows: (["ready", "blocked", "submitted", "accepted", "cancelled"] as const).map((state, index) => ({
    ticket: { ...ticketSnapshot().views[0].ticket, id: `work-${index}`, contract: { title: `Work ${index}`, objective: "Objective", constraints: [], acceptance: ["Evidence required"] }, state, blocked: state === "blocked" ? { reason: "Dependency" } : null, scope_id: "scope", depends_on: [], paused: state === "blocked", current_submission: state === "submitted" ? "s" : null },
    stage: (["todo", "doing", "testing", "done", null] as const)[index], context: null, adopted_context: null,
  })),
} })
const click = async (label: string) => { await act(async () => { const element = [...document.querySelectorAll("button")].find((button) => button.textContent === label); if (!element) throw new Error(label); element.click() }) }
const render = async (owner = true, selectedProject = project) => { await act(async () => root.render(<OwnerAccessContext.Provider value={owner}><ProjectWorkBoard key={selectedProject.id} project={selectedProject} /></OwnerAccessContext.Provider>)) }
beforeEach(async () => {
  await changeLocale("en-US")
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.body.replaceChildren()
  root = createRoot(document.body.appendChild(document.createElement("div")))
  vi.mocked(projectBoardClient.page).mockReset().mockResolvedValue(page())
  vi.mocked(projectBoardClient.inspect).mockReset().mockResolvedValue({ ...ticketSnapshot().views[0], ticket: page().data.rows[2].ticket, assignments: [{ id: "assignment-A", runtime: { session_id: "owner-session", run_id: "run-id" }, workspace: null, state: "running" }], submissions: [{ id: "s", work_id: "work-2", generation: 1, contract_revision: 1, stale: true, artifacts: [], evidence: ["Historical result"], updated_seq: 10 }] })
})
afterEach(() => act(() => root.unmount()))
it("renders server stages, blocked overlay, cancelled separately, without mutable or draggable status controls", async () => {
  await render(); await click("Board")
  expect(document.querySelector('section[aria-label="Doing"]')?.textContent).toContain("Work 1")
  expect(document.querySelector('section[aria-label="Doing"]')?.textContent).toContain("Paused")
  expect(document.querySelector('section[aria-label="Accepted"]')?.textContent).toContain("Work 3")
  expect(document.querySelector('section[aria-label="Accepted"]')?.textContent).not.toContain("Work 4")
  expect(document.querySelector('[draggable="true"]')).toBeNull()
  expect(document.body.textContent).toContain("/repo/a")
  expect(document.body.textContent).toContain("/repo/b")
  await click("List")
  expect(document.querySelectorAll('[data-testid^="project-work-work-"]')).toHaveLength(5)
})
it("opens pinned evidence and owner-session detail and closes without changing Work", async () => {
  await render()
  await act(async () => (document.querySelector('[data-testid="project-work-work-2"]') as HTMLButtonElement).click())
  expect(projectBoardClient.inspect).toHaveBeenCalledWith("work-2", page().snapshot, expect.any(AbortSignal))
  expect(document.body.textContent).toContain("Historical result")
  expect(document.body.textContent).toContain("owner-session")
  await click("Close details")
  expect(document.querySelector('[data-testid="project-work-details"]')).toBeNull()
})
it("does not fetch without owner access and distinguishes unsupported API from empty Work", async () => {
  await render(false)
  expect(projectBoardClient.page).not.toHaveBeenCalled()
  vi.mocked(projectBoardClient.page).mockRejectedValueOnce(new ApiError("missing", 404, "Not Found"))
  await render()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("does not support")
  expect(document.body.textContent).not.toContain("No explicitly linked Work")
})
it("aborts stale project requests so late results cannot replace newer project data", async () => {
  let finish!: (value: ProjectBoardPage) => void
  vi.mocked(projectBoardClient.page).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await render()
  const signal = vi.mocked(projectBoardClient.page).mock.calls[0][3]!
  await render(true, { ...project, id: "another" })
  expect(signal.aborted).toBe(true)
  await act(async () => { const stale = page(); stale.data.rows[0].ticket.contract.title = "Stale result"; finish(stale) })
  expect(document.body.textContent).not.toContain("Stale result")
})
it("shows unknown counts for incomplete coverage and reloads after cursor expiry", async () => {
  const first = page(); first.coverage = "partial"; first.next_cursor = { commit: first.snapshot.commit, offset: 5, query_hash: "q" }
  vi.mocked(projectBoardClient.page).mockResolvedValueOnce(first).mockRejectedValueOnce(new ApiError("expired", 410, "Gone")).mockResolvedValueOnce(page())
  await render()
  expect(document.body.textContent).toContain("Counts are unknown")
  await click("Load more")
  expect(projectBoardClient.page).toHaveBeenCalledTimes(3)
  expect(vi.mocked(projectBoardClient.page).mock.calls[2][2]).toBeUndefined()
})

it("keeps a visible selected view button after focus moves while preserving aria-pressed", async () => {
  await render()
  const find = (name: string) => [...document.querySelectorAll("button")].find((button) => button.textContent === name)!
  expect(find("List").getAttribute("aria-pressed")).toBe("true")
  expect(find("List").classList.contains("bg-primary")).toBe(true)
  expect(find("Board").getAttribute("aria-pressed")).toBe("false")
  await click("Board")
  act(() => find("Refresh").focus())
  expect(find("Board").getAttribute("aria-pressed")).toBe("true")
  expect(find("Board").classList.contains("bg-primary")).toBe(true)
  expect(find("List").getAttribute("aria-pressed")).toBe("false")
  expect(find("List").classList.contains("bg-primary")).toBe(false)
})
