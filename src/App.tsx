import { uiText, useUiLocale } from "@shared/i18n/ui"
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { copyText } from "@shared/utils/clipboard"
import { Inspector } from "@/components/chat/Inspector"
import { LazyCommandPalette } from "@/components/chat/LazyCommandPalette"
import { ExternalLinkProvider } from "@/components/chat/ExternalLinkDialog"
import { LazySettings } from "@/components/chat/LazySettings"
import { Onboarding } from "@/components/chat/Onboarding"
import { WorkspacePicker } from "@/components/chat/WorkspacePicker"
import { useThemeStore } from "@shared/store/themeStore"
import { getUserMessageColors } from "@shared/theme/userMessageColors"
import { applyGlobalAccentToDocument, getGlobalAccentColors } from "@shared/theme/globalAccentColors"
import { useChat } from "@/hooks/useChat"
import { useWorkbenchBrowserSelection } from "@/hooks/useWorkbenchBrowserSelection"
import { useWorkbenchState } from "@/hooks/useWorkbenchState"
import { useWorkbenchWidth } from "@/hooks/useWorkbenchWidth"
import { useResizableWidth } from "@/hooks/useResizableWidth"
import { ResizableLayout } from "@/components/ui/resizable-layout"
import { useIsMobile, useIsWide } from "@shared/hooks/useMediaQuery"
import { useAppStore } from "@shared/store/appStore"
import { isVdiSafeModeEnabled, onVdiSafeModeChange } from "@shared/utils/vdiSafeMode"
import { Sidebar } from "@/components/app/Sidebar"
import { WorktreeManager } from "@/components/app/WorktreeManager"
import { ProjectManagerModal } from "@/components/app/ProjectManagerModal"
import { DeleteSessionDialog } from "@/components/app/DeleteSessionDialog"
import { ChatPane } from "@/components/app/ChatPane"
import { SecondarySessionPane } from "@/components/app/SecondarySessionPane"
import { AvailabilityBanner } from "@/components/app/AvailabilityBanner"
import { ReviewPane } from "@/components/app/ReviewPane"
import { LazyBrowserPaneView } from "@/components/app/LazyBrowserPaneView"
import { useBrowserSession } from "@/hooks/useBrowserSession"
import { isPhoneDevice } from "@/lib/browserAvailability"
import { DEFAULT_SUPERVISOR_SESSION_ID, isDefaultSupervisor } from "@/lib/supervisor"
import { agentClient } from "@services/chat/AgentService"
import { reorderVisibleWorkbenchTabIds, visibleWorkbenchTabIds } from "@/lib/workbenchTabs"
import { captureWorkbenchFocusReturn } from "@/lib/workbenchFocusReturn"
import type { WorkbenchTabDrag } from "@/components/app/workbenchSurfaceContext"
import { RightWorkbenchSurface } from "@/components/app/RightWorkbenchSurface"
import type { RightWorkbenchTab, WorkbenchToolTab } from "@/components/app/RightWorkbench"

// The optional workbench need not add its tab/drag UI to ordinary-chat startup.
const RightWorkbench = lazy(() => import("@/components/app/RightWorkbench").then((module) => ({ default: module.RightWorkbenchContent })))

function App() {
  useUiLocale()
  // The main pane follows the global current session.
  const chat = useChat()
  const { booted, chats, currentSessionId, currentChat, select: selectSession, newChat: createChat } = chat
  const mainNavigationVersion = useRef(0)
  // Navigation intent matters even when returning to the same session or
  // starting another empty composer while Supervisor is still opening.
  const select = useCallback((id: string) => {
    mainNavigationVersion.current += 1
    setPaletteOpen(false)
    selectSession(id)
  }, [selectSession])
  const newChat = useCallback(() => {
    mainNavigationVersion.current += 1
    setPaletteOpen(false)
    createChat()
  }, [createChat])

  // Only a confirmed root mounts the interactive side chat; unknown and child
  // sessions use the message-only projection until summary metadata resolves.
  const { state: workbenchState, setField: setWorkbenchField, scope: workbenchScope, openToolForSession } = useWorkbenchState(currentSessionId)
  const currentWorkbenchScope = useRef(workbenchScope)
  currentWorkbenchScope.current = workbenchScope
  const getCurrentWorkbenchScope = useCallback(() => currentWorkbenchScope.current, [])
  const { secondSid, open: workbenchOpen, tab: workbenchTab, tools: openToolTabs,
    reviewTarget: reviewTargetFilePath } = workbenchState
  const setSecondSid = (value: string | null) => setWorkbenchField("secondSid", value)
  const setWorkbenchOpen = (value: React.SetStateAction<boolean>) => setWorkbenchField("open", value)
  const setWorkbenchTab = useCallback((value: React.SetStateAction<RightWorkbenchTab | null>) => setWorkbenchField("tab", value), [setWorkbenchField])
  const setOpenToolTabs = (value: React.SetStateAction<WorkbenchToolTab[]>) => setWorkbenchField("tools", value)
  const setReviewTargetFilePath = (value: string | null) => setWorkbenchField("reviewTarget", value)
  const pickSecond = (id: string | null) => setSecondSid(id)
  useEffect(() => {
    if (!secondSid) return
    // Restore summary metadata only; an absent/deleted target retains the
    // message-only fallback and never starts a run or creates a replacement.
    const store = useAppStore.getState()
    if (!store.chats.some((item) => item.id === secondSid)) {
      void store.restoreSession(secondSid).catch(() => false)
    }
  }, [secondSid, workbenchScope])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const workbenchTabDragRef = useRef<WorkbenchTabDrag | null>(null)
  const paletteReturnFocusRef = useRef<() => HTMLElement | null>(() => null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault()
        if (!paletteOpen) {
          paletteReturnFocusRef.current = captureWorkbenchFocusReturn(
            document.activeElement instanceof HTMLElement ? document.activeElement : null,
            getCurrentWorkbenchScope(), getCurrentWorkbenchScope, workbenchTabDragRef.current?.getSourceId(),
          )
        }
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [paletteOpen, getCurrentWorkbenchScope])

  const workbenchSelectionVersionRef = useRef(0)
  const [workPanelTarget, setWorkPanelTarget] = useState<HTMLDivElement | null>(null)
  const workEnabled = !!currentChat && isDefaultSupervisor(currentChat)
  const visibleToolTabs = openToolTabs.filter((tab) => tab !== "work" || workEnabled)

  const [browserEntryOpen, setBrowserEntryOpen] = useState(false)
  const [browserEntryDraft, setBrowserEntryDraft] = useState("")
  const [browserEntryTouched, setBrowserEntryTouched] = useState(false)
  const browserEntrySessionRef = useRef<{ sessionId: string | null; initialStateMissing: boolean } | null>(null)
  const [browserStartedSessionId, setBrowserStartedSessionId] = useState<string | null>(null)
  const [pendingBrowserNavigation, setPendingBrowserNavigation] = useState<{ sessionId: string; url: string } | null>(null)
  const pendingBrowserNavigationAttemptRef = useRef<typeof pendingBrowserNavigation>(null)
  const isMobile = useIsMobile()
  const isWide = useIsWide()
  const browserEnabled = !isMobile && !isPhoneDevice()
  const browser = useBrowserSession(
    currentSessionId,
    browserEnabled && workbenchOpen && (
      workbenchTab === "browser" || workbenchState.browserPresent || browserStartedSessionId === currentSessionId
    ),
  )
  const { readySessionId: browserReadySessionId, state: browserState, openUrlInNewTab, hasPendingDialog, activateTab } = browser
  const browserTabsForWorkbench = browserReadySessionId === currentSessionId ? browserState?.tabs : null
  const selectedWorkbenchTab = (!browserEnabled && workbenchTab === "browser") || (!workEnabled && workbenchTab === "work") ? null : workbenchTab

  useEffect(() => {
    if (browserReadySessionId !== currentSessionId || !browserState?.tabs) return
    setWorkbenchField("order", (saved) => {
      const next = visibleWorkbenchTabIds(openToolTabs, browserState.tabs, saved)
      return next.length === saved.length && next.every((key, index) => key === saved[index]) ? saved : next
    })
    setWorkbenchField("browserPresent", browserState.tabs.length > 0)
  }, [openToolTabs, browserState?.tabs, browserReadySessionId, currentSessionId, setWorkbenchField])

  const saveBrowserSelection = useCallback((id: string | null) => setWorkbenchField("browserActiveId", id), [setWorkbenchField])
  useWorkbenchBrowserSelection({
    scope: workbenchScope,
    state: browserReadySessionId === currentSessionId ? browserState : null,
    savedId: workbenchState.browserActiveId,
    selectionVersion: workbenchSelectionVersionRef,
    activateTab,
    save: saveBrowserSelection,
  })

  useEffect(() => {
    if (browserEntrySessionRef.current?.sessionId !== currentSessionId) {
      setBrowserEntryOpen(false)
      setBrowserEntryDraft("")
      setBrowserEntryTouched(false)
    }
  }, [currentSessionId])

  useEffect(() => {
    // A selected browser tab follows the newly selected chat. Remember that
    // chat so switching to another workbench tab keeps its browser session live.
    if (browserEnabled && workbenchOpen && workbenchTab === "browser") {
      setBrowserStartedSessionId(currentSessionId)
    }
  }, [browserEnabled, currentSessionId, workbenchOpen, workbenchTab])

  useEffect(() => {
    if (!pendingBrowserNavigation) return
    if (pendingBrowserNavigation.sessionId !== currentSessionId) {
      setPendingBrowserNavigation(null)
      pendingBrowserNavigationAttemptRef.current = null
      return
    }
    if (browserReadySessionId !== currentSessionId || !browserState) return
    if (browserState.pending_dialog) {
      setBrowserEntryOpen(false)
      return
    }
    if (pendingBrowserNavigationAttemptRef.current === pendingBrowserNavigation) return
    pendingBrowserNavigationAttemptRef.current = pendingBrowserNavigation
    void openUrlInNewTab(pendingBrowserNavigation.url).then((opened) => {
      if (pendingBrowserNavigationAttemptRef.current !== pendingBrowserNavigation) return
      pendingBrowserNavigationAttemptRef.current = null
      if (opened) {
        setPendingBrowserNavigation((current) => current === pendingBrowserNavigation ? null : current)
        setBrowserEntryOpen(false)
      } else if (!hasPendingDialog()) {
        setPendingBrowserNavigation((current) => current === pendingBrowserNavigation ? null : current)
      }
    })
  }, [pendingBrowserNavigation, currentSessionId, browserReadySessionId, browserState, openUrlInNewTab, hasPendingDialog])
  useEffect(() => {
    if (!browserEntryOpen || browserReadySessionId !== currentSessionId || !browserState) return
    const origin = browserEntrySessionRef.current
    if (origin?.sessionId !== currentSessionId || !origin.initialStateMissing) return
    origin.initialStateMissing = false
    const hasPage = browserState.tabs
      ? browserState.tabs.length > 0
      : Boolean(browserState.url && browserState.url !== "about:blank")
    if (hasPage && !browserEntryTouched && !pendingBrowserNavigation) setBrowserEntryOpen(false)
  }, [browserEntryOpen, browserReadySessionId, currentSessionId, browserState, browserEntryTouched, pendingBrowserNavigation])
  useEffect(() => {
    if (browserReadySessionId !== currentSessionId || !browserState?.tabs?.length) return
    if (workbenchOpen && workbenchTab === null && openToolTabs.length === 0) setWorkbenchTab("browser")
  }, [browserReadySessionId, currentSessionId, browserState?.tabs, workbenchOpen, workbenchTab, openToolTabs, setWorkbenchTab])
  // Draggable, persisted widths for the resizable side panels (desktop).
  const sidebarResize = useResizableWidth("lotus_next_sidebar_w", 288, {
    min: 220,
    max: 420,
  })
  const workbenchResize = useWorkbenchWidth(sidebarCollapsed ? 0 : sidebarResize.width)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const chatShellRef = useRef<HTMLDivElement>(null)
  const settingsReturnFocusRef = useRef<() => HTMLElement | null>(() => null)
  const openSettings = () => {
    if (!settingsOpen) {
      settingsReturnFocusRef.current = paletteOpen
        ? paletteReturnFocusRef.current
        : captureWorkbenchFocusReturn(
          document.activeElement instanceof HTMLElement ? document.activeElement : null,
          getCurrentWorkbenchScope(), getCurrentWorkbenchScope, workbenchTabDragRef.current?.getSourceId(),
        )
    }
    setSidebarOpen(false)
    setPaletteOpen(false)
    setSettingsOpen(true)
  }
  const closeSettings = () => {
    setSettingsOpen(false)
    requestAnimationFrame(() => {
      const opener = settingsReturnFocusRef.current()
      if (opener?.isConnected && opener.getClientRects().length > 0) opener.focus()
      else chatShellRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus()
    })
  }
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null)
  // Workspace chosen in the picker — shared across the main pane (composer +
  // inspector). The session's own cwd wins for display; otherwise the picked one.
  const [pickedWorkspace, setPickedWorkspace] = useState<string | null>(null)
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  // Project selected for the NEXT new chat (project-grouped sidebar "新建").
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null)
  const [projectManagerOpen, setProjectManagerOpen] = useState(false)
  const [worktreesOpen, setWorktreesOpen] = useState(false)
  const [pickedWorktree, setPickedWorktree] = useState<{ projectId: string; path: string } | null>(null)
  const [copyFeedback, setCopyFeedback] = useState<{ message: string; failed: boolean } | null>(null)

  useEffect(() => {
    if (!copyFeedback) return
    const timer = setTimeout(() => setCopyFeedback(null), 2500)
    return () => clearTimeout(timer)
  }, [copyFeedback])

  const copySessionId = async (sessionId: string) => {
    try {
      await copyText(sessionId)
      setCopyFeedback({ message: uiText("session_id_copied_3afb54a6"), failed: false })
    } catch {
      setCopyFeedback({ message: uiText("could_not_copy_session_id_3db157e7"), failed: true })
    }
  }

  // Project store bootstrap: needed for project grouping labels + the manager.
  useEffect(() => {
    useAppStore
      .getState()
      .loadProjects()
      .catch(() => {
        // projectsAvailable=false hides the surface on 404; other failures retry
        // the next time the manager modal opens.
      })
  }, [])

  const themeMode = useThemeStore((s) => s.themeMode)
  const userMessageColorPreset = useThemeStore((s) => s.userMessageColorPreset)
  const customUserMessageColor = useThemeStore((s) => s.customUserMessageColor)
  const globalAccentPreset = useThemeStore((s) => s.globalAccentPreset)
  const customGlobalAccentColor = useThemeStore((s) => s.customGlobalAccentColor)
  useEffect(() => {
    document.documentElement.classList.toggle("dark", themeMode === "dark")
  }, [themeMode])
  useEffect(() => {
    const colors = getUserMessageColors(themeMode, userMessageColorPreset, customUserMessageColor)
    document.documentElement.style.setProperty("--user-message-background", colors.background)
    document.documentElement.style.setProperty("--user-message-foreground", colors.foreground)
  }, [themeMode, userMessageColorPreset, customUserMessageColor])
  useEffect(() => {
    const accent = getGlobalAccentColors(themeMode, globalAccentPreset, customGlobalAccentColor)
    applyGlobalAccentToDocument(accent)
  }, [themeMode, globalAccentPreset, customGlobalAccentColor])

  // VDI / graphics compatibility mode (ported from legacy lotus): reflect the
  // persisted flag as a `data-vdi-safe` attribute so CSS can strip blur/glass
  // effects. onVdiSafeModeChange covers other tabs (key-filtered `storage`) and
  // this tab (custom event, toggled from 设置 → 系统 → 应用).
  useEffect(() => {
    const sync = () => {
      const enabled = isVdiSafeModeEnabled() ? "true" : "false"
      document.body.setAttribute("data-vdi-safe", enabled)
      document.getElementById("root")?.setAttribute("data-vdi-safe", enabled)
    }
    sync()
    return onVdiSafeModeChange(sync)
  }, [])

  const loadSkills = useAppStore((s) => s.loadSkills)
  const persistSessionTitle = useAppStore((s) => s.persistSessionTitle)
  const deleteSession = useAppStore((s) => s.deleteSession)
  const pinSession = useAppStore((s) => s.pinSession)
  const unpinSession = useAppStore((s) => s.unpinSession)
  useEffect(() => {
    void loadSkills()
  }, [loadSkills])

  const workspacePath = currentChat?.config?.workspacePath
  const displayWorkspace = workspacePath ?? pickedWorkspace
  const secondSession = chats.find((item) => item.id === secondSid)
  const visibleTabIds = visibleWorkbenchTabIds(
    visibleToolTabs,
    browserTabsForWorkbench,
    workbenchState.order,
  )
  const closeSuccessor = (key: string) => {
    const index = visibleTabIds.indexOf(key)
    const remaining = visibleTabIds.filter((item) => item !== key)
    return remaining[index] ?? remaining[index - 1] ?? null
  }
  const pruneSavedTab = (key: string) => {
    setWorkbenchField("order", (current) => current.filter((item) => item !== key))
  }
  const selectCloseSuccessor = (key: string | null, activeBrowserTabId = browserState?.active_tab_id) => {
    workbenchSelectionVersionRef.current += 1
    if (key?.startsWith("tool:")) {
      setWorkbenchTab(key.slice("tool:".length) as WorkbenchToolTab)
    } else if (key?.startsWith("browser:")) {
      const tabId = key.slice("browser:".length)
      setWorkbenchTab("browser")
      setBrowserEntryOpen(false)
      if (tabId !== activeBrowserTabId) void browser.activateTab(tabId)
    } else {
      setWorkbenchTab(null)
    }
  }
  const openWorkbench = (tab: RightWorkbenchTab) => {
    workbenchSelectionVersionRef.current += 1
    if (tab === "browser") {
      setBrowserStartedSessionId(currentSessionId)
      const resumeLegacyPage = browserReadySessionId === currentSessionId
        && browserState !== null
        && browserState.tabs === undefined
        && Boolean(browserState.url && browserState.url !== "about:blank")
      if (resumeLegacyPage) {
        setBrowserEntryOpen(false)
      } else {
        browserEntrySessionRef.current = {
          sessionId: currentSessionId,
          initialStateMissing: browserReadySessionId !== currentSessionId || !browserState,
        }
        setBrowserEntryDraft("")
        setBrowserEntryTouched(false)
        setBrowserEntryOpen(true)
      }
    } else {
      setOpenToolTabs((current) => current.includes(tab) ? current : [...current, tab])
    }
    setWorkbenchTab(tab)
    setWorkbenchOpen(true)
  }
  const closeToolTab = (tab: WorkbenchToolTab) => {
    workbenchSelectionVersionRef.current += 1
    const key = `tool:${tab}`
    const successor = closeSuccessor(key)
    setOpenToolTabs((current) => current.filter((item) => item !== tab))
    pruneSavedTab(key)
    if (workbenchTab === tab) selectCloseSuccessor(successor)
  }
  const closeBrowserTab = (tabId: string) => {
    workbenchSelectionVersionRef.current += 1
    const key = `browser:${tabId}`
    const successor = closeSuccessor(key)
    const wasSelected = workbenchTab === "browser" && browserState?.active_tab_id === tabId && !browserEntryOpen
    const selectionVersion = workbenchSelectionVersionRef.current
    void browser.closeTab(tabId).then((closed) => {
      if (!closed) return
      pruneSavedTab(key)
      if (wasSelected && workbenchSelectionVersionRef.current === selectionVersion) {
        selectCloseSuccessor(successor, closed.active_tab_id)
      }
    })
  }
  const openLinkInApp = (url: string) => {
    if (!currentSessionId || !browserEnabled) return
    setPendingBrowserNavigation({ sessionId: currentSessionId, url })
    if (browserReadySessionId === currentSessionId && browserState?.pending_dialog) {
      setBrowserEntryOpen(false)
      setWorkbenchTab("browser")
      setWorkbenchOpen(true)
    } else {
      openWorkbench("browser")
    }
  }
  const openReview = (filePath?: string) => {
    setReviewTargetFilePath(filePath ?? null)
    openWorkbench("review")
  }
  const toggleWorkbench = () => {
    setWorkbenchOpen((open) => !open)
  }
  const toggleSideSession = () => {
    if (workbenchOpen && workbenchTab === "session") {
      setWorkbenchOpen(false)
      return
    }
    openWorkbench("session")
  }
  const openSubagentPreview = (childId: string) => {
    pickSecond(childId)
    openWorkbench("session")
  }

  return (
    <ExternalLinkProvider onOpenInApp={browserEnabled && currentSessionId ? openLinkInApp : undefined}>
    <div className="relative flex h-full min-h-0 flex-col bg-background text-foreground">
    {/* Preserve drafts, streaming subscriptions and workbench state across navigation. */}
    <div
      ref={chatShellRef}
      data-slot="chat-shell"
      inert={settingsOpen}
      aria-hidden={settingsOpen || undefined}
      className={`relative h-full min-h-0 overflow-hidden ${settingsOpen ? "hidden" : "flex"}`}
    >
      {/* WSS-only transport: surface a dead /v2/stream connection instead of
          silently freezing. Renders nothing while the connection is healthy. */}
      <AvailabilityBanner />

      {/* Register the stable parent layer before any global dialogs. Lazy
          tab content must never mount its own later, higher-priority layer. */}
      <ResizableLayout
        sidebarCollapsed={sidebarCollapsed}
        workbenchDocked={isWide && workbenchOpen}
        sidebarWidth={sidebarResize}
        workbenchWidth={workbenchResize}
        workbenchMaxWidth={workbenchResize.maxWidth}
        viewportWidth={workbenchResize.viewportWidth}
        suspended={settingsOpen || paletteOpen}
        scopeKey={workbenchScope}
        sidebar={(
          <Sidebar
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            width="100%"
            chats={chats}
            booted={booted}
            currentSessionId={currentSessionId}
            onNewChat={(projectId) => {
              setPickedWorktree(null)
              setPendingProjectId(projectId ?? null)
              // The project (or its default workspace) owns the next session's cwd.
              if (projectId) setPickedWorkspace(null)
              newChat()
            }}
            onSelect={async (id) => {
              const version = ++mainNavigationVersion.current
              const previousSessionId = useAppStore.getState().currentSessionId
              if (id === DEFAULT_SUPERVISOR_SESSION_ID) {
                await agentClient.ensureDefaultSupervisor()
                if (!await useAppStore.getState().restoreSession(id)) {
                  throw new Error(uiText("workflow_run_not_found"))
                }
                if (version !== mainNavigationVersion.current || previousSessionId !== useAppStore.getState().currentSessionId) return
              }
              if (isWide && id === DEFAULT_SUPERVISOR_SESSION_ID) openToolForSession(id, "work")
              select(id)
            }}
            onRename={(id, title) => persistSessionTitle(id, title)}
            onDelete={(c) => setPendingDelete({ id: c.id, title: c.title || uiText("new_session_c57c30bc") })}
            onTogglePin={(c) => (c.pinned ? unpinSession(c.id) : pinSession(c.id))}
            onCopySessionId={copySessionId}
            onOpenSettings={openSettings}
            onOpenProjectManager={() => setProjectManagerOpen(true)}
            onOpenWorktrees={() => setWorktreesOpen(true)}
          />
        )}
        workbench={(
          <RightWorkbenchSurface
            tabDragRef={workbenchTabDragRef}
            interactionSuspended={paletteOpen}
            focusScopeKey={workbenchScope}
            getCurrentFocusScope={getCurrentWorkbenchScope}
            visible={workbenchOpen}
            pageVisible={!settingsOpen}
            docked={isWide}
            width="100%"
            onClose={() => setWorkbenchOpen(false)}
          >
            {workbenchOpen || (workEnabled && openToolTabs.includes("work")) ? (
              <Suspense fallback={null}>
              <RightWorkbench
                visible={workbenchOpen}
                activeTab={selectedWorkbenchTab}
                openToolTabs={visibleToolTabs}
                workEnabled={workEnabled}
                work={<div ref={setWorkPanelTarget} className="min-h-0 flex-1 overflow-y-auto" />}
                tabOrder={workbenchState.order}
                onTabReorder={(order) => {
                  workbenchSelectionVersionRef.current += 1
                  setWorkbenchField("order", (current) => reorderVisibleWorkbenchTabIds(current, order))
                }}
                onToolClose={closeToolTab}
                browserEnabled={browserEnabled}
                browserSessionAvailable={Boolean(currentSessionId)}
                browserEntryOpen={browserEntryOpen}
                browserTabs={browserTabsForWorkbench}
                activeBrowserTabId={browser.readySessionId === currentSessionId ? browser.state?.active_tab_id : null}
                browserBusy={browser.busy || Boolean(browser.state?.pending_dialog)}
                onBrowserActivate={(tabId) => {
                  workbenchSelectionVersionRef.current += 1
                  setWorkbenchTab("browser")
                  setBrowserEntryOpen(false)
                  if (tabId !== browser.state?.active_tab_id) void browser.activateTab(tabId)
                }}
                onBrowserClose={closeBrowserTab}
                onTabChange={(tab) => {
                  if (tab === null) {
                    workbenchSelectionVersionRef.current += 1
                    setWorkbenchTab(null)
                    setBrowserEntryOpen(false)
                    return
                  }
                  if (tab === "review") setReviewTargetFilePath(null)
                  openWorkbench(tab)
                }}
                onClose={() => setWorkbenchOpen(false)}
                sessionTitle={secondSession?.title}
                inspector={
                  <Inspector
                    embedded
                    sessionId={currentSessionId}
                    open={workbenchOpen && selectedWorkbenchTab === "inspector"}
                    onClose={() => setWorkbenchOpen(false)}
                    workspace={displayWorkspace}
                    onEditWorkspace={() => setWsPickerOpen(true)}
                    onOpenReview={openReview}
                    onCopySessionId={copySessionId}
                    selectedActorId={secondSid ?? currentSessionId ?? null}
                    onSelectActor={(actorId) => {
                      const rootId = currentChat?.kind === "root" ? currentSessionId : currentChat?.rootSessionId
                      if (actorId === rootId) {
                        pickSecond(null)
                        openToolForSession(actorId, "inspector")
                        select(actorId)
                      } else openSubagentPreview(actorId)
                    }}
                  />
                }
                review={(
                  <ReviewPane
                    sessionId={currentSessionId}
                    liveSegments={chat.liveSegments}
                    workspace={displayWorkspace}
                    targetFilePath={reviewTargetFilePath}
                  />
                )}
                browser={browserEnabled ? (
                  <LazyBrowserPaneView
                    key={currentSessionId ?? "no-session"}
                    sessionId={currentSessionId}
                    active={workbenchOpen && workbenchTab === "browser"}
                    newTabEntry={browserEntryOpen}
                    entryDraft={browserEntryDraft}
                    onEntryDraftChange={(draft) => {
                      setBrowserEntryDraft(draft)
                      setBrowserEntryTouched(true)
                    }}
                    onNewTabOpened={() => {
                      setBrowserEntryOpen(false)
                      setBrowserEntryDraft("")
                    }}
                    browser={browser}
                  />
                ) : null}
                session={(
                  <SecondarySessionPane
                    sessionId={secondSid}
                    pageVisible={!settingsOpen}
                    active={workbenchOpen && selectedWorkbenchTab === "session"}
                    chats={chats}
                    onPickSession={pickSecond}
                    onClose={() => setWorkbenchOpen(false)}
                    onOpenInspector={() => setWorkbenchTab("inspector")}
                    onOpenReview={() => setWorkbenchTab("review")}
                  />
                )}
              />
              </Suspense>
            ) : null}
          </RightWorkbenchSurface>        )}
      >
        <ChatPane
          chat={{ ...chat, select, newChat }}
          pageVisible={!settingsOpen}
          pickedWorkspace={pickedWorkspace}
          worktreePath={pickedWorktree?.projectId === pendingProjectId ? pickedWorktree.path : null}
          pendingProjectId={pendingProjectId}
          onSelectProject={(projectId) => {
            setPendingProjectId(projectId)
            setPickedWorktree(null)
            // A manual project pick owns the workspace; drop a manual choice.
            if (projectId) setPickedWorkspace(null)
          }}
          onOpenWorkspacePicker={() => setWsPickerOpen(true)}
          onOpenInspector={() => openWorkbench("inspector")}
          onOpenReview={() => openReview()}
          workPanelTarget={workEnabled ? workPanelTarget : null}
          onOpenWork={workEnabled ? () => openWorkbench("work") : undefined}
          onWorkReference={() => { if (!isWide) setWorkbenchOpen(false) }}
          sidePaneOpen={workbenchOpen}
          onToggleSidePane={toggleWorkbench}
          splitOpen={workbenchOpen && workbenchTab === "session"}
          onToggleSplit={toggleSideSession}
          onSelectSubAgent={openSubagentPreview}
          onOpenSidebar={() => {
            setSidebarOpen(true)
            setSidebarCollapsed(false)
          }}
          sidebarCollapsed={sidebarCollapsed}
        />

      </ResizableLayout>

      <Onboarding />

      <WorkspacePicker
        open={wsPickerOpen}
        current={displayWorkspace}
        locked={!!workspacePath}
        onClose={() => setWsPickerOpen(false)}
        onSelect={(p) => {
          setPickedWorkspace(p)
          setPickedWorktree(null)
          // Manual workspace choice overrides a project pick for the next chat.
          if (p) setPendingProjectId(null)
        }}
      />

      <WorktreeManager open={worktreesOpen} onClose={() => setWorktreesOpen(false)}
        onOpen={(projectId, path) => {
          newChat()
          setPendingProjectId(projectId)
          setPickedWorkspace(path)
          setPickedWorktree({ projectId, path })
          setWorktreesOpen(false)
        }}
        onSession={(id) => { select(id); setWorktreesOpen(false) }}
      />
      <ProjectManagerModal open={projectManagerOpen} onClose={() => setProjectManagerOpen(false)} />

      <DeleteSessionDialog
        pending={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={(id) => {
          void deleteSession(id)
          setPendingDelete(null)
        }}
      />
      {copyFeedback ? (
        <div
          role={copyFeedback.failed ? "alert" : "status"}
          className="pointer-events-none fixed inset-x-0 bottom-28 z-[110] flex justify-center px-4"
        >
          <span className="rounded-full border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-xl">
            {copyFeedback.message}
          </span>
        </div>
      ) : null}
    </div>
      <LazySettings open={settingsOpen} onClose={closeSettings} />
      <LazyCommandPalette
        getReturnFocusTarget={paletteReturnFocusRef.current}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        chats={chats}
        onSelect={(id) => {
          setSettingsOpen(false)
          select(id)
          setSidebarOpen(false)
        }}
        onNewChat={() => {
          setSettingsOpen(false)
          newChat()
        }}
        onSettings={openSettings}
      />
    </div>
    </ExternalLinkProvider>
  )
}

export default App
