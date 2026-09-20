import { isSessionUnread, useSessionReadState } from "@/lib/sessionReadState"
import { useId, useMemo, useState } from "react"
import { ChevronRight, Plus, Search, X, Cog, PanelLeftClose, FolderClosed, CalendarDays, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SessionRow } from "@/components/chat/SessionRow"
import { ProjectArchiveDialog } from "@/components/app/ProjectArchiveDialog"
import { ProjectEditDialog } from "@/components/app/ProjectEditDialog"
import { ProjectGroupHeader } from "@/components/app/ProjectGroupHeader"
import { groupChats, groupChatsByProject, type ChatGroup } from "@/lib/groupChats"
import { readPinnedProjectIds, writePinnedProjectIds } from "@/lib/projectSidebarPreferences"
import { useAppStore } from "@shared/store/appStore"
import { openLocalFolder } from "@shared/utils/openExternalLink"
import { cn } from "@/lib/utils"
import type { ChatItem } from "@shared/types/chatMessages"

export type SidebarGroupingMode = "date" | "project"

const GROUPING_MODE_STORAGE_KEY = "lotus.sidebar.grouping-mode.v1"

/** Max sessions rendered per project group before the rest folds away. */
const PROJECT_GROUP_PREVIEW_COUNT = 7

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
  const [pinnedProjectIds, setPinnedProjectIds] = useState(readPinnedProjectIds)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [pendingArchiveProjectId, setPendingArchiveProjectId] = useState<string | null>(null)
  const [projectActionBusy, setProjectActionBusy] = useState(false)
  const [projectActionError, setProjectActionError] = useState<string | null>(null)
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

  const rootChats = useMemo(() => chats.filter((chat) => !chat.parentSessionId), [chats])
  const projectSessionCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const chat of rootChats) {
      const key = chat.config?.projectId?.trim() || "__no_project__"
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [rootChats])

  const groups = useMemo(() => {
    // Only root sessions in the sidebar — child sub-agent sessions live in the
    // inspector's sub-agents panel, not as top-level chats.
    if (groupingMode === "project") {
      const grouped = groupChatsByProject(rootChats, (projectId) => {
        if (!projectId) return "未分配"
        const project = projects[projectId]
        if (!project) return "未知项目"
        return project.status === "archived" ? `${project.name} · 已归档` : project.name
      })
      const pinnedSessions = grouped.find((group) => group.key === "__pinned")
      const projectGroups = grouped.filter((group) => group.key !== "__pinned")
      const seen = new Set(projectGroups.map((group) => group.key))
      for (const project of Object.values(projects)) {
        if (project.status !== "active" || seen.has(project.id)) continue
        projectGroups.push({ key: project.id, label: project.name, chats: [] })
      }
      // Keep the established session-recency order within each tier. Pinning a
      // Project only changes sidebar presentation; Project identity/data stay
      // authoritative in Bamboo.
      projectGroups.sort((left, right) => {
        const leftPinned = pinnedProjectIds.has(left.key)
        const rightPinned = pinnedProjectIds.has(right.key)
        return leftPinned === rightPinned ? 0 : leftPinned ? -1 : 1
      })
      return pinnedSessions ? [pinnedSessions, ...projectGroups] : projectGroups
    }
    return groupChats(rootChats, new Date())
  }, [groupingMode, pinnedProjectIds, projects, rootChats])

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
    // Reveal the active session even when it sits beyond the preview fold.
    expandedProjectGroups: new Set(
      isProjectMode && activeGroup && activeGroup.chats.findIndex((c) => c.id === currentSessionId) >= PROJECT_GROUP_PREVIEW_COUNT
        ? [activeGroup.key]
        : [],
    ),
  }))

  // Reveal a newly selected session (including one loaded after navigation).
  // Adjust during render so its row is visible immediately, then leave explicit
  // user folds alone until the active session or its enclosing date changes.
  if (disclosures.activePath !== activePath) {
    const closedDates = new Set(disclosures.closedDates)
    if (activeGroup) closedDates.delete(activeGroup.key)
    // A session in a project group beyond the preview fold must be revealed.
    const expandedProjectGroups = new Set(disclosures.expandedProjectGroups)
    if (activeGroup && activeGroup.chats.findIndex((c) => c.id === currentSessionId) >= PROJECT_GROUP_PREVIEW_COUNT) {
      expandedProjectGroups.add(activeGroup.key)
    }
    setDisclosures({
      activePath,
      olderExpanded: disclosures.olderExpanded || activeIsOlder,
      closedDates,
      expandedProjectGroups,
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
  const pendingArchiveProject = pendingArchiveProjectId
    ? projects[pendingArchiveProjectId]
    : undefined

  const toggleProjectPin = (projectId: string) => {
    setPinnedProjectIds((previous) => {
      const next = new Set(previous)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      writePinnedProjectIds(next)
      return next
    })
  }

  const restoreProject = async (projectId: string) => {
    const project = useAppStore.getState().projects[projectId]
    if (!project || projectActionBusy) return
    setProjectActionBusy(true)
    setProjectActionError(null)
    try {
      await useAppStore.getState().unarchiveProject(project.id, project.revision)
    } catch (error) {
      setProjectActionError(error instanceof Error ? error.message : "恢复项目失败")
    } finally {
      setProjectActionBusy(false)
    }
  }

  const renderGroup = (group: ChatGroup) => {
    const pinned = group.key === "__pinned"
    const expanded = pinned || !!query || !disclosures.closedDates.has(group.key)
    const contentId = `${disclosureId}-${group.key}`
    // Project groups cap their visible rows; date groups and search show all.
    const projectFold = isProjectMode && !query && !pinned && group.chats.length > PROJECT_GROUP_PREVIEW_COUNT
    const projectExpanded = projectFold && disclosures.expandedProjectGroups.has(group.key)
    const shownChats = projectFold && !projectExpanded
      ? group.chats.slice(0, PROJECT_GROUP_PREVIEW_COUNT)
      : group.chats
    const project = isProjectMode ? projects[group.key] : undefined
    const toggleExpanded = () => setDisclosures((previous) => {
      const closedDates = new Set(previous.closedDates)
      if (closedDates.has(group.key)) closedDates.delete(group.key)
      else closedDates.add(group.key)
      return { ...previous, closedDates }
    })
    return (
      <div key={group.key} className="mb-1">
        {pinned ? (
          <div className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">
            {group.label}
          </div>
        ) : project ? (
          <ProjectGroupHeader
            project={project}
            label={group.label}
            sessionCount={projectSessionCounts.get(group.key) ?? group.chats.length}
            expanded={expanded}
            contentId={contentId}
            disabled={!!query}
            pinned={pinnedProjectIds.has(project.id)}
            onToggleExpanded={toggleExpanded}
            onNewChat={() => {
              onNewChat(project.id)
              onClose()
            }}
            onEdit={() => {
              setProjectActionError(null)
              setEditingProjectId(project.id)
            }}
            onTogglePin={() => toggleProjectPin(project.id)}
            onReveal={() => {
              setProjectActionError(null)
              void openLocalFolder(project.project_path ?? "").catch((error) => {
                setProjectActionError(error instanceof Error ? error.message : "无法打开项目目录")
              })
            }}
            onArchive={() => {
              if (project.status === "archived") void restoreProject(project.id)
              else {
                setProjectActionError(null)
                setPendingArchiveProjectId(project.id)
              }
            }}
          />
        ) : (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={contentId}
            disabled={!!query}
            className="flex w-full items-center gap-1 rounded-md px-2 pt-3 pb-1 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            onClick={toggleExpanded}
          >
            <ChevronRight aria-hidden="true" className={cn("size-3 shrink-0", expanded && "rotate-90")} />
            <span>{group.label}</span>
            <span className="ml-auto whitespace-nowrap pl-2 font-normal">{group.chats.length} 个会话</span>
          </button>
        )}
        <div id={contentId} hidden={!expanded}>
          {expanded ? shownChats.map((c) => (
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
          {projectFold ? (
            <button
              type="button"
              className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setDisclosures((previous) => {
                const expandedProjectGroups = new Set(previous.expandedProjectGroups)
                if (expandedProjectGroups.has(group.key)) expandedProjectGroups.delete(group.key)
                else expandedProjectGroups.add(group.key)
                return { ...previous, expandedProjectGroups }
              })}
            >
              {projectExpanded ? (
                <>
                  <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
                  <span>收起</span>
                </>
              ) : (
                <>
                  <ChevronRight aria-hidden="true" className="size-3 shrink-0" />
                  <span>展开 {group.chats.length - PROJECT_GROUP_PREVIEW_COUNT} 个</span>
                </>
              )}
            </button>
          ) : null}
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
          <span className="flex-1 text-sm font-semibold">Bodhi</span>
          <Button
            size="icon"
            variant="ghost"
            className="hidden size-8 text-muted-foreground md:inline-flex"
            aria-label="收起侧栏"
            onClick={onToggleCollapse}
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
        <div className="px-2 pb-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={() => {
              onNewChat(isProjectMode ? activeGroup?.key && activeGroup.key !== "__pinned" && activeGroup.key !== "__no_project__" ? activeGroup.key : null : null)
              onClose()
            }}
          >
            <Plus className="size-4" /> 新建会话
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={() => {
              onOpenProjectManager()
              onClose()
            }}
          >
            <FolderClosed className="size-4" /> 管理项目
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
        <div className="flex items-center gap-2 px-3">
          <span className="flex-1 text-xs font-medium text-muted-foreground">
            {isProjectMode ? "项目" : "最近"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-label={isProjectMode ? "切换为最近视图" : "切换为项目视图"}
            onClick={() => switchGroupingMode(isProjectMode ? "date" : "project")}
          >
            {isProjectMode ? (
              <CalendarDays className="size-4" />
            ) : (
              <FolderClosed className="size-4" />
            )}
            {isProjectMode ? "最近" : "项目"}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {projectActionError ? (
            <button
              type="button"
              className="mb-2 w-full rounded-md bg-destructive/10 px-2 py-1.5 text-left text-xs text-destructive"
              onClick={() => setProjectActionError(null)}
            >
              {projectActionError}
            </button>
          ) : null}
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

      <ProjectEditDialog projectId={editingProjectId} onClose={() => setEditingProjectId(null)} />

      <ProjectArchiveDialog
        projectName={pendingArchiveProject?.name ?? null}
        busy={projectActionBusy}
        error={pendingArchiveProject ? projectActionError : null}
        onClose={() => {
          if (!projectActionBusy) {
            setPendingArchiveProjectId(null)
            setProjectActionError(null)
          }
        }}
        onConfirm={() => {
          if (!pendingArchiveProject || projectActionBusy) return
          setProjectActionBusy(true)
          setProjectActionError(null)
          void useAppStore.getState().archiveProject(
            pendingArchiveProject.id,
            pendingArchiveProject.revision,
          ).then(() => {
            setPendingArchiveProjectId(null)
          }).catch((error) => {
            setProjectActionError(error instanceof Error ? error.message : "移除项目失败")
          }).finally(() => {
            setProjectActionBusy(false)
          })
        }}
      />
    </>
  )
}
