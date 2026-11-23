import { Archive, ArchiveRestore, CalendarDays, ChevronRight, Cog, FolderClosed, FolderOpen, GitBranch, List, MoreHorizontal, PanelLeftClose, Pencil, Pin, PinOff, Plus, Search, SquarePen, X } from "@lucide/solid"
import { createEffect, createMemo, createSignal, createUniqueId, For, lazy, Loading, omit, onSettled, Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import type { ProjectManifest } from "@services/project"
import { getErrorMessage } from "@services/api"
import type { ChatItem } from "@shared/types/chatMessages"
import { appStore } from "@shared/store/appStore/state"
import { confirmedProjectRevision } from "@shared/store/appStore/slices/projectSlice"
import { openLocalFolder } from "@shared/utils/openExternalLink"
import { groupChats, groupChatsByProject, type ChatGroup } from "@/lib/groupChats"
import {
  createProjectSection, getProjectSections, getSessionSection, LEGACY_PROJECT_SECTION_ID, readPinnedProjectIds, readProjectDisclosures,
  removeProjectSection, writePinnedProjectIds, writeProjectDisclosure,
  type ProjectSidebarSection,
} from "@/lib/projectSidebarPreferences"
import { isSessionUnread, sessionReadMarkersSnapshot, subscribeSessionReadMarkers } from "@/lib/sessionReadMarkers"
import { sessionOrderSnapshot, subscribeSessionOrder } from "@/lib/sidebarSessionOrderState"
import { DEFAULT_SUPERVISOR_SESSION_ID, isDefaultSupervisor } from "@/lib/supervisor"
import { cn } from "@/lib/utils"
import { BrandMark } from "../ui/brand-mark"
import { Button } from "../ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu"
import { Input } from "../ui/input"
import { ConfirmActionDialog } from "../ui/confirm-action-dialog"
import type { createProjectSections } from "./createProjectSections"
import { ProjectSectionDialog, sectionWriteErrorText } from "./ProjectSectionDialog"
import { createSidebarProjectDragMoves } from "./project-drag/createSidebarProjectDragMoves"
import type { SidebarDragParts } from "./project-drag/SidebarProjectDrag"
import { SessionRow } from "./SessionRow"
import { SupervisorEntry } from "./SupervisorEntry"
import { createUiLocale, createUiText } from "./uiText"

const GROUPING_KEY = "lotus.sidebar.grouping-mode.v1"
const PROJECT_PREVIEW_COUNT = 7
const SidebarProjectDrag = lazy(() => import("./project-drag/SidebarProjectDrag"), { export: "SidebarProjectDrag" })
type Grouping = "date" | "project"

const StaticDropTarget: SidebarDragParts["Target"] = (props) => <div {...omit(props, "target", "disabled")} />

type Props = {
  open: boolean
  collapsed: boolean
  width: number | string
  booted: boolean
  chats: ChatItem[]
  currentSessionId: string | null
  projects: Record<string, ProjectManifest>
  sections: ReturnType<typeof createProjectSections>
  ownerAccess: boolean
  suspended?: boolean
  isRunning: (chat: ChatItem) => boolean
  onClose: () => void
  onToggleCollapse: () => void
  onSelect: (id: string) => void | Promise<void>
  onNewChat: (projectId?: string | null, sectionId?: string | null) => void
  onMoveToSection: (projectId: string, sessionId: string, sectionId: string | null) => void
  onTogglePin: (chat: ChatItem) => void
  onRename: (id: string, title: string) => void | Promise<void>
  onRegenerateTitle: (id: string) => void
  onCopySessionId: (id: string) => void
  onClear: (chat: ChatItem) => void
  onDelete: (chat: ChatItem) => void
  onOpenProjectManager: () => void
  onOpenProjectWork: (projectId: string) => void
  onEditProject?: (projectId: string) => void
  onOpenSettings: () => void
  onOpenWorktrees?: () => void
  onError: (error: unknown) => void
}

function readGrouping(): Grouping {
  try { return localStorage.getItem(GROUPING_KEY) === "project" ? "project" : "date" }
  catch { return "date" }
}

function Disclosure(props: {
  expanded: boolean
  onToggle: () => void
  label: string
  detail?: string
  disabled?: boolean
  actions?: JSX.Element
  wrapHeader?: (header: JSX.Element) => JSX.Element
  sectionHeader?: boolean
  projectId?: string
  projectBusy?: boolean
  children: JSX.Element
}) {
  const id = createUniqueId()
  const header = () => (
      <div class="flex items-center pt-3 pb-1">
        <button type="button" aria-expanded={props.expanded ? "true" : "false"} aria-controls={id}
          data-sidebar-section-header={props.sectionHeader ? "" : undefined}
          disabled={props.disabled} onClick={props.onToggle}
          class="flex select-none min-w-0 flex-1 items-center gap-1 rounded-md px-2 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground disabled:cursor-default">
          <ChevronRight aria-hidden="true" class={cn("size-3 shrink-0 feedback-motion transition-transform", props.expanded && "rotate-90")} />
          <span class="truncate">{props.label}</span>
          <Show when={props.detail}><span class="ml-auto whitespace-nowrap pl-2 font-normal">{props.detail}</span></Show>
        </button>
        {props.actions}
      </div>
  )
  return (
    <div class={cn("rounded-md", props.projectId && "mb-1")} data-sidebar-project={props.projectId}
      aria-busy={props.projectId ? (props.projectBusy ? "true" : "false") : undefined}>
      {props.wrapHeader ? props.wrapHeader(header()) : header()}
      <div id={id} hidden={!props.expanded}><Show when={props.expanded}>{props.children}</Show></div>
    </div>
  )
}

export function Sidebar(props: Props) {
  const text = createUiText()
  const locale = createUiLocale()
  const [search, setSearch] = createSignal("")
  const [grouping, setGrouping] = createSignal(readGrouping())
  const [order, setOrder] = createSignal(sessionOrderSnapshot())
  const [readMarkers, setReadMarkers] = createSignal(sessionReadMarkersSnapshot())
  const [disclosures, setDisclosures] = createSignal(readProjectDisclosures())
  const [closedDates, setClosedDates] = createSignal(new Set<string>())
  const [olderOpen, setOlderOpen] = createSignal(false)
  const [supervisorOpening, setSupervisorOpening] = createSignal(false)
  const [pinnedProjects, setPinnedProjects] = createSignal(readPinnedProjectIds())
  const [sectionDialog, setSectionDialog] = createSignal<{ id: string; mode: "create" | "manage" } | null>(null)
  const [pendingArchive, setPendingArchive] = createSignal<string | null>(null)
  const [archiveBusy, setArchiveBusy] = createSignal(false)
  const [archiveError, setArchiveError] = createSignal<string | null>(null)
  const archiveProject = () => { const id = pendingArchive(); return id ? props.projects[id] : undefined }

  const toggleProjectPin = (projectId: string) => {
    const next = new Set(pinnedProjects())
    if (next.has(projectId)) next.delete(projectId)
    else next.add(projectId)
    writePinnedProjectIds(next)
    setPinnedProjects(next)
  }
  const changeArchive = async (id: string, archive: boolean) => {
    if (!props.ownerAccess || archiveBusy()) return
    const state = appStore.getState()
    const project = state.projects[id]
    if (!project || (project.status === "archived") === archive) return
    setArchiveBusy(true)
    setArchiveError(null)
    try {
      const write = archive ? state.archiveProject : state.unarchiveProject
      await write(id, confirmedProjectRevision(project))
      if (archive) setPendingArchive(null)
    } catch (error) {
      if (archive) setArchiveError(getErrorMessage(error))
      else props.onError(error)
    } finally { setArchiveBusy(false) }
  }

  onSettled(() => {
    const updateOrder = () => { setOrder(sessionOrderSnapshot()) }
    const updateRead = () => { setReadMarkers(sessionReadMarkersSnapshot()) }
    const disposeOrder = subscribeSessionOrder(updateOrder)
    const disposeRead = subscribeSessionReadMarkers(updateRead)
    updateOrder()
    updateRead()
    return () => { disposeRead(); disposeOrder() }
  })

  const query = createMemo(() => search().trim().toLowerCase())
  const projectMode = () => grouping() === "project"
  const rootChats = createMemo(() => props.chats.filter((chat) => !chat.parentSessionId && !isDefaultSupervisor(chat)))
  const supervisor = createMemo(() => props.chats.find(isDefaultSupervisor))
  const groups = createMemo(() => {
    locale()
    if (!projectMode()) return groupChats(rootChats(), new Date(), order())
    const projects = props.projects
    const grouped = groupChatsByProject(rootChats(), (id) => {
      if (!id) return text("unassigned_52496e5a")
      const project = projects[id]
      if (!project) return text("unknown_project_9714067d")
      return project.status === "archived" ? text("archived_01a84e81", { v0: project.name }) : project.name
    }, order())
    const pinnedSessions = grouped.find((group) => group.key === "__pinned")
    const projectGroups = grouped.filter((group) => group.key !== "__pinned")
    const seen = new Set(projectGroups.map((group) => group.key))
    for (const project of Object.values(projects)) {
      if (project.status === "active" && !seen.has(project.id)) {
        projectGroups.push({ key: project.id, label: project.name, chats: [] })
      }
    }
    const pinned = pinnedProjects()
    projectGroups.sort((left, right) => Number(pinned.has(right.key)) - Number(pinned.has(left.key)))
    return pinnedSessions ? [pinnedSessions, ...projectGroups] : projectGroups
  })
  const activeGroup = createMemo(() => groups().find((group) => group.chats.some((chat) => chat.id === props.currentSessionId)))
  const older = createMemo(() => projectMode() ? [] : groups().filter((group) => group.key !== "__pinned").slice(5))
  const shownGroups = createMemo(() => {
    const value = query()
    if (!value) return groups().filter((group) => !older().includes(group))
    return groups().map((group) => ({
      ...group,
      chats: group.chats.filter((chat) => chat.title.toLowerCase().includes(value) || chat.id.toLowerCase().includes(value)),
    })).filter((group) => group.chats.length > 0)
  })
  const projectKey = (id: string) => `project:${id}`
  const sectionKey = (projectId: string, sectionId: string | null) => `section:${JSON.stringify([projectId, sectionId])}`

  const activePath = createMemo(() => {
    const group = activeGroup()
    const id = props.currentSessionId
    const project = group && projectMode() ? props.projects[group.key] : undefined
    const section = project && id
      ? getSessionSection(props.sections.preferences(), project.id, id, project.section) : null
    const selection = props.booted ? JSON.stringify([grouping(), id]) : null
    return [group?.key, project?.id, section, older().some((item) => item.key === group?.key), selection] as const
  }, { equals: (previous, next) => previous?.every((value, index) => value === next[index]) ?? false })
  let previousSelection: string | null = null
  let navigated = false
  createEffect(activePath, ([group, project, section, activeIsOlder, selection]) => {
    if (previousSelection !== null && selection !== null && previousSelection !== selection) navigated = true
    previousSelection = selection
    if (activeIsOlder) setOlderOpen(true)
    if (group && !projectMode()) {
      setClosedDates((state) => {
        if (!state.has(group)) return state
        const next = new Set(state)
        next.delete(group)
        return next
      })
    }
    // Keep saved folds through restoration. Later selection, including through
    // search, reveals the newly selected session's path without rewriting storage.
    if (project && navigated) {
      setDisclosures((state) => new Map(state).set(projectKey(project), true).set(sectionKey(project, section), true))
    }
  })

  const setDisclosure = (key: string, expanded: boolean) => {
    writeProjectDisclosure(key, expanded)
    setDisclosures((current) => new Map(current).set(key, expanded))
  }
  const changeGrouping = () => {
    const next: Grouping = projectMode() ? "date" : "project"
    setGrouping(next)
    try { localStorage.setItem(GROUPING_KEY, next) } catch { /* The current sidebar still changes. */ }
  }
  const select = async (id: string) => {
    if (id === DEFAULT_SUPERVISOR_SESSION_ID && supervisorOpening()) return
    if (id === DEFAULT_SUPERVISOR_SESSION_ID) setSupervisorOpening(true)
    try {
      await props.onSelect(id)
      props.onClose()
    } catch (error) {
      props.onError(error)
    } finally {
      if (id === DEFAULT_SUPERVISOR_SESSION_ID) setSupervisorOpening(false)
    }
  }
  const openNew = (projectId?: string | null, sectionId?: string | null) => {
    props.onNewChat(projectId, sectionId)
    props.onClose()
  }
  const sectionUnavailable = (id: string) => props.projects[id]?.status !== "active"
    || props.projects[id]?.sidebar === undefined || props.sections.busy().has(id)
  const dragDisabled = (id: string) => !props.ownerAccess || !!query() || !!props.suspended || sectionUnavailable(id)
  const showDragHandle = (id: string) => !query() && props.projects[id]?.status === "active"
    && props.projects[id]?.sidebar !== undefined
  const moves = createSidebarProjectDragMoves({
    state: () => ({ projects: props.projects, chats: rootChats(), preferences: props.sections.preferences(), busy: props.sections.busy() }),
    bucketSessionIds: (id, section) => {
      const group = groups().find((candidate) => candidate.key === id)
      return group?.chats.filter((entry) => getSessionSection(props.sections.preferences(), id, entry.id, props.projects[id]?.section) === section)
        .map((entry) => entry.id) ?? []
    },
    update: props.sections.update,
    onMovedSection: (id, section) => {
      const group = section === null && !getProjectSections(props.sections.preferences(), id, props.projects[id]?.section).length
        ? projectKey(id) : sectionKey(id, section)
      setDisclosure(projectKey(id), true)
      setDisclosure(group, true)
      setDisclosure(`preview:${group}`, true)
    },
  })

  const renderSessions = (
    chats: () => ChatItem[],
    groupKey: string,
    projectId?: string,
    section?: ProjectSidebarSection | { id: null; name: string },
    sections?: () => readonly ProjectSidebarSection[],
    drag?: SidebarDragParts,
  ) => {
    const expanded = () => disclosures().get(`preview:${groupKey}`) === true
    const folded = () => !!projectId && !query() && chats().length > PROJECT_PREVIEW_COUNT
      && chats().findIndex((chat) => chat.id === props.currentSessionId) < PROJECT_PREVIEW_COUNT
    const visible = () => folded() && !expanded() ? chats().slice(0, PROJECT_PREVIEW_COUNT) : chats()
    return (
      <>
        <For each={visible()} keyed={(chat) => chat.id}>{(entry) => {
          const sessionProjectId = () => entry().config?.projectId?.trim() || undefined
          const sessionProject = () => props.projects[sessionProjectId() ?? ""]
          const sessionSections = () => {
            const current = sessionProject()
            return sections?.() ?? (current ? getProjectSections(props.sections.preferences(), current.id, current.section) : undefined)
          }
          const sessionSection = () => {
            const current = sessionProject()
            return current ? getSessionSection(props.sections.preferences(), current.id, entry().id, current.section) : section?.id
          }
          return (
          <SessionRow
            chat={entry()}
            active={props.currentSessionId === entry().id}
            unread={props.currentSessionId !== entry().id && isSessionUnread(entry(), readMarkers())}
            running={props.isRunning(entry())}
            projectId={sessionProjectId()}
            sectionId={sessionSection()}
            sections={sessionSections()}
            dragHandle={drag && projectId && showDragHandle(projectId) ? <drag.Handle source={{ kind: "session", projectId, id: entry().id }} disabled={dragDisabled(projectId)}
              label={`${text("sidebar_session_drag_hint")} · ${entry().title || text("new_session_c57c30bc")}`} /> : undefined}
            onMoveToSection={sessionProject() && !dragDisabled(sessionProject()!.id) ? (id) => {
              const current = sessionProject()
              if (current && !dragDisabled(current.id)) props.onMoveToSection(current.id, entry().id, id)
            } : undefined}
            onSelect={() => { void select(entry().id) }}
            onRename={(title) => {
              try { void Promise.resolve(props.onRename(entry().id, title)).catch(props.onError) }
              catch (error) { props.onError(error) }
            }}
            onTogglePin={() => props.onTogglePin(entry())}
            onRegenerateTitle={() => props.onRegenerateTitle(entry().id)}
            onCopySessionId={() => props.onCopySessionId(entry().id)}
            onClear={() => props.onClear(entry())}
            onDelete={() => props.onDelete(entry())}
          />
          )
        }}</For>
        <Show when={folded()}>
          <button type="button" class="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-sidebar-accent"
            onClick={() => setDisclosure(`preview:${groupKey}`, !expanded())}>
            <ChevronRight class={cn("size-3 shrink-0", expanded() && "rotate-90")} aria-hidden="true" />
            {expanded() ? text("collapse_afd4b783") : `${text("expand_00bd3960")} ${text("count_items", { count: chats().length - PROJECT_PREVIEW_COUNT })}`}
          </button>
        </Show>
      </>
    )
  }

  const renderGroup = (group: () => ChatGroup, drag?: SidebarDragParts) => {
    const project = () => projectMode() ? props.projects[group().key] : undefined
    const DropTarget = drag?.Target ?? StaticDropTarget
    const expanded = () => !!query() || (projectMode()
      ? disclosures().get(projectKey(group().key)) ?? true
      : !closedDates().has(group().key))
    const toggle = () => {
      if (projectMode()) {
        setDisclosure(projectKey(group().key), !expanded())
        return
      }
      setClosedDates((previous) => {
        const next = new Set(previous)
        if (next.has(group().key)) next.delete(group().key)
        else next.add(group().key)
        return next
      })
    }
    return (
      <Disclosure label={group().label} expanded={expanded()} disabled={!!query()} onToggle={toggle}
        projectId={project()?.id} projectBusy={props.sections.busy().has(group().key)}
        detail={text("project_sessions", { count: groups().find((item) => item.key === group().key)?.chats.length ?? group().chats.length })}
        wrapHeader={project() ? (header) => <DropTarget target={{ projectId: group().key, sectionId: null }}
          disabled={dragDisabled(group().key)} data-project-drop={group().key} title={text("sidebar_project_drop_hint")}
          class="rounded-md feedback-motion switch-feedback">{header}</DropTarget> : undefined}
        actions={<Show when={project()}>{(current) => <>
          <button type="button" aria-label={text("new_session_in_1e893198", { v0: current().name })}
            disabled={current().status !== "active"} onClick={() => openNew(current().id)}
            class="shrink-0 rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default">
            <SquarePen class="size-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={text("project_actions_4bc7fa27", { v0: current().name })}
              class="shrink-0 rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <MoreHorizontal class="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent class="min-w-40 rounded-xl">
              <DropdownMenuItem disabled={current().status === "archived"} onSelect={() => openNew(current().id)}>
                <Plus />{text("new_session_58e21b87")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onOpenProjectWork(current().id)}>
                <List />{text("project_work_title")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => toggleProjectPin(current().id)}>
                {pinnedProjects().has(current().id) ? <PinOff /> : <Pin />}
                {text(pinnedProjects().has(current().id) ? "unpin_c92179b7" : "pin_173f88d2")}
              </DropdownMenuItem>
              <Show when={props.ownerAccess}>
                <DropdownMenuItem onSelect={() => setSectionDialog({ id: current().id, mode: "create" })}>
                  <Plus />{text("sidebar_create_section")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSectionDialog({ id: current().id, mode: "manage" })}>
                  <List />{text("sidebar_manage_sections")}
                </DropdownMenuItem>
                <Show when={props.onEditProject}>
                  <DropdownMenuItem disabled={current().status === "archived"} onSelect={() => props.onEditProject?.(current().id)}>
                    <Pencil />{text("edit_project_577feeef")}
                  </DropdownMenuItem>
                </Show>
              </Show>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!current().project_path} onSelect={() => {
                const path = current().project_path
                if (path) void openLocalFolder(path).catch(props.onError)
              }}>
                <FolderOpen />{text("show_in_file_manager_1280364b")}
              </DropdownMenuItem>
              <Show when={props.ownerAccess}>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={archiveBusy()} onSelect={() => {
                  if (current().status === "archived") void changeArchive(current().id, false)
                  else { setArchiveError(null); setPendingArchive(current().id) }
                }}>
                  {current().status === "archived" ? <ArchiveRestore /> : <Archive />}
                  {text(current().status === "archived" ? "restore_project_52a1d56b" : "remove_local_project_e951cbd0")}
                </DropdownMenuItem>
              </Show>
            </DropdownMenuContent>
          </DropdownMenu>
        </>}</Show>}>
        <Show when={project()} fallback={renderSessions(() => group().chats, group().key)}>
          {(current) => {
            const sections = createMemo(() => getProjectSections(props.sections.preferences(), current().id, current().section))
            return <Show when={sections().length > 0} fallback={<DropTarget target={{ projectId: current().id, sectionId: null }}
                disabled={dragDisabled(current().id)} data-project-section="" data-section-id="none" data-section-project={current().id}
                aria-disabled={sectionUnavailable(current().id) ? "true" : "false"} class="mb-1 ms-3 rounded-md feedback-motion switch-feedback">
                {renderSessions(() => group().chats, projectKey(current().id), current().id, undefined, sections, drag)}
              </DropTarget>}>
                <For each={[...sections(), { id: null, name: text("sidebar_no_section") }]} keyed={(section) => section.id}>
                  {(section) => {
                    const groupId = () => sectionKey(current().id, section().id)
                    const selected = () => group().chats.filter((chat) =>
                      getSessionSection(props.sections.preferences(), current().id, chat.id, current().section) === section().id,
                    )
                    return <Show when={!query() || selected().length > 0}>
                      <DropTarget target={{ projectId: current().id, sectionId: section().id }} disabled={dragDisabled(current().id)}
                        data-project-section={section().name} data-section-id={section().id ?? "none"} data-section-project={current().id}
                        aria-disabled={sectionUnavailable(current().id) ? "true" : "false"} class="mb-1 ms-3 rounded-md feedback-motion switch-feedback">
                        <Disclosure label={section().name} sectionHeader disabled={!!query()}
                          detail={text("project_sessions", { count: selected().length })}
                          expanded={!!query() || (disclosures().get(groupId()) ?? true)}
                          actions={<>
                            <Show when={drag && showDragHandle(current().id) && section().id !== LEGACY_PROJECT_SECTION_ID && section().id}>
                              {(id) => drag && <drag.Handle source={{ kind: "section", projectId: current().id, id: id() }}
                                disabled={dragDisabled(current().id)} label={`${text("sidebar_section_drag_hint")} · ${section().name}`} />}
                            </Show>
                            <Show when={!dragDisabled(current().id)}>
                              <button type="button" aria-label={text("sidebar_section_new_session", { v0: section().name })}
                                class="shrink-0 rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() => openNew(current().id, section().id)}>
                                <SquarePen class="size-3.5" />
                              </button>
                            </Show>
                            <Show when={props.ownerAccess}>
                              <DropdownMenu>
                                <DropdownMenuTrigger aria-label={text("sidebar_manage_sections")}
                                  class="shrink-0 rounded p-1 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                                  <MoreHorizontal class="size-3.5" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                  <Show when={!dragDisabled(current().id)}>
                                    <DropdownMenuItem onSelect={() => openNew(current().id, section().id)}>
                                      <Plus />{text("sidebar_section_new_session", { v0: section().name })}
                                    </DropdownMenuItem>
                                  </Show>
                                  <DropdownMenuItem onSelect={() => setSectionDialog({ id: current().id, mode: "manage" })}>
                                    <List />{text("sidebar_manage_sections")}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </Show>
                          </>}
                          onToggle={() => setDisclosure(groupId(), !(disclosures().get(groupId()) ?? true))}>
                          {renderSessions(selected, groupId(), current().id, section(), sections, drag)}
                          <Show when={selected().length === 0}>
                            <p class="px-2 py-2 text-xs text-muted-foreground">{text("sidebar_section_empty")}</p>
                          </Show>
                        </Disclosure>
                      </DropTarget>
                    </Show>
                  }}
                </For>
              </Show>
          }}
        </Show>
      </Disclosure>
    )
  }

  return (
    <>
      <Show when={props.open}>
        <button type="button" class="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-label={text("close_3fd47edc")} onClick={props.onClose} />
      </Show>
      <aside
        data-slot="sidebar"
        style={{
          "--sidebar-w": typeof props.width === "number" ? `${props.width}px` : props.width,
          color: "var(--sidebar-foreground)",
        }}
        class={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[84%] max-w-xs flex-col bg-sidebar transition-transform md:static md:w-[var(--sidebar-w)] md:max-w-none md:translate-x-0",
          props.open ? "translate-x-0" : "-translate-x-full",
          props.collapsed && "md:hidden",
        )}
      >
        <div class="flex items-center gap-2 px-4 py-3">
          <BrandMark class="size-6" />
          <span class="flex-1 text-sm font-semibold dark:font-medium">Bodhi</span>
          <Button size="icon" variant="ghost" class="hidden size-8 text-muted-foreground md:inline-flex"
            aria-label={text("collapse_sidebar_bb0b6e36")} onClick={props.onToggleCollapse}>
            <PanelLeftClose class="size-4" />
          </Button>
        </div>
        <div class="px-2 pb-2">
          <SupervisorEntry chat={supervisor()} active={props.currentSessionId === DEFAULT_SUPERVISOR_SESSION_ID}
            unread={Boolean(supervisor() && isSessionUnread(supervisor()!, readMarkers()))}
            busy={supervisorOpening()} running={Boolean(supervisor() && props.isRunning(supervisor()!))}
            disabled={!props.booted || supervisorOpening()}
            onSelect={() => { void select(DEFAULT_SUPERVISOR_SESSION_ID) }}
            onRename={props.onRename} onClear={props.onClear} />
          <Button variant="ghost" class="w-full justify-start gap-2"
            onClick={() => openNew(projectMode() && activeGroup() ? props.projects[activeGroup()!.key]?.id : null)}>
            <Plus class="size-4" />{text("new_session_58e21b87")}
          </Button>
          <Button variant="ghost" class="w-full justify-start gap-2" onClick={() => { props.onOpenProjectManager(); props.onClose() }}>
            <FolderClosed class="size-4" />{text("manage_projects_302f96cf")}
          </Button>
        </div>
        <div class="px-3 pb-2">
          <div class="relative">
            <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search()} onInput={(event) => setSearch(event.currentTarget.value)}
              placeholder={text("search_sessions_feb95554")}
              class="border-transparent bg-transparent py-1.5 pl-8 pr-7 shadow-none" />
            <Show when={search()}>
              <button type="button" onClick={() => setSearch("")} aria-label={text("clear_bce23772")}
                class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
                <X class="size-3.5" />
              </button>
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-2 px-3">
          <span class="relative min-w-0 flex-1 text-xs font-medium text-muted-foreground">
            <span class={props.sections.busy().size ? "invisible" : undefined}>
              {projectMode() ? text("project_79f326be") : text("recent_997a5e6e")}
            </span>
            <Show when={props.sections.busy().size > 0}>
              <span role="status" class="absolute inset-x-0 top-0 truncate">{text("sidebar_sections_saving")}</span>
            </Show>
          </span>
          <Button size="sm" variant="ghost" class="text-muted-foreground" onClick={changeGrouping}
            aria-label={projectMode() ? text("switch_to_recent_view_fce00dbe") : text("switch_to_project_view_43561b9a")}>
            {projectMode() ? <CalendarDays class="size-4" /> : <FolderClosed class="size-4" />}
            {projectMode() ? text("recent_997a5e6e") : text("project_79f326be")}
          </Button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <Show when={projectMode() && Object.values(props.projects).some((project) =>
            project.sidebar === undefined && getProjectSections(props.sections.preferences(), project.id, project.section).length
          )}>
            <p role="status" class="px-3 py-2 text-xs text-muted-foreground">{text("sidebar_sections_unavailable")}</p>
          </Show>
          <For each={Object.entries(props.sections.failures()).filter(([id]) => props.projects[id] && id !== sectionDialog()?.id)}
            keyed={([id]) => id}>
            {(entry) => <p role="alert" class="px-3 py-2 text-xs text-destructive">
              {props.projects[entry()[0]].name} · {text(sectionWriteErrorText[entry()[1]])}
            </p>}
          </For>
          <Show when={!rootChats().length}>
            <p class="px-2 py-4 text-xs text-muted-foreground">{text(props.booted ? "no_sessions_yet_69e71f03" : "loading_4927a53b")}</p>
          </Show>
          <Show when={projectMode() && props.ownerAccess} fallback={<For each={shownGroups()} keyed={(group) => group.key}>{(group) => renderGroup(group)}</For>}>
            <Loading fallback={<div inert aria-busy="true">
              <For each={shownGroups()} keyed={(group) => group.key}>{(group) => renderGroup(group)}</For>
            </div>}>
              <SidebarProjectDrag projects={props.projects} chats={rootChats()} preferences={props.sections.preferences()} busy={props.sections.busy()}
                scopeKey={JSON.stringify([props.currentSessionId, query(), props.open, props.collapsed, props.suspended, sectionDialog(), pendingArchive()])}
                onMoveSession={moves.moveSession} onMoveSection={moves.moveSection}>
                {(drag) => <For each={shownGroups()} keyed={(group) => group.key}>{(group) => renderGroup(group, drag)}</For>}
              </SidebarProjectDrag>
            </Loading>
          </Show>
          <Show when={!query() && older().length > 0}>
            <Disclosure label={text("earlier_c56a5bb6")} expanded={olderOpen()} onToggle={() => setOlderOpen((value) => !value)}
              detail={text("count_days", { count: older().length })}>
              <For each={older()} keyed={(group) => group.key}>{(group) => renderGroup(group)}</For>
            </Disclosure>
          </Show>
        </div>
        <div class="p-2">
          <Show when={props.onOpenWorktrees}>
            <Button variant="ghost" class="w-full justify-start gap-2" onClick={() => { props.onOpenWorktrees?.(); props.onClose() }}>
              <GitBranch class="size-4" />{text("worktrees_title")}
            </Button>
          </Show>
          <Button variant="ghost" class="w-full justify-start gap-2" onClick={() => { props.onOpenSettings(); props.onClose() }}>
            <Cog class="size-4" />{text("system_settings_68ea5dd4")}
          </Button>
        </div>
      </aside>
      <Show when={sectionDialog()} keyed>{(scope) => (
        <Show when={props.ownerAccess && props.projects[scope.id]}>{(project) => (
          <ProjectSectionDialog projectName={project().name} mode={scope.mode}
            sections={getProjectSections(props.sections.preferences(), scope.id, project().section)}
            unavailable={project().sidebar === undefined} busy={props.sections.busy().has(scope.id)} error={props.sections.failures()[scope.id]}
            onCreate={(name) => props.sections.update(scope.id, (previous) => createProjectSection(previous, scope.id, name, project().section))}
            onRemove={(id) => props.sections.update(scope.id, (previous) => removeProjectSection(previous, scope.id, id, project().section))}
            onClose={() => setSectionDialog(null)} />
        )}</Show>
      )}</Show>
      <Show when={archiveProject()}>{(project) => (
        <ConfirmActionDialog open={props.ownerAccess} title={text("remove_bdb7b58b", { v0: project().name })}
          description={text("the_project_will_be_removed_from_new_session_choices_ex_d355c682")}
          confirmLabel={text("remove_project_84663136")} busy={archiveBusy()} error={archiveError()}
          onClose={() => setPendingArchive(null)} onConfirm={() => { void changeArchive(project().id, true) }} />
      )}</Show>
    </>
  )
}
