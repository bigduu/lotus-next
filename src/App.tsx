import { useEffect, useState } from "react"
import { copyText } from "@shared/utils/clipboard"
import { Inspector } from "@/components/chat/Inspector"
import { CommandPalette } from "@/components/chat/CommandPalette"
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
import { SecondarySessionPane } from "@/components/app/SecondarySessionPane"
import { AvailabilityBanner } from "@/components/app/AvailabilityBanner"
import { ReviewPane } from "@/components/app/ReviewPane"
import { BrowserPane } from "@/components/app/BrowserPane"
import { isPhoneDevice } from "@/lib/browserAvailability"
import {
  RightWorkbench,
  type RightWorkbenchTab,
} from "@/components/app/RightWorkbench"

function App() {
  // The main pane follows the global current session.
  const chat = useChat()
  const { booted, chats, currentSessionId, currentChat, select, newChat } = chat

  // Only a confirmed root mounts the interactive side chat; unknown and child
  // sessions use the message-only projection until summary metadata resolves.
  const [secondSid, setSecondSid] = useState<string | null>(null)
  const pickSecond = (id: string | null) => {
    setSecondSid(id)
    if (!id) return

    // Restore summary metadata only. Transcript bodies are loaded by the
    // selected pane after classification, never via generic child history.
    const store = useAppStore.getState()
    if (!store.chats.some((item) => item.id === id)) {
      void store.restoreSession(id).catch(() => false)
    }
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
  const isMobile = useIsMobile()
  const isWide = useIsWide()
  const browserEnabled = !isMobile && !isPhoneDevice()
  const selectedWorkbenchTab = !browserEnabled && workbenchTab === "browser" ? "inspector" : workbenchTab
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
            browserEnabled={browserEnabled}
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
              <BrowserPane
                key={currentSessionId ?? "no-session"}
                sessionId={currentSessionId}
                active={workbenchTab === "browser"}
              />
            ) : null}
            session={(
              <SecondarySessionPane
                sessionId={secondSid}
                active={selectedWorkbenchTab === "session"}
                chats={chats}
                onPickSession={pickSecond}
                onClose={() => setWorkbenchOpen(false)}
                onOpenInspector={() => setWorkbenchTab("inspector")}
                onOpenReview={() => setWorkbenchTab("review")}
              />
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
  )
}

export default App
