import { useEffect, useRef, useState } from "react"
import { Inspector } from "@/components/chat/Inspector"
import { CommandPalette } from "@/components/chat/CommandPalette"
import { LazySettings } from "@/components/chat/LazySettings"
import { Onboarding } from "@/components/chat/Onboarding"
import { WorkspacePicker } from "@/components/chat/WorkspacePicker"
import { useThemeStore } from "@shared/store/themeStore"
import { useChat } from "@/hooks/useChat"
import { useResizableWidth } from "@/hooks/useResizableWidth"
import { ResizeHandle } from "@/components/ui/resize-handle"
import { useIsWide } from "@shared/hooks/useMediaQuery"
import { useAppStore } from "@shared/store/appStore"
import { isVdiSafeModeEnabled, onVdiSafeModeChange } from "@shared/utils/vdiSafeMode"
import { Sidebar } from "@/components/app/Sidebar"
import { ProjectManagerModal } from "@/components/app/ProjectManagerModal"
import { DeleteSessionDialog } from "@/components/app/DeleteSessionDialog"
import { ChatPane } from "@/components/app/ChatPane"
import { AvailabilityBanner } from "@/components/app/AvailabilityBanner"
import { ReviewPane } from "@/components/app/ReviewPane"
import {
  RightWorkbench,
  type RightWorkbenchTab,
} from "@/components/app/RightWorkbench"

function App() {
  // The main pane follows the global current session. The same `chat` bundle
  // feeds the Sidebar / CommandPalette / Inspector (which track the current
  // session) and the main ChatPane. A second pane (later) gets its own
  // useChat(sid) instance.
  const chat = useChat()
  const { booted, chats, currentSessionId, currentChat, select, newChat } = chat

  // A second, independent interactive pane bound to a different session — each
  // useChat instance streams its own session concurrently. Bound to null while
  // no session is picked (cheap; bootstrap is skipped for bound instances).
  const [secondSid, setSecondSid] = useState<string | null>(null)
  const [secondLoadState, setSecondLoadState] = useState<"idle" | "loading" | "error">("idle")
  const secondLoadRequest = useRef(0)
  // onSessionCreated: when a send/fork in the 2nd pane spawns a new session,
  // re-bind THIS pane to it (no global-current change → main pane untouched).
  const secondChat = useChat(secondSid, (newSid) => setSecondSid(newSid))
  const pickSecond = (id: string | null) => {
    const request = ++secondLoadRequest.current
    setSecondSid(id)
    if (!id) {
      setSecondLoadState("idle")
      return
    }

    // Hydrate the picked session WITHOUT touching the global current session.
    // A newly-started child can exist in live progress before it reaches the
    // lazy session index, so restore it by id first when necessary.
    setSecondLoadState("loading")
    const store = useAppStore.getState()
    void (async () => {
      const exists = store.chats.some((chat) => chat.id === id)
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
  const [workbenchTab, setWorkbenchTab] = useState<RightWorkbenchTab>("inspector")
  const [reviewTargetFilePath, setReviewTargetFilePath] = useState<string | null>(null)
  const isWide = useIsWide()
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
  const openWorkbench = (tab: RightWorkbenchTab) => {
    setWorkbenchTab(tab)
    setWorkbenchOpen(true)
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
            activeTab={workbenchTab}
            onTabChange={(tab) => {
              if (tab === "review") setReviewTargetFilePath(null)
              setWorkbenchTab(tab)
            }}
            onClose={() => setWorkbenchOpen(false)}
            sessionTitle={secondSession?.title}
            inspector={
              <Inspector
                embedded
                sessionId={currentSessionId}
                open={workbenchTab === "inspector"}
                onClose={() => setWorkbenchOpen(false)}
                workspace={displayWorkspace}
                onEditWorkspace={() => setWsPickerOpen(true)}
                onOpenReview={openReview}
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
            session={
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
                  onOpenInspector={() => setWorkbenchTab("inspector")}
                  onOpenReview={() => setWorkbenchTab("review")}
                  splitOpen={workbenchOpen && workbenchTab === "session"}
                  onToggleSplit={() => setWorkbenchOpen(false)}
                  onSelectSubAgent={pickSecond}
                  onOpenSidebar={() => {}}
                  sidebarCollapsed={false}
                />
              </div>
            }
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
    </div>
  )
}

export default App
