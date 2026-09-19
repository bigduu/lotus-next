import { isSessionUnread, useSessionReadState } from "@/lib/sessionReadState"
import { useId, useMemo, useState } from "react"
import { ChevronRight, Plus, Search, X, Cog, PanelLeftClose, FolderClosed, CalendarDays } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SessionRow } from "@/components/chat/SessionRow"
import { groupChats, groupChatsByProject, type ChatGroup } from "@/lib/groupChats"
import { useAppStore } from "@shared/store/appStore"
import { cn } from "@/lib/utils"
import type { ChatItem } from "@shared/types/chatMessages"

export type SidebarGroupingMode = "date" | "project"

const GROUPING_MODE_STORAGE_KEY = "lotus.sidebar.grouping-mode.v1"

/** Read the persisted grouping mode; falls back to "date" for legacy users. */
const readGroupingMode = (): SidebarGroupingMode => {
  try {
    if (typeof localStorage === "undefined") return "date"
    const raw = localStorage.getItem(GROUPING_MODE_STORAGE_KEY)
    return raw === "project" ? "project" : "date"
  } catch {
    return "date"
  }
}

export function Sidebar({
  open,
  onClose,
  collapsed,
  onToggleCollapse,
  width,
  chats,
  booted,
  currentSessionId,
  onNewChat,
  onSelect,
  onRename,
  onDelete,
  onTogglePin,
  onOpenSettings,
  onOpenProjectManager,
}: {
  open: boolean
  onClose: () => void
  /** Desktop: when true the persistent rail is hidden (mobile drawer unaffected). */
  collapsed: boolean
  onToggleCollapse: () => void
  /** Desktop rail width in px (resizable); mobile drawer keeps its own width. */
  width: number
  chats: ChatItem[]
  booted: boolean
  currentSessionId: string | null | undefined
  onNewChat: (projectId?: string | null) => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (chat: ChatItem) => void
  onTogglePin: (chat: ChatItem) => void
  onOpenSettings: () => void
  onOpenProjectManager: () => void
}) {
  const [search, setSearch] = useState("")
  const [groupingMode, setGroupingMode] = useState<SidebarGroupingMode>(readGroupingMode)
  const projects = useAppStore((state) => state.projects)
  const readState = useSessionReadState()
  const disclosureId = useId()
  const query = search.trim().toLowerCase()

  const switchGroupingMode = (mode: SidebarGroupingMode) => {
    setGroupingMode(mode)
    try {
      localStorage.setItem(GROUPING_MODE_STORAGE_KEY, mode)
    } catch {
      // Best-effort preference only.
    }
  }

  const groups = useMemo(() => {
    // Only root sessions in the sidebar — child sub-agent sessions live in the
    // inspector's sub-agents panel, not as top-level chats.
    const filtered = chats.filter((c) => !c.parentSessionId)
    if (groupingMode === "project") {
      return groupChatsByProject(filtered, (projectId) => {
        if (!projectId) return "未分配"
        const project = projects[projectId]
        if (!project) return "未知项目"
        return project.status === "archived" ? `${project.name} · 已归档` : project.name
      })
    }
    return groupChats(filtered, new Date())
  }, [chats, groupingMode, projects])

  const isProjectMode = groupingMode === "project"
  // Project groups are few and stable — the "older" fold is a date-mode concept.
  const dateGroups = isProjectMode ? [] : groups.filter((group) => group.key !== "__pinned")
  const olderGroups = dateGroups.slice(5)
  const activeGroup = groups.find((group) => group.chats.some((c) => c.id === currentSessionId))
  const activeIsOlder = olderGroups.some((group) => group.key === activeGroup?.key)
  const activePath = JSON.stringify([currentSessionId ?? null, activeGroup?.key, activeIsOlder])
  const [disclosures, setDisclosures] = useState(() => ({
    activePath,
    olderExpanded: activeIsOlder,
    closedDates: new Set<string>(),
  }))

  // Reveal a newly selected session (including one loaded after navigation).
  // Adjust during render so its row is visible immediately, then leave explicit
  // user folds alone until the active session or its enclosing date changes.
  if (disclosures.activePath !== activePath) {
    const closedDates = new Set(disclosures.closedDates)
    if (activeGroup) closedDates.delete(activeGroup.key)
    setDisclosures({
      activePath,
      olderExpanded: disclosures.olderExpanded || activeIsOlder,
      closedDates,
    })
  }

  const visibleGroups = query
    ? groups.map((group) => ({
        ...group,
        chats: group.chats.filter((c) => (c.title || "").toLowerCase().includes(query)),
      })).filter((group) => group.chats.length > 0)
    : isProjectMode
      ? groups
      : groups.filter((group) => group.key === "__pinned" || !olderGroups.includes(group))
  const olderCount = olderGroups.reduce((count, group) => count + group.chats.length, 0)

  const renderGroup = (group: ChatGroup) => {
    const pinned = group.key === "__pinned"
    const expanded = pinned || !!query || !disclosures.closedDates.has(group.key)
    const contentId = `${disclosureId}-${group.key}`
    return (
      <div key={group.key} className="mb-1">
        {pinned ? (
          <div className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">
            {group.label}
          </div>
        ) : (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={contentId}
            disabled={!!query}
            className="flex w-full items-center gap-1 rounded-md px-2 pt-3 pb-1 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            onClick={() => setDisclosures((previous) => {
              const closedDates = new Set(previous.closedDates)
              if (closedDates.has(group.key)) closedDates.delete(group.key)
              else closedDates.add(group.key)
              return { ...previous, closedDates }
            })}
          >
            <ChevronRight aria-hidden="true" className={cn("size-3 shrink-0", expanded && "rotate-90")} />
            <span>{group.label}</span>
            <span className="ml-auto whitespace-nowrap pl-2 font-normal">{group.chats.length} 个会话</span>
          </button>
        )}
        <div id={contentId} hidden={!expanded}>
          {expanded ? group.chats.map((c) => (
            <SessionRow
              key={c.id}
              chat={c}
              active={c.id === currentSessionId}
              unread={c.id !== currentSessionId && isSessionUnread(c, readState)}
              onSelect={() => {
                onSelect(c.id)
                onClose()
              }}
              onRename={(title) => onRename(c.id, title)}
              onDelete={() => onDelete(c)}
              onTogglePin={() => onTogglePin(c)}
            />
          )) : null}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Backdrop (mobile) */}
      {open && (
        <button
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-label="Close menu"
          onClick={onClose}
        />
      )}

      <aside
        style={{ ["--sidebar-w" as string]: `${width}px` }}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[84%] max-w-xs flex-col border-r bg-sidebar text-sidebar-foreground transition-transform md:static md:w-[var(--sidebar-w)] md:max-w-none md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
          collapsed && "md:hidden",
        )}
      >
        <div className="flex items-center gap-2 px-3 py-3">
          <span className="flex-1 text-sm font-semibold">会话</span>
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              "size-8 text-muted-foreground",
              groupingMode === "project" ? "bg-sidebar-accent text-foreground" : "",
            )}
            aria-label={groupingMode === "project" ? "按项目分组" : "按日期分组"}
            title={groupingMode === "project" ? "切换为日期分组" : "切换为项目分组"}
            onClick={() => switchGroupingMode(groupingMode === "project" ? "date" : "project")}
          >
            {groupingMode === "project" ? (
              <FolderClosed className="size-4" />
            ) : (
              <CalendarDays className="size-4" />
            )}
          </Button>
          {isProjectMode ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-8 text-muted-foreground"
              aria-label="管理项目"
              title="管理项目"
              onClick={() => {
                onOpenProjectManager()
                onClose()
              }}
            >
              <Cog className="size-4" />
            </Button>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            className="hidden size-8 text-muted-foreground md:inline-flex"
            aria-label="收起侧栏"
            onClick={onToggleCollapse}
          >
            <PanelLeftClose className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onNewChat(isProjectMode ? activeGroup?.key && activeGroup.key !== "__pinned" && activeGroup.key !== "__no_project__" ? activeGroup.key : null : null)
              onClose()
            }}
          >
            <Plus /> 新建
          </Button>
        </div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索会话"
              className="py-1.5 pl-8 pr-7"
            />
            {search ? (
              <button
                onClick={() => setSearch("")}
                aria-label="清除"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {chats.length === 0 && (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              {booted ? "暂无会话" : "加载中…"}
            </p>
          )}
          {visibleGroups.map(renderGroup)}
          {!query && olderGroups.length > 0 ? (
            <div className="mb-1">
              <button
                type="button"
                aria-expanded={disclosures.olderExpanded}
                aria-controls={`${disclosureId}-older`}
                className="mt-2 flex w-full items-center gap-1 rounded-md px-2 py-2 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setDisclosures((previous) => ({
                  ...previous,
                  olderExpanded: !previous.olderExpanded,
                }))}
              >
                <ChevronRight aria-hidden="true" className={cn("size-3 shrink-0", disclosures.olderExpanded && "rotate-90")} />
                <span>更早</span>
                <span className="ml-auto whitespace-nowrap pl-2 font-normal">{olderGroups.length} 天 · {olderCount} 个会话</span>
              </button>
              <div id={`${disclosureId}-older`} hidden={!disclosures.olderExpanded}>
                {disclosures.olderExpanded ? olderGroups.map(renderGroup) : null}
              </div>
            </div>
          ) : null}
        </div>
        <div className="border-t p-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={() => {
              onOpenSettings()
              onClose()
            }}
          >
            <Cog className="size-4" /> 系统设置
          </Button>
        </div>
      </aside>
    </>
  )
}
