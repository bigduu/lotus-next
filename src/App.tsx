import { useEffect, useMemo, useRef, useState } from "react"
import {
  Menu,
  Plus,
  ArrowUp,
  Square,
  PanelRightOpen,
  X,
  Copy,
  Trash2,
  Paperclip,
  Search,
  ChevronDown,
  GitFork,
  Pencil,
  RotateCcw,
  Loader2,
  Cog,
  Download,
  FileDown,
  Columns2,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { LazyMarkdown as Markdown } from "@/components/chat/LazyMarkdown"
import { AssistantMarkdown } from "@/components/chat/AssistantMarkdown"
import { Inspector } from "@/components/chat/Inspector"
import { SlashMenu } from "@/components/chat/SlashMenu"
import { FileMenu } from "@/components/chat/FileMenu"
import { ModelPicker } from "@/components/chat/ModelPicker"
import { ReasoningPicker } from "@/components/chat/ReasoningPicker"
import { OverflowMenu } from "@/components/chat/OverflowMenu"
import { SessionRow } from "@/components/chat/SessionRow"
import { CommandPalette } from "@/components/chat/CommandPalette"
import { ToolCalls } from "@/components/chat/ToolCalls"
import { Reasoning } from "@/components/chat/Reasoning"
import { workspaceService } from "@services/workspace"
import type { WorkspaceFileEntry } from "@services/workspace/types"
import { QuestionDialog, ApprovalDialog } from "@/components/chat/Dialogs"
import { Settings } from "@/components/chat/Settings"
import { Onboarding } from "@/components/chat/Onboarding"
import { ReferencePane } from "@/components/chat/ReferencePane"
import { downloadMarkdown } from "@/lib/exportMarkdown"
import { downloadPdf } from "@/lib/exportPdf"
import { useThemeStore } from "@shared/store/themeStore"
import { groupChats } from "@/lib/groupChats"
import { cn } from "@/lib/utils"
import { useChat } from "@/hooks/useChat"
import { useAppStore } from "@shared/store/appStore"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import type { Message } from "@shared/types/chatMessages"
import type { SkillDefinition } from "@shared/types/skill"

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

function messageText(m: Message): string {
  if ("content" in m && typeof (m as { content?: unknown }).content === "string") {
    return (m as { content: string }).content
  }
  if ("displayText" in m && typeof (m as { displayText?: unknown }).displayText === "string") {
    return (m as { displayText: string }).displayText
  }
  return ""
}

function isToolMessage(m: Message): boolean {
  const t = (m as { type?: string }).type
  return t === "tool_call" || t === "tool_result"
}

function messageReasoning(m: Message): string {
  const r = (m as { metadata?: { reasoning?: unknown } }).metadata?.reasoning
  return typeof r === "string" ? r : ""
}

type RenderItem = { kind: "msg"; m: Message } | { kind: "tools"; items: Message[] }

// Collapse consecutive tool messages into one group so a round's tool calls
// show as a single compact chip instead of many full-width lines.
function buildRenderItems(messages: Message[]): RenderItem[] {
  const out: RenderItem[] = []
  for (const m of messages) {
    if (m.role === "system") continue
    if (isToolMessage(m)) {
      const last = out[out.length - 1]
      if (last && last.kind === "tools") last.items.push(m)
      else out.push({ kind: "tools", items: [m] })
    } else {
      out.push({ kind: "msg", m })
    }
  }
  return out
}

function App() {
  const {
    booted,
    chats,
    currentSessionId,
    currentChat,
    messages,
    streaming,
    pendingUserText,
    sending,
    select,
    send,
    stop,
    newChat,
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
  } = useChat()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [search, setSearch] = useState("")
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [dragOver, setDragOver] = useState(false)

  const themeMode = useThemeStore((s) => s.themeMode)
  useEffect(() => {
    document.documentElement.classList.toggle("dark", themeMode === "dark")
  }, [themeMode])
  const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [preview, setPreview] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [forking, setForking] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null)
  const [editingMsg, setEditingMsg] = useState<{ id: string; text: string } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2500)
  }
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [atBottom, setAtBottom] = useState(true)

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stickRef.current = near
    setAtBottom(near)
  }

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }

  const addFiles = async (files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"))
    if (imgs.length === 0) return
    const next = await Promise.all(imgs.map(fileToAttachment))
    setAttachments((prev) => [...prev, ...next])
  }

  const skills = useAppStore(useShallow((s) => s.skills))
  const loadSkills = useAppStore((s) => s.loadSkills)
  const models = useAppStore(useShallow((s) => s.models))
  const selectedModel = useAppStore((s) => s.selectedModel)
  const setSelectedModel = useAppStore((s) => s.setSelectedModel)
  const defaultChatModel = useProviderStore((s) => s.providerConfig?.defaults?.chat?.model)
  // Global default reasoning effort = the active provider instance's config
  // (e.g. "max"), so the picker reflects the configured default, not a hardcoded
  // "medium". A per-session pick still overrides it.
  const globalReasoningEffort = useProviderStore((s) => {
    const id = s.defaultProviderInstanceId
    return (id ? s.providerInstances.find((i) => i.id === id) : undefined)?.config?.reasoning_effort
  })
  const sessionReasoningEffort = useAppStore(
    (s) => s.inputStates[currentSessionId ?? ""]?.reasoningEffort,
  )
  const reasoningEffort = sessionReasoningEffort ?? globalReasoningEffort ?? "medium"
  const setInputReasoningEffort = useAppStore((s) => s.setInputReasoningEffort)
  const persistSessionTitle = useAppStore((s) => s.persistSessionTitle)
  const deleteSession = useAppStore((s) => s.deleteSession)
  const pinSession = useAppStore((s) => s.pinSession)
  const unpinSession = useAppStore((s) => s.unpinSession)
  // What the next send will use: explicit pick → configured global default →
  // (last resort) the session's own historical model.
  const activeModel =
    selectedModel ||
    defaultChatModel ||
    currentChat?.config?.model_ref?.model ||
    currentChat?.config?.model ||
    ""
  useEffect(() => {
    void loadSkills()
  }, [loadSkills])

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q ? chats.filter((c) => (c.title || "").toLowerCase().includes(q)) : chats
    return groupChats(filtered, new Date())
  }, [chats, search])
  const renderItems = useMemo(() => buildRenderItems(messages), [messages])
  const slashQuery = draft.startsWith("/") ? draft.slice(1) : null

  // @file references: detect a trailing "@query" and list workspace files.
  const atQuery = (() => {
    const m = draft.match(/@([^\s@]*)$/)
    return m ? m[1] : null
  })()
  const workspacePath = currentChat?.config?.workspacePath
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileEntry[]>([])
  const filesLoadedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (atQuery === null || !workspacePath) return
    if (filesLoadedForRef.current === workspacePath) return
    filesLoadedForRef.current = workspacePath
    workspaceService
      .listWorkspaceFiles(workspacePath)
      .then(setWorkspaceFiles)
      .catch(() => setWorkspaceFiles([]))
  }, [atQuery, workspacePath])

  const pickFile = (entry: WorkspaceFileEntry) => {
    setDraft((d) => d.replace(/@[^\s@]*$/, `@${entry.path} `))
  }

  // Robustly keep the view pinned to the latest message. A ResizeObserver on the
  // message content catches EVERY height change — streaming growth, the
  // streaming→markdown swap, and async (lazy) markdown layout — and re-pins to
  // the bottom whenever the user is already there. Fixes "after streaming the
  // newest message lands below the fold" (scrollHeight was read mid-relayout).
  useEffect(() => {
    const content = contentRef.current
    const el = scrollRef.current
    if (!content || !el) return
    const ro = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTo({ top: el.scrollHeight })
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [])

  // Opening a session re-pins to the bottom.
  useEffect(() => {
    stickRef.current = true
    const el = scrollRef.current
    if (el) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }))
  }, [currentSessionId])

  const submit = () => {
    const text = draft
    if (!text.trim() && attachments.length === 0) return
    setDraft("")
    void send(text, {
      skillIds: selectedSkill ? [selectedSkill.id] : undefined,
      images: attachments.length
        ? attachments.map((a) => ({ base64: a.base64, name: a.name, size: a.size, type: a.type }))
        : undefined,
    })
    setSelectedSkill(null)
    setAttachments([])
    // Re-pin to bottom on send — the ResizeObserver keeps it there as the reply
    // grows and as the streaming→markdown swap relayouts.
    stickRef.current = true
  }

  const pickSkill = (skill: SkillDefinition) => {
    setSelectedSkill(skill)
    setDraft("")
  }

  return (
    <div className="relative flex h-full overflow-hidden bg-background text-foreground">
      {/* Backdrop (mobile) */}
      {sidebarOpen && (
        <button
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[84%] max-w-xs flex-col border-r bg-sidebar text-sidebar-foreground transition-transform md:static md:w-72 md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-sm font-semibold">会话</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              newChat()
              setSidebarOpen(false)
            }}
          >
            <Plus /> 新建
          </Button>
        </div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索会话"
              className="w-full rounded-md border bg-background py-1.5 pl-8 pr-7 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {search ? (
              <button
                onClick={() => setSearch("")}
                aria-label="清除"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {chats.length === 0 && (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              {booted ? "暂无会话" : "加载中…"}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.key} className="mb-1">
              <div className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">
                {g.label}
              </div>
              {g.chats.map((c) => (
                <SessionRow
                  key={c.id}
                  chat={c}
                  active={c.id === currentSessionId}
                  onSelect={() => {
                    select(c.id)
                    setSidebarOpen(false)
                  }}
                  onRename={(title) => void persistSessionTitle(c.id, title)}
                  onDelete={() => setPendingDelete({ id: c.id, title: c.title || "新会话" })}
                  onTogglePin={() => (c.pinned ? unpinSession(c.id) : pinSession(c.id))}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="border-t p-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={() => {
              setSettingsOpen(true)
              setSidebarOpen(false)
            }}
          >
            <Cog className="size-4" /> 系统设置
          </Button>
        </div>
      </aside>

      {/* Main */}
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
        <header className="flex items-center gap-2 border-b px-3 py-2.5">
          <Button
            size="icon"
            variant="ghost"
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu />
          </Button>
          <span className="flex-1 truncate text-sm font-semibold">
            {currentChat?.title || "Bodhi"}
          </span>
          {(() => {
            const u = currentChat?.config?.tokenUsage
            if (!u?.maxContextTokens) return null
            const pct = Math.min(100, Math.round((u.totalTokens / u.maxContextTokens) * 100))
            const C = 2 * Math.PI * 7
            const color =
              pct > 85 ? "text-destructive" : pct > 65 ? "text-amber-500" : "text-primary"
            return (
              <button
                onClick={() => setInspectorOpen(true)}
                className="flex items-center gap-1.5"
                title={`上下文 ${u.totalTokens.toLocaleString()} / ${u.maxContextTokens.toLocaleString()} tokens (${pct}%)`}
                aria-label="上下文用量"
              >
                <svg width="20" height="20" viewBox="0 0 18 18" className="-rotate-90">
                  <circle cx="9" cy="9" r="7" fill="none" strokeWidth="2.5" className="stroke-muted" />
                  <circle
                    cx="9"
                    cy="9"
                    r="7"
                    fill="none"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray={C}
                    strokeDashoffset={C * (1 - pct / 100)}
                    className={cn("stroke-current transition-all", color)}
                  />
                </svg>
                <span className={cn("hidden text-xs tabular-nums text-muted-foreground sm:inline")}>
                  {pct}%
                </span>
              </button>
            )
          })()}
          <ReasoningPicker
            value={reasoningEffort}
            onChange={(effort) => setInputReasoningEffort(currentSessionId ?? "", effort)}
            menuPlacement="down"
            menuAlign="right"
          />
          {models.length > 0 ? (
            <ModelPicker
              models={
                activeModel && !models.includes(activeModel) ? [activeModel, ...models] : models
              }
              value={activeModel}
              onChange={setSelectedModel}
              menuPlacement="down"
              menuAlign="right"
            />
          ) : null}
          <OverflowMenu
            items={[
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
                onClick: () => setSplitOpen((v) => !v),
              },
            ]}
          />
          {currentSessionId ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label="检查器"
              onClick={() => setInspectorOpen(true)}
            >
              <PanelRightOpen />
            </Button>
          ) : null}
        </header>

        {currentChat?.planMode ? (
          <div className="border-b bg-primary/10 px-3 py-1.5 text-center text-xs font-medium text-primary">
            计划模式
            {(currentChat.planMode as { status?: string }).status
              ? ` · ${(currentChat.planMode as { status?: string }).status}`
              : ""}
          </div>
        ) : null}

        <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div ref={contentRef} className="mx-auto flex max-w-2xl flex-col gap-4 px-3 py-4">
            {messages.length === 0 && !streaming && !pendingUserText && (
              <div className="flex flex-col items-center gap-2 py-20 text-center">
                <div className="size-10 rounded-xl bg-primary" />
                <p className="text-sm text-muted-foreground">
                  开始一段新对话
                </p>
              </div>
            )}

            {renderItems.map((it, idx) => {
              if (it.kind === "tools") {
                const isLast = idx === renderItems.length - 1
                return (
                  <ToolCalls
                    key={it.items[0]?.id ?? `tools-${idx}`}
                    items={it.items}
                    active={isLast && (sending || streaming !== null)}
                  />
                )
              }
              const m = it.m
              const text = messageText(m)
              const imgs = (
                m as { images?: Array<{ url?: string; base64?: string; type?: string }> }
              ).images
              const isUser = m.role === "user"
              const reasoning = isUser ? "" : messageReasoning(m)
              // Truly empty (no text, no images, no reasoning) → skip the blank bubble.
              if (!text.trim() && !imgs?.length && !reasoning) return null

              if (isUser && editingMsg?.id === m.id) {
                return (
                  <div key={m.id} className="flex flex-col items-end">
                    <div className="w-full max-w-[85%]">
                      <Textarea
                        value={editingMsg.text}
                        onChange={(e) => setEditingMsg({ id: m.id, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditingMsg(null)
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            void editMessage(m.id, editingMsg.text)
                            setEditingMsg(null)
                          }
                        }}
                        autoFocus
                        className="min-h-16 bg-card"
                      />
                      <div className="mt-1.5 flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setEditingMsg(null)}>
                          取消
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            void editMessage(m.id, editingMsg.text)
                            setEditingMsg(null)
                          }}
                        >
                          保存并重发
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              }
              return (
                <div
                  key={m.id}
                  className={cn("group flex flex-col", isUser ? "items-end" : "items-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] overflow-hidden rounded-2xl px-3.5 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]",
                      isUser
                        ? "whitespace-pre-wrap bg-primary text-primary-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {imgs?.length ? (
                      <div className="mb-1.5 flex flex-wrap gap-1.5">
                        {imgs.map((im, i) => {
                          const src = im.url || `data:${im.type || "image/png"};base64,${im.base64}`
                          return (
                            <img
                              key={i}
                              src={src}
                              alt=""
                              className="max-h-48 cursor-zoom-in rounded-xl transition-opacity hover:opacity-90"
                              onClick={() => setPreview(src)}
                            />
                          )
                        })}
                      </div>
                    ) : null}
                    {reasoning ? <Reasoning text={reasoning} /> : null}
                    {isUser ? text : text.trim() ? <AssistantMarkdown>{text}</AssistantMarkdown> : null}
                  </div>
                  <div className="mt-1 flex gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                    <button
                      onClick={() => void navigator.clipboard?.writeText(text)}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="复制"
                    >
                      <Copy className="size-3.5" />
                    </button>
                    {isUser ? (
                      <button
                        onClick={() => setEditingMsg({ id: m.id, text })}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label="编辑"
                        title="编辑并重发"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => void regenerate()}
                        disabled={sending}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                        aria-label="重新生成"
                        title="重新生成"
                      >
                        <RotateCcw className="size-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setForking(true)
                        void fork(m.id).then((id) => {
                          setForking(false)
                          if (id) showToast("已从这里分叉到新会话")
                        })
                      }}
                      disabled={forking}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                      aria-label="从这里分叉"
                      title="从这里分叉成新会话"
                    >
                      <GitFork className="size-3.5" />
                    </button>
                    <button
                      onClick={() => void deleteMessage(m.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                      aria-label="删除"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}

            {pendingUserText ? (
              <div className="flex justify-end">
                <div className="max-w-[85%] overflow-hidden whitespace-pre-wrap rounded-2xl bg-primary px-3.5 py-2 text-sm leading-relaxed text-primary-foreground [overflow-wrap:anywhere]">
                  {pendingUserText}
                </div>
              </div>
            ) : null}

            {streaming !== null && (
              <div className="flex justify-start">
                <div
                  className="max-w-[85%] overflow-hidden rounded-2xl bg-muted px-3.5 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]"
                  style={{ transform: "translateZ(0)" }}
                >
                  {streaming ? (
                    // Live markdown while streaming (RAF-throttled to once/frame),
                    // with provider built-in-tool blocks folded the same as the
                    // final message — so no raw **/``` flash mid-stream.
                    <AssistantMarkdown>{streaming}</AssistantMarkdown>
                  ) : (
                    <span className="inline-flex gap-1">
                      <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
                      <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
                      <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

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

        {/* Composer */}
        <div className="border-t px-3 py-3">
          {slashQuery !== null && (
            <SlashMenu skills={skills} query={slashQuery} onPick={pickSkill} />
          )}
          {slashQuery === null && atQuery !== null && workspacePath ? (
            <FileMenu files={workspaceFiles} query={atQuery} onPick={pickFile} />
          ) : null}
          {selectedSkill && (
            <div className="mx-auto mb-2 flex max-w-2xl">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
                /{selectedSkill.name}
                <button
                  onClick={() => setSelectedSkill(null)}
                  aria-label="移除技能"
                  className="opacity-70 hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </span>
            </div>
          )}
          {attachments.length > 0 && (
            <div className="mx-auto mb-2 flex max-w-2xl flex-wrap gap-2">
              {attachments.map((a) => (
                <div key={a.id} className="relative size-24 overflow-hidden rounded-2xl border">
                  <img
                    src={a.url}
                    alt={a.name}
                    className="size-full cursor-zoom-in object-cover transition-opacity hover:opacity-90"
                    onClick={() => setPreview(a.url)}
                  />
                  <button
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white transition-colors hover:bg-black/80"
                    aria-label="移除图片"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files)
              e.target.value = ""
            }}
          />
          <div className="mx-auto flex max-w-2xl items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-2xl border bg-card px-2 py-1">
              <Button
                size="icon"
                variant="ghost"
                className="size-8 shrink-0 text-muted-foreground"
                aria-label="添加图片"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-4" />
              </Button>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData.files)
                  if (files.length) {
                    // Stop the browser from also pasting the file path as text
                    // (e.g. CleanShot dumps the screenshot path into the box).
                    e.preventDefault()
                    void addFiles(files)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    submit()
                  }
                }}
                placeholder="发送消息…"
                rows={1}
                className="max-h-40"
              />
            </div>
            {sending ? (
              <Button size="icon" variant="secondary" onClick={stop} className="rounded-full">
                <Square />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={submit}
                disabled={!draft.trim() && attachments.length === 0}
                className="rounded-full"
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>

      {splitOpen ? <ReferencePane onClose={() => setSplitOpen(false)} /> : null}

      <Inspector
        sessionId={currentSessionId}
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
      />

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Onboarding />

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

      {pendingDelete ? (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-4 md:items-center"
          onClick={() => setPendingDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">删除会话</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              确定删除「{pendingDelete.title}」?此操作无法撤销。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPendingDelete(null)}>
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  void deleteSession(pendingDelete.id)
                  setPendingDelete(null)
                }}
              >
                删除
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {forking ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[110] flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-xl animate-in fade-in slide-in-from-bottom-2">
            <Loader2 className="size-4 animate-spin text-primary" />
            分叉中…
          </div>
        </div>
      ) : toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[110] flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-xl animate-in fade-in slide-in-from-bottom-2">
            <GitFork className="size-4 text-primary" />
            {toast}
          </div>
        </div>
      ) : null}

      {preview ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 sm:p-8"
          onClick={() => setPreview(null)}
        >
          <img
            src={preview}
            alt=""
            className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setPreview(null)}
            className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white backdrop-blur transition-colors hover:bg-white/25"
            aria-label="关闭预览"
          >
            <X className="size-5" />
          </button>
        </div>
      ) : null}

      {pendingApproval ? (
        <ApprovalDialog a={pendingApproval} onRespond={(ok) => void respondApproval(ok)} />
      ) : pendingQuestion ? (
        <QuestionDialog q={pendingQuestion} onAnswer={(t) => void answerQuestion(t)} />
      ) : null}
    </div>
  )
}

export default App
