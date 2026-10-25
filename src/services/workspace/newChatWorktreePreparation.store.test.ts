import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { projectService } from "@services/project/ProjectService"
import type { ProjectManifest } from "@services/project/types"
import { confirmedProjectRevision, createProjectSlice, type ProjectSlice } from "@shared/store/appStore/slices/projectSlice"
import { createSliceHarness } from "@shared/store/appStore/slices/__tests__/sliceHarness"
import { worktreeService } from "./WorktreeService"
import { NewChatWorktreePreparation } from "./newChatWorktreePreparation"

const runtime = vi.hoisted(() => ({ store: null as { getState(): ProjectSlice } | null }))
vi.mock("@shared/store/appStore", () => ({ useAppStore: { getState: () => runtime.store!.getState() } }))
const path = "/trees/task"
const manifest = (revision: number, bound = false): ProjectManifest => ({
  id: "p1", name: "Project one", status: "active", revision, resource_revision: 1,
  project_path: "/repo", project_path_status: "configured", workspace_count: bound ? 2 : 1,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", schema_version: 3,
  workspace_bindings: bound ? [{ path }] : [],
  sidebar: { sections: [], session_sections: {}, hidden_legacy: false },
})
const setup = () => {
  const preparation = new NewChatWorktreePreparation("p1", vi.fn())
  preparation.select({ repository: "/repo", root: "/trees", name: "task", branch: "chat/task" })
  return preparation
}
let store: ReturnType<typeof createSliceHarness<ProjectSlice>>
beforeEach(() => {
  store = createSliceHarness<ProjectSlice>(createProjectSlice as never)
  runtime.store = store
  store.setState({ projects: { p1: manifest(1) }, activeProjectId: "p1" })
  vi.spyOn(projectService, "getProject").mockResolvedValue(manifest(1))
  vi.spyOn(worktreeService, "create").mockResolvedValue({ path })
  vi.spyOn(projectService, "bindWorkspace").mockResolvedValue(manifest(2, true))
})
afterEach(() => vi.restoreAllMocks())

describe("new-chat worktree Project store integration", () => {
  it("publishes binding ACK before returning so the next Project mutation uses fresh CAS", async () => {
    await expect(setup().prepare(() => true)).resolves.toBe(path)
    const cached = store.getState().projects.p1!
    expect(cached.workspace_bindings).toEqual([{ path }])
    expect(confirmedProjectRevision(cached)).toBe(2)
    const archive = vi.spyOn(projectService, "archiveProject").mockResolvedValue({ ...manifest(3, true), status: "archived" })
    await store.getState().archiveProject("p1", cached.revision)
    expect(archive).toHaveBeenCalledExactlyOnceWith("p1", 2)
  })

  it("merges a binding ACK even when navigation invalidates the pending send", async () => {
    let acknowledge!: (value: ProjectManifest) => void
    vi.mocked(projectService.bindWorkspace).mockReturnValueOnce(new Promise((resolve) => { acknowledge = resolve }))
    let current = true
    const pending = setup().prepare(() => current)
    await vi.waitFor(() => expect(projectService.bindWorkspace).toHaveBeenCalledOnce())
    current = false
    acknowledge(manifest(2, true))
    await expect(pending).rejects.toMatchObject({ kind: "context-changed" })
    expect(confirmedProjectRevision(store.getState().projects.p1!)).toBe(2)
    expect(store.getState().projects.p1!.workspace_bindings).toEqual([{ path }])
  })

  it("does not roll a newer Project snapshot back when the binding ACK arrives late", async () => {
    let acknowledge!: (value: ProjectManifest) => void
    vi.mocked(projectService.bindWorkspace).mockReturnValueOnce(new Promise((resolve) => { acknowledge = resolve }))
    const pending = setup().prepare(() => true)
    await vi.waitFor(() => expect(projectService.bindWorkspace).toHaveBeenCalledOnce())
    const newer = { ...manifest(9, true), name: "Renamed elsewhere" }
    store.setState({ projects: { p1: newer } })
    acknowledge(manifest(2, true))
    await expect(pending).resolves.toBe(path)
    expect(store.getState().projects.p1).toEqual(newer)
    expect(confirmedProjectRevision(store.getState().projects.p1!)).toBe(9)
  })
})
