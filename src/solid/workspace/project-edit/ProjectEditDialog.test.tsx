import { render } from "@solidjs/web"
import { flush } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProjectManifest } from "@services/project"
import { appStore } from "@shared/store/appStore/state"

const { validatePath } = vi.hoisted(() => ({
  validatePath: vi.fn(async (path: string) => ({ path, is_valid: true })),
}))

vi.mock("@services/workspace", () => ({
  workspaceService: { validatePath },
}))

vi.mock("@/utils/environment", () => ({
  isTauriEnvironment: () => false,
}))

import { ProjectEditDialog } from "./ProjectEditDialog"

vi.mock("@kobalte/core/dialog", async () => {
  const { createRequire } = await vi.importActual<{
    createRequire: (url: string) => { resolve: (specifier: string) => string }
  }>("node:module")
  const entry = createRequire(import.meta.url).resolve("@kobalte/core/dialog")
  return vi.importActual(entry.replace(/\.jsx$/, ".js"))
})
vi.mock("@lucide/solid", () => ({ Folder: () => null, FolderOpen: () => null, FolderPlus: () => null, Loader2: () => null, Trash2: () => null, X: () => null }))

const project = (overrides: Partial<ProjectManifest> = {}): ProjectManifest => ({
  id: "project-a",
  name: "Zenith",
  description: null,
  status: "active",
  revision: 1,
  resource_revision: 1,
  project_path: "/workspace/zenith",
  project_path_status: "configured",
  workspace_count: 2,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  schema_version: 2,
  workspace_bindings: [{ path: "/workspace/old-worktree" }],
  ...overrides,
})

let dispose: (() => void) | undefined
const initialStore = appStore.getState()
const nameInput = () => [...document.querySelectorAll("label")].find((label) => label.textContent === "项目名称")?.control as HTMLInputElement
function dispatch(action: () => void) { action(); flush() }
async function settle(action: () => unknown) {
  await action()
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve()
    flush()
  }
}
async function mount(projectId: string, onClose: () => void) {
  const host = document.body.appendChild(document.createElement("div"))
  dispose = render(() => <ProjectEditDialog projectId={projectId} onClose={onClose} />, host)
  await settle(() => {})
}

const input = (label: string): HTMLInputElement => {
  const element = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (!element) throw new Error(`Missing input: ${label}`)
  return element
}

const fill = (element: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  dispatch(() => {
    setter.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

const button = (label: string): HTMLButtonElement => {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!element) throw new Error(`Missing button: ${label}`)
  return element
}

beforeEach(() => {
  document.body.replaceChildren()
  validatePath.mockClear()
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  appStore.setState(initialStore, true)
  document.body.replaceChildren()
})

describe("ProjectEditDialog", () => {
  it("saves name, primary folder, removals, and additions through revisioned Project actions", async () => {
    const initial = project()
    const ensureProject = vi.fn(async () => undefined)
    const publish = (updated: ProjectManifest) => {
      appStore.setState({ projects: { [updated.id]: updated } })
      return updated
    }
    const updateProject = vi.fn(async (_id, _revision, patch) => publish(project({
      ...patch,
      revision: 2,
    })))
    const unbindWorkspace = vi.fn(async (_id, _revision, _path) => publish(project({
      name: "Zenith Next",
      project_path: "/workspace/zenith-next",
      revision: 3,
      workspace_count: 1,
      workspace_bindings: [],
      updated_at: "2026-01-02T00:00:00Z",
    })))
    const bindWorkspace = vi.fn(async (_id, _revision, binding) => publish(project({
      name: "Zenith Next",
      project_path: "/workspace/zenith-next",
      revision: 4,
      workspace_count: 2,
      workspace_bindings: [binding],
      updated_at: "2026-01-03T00:00:00Z",
    })))
    appStore.setState({
      projects: { [initial.id]: initial },
      ensureProject,
      updateProject,
      unbindWorkspace,
      bindWorkspace,
    })
    const onClose = vi.fn()

    await mount(initial.id, onClose)

    fill(nameInput(), "Zenith Next")
    fill(input("项目主目录"), "/workspace/zenith-next")
    dispatch(() => document.querySelector<HTMLButtonElement>('button[aria-label="移除源目录 /workspace/old-worktree"]')!.click())
    fill(input("新增源目录"), "/workspace/new-worktree")
    dispatch(() => button("添加").click())
    await settle(async () => button("保存").click())
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())

    expect(validatePath.mock.calls.map(([path]) => path)).toEqual([
      "/workspace/zenith-next",
      "/workspace/new-worktree",
    ])
    expect(updateProject).toHaveBeenCalledWith("project-a", 1, {
      name: "Zenith Next",
      project_path: "/workspace/zenith-next",
    })
    expect(unbindWorkspace).toHaveBeenCalledWith("project-a", 2, "/workspace/old-worktree")
    expect(bindWorkspace).toHaveBeenCalledWith("project-a", 3, { path: "/workspace/new-worktree" })
  })

  it("explains that removing a local project is recoverable before archiving", async () => {
    const initial = project()
    const archiveProject = vi.fn(async () => project({ status: "archived", revision: 2 }))
    appStore.setState({
      projects: { [initial.id]: initial },
      ensureProject: vi.fn(async () => undefined),
      archiveProject,
    })
    const onClose = vi.fn()

    await mount(initial.id, onClose)
    dispatch(() => button("移除本地项目").click())
    expect(document.body.textContent).toContain("现有会话和项目数据不会删除")
    await settle(async () => button("移除项目").click())

    expect(archiveProject).toHaveBeenCalledWith("project-a", 1)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("returns to the populated edit form when removal is cancelled", async () => {
    const initial = project()
    appStore.setState({
      projects: { [initial.id]: initial },
      ensureProject: vi.fn(async () => undefined),
    })
    const onClose = vi.fn()

    await mount(initial.id, onClose)
    fill(nameInput(), "Unsaved name")
    dispatch(() => button("移除本地项目").click())
    const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
    const confirmCancel = [...dialogs.at(-1)!.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.trim() === "取消")!
    dispatch(() => confirmCancel.click())

    expect(nameInput()?.value).toBe("Unsaved name")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("编辑项目")
    expect(onClose).not.toHaveBeenCalled()
  })
})
