import { beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  request: vi.fn(),
}))

vi.mock("@services/api", () => ({
  apiClient: api,
  isApiError: (e: unknown) =>
    typeof e === "object" && e !== null && "status" in (e as Record<string, unknown>),
}))

import { createProjectSlice, type ProjectSlice } from "../projectSlice"
import { createSliceHarness } from "./sliceHarness"
import type { ProjectManifest } from "@services/project"

type Store = ProjectSlice & {
  chats: unknown[]
  currentSessionId: string | null
}

const createStore = () =>
  createSliceHarness<Store>(
    createProjectSlice as never,
    { chats: [], currentSessionId: null },
  )

const manifest = (id: string, overrides: Partial<ProjectManifest> = {}): ProjectManifest => ({
  id,
  name: `Project ${id}`,
  status: "active",
  revision: 1,
  resource_revision: 1,
  project_path: `/tmp/${id}`,
  project_path_status: "configured",
  workspace_count: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  schema_version: 2,
  workspace_bindings: [],
  ...overrides,
})

const summaryOf = ({ schema_version: _s, workspace_bindings: _w, ...summary }: ProjectManifest) =>
  summary

describe("projectSlice", () => {
  let store: ReturnType<typeof createStore>
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    store = createStore()
  })

  it("loads the project list and auto-selects the only active project", async () => {
    api.get.mockReturnValueOnce(
      Promise.resolve({
        projects: [summaryOf(manifest("p1")), summaryOf(manifest("p2", { status: "archived" }))],
      }),
    )
    await store.getState().loadProjects()

    expect(store.getState().projectsAvailable).toBe(true)
    expect(Object.keys(store.getState().projects).sort()).toEqual(["p1", "p2"])
    expect(store.getState().activeProjectId).toBe("p1")
  })

  it("marks the API unavailable on 404 without clearing unknown availability otherwise", async () => {
    api.get.mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }))
    await expect(store.getState().loadProjects()).rejects.toBeDefined()
    expect(store.getState().projectsAvailable).toBe(false)
  })

  it("creates a project and selects it as active", async () => {
    api.post.mockReturnValueOnce(Promise.resolve(manifest("p9")))
    await store.getState().createProject({ name: "New", project_path: "/tmp/p9" })

    expect(store.getState().projects["p9"]?.name).toBe("Project p9")
    expect(store.getState().activeProjectId).toBe("p9")
    expect(localStorage.getItem("lotus_active_project_v1")).toContain("p9")
  })

  it("archives a project and drops it as the active default", async () => {
    api.get.mockReturnValueOnce(
      Promise.resolve({ projects: [summaryOf(manifest("p1"))] }),
    )
    await store.getState().loadProjects()
    expect(store.getState().activeProjectId).toBe("p1")

    api.post.mockReturnValueOnce(
      Promise.resolve(manifest("p1", { status: "archived", revision: 2 })),
    )
    await store.getState().archiveProject("p1", 1)

    expect(store.getState().projects["p1"]?.status).toBe("archived")
    expect(store.getState().activeProjectId).toBeNull()
  })

  it("tombstones projects that 404 in ensureProject", async () => {
    api.get.mockRejectedValueOnce(Object.assign(new Error("gone"), { status: 404 }))
    await store.getState().ensureProject("missing")
    expect(store.getState().projectsMissing["missing"]).toBe(true)
  })
})
