import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@services/api/errors"
import type { PatchProjectRequest, ProjectManifest, ProjectSidebar } from "@services/project"
import { useAppStore } from "@shared/store/appStore"
import {
  PROJECT_SECTIONS_STORAGE_KEY, createProjectSection, readProjectSectionPreferences,
  setSessionSection, writeProjectSectionPreferences,
} from "@/lib/projectSidebarPreferences"
import { useProjectSidebarSections } from "./useProjectSidebarSections"

const sectionId = "section:00000000-0000-4000-8000-000000000001"
const empty: ProjectSidebar = { sections: [], session_sections: {}, hidden_legacy: false }
const manifest = (sidebar: ProjectSidebar | null | undefined = null): ProjectManifest => ({
  id: "p1", name: "Zenith", section: "Development", sidebar, status: "active", revision: 1,
  resource_revision: 1, project_path: "/workspace/zenith", project_path_status: "configured",
  workspace_count: 1, schema_version: 2, workspace_bindings: [],
  created_at: "2026-10-15T00:00:00Z", updated_at: "2026-10-15T00:00:00Z",
})

let root: Root
let container: HTMLDivElement
let hook: ReturnType<typeof useProjectSidebarSections>
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

function Harness() {
  const projects = useAppStore((state) => state.projects)
  hook = useProjectSidebarSections(projects)
  return null
}

async function mount(strict = false) {
  await act(async () => root.render(strict ? <StrictMode><Harness /></StrictMode> : <Harness />))
}

function seedLegacy() {
  let preferences = createProjectSection(readProjectSectionPreferences(), "p1", "Research", "Development", sectionId)
  preferences = setSessionSection(preferences, "p1", "root-1", sectionId, "Development")
  writeProjectSectionPreferences(preferences)
}

const create = () => hook.update("p1", (previous) => createProjectSection(previous, "p1", "Research", "Development", sectionId))

beforeEach(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
  useAppStore.setState({
    projects: { p1: manifest() },
    ensureProject: vi.fn().mockResolvedValue(undefined),
    updateProject: vi.fn(async (id: string, revision: number, request: PatchProjectRequest) => {
      const current = useAppStore.getState().projects[id]!
      expect(revision).toBe(current.revision)
      const saved = { ...current, sidebar: request.sidebar ?? request.import_sidebar!, revision: revision + 1 }
      useAppStore.setState((state) => ({ projects: { ...state.projects, [id]: saved } }))
      return saved
    }),
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe("durable Project sidebar sections", () => {
  it("imports once under StrictMode and removes only the acknowledged Project's local data", async () => {
    seedLegacy()
    writeProjectSectionPreferences(createProjectSection(readProjectSectionPreferences(), "other", "Keep me"))
    await mount(true)
    expect(useAppStore.getState().updateProject).toHaveBeenCalledOnce()
    expect(useAppStore.getState().updateProject).toHaveBeenCalledWith("p1", 1, {
      import_sidebar: { sections: [{ id: sectionId, name: "Research" }], session_sections: { "root-1": sectionId }, hidden_legacy: false },
    })
    expect(hook.preferences.projects.p1?.sessionSections["root-1"]).toBe(sectionId)
    expect(readProjectSectionPreferences().projects.p1).toBeUndefined()
    expect(readProjectSectionPreferences().projects.other?.sections[0]?.name).toBe("Keep me")
  })

  it("keeps the legacy data until the server acknowledges the import", async () => {
    seedLegacy()
    const old = localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)
    let acknowledge!: (project: ProjectManifest) => void
    useAppStore.setState({ updateProject: vi.fn(() => new Promise<ProjectManifest>((resolve) => { acknowledge = resolve })) })
    await mount()
    expect(hook.busy.has("p1")).toBe(true)
    expect(localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)).toBe(old)
    await act(async () => {
      const saved = manifest({ sections: [{ id: sectionId, name: "Research" }], session_sections: {}, hidden_legacy: false })
      useAppStore.setState({ projects: { p1: saved } })
      acknowledge(saved)
    })
    expect(localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)).toBeNull()
    // The server can discard stale assignments; its receipt is authoritative.
    expect(hook.preferences.projects.p1?.sessionSections).toEqual({})
  })

  it("keeps failed import data and retries import before a subsequent edit", async () => {
    seedLegacy()
    const save = useAppStore.getState().updateProject
    useAppStore.setState({ updateProject: vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(save) })
    await mount()
    expect(hook.errors.p1).toContain("未保存")
    expect(readProjectSectionPreferences().projects.p1).toBeDefined()
    await act(async () => { await hook.update("p1", (previous) => setSessionSection(previous, "p1", "root-1", null, "Development")) })
    expect(useAppStore.getState().updateProject).toHaveBeenCalledTimes(3)
    expect(readProjectSectionPreferences().projects.p1).toBeUndefined()
    expect(hook.preferences.projects.p1?.sessionSections["root-1"]).toBeNull()
    expect(hook.errors.p1).toBeUndefined()
  })

  it("keeps newer edits made by a legacy tab during import", async () => {
    seedLegacy()
    let acknowledge!: (project: ProjectManifest) => void
    useAppStore.setState({ updateProject: vi.fn(() => new Promise<ProjectManifest>((resolve) => { acknowledge = resolve })) })
    await mount()
    writeProjectSectionPreferences(createProjectSection(readProjectSectionPreferences(), "p1", "New legacy edit"))
    await act(async () => {
      const saved = manifest({ ...empty, sections: [{ id: sectionId, name: "Research" }] })
      useAppStore.setState({ projects: { p1: saved } })
      acknowledge(saved)
    })
    expect(readProjectSectionPreferences().projects.p1?.sections).toHaveLength(2)
    expect(hook.preferences.projects.p1?.sections).toHaveLength(1)
  })

  it("never reimports browser data over an existing empty server snapshot", async () => {
    seedLegacy()
    useAppStore.setState({ projects: { p1: manifest(empty) } })
    await mount()
    expect(hook.preferences.projects.p1?.sections).toEqual([])
    expect(hook.preferences.projects.p1?.sessionSections).toEqual({})
    expect(useAppStore.getState().updateProject).not.toHaveBeenCalled()
  })

  it("shows saved sections in a clean browser without writing local section data", async () => {
    useAppStore.setState({ projects: { p1: manifest({ ...empty, sections: [{ id: sectionId, name: "Research" }] }) } })
    await mount()
    expect(hook.preferences.projects.p1?.sections[0]?.name).toBe("Research")
    expect(localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)).toBeNull()
    expect(useAppStore.getState().updateProject).not.toHaveBeenCalled()
  })

  it("waits for confirmation and serializes simultaneous edits for one Project", async () => {
    let acknowledge!: (project: ProjectManifest) => void
    useAppStore.setState({ updateProject: vi.fn(() => new Promise<ProjectManifest>((resolve) => { acknowledge = resolve })) })
    await mount()
    let pending!: Promise<boolean>
    act(() => { pending = create() })
    expect(hook.preferences.projects.p1?.sections).toEqual([])
    expect(hook.busy.has("p1")).toBe(true)
    await act(async () => { expect(await create()).toBe(false) })
    expect(useAppStore.getState().updateProject).toHaveBeenCalledOnce()
    await act(async () => {
      const saved = manifest({ ...empty, sections: [{ id: sectionId, name: "Research" }] })
      useAppStore.setState({ projects: { p1: saved } })
      acknowledge(saved)
      expect(await pending).toBe(true)
    })
    expect(hook.preferences.projects.p1?.sections[0]?.name).toBe("Research")
    expect(localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)).toBeNull()
  })

  it("does not commit a failed save locally", async () => {
    useAppStore.setState({ updateProject: vi.fn().mockRejectedValue(new Error("offline")) })
    await mount()
    await act(async () => { expect(await create()).toBe(false) })
    expect(hook.preferences.projects.p1?.sections).toEqual([])
    expect(hook.errors.p1).toContain("未保存")
    expect(localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)).toBeNull()
  })

  it("reloads the winning snapshot after a stale revision without replaying the failed intent", async () => {
    const winner = { ...manifest({ ...empty, sections: [{ id: sectionId, name: "Other client" }] }), revision: 3 }
    const reload = vi.fn(async () => { useAppStore.setState({ projects: { p1: winner } }) })
    useAppStore.setState({ updateProject: vi.fn().mockRejectedValue(new ApiError("stale", 412, "Precondition Failed")), ensureProject: reload })
    await mount()
    await act(async () => { expect(await create()).toBe(false) })
    expect(reload).toHaveBeenCalledWith("p1", { force: true })
    expect(hook.preferences.projects.p1?.sections[0]?.name).toBe("Other client")
    expect(hook.errors.p1).toContain("其他客户端")
    expect(useAppStore.getState().updateProject).toHaveBeenCalledOnce()
  })

  it("uses the snapshot revision when an event advertises a newer Project revision", async () => {
    const pendingPayload = { ...manifest(), revision: 2, confirmed_revision: 1 }
    const save = vi.fn().mockRejectedValue(new ApiError("stale", 412, "Precondition Failed"))
    useAppStore.setState({ projects: { p1: pendingPayload }, updateProject: save })
    await mount()
    await act(async () => { await create() })
    expect(save).toHaveBeenCalledWith("p1", 1, expect.objectContaining({ sidebar: expect.any(Object) }))
  })

  it("refreshes an already-imported conflict without discarding the local source", async () => {
    seedLegacy()
    useAppStore.setState({ updateProject: vi.fn().mockRejectedValue(new ApiError("already imported", 409, "Conflict")) })
    await mount()
    expect(useAppStore.getState().ensureProject).toHaveBeenCalledWith("p1", { force: true })
    expect(readProjectSectionPreferences().projects.p1).toBeDefined()
    expect(hook.errors.p1).toContain("其他客户端")
  })

  it("keeps local data and disables writes for an unsupported backend", async () => {
    seedLegacy()
    useAppStore.setState({ projects: { p1: { ...manifest(), sidebar: undefined } } })
    await mount()
    await act(async () => { expect(await create()).toBe(false) })
    expect(useAppStore.getState().updateProject).not.toHaveBeenCalled()
    expect(hook.errors.p1).toContain("更新 Bamboo")
    expect(readProjectSectionPreferences().projects.p1).toBeDefined()
  })

  it("keeps a failed Project's error when another Project saves successfully", async () => {
    const save = useAppStore.getState().updateProject
    useAppStore.setState({
      projects: { p1: manifest(), p2: { ...manifest(), id: "p2", name: "Other Project" } },
      updateProject: vi.fn((id, revision, request) => id === "p1" ? Promise.reject(new Error("offline")) : save(id, revision, request)),
    })
    await mount()
    await act(async () => { await create() })
    const originalError = hook.errors.p1
    expect(originalError).toContain("未保存")
    await act(async () => {
      expect(await hook.update("p2", (previous) => createProjectSection(previous, "p2", "Other section"))).toBe(true)
    })
    expect(hook.errors.p1).toBe(originalError)
    expect(hook.errors.p2).toBeUndefined()
    expect(useAppStore.getState().projects.p2!.sidebar?.sections[0]?.name).toBe("Other section")
  })

  it("does not clear legacy data when a response lacks an import receipt", async () => {
    seedLegacy()
    useAppStore.setState({ updateProject: vi.fn().mockResolvedValue({ ...manifest(), sidebar: undefined }) })
    await mount()
    expect(readProjectSectionPreferences().projects.p1).toBeDefined()
    expect(hook.errors.p1).toContain("更新 Bamboo")
  })
})
