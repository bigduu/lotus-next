import { CalendarDays, ChevronRight, CircleDot, Cog, FolderClosed, GitBranch, PanelLeftClose, Plus, Search, X } from "@lucide/solid"
import { createEffect, createMemo, createSignal, createUniqueId, For, onSettled, Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import type { ProjectManifest } from "@services/project"
import type { ChatItem } from "@shared/types/chatMessages"
import { groupChats, groupChatsByProject, type ChatGroup } from "@/lib/groupChats"
import {
  getProjectSections, getSessionSection, readPinnedProjectIds, readProjectDisclosures, writeProjectDisclosure,
  type ProjectSectionPreferences, type ProjectSidebarSection,
} from "@/lib/projectSidebarPreferences"
import { isSessionUnread, sessionReadMarkersSnapshot, subscribeSessionReadMarkers } from "@/lib/sessionReadMarkers"
import { sessionOrderSnapshot, subscribeSessionOrder } from "@/lib/sidebarSessionOrderState"
import { DEFAULT_SUPERVISOR_SESSION_ID, isDefaultSupervisor } from "@/lib/supervisor"
import { cn } from "@/lib/utils"
import { BrandMark } from "../ui/brand-mark"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { SessionRow } from "./SessionRow"
import { createUiLocale, createUiText } from "./uiText"

const GROUPING_KEY = "lotus.sidebar.grouping-mode.v1"
const PROJECT_PREVIEW_COUNT = 7
type Grouping = "date" | "project"

type Props = {
  open: boolean
  collapsed: boolean
  width: number | string
  booted: boolean
  chats: ChatItem[]
  currentSessionId: string | null
  projects: Record<string, ProjectManifest>
  sectionPreferences: ProjectSectionPreferences
  isRunning: (chat: ChatItem) => boolean
  onClose: () => void
  onToggleCollapse: () => void
  onSelect: (id: string) => void | Promise<void>
  onNewChat: (projectId?: string | null, sectionId?: string | null) => void
  onMoveToSection: (projectId: string, sessionId: string, sectionId: string | null) => void
  onTogglePin: (chat: ChatItem) => void
  onRename: (id: string, title: string) => void
  onRegenerateTitle: (id: string) => void
  onCopySessionId: (id: string) => void
  onClear: (chat: ChatItem) => void
  onDelete: (chat: ChatItem) => void
  onOpenProjectManager: () => void
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
  children: JSX.Element
}) {
  const id = createUniqueId()
  return (
    <div class="rounded-md">
      <button type="button" aria-expanded={props.expanded ? "true" : "false"} aria-controls={id}
        disabled={props.disabled} onClick={props.onToggle}
        class="flex select-none w-full items-center gap-1 rounded-md px-2 pt-3 pb-1 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground disabled:cursor-default">
        <ChevronRight aria-hidden="true" class={cn("size-3 shrink-0 feedback-motion transition-transform", props.expanded && "rotate-90")} />
        <span>{props.label}</span>
        <Show when={props.detail}><span class="ml-auto whitespace-nowrap pl-2 font-normal">{props.detail}</span></Show>
      </button>
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
  const pinnedProjects = readPinnedProjectIds()

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
    projectGroups.sort((left, right) => Number(pinnedProjects.has(right.key)) - Number(pinnedProjects.has(left.key)))
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

  createEffect(
    () => ({ group: activeGroup(), id: props.currentSessionId, projectMode: projectMode(), older: older() }),
    ({ group, id, projectMode, older }) => {
      if (!group) return
      if (older.some((item) => group.key === item.key)) setOlderOpen(true)
      if (!projectMode) {
        setClosedDates((state) => {
          if (!state.has(group.key)) return state
          const next = new Set(state)
          next.delete(group.key)
          return next
        })
      } else {
        setDisclosures((state) => {
          const next = new Map(state)
          if (!next.has(projectKey(group.key))) next.set(projectKey(group.key), true)
          if (id) {
            const sectionId = getSessionSection(props.sectionPreferences, group.key, id, props.projects[group.key]?.section)
            if (!next.has(sectionKey(group.key, sectionId))) next.set(sectionKey(group.key, sectionId), true)
          }
          return next
        })
      }
    },
  )

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

  const renderSessions = (
    chats: () => ChatItem[],
    groupKey: string,
    projectId?: string,
    section?: ProjectSidebarSection | { id: null; name: string },
    sections?: readonly ProjectSidebarSection[],
  ) => {
    const expanded = () => disclosures().get(`preview:${groupKey}`) === true
    const folded = () => !!projectId && !query() && chats().length > PROJECT_PREVIEW_COUNT
      && chats().findIndex((chat) => chat.id === props.currentSessionId) < PROJECT_PREVIEW_COUNT
    const visible = () => folded() && !expanded() ? chats().slice(0, PROJECT_PREVIEW_COUNT) : chats()
    return (
      <>
        <For each={visible()} keyed={(chat) => chat.id}>{(entry) => (
          <SessionRow
            chat={entry()}
            active={props.currentSessionId === entry().id}
            unread={props.currentSessionId !== entry().id && isSessionUnread(entry(), readMarkers())}
            running={props.isRunning(entry())}
            projectId={projectId}
            sectionId={section?.id}
            sections={sections}
            onMoveToSection={projectId ? (id) => props.onMoveToSection(projectId, entry().id, id) : undefined}
            onSelect={() => { void select(entry().id) }}
            onRename={(title) => props.onRename(entry().id, title)}
            onTogglePin={() => props.onTogglePin(entry())}
            onRegenerateTitle={() => props.onRegenerateTitle(entry().id)}
            onCopySessionId={() => props.onCopySessionId(entry().id)}
            onClear={() => props.onClear(entry())}
            onDelete={() => props.onDelete(entry())}
          />
        )}</For>
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

  const renderGroup = (group: () => ChatGroup) => {
    const project = () => projectMode() ? props.projects[group().key] : undefined
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
        detail={text("project_sessions", { count: group().chats.length })}>
        <Show when={project()} fallback={renderSessions(() => group().chats, group().key)}>
          {(current) => {
            const sections = createMemo(() => getProjectSections(props.sectionPreferences, current().id, current().section))
            return <>
              <Button variant="ghost" size="sm" class="w-full justify-start" onClick={() => openNew(current().id)}>
                <Plus />{text("new_session_58e21b87")}
              </Button>
              <Show when={sections().length > 0} fallback={renderSessions(() => group().chats, projectKey(current().id), current().id)}>
                <For each={[...sections(), { id: null, name: text("sidebar_no_section") }]} keyed={(section) => section.id}>
                  {(section) => {
                    const groupId = () => sectionKey(current().id, section().id)
                    const selected = () => group().chats.filter((chat) =>
                      getSessionSection(props.sectionPreferences, current().id, chat.id, current().section) === section().id,
                    )
                    return (
                      <Disclosure label={section().name}
                        expanded={!!query() || (disclosures().get(groupId()) ?? true)}
                        onToggle={() => setDisclosure(groupId(), !(disclosures().get(groupId()) ?? true))}>
                        <Button variant="ghost" size="sm" class="w-full justify-start"
                          onClick={() => openNew(current().id, section().id)}>
                          <Plus />{text("new_session_58e21b87")}
                        </Button>
                        {renderSessions(selected, groupId(), current().id, section(), sections())}
                      </Disclosure>
                    )
                  }}
                </For>
              </Show>
            </>
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
          <Button variant="ghost" class="w-full justify-start gap-2"
            aria-current={props.currentSessionId === DEFAULT_SUPERVISOR_SESSION_ID ? "page" : undefined}
            aria-busy={supervisorOpening() ? "true" : undefined} disabled={!props.booted || supervisorOpening()}
            onClick={() => { void select(DEFAULT_SUPERVISOR_SESSION_ID) }}>
            <CircleDot class="size-4 shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-left">{supervisor()?.title || "Supervisor"}</span>
            <Show when={supervisor() && props.isRunning(supervisor()!)}>
              <span data-session-running="" class="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
            </Show>
          </Button>
          <p class="px-3 pb-1 text-xs leading-relaxed text-muted-foreground">{text("supervisor_entry_description")}</p>
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
          <span class="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
            {projectMode() ? text("project_79f326be") : text("recent_997a5e6e")}
          </span>
          <Button size="sm" variant="ghost" class="text-muted-foreground" onClick={changeGrouping}
            aria-label={projectMode() ? text("switch_to_recent_view_fce00dbe") : text("switch_to_project_view_43561b9a")}>
            {projectMode() ? <CalendarDays class="size-4" /> : <FolderClosed class="size-4" />}
            {projectMode() ? text("recent_997a5e6e") : text("project_79f326be")}
          </Button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <Show when={!rootChats().length}>
            <p class="px-2 py-4 text-xs text-muted-foreground">{text(props.booted ? "no_sessions_yet_69e71f03" : "loading_4927a53b")}</p>
          </Show>
          <For each={shownGroups()} keyed={(group) => group.key}>{renderGroup}</For>
          <Show when={!query() && older().length > 0}>
            <Disclosure label={text("earlier_c56a5bb6")} expanded={olderOpen()} onToggle={() => setOlderOpen((value) => !value)}
              detail={text("count_days", { count: older().length })}>
              <For each={older()} keyed={(group) => group.key}>{renderGroup}</For>
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
    </>
  )
}
