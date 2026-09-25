import { useEffect, useState } from "react"
import { ChatPane } from "@/components/app/ChatPane"
import { SubagentTranscriptPane } from "@/components/app/SubagentTranscriptPane"
import { useChat } from "@/hooks/useChat"
import { useAppStore } from "@shared/store/appStore"
import type { ChatItem } from "@shared/types/chat"

type Props = {
  sessionId: string | null
  active?: boolean
  chats: ChatItem[]
  onPickSession: (id: string | null) => void
  onClose: () => void
  onOpenInspector: () => void
  onOpenReview: () => void
}

type InteractiveProps = Props & { onSessionCreated: (id: string) => void }

function InteractiveSecondaryPane({
  sessionId,
  chats,
  onPickSession,
  onSessionCreated,
  onClose,
  onOpenInspector,
  onOpenReview,
}: InteractiveProps) {
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle")
  const chat = useChat(sessionId, onSessionCreated)

  useEffect(() => {
    if (!sessionId) return
    let active = true
    setLoadState("loading")
    void useAppStore.getState().loadChatHistory(sessionId)
      .then(() => { if (active) setLoadState("idle") })
      .catch(() => { if (active) setLoadState("error") })
    return () => { active = false }
  }, [sessionId])

  return (
    <div className="relative flex min-h-0 flex-1">
      {loadState === "loading" ? (
        <div
          className="absolute inset-x-0 top-0 z-30 h-0.5 animate-pulse bg-primary"
          aria-label="正在加载并排会话"
        />
      ) : null}
      {loadState === "error" ? (
        <div role="alert" className="absolute inset-x-0 top-2 z-30 rounded-lg border border-destructive/40 bg-card px-3 py-2 text-xs text-destructive shadow">
          并排会话暂时无法加载，请稍后重试。
        </div>
      ) : null}
      <ChatPane
        chat={chat}
        secondary={{ sessionId, chats, onPickSession, onClose, hideClose: true }}
        pickedWorkspace={null}
        onOpenWorkspacePicker={() => {}}
        onOpenInspector={onOpenInspector}
        onOpenReview={onOpenReview}
        splitOpen
        onToggleSplit={onClose}
        onSelectSubAgent={onPickSession}
        onOpenSidebar={() => {}}
        sidebarCollapsed={false}
      />
    </div>
  )
}

export function SecondarySessionPane(props: Props) {
  const [createdRootId, setCreatedRootId] = useState<string | null>(null)
  const selected = props.chats.find((chat) => chat.id === props.sessionId)
  // An arbitrary unknown id may be a newly-created child missing from the lazy
  // index. Only a root created by this interactive pane itself is trusted before
  // its summary arrives. An explicit child classification always wins.
  const isRoot = !props.sessionId || (
    !selected?.parentSessionId && (
      selected?.kind === "root" || (!selected && createdRootId === props.sessionId)
    )
  )
  return isRoot ? (
    <InteractiveSecondaryPane
      {...props}
      onSessionCreated={(id) => {
        setCreatedRootId(id)
        props.onPickSession(id)
      }}
    />
  ) : props.active === false ? null : (
    <SubagentTranscriptPane
      sessionId={props.sessionId}
      chats={props.chats}
      onPickSession={props.onPickSession}
    />
  )
}
