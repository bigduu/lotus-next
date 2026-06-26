import { useEffect, useRef, useState } from "react"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

type Chat = { id: string; title?: string | null; isRunning?: boolean }

/** A sidebar session row: select, plus a ⋯ menu for inline rename + delete. */
export function SessionRow({
  chat,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  chat: Chat
  active: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(chat.title ?? "")
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [menuOpen])

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

      <div ref={menuRef} className="relative shrink-0">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="会话操作"
          className={cn(
            "mr-1 rounded p-1 text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground",
            menuOpen
              ? "opacity-100"
              : "opacity-100 md:opacity-0 md:group-hover/row:opacity-100",
          )}
        >
          <MoreHorizontal className="size-4" />
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-32 rounded-xl border bg-popover p-1 shadow-xl">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                setEditing(true)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <Pencil className="size-3.5" /> 重命名
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onDelete()
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-accent"
            >
              <Trash2 className="size-3.5" /> 删除
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
