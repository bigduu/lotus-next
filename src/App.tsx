import { useEffect, useRef, useState } from "react"
import { copyText } from "@shared/utils/clipboard"
import { Inspector } from "@/components/chat/Inspector"
import { CommandPalette } from "@/components/chat/CommandPalette"
import { ExternalLinkProvider } from "@/components/chat/ExternalLinkDialog"
import { LazySettings } from "@/components/chat/LazySettings"
import { Onboarding } from "@/components/chat/Onboarding"
import { WorkspacePicker } from "@/components/chat/WorkspacePicker"
import { useThemeStore } from "@shared/store/themeStore"
import { useChat } from "@/hooks/useChat"
import { useResizableWidth } from "@/hooks/useResizableWidth"
import { ResizeHandle } from "@/components/ui/resize-handle"
import { useIsMobile, useIsWide } from "@shared/hooks/useMediaQuery"
import { useAppStore } from "@shared/store/appStore"
import { isVdiSafeModeEnabled, onVdiSafeModeChange } from "@shared/utils/vdiSafeMode"
import { Sidebar } from "@/components/app/Sidebar"
import { ProjectManagerModal } from "@/components/app/ProjectManagerModal"
import { DeleteSessionDialog } from "@/components/app/DeleteSessionDialog"
import { ChatPane } from "@/components/app/ChatPane"
import { SubagentTranscriptPane } from "@/components/app/SubagentTranscriptPane"
import { AvailabilityBanner } from "@/components/app/AvailabilityBanner"
import { ReviewPane } from "@/components/app/ReviewPane"
import { BrowserPaneView } from "@/components/app/BrowserPane"
import { useBrowserSession } from "@/hooks/useBrowserSession"
import { isPhoneDevice } from "@/lib/browserAvailability"
import { visibleWorkbenchTabIds } from "@/lib/workbenchTabs"
import {
  RightWorkbench,
  type RightWorkbenchTab,
  type WorkbenchToolTab,
} from "@/components/app/RightWorkbench"

function App() {
  // The main pane follows the global current session.
  const chat = useChat()
  const { booted, chats, currentSessionId, currentChat, select, newChat } = chat

  // Root sessions can be interactive in the side pane. Child previews use the
  // read-only message projection without subscribing to their agent channel.
  const [secondSid, setSecondSid] = useState<string | null>(null)
  const [projectedChildSid, setProjectedChildSid] = useState<string | null>(null)
  const isProjectedChild = secondSid !== null && (
    projectedChildSid === secondSid
    || chats.some((item) => item.id === secondSid && Boolean(item.parentSessionId))
  )
  const [secondLoadState, setSecondLoadState] = useState<"idle" | "loading" | "error">("idle")
  const secondLoadRequest = useRef(0)
  const secondChat = useChat(isProjectedChild ? null : secondSid, (newSid) => {
    setProjectedChildSid(null)
    setSecondSid(newSid)
  })
  const pickSecond = (id: string | null, forceProjection = false) => {
    const request = ++secondLoadRequest.current
    const projected = Boolean(id && (
      forceProjection
      || projectedChildSid === id
      || chats.some((item) => item.id === id && Boolean(item.parentSessionId))
    ))
    setSecondSid(id)
    setProjectedChildSid(projected ? id : null)
    if (!id) {
      setSecondLoadState("idle")
      return
    }

    const store = useAppStore.getState()
    if (projected) {
      // Newly started children can precede the lazy index. Restore metadata,
      // then let SubagentTranscriptPane load projected message history.
      setSecondLoadState("idle")
      if (!store.chats.some((item) => item.id === id)) {
        void store.restoreSession(id).catch(() => false)
      }
      return
    }

    setSecondLoadState("loading")
    void (async () => {
      const exists = store.chats.some((item) => item.id === id)
      if (!exists && !(await store.restoreSession(id))) {
        throw new Error("session unavailable")
      }
      await useAppStore.getState().loadChatHistory(id)
    })()
      .then(() => {
        if (secondLoadRequest.current === request) setSecondLoadState("idle")
      })
      .catch(() => {
        if (secondLoadRequest.current === request) setSecondLoadState("error")
      })
  }

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const [workbenchOpen, setWorkbenchOpen] = useState(false)
  const [workbenchTab, setWorkbenchTab] = useState<RightWorkbenchTab | null>(null)
  const workbenchSelectionVersionRef = useRef(0)
  const [openToolTabs, setOpenToolTabs] = useState<WorkbenchToolTab[]>([])
  const [workbenchOrderBySession, setWorkbenchOrderBySession] = useState<Record<string, string[]>>({})
  const [browserEntryOpen, setBrowserEntryOpen] = useState(false)
  const [browserEntryDraft, setBrowserEntryDraft] = useState("")
  const [browserEntryTouched, setBrowserEntryTouched] = useState(false)
  const browserEntrySessionRef = useRef<{ sessionId: string | null; initialStateMissing: boolean } | null>(null)
  const [browserStartedSessionId, setBrowserStartedSessionId] = useState<string | null>(null)
  const [pendingBrowserNavigation, setPendingBrowserNavigation] = useState<{ sessionId: string; url: string } | null>(null)
  const pendingBrowserNavigationAttemptRef = useRef<typeof pendingBrowserNavigation>(null)
  const [reviewTargetFilePath, setReviewTargetFilePath] = useState<string | null>(null)
  const isMobile = useIsMobile()
  const isWide = useIsWide()
  const browserEnabled = !isMobile && !isPhoneDevice()
  const workbenchOrderScope = currentSessionId ?? "__no_session__"
  const browser = useBrowserSession(
    currentSessionId,
    browserEnabled && workbenchOpen && (
      workbenchTab === "browser" || browserStartedSessionId === currentSessionId
    ),
  )
  const { readySessionId: browserReadySessionId, state: browserState, openUrlInNewTab, hasPendingDialog } = browser
  const browserTabsForWorkbench = browserReadySessionId === currentSessionId ? browserState?.tabs : null
  const selectedWorkbenchTab = !browserEnabled && workbenchTab === "browser" ? null : workbenchTab

  useEffect(() => {
    if (browserReadySessionId !== currentSessionId) return
    setWorkbenchOrderBySession((current) => {
      const saved = current[workbenchOrderScope] ?? []
      const next = visibleWorkbenchTabIds(openToolTabs, browserTabsForWorkbench, saved)
      return next.length === saved.length && next.every((key, index) => key === saved[index])
        ? current
        : { ...current, [workbenchOrderScope]: next }
    })
  }, [workbenchOrderScope, openToolTabs, browserTabsForWorkbench, browserReadySessionId, currentSessionId])

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
    if (browserReadySessionId !== currentSessionId || !browserState?.tabs) return
    if (browserState.tabs.length > 0) {
      if (workbenchOpen && workbenchTab === null && openToolTabs.length === 0) setWorkbenchTab("browser")
    } else if (workbenchTab === "browser" && !browserEntryOpen && !pendingBrowserNavigation) {
      setWorkbenchTab(openToolTabs.at(-1) ?? null)
    }
  }, [browserReadySessionId, currentSessionId, browserState?.tabs, workbenchOpen, workbenchTab, openToolTabs, browserEntryOpen, pendingBrowserNavigation])
  // Draggable, persisted widths for the resizable side panels (desktop).
  const sidebarResize = useResizableWidth("lotus_next_sidebar_w", 288, {
    min: 220,
    max: 420,
    edge: "right",
  })
  const workbenchResize = useResizableWidth("lotus_next_inspector_w", 520, {
    min: 360,
    max: 840,
    edge: "left",
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null)
  // Workspace chosen in the picker — shared across the main pane (composer +
  // inspector). The session's own cwd wins for display; otherwise the picked one.
  const [pickedWorkspace, setPickedWorkspace] = useState<string | null>(null)
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  // Project selected for the NEXT new chat (project-grouped sidebar "新建").
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null)
  const [projectManagerOpen, setProjectManagerOpen] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState<{ message: string; failed: boolean } | null>(null)

  useEffect(() => {
    if (!copyFeedback) return
    const timer = setTimeout(() => setCopyFeedback(null), 2500)
    return () => clearTimeout(timer)
  }, [copyFeedback])

  const copySessionId = async (sessionId: string) => {
    try {
      await copyText(sessionId)
      setCopyFeedback({ message: "会话 ID 已复制", failed: false })
    } catch {
      setCopyFeedback({ message: "复制会话 ID 失败", failed: true })
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
  useEffect(() => {
    document.documentElement.classList.toggle("dark", themeMode === "dark")
  }, [themeMode])

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
    openToolTabs,
    browserTabsForWorkbench,
    workbenchOrderBySession[workbenchOrderScope],
  )
  const closeSuccessor = (key: string) => {
    const index = visibleTabIds.indexOf(key)
    const remaining = visibleTabIds.filter((item) => item !== key)
    return remaining[index] ?? remaining[index - 1] ?? null
  }
  const pruneSavedTab = (key: string) => {
    setWorkbenchOrderBySession((current) => {
      const saved = current[workbenchOrderScope]
      return saved?.includes(key)
        ? { ...current, [workbenchOrderScope]: saved.filter((item) => item !== key) }
        : current
    })
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
    pickSecond(childId, true)
    openWorkbench("session")
  }

  return (
    <ExternalLinkProvider onOpenInApp={browserEnabled && currentSessionId ? openLinkInApp : undefined}>
    <div className="relative flex h-full overflow-hidden bg-background text-foreground">
      {/* WSS-only transport: surface a dead /v2/stream connection instead of
          silently freezing. Renders nothing while the connection is healthy. */}
      <AvailabilityBanner />

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        width={sidebarResize.width}
        chats={chats}
        booted={booted}
        currentSessionId={currentSessionId}
        onNewChat={(projectId) => {
          setPendingProjectId(projectId ?? null)
          // The project (or its default workspace) owns the next session's cwd.
          if (projectId) setPickedWorkspace(null)
          newChat()
        }}
        onSelect={select}
        onRename={(id, title) => void persistSessionTitle(id, title)}
        onDelete={(c) => setPendingDelete({ id: c.id, title: c.title || "新会话" })}
        onTogglePin={(c) => (c.pinned ? unpinSession(c.id) : pinSession(c.id))}
        onCopySessionId={copySessionId}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenProjectManager={() => setProjectManagerOpen(true)}
      />
      {!sidebarCollapsed ? <ResizeHandle onPointerDown={sidebarResize.startResize} /> : null}

      <ChatPane
        chat={chat}
        pickedWorkspace={pickedWorkspace}
        pendingProjectId={pendingProjectId}
        onSelectProject={(projectId) => {
          setPendingProjectId(projectId)
          // A manual project pick owns the workspace; drop a manual choice.
          if (projectId) setPickedWorkspace(null)
        }}
        onOpenWorkspacePicker={() => setWsPickerOpen(true)}
        onOpenInspector={() => openWorkbench("inspector")}
        onOpenReview={() => openReview()}
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

      {workbenchOpen ? (
        <>
          {isWide ? <ResizeHandle onPointerDown={workbenchResize.startResize} /> : null}
          <RightWorkbench
            docked={isWide}
            width={workbenchResize.width}
            activeTab={selectedWorkbenchTab}
            openToolTabs={openToolTabs}
            tabOrder={workbenchOrderBySession[workbenchOrderScope]}
            onTabReorder={(order) => {
              workbenchSelectionVersionRef.current += 1
              setWorkbenchOrderBySession((current) => ({ ...current, [workbenchOrderScope]: order }))
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
                open={selectedWorkbenchTab === "inspector"}
                onClose={() => setWorkbenchOpen(false)}
                workspace={displayWorkspace}
                onEditWorkspace={() => setWsPickerOpen(true)}
                onOpenReview={openReview}
                onCopySessionId={copySessionId}
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
              <BrowserPaneView
                key={currentSessionId ?? "no-session"}
                sessionId={currentSessionId}
                active={workbenchTab === "browser"}
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
            session={isProjectedChild ? (
              <SubagentTranscriptPane
                sessionId={secondSid}
                chats={chats}
                onPickSession={pickSecond}
              />
            ) : (
              <div className="relative flex min-h-0 flex-1">
                {secondLoadState === "loading" ? (
                  <div
                    className="absolute inset-x-0 top-0 z-30 h-0.5 animate-pulse bg-primary"
                    aria-label="正在加载并排会话"
                  />
                ) : null}
                {secondLoadState === "error" ? (
                  <div role="alert" className="absolute inset-x-0 top-2 z-30 rounded-lg border border-destructive/40 bg-card px-3 py-2 text-xs text-destructive shadow">
                    子代理会话暂时无法加载，请稍后重试。
                  </div>
                ) : null}
                <ChatPane
                  chat={secondChat}
                  secondary={{
                    sessionId: secondSid,
                    chats,
                    onPickSession: pickSecond,
                    onClose: () => setWorkbenchOpen(false),
                    hideClose: true,
                  }}
                  pickedWorkspace={null}
                  onOpenWorkspacePicker={() => {}}
                  onOpenInspector={() => openWorkbench("inspector")}
                  onOpenReview={() => openWorkbench("review")}
                  splitOpen={workbenchOpen && workbenchTab === "session"}
                  onToggleSplit={() => setWorkbenchOpen(false)}
                  onSelectSubAgent={(childId) => pickSecond(childId, true)}
                  onOpenSidebar={() => {}}
                  sidebarCollapsed={false}
                />
              </div>
            )}
          />
        </>
      ) : null}

      <LazySettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Onboarding />

      <WorkspacePicker
        open={wsPickerOpen}
        current={displayWorkspace}
        locked={!!workspacePath}
        onClose={() => setWsPickerOpen(false)}
        onSelect={(p) => {
          setPickedWorkspace(p)
          // Manual workspace choice overrides a project pick for the next chat.
          if (p) setPendingProjectId(null)
        }}
      />

      <ProjectManagerModal open={projectManagerOpen} onClose={() => setProjectManagerOpen(false)} />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        chats={chats}
        onSelect={(id) => {
          select(id)
          setSidebarOpen(false)
        }}
        onNewChat={newChat}
        onSettings={() => setSettingsOpen(true)}
      />

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
    </ExternalLinkProvider>
  )
}

export default App
