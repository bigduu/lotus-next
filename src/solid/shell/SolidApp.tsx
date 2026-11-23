import { BookText, Bot, Download, FileDown, FolderClosed, ListChecks, MessageSquarePlus, MoreHorizontal, PanelLeftOpen, PanelRightOpen, RotateCcw, WifiOff, Workflow } from "@lucide/solid"
import { createEffect, createMemo, createSignal, Errored, lazy, Loading, onSettled, Show } from "solid-js"
import { agentClient } from "@services/chat/AgentService"
import { getErrorMessage } from "@services/api/errors"
import { SIDE_CHAT_FEATURE } from "@services/chat/sideChat"
import { backendSupports, onBackendFeatures } from "@/lib/backendFeatures"
import { appStore } from "@shared/store/appStore/state"
import { themeStore } from "@shared/store/themeState"
import { copyText } from "@shared/utils/clipboard"
import { applyGlobalAccentToDocument, getGlobalAccentColors } from "@shared/theme/globalAccentColors"
import { getUserMessageColors } from "@shared/theme/userMessageColors"
import { isVdiSafeModeEnabled, onVdiSafeModeChange } from "@shared/utils/vdiSafeMode"
import { markSessionRead } from "@/lib/sessionReadMarkers"
import { navigateRecordedSession } from "@/lib/recordedSessionNavigation"
import { setSessionSection } from "@/lib/projectSidebarPreferences"
import { assignSessionToSection } from "@/lib/projectSidebarWrites"
import { sessionHasLiveWork } from "@/lib/sessionBackgroundTasks"
import { DEFAULT_SUPERVISOR_SESSION_ID, isDefaultSupervisor } from "@/lib/supervisor"
import type { ChatItem } from "@shared/types/chatMessages"
import type { ChatImageAttachment } from "@/lib/chatImageAttachments"
import { Button } from "../ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../ui/responsive-dialog"
import type { HistoryReadingAnchor } from "../history/VirtualHistory"
import { createChat } from "../chat/createChat"
import { createExternalSnapshot } from "../chat/snapshots"
import type { PendingSideChatIntent, SideChatIntent } from "@/lib/sideChatIntent"
import { ChatViewport } from "../chat/ChatViewport"
import { ComposerPanel } from "../chat/ComposerPanel"
import { ConversationClearDialog } from "../chat/ConversationClearDialog"
import { createEnvironment } from "../chat/environment/createEnvironment"
import { EnvironmentCard, EnvironmentLauncher } from "../chat/environment/Environment"
import { collectEnvironmentSources } from "../chat/environment/environmentSources"
import { createSupervisorApprovals } from "../chat/supervisor-approvals/createSupervisorApprovals"
import { SupervisorApprovalEntry } from "../chat/supervisor-approvals/SupervisorApprovalEntry"
import { createRootModeAuthority } from "../chat/model/createRootModeAuthority"
import { createTicketIngress } from "../chat/createTicketIngress"
import { createTicketWork } from "../workbench/work/createTicketWork"
import { TicketWorkAvailability } from "../workbench/work/TicketWorkAvailability"
import { SupervisorOverview } from "../workbench/work/SupervisorOverview"
import type { PendingRequest } from "@services/tickets/types"
import { createRunInteractionTimeline, RunInteractions } from "../chat/RunInteractions"
import { SessionVersionMigrationGate } from "../chat/status/version-migration/SessionVersionMigrationAction"
import { createStoreSelector } from "../state/createStoreSelector"
import type { SettingsTab } from "../settings/SettingsPage"
import { Sidebar } from "./Sidebar"
import { ExternalLinkDialog } from "./ExternalLinkDialog"
import { createProjectSections } from "./createProjectSections"
import { createSessionDrop } from "./createSessionDrop"
import { createUiText } from "./uiText"
import { restoreCommandFocus } from "@/lib/commandFocusReturn"
import { isCommandComposing } from "@/lib/commandComposition"
import { captureWorkbenchFocusReturn } from "@/lib/workbenchFocusReturn"
import { ResizableLayout } from "../ui/resizable-layout"
import { createStoredPanelWidth } from "../ui/createPanelWidth"
import { activateWorkbenchTab } from "@/lib/workbenchState"
import type { RightWorkbenchTab, WorkbenchToolTab } from "@/lib/workbenchTabTypes"
import type { WorkbenchTabDrag } from "../workbench/RightWorkbench"
import { reorderVisibleWorkbenchTabIds, visibleWorkbenchTabIds } from "@/lib/workbenchTabs"
import { collectLiveSessionFileChanges, collectSessionFileChanges, groupSessionFileChanges, mergeSessionFileChanges, orderPersistedFileChanges, summarizeSessionFileChangeGroups } from "@/lib/sessionFileChanges"
import { isPhoneDevice } from "@/lib/browserAvailability"
import { createBrowserSession } from "../workbench/browser/createBrowserSession"
import { LazyBrowserPaneView } from "../workbench/browser/LazyBrowserPaneView"
import { createWorkbenchState } from "../workbench/createWorkbenchState"
import { createWorkbenchWidth } from "../workbench/createWorkbenchWidth"
import { createWorkbenchBrowserSelection } from "../workbench/createWorkbenchBrowserSelection"
import { createSessionTaskDag } from "../workbench/tasks/createSessionTaskDag"
import { ProjectManagerModal } from "./ProjectManagerModal"
import { WorkspacePicker } from "./WorkspacePicker"
import { Onboarding } from "./Onboarding"
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog"
import { ProjectWorkDialog } from "../project-work/ProjectWorkDialog"
import { createSubagentFileChanges } from "../workbench/review/createSubagentFileChanges"
import { createHistoryPrefix } from "../workbench/review/createHistoryPrefix"

const WorkflowRunsDialog = lazy(() => import("../workbench/workflows/WorkflowRunsDialog"), { export: "WorkflowRunsDialog" })
const TicketWorkPanel = lazy(() => import("../workbench/work/TicketWorkPanel"), { export: "TicketWorkPanel" })
const WorktreeManager = lazy(() => import("../workspace/WorktreeManager"), { export: "WorktreeManager" })
const SettingsPage = lazy(() => import("../settings/SettingsPage"), { export: "SettingsPage" })
const SubagentsPane = lazy(() => import("../workbench/subagents/SubagentsPane"), { export: "SubagentsPane" })
const SessionTaskDag = lazy(() => import("../workbench/tasks/SessionTaskDag"), { export: "SessionTaskDag" })
const SideChatPane = lazy(() => import("../workbench/side-chat/SideChatPane"), { export: "SideChatPane" })
const RightWorkbench = lazy(() => import("../workbench/RightWorkbench"), { export: "RightWorkbench" })
const ReviewPane = lazy(() => import("../workbench/ReviewPane"), { export: "ReviewPane" })
const ProjectEditDialog = lazy(() => import("../workspace/project-edit/ProjectEditDialog"), { export: "ProjectEditDialog" })
const CommandPalette = lazy(() => import("./CommandPalette"), { export: "CommandPalette" })
const Inspector = lazy(() => import("../workbench/inspector/Inspector"), { export: "Inspector" })
const HomeDashboard = lazy(() => import("../chat/home/HomeDashboard"), { export: "HomeDashboard" })


type SectionIntent = { projectId: string; sectionId?: string | null }

export function SolidApp(props: { ownerAccess: boolean }) {
  const text = createUiText()
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [settingsTab, setSettingsTab] = createSignal<SettingsTab>("general")
  const [projectsOpen, setProjectsOpen] = createSignal(false)
  const [projectWork, setProjectWork] = createSignal<{ id: string } | null>(null)
  const [projectWorkError, setProjectWorkError] = createSignal<string | null>(null)
  const [projectToEdit, setProjectToEdit] = createSignal<string | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = createSignal(false)
  const [worktreeManager, setWorktreeManager] = createSignal<"unopened" | "open" | "closed">("unopened")
  const [pickedWorkspace, setPickedWorkspace] = createSignal<string | null>(null)
  const [pickedWorktree, setPickedWorktree] = createSignal<{ projectId: string; path: string } | null>(null)
  const [draftEpoch, setDraftEpoch] = createSignal(0)
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)
  const [paletteOpen, setPaletteOpen] = createSignal(false)
  const [workflowSession, setWorkflowSession] = createSignal<string | null>(null)
  const [containerWidth, setContainerWidth] = createSignal(window.innerWidth)
  const sidebarWidth = createStoredPanelWidth("lotus_next_sidebar_w", 288, () => ({ min: 220, max: 420 }))
  const tabDrag = { current: null as WorkbenchTabDrag | null }
  let paletteReturnFocus = () => null as HTMLElement | null
  let paletteNavigationVersion = 0
  let settingsReturnFocus: () => HTMLElement | null = () => null
  let shell!: HTMLDivElement
  const [notice, setNotice] = createSignal<{ text: string; error: boolean } | null>(null)
  const [newSession, setNewSession] = createSignal<SectionIntent | null>(null)
  const [sessionToDelete, setSessionToDelete] = createSignal<ChatItem | null>(null)
  const [sessionToClear, setSessionToClear] = createSignal<ChatItem | null>(null)
  const [confirmationBusy, setConfirmationBusy] = createSignal(false)
  const [link, setLink] = createSignal<{ url: string; sessionId: string | null; navigation: number } | null>(null)
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
  const openLink = (url: string) => setLink({ url, sessionId: currentSession(), navigation: navigationVersion })
  createEffect(currentSession, (id) => {
    if (workflowSession() !== id) setWorkflowSession(null)
    if (link()?.sessionId !== id) setLink(null)
  })
  const selectedWorktreePath = () => {
    const worktree = pickedWorktree()
    return !currentSession() && worktree?.projectId === newSession()?.projectId ? worktree?.path ?? null : null
  }
  const displayWorkspace = () => chat.currentChat?.config?.workspacePath ?? selectedWorktreePath()
    ?? (newSession() ? projects()[newSession()!.projectId]?.project_path : undefined) ?? pickedWorkspace()
  const runTimeline = createRunInteractionTimeline({ chat, workspace: displayWorkspace })
  const readingAnchors = new Map<string, HistoryReadingAnchor>()
  const sessionView = createMemo(() => ({ id: currentSession() }), {
    equals: (previous, next) => previous?.id === next.id,
  })
  const showHome = () => !currentSession() && !chat.sending && !chat.pendingUserText
    && chat.pendingUserImages.length === 0 && chat.pendingUserMessages.length === 0
  const focusComposer = () => document.getElementById("lotus-message-input")?.focus()
  const rootAuthority = createRootModeAuthority(currentSession, () => chat.currentChat?.kind)
  const workEnabled = () => Boolean(chat.currentChat && isDefaultSupervisor(chat.currentChat))
  const supervisorApprovals = createSupervisorApprovals({
    active: () => chat.booted && workEnabled() && !settingsOpen(), anchor: () => chat.messages.at(-1)?.id ?? null,
  })
  const workAuthorityKey = () => {
    const authority = rootAuthority.authority
    return authority ? JSON.stringify([authority.birthToken, authority.epoch, authority.enabled]) : ""
  }
  const tickets = createTicketWork({
    sessionId: currentSession,
    ownerAccess: () => props.ownerAccess,
    authorityKey: workAuthorityKey,
    authorityBlocked: () => rootAuthority.unsafe,
    deferRead: () => rootAuthority.loading && !rootAuthority.authority && !rootAuthority.unsafe,
  })
  const ingress = createTicketIngress(currentSession, () => rootAuthority.unsafe || chat.executionCompatibility.blocked)
  const ticketScope = () => tickets.state?.current.scope
  const semanticComposer = () => !tickets.negotiated || ingress.pending ||
    (ticketScope()?.capabilities?.semantic_messages_v1 === true && ticketScope()?.mutation_enabled === true &&
      ticketScope()?.binding.supervisor_session_id === currentSession())
  const [workReference, setWorkReference] = createSignal<{ scope: ReturnType<typeof sessionView>; request: PendingRequest } | null>(null)
  const ticketReference = () => {
    const replay = ingress.pending ? ingress.references : null
    const accepted = workReference()
    const reference = replay?.in_reply_to
      ? { id: replay.in_reply_to, work_id: replay.thread_id ?? replay.in_reply_to }
      : accepted?.scope === sessionView() ? accepted.request : null
    if (!reference) return null
    const title = tickets.state?.works[reference.work_id]?.ticket.contract.title ?? text("supervisor_work_tab")
    return { id: reference.id, work_id: reference.work_id, title }
  }
  const workbench = createWorkbenchState(currentSession)
  const workbenchState = workbench.state
  const supportsSideChat = createExternalSnapshot(onBackendFeatures, () => backendSupports(SIDE_CHAT_FEATURE))
  const sideChatScope = createMemo(() => {
    const session = chat.currentChat
    const key = workbench.key()
    if (!key || !supportsSideChat() || workEnabled() || session?.kind !== "root" ||
      session.parentSessionId || session.id !== currentSession()) return null
    return { sourceId: session.id, key }
  }, {
    equals: (before, after) => before === after || Boolean(before && after && before.sourceId === after.sourceId && before.key === after.key),
  })
  type SideChatScope = NonNullable<ReturnType<typeof sideChatScope>>
  const [sideChatIntent, setSideChatIntent] = createSignal<(PendingSideChatIntent & { scope: SideChatScope }) | null>(null)
  const [sideChatReveal, setSideChatReveal] = createSignal<{ scope: SideChatScope; id: string; token: number } | null>(null)
  let sideChatToken = 0
  const visibleWorkbenchTools = () => workbenchState().tools.filter((tab) =>
    (tab !== "side-chat" || sideChatScope() !== null) && (tab !== "work" || workEnabled()),
  )
  const visibleWorkbenchTab = () => {
    const tab = workbenchState().tab
    if (tab === "browser") return browserEnabled() ? tab : null
    return tab && visibleWorkbenchTools().includes(tab) ? tab : null
  }
  const desktopSidebar = () => containerWidth() >= 768 && !sidebarCollapsed()
  const workbenchWidth = createWorkbenchWidth(containerWidth, () => desktopSidebar() ? sidebarWidth.width() : 0,
    () => workbenchState().dockWidth, (width) => workbench.capture().setField("dockWidth", width))
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
  const docked = () => workbenchState().open && !taskExpanded() && workbenchWidth.canDock()
  const browserEnabled = () => containerWidth() >= 768 && !isPhoneDevice()
  const [browserEntry, setBrowserEntry] = createSignal({ scope: null as string | null, open: false, draft: "", resumeUntouched: false })
  const resetBrowserEntry = (open: boolean, resumeUntouched = false) => {
    setBrowserEntry({ scope: workbench.key(), open, draft: "", resumeUntouched })
  }
  type BrowserLink = { sessionId: string; scope: string | null; navigation: number; url: string }
  const [browserLink, setBrowserLink] = createSignal<BrowserLink | null>(null)
  const [browserStarted, setBrowserStarted] = createSignal<string | null>(null)
  let linkAttempt: BrowserLink | null = null
  const browserEntryOpen = () => browserEntry().scope === workbench.key() && browserEntry().open
  const browser = createBrowserSession(currentSession, () => browserEnabled() && workbenchState().open &&
    (workbenchState().tab === "browser" || workbenchState().browserPresent || browserEntryOpen() ||
      Boolean(currentSession() && browserStarted() === workbench.key())))
  createEffect(() => browserEnabled() && workbenchState().open && workbenchState().tab === "browser" ? workbench.key() : null,
    (scope) => { if (scope) setBrowserStarted(scope) })
  const browserState = () => browser.readySessionId === currentSession() ? browser.state : null
  const ownsBrowserLink = (intent: BrowserLink) => browserEnabled() && intent.scope === workbench.key()
    && intent.sessionId === currentSession() && appStore.getState().currentSessionId === intent.sessionId
    && intent.navigation === navigationVersion && browserLink() === intent
  createEffect(
    () => ({ intent: browserLink(), state: browserState(), busy: browser.busy || browser.loading || browser.entryOpening,
      scope: workbench.key(), session: currentSession(), enabled: browserEnabled() }),
    ({ intent, state, busy }) => {
      if (!intent) return
      if (!ownsBrowserLink(intent)) { setBrowserLink(null); return }
      if (!state || busy || linkAttempt === intent) return
      if (state.pending_dialog || browser.hasPendingDialog()) {
        if (browserEntryOpen()) resetBrowserEntry(false)
        return
      }
      linkAttempt = intent
      void browser.openUrlInNewTab(intent.url).then((opened) => {
        if (linkAttempt === intent) linkAttempt = null
        if (!ownsBrowserLink(intent)) return
        if (opened) {
          setBrowserLink(null)
          resetBrowserEntry(false)
        } else if (!browser.hasPendingDialog()) setBrowserLink(null)
      })
    },
  )
  createEffect(
    () => ({ entry: browserEntry(), state: browserState(), scope: workbench.key(), intent: browserLink() }),
    ({ entry, state, scope, intent }) => {
      if (entry.scope !== scope || !entry.open || !entry.resumeUntouched || !state || intent) return
      const hasPage = state.tabs ? state.tabs.length > 0 : Boolean(state.url && state.url !== "about:blank")
      if (hasPage) resetBrowserEntry(false)
      else setBrowserEntry({ ...entry, resumeUntouched: false })
    },
  )
  const visibleTabOrder = () => visibleWorkbenchTabIds(visibleWorkbenchTools(), browserState()?.tabs, workbenchState().order)
  let browserSelectionVersion = 0
  createWorkbenchBrowserSelection({
    workbench, state: browserState, tools: visibleWorkbenchTools, selectionVersion: () => browserSelectionVersion,
    activateTab: browser.activateTab, entryOpen: browserEntryOpen, linkPending: () => browserLink() !== null,
  })

  const reviewing = () => workbenchState().open && visibleWorkbenchTab() === "review"
  const inspecting = () => workbenchState().open && visibleWorkbenchTab() === "inspector"
  const environment = createEnvironment({ sessionId: currentSession, pageVisible: () => !settingsOpen(), sidePaneOpen: () => workbenchState().open })
  const [draftAttachments, setDraftAttachments] = createSignal<readonly ChatImageAttachment[]>([])
  const prefix = createHistoryPrefix({
    sessionId: currentSession, connectionScope: workbench.key,
    enabled: () => !settingsOpen() && (reviewing() || inspecting() || environment.requestsHistory()),
  })
  const historyStatus = () => {
    const status = prefix().status
    return status ? text(status === "loading" ? "history_prefix_loading" : "history_prefix_unavailable") : undefined
  }
  const subagentChanges = createSubagentFileChanges(() => chat.currentChat, workbench.key, () => !settingsOpen() && (reviewing() || environment.visible()))
  const persistedFileChanges = createMemo(() => {
    const earlier = prefix().messages
    const own = collectSessionFileChanges(earlier.length ? [...earlier, ...chat.messages] : chat.messages)
    const descendants = subagentChanges().changes
    return descendants.length ? orderPersistedFileChanges([...own, ...descendants]) : own
  })
  const fileChanges = createMemo(() => groupSessionFileChanges(mergeSessionFileChanges(
    persistedFileChanges(), collectLiveSessionFileChanges(chat.liveSegments),
  ), displayWorkspace() ?? undefined))
  const fileChangeSummary = createMemo(() => summarizeSessionFileChangeGroups(fileChanges()))
  const environmentSources = createMemo(() => collectEnvironmentSources(prefix().messages, chat.messages, draftAttachments()))
  const subagentFileStatus = () => (
    <>
      <Show when={subagentChanges().loading}>
        <p role="status" class="text-xs text-muted-foreground">{text("review_subagent_changes_loading")}</p>
      </Show>
      <Show when={subagentChanges().unavailable}>
        <div class="flex items-center gap-2">
          <p role="status" class="text-xs text-muted-foreground">{text("review_subagent_changes_unavailable")}</p>
          <Button size="sm" variant="ghost" onClick={() => subagentChanges().retry()}>{text("retry_b8784c8d")}</Button>
        </div>
      </Show>
      <Show when={subagentChanges().truncated}>
        <p role="status" class="text-xs text-muted-foreground">{text("review_subagent_changes_truncated")}</p>
      </Show>
    </>
  )
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
    const returnFocus = paletteReturnFocus
    const version = paletteNavigationVersion
    setPaletteOpen(false)
    requestAnimationFrame(() => {
      if (!paletteOpen() && !settingsOpen() && version === navigationVersion) restoreCommandFocus(returnFocus())
    })
  }
  const openSettings = () => {
    if (settingsOpen()) return
    const element = document.activeElement
    const opener = element instanceof HTMLElement ? element : null
    settingsReturnFocus = paletteOpen() ? paletteReturnFocus
      : captureWorkbenchFocusReturn(opener, workbench.key(), workbench.key, tabDrag.current?.getSourceId())
    setSidebarOpen(false)
    setPaletteOpen(false)
    setSettingsOpen(true)
  }
  const closeSettings = () => {
    const returnFocus = settingsReturnFocus
    setSettingsOpen(false)
    requestAnimationFrame(() => {
      if (settingsOpen()) return
      const opener = returnFocus()
      if (opener?.isConnected && opener.getClientRects().length && !opener.closest('[inert]')
        && (desktopSidebar() || !opener.closest('[data-slot="sidebar"]'))) opener.focus({ preventScroll: true })
      else shell.querySelector<HTMLElement>('[data-composer-column] [role="textbox"]')?.focus({ preventScroll: true })
    })
  }
  onSettled(() => {
    const measure = () => { setContainerWidth(shell.getBoundingClientRect().width || window.innerWidth) }
    const observer = new ResizeObserver(measure)
    observer.observe(shell)
    measure()
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
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
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
        paletteReturnFocus = captureWorkbenchFocusReturn(opener, workbench.key(), workbench.key, tabDrag.current?.getSourceId())
        paletteNavigationVersion = navigationVersion
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
    if (tab === "side-chat" && !sideChatScope()) return
    browserSelectionVersion += 1
    if (tab === null) { workbench.capture().setField("tab", null); return }
    workbench.capture().update((state) => activateWorkbenchTab(state, tab))
    if (tab === "browser" && browserEnabled()) {
      const sessionId = currentSession()
      const state = browserState()
      const legacyPage = state?.tabs === undefined && state?.url && state.url !== "about:blank"
      resetBrowserEntry(!legacyPage && !browser.hasPendingDialog(), state === null)
      if (sessionId && !browser.hasPendingDialog()) browser.requestEntryOpen(sessionId)
    }
  }
  const workBinding = createMemo(() => {
    const binding = ticketScope()?.binding
    return binding && binding.supervisor_session_id === currentSession()
      ? JSON.stringify([binding.scope_id, binding.binding_revision]) : null
  })
  const [workSelection, setWorkSelection] = createSignal<{
    session: ReturnType<typeof sessionView>; binding: string; id: string | null; focus: boolean
  } | null>(null)
  const currentWorkSelection = () => {
    const selection = workSelection()
    return selection?.session === sessionView() && selection.binding === workBinding() ? selection : null
  }
  const openTicketWork = (id: string | null) => {
    const binding = workBinding()
    if (!workEnabled() || !binding) return
    setWorkSelection({ session: sessionView(), binding, id, focus: true })
    openWorkbenchTab("work")
  }
  const finishWorkFocus = (selection: NonNullable<ReturnType<typeof currentWorkSelection>>) => {
    setWorkSelection((current) => current === selection ? { ...selection, focus: false } : current)
  }
  const focusWorkPanel = () => {
    const selection = currentWorkSelection()
    if (!selection?.focus || settingsOpen() || !workbenchState().open || visibleWorkbenchTab() !== "work") return
    const panel = document.getElementById("right-workbench")
    const overview = panel?.querySelector<HTMLElement>('[data-testid="ticket-work-overview"]')
    if (!overview?.getClientRects().length) return
    const active = document.activeElement
    if (!active?.matches('input, textarea, [contenteditable="true"]') || panel?.contains(active)) {
      overview.focus({ preventScroll: true })
    }
    finishWorkFocus(selection)
  }
  createEffect(
    () => [currentWorkSelection(), settingsOpen(), workbenchState().open, visibleWorkbenchTab()] as const,
    ([selection, settings, open, tab]) => {
      if (!selection?.focus) return
      if (settings || !open || tab !== "work") { finishWorkFocus(selection); return }
      const cancel = () => finishWorkFocus(selection)
      document.addEventListener("pointerdown", cancel, true)
      document.addEventListener("keydown", cancel, true)
      const frame = requestAnimationFrame(focusWorkPanel)
      return () => {
        cancelAnimationFrame(frame)
        document.removeEventListener("pointerdown", cancel, true)
        document.removeEventListener("keydown", cancel, true)
      }
    },
  )
  const openLinkInBrowser = (url: string) => {
    const current = currentSession()
    const origin = link()
    if (!current || !browserEnabled() || origin?.url !== url || origin.sessionId !== current || origin.navigation !== navigationVersion) return
    setBrowserLink({ sessionId: current, scope: workbench.key(), navigation: navigationVersion, url })
    openWorkbenchTab("browser")
  }
  const openSideChat = (intent?: SideChatIntent) => {
    const scope = sideChatScope()
    if (!scope || appStore.getState().currentSessionId !== scope.sourceId) return
    setSideChatIntent({ ...intent, token: ++sideChatToken, scope })
    openWorkbenchTab("side-chat")
  }
  const openReview = (fileId?: string) => {
    browserSelectionVersion += 1
    workbench.capture().update((state) => ({ ...activateWorkbenchTab(state, "review"), reviewTarget: fileId ?? null }))
  }
  const selectWorkbenchActor = (id: string) => {
    browserSelectionVersion += 1
    const root = id === rootId()
    if (root && id !== currentSession()) {
      const visit = workbench.capture()
      visit.update((state) => ({ ...state, subagents: { ...state.subagents, childId: null, view: "tree" } }))
      visit.openToolForSession(id, "inspector")
      void select(id).catch(openError)
      return
    }
    workbench.capture().update((state) => ({
      ...(root ? state : activateWorkbenchTab(state, "subagents")),
      subagents: { ...state.subagents, childId: id, view: root ? "tree" : "messages" },
    }))
  }
  const copySessionId = (id: string) => {
    void copyText(id).then(() => setNotice({ text: text("session_id_copied_3afb54a6"), error: false })).catch(openError)
  }
  const quoteToMain = (scope: SideChatScope, answer: string) => {
    const store = appStore.getState()
    if (sideChatScope() !== scope || store.currentSessionId !== scope.sourceId) return
    const draft = store.getInputState(scope.sourceId)
    const quote = answer.split("\n").map((line) => "> " + line).join("\n")
    store.setInputContentIfRevision(scope.sourceId, draft.contentRevision, draft.content ? draft.content + "\n\n" + quote : quote)
    if (!docked()) workbench.capture().setField("open", false)
  }
  const revealSideChatSource = (scope: SideChatScope, id: string) => {
    if (sideChatScope() !== scope || appStore.getState().currentSessionId !== scope.sourceId) return
    if (!docked()) workbench.capture().setField("open", false)
    setSideChatReveal({ scope, id, token: ++sideChatToken })
  }
  const closeSuccessor = (key: string) => {
    const visible = visibleTabOrder()
    const index = visible.indexOf(key)
    if (index === -1) return null
    const remaining = visible.filter((item) => item !== key)
    return remaining[index] ?? remaining[index - 1] ?? null
  }
  const removeClosedTab = (key: string, next?: string | null, serverTab = browserState()?.active_tab_id) => {
    const nextBrowser = next?.startsWith("browser:") ? next.slice("browser:".length) : null
    const nextTool = next?.startsWith("tool:") ? next.slice("tool:".length) as WorkbenchToolTab : null
    workbench.capture().update((state) => ({
      ...state,
      tools: key.startsWith("tool:") ? state.tools.filter((tool) => `tool:${tool}` !== key) : state.tools,
      order: state.order.filter((id) => id !== key),
      tab: next === undefined ? state.tab : nextBrowser ? "browser" : nextTool,
    }))
    if (nextBrowser) {
      resetBrowserEntry(false)
      if (nextBrowser !== serverTab) void browser.activateTab(nextBrowser)
    }
  }
  const closeWorkbenchTool = (tab: WorkbenchToolTab) => {
    browserSelectionVersion += 1
    const key = `tool:${tab}`
    removeClosedTab(key, workbenchState().tab === tab ? closeSuccessor(key) : undefined)
  }
  const closeWorkbenchBrowser = (id: string) => {
    const version = ++browserSelectionVersion
    const visit = workbench.capture()
    const key = `browser:${id}`
    const successor = closeSuccessor(key)
    const selected = workbenchState().tab === "browser" && browserState()?.active_tab_id === id && !browserEntryOpen()
    void browser.closeTab(id).then((state) => {
      if (!state || !visit.isCurrent()) return
      const selectSuccessor = selected && version === browserSelectionVersion
      if (selectSuccessor) browserSelectionVersion += 1
      removeClosedTab(key, selectSuccessor ? successor : undefined, state.active_tab_id)
    })
  }

  createEffect(theme, (state) => {
    const root = document.documentElement
    root.classList.toggle("dark", state.themeMode === "dark")
    const colors = getUserMessageColors(state.themeMode, state.userMessageColorPreset, state.customUserMessageColor)
    root.style.setProperty("--user-message-background", colors.background)
    root.style.setProperty("--user-message-foreground", colors.foreground)
    applyGlobalAccentToDocument(getGlobalAccentColors(state.themeMode, state.globalAccentPreset, state.customGlobalAccentColor))
  })
  onSettled(() => {
    const sync = () => {
      const enabled = String(isVdiSafeModeEnabled())
      document.body.setAttribute("data-vdi-safe", enabled)
      document.getElementById("root")?.setAttribute("data-vdi-safe", enabled)
    }
    sync()
    return onVdiSafeModeChange(sync)
  })
  createEffect(availability, (available) => {
    if (available === false) {
      const timer = window.setTimeout(() => setConnectionLost(true), 3000)
      return () => window.clearTimeout(timer)
    }
    setConnectionLost(false)
  })
  createEffect(() => settingsOpen() ? null : chat.currentChat, (current) => {
    if (!current) return
    const mark = () => { if (!settingsOpen()) markSessionRead(current) }
    mark()
    document.addEventListener("visibilitychange", mark)
    return () => { document.removeEventListener("visibilitychange", mark) }
  })
  createEffect(() => chat.booted, (booted) => {
    if (booted) void appStore.getState().loadProjects().catch(openError)
  })

  const select = async (id: string) => {
    const version = ++navigationVersion
    setPaletteOpen(false)
    const previousSession = appStore.getState().currentSessionId
    if (id === DEFAULT_SUPERVISOR_SESSION_ID) {
      await agentClient.ensureDefaultSupervisor()
      if (!await appStore.getState().restoreSession(id)) throw new Error(text("workflow_run_not_found"))
      if (version !== navigationVersion || previousSession !== appStore.getState().currentSessionId) return
    }
    setNewSession(null)
    chat.select(id)
  }
  const sessionDrop = createSessionDrop(() => chat.chats, (id) => {
    if (!settingsOpen()) void select(id).catch(openError)
  })
  const openProjectWork = (id: string) => {
    const scope = { id }
    setProjectWorkError(null)
    setProjectWork(scope)
    void appStore.getState().ensureProject(id).then(() => {
      if (projectWork() !== scope || appStore.getState().projects[id]) return
      setProjectWork(null)
      setNotice({ text: text("the_project_does_not_exist_or_has_been_deleted_e99cf9dc"), error: true })
    }).catch((error: unknown) => {
      if (projectWork() === scope) setProjectWorkError(getErrorMessage(error))
    })
  }
  const openProjectWorkSession = async (id: string, verifyAccess: () => Promise<boolean>) => {
    const scope = projectWork()
    const previousSession = appStore.getState().currentSessionId
    const version = ++navigationVersion
    const isCurrent = () => scope !== null && projectWork() === scope && version === navigationVersion
      && appStore.getState().currentSessionId === previousSession && !!appStore.getState().projects[scope.id]
    return navigateRecordedSession(id, verifyAccess, {
      isCurrent,
      restore: (target) => appStore.getState().restoreSession(target),
      select: (target) => {
        setProjectWork(null)
        setSidebarOpen(false)
        setNewSession(null)
        chat.select(target)
      },
      notFound: () => new Error(text("workflow_run_not_found")),
    })
  }
  const openRecordedSession = (id: string, expectedCreatedAt: string) => {
    const version = ++navigationVersion
    const initial = appStore.getState()
    const targetRevision = initial.getSessionNavigationRevision([id])
    const current = () => {
      const state = appStore.getState()
      return version === navigationVersion && initial.currentSessionId === state.currentSessionId
        && state.getSessionNavigationRevision([id]) === targetRevision
    }
    const matchesLifetime = (allowMissing = false) => {
      const cached = appStore.getState().chats.find((entry) => entry.id === id)
      return cached ? cached.kind === "root" && cached.createdAtExact === expectedCreatedAt : allowMissing
    }
    const verify = async () => {
      const { session } = await agentClient.getSession(id)
      return session.id === id && session.kind === "root" && session.created_at === expectedCreatedAt
    }
    return navigateRecordedSession(id, verify, {
      isCurrent: current,
      restore: async (target) => {
        if (!matchesLifetime(true) || !await appStore.getState().restoreSession(target)) return false
        return current() && matchesLifetime() && await verify() && matchesLifetime()
      },
      select: (target) => { void select(target).catch(openError) },
      notFound: () => new Error(text("workflow_run_not_found")),
    })
  }
  const exportConversation = async (format: "markdown" | "pdf") => {
    const session = chat.currentChat
    const displayed = chat.messages
    if (!session || !displayed.length) return
    const version = navigationVersion
    const scope = workbench.key()
    const revision = appStore.getState().getSessionNavigationRevision([session.id])
    const window = session.historyWindow
    const current = () => navigationVersion === version && scope === workbench.key() && !settingsOpen()
      && chat.currentChat?.id === session.id && chat.currentChat?.createdAtExact === session.createdAtExact
      && appStore.getState().getSessionNavigationRevision([session.id]) === revision
    try {
      if (window?.invalidated) throw new Error(text("conversation_export_failed"))
      const earlier = window?.beforeMessageId ? await appStore.getState().readHistoryPrefix(session.id, window, current) : []
      if (!current()) return
      const { downloadMarkdown, downloadPdf } = await import("../chat/export/index")
      if (!current()) return
      const download = format === "pdf" ? downloadPdf : downloadMarkdown
      await download([...earlier, ...displayed], session.title || "chat")
    } catch {
      if (current()) setNotice({ text: text("conversation_export_failed"), error: true })
    }
  }
  const beginNewDraft = () => {
    navigationVersion += 1
    setPaletteOpen(false)
    setDraftEpoch((epoch) => epoch + 1)
  }
  const newChat = (projectId?: string | null, sectionId?: string | null) => {
    beginNewDraft()
    setPickedWorktree(null)
    if (projectId) setPickedWorkspace(null)
    setNewSession(projectId ? { projectId, sectionId } : null)
    chat.newChat()
  }
  const newChatFromPalette = () => {
    setSettingsOpen(false)
    beginNewDraft()
    const projectId = newSession()?.projectId
    if (projectId && pickedWorktree()?.projectId === projectId && appStore.getState().projects[projectId]?.new_chat_worktree === true) {
      setPickedWorkspace(null)
      setPickedWorktree(null)
    }
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
  const confirmDeletion = async () => {
    const session = sessionToDelete()
    if (!session || confirmationBusy()) return
    setConfirmationBusy(true)
    try {
      await appStore.getState().deleteSession(session.id)
      setSessionToDelete(null)
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
          sidebarWidth={{ width: sidebarWidth.width(), setWidth: sidebarWidth.setWidth }}
          workbenchWidth={{ width: workbenchWidth.width(), setWidth: workbenchWidth.setWidth }}
          workbenchMaxWidth={workbenchWidth.maxWidth()} containerWidth={containerWidth()}
          suspended={settingsOpen() || paletteOpen()} scopeKey={workbench.key()}
          sidebar={<Sidebar
          open={sidebarOpen()} collapsed={sidebarCollapsed()} width="100%"
          booted={chat.booted} chats={chat.chats} currentSessionId={currentSession()}
          projects={projects()} sections={sections} ownerAccess={props.ownerAccess}
          suspended={settingsOpen() || paletteOpen() || projectsOpen() || !!projectToEdit() || !!projectWork()}
          isRunning={(entry) => sessionHasLiveWork(entry, executions()[entry.id], backgroundBash())}
          onClose={() => setSidebarOpen(false)} onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
          onSelect={select} onNewChat={newChat}
          onOpenProjectManager={() => setProjectsOpen(true)}
          onOpenProjectWork={openProjectWork}
          onEditProject={setProjectToEdit}
          onOpenWorktrees={() => setWorktreeManager("open")}
          onOpenSettings={openSettings}
          onMoveToSection={(projectId, sessionId, sectionId) => {
            void sections.update(projectId, (previous) =>
              setSessionSection(previous, projectId, sessionId, sectionId, projects()[projectId]?.section),
            ).then((ok) => {
              if (!ok) setNotice({ text: text("sidebar_sections_save_failed"), error: true })
            }).catch(openError)
          }}
          onRename={(id, title) => appStore.getState().persistSessionTitle(id, title)}
          onRegenerateTitle={(id) => { void agentClient.regenerateSessionTitle(id).catch(openError) }}
          onTogglePin={(entry) => {
            const state = appStore.getState()
            if (entry.pinned) state.unpinSession(entry.id)
            else state.pinSession(entry.id)
          }}
          onCopySessionId={copySessionId}
          onClear={setSessionToClear}
          onDelete={setSessionToDelete}
          onError={openError}
        />}
        workbench={<Show when={workbenchState().open} fallback={<aside id="right-workbench" hidden />}>
          <Loading fallback={<aside id="right-workbench" hidden />}>
            <RightWorkbench docked={docked()} expanded={taskExpanded()} pageVisible={!settingsOpen()} width="100%"
              activeTab={visibleWorkbenchTab()}
              openToolTabs={visibleWorkbenchTools()}
              workEnabled={workEnabled()}
              sideChatEnabled={sideChatScope() !== null}
              sideChat={<Show when={sideChatScope()} keyed>{(scope) =>
                <SideChatPane sourceId={scope.sourceId} scope={scope.key}
                  theme={theme().themeMode} onOpenLink={openLink} onPreviewImage={setImage}
                  active={!settingsOpen() && workbenchState().open && visibleWorkbenchTab() === "side-chat"}
                  intent={sideChatIntent()?.scope === scope ? sideChatIntent() ?? undefined : undefined}
                  onConsumeIntent={(token) => setSideChatIntent((pending) => pending?.scope === scope && pending.token === token ? null : pending)}
                  onQuoteToMain={(answer) => quoteToMain(scope, answer)}
                  onRevealSource={(id) => revealSideChatSource(scope, id)} />
              }</Show>}
              work={<Show when={workBinding()} fallback={
                <TicketWorkAvailability availability={tickets.availability} refreshing={tickets.refreshing}
                  canRefresh={tickets.canRefresh} onRefresh={() => { void tickets.refresh() }}
                  canInitialize={tickets.canInitialize} initializing={tickets.initializing}
                  initializationError={tickets.initializationError} onInitialize={() => { void tickets.initialize() }} />
              }>
                <TicketWorkPanel controller={tickets} selectedWorkId={currentWorkSelection()?.id}
                  onShowAll={() => openTicketWork(null)} onReady={() => { requestAnimationFrame(focusWorkPanel) }}
                  onReference={tickets.canSendIngress && ticketScope()?.capabilities?.message_references_v1 === true && !ingress.pending
                    ? (request) => {
                        const origin = sessionView()
                        setWorkReference({ scope: origin, request })
                        if (!docked()) workbench.capture().setField("open", false)
                        requestAnimationFrame(() => {
                          if (sessionView() === origin) document.getElementById("lotus-message-input")?.focus()
                        })
                      } : undefined} />
              </Show>}
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
              tabDragRef={tabDrag}
              interactionSuspended={settingsOpen() || paletteOpen()}
              browserEnabled={browserEnabled()} browserSessionAvailable={Boolean(currentSession())}
              browserEntryOpen={browserEntryOpen()} browserTabs={browserState()?.tabs}
              activeBrowserTabId={browserState()?.active_tab_id} browserBusy={browser.busy || Boolean(browserState()?.pending_dialog)}
              onBrowserActivate={(id) => {
                browserSelectionVersion += 1
                workbench.capture().update((state) => activateWorkbenchTab(state, "browser"))
                resetBrowserEntry(false)
                if (browserState()?.active_tab_id !== id) void browser.activateTab(id)
              }}
              onBrowserClose={closeWorkbenchBrowser}
              browser={<Show when={browserEnabled()}>
                <LazyBrowserPaneView sessionId={currentSession()} browser={browser}
                  active={!settingsOpen() && workbenchState().open && workbenchState().tab === "browser"}
                  newTabEntry={browserEntryOpen()} entryDraft={browserEntryOpen() ? browserEntry().draft : ""}
                  onEntryDraftChange={(draft) => setBrowserEntry({ scope: workbench.key(), open: true, draft, resumeUntouched: false })}
                  onNewTabOpened={() => resetBrowserEntry(false)} />
              </Show>}
              inspector={<Inspector open={!settingsOpen() && inspecting()} sessionId={currentSession()}
                workspace={displayWorkspace()} fileChangeGroups={fileChanges()} historyStatus={historyStatus()}
                onEditWorkspace={() => setWorkspaceOpen(true)} onOpenReview={openReview} onCopySessionId={copySessionId}
                onSelectActor={selectWorkbenchActor} selectedActorId={workbenchState().subagents.childId} />}
              review={<ReviewPane sessionId={currentSession()} groups={fileChanges()}
                workspace={displayWorkspace()} targetFile={workbenchState().reviewTarget}
                historyStatus={historyStatus()} status={subagentFileStatus()} />}
              subagents={<SubagentsPane rootId={rootId()} descendantCount={descendants()}
                active={!settingsOpen() && workbenchState().open && workbenchState().tab === "subagents"}
                selection={workbenchState().subagents} readingAnchors={childAnchors()}
                theme={theme().themeMode} onOpenLink={openLink} onPreviewImage={setImage}
                onSelectChild={selectWorkbenchActor}
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
          <Show when={sessionDrop.active()}>
            <div class="pointer-events-none absolute inset-0 z-[60] m-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/10 text-sm font-medium text-primary">
              {text("drop_to_open_session")}
            </div>
          </Show>
          <header role="banner" class="flex min-h-12 shrink-0 items-center gap-2 border-b px-3 py-2">
            <Button variant="ghost" size="icon" class={sidebarCollapsed() ? "" : "md:hidden"}
              aria-label={text("menu_4ce4cafd")} onClick={() => {
                setSidebarOpen(true); setSidebarCollapsed(false)
              }}>
              <PanelLeftOpen class="size-4" />
            </Button>
            <h1 class="min-w-0 flex-1 truncate text-sm font-semibold">
              {chat.currentChat?.title || text("new_session_c57c30bc")}
            </h1>
            <Show when={currentSession()}>
              <Button size="icon" variant="ghost" title={displayWorkspace() ?? undefined}
                aria-label={text("select_working_directory_18240aa3")} onClick={() => setWorkspaceOpen(true)}>
                <FolderClosed class="size-4" />
              </Button>
            </Show>
            <Show when={sideChatScope()}>
              <Button size="icon" variant="ghost" title={text("side_chat_open")} aria-label={text("side_chat_open")}
                onClick={() => openSideChat()}>
                <MessageSquarePlus class="size-4" />
              </Button>
            </Show>
            <Show when={workEnabled()}>
              <Show when={workBinding()} keyed fallback={
                <Button size="icon" variant="ghost" aria-label={text("supervisor_work_tab")}
                  data-testid="ticket-work-status" onClick={() => openWorkbenchTab("work")}>
                  <ListChecks class="size-4" />
                </Button>
              }>
                <SupervisorOverview controller={tickets} onSelectWork={openTicketWork}
                  running={Boolean(chat.currentChat && sessionHasLiveWork(chat.currentChat, executions()[chat.currentChat.id], backgroundBash()))} />
              </Show>
            </Show>
            <Show when={taskList().length > 0}>
              <Button size="icon" variant="ghost" title={text("session_task_dag_open")} aria-label={text("session_task_dag_open")}
                onClick={() => openWorkbenchTab("task-dag")}> <Workflow class="size-4" /> </Button>
            </Show>
            <Show when={currentSession()}>
              <EnvironmentLauncher environment={environment} />
              <Button size="icon" variant="ghost" title={text("open_subagent_tree")}
                aria-label={text("open_subagent_tree")} onClick={() => workbench.capture().update((state) => ({
                  ...activateWorkbenchTab(state, "subagents"), subagents: { ...state.subagents, view: "tree" },
                }))}>
                <Bot class="size-4" />
              </Button>
            </Show>
            <Show when={currentSession()} keyed>{(id) => (
              <DropdownMenu>
                <DropdownMenuTrigger aria-label={text("more_38844b13")} class="rounded-md p-2 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                  <MoreHorizontal class="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent class="min-w-44">
                  <DropdownMenuItem onSelect={() => { if (chat.currentChat?.id === id) setSessionToClear(chat.currentChat) }}>
                    <RotateCcw />{text("conversation_clear_action")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => { if (currentSession() === id) setWorkflowSession(id) }}>
                    <BookText />{text("workflow_run_title")}
                  </DropdownMenuItem>
                  <Show when={chat.messages.length !== 0}>
                    <DropdownMenuItem onSelect={() => { void exportConversation("markdown") }}>
                      <Download />{text("export_as_markdown_ac8b027c")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => { void exportConversation("pdf") }}>
                      <FileDown />{text("export_as_pdf_e42c8735")}
                    </DropdownMenuItem>
                  </Show>
                </DropdownMenuContent>
              </DropdownMenu>
            )}</Show>
            <Button size="icon" variant="ghost"
              aria-label={text(workbenchState().open ? "collapse_side_panel_e7d2fdd8" : "open_side_panel_732ea38b")}
              aria-expanded={workbenchState().open ? "true" : "false"} aria-controls="right-workbench"
              onClick={() => workbench.capture().setField("open", !workbenchState().open)}>
              <PanelRightOpen />
            </Button>
          </header>
          <div data-chat-layout="" ref={environment.bindLayout} class="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div data-chat-body="true" data-session-drop-target="main" ref={sessionDrop.bindTarget} class="flex min-h-0 min-w-0 flex-1 flex-col"
            style={{ "padding-inline-end": `${environment.reservedWidth()}px`, transition: "padding-inline-end 200ms ease-out" }}>
          <Show when={!showHome()} fallback={<Loading fallback={null}>
            <HomeDashboard chats={chat.chats} onOpenSession={(id) => { void select(id).catch(openError) }}
              onPickTemplate={(prefill) => { appStore.getState().setInputContent("", prefill); focusComposer() }} onDescribeTask={focusComposer} />
          </Loading>}>
          <Show when={sessionView()} keyed>{(session) => (
            <ChatViewport chat={chat} theme={theme().themeMode}
              pageVisible={!settingsOpen()} onOpenActor={selectWorkbenchActor}
              onOpenLink={openLink} onPreviewImage={setImage}
              rootAuthority={rootAuthority} onMessageNotice={setNotice}
              attachments={[...runTimeline(), ...(workEnabled() ? supervisorApprovals.entries().map((entry) => ({
                key: entry.key, afterMessageId: entry.afterMessageId,
                render: () => {
                  const latest = () => supervisorApprovals.entries().find((item) => item.key === entry.key) ?? entry
                  return <SupervisorApprovalEntry entry={latest()} onRefresh={supervisorApprovals.refresh}
                    onDecide={(choice) => supervisorApprovals.decide(latest(), choice)} onOpenSession={openRecordedSession} />
                },
              })) : [])]}
              onAskSideChat={sideChatScope() ? (quote) => openSideChat({ quote }) : undefined}
              revealMessage={sideChatReveal()?.scope === sideChatScope() ? sideChatReveal() ?? undefined : undefined}
              onMissingRevealedMessage={() => setNotice({ text: text("side_chat_source_unavailable"), error: false })}
              initialReadingAnchor={session.id ? readingAnchors.get(session.id) : undefined}
              onReadingAnchor={(anchor) => {
                if (!session.id) return
                if (anchor) readingAnchors.set(session.id, anchor)
                else readingAnchors.delete(session.id)
              }} />
          )}</Show>
          </Show>
          <RunInteractions chat={chat} />
          <Show when={currentSession()} keyed>
            {(sessionId) => <SessionVersionMigrationGate sessionId={sessionId} state={chat.executionCompatibility} />}
          </Show>
          <ComposerPanel chat={chat} workspacePath={displayWorkspace()} projectId={newSession()?.projectId ?? null}
            onOpenWorkspacePicker={() => setWorkspaceOpen(true)}
            pageVisible={!settingsOpen()}
            selectedWorktreePath={selectedWorktreePath()} draftEpoch={draftEpoch()} navigationVersion={() => navigationVersion}
            rootAuthority={rootAuthority} ingress={ingress} semantic={semanticComposer()}
            reference={ticketReference()} onClearReference={() => setWorkReference(null)} canSendIngress={tickets.canSendIngress}
            onOpenGoal={(id) => { if (id === currentSession()) openWorkbenchTab("inspector") }}
            onOpenWorkflowRuns={(id) => { if (id === currentSession()) setWorkflowSession(id) }}
            onOpenSideChat={sideChatScope() ? openSideChat : undefined}
            onPreviewImage={setImage} onAttachmentsChange={setDraftAttachments} captureSessionCreated={() => {
              const intent = newSession()
              return (id) => sessionCreated(id, intent)
            }} />
          </div>
          <Show when={currentSession()}>
            <EnvironmentCard environment={environment} workspace={displayWorkspace()}
              projectName={projects()[chat.currentChat?.config?.projectId ?? ""]?.name} placement={chat.currentChat?.placement}
              changes={fileChangeSummary()} sources={environmentSources()} hasEarlier={prefix().canRead} historyStatus={historyStatus()}
              subagentStatus={subagentFileStatus()} onOpenReview={openReview} onPreviewImage={setImage} />
          </Show>
          </div>
        </main>
        </ResizableLayout>
      </div>
      <Show when={settingsOpen()}>
        <Errored fallback={(_failure) => (
          <div role="alert" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <h1>{text("could_not_load_settings_05a4babd")}</h1>
            <p class="text-sm text-muted-foreground">{text("settings_code_could_not_be_loaded_chat_is_still_availab_05bc021f")}</p>
            <Button onClick={closeSettings}>{text("back_to_chat_5b8ac6b1")}</Button>
          </div>
        )}>
          <Loading fallback={<p role="status">{text("loading_settings_69ede7ee")}</p>}>
            <SettingsPage ownerAccess={props.ownerAccess} tab={settingsTab()} onTabChange={setSettingsTab} onClose={closeSettings} />
          </Loading>
        </Errored>
      </Show>
      <Show when={!settingsOpen() && workflowSession() === currentSession() && workflowSession()} keyed>
        {(id) => <Loading fallback={null}>
          <WorkflowRunsDialog sessionId={id} sessionTitle={chat.currentChat?.title ?? id}
            projectId={chat.currentChat?.config?.projectId}
            projectName={projects()[chat.currentChat?.config?.projectId ?? ""]?.name}
            onClose={() => setWorkflowSession(null)} />
        </Loading>}
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
      <Show when={projectWork()} keyed>{(scope) => (
        <ProjectWorkDialog project={projects()[scope.id] ?? null} metadataError={projectWorkError()}
          ownerAccess={props.ownerAccess} onClose={() => setProjectWork(null)} onOpenSession={openProjectWorkSession} />
      )}</Show>
      <Show when={props.ownerAccess && projectToEdit()} keyed>{(id) => (
        <Loading fallback={null}>
          <ProjectEditDialog projectId={id} onClose={() => setProjectToEdit(null)} />
        </Loading>
      )}</Show>
      <Show when={sessionToClear()} keyed>{(session) => (
        <ConversationClearDialog sessionId={session.id} title={session.title || session.id} onClose={() => setSessionToClear(null)} />
      )}</Show>
      <ResponsiveDialog open={sessionToDelete() !== null} onOpenChange={(open) => {
        if (!open && !confirmationBusy()) setSessionToDelete(null)
      }}>
        <ResponsiveDialogContent class="p-5" showCloseButton={false} dismissable={!confirmationBusy()}>
          <ResponsiveDialogTitle>{text("delete_session_d51250d1")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription class="mt-2">
            {text("delete_session_description", { title: sessionToDelete()?.title ?? "" })}
          </ResponsiveDialogDescription>
          <div class="mt-5 flex justify-end gap-2">
            <Button variant="secondary" disabled={confirmationBusy()} onClick={() => setSessionToDelete(null)}>
              {text("cancel_2cd0f3be")}
            </Button>
            <Button variant="destructive" disabled={confirmationBusy()} onClick={() => { void confirmDeletion() }}>
              {text("delete_2f9daa82")}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <Show when={link()} keyed>{(origin) => <ExternalLinkDialog url={origin.url}
        onClose={() => { if (link() === origin) setLink(null) }}
        onOpenInApp={browserEnabled() && currentSession() ? openLinkInBrowser : undefined} />}</Show>
      <ResponsiveDialog open={image() !== null} onOpenChange={(open) => { if (!open) setImage(null) }}>
        <ResponsiveDialogContent class="p-5" closeLabel={text("close_preview_1eb05d31")}>
          <ResponsiveDialogTitle class="sr-only">{text("close_preview_1eb05d31")}</ResponsiveDialogTitle>
          <img class="mx-auto max-h-[75dvh] object-contain" src={image() ?? undefined} alt="" />
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <Show when={paletteOpen()}>
        <Loading fallback={<Dialog open onOpenChange={(open) => { if (!open) closePalette() }}>
          <DialogContent data-command-palette="" showCloseButton={false}
            class="top-[12vh] w-full max-w-[calc(100%-2rem)] translate-y-0 rounded-2xl bg-popover p-0 shadow-2xl sm:max-w-lg"
            onEscapeKeyDown={(event: KeyboardEvent) => { if (isCommandComposing(event)) event.preventDefault() }}
            onCloseAutoFocus={(event: Event) => event.preventDefault()}>
            <DialogTitle class="sr-only">{text("search_sessions_or_actions_b2a0f9e8")}</DialogTitle>
            <p role="status" class="px-3 py-6 text-center text-sm text-muted-foreground">{text("loading_4927a53b")}</p>
          </DialogContent>
        </Dialog>}>
          <CommandPalette chats={chat.chats} onClose={closePalette}
            onNewChat={newChatFromPalette}
            onSelect={(id) => { setSettingsOpen(false); setSidebarOpen(false); void select(id).catch(openError) }}
            onSettings={openSettings}
            getReturnFocusTarget={() => !settingsOpen() && paletteNavigationVersion === navigationVersion ? paletteReturnFocus() : null} />
        </Loading>
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
