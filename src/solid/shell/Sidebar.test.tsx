import { createContext, createSignal, flush, For, omit, Show, useContext } from "solid-js"
import { render as renderSolid, type ComponentProps, type JSX } from "@solidjs/web"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatItem } from "@shared/types/chatMessages"
import type { PatchProjectRequest, ProjectManifest } from "@services/project"
import { ApiError } from "@services/api"
import type { SidebarProjectDragProps, SidebarDragParts } from "./project-drag/SidebarProjectDrag"
import type { SidebarDragPickup } from "@/lib/workbench/sidebarDrag"
import { Sidebar } from "./Sidebar"
import { createProjectSections } from "./createProjectSections"
import { createStoreSelector } from "../state/createStoreSelector"
import { appStore } from "@shared/store/appStore/state"
import { uiText } from "@shared/i18n/text"
import { PINNED_PROJECTS_STORAGE_KEY, PROJECT_SECTIONS_STORAGE_KEY, setSessionSection, SIDEBAR_SESSION_DRAG_TYPE, SIDEBAR_SECTION_DRAG_TYPE } from "@/lib/projectSidebarPreferences"
import { SESSION_ORDER_STORAGE_KEY, clearSessionOrder, parseSessionOrder, recordSessionUserInput } from "@/lib/sidebarSessionOrderState"
import { DEFAULT_SUPERVISOR_SESSION_ID } from "@/lib/supervisor"

const dragHarness = vi.hoisted(() => ({ current: null as SidebarProjectDragProps | null }))
vi.mock("./project-drag/SidebarProjectDrag", () => {
  const Handle: SidebarDragParts["Handle"] = (props) =>
    <button data-sidebar-drag-handle={`${props.source.kind}:${props.source.id}`} aria-label={props.label} disabled={props.disabled} />
  const Target: SidebarDragParts["Target"] = (props) => <div {...omit(props, "target", "disabled")} />
  return { SidebarProjectDrag: (props: SidebarProjectDragProps) => {
    dragHarness.current = props
    return <>{props.children({ Handle, Target })}</>
  } }
})

vi.mock("@lucide/solid", () => {
  const Icon = () => <svg aria-hidden="true" />
  const glyphs = [
    "AlertCircle", "Archive", "ArchiveRestore", "CalendarDays", "ChevronRight", "Circle", "CircleDot", "Cog",
    "FolderClosed", "FolderOpen", "GitBranch", "Kanban", "List", "LoaderCircle", "MoreHorizontal", "PanelLeftClose", "Pencil", "Pin",
    "PinOff", "Plus", "RotateCcw", "Search", "SquarePen", "Trash2", "X",
  ]
  return Object.fromEntries(glyphs.map((name) => [name, Icon]))
})

// The browser suites exercise actual portaled menus, modal focus, and drag sensors.
vi.mock("../ui/dropdown-menu", () => {
  const Context = createContext<{ open: () => boolean; setOpen: (next: boolean) => void }>()
  type Children = { children: JSX.Element }
  return {
    DropdownMenu: (props: Children & { open?: boolean; onOpenChange?: (next: boolean) => void }) => {
      const [open, setOpen] = createSignal(false)
      return <Context value={{ open: () => props.open ?? open(), setOpen: (next) => {
        setOpen(next)
        props.onOpenChange?.(next)
      } }}>{props.children}</Context>
    },
    DropdownMenuTrigger: (props: Children & { "aria-label"?: string }) => {
      const context = useContext(Context)!
      return <button type="button" aria-haspopup="menu" aria-label={props["aria-label"]} onClick={() => context.setOpen(true)}
        onKeyDown={(event) => { if (event.key === "Enter") context.setOpen(true) }}>{props.children}</button>
    },
    DropdownMenuContent: (props: Children) => {
      const context = useContext(Context)!
      return <Show when={context.open()}><div role="menu">{props.children}</div></Show>
    },
    DropdownMenuItem: (props: Children & { disabled?: boolean; onSelect?: () => void }) => {
      const context = useContext(Context)!
      return <button type="button" role="menuitem" disabled={props.disabled} onClick={() => {
        props.onSelect?.()
        context.setOpen(false)
      }}>{props.children}</button>
    },
    DropdownMenuSeparator: () => null,
  }
})

vi.mock("../ui/responsive-dialog", () => {
  type Children = { children: JSX.Element }
  return {
    ResponsiveDialog: (props: Children & { open: boolean }) => <Show when={props.open}>{props.children}</Show>,
    ResponsiveDialogContent: (props: Children) => <div role="dialog">{props.children}</div>,
    ResponsiveDialogTitle: (props: Children) => <h2>{props.children}</h2>,
    ResponsiveDialogDescription: (props: Children) => <p>{props.children}</p>,
  }
})

vi.mock("../ui/dialog", () => {
  type Children = { children: JSX.Element }
  const Body = (props: Children) => props.children
  return {
    Dialog: (props: Children & { open: boolean }) => <Show when={props.open}>{props.children}</Show>,
    DialogContent: (props: Children) => <div role="dialog">{props.children}</div>,
    DialogDescription: Body, DialogFooter: Body, DialogHeader: Body, DialogTitle: Body,
  }
})

vi.mock("./SessionRow", () => ({
  SessionRow: (props: ComponentProps<typeof import("./SessionRow").SessionRow>) => (
    <div data-session={props.chat.id} data-active={String(props.active)}>
      <button onClick={props.onSelect}>{props.chat.title}</button>
      {props.dragHandle}
      <button onClick={() => props.onRename("Renamed")}>Rename {props.chat.id}</button>
      <button onClick={props.onDelete}>Delete {props.chat.id}</button>
      <button onClick={props.onTogglePin}>Pin {props.chat.id}</button>
      <button onClick={props.onCopySessionId}>Copy {props.chat.id}</button>
      <Show when={props.onMoveToSection}>
        <For each={props.sections}>{(section) => <button onClick={() => props.onMoveToSection?.(section.id)}>
          Move {props.chat.id} to {section.name}
        </button>}</For>
        <button onClick={() => props.onMoveToSection?.(null)}>Unsection {props.chat.id}</button>
      </Show>
    </div>
  ),
}))

type Props = Omit<ComponentProps<typeof Sidebar>, "projects" | "sections" | "onMoveToSection">
let dispose: (() => void) | undefined
let publish: (next: Props) => void
let container: HTMLDivElement
let props: Props
const scheduleTurn = setTimeout

const initialProjectActions = {
  updateProject: appStore.getState().updateProject,
  ensureProject: appStore.getState().ensureProject,
}

function run(action: () => unknown) {
  const result = action()
  flush()
  return result
}
async function settle(action: () => unknown = () => undefined) {
  await run(action)
  await new Promise<void>((resolve) => scheduleTurn(resolve, 0))
  flush()
}
function unmount() {
  dispose?.()
  dispose = undefined
}
function SidebarFixture(input: Props) {
  const projects = createStoreSelector(appStore, (state) => state.projects)
  const sections = createProjectSections(projects, appStore.getState)
  return <Sidebar {...input} projects={projects()} sections={sections}
    onMoveToSection={(projectId, sessionId, target) => {
      void sections.update(projectId, (previous) => setSessionSection(previous, projectId, sessionId, target, projects()[projectId]?.section))
    }} />
}

function chat(id: string, day: number, extra: Partial<ChatItem> = {}): ChatItem {
  return {
    id, title: id, createdAt: new Date(2026, 8, day, 12).getTime(), messages: [],
    config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null },
    ...extra,
  }
}

function render(changes: Partial<Props> = {}) {
  props = { ...props, ...changes }
  run(() => {
    if (dispose) {
      publish(props)
      return
    }
    const [view, setView] = createSignal(props)
    publish = setView
    dispose = renderSolid(() => <SidebarFixture {...view()} />, container)
  })
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim().startsWith(label))
  expect(found, `button ${label}`).toBeDefined()
  return found!
}

function click(label: string) {
  run(() => button(label).click())
}

async function clickAndSave(label: string) {
  await settle(async () => button(label).click())
}

function row(id: string) {
  return container.querySelector(`[data-session="${id}"]`)
}

function search(value: string) {
  const input = container.querySelector("input")!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  run(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function defaultProps(): Props {
  return {
    open: false, onClose: vi.fn(), collapsed: false, onToggleCollapse: vi.fn(), width: 288,
    chats: Array.from({ length: 7 }, (_, index) => chat(`day-${index}`, 5 - index)),
    booted: true, currentSessionId: "day-0", viewingSessionId: "day-0", onNewChat: vi.fn(), onSelect: vi.fn(),
    onRename: vi.fn(), onDelete: vi.fn(), onTogglePin: vi.fn(), onCopySessionId: vi.fn(), onOpenSettings: vi.fn(),
    onOpenProjectManager: vi.fn(), onOpenProjectWork: vi.fn(), onClear: vi.fn(), onRegenerateTitle: vi.fn(),
    onError: vi.fn(), ownerAccess: true, isRunning: (chat) => chat.isRunning === true,
  }
}

beforeAll(async () => {
  localStorage.setItem("lotus.sidebar.grouping-mode.v1", "project")
  const host = document.body.appendChild(document.createElement("div"))
  const input = { ...defaultProps(), chats: [], currentSessionId: null }
  let cleanup!: () => void
  await settle(() => { cleanup = renderSolid(() => <SidebarFixture {...input} />, host) })
  cleanup()
  host.remove()
})

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  clearSessionOrder()
  appStore.setState({ projects: {}, ...initialProjectActions })
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-05T15:00:00"))
  container = document.body.appendChild(document.createElement("div"))
  props = defaultProps()
  dragHarness.current = null
})

afterEach(() => {
  unmount()
  container.remove()
  vi.useRealTimers()
})

describe("Sidebar session priority", () => {
  it("adds live root shortcuts while keeping pinned and older sessions in place", async () => {
    const [running, setRunning] = createSignal<string[]>([])
    render({
      isRunning: (entry) => running().includes(entry.id),
      chats: [
        ...props.chats, chat("idle-pinned", 5, { pinned: true, messageCount: 3 }), chat("running-pinned", 4, { pinned: true }),
        chat("old-root", -10), chat("child", 5, { parentSessionId: "day-0" }),
      ],
    })
    const priority = () => container.querySelector('section[aria-label="优先"]')
    const shortcut = (id: string) => priority()?.querySelector<HTMLButtonElement>(`[data-sidebar-session-shortcut="${id}"]`)
    const pinnedRow = row("running-pinned")
    expect(pinnedRow).not.toBeNull()
    expect(priority()).toBeNull()
    expect(row("old-root")).toBeNull()

    run(() => setRunning(["old-root", "running-pinned", "child"]))
    expect([...priority()!.querySelectorAll("[data-sidebar-session-shortcut]")].map((entry) => entry.textContent))
      .toEqual(["running-pinned", "old-root"])
    expect(row("running-pinned")).toBe(pinnedRow)
    expect(row("old-root")).toBeNull()
    expect(row("child")).toBeNull()

    click("更早")
    const olderRow = row("old-root")
    expect(olderRow).not.toBeNull()
    expect(priority()?.contains(olderRow)).toBe(false)
    await settle(() => shortcut("old-root")!.click())
    expect(props.onSelect).toHaveBeenCalledWith("old-root")
    expect(props.onClose).toHaveBeenCalledOnce()

    render({ currentSessionId: "old-root", viewingSessionId: "old-root" })
    const pinnedShortcut = shortcut("running-pinned")!
    run(() => setRunning([]))
    expect(shortcut("old-root")).toBeNull()
    expect(shortcut("running-pinned")).toBe(pinnedShortcut)
    expect(pinnedShortcut.querySelector("[data-session-running]")).toBeNull()
    expect(document.getElementById(pinnedShortcut.getAttribute("aria-describedby")!)?.textContent).toBe("未读消息")
    render({ currentSessionId: "running-pinned", viewingSessionId: "running-pinned" })
    expect(priority()).toBeNull()
    expect(row("running-pinned")).toBe(pinnedRow)
    expect(row("old-root")).toBe(olderRow)

    run(() => setRunning(["old-root", "running-pinned"]))
    search(" OLD-ROOT ")
    expect(shortcut("old-root")).toBeDefined()
    expect(row("old-root")).not.toBeNull()
    expect(shortcut("running-pinned")).toBeNull()
    expect(row("running-pinned")).toBeNull()
    search("day-0")
    expect(priority()).toBeNull()
    expect(row("day-0")).not.toBeNull()
  })

  it("keeps Priority through remount and a hidden conversation until it becomes visible", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
    const priority = () => container.querySelector('[data-sidebar-session-shortcut="day-0"]')
    render({ chats: [chat("day-0", 5, { isRunning: true })] })
    expect(priority()?.querySelector("[data-session-running]")).not.toBeNull()

    unmount()
    render({ chats: [], booted: false })
    render({ chats: [chat("day-0", 5)], booted: true })
    expect(priority()).not.toBeNull()
    expect(priority()?.querySelector("[data-session-running]")).toBeNull()

    visibility.mockReturnValue("visible")
    run(() => document.dispatchEvent(new Event("visibilitychange")))
    expect(priority()).toBeNull()
    expect(row("day-0")).not.toBeNull()
  })

  it("keeps observing a live shortcut when another tab clears an earlier one", () => {
    render({ chats: [chat("day-1", 4, { isRunning: true })] })
    const shortcut = () => container.querySelector('[data-sidebar-session-shortcut="day-1"]')
    const key = Object.keys(localStorage).find((entry) => entry.startsWith("lotus.sidebar.priority.v1."))!
    run(() => {
      localStorage.removeItem(key)
      window.dispatchEvent(new StorageEvent("storage", { key, newValue: null }))
    })
    render({ chats: [chat("day-1", 4)] })
    expect(shortcut()).not.toBeNull()
    expect(shortcut()?.querySelector("[data-session-running]")).toBeNull()
  })

  it("offers shortcuts beyond the project preview without expanding the original bucket", () => {
    localStorage.setItem("lotus.sidebar.grouping-mode.v1", "project")
    render({
      chats: Array.from({ length: 9 }, (_, index) => chat(`running-${index}`, index, { isRunning: true })),
      currentSessionId: null,
    })
    expect(container.querySelectorAll('section[aria-label="优先"] [data-sidebar-session-shortcut]')).toHaveLength(9)
    expect(container.querySelectorAll("[data-session]")).toHaveLength(7)
    expect(row("running-0")).toBeNull()
  })
})

describe("Sidebar date disclosures", () => {
  it("shows five populated dates plus pinned and counts all older root sessions", () => {
    render({ chats: [...props.chats, chat("pinned", -30, { pinned: true }), chat("old-second", -1), chat("child", -2, { parentSessionId: "day-0" })] })
    expect(container.querySelectorAll("[data-session]")).toHaveLength(6)
    expect(row("pinned")).not.toBeNull()
    expect(row("day-4")).not.toBeNull()
    expect(row("day-5")).toBeNull()
    expect(row("child")).toBeNull()
    const older = button("更早")
    expect(older.textContent).toBe("更早2 天 · 3 个会话")
    expect(older.getAttribute("aria-expanded")).toBe("false")
    expect(document.getElementById(older.getAttribute("aria-controls")!)?.hidden).toBe(true)
    click("更早")
    expect(row("day-5")).not.toBeNull()
    expect(row("old-second")).not.toBeNull()
    expect(row("child")).toBeNull()
    expect(older.getAttribute("aria-expanded")).toBe("true")
    click("更早")
    expect(row("day-5")).toBeNull()
    expect(props.onDelete).not.toHaveBeenCalled()
  })

  it("omits the older disclosure for exactly five populated dates with gaps", () => {
    render({ chats: [chat("a", 5), chat("b", 2), chat("c", -10), chat("d", -30), chat("e", -60)] })
    expect(container.textContent).not.toContain("更早")
    expect(container.querySelectorAll('button[aria-expanded]:not([aria-haspopup])')).toHaveLength(5)
    expect(container.querySelectorAll("[data-session]")).toHaveLength(5)
  })

  it("collapses individual dates without changing session actions", async () => {
    render()
    const today = button("今天")
    expect(today.textContent).toBe("今天1 个会话")
    expect(today.getAttribute("aria-expanded")).toBe("true")
    click("今天")
    expect(row("day-0")).toBeNull()
    expect(today.getAttribute("aria-expanded")).toBe("false")
    render({ chats: [...props.chats] })
    expect(row("day-0")).toBeNull()
    click("今天")
    await clickAndSave("day-0")
    click("Rename day-0")
    click("Delete day-0")
    click("Pin day-0")
    click("Copy day-0")
    expect(props.onSelect).toHaveBeenCalledWith("day-0")
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(props.onRename).toHaveBeenCalledWith("day-0", "Renamed")
    expect(props.onDelete).toHaveBeenCalledWith(props.chats[0])
    expect(props.onTogglePin).toHaveBeenCalledWith(props.chats[0])
    expect(props.onCopySessionId).toHaveBeenCalledWith("day-0")
  })

  it("reveals matching old and folded dates during search then restores their choices", () => {
    render()
    click("今天")
    click("更早")
    click("8月30日")
    click("更早")
    search("  DAY-  ")
    expect(container.querySelectorAll("[data-session]")).toHaveLength(7)
    expect(container.textContent).not.toContain("更早")
    expect(button("今天").disabled).toBe(true)
    expect(button("8月30日").getAttribute("aria-expanded")).toBe("true")
    search("")
    expect(row("day-0")).toBeNull()
    expect(row("day-6")).toBeNull()
    expect(button("更早").getAttribute("aria-expanded")).toBe("false")
    click("更早")
    expect(button("8月30日").getAttribute("aria-expanded")).toBe("false")
    expect(row("day-6")).toBeNull()
  })

  it("reveals an active older session on navigation while respecting later explicit folding", () => {
    render()
    render({ currentSessionId: "day-6" })
    expect(button("更早").getAttribute("aria-expanded")).toBe("true")
    expect(row("day-6")?.getAttribute("data-active")).toBe("true")
    click("8月30日")
    click("更早")
    render({ chats: [...props.chats] })
    expect(row("day-6")).toBeNull()
    expect(button("更早").getAttribute("aria-expanded")).toBe("false")
    render({ currentSessionId: "day-0" })
    render({ currentSessionId: "day-6" })
    expect(button("更早").getAttribute("aria-expanded")).toBe("true")
    expect(button("8月30日").getAttribute("aria-expanded")).toBe("true")
    expect(row("day-6")).not.toBeNull()
  })

  it("reveals an older active session when its summary arrives after navigation", () => {
    const chats = props.chats
    render({ chats: [], currentSessionId: "day-6" })
    render({ chats })
    expect(row("day-6")?.getAttribute("data-active")).toBe("true")
    expect(button("更早").getAttribute("aria-expanded")).toBe("true")
  })

  it("retains a calendar day's fold when its label changes from today to yesterday", () => {
    render()
    click("今天")
    vi.setSystemTime(new Date("2026-09-06T15:00:00"))
    render({ chats: [...props.chats] })
    expect(button("昨天").getAttribute("aria-expanded")).toBe("false")
    expect(row("day-0")).toBeNull()
  })
})

function buttonByLabel(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  )
  expect(found, `button[aria-label=${label}]`).toBeDefined()
  return found!
}

describe("Sidebar navigation hierarchy", () => {
  beforeEach(() => {
    localStorage.removeItem("lotus.sidebar.grouping-mode.v1")
  })

  it("keeps the canonical Supervisor above primary controls and out of ordinary sessions", async () => {
    const supervisor = chat(DEFAULT_SUPERVISOR_SESSION_ID, 5, { title: "Renamed assistant", pinned: true, isRunning: true })
    render({ chats: [supervisor, chat("ordinary", 5, { title: "Supervisor" })], currentSessionId: supervisor.id })
    const entry = button("Renamed assistant")
    expect(entry.getAttribute("aria-current")).toBe("page")
    expect(container.textContent!.indexOf("Renamed assistant")).toBeLessThan(container.textContent!.indexOf("新建会话"))
    expect(row(supervisor.id)).toBeNull()
    expect(row("ordinary")).not.toBeNull()
    expect(button("今天").textContent).toBe("今天1 个会话")
    expect(container.textContent).not.toContain("Pin bamboo-default-supervisor")
    expect(document.getElementById(entry.getAttribute("aria-describedby")!.split(" ")[1]!)?.textContent).toBe("运行中")
    await settle(async () => entry.click())
    expect(props.onSelect).toHaveBeenCalledWith(supervisor.id)
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(props.onNewChat).not.toHaveBeenCalled()
    search("no match")
    expect(button("Renamed assistant")).toBe(entry)
    expect(container.querySelectorAll("[data-session]")).toHaveLength(0)
    run(() => buttonByLabel("切换为项目视图").click())
    search("")
    expect(row(supervisor.id)).toBeNull()
    expect(row("ordinary")).not.toBeNull()
    expect(container.textContent).toContain("1 个会话")
  })

  it("does not invent a Supervisor from a title or child and counts only ordinary sessions", () => {
    render({ chats: [chat("ordinary", 5, { title: "Supervisor" }), chat(DEFAULT_SUPERVISOR_SESSION_ID, 5, { kind: "child", parentSessionId: "ordinary" })] })
    expect(container.querySelectorAll('button[aria-current="page"]')).toHaveLength(0)
    expect(row("ordinary")).not.toBeNull()
    expect(button("Supervisor").closest("[data-session]")).toBeNull()
    render({ chats: [chat(DEFAULT_SUPERVISOR_SESSION_ID, 5)] })
    expect(container.querySelectorAll("[data-session]")).toHaveLength(0)
    expect(container.textContent).toContain("暂无会话")
  })

  it("keeps the empty Supervisor entry visible before load, after an empty refresh and after remount", async () => {
    render({ chats: [], booted: false })
    expect(button("Supervisor").disabled).toBe(true)
    expect(container.textContent!.indexOf("Supervisor")).toBeLessThan(container.textContent!.indexOf("新建会话"))
    render({ booted: true })
    await settle(async () => button("Supervisor").click())
    expect(props.onSelect).toHaveBeenCalledWith(DEFAULT_SUPERVISOR_SESSION_ID)
    expect(props.onNewChat).not.toHaveBeenCalled()
    render({ chats: [], currentSessionId: DEFAULT_SUPERVISOR_SESSION_ID })
    expect(button("Supervisor").getAttribute("aria-current")).toBe("page")
    expect(container.querySelectorAll("[data-session]")).toHaveLength(0)
    unmount()
    render({ currentSessionId: null })
    expect(button("Supervisor").disabled).toBe(false)
  })

  it("coalesces repeated opening clicks and keeps errors retryable", async () => {
    let finish!: () => void
    const opening = new Promise<void>((resolve) => { finish = resolve })
    const onSelect = vi.fn().mockReturnValueOnce(opening).mockRejectedValueOnce(new Error("offline"))
    render({ chats: [], onSelect })
    run(() => {
      button("Supervisor").click()
      button("Supervisor").click()
    })
    expect(onSelect).toHaveBeenCalledOnce()
    expect(button("Supervisor").disabled).toBe(true)
    await settle(async () => finish())
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(button("Supervisor").disabled).toBe(false)
    await settle(async () => button("Supervisor").click())
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("offline")
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(button("Supervisor").disabled).toBe(false)
    await settle(async () => button("Supervisor").click())
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it("shows labeled primary actions beneath the Bodhi identity", () => {
    render()
    const content = container.textContent ?? ""
    expect(content.indexOf("Bodhi")).toBeLessThan(content.indexOf("新建会话"))
    expect(content.indexOf("新建会话")).toBeLessThan(content.indexOf("管理项目"))
    const projectAction = button("管理项目")
    const searchInput = container.querySelector('input[placeholder="搜索会话"]')
    expect(searchInput).not.toBeNull()
    expect(projectAction.compareDocumentPosition(searchInput!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)

    click("新建会话")
    expect(props.onNewChat).toHaveBeenCalledWith(null, undefined)
    click("管理项目")
    expect(props.onOpenProjectManager).toHaveBeenCalledOnce()
    click("系统设置")
    expect(props.onOpenSettings).toHaveBeenCalledOnce()
    run(() => buttonByLabel("收起侧栏").click())
    expect(props.onToggleCollapse).toHaveBeenCalledOnce()
  })

  it("uses text labels to switch between recent and project views", () => {
    render()
    expect(container.textContent).toContain("最近")
    expect(buttonByLabel("切换为项目视图").textContent).toContain("项目")
    run(() => buttonByLabel("切换为项目视图").click())
    expect(buttonByLabel("切换为最近视图").textContent).toContain("最近")
  })
})

describe("Sidebar project grouping", () => {
  beforeEach(() => {
    localStorage.removeItem("lotus.sidebar.grouping-mode.v1")
    localStorage.removeItem(PINNED_PROJECTS_STORAGE_KEY)
  })

  it("groups sessions by project after switching the grouping mode", () => {
    appStore.setState({
      projects: {
        p1: {
          id: "p1", name: "Zenith", status: "active", revision: 1, resource_revision: 1,
          project_path: "/tmp/zenith", project_path_status: "configured", workspace_count: 1,
          created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
          schema_version: 2, workspace_bindings: [],
        },
      },
    })
    render({
      chats: [
        chat("in-project", 5, { config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, projectId: "p1" } }),
        chat("no-project", 4, { config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, projectId: null } }),
      ],
    })
    run(() => buttonByLabel("切换为项目视图").click())
    expect(row("in-project")).not.toBeNull()
    expect(row("no-project")).not.toBeNull()
    // Project label renders as the group header button.
    expect(button("Zenith")).toBeDefined()
    expect(button("未分配")).toBeDefined()
  })

  it("keeps legacy sections empty until explicit server moves and scopes same-name folds independently", async () => {
    const { updateProject, snapshots } = installProjectBackend({ p1: project("p1", "Zenith", "lotus"), p2: project("p2", "Nova", "lotus") })
    render({ chats: [projectChat("zenith-chat", "p1"), projectChat("nova-chat", "p2")] })
    run(() => buttonByLabel("切换为项目视图").click())
    const zenith = container.querySelector('[data-sidebar-project="p1"]')!
    const nova = container.querySelector('[data-sidebar-project="p2"]')!
    const lotusA = zenith.querySelector('[data-project-section="lotus"]')!
    const lotusB = nova.querySelector('[data-project-section="lotus"]')!
    expect(lotusA.textContent).toContain("lotus0 个会话")
    expect(lotusB.textContent).toContain("lotus0 个会话")
    expect(zenith.querySelector('[data-section-id="none"]')!.contains(row("zenith-chat"))).toBe(true)
    expect(nova.querySelector('[data-section-id="none"]')!.contains(row("nova-chat"))).toBe(true)
    expect(snapshots.p1.sidebar!.session_sections["zenith-chat"]).toBeUndefined()
    await clickAndSave("Move zenith-chat to lotus")
    await clickAndSave("Move nova-chat to lotus")
    expect(updateProject).toHaveBeenCalledTimes(2)
    expect(snapshots.p1.sidebar!.session_sections["zenith-chat"]).toBe("legacy")
    expect(snapshots.p2.sidebar!.session_sections["nova-chat"]).toBe("legacy")
    expect(lotusA.textContent).toContain("lotus1 个会话")
    expect(lotusA.contains(row("zenith-chat"))).toBe(true)
    expect(lotusB.contains(row("nova-chat"))).toBe(true)
    run(() => lotusA.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click())
    expect(row("zenith-chat")).toBeNull()
    expect(row("nova-chat")).not.toBeNull()
    expect(button("Zenith").getAttribute("aria-expanded")).toBe("true")
    expect(lotusB.querySelector("button")?.getAttribute("aria-expanded")).toBe("true")
  })

  it("preselects the enclosing project for a new chat in project mode", () => {
    render({
      currentSessionId: "solo",
      chats: [chat("solo", 5, { config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, projectId: "p2" } })],
    })
    run(() => buttonByLabel("切换为项目视图").click())
    const newChat = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().startsWith("新建"),
    )
    expect(newChat).toBeDefined()
    run(() => newChat!.click())
    expect(props.onNewChat).toHaveBeenCalledWith("p2", undefined)
  })

  it("remembers an expanded or folded project session preview across remounts", () => {
    render({
      chats: Array.from({ length: 10 }, (_, index) =>
        chat(`p-session-${index}`, 5, { config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, projectId: "p1" } })),
    })
    run(() => buttonByLabel("切换为项目视图").click())
    // Only the first seven are visible, plus the expand affordance.
    expect(container.querySelectorAll("[data-session]")).toHaveLength(7)
    expect(container.textContent).toContain("展开 3 个")
    run(() => button("展开 3 个").click())
    expect(container.querySelectorAll("[data-session]")).toHaveLength(10)
    unmount()
    render()
    expect(container.querySelectorAll("[data-session]")).toHaveLength(10)
    render({ currentSessionId: "p-session-8" })
    expect(button("收起")).toBeDefined()
    run(() => button("收起").click())
    expect(container.querySelectorAll("[data-session]")).toHaveLength(7)
    expect(row("p-session-8")).toBeNull()
    unmount()
    render()
    expect(container.querySelectorAll("[data-session]")).toHaveLength(7)
    expect(button("展开 3 个")).toBeDefined()
  })

  it("reveals all matching sessions during search in project mode", () => {
    render({
      chats: Array.from({ length: 9 }, (_, index) =>
        chat(`p-task-${index}`, 5, { title: `Investigation ${index}`, config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, projectId: "p1" } })),
    })
    run(() => buttonByLabel("切换为项目视图").click())
    expect(container.querySelectorAll("[data-session]")).toHaveLength(7)
    search("investigation")
    expect(container.querySelectorAll("[data-session]")).toHaveLength(9)
    expect(container.textContent).not.toContain("展开")
    search("  TASK-8  ")
    expect(container.querySelectorAll("[data-session]")).toHaveLength(1)
    expect(row("p-task-8")).not.toBeNull()
  })

  it("auto-reveals an active session beyond the project preview fold", () => {
    render({
      currentSessionId: "p-session-8",
      chats: Array.from({ length: 9 }, (_, index) =>
        chat(`p-session-${index}`, 5, { config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, projectId: "p1" } })),
    })
    run(() => buttonByLabel("切换为项目视图").click())
    expect(row("p-session-8")?.getAttribute("data-active")).toBe("true")
    expect(container.querySelectorAll("[data-session]")).toHaveLength(9)
    // Selecting a session inside the preview fold keeps the group expanded…
    render({ currentSessionId: "p-session-0" })
    expect(container.querySelectorAll("[data-session]")).toHaveLength(9)
    // …and folding back to the preview only happens through the collapse button.
    run(() => button("收起").click())
    expect(container.querySelectorAll("[data-session]")).toHaveLength(7)
  })

  it("shows empty Projects and quick-creates a session inside the Project", () => {
    appStore.setState({
      projects: {
        empty: {
          id: "empty", name: "Empty project", status: "active", revision: 1, resource_revision: 1,
          project_path: "/tmp/empty", project_path_status: "configured", workspace_count: 1,
          created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
          schema_version: 2, workspace_bindings: [],
        },
      },
    })
    render({ chats: [] })
    run(() => buttonByLabel("切换为项目视图").click())

    expect(button("Empty project").textContent).toContain("0")
    run(() => buttonByLabel("在 Empty project 中新建会话").click())
    expect(props.onNewChat).toHaveBeenCalledWith("empty", undefined)
    expect(props.onClose).toHaveBeenCalledOnce()
  })
})

function project(id: string, name: string, section: string | null = null): ProjectManifest {
  return {
    id, name, section, status: "active" as const, revision: 1, resource_revision: 1,
    sidebar: { sections: [], session_sections: {}, hidden_legacy: false },
    project_path: `/tmp/${id}`, project_path_status: "configured" as const, workspace_count: 1,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    schema_version: 2, workspace_bindings: [],
  }
}

function installProjectBackend(initial: Record<string, ProjectManifest>) {
  const snapshots = structuredClone(initial)
  const updateProject = vi.fn(async (id: string, revision: number, patch: PatchProjectRequest) => {
    const current = snapshots[id]
    if (current.revision !== revision) throw new ApiError("Project changed", 412, "Precondition Failed")
    const next: ProjectManifest = { ...current, ...patch, revision: current.revision + 1 }
    snapshots[id] = next
    appStore.setState((state) => ({ projects: { ...state.projects, [id]: next } }))
    return next
  })
  const ensureProject = vi.fn(async (id: string) => {
    const current = snapshots[id]
    appStore.setState((state) => ({ projects: { ...state.projects, [id]: current } }))
  })
  appStore.setState({ projects: structuredClone(initial), updateProject, ensureProject })
  return { snapshots, updateProject, ensureProject }
}

function projectChat(id: string, projectId: string, extra: Partial<ChatItem> = {}) {
  return chat(id, 5, { config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, projectId }, ...extra })
}
async function drop(target: Element, payload: unknown, mime = SIDEBAR_SESSION_DRAG_TYPE, revision?: number) {
  const data = payload as { projectId: string; sessionId?: string; sectionId?: string }
  const projectId = target.getAttribute("data-section-project") ?? target.getAttribute("data-project-drop")!
  const sectionId = target.getAttribute("data-section-id")
  const destination = { projectId, sectionId: sectionId === "none" ? null : sectionId }
  const pickup: SidebarDragPickup = { kind: mime === SIDEBAR_SECTION_DRAG_TYPE ? "section" : "session", projectId: data.projectId,
    id: (mime === SIDEBAR_SECTION_DRAG_TYPE ? data.sectionId : data.sessionId)!, revision: revision ?? appStore.getState().projects[data.projectId]?.revision ?? 0 }
  await settle(async () => {
    if (pickup.kind === "session") await dragHarness.current!.onMoveSession(pickup, destination)
    else dragHarness.current!.onMoveSection(pickup, destination, false)
  })
}

/** Drop `sourceId` onto another session row, which is a position request. */
async function dropOnRow(sourceId: string, targetId: string, after: boolean, sectionId: string | null = null, projectId = "p1") {
  const pickup: SidebarDragPickup = { kind: "session", projectId, id: sourceId,
    revision: appStore.getState().projects[projectId]?.revision ?? 0 }
  await settle(async () => { await dragHarness.current!.onMoveSession(pickup, { projectId, sectionId, sessionId: targetId }, after) })
}

const renderedSessions = (scope: ParentNode) =>
  [...scope.querySelectorAll("[data-session]")].map((element) => element.getAttribute("data-session"))

describe("Sidebar server sections", () => {
  const lotusA = "section:00000000-0000-4000-8000-000000000011"
  const lotusB = "section:00000000-0000-4000-8000-000000000012"
  function setup() {
    const p1 = project("p1", "Zenith", "Development")
    const p2 = project("p2", "Nova", "Development")
    p1.sidebar!.sections.push({ id: lotusA, name: "lotus" })
    p2.sidebar!.sections.push({ id: lotusB, name: "lotus" })
    const backend = installProjectBackend({ p1, p2 })
    render({ chats: [projectChat("first", "p1"), projectChat("second", "p1"), projectChat("foreign", "p2"), projectChat("pinned", "p1", { pinned: true })] })
    run(() => buttonByLabel("切换为项目视图").click())
    return backend
  }

  it("drops sessions on their own project to clear sections without changing project identity", async () => {
    const { snapshots, updateProject } = setup()
    await clickAndSave("Move first to lotus")
    const target = container.querySelector('[data-project-drop="p1"]')!
    await drop(target, { projectId: "p1", sessionId: "first" })
    expect(snapshots.p1.sidebar!.session_sections.first).toBeNull()
    expect(props.chats[0].config.projectId).toBe("p1")
    expect(updateProject).toHaveBeenCalledTimes(2)
    await drop(target, { projectId: "p1", sessionId: "first" })
    await drop(target, { projectId: "p1", sessionId: "foreign" })
    await drop(target, { projectId: "p2", sessionId: "foreign" })
    expect(updateProject).toHaveBeenCalledTimes(2)
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it("reveals a folded drop destination only after a confirmed move", async () => {
    setup()
    const section = container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!
    run(() => section.querySelector<HTMLButtonElement>("button")!.click())
    expect(section.querySelector("button")!.getAttribute("aria-expanded")).toBe("false")
    await drop(section, { projectId: "p1", sessionId: "second" })
    expect(section.querySelector("button")!.getAttribute("aria-expanded")).toBe("true")
    expect(section.contains(row("second"))).toBe(true)
  })

  it("rejects project-header drops for archived projects", async () => {
    const { snapshots, updateProject } = setup()
    snapshots.p1.status = "archived"
    run(() => appStore.setState({ projects: structuredClone(snapshots) }))
    await drop(container.querySelector('[data-project-drop="p1"]')!, { projectId: "p1", sessionId: "first" })
    expect(updateProject).not.toHaveBeenCalled()
  })

  it("persists custom section drag order, rejects foreign sections, and keeps legacy fixed", async () => {
    const { snapshots, updateProject } = setup()
    const other = { id: "section:other", name: "Other" }
    snapshots.p1.sidebar!.sections.push(other)
    run(() => appStore.setState({ projects: structuredClone(snapshots) }))
    const target = container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!
    await drop(target, { projectId: "p1", sectionId: other.id }, SIDEBAR_SECTION_DRAG_TYPE)
    expect(snapshots.p1.sidebar!.sections.map((section) => section.id)).toEqual([other.id, lotusA])
    expect(updateProject).toHaveBeenCalledOnce()
    await drop(target, { projectId: "p2", sectionId: lotusB }, SIDEBAR_SECTION_DRAG_TYPE)
    await drop(target, { projectId: "p1", sectionId: "legacy" }, SIDEBAR_SECTION_DRAG_TYPE)
    expect(updateProject).toHaveBeenCalledOnce()
    await drop(container.querySelector('[data-project-drop="p1"]')!, { projectId: "p1", sectionId: other.id }, SIDEBAR_SECTION_DRAG_TYPE)
    expect(snapshots.p1.sidebar!.sections.map((section) => section.id)).toEqual([lotusA, other.id])
    expect(snapshots.p1.sidebar!.session_sections).toEqual({})
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it("uses a dedicated internal section handle and leaves disclosure and native drops independent", async () => {
    const { updateProject } = setup()
    const section = container.querySelector('[data-section-id="' + lotusA + '"]')!
    const disclosure = section.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    expect(disclosure.draggable).toBe(false)
    expect(section.querySelector('[data-sidebar-drag-handle="section:' + lotusA + '"]')).not.toBeNull()
    expect(disclosure.getAttribute("aria-expanded")).toBe("true")
    run(() => disclosure.click())
    expect(disclosure.getAttribute("aria-expanded")).toBe("false")
    const event = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "dataTransfer", { value: { getData: () => JSON.stringify({ projectId: "p1", sessionId: "first" }) } })
    await settle(async () => section.dispatchEvent(event))
    expect(updateProject).not.toHaveBeenCalled()
  })

  it("rejects an internal drop after its pickup revision has changed", async () => {
    const { snapshots, updateProject } = setup()
    snapshots.p1 = { ...snapshots.p1, revision: 2 }
    run(() => appStore.setState({ projects: structuredClone(snapshots) }))
    const target = container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!
    await drop(target, { projectId: "p1", sessionId: "first" }, SIDEBAR_SESSION_DRAG_TYPE, 1)
    await drop(target, { projectId: "p1", sectionId: lotusA }, SIDEBAR_SECTION_DRAG_TYPE, 1)
    expect(updateProject).not.toHaveBeenCalled()
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it("saves menu moves with the current Project revision and preserves canonical membership and pinned actions", async () => {
    const { updateProject, snapshots } = setup()
    const originalForeign = structuredClone(snapshots.p2)
    await clickAndSave("Move first to lotus")
    const localA = container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!
    expect(localA.contains(row("first"))).toBe(true)
    expect(localA.textContent).toContain("lotus1 个会话")
    expect(container.querySelector('[data-section-project="p2"][data-project-section="lotus"]')!.textContent).toContain("lotus0 个会话")
    expect(updateProject).toHaveBeenNthCalledWith(1, "p1", 1, {
      sidebar: { sections: [{ id: lotusA, name: "lotus" }], session_sections: { first: lotusA }, hidden_legacy: false },
    })
    await clickAndSave("Unsection first")
    expect(container.querySelector('[data-section-project="p1"][data-section-id="none"]')!.contains(row("first"))).toBe(true)
    expect(updateProject).toHaveBeenNthCalledWith(2, "p1", 2, {
      sidebar: { sections: [{ id: lotusA, name: "lotus" }], session_sections: { first: null }, hidden_legacy: false },
    })
    await clickAndSave("Move pinned to lotus")
    expect(row("pinned")).not.toBeNull()
    click("Pin pinned")
    expect(props.onTogglePin).toHaveBeenCalledWith(props.chats[3])
    expect(appStore.getState().projects.p1.section).toBe("Development")
    expect(snapshots.p2).toEqual(originalForeign)
    expect(props.chats[0].config.projectId).toBe("p1")
    expect(localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)).toBeNull()
  })

  it("disables section moves and drops with an upgrade hint for an unsupported backend", async () => {
    const { updateProject } = setup()
    run(() => appStore.setState((state) => ({ projects: { ...state.projects, p1: { ...state.projects.p1!, sidebar: undefined } } })))
    expect([...container.querySelectorAll("button")].some((item) => item.textContent?.startsWith("Move first to"))).toBe(false)
    expect(container.querySelector('[role="status"]')?.textContent).toContain("更新 Bamboo 后端")
    const target = container.querySelector('[data-section-project="p1"][data-section-id="legacy"]')!
    expect(target.getAttribute("aria-disabled")).toBe("true")
    await drop(target, { projectId: "p1", sessionId: "first" })
    expect(updateProject).not.toHaveBeenCalled()
  })

  it("creates a session scoped to a section from the section header button", async () => {
    setup()
    const section = container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!
    const create = section.querySelector<HTMLButtonElement>(`button[aria-label="${uiText("sidebar_section_new_session", { v0: "lotus" })}"]`)!
    await settle(async () => create.click())
    expect(props.onNewChat).toHaveBeenCalledExactlyOnceWith("p1", lotusA)
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it("omits the section new-session entry while a section write is busy", async () => {
    const { updateProject } = setup()
    const persist = updateProject.getMockImplementation()!
    let confirm!: () => Promise<void>
    updateProject.mockImplementationOnce((...args) => new Promise<ProjectManifest>((resolve) => {
      confirm = async () => { resolve(await persist(...args)) }
    }))
    click("Move first to lotus")
    const section = container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!
    expect(section.querySelector(`button[aria-label="${uiText("sidebar_section_new_session", { v0: "lotus" })}"]`)).toBeNull()
    await settle(async () => { await confirm() })
    expect(section.querySelector(`button[aria-label="${uiText("sidebar_section_new_session", { v0: "lotus" })}"]`)).not.toBeNull()
  })

  it("does not show one Project's failed save inside another Project's dialog", async () => {
    vi.useRealTimers()
    const { updateProject } = setup()
    updateProject.mockRejectedValueOnce(new Error("offline"))
    await clickAndSave("Move first to lotus")
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Zenith · 分区未保存")
    const trigger = buttonByLabel("Nova 项目操作")
    await settle(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
    const createMenu = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes("创建分区"))!
    await settle(async () => createMenu.click())
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain("Nova")
    expect(dialog.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Zenith · 分区未保存")
  })

  it("keeps busy drag handles mounted and saving feedback outside the session list while awaiting confirmation", async () => {
    const { updateProject } = setup()
    const persist = updateProject.getMockImplementation()!
    let confirm!: () => Promise<void>
    updateProject.mockImplementationOnce((...args) => new Promise<ProjectManifest>((resolve) => {
      confirm = async () => { resolve(await persist(...args)) }
    }))
    const firstHandle = row("first")!.querySelector<HTMLButtonElement>("[data-sidebar-drag-handle]")!
    const secondHandle = row("second")!.querySelector<HTMLButtonElement>("[data-sidebar-drag-handle]")!
    const foreignHandle = row("foreign")!.querySelector<HTMLButtonElement>("[data-sidebar-drag-handle]")!
    const projectGroup = container.querySelector('[data-sidebar-project="p1"]')!
    const sessionList = projectGroup.closest(".overflow-y-auto")!
    click("Move first to lotus")
    const saving = container.querySelector('[role="status"]')!
    expect(saving.textContent).toContain("正在保存分区")
    expect(sessionList.contains(saving)).toBe(false)
    expect(projectGroup.getAttribute("aria-busy")).toBe("true")
    expect(row("first")!.querySelector("[data-sidebar-drag-handle]")).toBe(firstHandle)
    expect(firstHandle.isConnected).toBe(true)
    expect(firstHandle.disabled).toBe(true)
    expect(row("second")!.querySelector("[data-sidebar-drag-handle]")).toBe(secondHandle)
    expect(secondHandle.disabled).toBe(true)
    expect(foreignHandle.disabled).toBe(false)
    expect([...container.querySelectorAll("button")].some((item) => item.textContent === "Move second to lotus")).toBe(false)
    const target = container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!
    expect(target.getAttribute("aria-disabled")).toBe("true")
    await drop(target, { projectId: "p1", sessionId: "second" })
    expect(updateProject).toHaveBeenCalledOnce()
    await settle(async () => { await confirm() })
    expect(target.contains(row("first"))).toBe(true)
    expect(target.getAttribute("aria-disabled")).toBe("false")
    expect(projectGroup.getAttribute("aria-busy")).toBe("false")
    expect(row("second")!.querySelector("[data-sidebar-drag-handle]")).toBe(secondHandle)
    expect(secondHandle.disabled).toBe(false)
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(button("Move second to lotus")).toBeDefined()
  })

  it("saves same-project drops into empty sections and sends no write for foreign, forged, missing or child sessions", async () => {
    const { updateProject, snapshots } = setup()
    const target = container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!
    expect(target.textContent).toContain("拖动会话到这里")
    await drop(target, { projectId: "p2", sessionId: "foreign" })
    await drop(target, { projectId: "p1", sessionId: "foreign" })
    await drop(target, { projectId: "p1", sessionId: "missing" })
    render({ chats: [...props.chats, projectChat("child", "p1", { parentSessionId: "first" })] })
    await drop(target, { projectId: "p1", sessionId: "child" })
    expect(updateProject).not.toHaveBeenCalled()
    await drop(target, { projectId: "p1", sessionId: "first" })
    expect(target.contains(row("first"))).toBe(true)
    expect(updateProject).toHaveBeenCalledOnce()
    expect(snapshots.p1.sidebar!.session_sections).toEqual({ first: lotusA })
    expect(props.chats[0].config.projectId).toBe("p1")
  })

  it("reveals an active session's section, restores folds after search, and opens a confirmed new target", async () => {
    setup()
    const target = container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!
    const unsectioned = container.querySelector('[data-section-project="p1"][data-section-id="none"]')!
    run(() => target.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
    run(() => unsectioned.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
    expect(row("first")).toBeNull()
    search("first")
    expect(row("first")).not.toBeNull()
    expect(container.querySelector('[data-section-project="p1"]')?.getAttribute("aria-disabled")).toBe("false")
    search("")
    expect(row("first")).toBeNull()
    render({ currentSessionId: "first" })
    expect(row("first")?.getAttribute("data-active")).toBe("true")
    await clickAndSave("Move first to lotus")
    const revealed = container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!
    expect(revealed.querySelector("button")?.getAttribute("aria-expanded")).toBe("true")
    expect(revealed.contains(row("first"))).toBe(true)
  })

  it("saves server moves when device storage writes are blocked", async () => {
    const { updateProject, snapshots } = setup()
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("blocked") })
    await clickAndSave("Move first to lotus")
    expect(container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!.contains(row("first"))).toBe(true)
    await clickAndSave("Unsection first")
    expect(container.querySelector('[data-section-project="p1"][data-section-id="none"]')!.contains(row("first"))).toBe(true)
    expect(updateProject).toHaveBeenCalledTimes(2)
    expect(snapshots.p1.sidebar!.session_sections.first).toBeNull()
  })

  it("keeps a failed move uncommitted and retries against the last confirmed revision", async () => {
    const { updateProject, snapshots } = setup()
    updateProject.mockRejectedValueOnce(new Error("offline"))
    await clickAndSave("Move first to lotus")
    expect(container.querySelector('[data-section-project="p1"][data-section-id="none"]')!.contains(row("first"))).toBe(true)
    expect(snapshots.p1.sidebar!.session_sections.first).toBeUndefined()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("分区未保存")
    await clickAndSave("Move first to lotus")
    expect(updateProject.mock.calls.map((call) => call[1])).toEqual([1, 1])
    expect(container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!.contains(row("first"))).toBe(true)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it("refreshes a conflicting Project and leaves the losing move available for an explicit retry", async () => {
    const { updateProject, ensureProject, snapshots } = setup()
    snapshots.p1 = { ...snapshots.p1, revision: 2, sidebar: { ...snapshots.p1.sidebar!, session_sections: { second: lotusA } } }
    await clickAndSave("Move first to lotus")
    expect(ensureProject).toHaveBeenCalledWith("p1", { force: true })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("已在其他客户端更新")
    const target = container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!
    expect(target.contains(row("first"))).toBe(false)
    expect(target.contains(row("second"))).toBe(true)
    expect(snapshots.p1.sidebar!.session_sections).toEqual({ second: lotusA })
    await clickAndSave("Move first to lotus")
    expect(updateProject).toHaveBeenLastCalledWith("p1", 2, {
      sidebar: { sections: [{ id: lotusA, name: "lotus" }], session_sections: { second: lotusA, first: lotusA }, hidden_legacy: false },
    })
    expect(target.contains(row("first"))).toBe(true)
  })

  it("renders an existing empty server snapshot instead of resurrecting stale device sections", async () => {
    localStorage.setItem(PROJECT_SECTIONS_STORAGE_KEY, JSON.stringify({ version: 1, projects: {
      p1: { sections: [{ id: lotusA, name: "Stale local" }], sessionSections: { first: lotusA }, hiddenLegacy: true },
    } }))
    const { updateProject } = installProjectBackend({ p1: project("p1", "Zenith", "Development") })
    render({ chats: [projectChat("first", "p1")] })
    run(() => buttonByLabel("切换为项目视图").click())
    await settle(async () => {})
    expect(container.querySelector('[data-project-section="Stale local"]')).toBeNull()
    expect(container.querySelector('[data-section-id="none"]')!.contains(row("first"))).toBe(true)
    expect(updateProject).not.toHaveBeenCalled()
  })

  it("creates empty sections and preserves only explicit assignments through an owner remount", async () => {
    vi.useRealTimers()
    const { updateProject, snapshots } = installProjectBackend({ p1: project("p1", "Zenith", "lotus") })
    const chats = [projectChat("first", "p1"), projectChat("untouched", "p1")]
    await settle(() => render({ chats }))
    run(() => buttonByLabel("切换为项目视图").click())
    expect(container.querySelector('[data-project-section="lotus"]')!.textContent).toContain("lotus0 个会话")
    const trigger = buttonByLabel("Zenith 项目操作")
    await settle(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
    const createMenu = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes("创建分区"))!
    expect(createMenu).toBeDefined()
    await settle(async () => createMenu.click())
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] form input')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    run(() => { setter.call(input, "Research"); input.dispatchEvent(new Event("input", { bubbles: true })) })
    await settle(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    const section = container.querySelector('[data-project-section="Research"]')!
    expect(section).not.toBeNull()
    expect(section.textContent).toContain("Research0 个会话")
    expect(section.contains(row("first"))).toBe(false)
    expect(section.contains(row("untouched"))).toBe(false)
    expect(container.querySelector('[data-section-id="none"]')!.contains(row("first"))).toBe(true)
    expect(container.querySelector('[data-section-id="none"]')!.contains(row("untouched"))).toBe(true)
    const persisted = snapshots.p1.sidebar!.sections.find((candidate) => candidate.name === "Research")!
    expect(section.getAttribute("data-section-id")).toBe(persisted.id)
    expect(snapshots.p1.sidebar!.sections).toHaveLength(1)
    expect(snapshots.p1.sidebar!.session_sections).toEqual({})

    await clickAndSave("Move first to Research")
    expect(section.contains(row("first"))).toBe(true)
    expect(snapshots.p1.sidebar!.session_sections.first).toBe(persisted.id)
    unmount()
    const refreshedChats = [...chats, projectChat("new-session", "p1")]
    await settle(() => render({ chats: refreshedChats }))
    const restored = container.querySelector('[data-project-section="Research"]')!
    expect(restored.getAttribute("data-section-id")).toBe(persisted.id)
    expect(restored.textContent).toContain("Research1 个会话")
    expect(restored.contains(row("first"))).toBe(true)
    const noSection = container.querySelector('[data-section-id="none"]')!
    expect(noSection.contains(row("untouched"))).toBe(true)
    expect(noSection.contains(row("new-session"))).toBe(true)
    expect(snapshots.p1.sidebar!.session_sections["new-session"]).toBeUndefined()
    expect(container.querySelector('[data-project-section="lotus"]')!.textContent).toContain("lotus0 个会话")
    expect(updateProject).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)).toBeNull()
  })
})

describe("Sidebar session ordering", () => {
  it("promotes the session the user just wrote into to the front", () => {
    render()
    expect(renderedSessions(container).slice(0, 2)).toEqual(["day-0", "day-1"])
    // Submitting input is the recency signal: the session leaves its older date
    // group and becomes the first row of today.
    run(() => { recordSessionUserInput("day-3") })
    expect(renderedSessions(container).slice(0, 3)).toEqual(["day-3", "day-0", "day-1"])
  })

  it("reorders a session dropped on another row without writing to the server", async () => {
    const { updateProject } = installProjectBackend({ p1: project("p1", "Zenith") })
    render({ chats: [projectChat("first", "p1"), projectChat("second", "p1")] })
    run(() => buttonByLabel("切换为项目视图").click())
    const bucket = () => container.querySelector('[data-section-project="p1"][data-section-id="none"]')!
    expect(renderedSessions(bucket())).toEqual(["first", "second"])

    await dropOnRow("second", "first", false)
    expect(renderedSessions(bucket())).toEqual(["second", "first"])
    expect(updateProject).not.toHaveBeenCalled()
    expect(localStorage.getItem(SESSION_ORDER_STORAGE_KEY)).toContain("second")

    // The position survives a remount, which is what makes it a real order.
    unmount()
    await settle(() => render())
    expect(renderedSessions(bucket())).toEqual(["second", "first"])
  })

  it("moves a session into another section at the dropped position", async () => {
    const lotusA = "section:00000000-0000-4000-8000-000000000011"
    const p1 = project("p1", "Zenith", "Development")
    p1.sidebar!.sections.push({ id: lotusA, name: "lotus" })
    const { updateProject, snapshots } = installProjectBackend({ p1 })
    render({ chats: [projectChat("first", "p1"), projectChat("second", "p1")] })
    run(() => buttonByLabel("切换为项目视图").click())
    await clickAndSave("Move first to lotus")
    await dropOnRow("second", "first", true, lotusA)

    expect(snapshots.p1.sidebar!.session_sections.second).toBe(lotusA)
    const section = () => container.querySelector(`[data-section-id="${lotusA}"]`)!
    expect(renderedSessions(section())).toEqual(["first", "second"])
    expect(updateProject).toHaveBeenCalledTimes(2)
  })

  it("keeps a submission made while a cross-section move is pending", async () => {
    const lotusA = "section:00000000-0000-4000-8000-000000000011"
    const p1 = project("p1", "Zenith", "Development")
    p1.sidebar!.sections.push({ id: lotusA, name: "lotus" })
    const { updateProject, snapshots } = installProjectBackend({ p1 })
    render({ chats: [projectChat("first", "p1"), projectChat("second", "p1")] })
    run(() => buttonByLabel("切换为项目视图").click())
    await clickAndSave("Move first to lotus")

    const persist = updateProject.getMockImplementation()!
    let confirm!: () => Promise<void>
    updateProject.mockImplementationOnce((...args) => new Promise<ProjectManifest>((resolve) => {
      confirm = async () => { resolve(await persist(...args)) }
    }))
    const pickup: SidebarDragPickup = { kind: "session", projectId: "p1", id: "second",
      revision: appStore.getState().projects.p1!.revision }
    let moved: Promise<boolean> | undefined
    // Act on the drop without waiting: the server response is still pending.
    await settle(async () => {
      moved = dragHarness.current!.onMoveSession(pickup, { projectId: "p1", sectionId: lotusA, sessionId: "first" }, true)
    })
    // Another session is written into while the move is in flight.
    run(() => { recordSessionUserInput("elsewhere", 1_700_000_000_000) })

    await settle(async () => { await confirm() })
    await settle(async () => { await moved })

    const stored = parseSessionOrder(localStorage.getItem(SESSION_ORDER_STORAGE_KEY))
    expect(stored.activity.elsewhere).toBe(1_700_000_000_000)
    expect(stored.ranks.elsewhere).toBeGreaterThan(0)
    expect(snapshots.p1.sidebar!.session_sections.second).toBe(lotusA)
  })

  it("re-sorts the destination bucket with a promotion that landed mid-move", async () => {
    const lotusA = "section:00000000-0000-4000-8000-000000000011"
    const p1 = project("p1", "Zenith", "Development")
    p1.sidebar!.sections.push({ id: lotusA, name: "lotus" })
    const { updateProject, snapshots } = installProjectBackend({ p1 })
    render({ chats: [projectChat("first", "p1"), projectChat("second", "p1"), projectChat("third", "p1")] })
    run(() => buttonByLabel("切换为项目视图").click())
    // Destination starts as [first, second]; third stays behind for the drop.
    await clickAndSave("Move first to lotus")
    await clickAndSave("Move second to lotus")
    const destination = () => container.querySelector(`[data-section-id="${lotusA}"]`)!
    expect(renderedSessions(destination())).toEqual(["first", "second"])

    const persist = updateProject.getMockImplementation()!
    let confirm!: () => Promise<void>
    updateProject.mockImplementationOnce((...args) => new Promise<ProjectManifest>((resolve) => {
      confirm = async () => { resolve(await persist(...args)) }
    }))
    const pickup: SidebarDragPickup = { kind: "session", projectId: "p1", id: "third",
      revision: appStore.getState().projects.p1!.revision }
    let moved: Promise<boolean> | undefined
    await settle(async () => {
      moved = dragHarness.current!.onMoveSession(pickup, { projectId: "p1", sectionId: lotusA, sessionId: "first" }, false)
    })
    // While the move is pending, the user writes into the destination's last row,
    // which promotes it above the row the drop is anchored to.
    run(() => { recordSessionUserInput("second", 1_700_000_100_000) })

    await settle(async () => { await confirm() })
    await settle(async () => { await moved })

    expect(snapshots.p1.sidebar!.session_sections.third).toBe(lotusA)
    // third is anchored above first, but `second`'s promotion must survive ahead of it.
    expect(renderedSessions(destination())).toEqual(["second", "third", "first"])
  })
})
