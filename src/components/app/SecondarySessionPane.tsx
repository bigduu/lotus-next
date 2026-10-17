import { useSessionDrop } from "@/hooks/useSessionDrop"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useState } from "react"
import { ChatPane } from "@/components/app/ChatPane"
import { SubagentTranscriptPane } from "@/components/app/SubagentTranscriptPane"
import { useChat } from "@/hooks/useChat"
import { useAppStore } from "@shared/store/appStore"
import type { ChatItem } from "@shared/types/chat"

type Props = {
  sessionId: string | null
  active?: boolean
  pageVisible?: boolean
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
  active = true,
  pageVisible = true,
}: InteractiveProps) {
  useUiLocale()
  const [loadState, setLoadState] = useState<{ sessionId: string | null; status: "loading" | "ready" | "error" }>({ sessionId: null, status: "ready" })
  const [readAttempt, setReadAttempt] = useState(0)
  const chat = useChat(sessionId, onSessionCreated)
  const status = !sessionId ? "ready" : loadState.sessionId === sessionId ? loadState.status : "loading"

  useEffect(() => {
    if (!sessionId) return
    const controller = new AbortController()
    setLoadState({ sessionId, status: "loading" })
    void useAppStore.getState().loadChatHistory(sessionId, { throwOnError: true, signal: controller.signal })
      .then(() => { if (!controller.signal.aborted) setLoadState({ sessionId, status: "ready" }) })
      .catch(() => { if (!controller.signal.aborted) setLoadState({ sessionId, status: "error" }) })
    return () => controller.abort()
  }, [sessionId, readAttempt])

  return (
    <div className="relative flex min-h-0 flex-1">
      <ChatPane
        chat={chat}
        pageVisible={pageVisible && active}
        secondary={{ sessionId, chats, onPickSession: (id) => {
          if (id === sessionId && status === "error") setReadAttempt((attempt) => attempt + 1)
          else onPickSession(id)
        }, onClose, hideClose: true,
          historyRead: { status, retry: () => { if (status === "error") setReadAttempt((attempt) => attempt + 1) } },
        }}
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
  useUiLocale()
  const [createdRootId, setCreatedRootId] = useState<string | null>(null)
  const sessionDrop = useSessionDrop(props.chats, props.onPickSession)
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
    <div className="relative flex min-h-0 flex-1" data-session-drop-target="secondary" {...sessionDrop.handlers}>
      {sessionDrop.active ? <div className="pointer-events-none absolute inset-0 z-[60] m-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/10 text-sm font-medium text-primary">{uiText("drop_to_open_session")}</div> : null}
      <SubagentTranscriptPane
        sessionId={props.sessionId}
        chats={props.chats}
        onPickSession={props.onPickSession}
      />
    </div>
  )
}
