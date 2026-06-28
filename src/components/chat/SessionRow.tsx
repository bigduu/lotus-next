import { useEffect, useRef, useState } from "react"
import { MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type Chat = { id: string; title?: string | null; isRunning?: boolean; pinned?: boolean }

/** A sidebar session row: select, plus a ⋯ menu for pin / inline rename / delete. */
export function SessionRow({
  chat,
  active,
  onSelect,
  onRename,
  onDelete,
  onTogglePin,
}: {
  chat: Chat
  active: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
  onTogglePin: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(chat.title ?? "")
  const inputRef = useRef<HTMLInputElement>(null)

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
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 py-2 pl-2 pr-1 text-left text-sm",
          active && "font-medium",
        )}
      >
        {chat.isRunning ? (
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
        ) : (
          <span className="size-1.5 shrink-0" />
        )}
        <span className="truncate">{chat.title || "新会话"}</span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="会话操作"
          className={cn(
            "mr-1 shrink-0 rounded p-1 text-muted-foreground outline-none transition-opacity hover:bg-accent hover:text-foreground",
            "opacity-100 data-[state=open]:opacity-100 md:opacity-0 md:group-hover/row:opacity-100",
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
                <PinOff className="size-3.5" /> 取消置顶
              </>
            ) : (
              <>
                <Pin className="size-3.5" /> 置顶
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setEditing(true)}
            className="gap-2 rounded-lg px-2.5 py-1.5"
          >
            <Pencil className="size-3.5" /> 重命名
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={onDelete}
            className="gap-2 rounded-lg px-2.5 py-1.5"
          >
            <Trash2 className="size-3.5" /> 删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
