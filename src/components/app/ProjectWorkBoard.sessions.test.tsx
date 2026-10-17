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
vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(), apiClient: { get: vi.fn(), post: vi.fn() } }))
vi.mock("@services/tickets/projectBoard", async (original) => ({ ...await original<typeof import("@services/tickets/projectBoard")>(), projectBoardClient: { page: vi.fn(), inspect: vi.fn() } }))
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
})
afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks() })
async function render(onOpenSession?: (id: string) => void | Promise<void>) {
  await act(async () => root.render(<OwnerAccessContext.Provider value={true}><ProjectWorkBoard project={project} onOpenSession={onOpenSession ? async (id, verifyAccess) => { if (!await verifyAccess()) return false; await onOpenSession(id); return true } : undefined} /></OwnerAccessContext.Provider>))
  await act(async () => (document.querySelector(`[data-testid="project-work-${activeView.ticket.id}"]`) as HTMLButtonElement).click())
}
const openButton = () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Open verified session")
it("retains exact f7 synthetic actual-HTTP capture bytes without claiming real Session access", () => {
  const manifest = capture("manifest.json")
  expect(manifest.backend_source).toBe("f7c274cd284098d02f09420bad44ecab2a107181")
  expect(manifest.session_access_proven).toBe(false)
  for (const [file, hash] of Object.entries(manifest.sha256)) expect(createHash("sha256").update(read(file)).digest("hex")).toBe(hash)
})
it("consumes stopped inspector history while keeping heartbeat and patrol unsupported", async () => {
  vi.mocked(projectBoardClient.page).mockResolvedValue(capture("stopped-board.json"))
  vi.mocked(projectBoardClient.inspect).mockResolvedValue((capture("stopped-inspect.json") as ReadEnvelope<BoardWorkView[]>).data[0])
  await render()
  expect(document.querySelector('[data-testid="assignment-owner-status"]')?.textContent).toBe(uiText("assignment_health_no_current_executor"))
  expect(document.querySelector('[data-testid="assignment-history"]')?.textContent).toContain(activeView.assignments[0].id)
  expect(document.querySelector('[data-testid="assignment-history"]')?.textContent).toContain(sessionId)
  expect(document.querySelector('[data-testid="assignment-history"]')?.textContent).toContain(uiText("assignment_health_stopped_confirmed"))
  expect(document.querySelector('[data-testid="assignment-observation-status"]')?.textContent).toBe("Unsupported")
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
