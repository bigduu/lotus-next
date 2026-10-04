import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useId, useRef, useState } from "react"
import { Copy, MoreHorizontal, Pencil, Pin, PinOff, Sparkles, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { agentClient } from "@services/chat/AgentService"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type Chat = { id: string; title?: string | null; isRunning?: boolean; pinned?: boolean }

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
}: {
  chat: Chat
  active: boolean
  unread?: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
  onTogglePin: () => void
  onCopySessionId: () => void
}) {
  useUiLocale()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(chat.title ?? "")
  const inputRef = useRef<HTMLInputElement>(null)
  const unreadDescriptionId = useId()

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
    <div
      className={cn(
        "group/row relative mb-0.5 flex items-center rounded-md transition-colors hover:bg-sidebar-accent",
        active && "bg-sidebar-accent",
      )}
    >
      <button
        onClick={onSelect}
        aria-describedby={unread ? unreadDescriptionId : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 py-2 pl-2 pr-1 text-left text-sm",
          (active || unread) && "font-medium",
        )}
      >
        {chat.isRunning ? (
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
        ) : unread ? (
          <span aria-hidden="true" title={uiText("new_messages_ce3b9bb1")} className="size-1.5 shrink-0 rounded-full bg-primary" />
        ) : (
          <span className="size-1.5 shrink-0" />
        )}
        <span className="truncate">{chat.title || uiText("new_session_c57c30bc")}</span>
      </button>
      {unread && <span id={unreadDescriptionId} className="sr-only">{uiText("unread_messages_519491f4")}</span>}

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={uiText("session_actions_e6f6d875")}
          className={cn(
            "mr-1 shrink-0 rounded p-1 text-muted-foreground outline-none transition-opacity hover:bg-accent hover:text-foreground",
            "opacity-100 data-[state=open]:opacity-100 focus-within:opacity-100 md:opacity-0 md:group-hover/row:opacity-100",
          )}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-32 rounded-xl">
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
            onClick={onDelete}
            className="gap-2 rounded-lg px-2.5 py-1.5"
          >
            <Trash2 className="size-3.5" />{uiText("delete_2f9daa82")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
