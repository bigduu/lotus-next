import { render } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { changeLocale } from "@shared/i18n/runtime"
import type { ProjectWorktrees } from "@services/workspace/WorktreeService"
import type { NewChatWorktreeControlProps, NewChatWorktreeSelection } from "@services/workspace/newChatWorktreeTypes"

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), saveRoot: vi.fn(), preferences: vi.fn() }))
vi.mock("@services/workspace/WorktreeService", () => ({ worktreeService: mocks }))
import { NewChatWorktreeControl } from "./NewChatWorktreeControl"

vi.mock("@kobalte/core/popover", async () => {
  const { createRequire } = await vi.importActual<{
    createRequire: (url: string) => { resolve: (specifier: string) => string }
  }>("node:module")
  const entry = createRequire(import.meta.url).resolve("@kobalte/core/popover")
  return vi.importActual(entry.replace(/\.jsx$/, ".js"))
})
vi.mock("@lucide/solid", () => ({ AlertCircle: () => null, Check: () => null, ChevronDown: () => null,
  FolderGit2: () => null, GitBranch: () => null, LoaderCircle: () => null, RefreshCw: () => null }))

const inventory = (projectId = "project-a"): ProjectWorktrees => ({
  project_id: projectId, default_root: "/external/worktrees", repositories: [
    { path: "/repo", error: null, worktrees: [{ path: "/repo", branch: "main", head: "abc123", locked: false, prunable: false, dirty: true, error: null, occupied: false, sessions: [] }] },
    { path: "/second", error: null, worktrees: [] },
  ],
})
const selection = (): NewChatWorktreeSelection => ({ repository: "/repo", root: "/external/worktrees", name: "my-task", branch: "feature/my-task" })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
let dispose: (() => void) | undefined
function dispatch(action: () => void) { action(); flush() }
async function settle(action: () => unknown) {
  await action()
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve()
    flush()
  }
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button:not([aria-haspopup])')].find((entry) => entry.textContent?.trim() === label)!
const field = (label: string) => {
  const id = [...document.querySelectorAll("label")].find((entry) => entry.textContent === label)?.htmlFor
  return document.getElementById(id!) as HTMLInputElement
}
const fill = (label: string, value: string) => dispatch(() => {
  const input = field(label)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
})
const open = async () => { await settle(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Chat workspace"]')!.click()) }
const close = async () => {
  await settle(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
}
function mount(overrides: Partial<NewChatWorktreeControlProps> = {}) {
  const onChange = vi.fn()
  const [props, setProps] = createSignal<NewChatWorktreeControlProps>({
    projectId: "project-a", workspacePath: "/repo", value: null, onChange, ...overrides,
  })
  const [value, setValue] = createSignal(props().value)
  const host = document.body.appendChild(document.createElement("div"))
  dispose = render(() => <NewChatWorktreeControl {...props()} value={value()}
    onChange={(next) => { setValue(next); props().onChange(next) }} />, host)
  flush()
  return { onChange, rerender: (next: Partial<NewChatWorktreeControlProps>) => {
    dispatch(() => setProps((previous) => ({ ...previous, ...next })))
  } }
}

beforeEach(async () => {
  await changeLocale("en-US", { persist: false })
  mocks.list.mockResolvedValue(inventory())
})
afterEach(async () => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  vi.resetAllMocks()
  await changeLocale("zh-CN", { persist: false })
})

describe("NewChatWorktreeControl", () => {
  it("defaults to the current workspace and does not load inventory until opened", async () => {
    const h = mount()
    expect(mocks.list).not.toHaveBeenCalled()
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Chat workspace"]')!
    expect(trigger.textContent).toBe("repo")
    expect(trigger.title).toBe("/repo")
    expect(h.onChange).not.toHaveBeenCalled()
    await open()
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith("project-a")
    expect(button("Current workspace").getAttribute("aria-pressed")).toBe("true")
    expect(document.body.textContent).toContain("/repo")
    expect(document.body.textContent).toContain("only when you send the first message")
    expect(h.onChange).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("emits generated editable draft defaults, configuration changes, and current-workspace mode without mutations", async () => {
    const h = mount()
    await open()
    dispatch(() => button("New worktree").click())
    const initial = h.onChange.mock.lastCall![0] as NewChatWorktreeSelection
    expect(initial).toMatchObject({ repository: "/repo", root: "/external/worktrees" })
    expect(initial.name).toMatch(/^chat-\d{8}-[a-z0-9]{6}$/)
    expect(initial.branch).toBe(`chat/${initial.name}`)
    expect(document.body.textContent).toContain("current HEAD of /repo, resolved when creation runs")
    expect(document.body.textContent).toContain("Uncommitted changes and untracked files are not copied")
    expect(document.body.textContent).toContain("existing absolute directory outside Git repositories and Git metadata")
    fill("Destination root", "/one-off ")
    fill("Folder name", "review-task")
    fill("New branch", "feature/review")
    expect(h.onChange.mock.lastCall![0]).toEqual({ repository: "/repo", root: "/one-off ", name: "review-task", branch: "feature/review" })
    expect(document.querySelector("[data-worktree-target]")?.textContent).toBe("/one-off /review-task")
    dispatch(() => button("Current workspace").click())
    expect(h.onChange).toHaveBeenLastCalledWith(null)
    expect(field("Destination root")).toBeNull()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.saveRoot).not.toHaveBeenCalled()
    expect(mocks.preferences).not.toHaveBeenCalled()
  })

  it("prefers an exactly authorized selected source and emits repository edits", async () => {
    const h = mount({ workspacePath: "/second/" })
    await open()
    dispatch(() => button("New worktree").click())
    expect(h.onChange.mock.lastCall![0].repository).toBe("/second")
    expect(document.querySelector('[role="note"]')).toBeNull()
    const select = field("Source checkout") as unknown as HTMLSelectElement
    dispatch(() => { select.value = "/repo"; select.dispatchEvent(new Event("change", { bubbles: true })) })
    expect(h.onChange.mock.lastCall![0].repository).toBe("/repo")
    expect(document.querySelector('[role="note"]')?.textContent).toContain("/second/")
  })

  it("identifies the actual primary source instead of pretending a deduplicated linked worktree is the source", async () => {
    const h = mount({ workspacePath: "/external/feature-a" })
    await open()
    dispatch(() => button("New worktree").click())
    expect(h.onChange.mock.lastCall![0].repository).toBe("/repo")
    expect(field("Source checkout").value).toBe("/repo")
    expect(document.querySelector('[role="note"]')?.textContent).toContain("not the selected workspace's HEAD")
    expect(document.body.textContent).not.toContain("abc123")
    expect(document.querySelectorAll("select")).toHaveLength(1)
  })

  it("shows loading, rejects stale project results, and never emits defaults from a late response", async () => {
    const first = deferred<ProjectWorktrees>()
    const second = deferred<ProjectWorktrees>()
    mocks.list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const h = mount()
    await open()
    expect(button("New worktree").disabled).toBe(true)
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Loading")
    h.rerender({ projectId: "project-b", workspacePath: "/second" })
    const next = inventory("project-b")
    next.default_root = "/project-b-root"
    await settle(async () => second.resolve(next))
    await settle(async () => first.resolve(inventory()))
    expect(h.onChange).not.toHaveBeenCalled()
    dispatch(() => button("New worktree").click())
    expect(h.onChange.mock.lastCall![0]).toMatchObject({ repository: "/second", root: "/project-b-root" })
  })

  it("cancels closed requests and preserves edited config through refresh and late inventory", async () => {
    const late = deferred<ProjectWorktrees>()
    const refreshed = deferred<ProjectWorktrees>()
    mocks.list.mockReturnValueOnce(late.promise).mockReturnValueOnce(refreshed.promise)
    const h = mount({ value: selection() })
    await open()
    fill("Folder name", "my-edited-name")
    await close()
    await settle(async () => late.resolve({ ...inventory(), default_root: "/old-root" }))
    expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull()
    await open()
    fill("Destination root", "/keep-this-root")
    await settle(async () => refreshed.resolve({ ...inventory(), default_root: "/new-default" }))
    expect(field("Folder name").value).toBe("my-edited-name")
    expect(field("Destination root").value).toBe("/keep-this-root")
    expect(h.onChange).toHaveBeenCalledTimes(2)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("does not let a response after unmount emit changes", async () => {
    const request = deferred<ProjectWorktrees>()
    mocks.list.mockReturnValueOnce(request.promise)
    const h = mount()
    await open()
    dispose?.()
    dispose = undefined
    flush()
    await settle(async () => request.resolve(inventory()))
    expect(h.onChange).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull()
  })

  it("supports no-project and no-Git states without mutating selection", async () => {
    const h = mount({ projectId: null })
    await open()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(button("New worktree").disabled).toBe(true)
    expect(document.body.textContent).toContain("Select a Project")
    mocks.list.mockResolvedValueOnce({ project_id: "project-a", default_root: null, repositories: [{ path: "/not-git", error: "Not a Git repository", worktrees: [] }] })
    h.rerender({ projectId: "project-a" })
    await settle(async () => {})
    expect(button("New worktree").disabled).toBe(true)
    expect(document.body.textContent).toContain("No available Git repositories")
    expect(document.body.textContent).toContain("Not a Git repository")
    expect(h.onChange).not.toHaveBeenCalled()
  })

  it("reports an inventory error and only retries the read when explicitly requested", async () => {
    mocks.list.mockRejectedValueOnce(new Error("Backend offline"))
    const h = mount()
    await open()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Backend offline")
    expect(button("New worktree").disabled).toBe(true)
    expect(mocks.list).toHaveBeenCalledTimes(1)
    await settle(async () => button("Reload repositories").click())
    expect(button("New worktree").disabled).toBe(false)
    expect(mocks.list).toHaveBeenCalledTimes(2)
    expect(h.onChange).not.toHaveBeenCalled()
  })

  it.each([
    { disabled: true, error: "Creation may have partially completed. Inspect Worktree Manager before retrying." },
    { preparedPath: "/external/worktrees/my-task" },
  ])("allows inspection but locks all configuration for %j", async (props) => {
    const h = mount({ value: selection(), ...props })
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Chat workspace"]')!
    expect(trigger.disabled).toBe(false)
    await open()
    expect(button("Current workspace").disabled).toBe(true)
    expect(button("New worktree").disabled).toBe(true)
    for (const name of ["Source checkout", "Destination root", "Folder name", "New branch"]) expect(field(name).disabled).toBe(true)
    if (props.error) expect(document.querySelector('[role="alert"]')?.textContent).toContain("Inspect Worktree Manager")
    if (props.preparedPath) expect(document.querySelector('[role="status"]')?.textContent).toContain(props.preparedPath)
    expect(h.onChange).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("preserves an unavailable draft source and flags invalid names without silently replacing them", async () => {
    const h = mount({ value: { ...selection(), repository: "/removed-source", name: "../bad" } })
    await open()
    expect(field("Source checkout").value).toBe("/removed-source")
    expect(field("Folder name").getAttribute("aria-invalid")).toBe("true")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("not available in the current Project inventory")
    expect(h.onChange).not.toHaveBeenCalled()
  })
})
