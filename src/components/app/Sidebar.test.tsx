import { act, StrictMode, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatItem } from "@shared/types/chatMessages"

vi.mock("@/components/chat/SessionRow", () => ({
  SessionRow: ({ chat, active, onSelect, onRename, onDelete, onTogglePin, onCopySessionId, sections = [], onMoveToSection }: {
    chat: ChatItem; active: boolean; onSelect(): void; onRename(title: string): void
    onDelete(): void; onTogglePin(): void; onCopySessionId(): void
    sections?: readonly { id: string; name: string }[]; projectId?: string; onMoveToSection?: (id: string | null) => void
  }) => (
    <div data-session={chat.id} data-active={active}>
      <button onClick={onSelect}>{chat.title}</button>
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
import { PINNED_PROJECTS_STORAGE_KEY, PROJECT_SECTIONS_STORAGE_KEY, SIDEBAR_SESSION_DRAG_TYPE,
  readProjectSectionPreferences, writeProjectSectionPreferences, createProjectSection, getProjectSections, getSessionSection } from "@/lib/projectSidebarPreferences"
import { DEFAULT_SUPERVISOR_SESSION_ID } from "@/lib/supervisor"

type Props = ComponentProps<typeof Sidebar>
let root: Root
let container: HTMLDivElement
let props: Props
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
environment.IS_REACT_ACT_ENVIRONMENT = true

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

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  useAppStore.setState({ projects: {} })
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
    expect(container.querySelectorAll("button[aria-expanded]")).toHaveLength(5)
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
    const entry = button("Supervisor")
    expect(entry.getAttribute("aria-current")).toBe("page")
    expect(container.textContent!.indexOf("Supervisor")).toBeLessThan(container.textContent!.indexOf("新建会话"))
    expect(row(supervisor.id)).toBeNull()
    expect(row("ordinary")).not.toBeNull()
    expect(button("今天").textContent).toBe("今天1 个会话")
    expect(container.textContent).not.toContain("Pin bamboo-default-supervisor")
    expect(document.getElementById(entry.getAttribute("aria-describedby")!)?.textContent).toBe("运行中")
    await act(async () => entry.click())
    expect(props.onSelect).toHaveBeenCalledWith(supervisor.id)
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(props.onNewChat).not.toHaveBeenCalled()
    search("no match")
    expect(button("Supervisor")).toBe(entry)
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

  it("keeps legacy sections empty until explicit moves and scopes same-name folds independently", () => {
    useAppStore.setState({ projects: { p1: project("p1", "Zenith", "lotus"), p2: project("p2", "Nova", "lotus") } })
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
    expect(getSessionSection(readProjectSectionPreferences(), "p1", "zenith-chat", "lotus")).toBeNull()
    click("Move zenith-chat to lotus")
    click("Move nova-chat to lotus")
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

function project(id: string, name: string, section: string | null = null) {
  return {
    id, name, section, status: "active" as const, revision: 1, resource_revision: 1,
    project_path: `/tmp/${id}`, project_path_status: "configured" as const, workspace_count: 1,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    schema_version: 2, workspace_bindings: [],
  }
}
function projectChat(id: string, projectId: string, extra: Partial<ChatItem> = {}) {
  return chat(id, 5, { config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, projectId }, ...extra })
}
function drop(target: Element, payload: unknown) {
  const event = new Event("drop", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: { getData: (type: string) => type === SIDEBAR_SESSION_DRAG_TYPE ? JSON.stringify(payload) : "" } })
  act(() => target.dispatchEvent(event))
}

describe("Sidebar device sections", () => {
  function setup() {
    useAppStore.setState({ projects: { p1: project("p1", "Zenith", "Development"), p2: project("p2", "Nova", "Development") } })
    let preferences = createProjectSection(readProjectSectionPreferences(), "p1", "lotus", "Development")
    preferences = createProjectSection(preferences, "p2", "lotus", "Development")
    writeProjectSectionPreferences(preferences)
    render({ chats: [projectChat("first", "p1"), projectChat("second", "p1"), projectChat("foreign", "p2"), projectChat("pinned", "p1", { pinned: true })] })
    click("项目")
  }

  it("moves a session by menu callback, persists explicit no section, and preserves pinned actions", () => {
    setup()
    const updateProject = vi.fn()
    useAppStore.setState({ updateProject })
    click("Move first to lotus")
    const localA = container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!
    expect(localA.contains(row("first"))).toBe(true)
    expect(localA.textContent).toContain("lotus1 个会话")
    expect(container.querySelector('[data-section-project="p2"][data-project-section="lotus"]')!.textContent).toContain("lotus0 个会话")
    click("Unsection first")
    expect(container.querySelector('[data-section-project="p1"][data-section-id="none"]')!.contains(row("first"))).toBe(true)
    expect(getSessionSection(readProjectSectionPreferences(), "p1", "first", "Development")).toBeNull()
    click("Move pinned to lotus")
    expect(row("pinned")).not.toBeNull()
    click("Pin pinned")
    expect(props.onTogglePin).toHaveBeenCalledWith(props.chats[3])
    expect(useAppStore.getState().projects.p1.section).toBe("Development")
    expect(updateProject).not.toHaveBeenCalled()
  })

  it("accepts same-project drops into empty sections and rejects foreign, forged, missing or child sessions", () => {
    setup()
    const target = container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!
    expect(target.textContent).toContain("拖动会话到这里")
    const original = localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)
    drop(target, { projectId: "p2", sessionId: "foreign" })
    drop(target, { projectId: "p1", sessionId: "foreign" })
    drop(target, { projectId: "p1", sessionId: "missing" })
    render({ chats: [...props.chats, projectChat("child", "p1", { parentSessionId: "first" })] })
    drop(target, { projectId: "p1", sessionId: "child" })
    expect(localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY)).toBe(original)
    drop(target, { projectId: "p1", sessionId: "first" })
    expect(target.contains(row("first"))).toBe(true)
    expect(props.chats[0].config.projectId).toBe("p1")
  })

  it("reveals an active session's section, restores folds after search, and opens a new target when moved", () => {
    setup()
    const target = container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!
    const unsectioned = container.querySelector('[data-section-project="p1"][data-section-id="none"]')!
    act(() => target.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
    act(() => unsectioned.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
    expect(row("first")).toBeNull()
    search("first")
    expect(row("first")).not.toBeNull()
    search("")
    expect(row("first")).toBeNull()
    render({ currentSessionId: "first" })
    expect(row("first")?.getAttribute("data-active")).toBe("true")
    click("Move first to lotus")
    const revealed = container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!
    expect(revealed.querySelector("button")?.getAttribute("aria-expanded")).toBe("true")
    expect(revealed.contains(row("first"))).toBe(true)
  })

  it("keeps device moves usable when storage writes are blocked", () => {
    setup()
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
    click("Move first to lotus")
    expect(container.querySelector('[data-section-project="p1"][data-project-section="lotus"]')!.contains(row("first"))).toBe(true)
    click("Unsection first")
    expect(container.querySelector('[data-section-project="p1"][data-section-id="none"]')!.contains(row("first"))).toBe(true)
  })

  it("creates empty sections and preserves only explicit assignments through StrictMode and reload", async () => {
    vi.useRealTimers()
    useAppStore.setState({ projects: { p1: project("p1", "Zenith", "lotus") } })
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
    const persisted = getProjectSections(readProjectSectionPreferences(), "p1", "lotus").find((candidate) => candidate.name === "Research")!
    expect(section.getAttribute("data-section-id")).toBe(persisted.id)
    expect(getProjectSections(readProjectSectionPreferences(), "p1", "lotus")).toHaveLength(2)
    expect(getSessionSection(readProjectSectionPreferences(), "p1", "first", "lotus")).toBeNull()
    expect(getSessionSection(readProjectSectionPreferences(), "p1", "untouched", "lotus")).toBeNull()

    click("Move first to Research")
    expect(section.contains(row("first"))).toBe(true)
    expect(getSessionSection(readProjectSectionPreferences(), "p1", "first", "lotus")).toBe(persisted.id)
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
    expect(getSessionSection(readProjectSectionPreferences(), "p1", "new-session", "lotus")).toBeNull()
    expect(container.querySelector('[data-project-section="lotus"]')!.textContent).toContain("lotus0 个会话")
  })
})
