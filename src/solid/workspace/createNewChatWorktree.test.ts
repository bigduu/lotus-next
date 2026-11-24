import { createRoot, createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { ApiError } from "@services/api/errors"
import type { ProjectManifest } from "@services/project/types"
import { projectService } from "@services/project/ProjectService"
import { worktreeService } from "@services/workspace/WorktreeService"
import { appStore } from "@shared/store/appStore/state"
import { createNewChatWorktree } from "./createNewChatWorktree"

const selection = { repository: "/repo", root: "/trees", name: "task", branch: "task-branch" }
const path = "/trees/task"
const project = (id = "p1", revision = 1, workspace_bindings: ProjectManifest["workspace_bindings"] = []): ProjectManifest => ({
  id, name: id, status: "active", revision, resource_revision: 1, project_path: "/repo", project_path_status: "configured",
  workspace_count: 1 + workspace_bindings.length, workspace_bindings, schema_version: 3,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

const initial = appStore.getState()
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose()
  appStore.setState(initial, true)
  vi.restoreAllMocks()
})
function mount() {
  const [sessionId, setSessionId] = createSignal<string | null>(null)
  const [projectId, setProjectId] = createSignal<string | null>("p1")
  const [workspacePath, setWorkspacePath] = createSignal<string | null>("/repo")
  const [existingPath, setExistingPath] = createSignal<string | null>(null)
  const [draftEpoch, setDraftEpoch] = createSignal(0)
  let version = 0
  const get = vi.spyOn(projectService, "getProject").mockImplementation(async (id) => project(id))
  const create = vi.spyOn(worktreeService, "create").mockResolvedValue({ path })
  const bind = vi.fn(async (id: string, revision: number, binding: { path: string }) => project(id, revision + 1, [binding]))
  appStore.setState({ currentSessionId: null, projects: { p1: project(), p2: project("p2") }, bindWorkspace: bind })
  const control = createRoot((dispose) => {
    cleanups.push(dispose)
    return createNewChatWorktree({ sessionId, projectId, workspacePath, existingPath, draftEpoch, navigationVersion: () => version })
  })
  const changeSession = (id: string | null) => {
    version += 1
    setSessionId(id)
    appStore.setState({ currentSessionId: id })
  }
  flush()
  return { control, get, create, bind, navigate(change: string) {
    if (change === "existing" || change === "away-back") changeSession("different-session")
    if (change === "away-back") { flush(); changeSession(null) }
    if (change === "new-draft") setDraftEpoch(1)
    if (change === "project") setProjectId("p2")
    if (change === "workspace") setWorkspacePath("/another")
    if (change === "picked-worktree") setExistingPath("/already-checked-out")
    if (change === "before-render") version += 2
    flush()
  } }
}

it("uses the current checkout by default without reading or mutating Worktree state", () => {
  const h = mount()
  expect(h.control.selection).toBeNull()
  expect(h.control.capture().prepare).toBeNull()
  expect(h.get).not.toHaveBeenCalled()
  expect(h.create).not.toHaveBeenCalled()
  expect(h.bind).not.toHaveBeenCalled()
})

it.each(["existing", "new-draft", "project", "workspace", "away-back", "picked-worktree", "before-render"])(
  "blocks stale binding after a navigation change during creation: %s", async (destination) => {
    const h = mount(), waiting = deferred<{ path: string }>()
    h.create.mockReturnValueOnce(waiting.promise)
    h.control.select(selection)
    flush()
    const captured = h.control.capture()
    const abandoned = expect(captured.prepare!()).rejects.toMatchObject({ kind: "context-changed" })
    await vi.waitFor(() => expect(h.create).toHaveBeenCalledExactlyOnceWith("p1", selection))
    h.navigate(destination)
    expect(captured.isCurrent()).toBe(false)
    waiting.resolve({ path })
    await abandoned
    flush()
    expect(h.bind).not.toHaveBeenCalled()
    if (destination === "new-draft") expect(h.control.selection).toBeNull()
    if (destination === "away-back") {
      expect(h.control.preparedPath).toBe(path)
      await expect(h.control.capture().prepare!()).resolves.toBe(path)
      expect(h.create).toHaveBeenCalledTimes(1)
      expect(h.bind).toHaveBeenCalledExactlyOnceWith("p1", 1, { path })
    }
  },
)

it("guards duplicate preparation and preserves the exact acknowledged path during a binding retry", async () => {
  const h = mount(), waiting = deferred<{ path: string }>()
  h.create.mockReturnValueOnce(waiting.promise)
  h.bind.mockRejectedValueOnce(new ApiError("stale", 409, "Conflict"))
  h.control.select(selection)
  flush()
  const captured = h.control.capture()
  const conflict = expect(captured.prepare!()).rejects.toMatchObject({ kind: "failed" })
  await expect(captured.prepare!()).rejects.toMatchObject({ kind: "failed" })
  expect(h.control.capture().isCurrent()).toBe(true)
  await vi.waitFor(() => expect(h.create).toHaveBeenCalledTimes(1))
  waiting.resolve({ path })
  await conflict
  flush()
  expect(h.control.preparedPath).toBe(path)
  expect(h.control.locked).toBe(true)
  h.get.mockResolvedValueOnce(project("p1", 12))
  await expect(h.control.capture().prepare!()).resolves.toBe(path)
  expect(h.create).toHaveBeenCalledTimes(1)
  expect(h.bind).toHaveBeenNthCalledWith(2, "p1", 12, { path })
})

it("refuses a prepared send after navigation changes during a pending authoritative binding", async () => {
  const h = mount(), binding = deferred<ProjectManifest>()
  h.bind.mockReturnValueOnce(binding.promise)
  h.control.select(selection)
  flush()
  const previous = h.control.capture()
  const result = expect(previous.prepare!()).rejects.toMatchObject({ kind: "context-changed" })
  await vi.waitFor(() => expect(h.bind).toHaveBeenCalledExactlyOnceWith("p1", 1, { path }))
  h.navigate("existing")
  binding.resolve(project("p1", 2, [{ path }]))
  await result
  expect(previous.isCurrent()).toBe(false)
  expect(h.control.capture().prepare).toBeNull()
})
