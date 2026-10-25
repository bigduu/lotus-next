import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useAppStore } from "@shared/store/appStore"
import type { ProjectManifest } from "@services/project"
import type { ProjectWorktrees } from "@services/workspace/WorktreeService"

const mocks = vi.hoisted(() => ({ preferences: vi.fn(), list: vi.fn(), saveRoot: vi.fn(), create: vi.fn(), getProject: vi.fn() }))
vi.mock("@services/workspace/WorktreeService", () => ({ worktreeService: mocks }))
vi.mock("@services/project", () => ({ projectService: { getProject: mocks.getProject } }))
import { WorktreeManager } from "./WorktreeManager"

const project = { id: "project-a", name: "Zenith", status: "active", project_path: "/repo", workspace_bindings: [], revision: 7 } as unknown as ProjectManifest
const listing = (): ProjectWorktrees => ({ project_id: project.id, default_root: "/Volumes/External/worktrees", repositories: [{
  path: "/repo", error: null, worktrees: [{ path: "/Volumes/External/worktrees/existing", branch: "feature/existing", head: "abc", locked: false, prunable: false,
    dirty: true, occupied: true, error: null, sessions: [{ id: "session-a", title: "Active task", active: true }] }],
}] })
let root: Root
const input = (id: string) => document.getElementById(id) as HTMLInputElement
const fill = (id: string, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(id), value)
  input(id).dispatchEvent(new Event("input", { bubbles: true }))
})
const selectRepository = (value: string) => act(() => {
  const select = document.getElementById("worktree-repository") as HTMLSelectElement
  select.value = value
  select.dispatchEvent(new Event("change", { bubbles: true }))
})
const buttons = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent?.trim() === text)
const mount = async (onOpen = vi.fn(), onSession = vi.fn()) => {
  await act(async () => { root.render(<WorktreeManager open onClose={vi.fn()} onOpen={onOpen} onSession={onSession} />) })
}
beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  root = createRoot(document.body.appendChild(document.createElement("div")))
  useAppStore.setState({ projects: { [project.id]: project }, bindWorkspace: vi.fn().mockResolvedValue(project) })
  mocks.preferences.mockResolvedValue({ default_root: "/Volumes/External/worktrees", project_roots: {} })
  mocks.list.mockImplementation(async () => listing())
  mocks.getProject.mockResolvedValue(project)
  mocks.create.mockResolvedValue({ path: "/Volumes/External/one-off/new" })
})
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.resetAllMocks() })

it("shows native status and sessions, then creates in the explicit one-off root without saving it", async () => {
  await mount()
  expect(document.body.textContent).toContain("有未提交修改")
  expect(document.body.textContent).toContain("占用中")
  expect(document.body.textContent).toContain("Active task")
  mocks.create.mockResolvedValueOnce({ path: "/Volumes/External/one-off /new" })
  fill("worktree-root", "/Volumes/External/one-off ")
  fill("worktree-name", "new")
  fill("worktree-branch", "feature/new")
  await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
  expect(mocks.create).toHaveBeenCalledWith("project-a", { repository: "/repo", root: "/Volumes/External/one-off ", name: "new", branch: "feature/new" })
  expect(mocks.saveRoot).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain("已创建 worktree：/Volumes/External/one-off /new")
  expect(mocks.list).toHaveBeenCalledTimes(2)
})

it("saves and clears only the selected project override, keeping the global root", async () => {
  await mount()
  mocks.saveRoot.mockResolvedValueOnce({ default_root: "/Volumes/External/worktrees", project_roots: { "project-a": "/Volumes/Project/worktrees " } })
  fill("worktree-project-root", "/Volumes/Project/worktrees ")
  await act(async () => buttons("保存")[1]!.click())
  expect(mocks.saveRoot).toHaveBeenLastCalledWith("/Volumes/Project/worktrees ", "project-a")
  expect(input("worktree-root").value).toBe("/Volumes/Project/worktrees ")
  mocks.saveRoot.mockResolvedValueOnce({ default_root: "/Volumes/External/worktrees", project_roots: {} })
  fill("worktree-project-root", "")
  await act(async () => buttons("保存")[1]!.click())
  expect(mocks.saveRoot).toHaveBeenLastCalledWith(null, "project-a")
  expect(input("worktree-root").value).toBe("/Volumes/External/worktrees")
})

it("binds an existing native worktree with the current Project revision before opening it", async () => {
  const onOpen = vi.fn()
  const onSession = vi.fn()
  const external = listing()
  external.repositories[0]!.worktrees[0]!.project_owned = false
  mocks.list.mockResolvedValueOnce(external)
  await mount(onOpen, onSession)
  await act(async () => buttons("打开并新建会话")[0]!.click())
  expect(useAppStore.getState().bindWorkspace).toHaveBeenCalledWith("project-a", 7, { path: "/Volumes/External/worktrees/existing" })
  expect(onOpen).toHaveBeenCalledWith("project-a", "/Volumes/External/worktrees/existing")
  await act(async () => buttons("Active task · 活跃")[0]!.click())
  expect(onSession).toHaveBeenCalledWith("session-a")
})

it("opens an owned child repository without adding an overlapping Project binding", async () => {
  const onOpen = vi.fn()
  const nested = listing()
  nested.repositories[0]!.path = "/repo/frontend"
  Object.assign(nested.repositories[0]!.worktrees[0]!, { path: "/repo/frontend", project_owned: true })
  mocks.list.mockResolvedValueOnce(nested)
  await mount(onOpen)
  await act(async () => buttons("打开并新建会话")[0]!.click())
  expect(useAppStore.getState().bindWorkspace).not.toHaveBeenCalled()
  expect(mocks.getProject).not.toHaveBeenCalled()
  expect(onOpen).toHaveBeenCalledWith("project-a", "/repo/frontend")
  expect(useAppStore.getState().projects[project.id]?.project_path).toBe("/repo")
})

it("keeps older-server exact Project bindings usable without rebinding", async () => {
  const onOpen = vi.fn()
  const existing = listing()
  existing.repositories[0]!.worktrees[0]!.path = "/repo"
  mocks.list.mockResolvedValueOnce(existing)
  await mount(onOpen)
  await act(async () => buttons("打开并新建会话")[0]!.click())
  expect(mocks.getProject).toHaveBeenCalledWith("project-a")
  expect(useAppStore.getState().bindWorkspace).not.toHaveBeenCalled()
  expect(onOpen).toHaveBeenCalledWith("project-a", "/repo")
})

it("disables a metadata-only entry while keeping a valid linked checkout openable", async () => {
  const onOpen = vi.fn()
  const mixed = listing()
  const linked = { ...mixed.repositories[0]!.worktrees[0]!, openable: true }
  mixed.repositories[0]!.worktrees = [
    { ...linked, path: "/repo/.git/modules/backend", openable: false, project_owned: true, dirty: null,
      error: "Git metadata does not identify an available checkout" },
    linked,
  ]
  mocks.list.mockResolvedValueOnce(mixed)
  await mount(onOpen)
  expect(document.body.textContent).toContain("Git metadata does not identify an available checkout")
  expect(buttons("打开并新建会话")[0]!.disabled).toBe(true)
  expect(buttons("打开并新建会话")[1]!.disabled).toBe(false)
  await act(async () => buttons("打开并新建会话")[0]!.click())
  expect(onOpen).not.toHaveBeenCalled()
  expect(useAppStore.getState().bindWorkspace).not.toHaveBeenCalled()
  await act(async () => buttons("打开并新建会话")[1]!.click())
  expect(useAppStore.getState().bindWorkspace).toHaveBeenCalledWith("project-a", 7, { path: linked.path })
  expect(onOpen).toHaveBeenCalledWith("project-a", linked.path)
})

it("creates from the selected child repository while retaining nonfatal discovery warnings", async () => {
  const nested = listing()
  nested.repositories = [
    { path: "/repo/frontend", error: null, warnings: ["Discovery reached its depth limit"], worktrees: [] },
    { path: "/repo/backend", error: null, worktrees: [] },
    { path: "/repo/broken", error: "Repository metadata is unavailable", worktrees: [] },
  ]
  mocks.list.mockResolvedValue(nested)
  await mount()
  expect(document.body.textContent).toContain("Discovery reached its depth limit")
  const select = document.getElementById("worktree-repository") as HTMLSelectElement
  expect([...select.options].map((option) => option.value)).toEqual(["/repo/frontend", "/repo/backend"])
  selectRepository("/repo/backend")
  fill("worktree-name", "task")
  fill("worktree-branch", "feature/task")
  await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
  expect(mocks.create).toHaveBeenCalledWith("project-a", { repository: "/repo/backend", root: "/Volumes/External/worktrees", name: "task", branch: "feature/task" })
  expect(select.value).toBe("/repo/backend")
  expect(useAppStore.getState().projects[project.id]?.project_path).toBe("/repo")
})

it("preserves a valid source choice on refresh and replaces a removed or failed source", async () => {
  const nested = listing()
  nested.repositories = [
    { path: "/repo/frontend", error: null, worktrees: [] },
    { path: "/repo/backend", error: null, worktrees: [] },
  ]
  mocks.list.mockResolvedValue(nested)
  await mount()
  selectRepository("/repo/backend")
  await act(async () => buttons("刷新")[0]!.click())
  expect(input("worktree-repository").value).toBe("/repo/backend")
  mocks.list.mockResolvedValueOnce({ ...nested, repositories: [nested.repositories[0]] })
  await act(async () => buttons("刷新")[0]!.click())
  expect(input("worktree-repository").value).toBe("/repo/frontend")
  mocks.list.mockResolvedValueOnce({ ...nested, repositories: [{ ...nested.repositories[0], error: "Repository is unavailable" }] })
  await act(async () => buttons("刷新")[0]!.click())
  expect(input("worktree-repository").value).toBe("")
  expect(buttons("创建 worktree")[0]!.disabled).toBe(true)
})

it("selects a repository discovered after refreshing an initially empty Project", async () => {
  mocks.list.mockResolvedValueOnce({ ...listing(), repositories: [] })
  await mount()
  expect(document.body.textContent).toContain("未在该项目的源目录中发现 Git 仓库")
  expect(input("worktree-repository").value).toBe("")
  await act(async () => buttons("刷新")[0]!.click())
  expect(input("worktree-repository").value).toBe("/repo")
})

it("opens a native worktree when Project GET omits empty workspace bindings", async () => {
  const onOpen = vi.fn()
  mocks.getProject.mockResolvedValueOnce({ ...project, workspace_bindings: undefined })
  await mount(onOpen)
  await act(async () => buttons("打开并新建会话")[0]!.click())
  expect(useAppStore.getState().bindWorkspace).toHaveBeenCalledWith("project-a", 7, { path: "/Volumes/External/worktrees/existing" })
  expect(onOpen).toHaveBeenCalledWith("project-a", "/Volumes/External/worktrees/existing")
})

it("reports an offline volume and preserves the user's path for retry without fallback", async () => {
  await mount()
  mocks.create.mockRejectedValueOnce(new Error("External volume is unavailable"))
  fill("worktree-root", "/Volumes/Offline/worktrees")
  fill("worktree-name", "new")
  fill("worktree-branch", "feature/new")
  await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("External volume is unavailable")
  expect(input("worktree-root").value).toBe("/Volumes/Offline/worktrees")
  expect(mocks.create).toHaveBeenCalledTimes(1)
  expect(mocks.saveRoot).not.toHaveBeenCalled()
})

it("does not open a checkout when the Project binding is rejected", async () => {
  const onOpen = vi.fn()
  useAppStore.setState({ bindWorkspace: vi.fn().mockRejectedValue(new Error("Project revision changed")) })
  const unknown = listing()
  unknown.repositories[0]!.worktrees[0]!.dirty = null
  unknown.repositories[0]!.worktrees[0]!.error = "Submodule working-copy changes were not inspected"
  mocks.list.mockResolvedValueOnce(unknown)
  await mount(onOpen)
  await act(async () => buttons("打开并新建会话")[0]!.click())
  expect(onOpen).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Project revision changed")
})

it("opens a valid native path with unknown dirty state through Project binding validation", async () => {
  const onOpen = vi.fn()
  const unknown = listing()
  unknown.repositories[0]!.worktrees[0]!.dirty = null
  unknown.repositories[0]!.worktrees[0]!.error = "Submodule working-copy changes were not inspected"
  mocks.list.mockResolvedValueOnce(unknown)
  await mount(onOpen)
  expect(document.body.textContent).toContain("Submodule working-copy changes were not inspected")
  expect(buttons("打开并新建会话")[0]!.disabled).toBe(false)
  await act(async () => buttons("打开并新建会话")[0]!.click())
  expect(useAppStore.getState().bindWorkspace).toHaveBeenCalledWith("project-a", 7, { path: "/Volumes/External/worktrees/existing" })
  expect(onOpen).toHaveBeenCalledWith("project-a", "/Volumes/External/worktrees/existing")
})

it("keeps a prunable unavailable worktree disabled even when status is unknown", async () => {
  const onOpen = vi.fn()
  const unavailable = listing()
  unavailable.repositories[0]!.worktrees[0]!.dirty = null
  unavailable.repositories[0]!.worktrees[0]!.error = "Worktree path is unavailable"
  unavailable.repositories[0]!.worktrees[0]!.prunable = true
  mocks.list.mockResolvedValueOnce(unavailable)
  await mount(onOpen)
  expect(buttons("打开并新建会话")[0]!.disabled).toBe(true)
  await act(async () => buttons("打开并新建会话")[0]!.click())
  expect(useAppStore.getState().bindWorkspace).not.toHaveBeenCalled()
  expect(onOpen).not.toHaveBeenCalled()
})


it("shows an escaped raw-byte path as unavailable without opening its label", async () => {
  const onOpen = vi.fn()
  const unavailable = listing()
  Object.assign(unavailable.repositories[0]!.worktrees[0]!, { path: '"/raw/invalid-\\xFF"', path_encoding: "escaped", dirty: null,
    error: "Worktree path contains non-UTF-8 bytes and is displayed as an escaped label" })
  mocks.list.mockResolvedValueOnce(unavailable)
  await mount(onOpen)
  expect(document.body.textContent).toContain("状态未知")
  expect(document.body.textContent).toContain("non-UTF-8")
  expect(buttons("打开并新建会话")[0]!.disabled).toBe(true)
  await act(async () => buttons("打开并新建会话")[0]!.click())
  expect(useAppStore.getState().bindWorkspace).not.toHaveBeenCalled()
  expect(onOpen).not.toHaveBeenCalled()
})
