import { useEffect, useState } from "react"
import { Inspector } from "@/components/chat/Inspector"
import { CommandPalette } from "@/components/chat/CommandPalette"
import { Settings } from "@/components/chat/Settings"
import { Onboarding } from "@/components/chat/Onboarding"
import { WorkspacePicker } from "@/components/chat/WorkspacePicker"
import { useThemeStore } from "@shared/store/themeStore"
import { useChat } from "@/hooks/useChat"
import { useResizableWidth } from "@/hooks/useResizableWidth"
import { ResizeHandle } from "@/components/ui/resize-handle"
import { useIsWide } from "@shared/hooks/useMediaQuery"
import { useAppStore } from "@shared/store/appStore"
import { Sidebar } from "@/components/app/Sidebar"
import { DeleteSessionDialog } from "@/components/app/DeleteSessionDialog"
import { ChatPane } from "@/components/app/ChatPane"

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
  const secondChat = useChat(secondSid)
  const pickSecond = (id: string | null) => {
    setSecondSid(id)
    // Load the picked session's history into the store WITHOUT touching the
    // global current session (so the main pane is unaffected).
    if (id) void useAppStore.getState().loadChatHistory(id)
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

  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [secondInspectorOpen, setSecondInspectorOpen] = useState(false)
  const isWide = useIsWide()
  // Draggable, persisted widths for the resizable side panels (desktop).
  const sidebarResize = useResizableWidth("lotus_next_sidebar_w", 288, {
    min: 220,
    max: 420,
    edge: "right",
  })
  const inspectorResize = useResizableWidth("lotus_next_inspector_w", 384, {
    min: 280,
    max: 640,
    edge: "left",
  })
  const referenceResize = useResizableWidth("lotus_next_reference_w", 420, {
    min: 300,
    max: 720,
    edge: "left",
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null)
  // Workspace chosen in the picker — shared across the main pane (composer +
  // inspector). The session's own cwd wins for display; otherwise the picked one.
  const [pickedWorkspace, setPickedWorkspace] = useState<string | null>(null)
  const [wsPickerOpen, setWsPickerOpen] = useState(false)

  const themeMode = useThemeStore((s) => s.themeMode)
  useEffect(() => {
    document.documentElement.classList.toggle("dark", themeMode === "dark")
  }, [themeMode])

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

  return (
    <div className="relative flex h-full overflow-hidden bg-background text-foreground">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        width={sidebarResize.width}
        chats={chats}
        booted={booted}
        currentSessionId={currentSessionId}
        onNewChat={newChat}
        onSelect={select}
        onRename={(id, title) => void persistSessionTitle(id, title)}
        onDelete={(c) => setPendingDelete({ id: c.id, title: c.title || "新会话" })}
        onTogglePin={(c) => (c.pinned ? unpinSession(c.id) : pinSession(c.id))}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {!sidebarCollapsed ? <ResizeHandle onPointerDown={sidebarResize.startResize} /> : null}

      <ChatPane
        chat={chat}
        pickedWorkspace={pickedWorkspace}
        onOpenWorkspacePicker={() => setWsPickerOpen(true)}
        onOpenInspector={() => setInspectorOpen(true)}
        splitOpen={splitOpen}
        onToggleSplit={() => setSplitOpen((v) => !v)}
        onOpenSidebar={() => {
          setSidebarOpen(true)
          setSidebarCollapsed(false)
        }}
        sidebarCollapsed={sidebarCollapsed}
      />

      {/* Wide desktop: inspector docks as a resizable in-flow third column. */}
      {isWide && inspectorOpen ? (
        <>
          <ResizeHandle onPointerDown={inspectorResize.startResize} />
          <Inspector
            docked
            width={inspectorResize.width}
            sessionId={currentSessionId}
            open={inspectorOpen}
            onClose={() => setInspectorOpen(false)}
            workspace={displayWorkspace}
            onEditWorkspace={() => setWsPickerOpen(true)}
          />
        </>
      ) : null}

      {/* Split: a second interactive pane bound to another session (desktop). */}
      {splitOpen ? (
        <>
          <ResizeHandle onPointerDown={referenceResize.startResize} />
          <div
            className="hidden shrink-0 flex-col border-l md:flex"
            style={{ width: referenceResize.width, maxWidth: "45vw" }}
          >
            <ChatPane
              chat={secondChat}
              secondary={{
                sessionId: secondSid,
                chats,
                onPickSession: pickSecond,
                onClose: () => setSplitOpen(false),
              }}
              pickedWorkspace={null}
              onOpenWorkspacePicker={() => {}}
              onOpenInspector={() => setSecondInspectorOpen(true)}
              splitOpen
              onToggleSplit={() => setSplitOpen(false)}
              onOpenSidebar={() => {}}
              sidebarCollapsed={false}
            />
          </div>
        </>
      ) : null}

      {/* Second pane's own inspector (overlay), bound to its session. */}
      {splitOpen && secondInspectorOpen && secondSid ? (
        <Inspector
          sessionId={secondSid}
          open={secondInspectorOpen}
          onClose={() => setSecondInspectorOpen(false)}
          workspace={null}
        />
      ) : null}

      {/* Narrow/mobile: inspector overlays as a bottom-sheet / right rail. */}
      {!isWide ? (
        <Inspector
          sessionId={currentSessionId}
          open={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          workspace={displayWorkspace}
          onEditWorkspace={() => setWsPickerOpen(true)}
        />
      ) : null}

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Onboarding />

      <WorkspacePicker
        open={wsPickerOpen}
        current={displayWorkspace}
        locked={!!workspacePath}
        onClose={() => setWsPickerOpen(false)}
        onSelect={(p) => setPickedWorkspace(p)}
      />

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
