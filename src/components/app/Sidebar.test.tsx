import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatItem } from "@shared/types/chatMessages"

vi.mock("@/components/chat/SessionRow", () => ({
  SessionRow: ({ chat, active, onSelect, onRename, onDelete, onTogglePin }: {
    chat: ChatItem; active: boolean; onSelect(): void; onRename(title: string): void
    onDelete(): void; onTogglePin(): void
  }) => (
    <div data-session={chat.id} data-active={active}>
      <button onClick={onSelect}>{chat.title}</button>
      <button onClick={() => onRename("Renamed")}>Rename {chat.id}</button>
      <button onClick={onDelete}>Delete {chat.id}</button>
      <button onClick={onTogglePin}>Pin {chat.id}</button>
    </div>
  ),
}))

import { Sidebar } from "./Sidebar"
import { useAppStore } from "@shared/store/appStore"
import { PINNED_PROJECTS_STORAGE_KEY } from "@/lib/projectSidebarPreferences"

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
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-05T15:00:00"))
  container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
  props = {
    open: false, onClose: vi.fn(), collapsed: false, onToggleCollapse: vi.fn(), width: 288,
    chats: Array.from({ length: 7 }, (_, index) => chat(`day-${index}`, 5 - index)),
    booted: true, currentSessionId: "day-0", onNewChat: vi.fn(), onSelect: vi.fn(),
    onRename: vi.fn(), onDelete: vi.fn(), onTogglePin: vi.fn(), onOpenSettings: vi.fn(),
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
    expect(props.onSelect).toHaveBeenCalledWith("day-0")
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(props.onRename).toHaveBeenCalledWith("day-0", "Renamed")
    expect(props.onDelete).toHaveBeenCalledWith(props.chats[0])
    expect(props.onTogglePin).toHaveBeenCalledWith(props.chats[0])
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

  it("shows empty Projects and exposes a Codex-style project details affordance", () => {
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
    const details = buttonByLabel("查看 Empty project 项目详情")
    act(() => details.click())
    expect(document.body.textContent).toContain("/tmp/empty")
    expect(document.body.textContent).toContain("0 个会话")
  })
})
