import { useUiText } from "@shared/i18n/ui"
import { isSessionUnread, useSessionReadState } from "@/lib/sessionReadState"
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react"
import { ChevronRight, Plus, Search, X, Cog, PanelLeftClose, FolderClosed, CalendarDays, ChevronDown, CircleDot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BrandMark } from "@/components/ui/brand-mark"
import { Input } from "@/components/ui/input"
import { SessionRow } from "@/components/chat/SessionRow"
import { ProjectArchiveDialog } from "@/components/app/ProjectArchiveDialog"
import { ProjectEditDialog } from "@/components/app/ProjectEditDialog"
import { ProjectGroupHeader } from "@/components/app/ProjectGroupHeader"
import { ProjectSectionDialog } from "@/components/app/ProjectSectionDialog"
import { groupChats, groupChatsByProject, type ChatGroup } from "@/lib/groupChats"
import {
  readPinnedProjectIds, writePinnedProjectIds, readProjectSectionPreferences, writeProjectSectionPreferences,
  getProjectSections, getSessionSection, createProjectSection, removeProjectSection, setSessionSection,
  SIDEBAR_SESSION_DRAG_TYPE, type ProjectSectionPreferences,
} from "@/lib/projectSidebarPreferences"
import { useAppStore } from "@shared/store/appStore"
import { openLocalFolder } from "@shared/utils/openExternalLink"
import { cn } from "@/lib/utils"
import { DEFAULT_SUPERVISOR_SESSION_ID, isDefaultSupervisor } from "@/lib/supervisor"
import { getErrorMessage } from "@services/api/errors"
import type { ChatItem } from "@shared/types/chatMessages"

export type SidebarGroupingMode = "date" | "project"

const GROUPING_MODE_STORAGE_KEY = "lotus.sidebar.grouping-mode.v1"

/** Max sessions rendered per project group before the rest folds away. */
const PROJECT_GROUP_PREVIEW_COUNT = 7
const sectionDisclosureKey = (projectId: string, sectionId: string | null) => JSON.stringify([projectId, sectionId])

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
  onCopySessionId,
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
  onSelect: (id: string) => void | Promise<void>
  onRename: (id: string, title: string) => void
  onDelete: (chat: ChatItem) => void
  onTogglePin: (chat: ChatItem) => void
  onCopySessionId: (sessionId: string) => void
  onOpenSettings: () => void
  onOpenProjectManager: () => void
}) {
  const uiText = useUiText()
  const [search, setSearch] = useState("")
  const [groupingMode, setGroupingMode] = useState<SidebarGroupingMode>(readGroupingMode)
  const [pinnedProjectIds, setPinnedProjectIds] = useState(readPinnedProjectIds)
  const [sectionPreferences, setSectionPreferences] = useState(readProjectSectionPreferences)
  const persistedSections = useRef(sectionPreferences)
  const [sectionDialogMode, setSectionDialogMode] = useState<"create" | "manage">("create")
  const [dragOverSection, setDragOverSection] = useState<string | null>(null)
  const draggingProjectId = useRef<string | null>(null)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [sectioningProjectId, setSectioningProjectId] = useState<string | null>(null)
  const [pendingArchiveProjectId, setPendingArchiveProjectId] = useState<string | null>(null)
  const [projectActionBusy, setProjectActionBusy] = useState(false)
  const [projectActionError, setProjectActionError] = useState<string | null>(null)
  const projects = useAppStore((state) => state.projects)
  const readState = useSessionReadState()
  const disclosureId = useId()
  const supervisorStatusId = useId()
  const supervisorOpening = useRef(false)
  const [supervisorBusy, setSupervisorBusy] = useState(false)
  const [supervisorError, setSupervisorError] = useState<string | null>(null)
  const openSupervisor = async () => {
    if (supervisorOpening.current) return
    supervisorOpening.current = true
    setSupervisorBusy(true)
    setSupervisorError(null)
    try {
      await onSelect(DEFAULT_SUPERVISOR_SESSION_ID)
      onClose()
    } catch (error) {
      setSupervisorError(getErrorMessage(error))
    } finally {
      supervisorOpening.current = false
      setSupervisorBusy(false)
    }
  }
  const query = search.trim().toLowerCase()

  useEffect(() => {
    if (persistedSections.current === sectionPreferences) return
    writeProjectSectionPreferences(sectionPreferences)
    persistedSections.current = sectionPreferences
  }, [sectionPreferences])

  const switchGroupingMode = (mode: SidebarGroupingMode) => {
    setGroupingMode(mode)
    try {
      localStorage.setItem(GROUPING_MODE_STORAGE_KEY, mode)
    } catch {
      // Best-effort preference only.
    }
  }

  const supervisor = chats.find(isDefaultSupervisor)
  const supervisorActive = currentSessionId === DEFAULT_SUPERVISOR_SESSION_ID
  const supervisorUnread = !!supervisor && isSessionUnread(supervisor, readState)
  const rootChats = useMemo(() => chats.filter((chat) => !chat.parentSessionId && !isDefaultSupervisor(chat)), [chats])
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
        if (!projectId) return uiText("unassigned_52496e5a")
        const project = projects[projectId]
        if (!project) return uiText("unknown_project_9714067d")
        return project.status === "archived" ? uiText("archived_01a84e81", { v0: project.name }) : project.name
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
  }, [groupingMode, pinnedProjectIds, projects, rootChats, uiText])

  const isProjectMode = groupingMode === "project"
  // Project groups are few and stable — the "older" fold is a date-mode concept.
  const dateGroups = isProjectMode ? [] : groups.filter((group) => group.key !== "__pinned")
  const olderGroups = dateGroups.slice(5)
  const activeGroup = groups.find((group) => group.chats.some((c) => c.id === currentSessionId))
  const activeProject = isProjectMode && activeGroup ? projects[activeGroup.key] : undefined
  const activeSectionId = activeProject && currentSessionId
    ? getSessionSection(sectionPreferences, activeProject.id, currentSessionId, activeProject.section) : null
  const activeSection = activeProject ? sectionDisclosureKey(activeProject.id, activeSectionId) : null
  const activePreviewKey = activeSection ?? activeGroup?.key
  const activeBucketChats = activeProject && activeGroup
    ? activeGroup.chats.filter((chat) => getSessionSection(sectionPreferences, activeProject.id, chat.id, activeProject.section) === activeSectionId)
    : activeGroup?.chats ?? []
  const activeIsOlder = olderGroups.some((group) => group.key === activeGroup?.key)
  const activePath = JSON.stringify([currentSessionId ?? null, activeGroup?.key, activeSection, activeIsOlder])
  const [disclosures, setDisclosures] = useState(() => ({
    activePath,
    olderExpanded: activeIsOlder,
    closedDates: new Set<string>(),
    closedSections: new Set<string>(),
    // Reveal the active session even when it sits beyond the preview fold.
    expandedProjectGroups: new Set(
      isProjectMode && activePreviewKey && activeBucketChats.findIndex((c) => c.id === currentSessionId) >= PROJECT_GROUP_PREVIEW_COUNT
        ? [activePreviewKey]
        : [],
    ),
  }))

  // Reveal a newly selected session (including one loaded after navigation).
  // Adjust during render so its row is visible immediately, then leave explicit
  // user folds alone until the active session or its enclosing date changes.
  if (disclosures.activePath !== activePath) {
    const closedDates = new Set(disclosures.closedDates)
    if (activeGroup) closedDates.delete(activeGroup.key)
    const closedSections = new Set(disclosures.closedSections)
    if (activeSection) closedSections.delete(activeSection)
    // A session in a project group beyond the preview fold must be revealed.
    const expandedProjectGroups = new Set(disclosures.expandedProjectGroups)
    if (activePreviewKey && activeBucketChats.findIndex((c) => c.id === currentSessionId) >= PROJECT_GROUP_PREVIEW_COUNT) {
      expandedProjectGroups.add(activePreviewKey)
    }
    setDisclosures({
      activePath,
      olderExpanded: disclosures.olderExpanded || activeIsOlder,
      closedDates,
      closedSections,
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
      setProjectActionError(error instanceof Error ? error.message : uiText("could_not_restore_project_4f2a985d"))
    } finally {
      setProjectActionBusy(false)
    }
  }

  const updateSectionPreferences = (update: (previous: ProjectSectionPreferences) => ProjectSectionPreferences) => {
    setSectionPreferences(update)
  }

  const moveSessionToSection = (projectId: string, sessionId: string, sectionId: string | null) => {
    const chat = rootChats.find((candidate) => candidate.id === sessionId)
    // Canonical project identity is read from the session, never from the drag payload.
    if (chat?.config?.projectId?.trim() !== projectId || !projects[projectId]) return
    updateSectionPreferences((previous) => setSessionSection(previous, projectId, sessionId, sectionId, projects[projectId]?.section))
  }

  const readDraggedSession = (event: DragEvent<HTMLElement>): { projectId: string; sessionId: string } | null => {
    try {
      const payload: unknown = JSON.parse(event.dataTransfer.getData(SIDEBAR_SESSION_DRAG_TYPE))
      if (!payload || typeof payload !== "object" || !("projectId" in payload) || !("sessionId" in payload)) return null
      if (typeof payload.projectId !== "string" || typeof payload.sessionId !== "string") return null
      return { projectId: payload.projectId, sessionId: payload.sessionId }
    } catch { return null }
  }

  const renderSession = (chat: ChatItem) => {
    const projectId = chat.config?.projectId?.trim()
    const project = projectId ? projects[projectId] : undefined
    return <SessionRow
      key={chat.id} chat={chat} active={chat.id === currentSessionId}
      unread={chat.id !== currentSessionId && isSessionUnread(chat, readState)}
      projectId={project?.id}
      sections={project ? getProjectSections(sectionPreferences, project.id, project.section) : undefined}
      sectionId={project ? getSessionSection(sectionPreferences, project.id, chat.id, project.section) : undefined}
      onMoveToSection={project ? (sectionId) => moveSessionToSection(project.id, chat.id, sectionId) : undefined}
      onSelect={() => { onSelect(chat.id); onClose() }}
      onRename={(title) => onRename(chat.id, title)} onDelete={() => onDelete(chat)}
      onTogglePin={() => onTogglePin(chat)} onCopySessionId={() => onCopySessionId(chat.id)}
    />
  }

  const renderSessionBucket = (bucket: ChatGroup, expanded: boolean, previewKey: string) => {
    const fold = isProjectMode && !query && bucket.key !== "__pinned" && bucket.chats.length > PROJECT_GROUP_PREVIEW_COUNT
    const showAll = disclosures.expandedProjectGroups.has(previewKey)
    const shown = fold && !showAll ? bucket.chats.slice(0, PROJECT_GROUP_PREVIEW_COUNT) : bucket.chats
    return <>
      {expanded ? shown.map(renderSession) : null}
      {expanded && fold ? (
        <button type="button" className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setDisclosures((previous) => {
            const expandedProjectGroups = new Set(previous.expandedProjectGroups)
            if (expandedProjectGroups.has(previewKey)) expandedProjectGroups.delete(previewKey)
            else expandedProjectGroups.add(previewKey)
            return { ...previous, expandedProjectGroups }
          })}>
          {showAll ? <ChevronDown aria-hidden="true" className="size-3 shrink-0" /> : <ChevronRight aria-hidden="true" className="size-3 shrink-0" />}
          <span>{showAll ? uiText("collapse_afd4b783") : `${uiText("expand_00bd3960")} ${uiText("count_items", { count: bucket.chats.length - PROJECT_GROUP_PREVIEW_COUNT })}`}</span>
        </button>
      ) : null}
    </>
  }

  const renderProjectSections = (group: ChatGroup) => {
    const project = projects[group.key]!
    const sections = getProjectSections(sectionPreferences, project.id, project.section)
    if (!sections.length) return renderSessionBucket(group, true, sectionDisclosureKey(project.id, null))
    const targets = [...sections, { id: null, name: uiText("sidebar_no_section") }]
    return targets.map((section) => {
      const key = sectionDisclosureKey(project.id, section.id)
      const bucket = { ...group, chats: group.chats.filter((chat) => getSessionSection(sectionPreferences, project.id, chat.id, project.section) === section.id) }
      if (query && !bucket.chats.length) return null
      const expanded = !!query || !disclosures.closedSections.has(key)
      const contentId = `${disclosureId}-section-${encodeURIComponent(key)}`
      return <div key={key} data-project-section={section.name} data-section-id={section.id ?? "none"} data-section-project={project.id}
        style={{ marginInlineStart: 12 }} className={cn("mb-1 rounded-md", dragOverSection === key && "bg-sidebar-accent")}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(SIDEBAR_SESSION_DRAG_TYPE) || (draggingProjectId.current && draggingProjectId.current !== project.id)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = "move"
          setDragOverSection(key)
        }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverSection(null) }}
        onDrop={(event) => {
          event.preventDefault()
          setDragOverSection(null)
          draggingProjectId.current = null
          const payload = readDraggedSession(event)
          if (payload?.projectId === project.id) moveSessionToSection(project.id, payload.sessionId, section.id)
        }}>
        <button type="button" aria-expanded={expanded} aria-controls={contentId} disabled={!!query}
          className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
          onClick={() => setDisclosures((previous) => {
            const closedSections = new Set(previous.closedSections)
            if (closedSections.has(key)) closedSections.delete(key)
            else closedSections.add(key)
            return { ...previous, closedSections }
          })}>
          <ChevronRight aria-hidden="true" className={cn("size-3 shrink-0", expanded && "rotate-90")} />
          <span className="truncate">{section.name}</span>
          <span className="ml-auto whitespace-nowrap pl-2 font-normal">{uiText("project_sessions", { count: bucket.chats.length })}</span>
        </button>
        <div id={contentId} hidden={!expanded}>
          {renderSessionBucket(bucket, expanded, key)}
          {expanded && !bucket.chats.length ? <p className="px-2 py-2 text-xs text-muted-foreground">{uiText("sidebar_section_empty")}</p> : null}
        </div>
      </div>
    })
  }

  const renderGroup = (group: ChatGroup) => {
    const pinned = group.key === "__pinned"
    const expanded = pinned || !!query || !disclosures.closedDates.has(group.key)
    const contentId = `${disclosureId}-${group.key}`
    const project = isProjectMode ? projects[group.key] : undefined
    const toggleExpanded = () => setDisclosures((previous) => {
      const closedDates = new Set(previous.closedDates)
      if (closedDates.has(group.key)) closedDates.delete(group.key)
      else closedDates.add(group.key)
      return { ...previous, closedDates }
    })
    return (
      <div key={group.key} data-sidebar-project={project?.id} className="mb-1">
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
            onCreateSection={() => {
              setProjectActionError(null)
              setSectionDialogMode("create")
              setSectioningProjectId(project.id)
            }}
            onManageSections={() => {
              setSectionDialogMode("manage")
              setSectioningProjectId(project.id)
            }}
            onReveal={() => {
              setProjectActionError(null)
              void openLocalFolder(project.project_path ?? "").catch((error) => {
                setProjectActionError(error instanceof Error ? error.message : uiText("could_not_open_project_directory_b25cc8f5"))
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
            <span className="ml-auto whitespace-nowrap pl-2 font-normal">{uiText("project_sessions", { count: group.chats.length })}</span>
          </button>
        )}
        <div id={contentId} hidden={!expanded}>
          {project ? (expanded ? renderProjectSections(group) : null) : renderSessionBucket(group, expanded, group.key)}
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
        onDragStart={(event) => { draggingProjectId.current = readDraggedSession(event)?.projectId ?? null }}
        onDragEnd={() => { draggingProjectId.current = null; setDragOverSection(null) }}
        style={{
          ["--sidebar-w" as string]: `${width}px`,
          ["--text-xs" as string]: "13px",
          ["--text-sm" as string]: "15px",
          fontFamily: '-apple-system, "PingFang SC", sans-serif',
          color: "var(--sidebar-foreground)",
        }}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[84%] max-w-xs flex-col border-r bg-sidebar transition-transform md:static md:w-[var(--sidebar-w)] md:max-w-none md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
          collapsed && "md:hidden",
        )}
      >
        <div className="flex items-center gap-2 px-3 py-3">
          <BrandMark className="size-7" />
          <span className="flex-1 text-sm font-semibold">Bodhi</span>
          <Button
            size="icon"
            variant="ghost"
            className="hidden size-8 text-muted-foreground md:inline-flex"
            aria-label={uiText("collapse_sidebar_bb0b6e36")}
            onClick={onToggleCollapse}
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
        <div className="px-2 pb-2">
          <Button
            variant="ghost"
            aria-current={supervisorActive ? "page" : undefined}
            aria-describedby={supervisor?.isRunning || supervisorUnread ? supervisorStatusId : undefined}
            aria-busy={supervisorBusy || undefined}
            disabled={!booted || supervisorBusy}
            className={cn("mb-2 w-full justify-start gap-2", supervisorActive && "bg-sidebar-accent", supervisorUnread && "font-semibold")}
            onClick={() => void openSupervisor()}
          >
            <CircleDot className="size-4" aria-hidden="true" />
            <span className="flex-1 text-left">Supervisor</span>
            {supervisor?.isRunning || supervisorUnread ? (
              <span aria-hidden="true" className={cn("size-1.5 rounded-full bg-primary", supervisor?.isRunning && "animate-pulse")} />
            ) : null}
            <span id={supervisorStatusId} className="sr-only">
              {supervisor?.isRunning ? uiText("running_1f0eb99b") : supervisorUnread ? uiText("unread_messages_519491f4") : ""}
            </span>
          </Button>
          {supervisorError ? <p role="alert" className="px-2 pb-2 text-sm text-destructive">{supervisorError}</p> : null}
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={() => {
              onNewChat(isProjectMode ? activeGroup?.key && activeGroup.key !== "__pinned" && activeGroup.key !== "__no_project__" ? activeGroup.key : null : null)
              onClose()
            }}
          >
            <Plus className="size-4" />{uiText("new_session_58e21b87")}</Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={() => {
              onOpenProjectManager()
              onClose()
            }}
          >
            <FolderClosed className="size-4" />{uiText("manage_projects_302f96cf")}</Button>
        </div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={uiText("search_sessions_feb95554")}
              className="py-1.5 pl-8 pr-7"
            />
            {search ? (
              <button
                onClick={() => setSearch("")}
                aria-label={uiText("clear_bce23772")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 px-3">
          <span className="flex-1 text-xs font-medium text-muted-foreground">
            {isProjectMode ? uiText("project_79f326be") : uiText("recent_997a5e6e")}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-label={isProjectMode ? uiText("switch_to_recent_view_fce00dbe") : uiText("switch_to_project_view_43561b9a")}
            onClick={() => switchGroupingMode(isProjectMode ? "date" : "project")}
          >
            {isProjectMode ? (
              <CalendarDays className="size-4" />
            ) : (
              <FolderClosed className="size-4" />
            )}
            {isProjectMode ? uiText("recent_997a5e6e") : uiText("project_79f326be")}
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
          {rootChats.length === 0 && (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              {booted ? uiText("no_sessions_yet_69e71f03") : uiText("loading_4927a53b")}
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
                <span>{uiText("earlier_c56a5bb6")}</span>
                <span className="ml-auto whitespace-nowrap pl-2 font-normal">{uiText("count_days", { count: olderGroups.length })} · {uiText("project_sessions", { count: olderCount })}</span>
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
            <Cog className="size-4" />{uiText("system_settings_68ea5dd4")}</Button>
        </div>
      </aside>

      <ProjectEditDialog projectId={editingProjectId} onClose={() => setEditingProjectId(null)} />

      <ProjectSectionDialog
        key={sectioningProjectId ?? "closed"}
        projectId={sectioningProjectId}
        existingSections={sectioningProjectId ? getProjectSections(sectionPreferences, sectioningProjectId, projects[sectioningProjectId]?.section) : []}
        mode={sectionDialogMode}
        onCreate={(name) => {
          const sectionId = `section:${crypto.randomUUID()}`
          if (sectioningProjectId) updateSectionPreferences((previous) => createProjectSection(previous, sectioningProjectId, name, projects[sectioningProjectId]?.section, sectionId))
        }}
        onRemove={(sectionId) => {
          if (sectioningProjectId) updateSectionPreferences((previous) => removeProjectSection(previous, sectioningProjectId, sectionId, projects[sectioningProjectId]?.section))
        }}
        onClose={() => setSectioningProjectId(null)}
      />

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
            setProjectActionError(error instanceof Error ? error.message : uiText("could_not_remove_project_1086e674"))
          }).finally(() => {
            setProjectActionBusy(false)
          })
        }}
      />
    </>
  )
}
