import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { AlertCircle, Check, Copy, List, MoreHorizontal, Pencil, Pin, PinOff, RotateCcw, Sparkles, Trash2 } from "lucide-react"
import { ConversationClearDialog } from "./ConversationClearDialog"
import { cn } from "@/lib/utils"
import { SIDEBAR_SESSION_DRAG_TYPE, type ProjectSidebarSection } from "@/lib/projectSidebarPreferences"
import { useSidebarContextMenu } from "@/hooks/useSidebarContextMenu"
import { agentClient } from "@services/chat/AgentService"
import { WorktreeStateBadge } from "./WorktreeStateBadge"
import type { CheckoutMergeState } from "@/hooks/useWorktreeMergeStates"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type Chat = {
  id: string
  title?: string | null
  isRunning?: boolean
  pinned?: boolean
  /** Persisted terminal status of the last run (`completed` / `error` / `cancelled`). */
  lastRunStatus?: string | null
  /** Verbatim backend error for the last failed run, when the server reported one. */
  lastRunError?: string | null
}

/** A sidebar session row: select, plus a ⋯ menu for session actions. */
export function SessionRow({
  chat,
  active,
  unread = false,
  onSelect,
  onRename,
  onDelete,
  onTogglePin,
  onCopySessionId,
  projectId,
  sections = [],
  sectionId = null,
  onMoveToSection,
  dragHandle,
  mergeState,
}: {
  chat: Chat
  active: boolean
  unread?: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
  onTogglePin: () => void
  onCopySessionId: () => void
  projectId?: string
  dragHandle?: ReactNode
  sections?: readonly ProjectSidebarSection[]
  sectionId?: string | null
  onMoveToSection?: (sectionId: string | null) => void
  /**
   * Git state of this session's checkout. Omitted when the session does not run
   * in a registered worktree, in which case the row shows no badge and keeps the
   * same layout.
   */
  mergeState?: CheckoutMergeState
}) {
  useUiLocale()
  const menu = useSidebarContextMenu()
  const clearTrigger = useRef<HTMLButtonElement>(null)
  const dragged = useRef(false)
  const internalPointer = useRef(false)
  const [editing, setEditing] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [draft, setDraft] = useState(chat.title ?? "")
  const inputRef = useRef<HTMLInputElement>(null)
  const unreadDescriptionId = useId()
  const failureDescriptionId = useId()
  // A failed last run is a durable session state, so the row keeps a red marker
  // until a later run succeeds. A live run outranks it, and a cancelled run is a
  // deliberate user choice rather than an error.
  const runFailed = !chat.isRunning && chat.lastRunStatus === "error"
  const runFailureDetail = runFailed
    ? chat.lastRunError?.trim() || uiText("session_last_run_failed_hint")
    : null
  const describedBy = [unread ? unreadDescriptionId : null, runFailed ? failureDescriptionId : null]
    .filter(Boolean).join(" ") || undefined

  useEffect(() => {
    if (editing) {
      setDraft(chat.title ?? "")
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, chat.title])

  const commit = () => {
    const t = draft.trim()
    setEditing(false)
    if (t && t !== (chat.title ?? "")) onRename(t)
  }

  if (editing) {
    return (
      <div className="mb-0.5 px-2 py-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit()
            if (e.key === "Escape") setEditing(false)
          }}
          onBlur={commit}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    )
  }

  return (
    <><div
      {...menu.rowProps}
      data-sidebar-session={chat.id}
      data-session-project={projectId}
      draggable
      onPointerDownCapture={(event) => {
        dragged.current = false
        internalPointer.current = event.target instanceof Element && !!event.target.closest("[data-sidebar-drag-handle]")
      }}
      onDragStart={(event) => {
        if (internalPointer.current) { event.preventDefault(); return }
        dragged.current = true
        event.dataTransfer.setData(SIDEBAR_SESSION_DRAG_TYPE, JSON.stringify({ projectId: projectId ?? null, sessionId: chat.id }))
        event.dataTransfer.effectAllowed = "copyMove"
      }}
      style={active ? { boxShadow: "inset 0 0 0 1px var(--border)" } : undefined}
      className={cn(
        "group/row relative mb-0.5 flex select-none items-center rounded-md feedback-motion switch-feedback hover:bg-sidebar-accent",
        active && "bg-sidebar-accent",
      )}
    >
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={(event) => {
          if (dragged.current && event.detail !== 0) { event.preventDefault(); return }
          onSelect()
        }}
        aria-describedby={describedBy}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 py-2 pl-2 pr-1 text-left text-sm rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
          (active || unread) && "font-medium",
        )}
      >
        {/* One fixed-width slot keeps titles aligned whether the row shows a live
            run, an unread dot, or the red failed-run marker. */}
        <span
          title={runFailureDetail ?? undefined}
          data-session-run-failure={runFailed ? "" : undefined}
          className="flex size-3.5 shrink-0 items-center justify-center"
        >
          {chat.isRunning ? (
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
          ) : runFailed ? (
            <AlertCircle aria-hidden="true" className="size-3.5 text-destructive" />
          ) : unread ? (
            <span aria-hidden="true" title={uiText("new_messages_ce3b9bb1")} className="size-1.5 rounded-full bg-primary" />
          ) : null}
        </span>
        <span className="truncate">{chat.title || uiText("new_session_c57c30bc")}</span>
      </button>
      {/* A muted state is ambient: revealed on hover/focus so ordinary rows stay
          quiet, while a real signal is always visible. */}
      {mergeState ? <span className={mergeState.state === "merged" || mergeState.state === "in_progress" ? undefined : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"}>
        <WorktreeStateBadge merge={mergeState} running={chat.isRunning} />
      </span> : null}
      {dragHandle}
      {unread && <span id={unreadDescriptionId} className="sr-only">{uiText("unread_messages_519491f4")}</span>}
      {runFailed && <span id={failureDescriptionId} className="sr-only">{uiText("session_last_run_failed_hint")}</span>}

      <DropdownMenu open={menu.open} onOpenChange={menu.onOpenChange}>
        <DropdownMenuTrigger
          ref={clearTrigger}
          aria-label={uiText("session_actions_e6f6d875")}
          style={active ? { opacity: 1 } : undefined}
          className={cn(
            "mr-1 shrink-0 rounded p-1 text-muted-foreground outline-none feedback-motion transition-opacity hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground",
            "opacity-100 data-[state=open]:opacity-100 focus-within:opacity-100 md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100",
          )}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent onCloseAutoFocus={clearOpen ? (event) => event.preventDefault() : menu.onCloseAutoFocus} align="end" className="min-w-32 rounded-xl">
          {projectId && onMoveToSection ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2 rounded-lg px-2.5 py-1.5">
                <List className="size-3.5" />{uiText("sidebar_move_to_section")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent aria-label={uiText("sidebar_section_select_target")}>
                {sections.map((section) => (
                  <DropdownMenuItem key={section.id} onClick={() => onMoveToSection(section.id)} disabled={section.id === sectionId}>
                    {section.id === sectionId ? <Check /> : <List />}{section.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={() => onMoveToSection(null)} disabled={sectionId === null}>
                  {sectionId === null ? <Check /> : <List />}{uiText("sidebar_no_section")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuItem
            onClick={onTogglePin}
            className="gap-2 rounded-lg px-2.5 py-1.5"
          >
            {chat.pinned ? (
              <>
                <PinOff className="size-3.5" />{uiText("unpin_c92179b7")}</>
            ) : (
              <>
                <Pin className="size-3.5" />{uiText("pin_173f88d2")}</>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setEditing(true)}
            className="gap-2 rounded-lg px-2.5 py-1.5"
          >
            <Pencil className="size-3.5" />{uiText("rename_0d0cbac2")}</DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              // The new title lands via the feed's session_title_updated event
              // (applyServerTitle) — no local state to manage here.
              void agentClient.regenerateSessionTitle(chat.id).catch(() => {})
            }}
            className="gap-2 rounded-lg px-2.5 py-1.5"
          >
            <Sparkles className="size-3.5" />{uiText("generate_title_with_ai_f327dbdd")}</DropdownMenuItem>
          <DropdownMenuItem
            onClick={onCopySessionId}
            className="gap-2 rounded-lg px-2.5 py-1.5"
          >
            <Copy className="size-3.5" />{uiText("copy_session_id_7df96a6b")}</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setClearOpen(true)}
            className="gap-2 rounded-lg px-2.5 py-1.5"
          >
            <RotateCcw className="size-3.5" />{uiText("conversation_clear_action")}</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={onDelete}
            className="gap-2 rounded-lg px-2.5 py-1.5"
          >
            <Trash2 className="size-3.5" />{uiText("delete_2f9daa82")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
      {clearOpen ? <ConversationClearDialog sessionId={chat.id} title={chat.title || chat.id} onClose={() => {
        setClearOpen(false)
        clearTrigger.current?.focus()
      }} /> : null}
    </>
  )
}
