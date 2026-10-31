import { act, StrictMode, type ComponentProps, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatItem } from "@shared/types/chatMessages"
import type { PatchProjectRequest, ProjectManifest } from "@services/project"
import { ApiError } from "@services/api"
import type { SidebarProjectDragProps, SidebarDragParts, SidebarDragPickup } from "./sidebarDrag"
const dragHarness = vi.hoisted(() => ({ current: null as SidebarProjectDragProps | null }))
vi.mock("./SidebarProjectDrag", () => {
  const Handle: SidebarDragParts["Handle"] = ({ source, label, disabled }) => <button data-sidebar-drag-handle={`${source.kind}:${source.id}`} aria-label={label} disabled={disabled} />
  const Target: SidebarDragParts["Target"] = ({ target, disabled, ...attributes }) => { void target; void disabled; return <div {...attributes} /> }
  return { default: (props: SidebarProjectDragProps) => { dragHarness.current = props; return props.children({ Handle, Target }) } }
})

vi.mock("@/components/chat/SessionRow", () => ({
  SessionRow: ({ chat, active, onSelect, onRename, onDelete, onTogglePin, onCopySessionId, sections = [], onMoveToSection, dragHandle }: {
    chat: ChatItem; active: boolean; onSelect(): void; onRename(title: string): void
    onDelete(): void; onTogglePin(): void; onCopySessionId(): void
    dragHandle?: ReactNode; sections?: readonly { id: string; name: string }[]; projectId?: string; onMoveToSection?: (id: string | null) => void
  }) => (
    <div data-session={chat.id} data-active={active}>
      <button onClick={onSelect}>{chat.title}</button>
      {dragHandle}
      <button onClick={() => onRename("Renamed")}>Rename {chat.id}</button>
      <button onClick={onDelete}>Delete {chat.id}</button>
      <button onClick={onTogglePin}>Pin {chat.id}</button>
      <button onClick={onCopySessionId}>Copy {chat.id}</button>
      {onMoveToSection ? <>
        {sections.map((section) => <button key={section.id} onClick={() => onMoveToSection(section.id)}>Move {chat.id} to {section.name}</button>)}
        <button onClick={() => onMoveToSection(null)}>Unsection {chat.id}</button>
      </> : null}
    </div>
  ),
}))

import { Sidebar } from "./Sidebar"
import { useAppStore } from "@shared/store/appStore"
import { uiText } from "@shared/i18n/ui"
import { PINNED_PROJECTS_STORAGE_KEY, PROJECT_SECTIONS_STORAGE_KEY, SIDEBAR_SESSION_DRAG_TYPE, SIDEBAR_SECTION_DRAG_TYPE } from "@/lib/projectSidebarPreferences"
import { SESSION_ORDER_STORAGE_KEY, clearSessionOrder, recordSessionUserInput } from "@/lib/sidebarSessionOrder"
import { DEFAULT_SUPERVISOR_SESSION_ID } from "@/lib/supervisor"

type Props = ComponentProps<typeof Sidebar>
let root: Root
let container: HTMLDivElement
let props: Props
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
environment.IS_REACT_ACT_ENVIRONMENT = true
const initialProjectActions = {
  updateProject: useAppStore.getState().updateProject,
  ensureProject: useAppStore.getState().ensureProject,
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
  act(() => root.render(<Sidebar {...props} />))
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim().startsWith(label))
  expect(found, `button ${label}`).toBeDefined()
  return found!
}

function click(label: string) {
  act(() => button(label).click())
}

async function clickAndSave(label: string) {
  await act(async () => button(label).click())
}

function row(id: string) {
  return container.querySelector(`[data-session="${id}"]`)
}

function search(value: string) {
  const input = container.querySelector("input")!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

beforeAll(async () => {
  // Resolve the actual lazy boundary once before synchronous disclosure assertions.
  localStorage.setItem("lotus.sidebar.grouping-mode.v1", "project")
  const host = document.body.appendChild(document.createElement("div"))
  const primingRoot = createRoot(host)
  const noop = () => {}
  await act(async () => primingRoot.render(<Sidebar open={false} onClose={noop} collapsed={false} onToggleCollapse={noop} width={288}
    chats={[]} booted currentSessionId={null} onNewChat={noop} onSelect={noop} onRename={noop} onDelete={noop}
    onTogglePin={noop} onCopySessionId={noop} onOpenSettings={noop} onOpenProjectManager={noop} />))
  act(() => primingRoot.unmount())
  host.remove()
})

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  clearSessionOrder()
  useAppStore.setState({ projects: {}, ...initialProjectActions })
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-05T15:00:00"))
  container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
  props = {
    open: false, onClose: vi.fn(), collapsed: false, onToggleCollapse: vi.fn(), width: 288,
    chats: Array.from({ length: 7 }, (_, index) => chat(`day-${index}`, 5 - index)),
    booted: true, currentSessionId: "day-0", onNewChat: vi.fn(), onSelect: vi.fn(),
    onRename: vi.fn(), onDelete: vi.fn(), onTogglePin: vi.fn(), onCopySessionId: vi.fn(), onOpenSettings: vi.fn(),
    onOpenProjectManager: vi.fn(),
  }
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
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

  it("collapses individual dates without changing session actions", () => {
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
    click("day-0")
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
    await act(async () => entry.click())
    expect(props.onSelect).toHaveBeenCalledWith(supervisor.id)
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(props.onNewChat).not.toHaveBeenCalled()
    search("no match")
    expect(button("Renamed assistant")).toBe(entry)
    expect(container.querySelectorAll("[data-session]")).toHaveLength(0)
    click("项目")
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
    await act(async () => button("Supervisor").click())
    expect(props.onSelect).toHaveBeenCalledWith(DEFAULT_SUPERVISOR_SESSION_ID)
    expect(props.onNewChat).not.toHaveBeenCalled()
    render({ chats: [], currentSessionId: DEFAULT_SUPERVISOR_SESSION_ID })
    expect(button("Supervisor").getAttribute("aria-current")).toBe("page")
    expect(container.querySelectorAll("[data-session]")).toHaveLength(0)
    act(() => root.unmount())
    root = createRoot(container)
    render({ currentSessionId: null })
    expect(button("Supervisor").disabled).toBe(false)
  })

  it("coalesces repeated opening clicks and keeps errors retryable", async () => {
    let finish!: () => void
    const opening = new Promise<void>((resolve) => { finish = resolve })
    const onSelect = vi.fn().mockReturnValueOnce(opening).mockRejectedValueOnce(new Error("offline"))
    render({ chats: [], onSelect })
    act(() => {
      button("Supervisor").click()
      button("Supervisor").click()
    })
    expect(onSelect).toHaveBeenCalledOnce()
    expect(button("Supervisor").disabled).toBe(true)
    await act(async () => finish())
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(button("Supervisor").disabled).toBe(false)
    await act(async () => button("Supervisor").click())
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("offline")
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(button("Supervisor").disabled).toBe(false)
    await act(async () => button("Supervisor").click())
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
    expect(props.onNewChat).toHaveBeenCalledWith(null)
    click("管理项目")
    expect(props.onOpenProjectManager).toHaveBeenCalledOnce()
    click("系统设置")
    expect(props.onOpenSettings).toHaveBeenCalledOnce()
    act(() => buttonByLabel("收起侧栏").click())
    expect(props.onToggleCollapse).toHaveBeenCalledOnce()
  })

  it("uses text labels to switch between recent and project views", () => {
    render()
    expect(container.textContent).toContain("最近")
    expect(buttonByLabel("切换为项目视图").textContent).toContain("项目")
    act(() => buttonByLabel("切换为项目视图").click())
    expect(buttonByLabel("切换为最近视图").textContent).toContain("最近")
  })
})

describe("Sidebar project grouping", () => {
  beforeEach(() => {
    localStorage.removeItem("lotus.sidebar.grouping-mode.v1")
    localStorage.removeItem(PINNED_PROJECTS_STORAGE_KEY)
  })

  it("groups sessions by project after switching the grouping mode", () => {
    useAppStore.setState({
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
    act(() => buttonByLabel("切换为项目视图").click())
    expect(row("in-project")).not.toBeNull()
    expect(row("no-project")).not.toBeNull()
    // Project label renders as the group header button.
    expect(button("Zenith")).toBeDefined()
    expect(button("未分配")).toBeDefined()
  })

  it("keeps legacy sections empty until explicit server moves and scopes same-name folds independently", async () => {
    const { updateProject, snapshots } = installProjectBackend({ p1: project("p1", "Zenith", "lotus"), p2: project("p2", "Nova", "lotus") })
    render({ chats: [projectChat("zenith-chat", "p1"), projectChat("nova-chat", "p2")] })
    click("项目")
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
    act(() => lotusA.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click())
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
    act(() => buttonByLabel("切换为项目视图").click())
    const newChat = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().startsWith("新建"),
    )
    expect(newChat).toBeDefined()
    act(() => newChat!.click())
    expect(props.onNewChat).toHaveBeenCalledWith("p2")
  })

  it("folds a project group's sessions beyond seven behind an expand button", () => {
    render({
      chats: Array.from({ length: 10 }, (_, index) =>
        chat(`p-session-${index}`, 5, { config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, projectId: "p1" } })),
    })
    act(() => buttonByLabel("切换为项目视图").click())
    // Only the first seven are visible, plus the expand affordance.
    expect(container.querySelectorAll("[data-session]")).toHaveLength(7)
    expect(container.textContent).toContain("展开 3 个")
    act(() => button("展开 3 个").click())
    expect(container.querySelectorAll("[data-session]")).toHaveLength(10)
    expect(button("收起")).toBeDefined()
    act(() => button("收起").click())
    expect(container.querySelectorAll("[data-session]")).toHaveLength(7)
  })

  it("reveals all matching sessions during search in project mode", () => {
    render({
      chats: Array.from({ length: 9 }, (_, index) =>
        chat(`day-${index}-s`, 5, { title: `s${index}`, config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, projectId: "p1" } })),
    })
    act(() => buttonByLabel("切换为项目视图").click())
    expect(container.querySelectorAll("[data-session]")).toHaveLength(7)
    search("s")
    expect(container.querySelectorAll("[data-session]")).toHaveLength(9)
    expect(container.textContent).not.toContain("展开")
  })

  it("auto-reveals an active session beyond the project preview fold", () => {
    render({
      currentSessionId: "p-session-8",
      chats: Array.from({ length: 9 }, (_, index) =>
        chat(`p-session-${index}`, 5, { config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, projectId: "p1" } })),
    })
    act(() => buttonByLabel("切换为项目视图").click())
    expect(row("p-session-8")?.getAttribute("data-active")).toBe("true")
    expect(container.querySelectorAll("[data-session]")).toHaveLength(9)
    // Selecting a session inside the preview fold keeps the group expanded…
    render({ currentSessionId: "p-session-0" })
    expect(container.querySelectorAll("[data-session]")).toHaveLength(9)
    // …and folding back to the preview only happens through the collapse button.
    act(() => button("收起").click())
    expect(container.querySelectorAll("[data-session]")).toHaveLength(7)
  })

  it("shows empty Projects and quick-creates a session inside the Project", () => {
    useAppStore.setState({
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
    act(() => buttonByLabel("切换为项目视图").click())

    expect(button("Empty project").textContent).toContain("0")
    act(() => buttonByLabel("在 Empty project 中新建会话").click())
    expect(props.onNewChat).toHaveBeenCalledWith("empty")
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
    useAppStore.setState((state) => ({ projects: { ...state.projects, [id]: next } }))
    return next
  })
  const ensureProject = vi.fn(async (id: string) => {
    const current = snapshots[id]
    useAppStore.setState((state) => ({ projects: { ...state.projects, [id]: current } }))
  })
  useAppStore.setState({ projects: structuredClone(initial), updateProject, ensureProject })
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
    id: (mime === SIDEBAR_SECTION_DRAG_TYPE ? data.sectionId : data.sessionId)!, revision: revision ?? useAppStore.getState().projects[data.projectId]?.revision ?? 0 }
  await act(async () => {
    if (pickup.kind === "session") await dragHarness.current!.onMoveSession(pickup, destination)
    else dragHarness.current!.onMoveSection(pickup, destination, false)
  })
}

/** Drop `sourceId` onto another session row, which is a position request. */
async function dropOnRow(sourceId: string, targetId: string, after: boolean, sectionId: string | null = null, projectId = "p1") {
  const pickup: SidebarDragPickup = { kind: "session", projectId, id: sourceId,
    revision: useAppStore.getState().projects[projectId]?.revision ?? 0 }
  await act(async () => { await dragHarness.current!.onMoveSession(pickup, { projectId, sectionId, sessionId: targetId }, after) })
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
    click("项目")
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
    act(() => section.querySelector<HTMLButtonElement>("button")!.click())
    expect(section.querySelector("button")!.getAttribute("aria-expanded")).toBe("false")
    await drop(section, { projectId: "p1", sessionId: "second" })
    expect(section.querySelector("button")!.getAttribute("aria-expanded")).toBe("true")
    expect(section.contains(row("second"))).toBe(true)
  })

  it("rejects project-header drops for archived projects", async () => {
    const { snapshots, updateProject } = setup()
    snapshots.p1.status = "archived"
    act(() => useAppStore.setState({ projects: structuredClone(snapshots) }))
    await drop(container.querySelector('[data-project-drop="p1"]')!, { projectId: "p1", sessionId: "first" })
    expect(updateProject).not.toHaveBeenCalled()
  })

  it("persists custom section drag order, rejects foreign sections, and keeps legacy fixed", async () => {
    const { snapshots, updateProject } = setup()
    const other = { id: "section:other", name: "Other" }
    snapshots.p1.sidebar!.sections.push(other)
    act(() => useAppStore.setState({ projects: structuredClone(snapshots) }))
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
    act(() => disclosure.click())
    expect(disclosure.getAttribute("aria-expanded")).toBe("false")
    const event = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "dataTransfer", { value: { getData: () => JSON.stringify({ projectId: "p1", sessionId: "first" }) } })
    await act(async () => section.dispatchEvent(event))
    expect(updateProject).not.toHaveBeenCalled()
  })

  it("rejects an internal drop after its pickup revision has changed", async () => {
    const { snapshots, updateProject } = setup()
    snapshots.p1 = { ...snapshots.p1, revision: 2 }
    act(() => useAppStore.setState({ projects: structuredClone(snapshots) }))
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
    expect(useAppStore.getState().projects.p1.section).toBe("Development")
    expect(snapshots.p2).toEqual(originalForeign)
    expect(props.chats[0].config.projectId).toBe("p1")
    expect(localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)).toBeNull()
  })

  it("disables section moves and drops with an upgrade hint for an unsupported backend", async () => {
    const { updateProject } = setup()
    act(() => useAppStore.setState((state) => ({ projects: { ...state.projects, p1: { ...state.projects.p1!, sidebar: undefined } } })))
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
    await act(async () => create.click())
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
    await act(async () => { await confirm() })
    expect(section.querySelector(`button[aria-label="${uiText("sidebar_section_new_session", { v0: "lotus" })}"]`)).not.toBeNull()
  })

  it("does not show one Project's failed save inside another Project's dialog", async () => {
    vi.useRealTimers()
    const { updateProject } = setup()
    updateProject.mockRejectedValueOnce(new Error("offline"))
    await clickAndSave("Move first to lotus")
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Zenith · 分区未保存")
    const trigger = buttonByLabel("Nova 项目操作")
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
    const createMenu = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes("创建分区"))!
    await act(async () => createMenu.click())
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
    await act(async () => { await confirm() })
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
    act(() => target.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
    act(() => unsectioned.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
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
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
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
    click("项目")
    await act(async () => {})
    expect(container.querySelector('[data-project-section="Stale local"]')).toBeNull()
    expect(container.querySelector('[data-section-id="none"]')!.contains(row("first"))).toBe(true)
    expect(updateProject).not.toHaveBeenCalled()
  })

  it("creates empty sections and preserves only explicit assignments through StrictMode and reload", async () => {
    vi.useRealTimers()
    const { updateProject, snapshots } = installProjectBackend({ p1: project("p1", "Zenith", "lotus") })
    const chats = [projectChat("first", "p1"), projectChat("untouched", "p1")]
    await act(async () => root.render(<StrictMode><Sidebar {...props} chats={chats} /></StrictMode>))
    click("项目")
    expect(container.querySelector('[data-project-section="lotus"]')!.textContent).toContain("lotus0 个会话")
    const trigger = buttonByLabel("Zenith 项目操作")
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
    const createMenu = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes("创建分区"))!
    expect(createMenu).toBeDefined()
    await act(async () => createMenu.click())
    const input = document.querySelector<HTMLInputElement>("#project-section-name")!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    act(() => { setter.call(input, "Research"); input.dispatchEvent(new Event("input", { bubbles: true })) })
    await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
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
    await act(async () => root.unmount())
    root = createRoot(container)
    const refreshedChats = [...chats, projectChat("new-session", "p1")]
    await act(async () => root.render(<StrictMode><Sidebar {...props} chats={refreshedChats} /></StrictMode>))
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
    act(() => { recordSessionUserInput("day-3") })
    expect(renderedSessions(container).slice(0, 3)).toEqual(["day-3", "day-0", "day-1"])
  })

  it("reorders a session dropped on another row without writing to the server", async () => {
    const { updateProject } = installProjectBackend({ p1: project("p1", "Zenith") })
    render({ chats: [projectChat("first", "p1"), projectChat("second", "p1")] })
    click("项目")
    const bucket = () => container.querySelector('[data-section-project="p1"][data-section-id="none"]')!
    expect(renderedSessions(bucket())).toEqual(["first", "second"])

    await dropOnRow("second", "first", false)
    expect(renderedSessions(bucket())).toEqual(["second", "first"])
    expect(updateProject).not.toHaveBeenCalled()
    expect(localStorage.getItem(SESSION_ORDER_STORAGE_KEY)).toContain("second")

    // The position survives a remount, which is what makes it a real order.
    await act(async () => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(<Sidebar {...props} />))
    expect(renderedSessions(bucket())).toEqual(["second", "first"])
  })

  it("moves a session into another section at the dropped position", async () => {
    const lotusA = "section:00000000-0000-4000-8000-000000000011"
    const p1 = project("p1", "Zenith", "Development")
    p1.sidebar!.sections.push({ id: lotusA, name: "lotus" })
    const { updateProject, snapshots } = installProjectBackend({ p1 })
    render({ chats: [projectChat("first", "p1"), projectChat("second", "p1")] })
    click("项目")
    await clickAndSave("Move first to lotus")
    await dropOnRow("second", "first", true, lotusA)

    expect(snapshots.p1.sidebar!.session_sections.second).toBe(lotusA)
    const section = () => container.querySelector(`[data-section-id="${lotusA}"]`)!
    expect(renderedSessions(section())).toEqual(["first", "second"])
    expect(updateProject).toHaveBeenCalledTimes(2)
  })
})
