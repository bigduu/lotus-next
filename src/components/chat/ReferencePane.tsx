import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useAppStore, selectSessionById } from "@shared/store/appStore"
import type { Message } from "@shared/types/chatMessages"
import { LazyMarkdown as Markdown } from "@/components/chat/LazyMarkdown"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function text(m: Message): string {
  if ("content" in m && typeof (m as { content?: unknown }).content === "string") {
    return (m as { content: string }).content
  }
  return ""
}

/**
 * Desktop-only read-only second pane: pick another session and view it
 * side-by-side (compare / reference). Full dual-composer multi-pane is deferred
 * — low value for a mobile-first app.
 */
export function ReferencePane({ onClose }: { onClose: () => void }) {
  const chats = useAppStore(useShallow((s) => s.chats))
  const [sid, setSid] = useState<string | null>(null)
  const chat = useAppStore(useShallow(selectSessionById(sid)))
  const messages = chat?.messages ?? []

  useEffect(() => {
    if (sid) void useAppStore.getState().loadChatHistory(sid)
  }, [sid])

  return (
    <aside className="hidden w-[420px] shrink-0 flex-col border-l md:flex">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <select
          value={sid ?? ""}
          onChange={(e) => setSid(e.target.value || null)}
          className="min-w-0 flex-1 truncate rounded-md border bg-transparent px-2 py-1 text-sm outline-none"
        >
          <option value="">选择会话对比…</option>
          {chats.map((c) => (
            <option key={c.id} value={c.id} className="bg-card">
              {c.title || "新会话"}
            </option>
          ))}
        </select>
        <Button size="icon" variant="ghost" aria-label="关闭分屏" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-3">
          {messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">选择一个会话查看</p>
          ) : (
            messages.map((m) => {
              if (m.role === "system") return null
              const isUser = m.role === "user"
              const t = text(m)
              if (!t) return null
              return (
                <div key={m.id} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[90%] rounded-2xl px-3 py-1.5 text-sm",
                      isUser
                        ? "whitespace-pre-wrap bg-primary text-primary-foreground"
                        : "bg-muted",
                    )}
                  >
                    {isUser ? t : <Markdown>{t}</Markdown>}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </aside>
  )
}
