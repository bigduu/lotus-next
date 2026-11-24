import { createRoot, flush } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@services/api/errors"
import { projectService, type PatchProjectRequest, type ProjectManifest, type ProjectSidebar } from "@services/project"
import { appStore } from "@shared/store/appStore/state"
import { uiText } from "@shared/i18n/text"
import {
  PROJECT_SECTIONS_STORAGE_KEY, createProjectSection, readProjectSectionPreferences,
  setSessionSection, writeProjectSectionPreferences,
} from "@/lib/projectSidebarPreferences"
import { assignSessionToSection } from "@/lib/projectSidebarWrites"
import { createStoreSelector } from "../state/createStoreSelector"
import { createProjectSections } from "./createProjectSections"
import { sectionWriteErrorText } from "./ProjectSectionDialog"

const sectionId = "section:00000000-0000-4000-8000-000000000001"
const empty: ProjectSidebar = { sections: [], session_sections: {}, hidden_legacy: false }
const manifest = (sidebar: ProjectSidebar | null | undefined = null): ProjectManifest => ({
  id: "p1", name: "Zenith", section: "Development", sidebar, status: "active", revision: 1,
  resource_revision: 1, project_path: "/workspace/zenith", project_path_status: "configured",
  workspace_count: 1, schema_version: 2, workspace_bindings: [],
  created_at: "2026-10-15T00:00:00Z", updated_at: "2026-10-15T00:00:00Z",
})

let dispose: (() => void) | undefined
let sections: ReturnType<typeof createProjectSections>
const projectActions = {
  ensureProject: appStore.getState().ensureProject,
  updateProject: appStore.getState().updateProject,
}

function flushSidebar(action: () => unknown) {
  const result = action()
  flush()
  return result
}
async function settle(action: () => unknown) {
  await flushSidebar(action)
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  flush()
}
const mount = () => settle(() => {
  dispose = createRoot((cleanup) => {
    const projects = createStoreSelector(appStore, (state) => state.projects)
    sections = createProjectSections(projects, appStore.getState)
    return cleanup
  })
})
function unmount() {
  dispose?.()
  dispose = undefined
}
function writeError(projectId: string) {
  const failure = sections.failures()[projectId]
  return failure ? uiText(sectionWriteErrorText[failure]) : undefined
}
const assignSessionToSectionDurable = (projectId: string, sessionId: string, targetSection: string | null) =>
  assignSessionToSection(appStore.getState, projectId, sessionId, targetSection)

function seedLegacy() {
  let preferences = createProjectSection(readProjectSectionPreferences(), "p1", "Research", "Development", sectionId)
  preferences = setSessionSection(preferences, "p1", "root-1", sectionId, "Development")
  writeProjectSectionPreferences(preferences)
}

const create = () => sections.update("p1", (previous) => createProjectSection(previous, "p1", "Research", "Development", sectionId))

beforeEach(() => {
  localStorage.clear()
  appStore.setState({
    projects: { p1: manifest() },
    ensureProject: vi.fn().mockResolvedValue(undefined),
    updateProject: vi.fn(async (id: string, revision: number, request: PatchProjectRequest) => {
      const current = appStore.getState().projects[id]!
      expect(revision).toBe(current.revision)
      const saved = { ...current, sidebar: request.sidebar ?? request.import_sidebar!, revision: revision + 1 }
      appStore.setState((state) => ({ projects: { ...state.projects, [id]: saved } }))
      return saved
    }),
  })
})

afterEach(() => {
  unmount()
  vi.restoreAllMocks()
})

describe("durable Project sidebar sections", () => {
  it("imports once across an owner remount and removes only the acknowledged Project's local data", async () => {
    seedLegacy()
    writeProjectSectionPreferences(createProjectSection(readProjectSectionPreferences(), "other", "Keep me"))
    const save = appStore.getState().updateProject
    let acknowledge!: () => void
    const pending = new Promise<void>((resolve) => { acknowledge = resolve })
    appStore.setState({ updateProject: vi.fn(async (id: string, revision: number, request: PatchProjectRequest) => {
      await pending
      return save(id, revision, request)
    }) })
    try {
      await mount()
      expect(sections.busy().has("p1")).toBe(true)
      unmount()
      await mount()
      expect(appStore.getState().updateProject).toHaveBeenCalledOnce()
      expect(readProjectSectionPreferences().projects.p1).toBeDefined()
      await settle(acknowledge)
    } finally {
      acknowledge()
    }
    expect(appStore.getState().updateProject).toHaveBeenCalledOnce()
    expect(appStore.getState().updateProject).toHaveBeenCalledWith("p1", 1, {
      import_sidebar: { sections: [{ id: sectionId, name: "Research" }], session_sections: { "root-1": sectionId }, hidden_legacy: false },
    })
    expect(sections.preferences().projects.p1?.sessionSections["root-1"]).toBe(sectionId)
    expect(readProjectSectionPreferences().projects.p1).toBeUndefined()
    expect(readProjectSectionPreferences().projects.other?.sections[0]?.name).toBe("Keep me")
  })

  it("keeps the legacy data until the server acknowledges the import", async () => {
    seedLegacy()
    const old = localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)
    let acknowledge!: (project: ProjectManifest) => void
    appStore.setState({ updateProject: vi.fn(() => new Promise<ProjectManifest>((resolve) => { acknowledge = resolve })) })
    await mount()
    expect(sections.busy().has("p1")).toBe(true)
    expect(localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)).toBe(old)
    await settle(async () => {
      const saved = manifest({ sections: [{ id: sectionId, name: "Research" }], session_sections: {}, hidden_legacy: false })
      appStore.setState({ projects: { p1: saved } })
      acknowledge(saved)
    })
    expect(localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)).toBeNull()
    // The server can discard stale assignments; its receipt is authoritative.
    expect(sections.preferences().projects.p1?.sessionSections).toEqual({})
  })

  it("keeps failed import data and retries import before a subsequent edit", async () => {
    seedLegacy()
    const save = appStore.getState().updateProject
    appStore.setState({ updateProject: vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(save) })
    await mount()
    expect(writeError("p1")).toContain("未保存")
    expect(readProjectSectionPreferences().projects.p1).toBeDefined()
    await settle(async () => { await sections.update("p1", (previous) => setSessionSection(previous, "p1", "root-1", null, "Development")) })
    expect(appStore.getState().updateProject).toHaveBeenCalledTimes(3)
    expect(readProjectSectionPreferences().projects.p1).toBeUndefined()
    expect(sections.preferences().projects.p1?.sessionSections["root-1"]).toBeNull()
    expect(writeError("p1")).toBeUndefined()
  })

  it("keeps newer edits made by a legacy tab during import", async () => {
    seedLegacy()
    let acknowledge!: (project: ProjectManifest) => void
    appStore.setState({ updateProject: vi.fn(() => new Promise<ProjectManifest>((resolve) => { acknowledge = resolve })) })
    await mount()
    writeProjectSectionPreferences(createProjectSection(readProjectSectionPreferences(), "p1", "New legacy edit"))
    await settle(async () => {
      const saved = manifest({ ...empty, sections: [{ id: sectionId, name: "Research" }] })
      appStore.setState({ projects: { p1: saved } })
      acknowledge(saved)
    })
    expect(readProjectSectionPreferences().projects.p1?.sections).toHaveLength(2)
    expect(sections.preferences().projects.p1?.sections).toHaveLength(1)
  })

  it("never reimports browser data over an existing empty server snapshot", async () => {
    seedLegacy()
    appStore.setState({ projects: { p1: manifest(empty) } })
    await mount()
    expect(sections.preferences().projects.p1?.sections).toEqual([])
    expect(sections.preferences().projects.p1?.sessionSections).toEqual({})
    expect(appStore.getState().updateProject).not.toHaveBeenCalled()
  })

  it("shows saved sections in a clean browser without writing local section data", async () => {
    appStore.setState({ projects: { p1: manifest({ ...empty, sections: [{ id: sectionId, name: "Research" }] }) } })
    await mount()
    expect(sections.preferences().projects.p1?.sections[0]?.name).toBe("Research")
    expect(localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)).toBeNull()
    expect(appStore.getState().updateProject).not.toHaveBeenCalled()
  })

  it("waits for confirmation and serializes simultaneous edits for one Project", async () => {
    let acknowledge!: (project: ProjectManifest) => void
    appStore.setState({ updateProject: vi.fn(() => new Promise<ProjectManifest>((resolve) => { acknowledge = resolve })) })
    await mount()
    let pending!: Promise<boolean>
    flushSidebar(() => { pending = create() })
    expect(sections.preferences().projects.p1?.sections).toEqual([])
    expect(sections.busy().has("p1")).toBe(true)
    await settle(async () => { expect(await create()).toBe(false) })
    expect(appStore.getState().updateProject).toHaveBeenCalledOnce()
    await settle(async () => {
      const saved = manifest({ ...empty, sections: [{ id: sectionId, name: "Research" }] })
      appStore.setState({ projects: { p1: saved } })
      acknowledge(saved)
      expect(await pending).toBe(true)
    })
    expect(sections.preferences().projects.p1?.sections[0]?.name).toBe("Research")
    expect(localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)).toBeNull()
  })

  it("does not commit a failed save locally", async () => {
    appStore.setState({ updateProject: vi.fn().mockRejectedValue(new Error("offline")) })
    await mount()
    await settle(async () => { expect(await create()).toBe(false) })
    expect(sections.preferences().projects.p1?.sections).toEqual([])
    expect(writeError("p1")).toContain("未保存")
    expect(localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)).toBeNull()
  })

  it("reloads the winning snapshot after a stale revision without replaying the failed intent", async () => {
    const winner = { ...manifest({ ...empty, sections: [{ id: sectionId, name: "Other client" }] }), revision: 3 }
    const reload = vi.fn(async () => { appStore.setState({ projects: { p1: winner } }) })
    appStore.setState({ updateProject: vi.fn().mockRejectedValue(new ApiError("stale", 412, "Precondition Failed")), ensureProject: reload })
    await mount()
    await settle(async () => { expect(await create()).toBe(false) })
    expect(reload).toHaveBeenCalledWith("p1", { force: true })
    expect(sections.preferences().projects.p1?.sections[0]?.name).toBe("Other client")
    expect(writeError("p1")).toContain("其他客户端")
    expect(appStore.getState().updateProject).toHaveBeenCalledOnce()
  })

  it("starts a fresh conflict read after an older in-flight Project read settles", async () => {
    const winner = { ...manifest({ ...empty, sections: [{ id: "section:00000000-0000-4000-8000-000000000002", name: "Other client" }] }), revision: 3 }
    let finishOlderRead!: (project: ProjectManifest) => void
    const get = vi.spyOn(projectService, "getProject")
      .mockImplementationOnce(() => new Promise<ProjectManifest>((resolve) => { finishOlderRead = resolve }))
      .mockResolvedValueOnce(winner)
    const patch = vi.spyOn(projectService, "patchProject").mockRejectedValueOnce(new ApiError("stale", 412, "Precondition Failed"))
    appStore.setState(projectActions)
    const olderRead = projectActions.ensureProject("p1", { force: true })
    await mount()
    let losingSave!: Promise<boolean>
    await settle(async () => { losingSave = create(); await Promise.resolve() })
    expect(get).toHaveBeenCalledOnce()
    await settle(async () => {
      finishOlderRead(manifest())
      await olderRead
      expect(await losingSave).toBe(false)
    })
    expect(get).toHaveBeenCalledTimes(2)
    expect(sections.preferences().projects.p1?.sections[0]?.name).toBe("Other client")
    patch.mockImplementationOnce(async (_id, revision, request) => ({ ...winner, sidebar: request.sidebar!, revision: revision + 1 }))
    await settle(async () => { expect(await create()).toBe(true) })
    expect(patch).toHaveBeenLastCalledWith("p1", 3, expect.any(Object))
    expect(sections.preferences().projects.p1?.sections.map((section) => section.name)).toEqual(["Other client", "Research"])
  })

  it.each([false, true])("confirms a save rejected by an event-ahead store (refresh fails: %s)", async (refreshFails) => {
    const saved = { ...manifest({ ...empty, sections: [{ id: sectionId, name: "Research" }] }), revision: 2 }
    const winner = { ...saved, revision: 3 }
    let failEventRead!: (failure: Error) => void
    const get = vi.spyOn(projectService, "getProject")
      .mockResolvedValueOnce(manifest())
      .mockImplementationOnce(() => new Promise<ProjectManifest>((_resolve, reject) => { failEventRead = reject }))
    if (refreshFails) get.mockRejectedValueOnce(new Error("offline"))
    else get.mockResolvedValueOnce(winner)
    let confirmPatch!: (project: ProjectManifest) => void
    const patch = vi.spyOn(projectService, "patchProject").mockImplementationOnce(() => new Promise<ProjectManifest>((resolve) => { confirmPatch = resolve }))
    appStore.setState(projectActions)
    await projectActions.ensureProject("p1", { force: true })
    await mount()
    let pending!: Promise<boolean>
    await settle(async () => {
      pending = create()
      appStore.getState().applyProjectEvent({ type: "project_updated", project_id: "p1", revision: 3 })
      confirmPatch(saved)
      await Promise.resolve()
    })
    // The event advertised revision 3, but PATCH's revision 2 was rejected by the merge.
    expect(sections.preferences().projects.p1?.sections).toEqual([])
    expect(sections.busy().has("p1")).toBe(true)
    await settle(async () => {
      failEventRead(new Error("older event read failed"))
      expect(await pending).toBe(!refreshFails)
    })
    expect(get).toHaveBeenCalledTimes(3)
    expect(patch).toHaveBeenCalledOnce()
    if (refreshFails) {
      expect(writeError("p1")).toContain("已保存")
      expect(writeError("p1")).toContain("重新加载")
      expect(sections.preferences().projects.p1?.sections).toEqual([])
    } else {
      expect(writeError("p1")).toBeUndefined()
      expect(sections.preferences().projects.p1?.sections[0]?.name).toBe("Research")
    }
  })

  it("does not claim a fresh conflict read was applied when a newer event rejects its payload", async () => {
    let finishFreshRead!: (project: ProjectManifest) => void
    const get = vi.spyOn(projectService, "getProject")
      .mockResolvedValueOnce(manifest())
      .mockResolvedValueOnce({ ...manifest(empty), revision: 2 })
      .mockImplementationOnce(() => new Promise<ProjectManifest>((resolve) => { finishFreshRead = resolve }))
    vi.spyOn(projectService, "patchProject").mockRejectedValueOnce(new ApiError("stale", 412, "Precondition Failed"))
    appStore.setState(projectActions)
    await projectActions.ensureProject("p1", { force: true })
    await mount()
    let pending!: Promise<boolean>
    await settle(async () => { pending = create(); await Promise.resolve() })
    expect(get).toHaveBeenCalledTimes(3)
    await settle(async () => {
      appStore.getState().applyProjectEvent({ type: "project_updated", project_id: "p1", revision: 4 })
      finishFreshRead({ ...manifest(empty), revision: 3 })
      expect(await pending).toBe(false)
    })
    expect(writeError("p1")).toContain("无法读取最新版本")
    expect(appStore.getState().projects.p1!.revision).toBe(4)
  })

  it("retains the legacy import source when its committed receipt cannot reach the store", async () => {
    seedLegacy()
    const saved = { ...manifest({ ...empty, sections: [{ id: sectionId, name: "Research" }] }), revision: 2 }
    const pendingImport = { ...manifest(), revision: 3, confirmed_revision: 1 }
    appStore.setState({
      projects: { p1: pendingImport },
      updateProject: vi.fn().mockResolvedValue(saved),
      ensureProject: vi.fn().mockRejectedValue(new Error("offline")),
    })
    await mount()
    expect(appStore.getState().updateProject).toHaveBeenCalledWith("p1", 1, expect.objectContaining({ import_sidebar: expect.any(Object) }))
    expect(readProjectSectionPreferences().projects.p1).toBeDefined()
    expect(writeError("p1")).toContain("已保存")
    expect(writeError("p1")).toContain("重新加载")
  })

  it("uses the snapshot revision when an event advertises a newer Project revision", async () => {
    const pendingPayload = { ...manifest(), revision: 2, confirmed_revision: 1 }
    const save = vi.fn().mockRejectedValue(new ApiError("stale", 412, "Precondition Failed"))
    appStore.setState({ projects: { p1: pendingPayload }, updateProject: save })
    await mount()
    await settle(async () => { await create() })
    expect(save).toHaveBeenCalledWith("p1", 1, expect.objectContaining({ sidebar: expect.any(Object) }))
  })

  it("refreshes an already-imported conflict without discarding the local source", async () => {
    seedLegacy()
    appStore.setState({ updateProject: vi.fn().mockRejectedValue(new ApiError("already imported", 409, "Conflict")) })
    await mount()
    expect(appStore.getState().ensureProject).toHaveBeenCalledWith("p1", { force: true })
    expect(readProjectSectionPreferences().projects.p1).toBeDefined()
    expect(writeError("p1")).toContain("其他客户端")
  })

  it("keeps local data and disables writes for an unsupported backend", async () => {
    seedLegacy()
    appStore.setState({ projects: { p1: { ...manifest(), sidebar: undefined } } })
    await mount()
    await settle(async () => { expect(await create()).toBe(false) })
    expect(appStore.getState().updateProject).not.toHaveBeenCalled()
    expect(writeError("p1")).toContain("更新 Bamboo")
    expect(readProjectSectionPreferences().projects.p1).toBeDefined()
  })

  it("keeps a failed Project's error when another Project saves successfully", async () => {
    const save = appStore.getState().updateProject
    appStore.setState({
      projects: { p1: manifest(), p2: { ...manifest(), id: "p2", name: "Other Project" } },
      updateProject: vi.fn((id, revision, request) => id === "p1" ? Promise.reject(new Error("offline")) : save(id, revision, request)),
    })
    await mount()
    await settle(async () => { await create() })
    const originalError = writeError("p1")
    expect(originalError).toContain("未保存")
    await settle(async () => {
      expect(await sections.update("p2", (previous) => createProjectSection(previous, "p2", "Other section"))).toBe(true)
    })
    expect(writeError("p1")).toBe(originalError)
    expect(writeError("p2")).toBeUndefined()
    expect(appStore.getState().projects.p2!.sidebar?.sections[0]?.name).toBe("Other section")
  })

  it("does not clear legacy data when a response lacks an import receipt", async () => {
    seedLegacy()
    appStore.setState({ updateProject: vi.fn().mockResolvedValue({ ...manifest(), sidebar: undefined }) })
    await mount()
    expect(readProjectSectionPreferences().projects.p1).toBeDefined()
    expect(writeError("p1")).toContain("更新 Bamboo")
  })
})

describe("durable session section assignment", () => {
  it("assigns a newly created session to its section through the single-writer core", async () => {
    appStore.setState({
      projects: { p1: manifest({ ...empty, sections: [{ id: sectionId, name: "Research" }] }) },
    })
    await expect(assignSessionToSectionDurable("p1", "new-session", sectionId)).resolves.toBe(true)
    expect(appStore.getState().updateProject).toHaveBeenCalledOnce()
    const saved = appStore.getState().projects.p1!
    expect(saved.sidebar?.session_sections["new-session"]).toBe(sectionId)
    expect(saved.revision).toBe(2)
  })

  it("serializes with a concurrent sidebar update instead of racing the revision", async () => {
    let acknowledge!: (project: ProjectManifest) => void
    const save = vi.fn(() => new Promise<ProjectManifest>((resolve) => { acknowledge = resolve }))
    appStore.setState({
      projects: { p1: manifest({ ...empty, sections: [{ id: sectionId, name: "Research" }] }) },
      updateProject: save,
    })
    await mount()
    const durable = assignSessionToSectionDurable("p1", "new-session", sectionId)
    // The sidebar edit arrives while the durable assignment is in flight.
    await settle(async () => { await sections.update("p1", (previous) => previous) })
    expect(save).toHaveBeenCalledOnce()
    await settle(async () => {
      const saved = manifest({ ...empty, sections: [{ id: sectionId, name: "Research" }], session_sections: { "new-session": sectionId } })
      appStore.setState({ projects: { p1: saved } })
      acknowledge(saved)
    })
    await expect(durable).resolves.toBe(true)
    expect(appStore.getState().projects.p1!.sidebar?.session_sections["new-session"]).toBe(sectionId)
  })

  it("keeps the session unsectioned when the durable assignment fails", async () => {
    appStore.setState({
      projects: { p1: manifest({ ...empty, sections: [{ id: sectionId, name: "Research" }] }) },
      updateProject: vi.fn().mockRejectedValue(new Error("offline")),
    })
    await expect(assignSessionToSectionDurable("p1", "new-session", sectionId)).resolves.toBe(false)
    expect(appStore.getState().projects.p1!.sidebar?.session_sections).toEqual({})
  })

  it("skips the PATCH when the session already has the requested section", async () => {
    appStore.setState({
      projects: { p1: manifest({ sections: [{ id: sectionId, name: "Research" }], session_sections: { "root-1": sectionId }, hidden_legacy: false }) },
    })
    await expect(assignSessionToSectionDurable("p1", "root-1", sectionId)).resolves.toBe(true)
    expect(appStore.getState().updateProject).not.toHaveBeenCalled()
  })

  it("waits for a concurrent write to settle instead of dropping the assignment", async () => {
    appStore.setState({
      projects: { p1: manifest({ ...empty, sections: [{ id: sectionId, name: "Research" }] }) },
    })
    // The first PATCH (the sidebar edit) is held until acknowledged; every
    // later PATCH (the durable retry) saves immediately.
    let acknowledge!: (project: ProjectManifest) => void
    appStore.setState({ updateProject: vi.fn()
      .mockImplementationOnce(() => new Promise<ProjectManifest>((resolve) => { acknowledge = resolve }))
      .mockImplementation(async (id: string, revision: number, request: PatchProjectRequest) => {
        const current = appStore.getState().projects[id]!
        const saved = { ...current, sidebar: request.sidebar ?? request.import_sidebar!, revision: revision + 1 }
        appStore.setState((state) => ({ projects: { ...state.projects, [id]: saved } }))
        return saved
      }) })
    await mount()
    const updateStarted = sections.update("p1", (previous) => setSessionSection(previous, "p1", "other", null))
    await settle(async () => { await Promise.resolve() })
    const durable = assignSessionToSectionDurable("p1", "new-session", sectionId)
    // The first attempt hits the busy core and schedules a delayed retry.
    await settle(async () => { await Promise.resolve() })
    expect(appStore.getState().updateProject).toHaveBeenCalledOnce()
    const saved = manifest({ sections: [{ id: sectionId, name: "Research" }], session_sections: {}, hidden_legacy: false })
    saved.revision = 2
    await settle(async () => {
      appStore.setState({ projects: { p1: saved } })
      acknowledge(saved)
      await updateStarted
    })
    // The durable retry lands once the core is quiet.
    await expect(durable).resolves.toBe(true)
    expect(appStore.getState().projects.p1!.sidebar?.session_sections["new-session"]).toBe(sectionId)
  })
})
