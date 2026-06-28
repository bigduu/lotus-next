import { useMemo, useState } from "react"
import { Plus, Search, X, Cog, PanelLeftClose } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SessionRow } from "@/components/chat/SessionRow"
import { groupChats } from "@/lib/groupChats"
import { cn } from "@/lib/utils"
import type { ChatItem } from "@shared/types/chatMessages"

export function Sidebar({
  open,
  onClose,
  collapsed,
  onToggleCollapse,
  width,
  chats,
  booted,
  currentSessionId,
  onNewChat,
  onSelect,
  onRename,
  onDelete,
  onTogglePin,
  onOpenSettings,
}: {
  open: boolean
  onClose: () => void
  /** Desktop: when true the persistent rail is hidden (mobile drawer unaffected). */
  collapsed: boolean
  onToggleCollapse: () => void
  /** Desktop rail width in px (resizable); mobile drawer keeps its own width. */
  width: number
  chats: ChatItem[]
  booted: boolean
  currentSessionId: string | null | undefined
  onNewChat: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (chat: ChatItem) => void
  onTogglePin: (chat: ChatItem) => void
  onOpenSettings: () => void
}) {
  const [search, setSearch] = useState("")

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    // Only root sessions in the sidebar — child sub-agent sessions live in the
    // inspector's sub-agents panel, not as top-level chats.
    let filtered = chats.filter(
      (c) => !(c as { parentSessionId?: string | null }).parentSessionId,
    )
    if (q) filtered = filtered.filter((c) => (c.title || "").toLowerCase().includes(q))
    return groupChats(filtered, new Date())
  }, [chats, search])

  return (
    <>
      {/* Backdrop (mobile) */}
      {open && (
        <button
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-label="Close menu"
          onClick={onClose}
        />
      )}

      <aside
        style={{ ["--sidebar-w" as string]: `${width}px` }}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[84%] max-w-xs flex-col border-r bg-sidebar text-sidebar-foreground transition-transform md:static md:w-[var(--sidebar-w)] md:max-w-none md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
          collapsed && "md:hidden",
        )}
      >
        <div className="flex items-center gap-2 px-3 py-3">
          <span className="flex-1 text-sm font-semibold">会话</span>
          <Button
            size="icon"
            variant="ghost"
            className="hidden size-8 text-muted-foreground md:inline-flex"
            aria-label="收起侧栏"
            onClick={onToggleCollapse}
          >
            <PanelLeftClose className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onNewChat()
              onClose()
            }}
          >
            <Plus /> 新建
          </Button>
        </div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索会话"
              className="py-1.5 pl-8 pr-7"
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
                    onSelect(c.id)
                    onClose()
                  }}
                  onRename={(title) => onRename(c.id, title)}
                  onDelete={() => onDelete(c)}
                  onTogglePin={() => onTogglePin(c)}
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
              onOpenSettings()
              onClose()
            }}
          >
            <Cog className="size-4" /> 系统设置
          </Button>
        </div>
      </aside>
    </>
  )
}
