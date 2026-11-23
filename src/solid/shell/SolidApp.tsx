import { FileDiff, FolderClosed, PanelLeftOpen, PanelRightOpen, WifiOff, Workflow } from "@lucide/solid"
import { createEffect, createMemo, createSignal, lazy, Loading, onSettled, Show } from "solid-js"
import { agentClient } from "@services/chat/AgentService"
import { getErrorMessage } from "@services/api/errors"
import { appStore } from "@shared/store/appStore/state"
import { themeStore } from "@shared/store/themeState"
import { copyText } from "@shared/utils/clipboard"
import { openExternalLink } from "@shared/utils/openExternalLink"
import { getUserMessageColors } from "@shared/theme/userMessageColors"
import { markSessionRead } from "@/lib/sessionReadMarkers"
import { setSessionSection } from "@/lib/projectSidebarPreferences"
import { assignSessionToSection } from "@/lib/projectSidebarWrites"
import { sessionHasLiveWork } from "@/lib/sessionBackgroundTasks"
import { DEFAULT_SUPERVISOR_SESSION_ID } from "@/lib/supervisor"
import type { ChatItem } from "@shared/types/chatMessages"
import { Button } from "../ui/button"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../ui/responsive-dialog"
import type { HistoryReadingAnchor } from "../history/VirtualHistory"
import { createChat } from "../chat/createChat"
import { ChatViewport } from "../chat/ChatViewport"
import { ComposerPanel } from "../chat/ComposerPanel"
import { RunInteractions } from "../chat/RunInteractions"
import { createStoreSelector } from "../state/createStoreSelector"
import { ThemePreferences } from "../ThemePreferences"
import { Sidebar } from "./Sidebar"
import { createProjectSections } from "./createProjectSections"
import { createUiText } from "./uiText"
import { restoreCommandFocus } from "@/lib/commandFocusReturn"
import { isCommandComposing } from "@/lib/commandComposition"
import { getWorkbenchMaxWidth, MIN_WORKBENCH_WIDTH, ResizableLayout } from "../ui/resizable-layout"
import { activateWorkbenchTab } from "@/lib/workbenchState"
import type { RightWorkbenchTab, WorkbenchToolTab } from "@/lib/workbenchTabTypes"
import { reorderVisibleWorkbenchTabIds } from "@/lib/workbenchTabs"
import { collectLiveSessionFileChanges, collectSessionFileChanges, groupSessionFileChanges, mergeSessionFileChanges } from "@/lib/sessionFileChanges"
import { isPhoneDevice } from "@/lib/browserAvailability"
import type { BrowserState } from "@services/browser/types"
import { createBrowserSession } from "../workbench/browser/createBrowserSession"
import { createWorkbenchState } from "../workbench/createWorkbenchState"
import { createSessionTaskDag } from "../workbench/tasks/createSessionTaskDag"
import { ProjectManagerModal } from "./ProjectManagerModal"
import { WorkspacePicker } from "./WorkspacePicker"
import { Onboarding } from "./Onboarding"
import { CommandPalette } from "./CommandPalette"
import { GoalSection } from "../workbench/inspector/GoalSection"

const WorktreeManager = lazy(() => import("../workspace/WorktreeManager"), { export: "WorktreeManager" })
const SettingsPermissions = lazy(() => import("../settings/permissions/SettingsPermissions"), { export: "SettingsPermissions" })
const SubagentsPane = lazy(() => import("../workbench/subagents/SubagentsPane"), { export: "SubagentsPane" })
const SessionTaskDag = lazy(() => import("../workbench/tasks/SessionTaskDag"), { export: "SessionTaskDag" })
const RightWorkbench = lazy(() => import("../workbench/RightWorkbench"), { export: "RightWorkbench" })
const BrowserPaneView = lazy(() => import("../workbench/browser/BrowserPane"), { export: "BrowserPaneView" })
const ReviewPane = lazy(() => import("../workbench/ReviewPane"), { export: "ReviewPane" })

const SettingsProviders = lazy(() => import("../settings/SettingsProviders"), { export: "SettingsProviders" })

type SectionIntent = { projectId: string; sectionId?: string | null }
type ConfirmSession = { chat: ChatItem; action: "delete" | "clear" }

function sidebarWidth() {
  try {
    const stored = localStorage.getItem("lotus_next_sidebar_w")
    const width = stored === null ? 288 : Number(stored)
    return Number.isFinite(width) ? Math.max(220, Math.min(420, width)) : 288
  } catch { return 288 }
}

export function SolidApp(props: { ownerAccess: boolean }) {
  const text = createUiText()
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [projectsOpen, setProjectsOpen] = createSignal(false)
  const [workspaceOpen, setWorkspaceOpen] = createSignal(false)
  const [worktreeManager, setWorktreeManager] = createSignal<"unopened" | "open" | "closed">("unopened")
  const [pickedWorkspace, setPickedWorkspace] = createSignal<string | null>(null)
  const [pickedWorktree, setPickedWorktree] = createSignal<{ projectId: string; path: string } | null>(null)
  const [draftEpoch, setDraftEpoch] = createSignal(0)
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)
  const [paletteOpen, setPaletteOpen] = createSignal(false)
  const [containerWidth, setContainerWidth] = createSignal(window.innerWidth)
  const [usedSidebarWidth, setSidebarWidth] = createSignal(sidebarWidth())
  let paletteOpener: HTMLElement | null = null
  let shell!: HTMLDivElement
  const [notice, setNotice] = createSignal<{ text: string; error: boolean } | null>(null)
  const [newSession, setNewSession] = createSignal<SectionIntent | null>(null)
  const [confirm, setConfirm] = createSignal<ConfirmSession | null>(null)
  const [confirmationBusy, setConfirmationBusy] = createSignal(false)
  const [link, setLink] = createSignal<string | null>(null)
  const [image, setImage] = createSignal<string | null>(null)
  const [connectionLost, setConnectionLost] = createSignal(false)
  const chat = createChat(undefined, undefined, { pageVisible: () => !settingsOpen() })
  const projects = createStoreSelector(appStore, (state) => state.projects)
  const sections = createProjectSections(projects, appStore.getState)
  const availability = createStoreSelector(appStore, (state) => state.agentAvailability)
  const executions = createStoreSelector(appStore, (state) => state.executionBySession)
  const backgroundBash = createStoreSelector(appStore, (state) => state.backgroundBash)
  const theme = createStoreSelector(themeStore, (state) => state)
  const openError = (error: unknown) => setNotice({ text: getErrorMessage(error), error: true })
  let navigationVersion = 0
  const currentSession = () => chat.currentSessionId
  const selectedWorktreePath = () => {
    const worktree = pickedWorktree()
    return !currentSession() && worktree?.projectId === newSession()?.projectId ? worktree?.path ?? null : null
  }
  const displayWorkspace = () => chat.currentChat?.config?.workspacePath ?? selectedWorktreePath()
    ?? (newSession() ? projects()[newSession()!.projectId]?.project_path : undefined) ?? pickedWorkspace()
  const readingAnchors = new Map<string, HistoryReadingAnchor>()
  const sessionView = createMemo(() => ({ id: currentSession() }), {
    equals: (previous, next) => previous?.id === next.id,
  })
  const workbench = createWorkbenchState(currentSession)
  const workbenchState = workbench.state
  const desktopSidebar = () => containerWidth() >= 768 && !sidebarCollapsed()
  const maxWorkbenchWidth = () => getWorkbenchMaxWidth(containerWidth(), desktopSidebar() ? usedSidebarWidth() : 0)
  const dagSession = () => {
    const session = chat.currentChat
    return !settingsOpen() && session && session.id === currentSession() && session.kind !== "child" && !session.parentSessionId
      ? session.id : null
  }
  const taskList = createSessionTaskDag(dagSession, () => chat.currentChat?.isRunning === true || (chat.sending && chat.streaming !== null))
  const activeDagScope = () => dagSession() && workbenchState().open && workbenchState().tab === "task-dag" ? workbench.key() : null
  const [expandedDagScope, setExpandedDagScope] = createSignal<string | null>(null)
  const taskExpanded = () => activeDagScope() !== null && activeDagScope() === expandedDagScope()
  createEffect(activeDagScope, (scope) => {
    if (scope !== expandedDagScope()) setExpandedDagScope(null)
  })
  const docked = () => workbenchState().open && !taskExpanded() && maxWorkbenchWidth() >= MIN_WORKBENCH_WIDTH
  const preferredWorkbenchWidth = () => workbenchState().dockWidth ?? 520
  const browserEnabled = () => containerWidth() >= 768 && !isPhoneDevice()
  const [browserEntry, setBrowserEntry] = createSignal<{ scope: string | null; open: boolean; draft: string }>({
    scope: null, open: false, draft: "",
  })
  const browserEntryOpen = () => browserEntry().scope === workbench.key() && browserEntry().open
  const browser = createBrowserSession(currentSession, () => browserEnabled() && workbenchState().open &&
    (workbenchState().tab === "browser" || workbenchState().browserPresent || browserEntryOpen()))
  const browserState = () => browser.readySessionId === currentSession() ? browser.state : null
  let browserSelectionVersion = 0
  let restoration: {
    scope: string | null; version: number; status: "pending" | "activating" | "complete"; attempted?: BrowserState
  } | null = null

  createEffect(
    () => ({ scope: workbench.key(), state: browserState(), saved: workbenchState().browserActiveId }),
    ({ scope, state, saved }) => {
      if (restoration?.scope !== scope) {
        restoration = { scope, version: browserSelectionVersion, status: "pending" }
      }
      const attempt = restoration!
      if (!state) return
      const visit = workbench.capture()
      visit.setField("browserPresent", Boolean(state.tabs?.length || (state.url && state.url !== "about:blank")))
      if (attempt.version !== browserSelectionVersion) attempt.status = "complete"
      if (attempt.status === "activating") return
      if (attempt.status === "pending" && saved && saved !== state.active_tab_id &&
        state.tabs?.some((tab) => tab.tab_id === saved)) {
        if (state.pending_dialog || attempt.attempted === state) return
        attempt.status = "activating"
        attempt.attempted = state
        void browser.activateTab(saved).then((result) => {
          if (restoration !== attempt || !visit.isCurrent() || attempt.version !== browserSelectionVersion) return
          attempt.status = result ? "complete" : "pending"
          if (result) visit.setField("browserActiveId", result.active_tab_id ?? null)
        })
        return
      }
      attempt.status = "complete"
      visit.setField("browserActiveId", state.active_tab_id ?? null)
    },
  )
  const setSidebar = (width: number) => {
    setSidebarWidth(width)
    try { localStorage.setItem("lotus_next_sidebar_w", String(width)) } catch { /* Keep the in-memory preference. */ }
  }

  const fileChanges = createMemo(() => groupSessionFileChanges(mergeSessionFileChanges(
    collectSessionFileChanges(chat.messages),
    collectLiveSessionFileChanges(chat.liveSegments),
  ), displayWorkspace() ?? undefined))
  const rootId = () => chat.currentChat?.kind === "root" ? chat.currentChat.id : chat.currentChat?.rootSessionId ?? null
  const descendants = () => chat.chats.find((entry) => entry.id === rootId())?.subagentCount ?? null
  const childReadingAnchors = new Map<string | null, Map<string, HistoryReadingAnchor>>()
  const childAnchors = createMemo(() => {
    const scope = workbench.key()
    let anchors = childReadingAnchors.get(scope)
    if (!anchors) {
      anchors = new Map()
      childReadingAnchors.set(scope, anchors)
    }
    return anchors
  })
  const closePalette = () => {
    const opener = paletteOpener
    setPaletteOpen(false)
    requestAnimationFrame(() => restoreCommandFocus(opener))
  }
  onSettled(() => {
    const measure = () => { setContainerWidth(shell.getBoundingClientRect().width || window.innerWidth) }
    const observer = new ResizeObserver(measure)
    observer.observe(shell)
    measure()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && paletteOpen() && !isCommandComposing(event)) {
        event.preventDefault()
        event.stopPropagation()
        closePalette()
        return
      }
      if ((!event.metaKey && !event.ctrlKey) || event.key.toLowerCase() !== "k" || isCommandComposing(event)) return
      event.preventDefault()
      if (paletteOpen()) closePalette()
      else {
        paletteOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setPaletteOpen(true)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      observer.disconnect()
    }
  })

  const openWorkbenchTab = (tab: RightWorkbenchTab | null) => {
    if (tab === null) { workbench.capture().setField("tab", null); return }
    workbench.capture().update((state) => activateWorkbenchTab(state, tab))
    if (tab === "browser" && browserEnabled()) {
      const sessionId = currentSession()
      setBrowserEntry({ scope: workbench.key(), open: true, draft: "" })
      if (sessionId && !browser.hasPendingDialog()) browser.requestEntryOpen(sessionId)
    }
  }
  const closeWorkbenchTool = (tab: WorkbenchToolTab) => {
    workbench.capture().update((state) => {
      const tools = state.tools.filter((value) => value !== tab)
      return { ...state, tools, tab: state.tab === tab ? tools.at(-1) ?? null : state.tab }
    })
  }

  createEffect(theme, (state) => {
    const root = document.documentElement
    root.classList.toggle("dark", state.themeMode === "dark")
    const colors = getUserMessageColors(state.themeMode, state.userMessageColorPreset, state.customUserMessageColor)
    root.style.setProperty("--user-message-background", colors.background)
    root.style.setProperty("--user-message-foreground", colors.foreground)
  })
  createEffect(availability, (available) => {
    if (available === false) {
      const timer = window.setTimeout(() => setConnectionLost(true), 3000)
      return () => window.clearTimeout(timer)
    }
    setConnectionLost(false)
  })
  createEffect(() => chat.currentChat, (current) => {
    if (!current) return
    const mark = () => markSessionRead(current)
    mark()
    document.addEventListener("visibilitychange", mark)
    return () => { document.removeEventListener("visibilitychange", mark) }
  })
  createEffect(() => chat.booted, (booted) => {
    if (booted) void appStore.getState().loadProjects().catch(openError)
  })

  const select = async (id: string) => {
    const version = ++navigationVersion
    const previousSession = appStore.getState().currentSessionId
    if (id === DEFAULT_SUPERVISOR_SESSION_ID) {
      await agentClient.ensureDefaultSupervisor()
      if (!await appStore.getState().restoreSession(id)) throw new Error(text("workflow_run_not_found"))
      if (version !== navigationVersion || previousSession !== appStore.getState().currentSessionId) return
    }
    setNewSession(null)
    chat.select(id)
  }
  const newChat = (projectId?: string | null, sectionId?: string | null) => {
    navigationVersion += 1
    setDraftEpoch((epoch) => epoch + 1)
    setPickedWorktree(null)
    if (projectId) setPickedWorkspace(null)
    setNewSession(projectId ? { projectId, sectionId } : null)
    chat.newChat()
  }
  const sessionCreated = (sessionId: string, intent: SectionIntent | null) => {
    if (!intent) return
    if (newSession() === intent) setNewSession(null)
    if (intent.sectionId !== undefined) {
      void assignSessionToSection(
        appStore.getState, intent.projectId, sessionId, intent.sectionId, projects()[intent.projectId]?.section,
      ).then((ok) => {
        if (!ok) setNotice({ text: text("sidebar_sections_save_failed"), error: true })
      }).catch(openError)
    }
  }
  const confirmAction = async () => {
    const action = confirm()
    if (!action || confirmationBusy()) return
    setConfirmationBusy(true)
    try {
      if (action.action === "delete") await appStore.getState().deleteSession(action.chat.id)
      else await appStore.getState().clearConversation(action.chat.id)
      setConfirm(null)
    } catch (error) {
      openError(error)
    } finally {
      setConfirmationBusy(false)
    }
  }

  return (
    <div class="relative flex h-full min-h-0 flex-col bg-background text-foreground">
      <div role="status" aria-live="polite" class="pointer-events-none fixed inset-x-0 top-0 z-[140]">
        <Show when={connectionLost()}>
          <div class="flex items-center justify-center gap-2 bg-destructive px-3 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-xs font-medium text-white">
            <WifiOff class="size-3.5 shrink-0" />
            <span>{text("connection_lost_reconnecting_7ea3f97f")}</span>
          </div>
        </Show>
      </div>
      <div ref={(element) => { shell = element }} data-slot="chat-shell" inert={settingsOpen()} aria-hidden={settingsOpen() ? "true" : undefined}
        class={`relative h-full min-h-0 overflow-hidden ${settingsOpen() ? "hidden" : "flex"}`}>
        <ResizableLayout desktopSidebar={desktopSidebar()} workbenchDocked={docked()}
          sidebarWidth={{ width: usedSidebarWidth(), setWidth: setSidebar }}
          workbenchWidth={{ width: preferredWorkbenchWidth(), setWidth: (width) => workbench.capture().setField("dockWidth", width) }}
          workbenchMaxWidth={maxWorkbenchWidth()} containerWidth={containerWidth()}
          suspended={settingsOpen() || paletteOpen()} scopeKey={workbench.key()}
          sidebar={<Sidebar
          open={sidebarOpen()} collapsed={sidebarCollapsed()} width="100%"
          booted={chat.booted} chats={chat.chats} currentSessionId={currentSession()}
          projects={projects()} sectionPreferences={sections.preferences()}
          isRunning={(entry) => sessionHasLiveWork(entry, executions()[entry.id], backgroundBash())}
          onClose={() => setSidebarOpen(false)} onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
          onSelect={select} onNewChat={newChat}
          onOpenProjectManager={() => setProjectsOpen(true)}
          onOpenWorktrees={() => setWorktreeManager("open")}
          onOpenSettings={() => setSettingsOpen(true)}
          onMoveToSection={(projectId, sessionId, sectionId) => {
            void sections.update(projectId, (previous) =>
              setSessionSection(previous, projectId, sessionId, sectionId, projects()[projectId]?.section),
            ).then((ok) => {
              if (!ok) setNotice({ text: text("sidebar_sections_save_failed"), error: true })
            }).catch(openError)
          }}
          onRename={(id, title) => { void appStore.getState().persistSessionTitle(id, title).catch(openError) }}
          onRegenerateTitle={(id) => { void agentClient.regenerateSessionTitle(id).catch(openError) }}
          onTogglePin={(entry) => {
            const state = appStore.getState()
            if (entry.pinned) state.unpinSession(entry.id)
            else state.pinSession(entry.id)
          }}
          onCopySessionId={(id) => {
            void copyText(id).then(() => setNotice({ text: text("session_id_copied_3afb54a6"), error: false })).catch(openError)
          }}
          onClear={(entry) => setConfirm({ chat: entry, action: "clear" })}
          onDelete={(entry) => setConfirm({ chat: entry, action: "delete" })}
          onError={openError}
        />}
        workbench={<Show when={workbenchState().open}>
          <Loading fallback={null}>
            <RightWorkbench docked={docked()} expanded={taskExpanded()} visible pageVisible={!settingsOpen()}
              activeTab={workbenchState().tab} openToolTabs={workbenchState().tools}
              onTabChange={openWorkbenchTab} onToolClose={closeWorkbenchTool}
              tabOrder={workbenchState().order}
              onTabReorder={(order) => workbench.capture().update((state) => ({
                ...state, order: reorderVisibleWorkbenchTabIds(state.order, order),
              }))}
              onClose={() => {
                if (taskExpanded()) setExpandedDagScope(null)
                else workbench.capture().setField("open", false)
              }}
              focusScopeKey={workbench.key()} getCurrentFocusScope={workbench.key}
              interactionSuspended={settingsOpen() || paletteOpen()}
              browserEnabled={browserEnabled()} browserSessionAvailable={Boolean(currentSession())}
              browserEntryOpen={browserEntryOpen()} browserTabs={browserState()?.tabs}
              activeBrowserTabId={browserState()?.active_tab_id} browserBusy={browser.busy || Boolean(browserState()?.pending_dialog)}
              onBrowserActivate={(id) => {
                browserSelectionVersion += 1
                workbench.capture().update((state) => activateWorkbenchTab(state, "browser"))
                setBrowserEntry({ scope: workbench.key(), open: false, draft: "" })
                if (browserState()?.active_tab_id !== id) void browser.activateTab(id)
              }}
              onBrowserClose={(id) => {
                const version = ++browserSelectionVersion
                const visit = workbench.capture()
                void browser.closeTab(id).then((remaining) => {
                  if (!remaining || !visit.isCurrent() || version !== browserSelectionVersion) return
                  if (!remaining.tabs?.length && !browserEntryOpen()) visit.update((state) => ({
                    ...state, tab: state.tab === "browser" ? state.tools.at(-1) ?? null : state.tab,
                  }))
                })
              }}
              browser={<Show when={browserEnabled()}>
                <BrowserPaneView sessionId={currentSession()} browser={browser}
                  active={!settingsOpen() && workbenchState().open && workbenchState().tab === "browser"}
                  newTabEntry={browserEntryOpen()} entryDraft={browserEntryOpen() ? browserEntry().draft : ""}
                  onEntryDraftChange={(draft) => setBrowserEntry({ scope: workbench.key(), open: true, draft })}
                  onNewTabOpened={() => setBrowserEntry({ scope: workbench.key(), open: false, draft: "" })} />
              </Show>}
              inspector={<div class="grid w-full content-start gap-2 p-4 text-sm">
                <p class="font-medium">{chat.currentChat?.title}</p>
                <Show when={displayWorkspace()}>
                  <div class="flex min-w-0 items-center gap-2">
                    <FolderClosed class="size-4 shrink-0" /><span class="truncate">{displayWorkspace()}</span>
                  </div>
                </Show>
                <Show when={currentSession()} keyed>{(id) => <GoalSection sessionId={id}
                  goldConfig={chat.currentChat?.config?.goldConfig} goalState={chat.currentChat?.config?.goalState} />}</Show>
                <Button variant="ghost" class="justify-start" onClick={() => openWorkbenchTab("review")}>
                  <FileDiff class="size-4" />{text("file_changes_4d016b2f")}
                </Button>
              </div>}
              review={<ReviewPane sessionId={currentSession()} groups={fileChanges()}
                workspace={displayWorkspace()} targetFile={workbenchState().reviewTarget} />}
              subagents={<SubagentsPane rootId={rootId()} descendantCount={descendants()}
                active={!settingsOpen() && workbenchState().open && workbenchState().tab === "subagents"}
                selection={workbenchState().subagents} readingAnchors={childAnchors()}
                theme={theme().themeMode} onOpenLink={setLink} onPreviewImage={setImage}
                onSelectChild={(id) => workbench.capture().update((state) => ({
                  ...state, subagents: { ...state.subagents, childId: id, view: "messages" },
                }))}
                onShowTree={() => workbench.capture().update((state) => ({
                  ...state, subagents: { ...state.subagents, view: "tree" },
                }))}
                onMissingChild={(id) => workbench.capture().update((state) => state.subagents.childId === id ? {
                  ...state, subagents: { ...state.subagents, childId: null, view: "tree" },
                } : state)}
                onExpandedChange={(update) => workbench.capture().update((state) => {
                  const currentRoot = rootId()
                  const before = new Set(state.subagents.expandedActorIds ?? (currentRoot ? [currentRoot] : []))
                  const after = update(before)
                  return before === after ? state : { ...state, subagents: { ...state.subagents, expandedActorIds: [...after] } }
                })} />}
              taskDag={dagSession() ? <SessionTaskDag sessionId={dagSession()!} expanded={taskExpanded()}
                onToggleExpanded={taskExpanded() || containerWidth() >= 768
                  ? () => setExpandedDagScope(taskExpanded() ? null : activeDagScope()) : undefined} /> : undefined} />
          </Loading>
        </Show>}>
        <main class="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <header class="flex min-h-12 shrink-0 items-center gap-2 border-b px-3 py-2">
            <Button variant="ghost" size="icon" class={sidebarCollapsed() ? "" : "md:hidden"}
              aria-label={text("menu_4ce4cafd")} onClick={() => {
                setSidebarOpen(true); setSidebarCollapsed(false)
              }}>
              <PanelLeftOpen class="size-4" />
            </Button>
            <h1 class="min-w-0 flex-1 truncate text-sm font-semibold">
              {chat.currentChat?.title || text("new_session_c57c30bc")}
            </h1>
            <Button size="icon" variant="ghost" title={displayWorkspace() ?? undefined}
              aria-label={text("select_working_directory_18240aa3")} onClick={() => setWorkspaceOpen(true)}>
              <FolderClosed class="size-4" />
            </Button>
            <Show when={taskList().length > 0}>
              <Button size="icon" variant="ghost" aria-label={text("session_task_dag_title")}
                onClick={() => openWorkbenchTab("task-dag")}> <Workflow class="size-4" /> </Button>
            </Show>
            <Button size="icon" variant="ghost"
              aria-label={text(workbenchState().open ? "collapse_side_panel_e7d2fdd8" : "open_side_panel_732ea38b")}
              aria-expanded={workbenchState().open ? "true" : "false"} aria-controls="right-workbench"
              onClick={() => workbench.capture().setField("open", !workbenchState().open)}>
              <PanelRightOpen />
            </Button>
          </header>
          <Show when={sessionView()} keyed>{(session) => (
            <ChatViewport chat={chat} theme={theme().themeMode}
              onOpenLink={setLink} onPreviewImage={setImage}
              initialReadingAnchor={session.id ? readingAnchors.get(session.id) : undefined}
              onReadingAnchor={(anchor) => {
                if (!session.id) return
                if (anchor) readingAnchors.set(session.id, anchor)
                else readingAnchors.delete(session.id)
              }} />
          )}</Show>
          <RunInteractions chat={chat} workspace={displayWorkspace()} />
          <ComposerPanel chat={chat} workspacePath={displayWorkspace()} projectId={newSession()?.projectId ?? null}
            selectedWorktreePath={selectedWorktreePath()} draftEpoch={draftEpoch()} navigationVersion={() => navigationVersion}
            onOpenGoal={(id) => { if (id === currentSession()) openWorkbenchTab("inspector") }}
            onPreviewImage={setImage} captureSessionCreated={() => {
              const intent = newSession()
              return (id) => sessionCreated(id, intent)
            }} />
        </main>
        </ResizableLayout>
      </div>
      <Show when={settingsOpen()}>
        <div class="min-h-0 flex-1 overflow-y-auto" data-slot="settings-page">
          <div class="mx-auto grid w-full max-w-4xl gap-4 px-4 py-6">
            <div class="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setSettingsOpen(false)}>{text("close_settings_77b17fc4")}</Button>
              <h1 class="text-lg font-semibold">{text("system_settings_68ea5dd4")}</h1>
            </div>
            <ThemePreferences preference={theme().themePreference} />
            <Show when={props.ownerAccess}>
              <Loading fallback={<p role="status">{text("loading_4927a53b")}</p>}>
                <SettingsProviders />
                <SettingsPermissions ownerAccess={props.ownerAccess} />
              </Loading>
            </Show>
          </div>
        </div>
      </Show>
      <Onboarding />
      <Show when={workspaceOpen()}>
        <WorkspacePicker current={displayWorkspace()} locked={Boolean(chat.currentChat?.config?.workspacePath)}
          onClose={() => setWorkspaceOpen(false)}
          onSelect={(path) => {
            navigationVersion += 1
            setPickedWorktree(null)
            setPickedWorkspace(path)
            if (path) setNewSession(null)
          }} />
      </Show>
      <Show when={worktreeManager() !== "unopened"}>
        <Loading fallback={null}>
          <WorktreeManager open={worktreeManager() === "open"} onClose={() => setWorktreeManager("closed")}
            onOpen={(projectId, path) => {
              newChat(projectId)
              setPickedWorktree({ projectId, path })
              setWorktreeManager("closed")
            }}
            onSession={(id) => {
              void select(id).catch(openError)
              setWorktreeManager("closed")
            }} />
        </Loading>
      </Show>
      <Show when={projectsOpen()}>
        <ProjectManagerModal onClose={() => setProjectsOpen(false)} />
      </Show>
      <ResponsiveDialog open={confirm() !== null} onOpenChange={(open) => {
        if (!open && !confirmationBusy()) setConfirm(null)
      }}>
        <ResponsiveDialogContent class="p-5" showCloseButton={false} dismissable={!confirmationBusy()}>
          <ResponsiveDialogTitle>{text(confirm()?.action === "clear" ? "conversation_clear_title" : "delete_session_d51250d1")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription class="mt-2">
            {confirm()?.action === "clear"
              ? text("conversation_clear_impact")
              : text("delete_session_description", { title: confirm()?.chat.title ?? "" })}
          </ResponsiveDialogDescription>
          <div class="mt-5 flex justify-end gap-2">
            <Button variant="secondary" disabled={confirmationBusy()} onClick={() => setConfirm(null)}>
              {text("cancel_2cd0f3be")}
            </Button>
            <Button variant="destructive" disabled={confirmationBusy()} onClick={() => { void confirmAction() }}>
              {text(confirm()?.action === "clear" ? "conversation_clear_action" : "delete_2f9daa82")}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <ResponsiveDialog open={link() !== null} onOpenChange={(open) => { if (!open) setLink(null) }}>
        <ResponsiveDialogContent class="p-5">
          <ResponsiveDialogTitle>{text("open_external_link_fd407c70")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription class="my-3 break-all">{link()}</ResponsiveDialogDescription>
          <Button onClick={() => {
            const url = link()
            if (url) void openExternalLink(url).then(() => setLink(null)).catch(openError)
          }}>{text("open_in_default_browser_a489338a")}</Button>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <ResponsiveDialog open={image() !== null} onOpenChange={(open) => { if (!open) setImage(null) }}>
        <ResponsiveDialogContent class="p-5">
          <ResponsiveDialogTitle class="sr-only">{text("close_preview_1eb05d31")}</ResponsiveDialogTitle>
          <img class="mx-auto max-h-[75dvh] object-contain" src={image() ?? undefined} alt="" />
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <Show when={paletteOpen()}>
        <CommandPalette chats={chat.chats} onClose={closePalette}
          onNewChat={() => { setSettingsOpen(false); newChat() }}
          onSelect={(id) => { setSettingsOpen(false); setSidebarOpen(false); void select(id).catch(openError) }}
          onSettings={() => setSettingsOpen(true)}
          getReturnFocusTarget={() => paletteOpener} />
      </Show>
      <Show when={notice()}>
        {(value) => (
          <div role={value().error ? "alert" : "status"} class="fixed inset-x-0 bottom-28 z-[150] flex justify-center px-4">
            <button type="button" onClick={() => setNotice(null)}
              class="rounded-full border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-xl">{value().text}</button>
          </div>
        )}
      </Show>
    </div>
  )
}
