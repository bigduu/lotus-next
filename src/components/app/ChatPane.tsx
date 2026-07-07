import { useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronDown,
  ChevronLeft,
  RotateCcw,
  Download,
  FileDown,
  Columns2,
  ShieldAlert,
  X,
  PanelRightOpen,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { workspaceService } from "@services/workspace"
import type { WorkspaceFileEntry } from "@services/workspace/types"
import { agentClient } from "@services/chat/AgentService"
import { QuestionDialog, ApprovalDialog } from "@/components/chat/Dialogs"
import { downloadMarkdown } from "@/lib/exportMarkdown"
import { downloadPdf } from "@/lib/exportPdf"
import { cn } from "@/lib/utils"
import type { useChat } from "@/hooks/useChat"
import { useStickyScroll } from "@/hooks/useStickyScroll"
import { useAppStore, selectChildren } from "@shared/store/appStore"
import type { ChildProgress } from "@shared/store/appStore/slices/executionStateSlice/types"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import type { SkillDefinition } from "@shared/types/skill"
import { ChatHeader } from "@/components/app/ChatHeader"
import { MessageList } from "@/components/app/MessageList"
import { Composer } from "@/components/app/Composer"
import { Toasts } from "@/components/app/Toasts"
import { ImageLightbox } from "@/components/app/ImageLightbox"
import { ReasoningPicker } from "@/components/chat/ReasoningPicker"
import { ModelPicker } from "@/components/chat/ModelPicker"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ChatItem } from "@shared/types/chatMessages"

/** Secondary (split) pane config — a slim header with its own session picker. */
type SecondaryConfig = {
  sessionId: string | null
  chats: ChatItem[]
  onPickSession: (id: string | null) => void
  onClose: () => void
}

type Attachment = { id: string; base64: string; name: string; type: string; size: number; url: string }

function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      // data URL → strip the "data:...;base64," prefix for the API payload.
      const base64 = url.includes(",") ? url.slice(url.indexOf(",") + 1) : url
      resolve({
        id: `${file.name}-${file.size}-${url.length}`,
        base64,
        name: file.name,
        type: file.type,
        size: file.size,
        url,
      })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

type ChatState = ReturnType<typeof useChat>

/**
 * A self-contained chat column: header + messages + composer + this pane's
 * transient overlays (toasts, image lightbox, question/approval dialogs). It is
 * driven entirely by the `chat` bundle it receives (any `useChat(...)` instance),
 * so the same component renders the main pane and — later — additional panes
 * each bound to a different session. Per-pane input state (draft, attachments,
 * skill, scroll anchor, …) lives here; cross-pane globals (sidebar, settings,
 * workspace picker, inspector) stay in the parent and arrive as callbacks.
 */
export function ChatPane({
  chat,
  pickedWorkspace,
  onOpenWorkspacePicker,
  onOpenInspector,
  splitOpen,
  onToggleSplit,
  onOpenSidebar,
  sidebarCollapsed,
  secondary,
}: {
  chat: ChatState
  pickedWorkspace: string | null
  onOpenWorkspacePicker: () => void
  onOpenInspector: () => void
  splitOpen: boolean
  onToggleSplit: () => void
  onOpenSidebar: () => void
  sidebarCollapsed: boolean
  /** When set, render a slim split-pane header (session picker) instead of the full one. */
  secondary?: SecondaryConfig
}) {
  const {
    chats,
    currentSessionId,
    currentChat,
    messages,
    streaming,
    streamingReasoning,
    liveSegments,
    streamStatus,
    pendingUserText,
    sending,
    select,
    send,
    stop,
    deleteMessage,
    fork,
    regenerate,
    editMessage,
    retry,
    sendError,
    pendingQuestion,
    pendingApproval,
    answerQuestion,
    respondApproval,
  } = chat

  // Live in-run token budget (pushed over the agent channel) — beats the
  // persisted config snapshot, which only refreshes on history reload.
  const liveTokenUsage = useAppStore((s) =>
    currentSessionId ? s.tokenUsages[currentSessionId] : undefined,
  )

  // Per-session persisted draft (survives session switches + reloads via the
  // inputStates slice); new-chat drafts key off "".
  const draftKey = currentSessionId ?? ""
  const draft = useAppStore((s) => s.inputStates[draftKey]?.content ?? "")
  const setDraft = (value: string | ((prev: string) => string)) => {
    const store = useAppStore.getState()
    const prev = store.inputStates[draftKey]?.content ?? ""
    store.setInputContent(draftKey, typeof value === "function" ? value(prev) : value)
  }
  const [dragOver, setDragOver] = useState(false)
  const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [preview, setPreview] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [forking, setForking] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2500)
  }

  // NOTE: the background-shell completion NOTIFICATION is no longer fired here.
  // It arrives as a backend `notification` event (deduped + preference-gated,
  // never replayed on resubscribe) and is surfaced via `onNotification` in
  // useChat. The tool card still flips reactively from the store.

  // Sticky-scroll machinery (refs + ResizeObserver + open-session re-pin).
  const { scrollRef, contentRef, atBottom, handleScroll, scrollToBottom, pinToBottom } =
    useStickyScroll(currentSessionId)

  const addFiles = async (files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"))
    if (imgs.length === 0) return
    const next = await Promise.all(imgs.map(fileToAttachment))
    setAttachments((prev) => [...prev, ...next])
  }

  const skills = useAppStore(useShallow((s) => s.skills))
  const subAgents = useAppStore(useShallow((s) => selectChildren(currentSessionId)(s)))
  // Sub-agents to display: persistent child sessions from the index (survive
  // reload, navigable) overlaid with live progress (status/preview during a run).
  const mergedSubAgents = useMemo(() => {
    const out: Record<string, ChildProgress> = {}
    for (const c of chats) {
      if (currentSessionId && c.parentSessionId === currentSessionId) {
        out[c.id] = {
          title: c.title || c.subagentType || undefined,
          status: c.isRunning ? "running" : "completed",
        }
      }
    }
    for (const [id, p] of Object.entries(subAgents)) {
      out[id] = { ...out[id], ...p }
    }
    return out
  }, [chats, currentSessionId, subAgents])
  const models = useAppStore(useShallow((s) => s.models))
  const selectedModel = useAppStore((s) => s.selectedModel)
  const setSelectedModel = useAppStore((s) => s.setSelectedModel)
  const defaultChatModel = useProviderStore((s) => s.providerConfig?.defaults?.chat?.model)
  const globalReasoningEffort = useProviderStore((s) => {
    const id = s.defaultProviderInstanceId
    return (id ? s.providerInstances.find((i) => i.id === id) : undefined)?.config?.reasoning_effort
  })
  const sessionReasoningEffort = useAppStore(
    (s) => s.inputStates[currentSessionId ?? ""]?.reasoningEffort,
  )
  const reasoningEffort = sessionReasoningEffort ?? globalReasoningEffort ?? "medium"
  const setInputReasoningEffort = useAppStore((s) => s.setInputReasoningEffort)
  // What the next send will use: explicit pick → configured global default →
  // (last resort) the session's own historical model.
  const activeModel =
    selectedModel ||
    defaultChatModel ||
    currentChat?.config?.model_ref?.model ||
    currentChat?.config?.model ||
    ""

  // Escape hides the pickers until the draft changes again (typing re-opens).
  const [menusDismissed, setMenusDismissed] = useState(false)
  useEffect(() => {
    setMenusDismissed(false)
  }, [draft])

  const slashQuery = !menusDismissed && draft.startsWith("/") ? draft.slice(1) : null

  // @file references: detect a trailing "@query" and list workspace files.
  const atQuery = (() => {
    if (menusDismissed) return null
    const m = draft.match(/@([^\s@]*)$/)
    return m ? m[1] : null
  })()
  const workspacePath = currentChat?.config?.workspacePath
  const displayWorkspace = workspacePath ?? pickedWorkspace
  const bypassPermissions = currentChat?.config?.bypassPermissions ?? false
  const toggleBypass = async () => {
    if (!currentSessionId) return
    await agentClient
      .patchSession(currentSessionId, { bypass_permissions: !bypassPermissions })
      .catch(() => {})
    // bypassPermissions is mirrored from the session summary, not chat history —
    // refresh the index so the badge/toggle state reflects the change.
    await useAppStore.getState().refreshChatsNow()
  }
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileEntry[]>([])
  const filesLoadedForRef = useRef<string | null>(null)
  useEffect(() => {
    // @-file references follow the EFFECTIVE workspace — the session's cwd, or the
    // one picked for a new chat — so completions match where the agent will run.
    if (atQuery === null || !displayWorkspace) return
    if (filesLoadedForRef.current === displayWorkspace) return
    filesLoadedForRef.current = displayWorkspace
    workspaceService
      .listWorkspaceFiles(displayWorkspace)
      .then(setWorkspaceFiles)
      .catch(() => setWorkspaceFiles([]))
  }, [atQuery, displayWorkspace])

  const pickFile = (entry: WorkspaceFileEntry) => {
    setDraft((d) => d.replace(/@[^\s@]*$/, `@${entry.path} `))
  }

  const submit = () => {
    const text = draft
    if (!text.trim() && attachments.length === 0) return
    setDraft("")
    void send(text, {
      skillIds: selectedSkill ? [selectedSkill.id] : undefined,
      images: attachments.length
        ? attachments.map((a) => ({ base64: a.base64, name: a.name, size: a.size, type: a.type }))
        : undefined,
      workspacePath: pickedWorkspace,
    })
    setSelectedSkill(null)
    setAttachments([])
    // Re-pin to bottom on send — the ResizeObserver keeps it there as the reply
    // grows and as the streaming→markdown swap relayouts.
    pinToBottom()
  }

  const pickSkill = (skill: SkillDefinition) => {
    setSelectedSkill(skill)
    setDraft("")
  }

  const handleFork = (id: string) => {
    setForking(true)
    void fork(id).then((nid) => {
      setForking(false)
      if (nid) showToast("已从这里分叉到新会话")
    })
  }

  const overflowItems = [
    ...(currentSessionId && messages.length > 0
      ? [
          {
            label: "导出 Markdown",
            icon: <Download className="size-4" />,
            onClick: () => downloadMarkdown(messages, currentChat?.title || "chat"),
          },
          {
            label: "导出 PDF",
            icon: <FileDown className="size-4" />,
            onClick: () => void downloadPdf(messages, currentChat?.title || "chat"),
          },
        ]
      : []),
    {
      label: splitOpen ? "关闭分屏对比" : "分屏对比",
      icon: <Columns2 className="size-4" />,
      onClick: onToggleSplit,
    },
    ...(currentSessionId
      ? [
          {
            label: bypassPermissions ? "绕过权限审批 · 已开启" : "绕过权限审批",
            icon: <ShieldAlert className={cn("size-4", bypassPermissions && "text-amber-500")} />,
            onClick: () => void toggleBypass(),
          },
        ]
      : []),
  ]

  return (
    <>
      <div
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault()
            setDragOver(true)
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files)
        }}
      >
        {dragOver ? (
          <div className="pointer-events-none absolute inset-0 z-[60] m-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/10 text-sm font-medium text-primary">
            松开以添加图片
          </div>
        ) : null}

        {secondary ? (
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
            <Select
              value={secondary.sessionId ?? undefined}
              onValueChange={(v) => secondary.onPickSession(v || null)}
            >
              <SelectTrigger size="sm" className="min-w-0 flex-1">
                <SelectValue placeholder="选择会话并排…" />
              </SelectTrigger>
              <SelectContent>
                {secondary.chats
                  .filter((c) => !c.parentSessionId)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title || "新会话"}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {currentSessionId ? (
              <>
                <ReasoningPicker
                  value={reasoningEffort}
                  onChange={(effort) => setInputReasoningEffort(currentSessionId ?? "", effort)}
                  menuPlacement="down"
                  menuAlign="right"
                />
                {models.length > 0 ? (
                  <ModelPicker
                    models={
                      activeModel && !models.includes(activeModel)
                        ? [activeModel, ...models]
                        : models
                    }
                    value={activeModel}
                    onChange={setSelectedModel}
                    menuPlacement="down"
                    menuAlign="right"
                  />
                ) : null}
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="检查器"
                  onClick={onOpenInspector}
                >
                  <PanelRightOpen />
                </Button>
              </>
            ) : null}
            <Button size="icon" variant="ghost" aria-label="关闭分栏" onClick={secondary.onClose}>
              <X />
            </Button>
          </div>
        ) : (
          <ChatHeader
            title={currentChat?.title || "Bodhi"}
            hasSession={!!currentSessionId}
            tokenUsage={liveTokenUsage ?? currentChat?.config?.tokenUsage}
            reasoningEffort={reasoningEffort}
            onChangeReasoning={(effort) => setInputReasoningEffort(currentSessionId ?? "", effort)}
            models={models}
            activeModel={activeModel}
            onChangeModel={setSelectedModel}
            bypassPermissions={bypassPermissions}
            onToggleBypass={() => void toggleBypass()}
            overflowItems={overflowItems}
            onOpenSidebar={onOpenSidebar}
            onOpenInspector={onOpenInspector}
            sidebarCollapsed={sidebarCollapsed}
          />
        )}

        {currentChat?.planMode ? (
          <div className="border-b bg-primary/10 px-3 py-1.5 text-center text-xs font-medium text-primary">
            计划模式
            {(currentChat.planMode as { status?: string }).status
              ? ` · ${(currentChat.planMode as { status?: string }).status}`
              : ""}
          </div>
        ) : null}

        {currentChat?.parentSessionId ? (
          <button
            onClick={() => select(currentChat.parentSessionId as string)}
            className="flex w-full items-center gap-1.5 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" /> 子代理 · 返回父会话
          </button>
        ) : null}

        <MessageList
          scrollRef={scrollRef}
          contentRef={contentRef}
          onScroll={handleScroll}
          messages={messages}
          mergedSubAgents={mergedSubAgents}
          sending={sending}
          streaming={streaming}
          streamingReasoning={streamingReasoning}
          liveSegments={liveSegments}
          streamStatus={streamStatus}
          pendingUserText={pendingUserText}
          forking={forking}
          onSelectSubAgent={select}
          onPreviewImage={setPreview}
          onRegenerate={() => void regenerate()}
          onFork={handleFork}
          onDelete={(id) => void deleteMessage(id)}
          onEditMessage={(id, text) => void editMessage(id, text)}
        />

        {/* Jump-to-bottom button — shows when scrolled up to read history. */}
        {!atBottom && (
          <button
            onClick={scrollToBottom}
            aria-label="滚动到底部"
            className="absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-full border bg-card p-2 text-muted-foreground shadow-lg transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronDown className="size-5" />
          </button>
        )}

        {sendError ? (
          <div className="mx-auto mb-1 flex max-w-2xl items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            <span className="text-destructive">生成失败</span>
            <Button size="sm" variant="secondary" onClick={() => void retry()}>
              <RotateCcw className="size-3.5" /> 重试
            </Button>
          </div>
        ) : null}

        <Composer
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={submit}
          onStop={stop}
          sending={sending}
          attachments={attachments}
          onAddFiles={(files) => void addFiles(files)}
          onRemoveAttachment={(id) =>
            setAttachments((prev) => prev.filter((x) => x.id !== id))
          }
          onPreviewImage={setPreview}
          selectedSkill={selectedSkill}
          onClearSkill={() => setSelectedSkill(null)}
          onPickSkill={pickSkill}
          skills={skills}
          slashQuery={slashQuery}
          atQuery={atQuery}
          displayWorkspace={displayWorkspace}
          workspaceFiles={workspaceFiles}
          onPickFile={pickFile}
          hasSession={!!currentSessionId}
          onOpenWorkspacePicker={onOpenWorkspacePicker}
          onDismissMenus={() => setMenusDismissed(true)}
        />
      </div>

      <Toasts forking={forking} toast={toast} />

      <ImageLightbox src={preview} onClose={() => setPreview(null)} />

      {pendingApproval ? (
        <ApprovalDialog a={pendingApproval} onRespond={(ok) => void respondApproval(ok)} />
      ) : pendingQuestion ? (
        <QuestionDialog q={pendingQuestion} onAnswer={(t) => void answerQuestion(t)} />
      ) : null}
    </>
  )
}
