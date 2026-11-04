/// <reference types="node" />
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { changeLocale } from "@shared/i18n"
import { uiText } from "@shared/i18n/ui"
import { ApiError, apiClient } from "@services/api"
import type { ProjectManifest } from "@services/project"
import { projectBoardClient, type BoardWorkView, type ProjectBoardPage } from "@services/tickets/projectBoard"
import type { ReadEnvelope } from "@services/tickets/types"
import { OwnerAccessContext } from "@/hooks/ownerAccessContext"
import { ProjectWorkBoard } from "./ProjectWorkBoard"
vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(), apiClient: { get: vi.fn(), post: vi.fn(), postOnce: vi.fn() } }))
vi.mock("@services/tickets/projectBoard", async (original) => ({ ...await original<typeof import("@services/tickets/projectBoard")>(), projectBoardClient: { page: vi.fn(), inspect: vi.fn() } }))
vi.mock("@services/tickets/sprints", async (original) => {
  const actual = await original<typeof import("@services/tickets/sprints")>()
  const { ApiError: ErrorType } = await import("@services/api")
  // The captured f7 producer has no Sprint routes. Keep its explicit unsupported
  // port separate from the precise Session GET sequence under test here.
  return { ...actual, sprintClient: { list: vi.fn().mockRejectedValue(new ErrorType("Sprint planning unavailable in the f7 fixture", 404, "Not Found")), scope: vi.fn().mockResolvedValue({ available: false, mutation_enabled: false }), inspect: vi.fn(), command: vi.fn() } }
})
const directory = resolve(process.cwd(), "src/test/fixtures/projectWorkAssignmentContract")
const read = (name: string) => readFileSync(resolve(directory, name))
const capture = (name: string) => JSON.parse(read(name).toString())
const active = capture("active-board.json") as ProjectBoardPage
const activeView = (capture("active-inspect.json") as ReadEnvelope<BoardWorkView[]>).data[0]
const project = { id: active.data.project_id, name: "Synthetic captured Project", revision: 4, resource_revision: 2, workspace_bindings: [] } as unknown as ProjectManifest
const sessionId = activeView.assignments[0].runtime!.session_id
let root: Root
beforeEach(async () => {
  await changeLocale("en-US")
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.body.replaceChildren(); root = createRoot(document.body.appendChild(document.createElement("div")))
  vi.mocked(projectBoardClient.page).mockReset().mockResolvedValue(active)
  vi.mocked(projectBoardClient.inspect).mockReset().mockResolvedValue(activeView)
  vi.mocked(apiClient.get).mockReset().mockResolvedValue({ session: { id: sessionId, kind: "child", project_id: project.id } })
  vi.mocked(apiClient.post).mockReset()
  vi.mocked(apiClient.postOnce).mockReset().mockRejectedValue(new ApiError("Legacy backend", 404, "Not Found"))
})
afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks() })
async function render(onOpenSession?: (id: string) => void | Promise<void>) {
  await act(async () => root.render(<OwnerAccessContext.Provider value={true}><ProjectWorkBoard project={project} onOpenSession={onOpenSession ? async (id, verifyAccess) => { if (!await verifyAccess()) return false; await onOpenSession(id); return true } : undefined} /></OwnerAccessContext.Provider>))
  await act(async () => (document.querySelector(`[data-testid="project-work-${activeView.ticket.id}"]`) as HTMLButtonElement).click())
}
const openButton = () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Open verified session")
const observation = () => document.querySelector('[data-testid="assignment-observation"]')
it("retains exact f7 synthetic actual-HTTP capture bytes without claiming real Session access", () => {
  const manifest = capture("manifest.json")
  expect(manifest.backend_source).toBe("f7c274cd284098d02f09420bad44ecab2a107181")
  expect(manifest.session_access_proven).toBe(false)
  for (const [file, hash] of Object.entries(manifest.sha256)) expect(createHash("sha256").update(read(file)).digest("hex")).toBe(hash)
})
it("consumes stopped inspector history without sampling the old Assignment", async () => {
  vi.mocked(projectBoardClient.page).mockResolvedValue(capture("stopped-board.json"))
  vi.mocked(projectBoardClient.inspect).mockResolvedValue((capture("stopped-inspect.json") as ReadEnvelope<BoardWorkView[]>).data[0])
  await render()
  expect(document.querySelector('[data-testid="assignment-owner-status"]')?.textContent).toBe(uiText("assignment_health_no_current_executor"))
  expect(document.querySelector('[data-testid="assignment-history"]')?.textContent).toContain(activeView.assignments[0].id)
  expect(document.querySelector('[data-testid="assignment-history"]')?.textContent).toContain(sessionId)
  expect(document.querySelector('[data-testid="assignment-history"]')?.textContent).toContain(uiText("assignment_health_stopped_confirmed"))
  expect(observation()?.textContent).toContain("Last heartbeatUnknown")
  expect(apiClient.postOnce).not.toHaveBeenCalled()
  expect(apiClient.get).not.toHaveBeenCalled()
})
it("uses a controlled GET result and rechecks before opening only the exact recorded Session", async () => {
  const opened = vi.fn()
  await render(opened)
  expect(openButton()).toBeDefined()
  await act(async () => openButton()!.click())
  expect(opened).toHaveBeenCalledExactlyOnceWith(sessionId)
  expect(apiClient.get).toHaveBeenCalledTimes(2)
  expect(apiClient.get).toHaveBeenLastCalledWith(`sessions/${encodeURIComponent(sessionId)}`, { signal: expect.any(AbortSignal) })
  expect(apiClient.post).not.toHaveBeenCalled()
})
it.each([[403, "Session access denied"], [404, "Session no longer exists"]] as const)("keeps recorded refs but prevents navigation after GET %s", async (status, text) => {
  vi.mocked(apiClient.get).mockRejectedValue(new ApiError("fixture", status, "fixture"))
  const opened = vi.fn(); await render(opened)
  expect(document.body.textContent).toContain(text)
  expect(document.body.textContent).toContain(sessionId)
  expect(openButton()).toBeUndefined()
  expect(opened).not.toHaveBeenCalled()
})
it("does not open a Session deleted between the first read and click", async () => {
  vi.mocked(apiClient.get).mockResolvedValueOnce({ session: { id: sessionId, kind: "child" } }).mockRejectedValue(new ApiError("fixture", 404, "fixture"))
  const opened = vi.fn(); await render(opened)
  await act(async () => openButton()!.click())
  expect(opened).not.toHaveBeenCalled()
  expect(openButton()).toBeUndefined()
  expect(document.body.textContent).toContain("Session no longer exists")
})
it("invalidates current-owner and access observations while offline", async () => {
  const opened = vi.fn(); await render(opened)
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
  await act(async () => window.dispatchEvent(new Event("offline")))
  expect(openButton()).toBeUndefined()
  expect(document.querySelector('[data-testid="assignment-owner-status"]')?.textContent).toBe(uiText("assignment_health_owner_unknown"))
  expect(opened).not.toHaveBeenCalled()
})
it("aborts an outstanding Session read when the selected details close", async () => {
  let finish!: (value: unknown) => void
  vi.mocked(apiClient.get).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const opened = vi.fn(); await render(opened)
  const signal = vi.mocked(apiClient.get).mock.calls[0][1]?.signal
  await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Close details")!.click())
  expect(signal?.aborted).toBe(true)
  await act(async () => finish({ session: { id: sessionId, kind: "child" } }))
  expect(document.querySelector('[data-testid="assignment-health-panel"]')).toBeNull()
  expect(opened).not.toHaveBeenCalled()
})

const observedAt = Date.parse("2026-11-04T04:30:00Z")
const sample = (commit = active.snapshot.commit) => ({
  state: "observed",
  scope: { project_id: project.id, work_id: activeView.ticket.id, assignment_id: activeView.assignments[0].id,
    generation: activeView.ticket.generation, authority_epoch: active.snapshot.authority_epoch },
  ticket_commit: commit, started_at_ms: observedAt, heartbeat_at_ms: observedAt,
  progress: null, expected_wait: null, execution_outcome_unknown: false,
})

it("reads only the pinned current Assignment and clears facts offline", async () => {
  vi.mocked(apiClient.postOnce).mockResolvedValue(sample())
  await render()
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
  expect(observation()?.querySelector("time")?.dateTime).toBe(new Date(observedAt).toISOString())
  expect(observation()?.textContent).toContain("Last effective progressUnknown")
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
  await act(async () => window.dispatchEvent(new Event("offline")))
  expect(observation()?.querySelector("time")).toBeNull()
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
})

it("does not start an observation when the inspector's active Assignment fence is inconsistent", async () => {
  vi.mocked(projectBoardClient.inspect).mockResolvedValue({ ...activeView, assignments: [{ ...activeView.assignments[0], generation: activeView.ticket.generation + 1 }] })
  await render()
  expect(observation()?.textContent).toContain("Last heartbeatUnknown")
  expect(apiClient.postOnce).not.toHaveBeenCalled()
})

it("cannot paint a late sample after a board refresh remounts the same Work on a new commit", async () => {
  let finish!: (value: unknown) => void
  vi.mocked(apiClient.postOnce)
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    .mockResolvedValueOnce(sample("new-commit"))
  await render()
  const signal = vi.mocked(apiClient.postOnce).mock.calls[0][2]?.signal
  vi.mocked(projectBoardClient.page).mockResolvedValue({ ...active, snapshot: { ...active.snapshot, commit: "new-commit" } })
  await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent === uiText("refresh_aee88743"))!.click())
  expect(signal?.aborted).toBe(true)
  expect(apiClient.postOnce).toHaveBeenCalledTimes(2)
  await act(async () => finish({ ...sample(), progress: { sequence: 1, at_ms: observedAt } }))
  expect(observation()?.querySelector("time")?.dateTime).toBe(new Date(observedAt).toISOString())
  expect(observation()?.textContent).toContain("Last effective progressUnknown")
})

it("aborts the runtime sample on owner access loss and ignores its late result", async () => {
  let finish!: (value: unknown) => void
  vi.mocked(apiClient.postOnce).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await render()
  const signal = vi.mocked(apiClient.postOnce).mock.calls[0][2]?.signal
  await act(async () => root.render(<OwnerAccessContext.Provider value={false}><ProjectWorkBoard project={project} /></OwnerAccessContext.Provider>))
  expect(signal?.aborted).toBe(true)
  await act(async () => finish(sample()))
  expect(observation()).toBeNull()
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
})

it.each([true, false])("reads a restarted current pointer with stop proof %s without showing a current executor", async (stopped) => {
  vi.mocked(projectBoardClient.page).mockResolvedValue({
    ...active, snapshot: { ...active.snapshot, authority_epoch: active.snapshot.authority_epoch + 1 },
  })
  vi.mocked(projectBoardClient.inspect).mockResolvedValue({
    ...activeView, assignments: [{ ...activeView.assignments[0], state: "outcome_unknown", process_stopped: stopped,
      runtime: stopped ? activeView.assignments[0].runtime : null }],
  })
  vi.mocked(apiClient.postOnce).mockResolvedValue({
    ...sample(), state: "unknown", started_at_ms: null, heartbeat_at_ms: null, execution_outcome_unknown: true,
  })
  await render()
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
  expect(observation()?.textContent).toContain("Execution outcome is unconfirmed.")
  expect(observation()?.textContent).toContain("Last heartbeatUnknown")
  expect(document.querySelector('[data-testid="assignment-owner-status"]')?.textContent).toBe(uiText("assignment_health_owner_unknown"))
})

it.each(["answered", "wrong generation", "ambiguous"] as const)(
  "keeps a stopped Question with %s evidence out of the observation request", async (failure) => {
    const work = { ...activeView.ticket, state: "blocked" as const, active_assignment: null }
    const attempt = { ...activeView.assignments[0], state: "blocked", process_stopped: true, awaiting_request: "question" }
    const question = {
      id: "question", work_id: work.id, assignment_id: attempt.id,
      generation: work.generation + (failure === "wrong generation" ? 1 : 0),
      contract_revision: work.contract_revision, prompt_revision: 1, worker_packet_hash: "a".repeat(64),
      status: failure === "answered" ? "answered" as const : "open" as const, kind: { kind: "question" as const },
      prompt: "Input", answer: null, updated_seq: active.snapshot.seq,
    }
    vi.mocked(projectBoardClient.page).mockResolvedValue({
      ...active, data: { ...active.data, rows: active.data.rows.map((row) => ({ ...row, ticket: { ...row.ticket, ...work } })) },
    })
    vi.mocked(projectBoardClient.inspect).mockResolvedValue({
      ...activeView, ticket: work, assignments: failure === "ambiguous" ? [attempt, attempt] : [attempt], requests: [question],
    })
    await render()
    expect(apiClient.postOnce).not.toHaveBeenCalled()
    expect(observation()?.textContent).toContain("Last effective progressUnknown")
  },
)
