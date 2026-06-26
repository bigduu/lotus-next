import { useEffect, useMemo, useRef, useState } from "react"
import { Search, Plus, Settings as SettingsIcon, MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"

type Chat = { id: string; title?: string | null }

type Item =
  | { kind: "action"; id: string; label: string; icon: React.ReactNode; run: () => void }
  | { kind: "session"; id: string; label: string; run: () => void }

/**
 * Cmd/Ctrl+K command palette: quick session switcher + top actions.
 */
export function CommandPalette({
  open,
  onClose,
  chats,
  onSelect,
  onNewChat,
  onSettings,
}: {
  open: boolean
  onClose: () => void
  chats: Chat[]
  onSelect: (id: string) => void
  onNewChat: () => void
  onSettings: () => void
}) {
  const [q, setQ] = useState("")
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQ("")
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const items = useMemo<Item[]>(() => {
    const query = q.trim().toLowerCase()
    const actions: Item[] = [
      {
        kind: "action",
        id: "new",
        label: "新建对话",
        icon: <Plus className="size-4" />,
        run: onNewChat,
      },
      {
        kind: "action",
        id: "settings",
        label: "系统设置",
        icon: <SettingsIcon className="size-4" />,
        run: onSettings,
      },
    ]
    const sessionItems: Item[] = chats
      .filter((c) => !query || (c.title || "").toLowerCase().includes(query))
      .slice(0, 50)
      .map((c) => ({
        kind: "session",
        id: c.id,
        label: c.title || "新会话",
        run: () => onSelect(c.id),
      }))
    const acts = query
      ? actions.filter((a) => a.label.toLowerCase().includes(query))
      : actions
    return [...acts, ...sessionItems]
  }, [q, chats, onNewChat, onSettings, onSelect])

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, items.length - 1)))
  }, [items.length])

  if (!open) return null

  const choose = (item: Item) => {
    item.run()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[130] flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, items.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === "Enter") {
                e.preventDefault()
                const it = items[active]
                if (it) choose(it)
              } else if (e.key === "Escape") {
                onClose()
              }
            }}
            placeholder="搜索会话或操作…"
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">无匹配</p>
          ) : (
            items.map((it, i) => (
              <button
                key={`${it.kind}-${it.id}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(it)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  i === active ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                {it.kind === "action" ? (
                  it.icon
                ) : (
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{it.label}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
