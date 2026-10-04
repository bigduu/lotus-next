import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useAppStore, selectSessionById } from "@shared/store/appStore"
import type { Message } from "@shared/types/chatMessages"
import { LazyMarkdown as Markdown } from "@/components/chat/LazyMarkdown"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
export function ReferencePane({ onClose, width }: { onClose: () => void; width?: number }) {
  useUiLocale()
  const chats = useAppStore(useShallow((s) => s.chats))
  const [sid, setSid] = useState<string | null>(null)
  const chat = useAppStore(useShallow(selectSessionById(sid)))
  const messages = chat?.messages ?? []

  useEffect(() => {
    if (sid) void useAppStore.getState().loadChatHistory(sid)
  }, [sid])

  return (
    <aside
      className="hidden shrink-0 flex-col border-l md:flex"
      style={{ width: width ?? 420 }}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <Select value={sid ?? undefined} onValueChange={(v) => setSid(v || null)}>
          <SelectTrigger className="min-w-0 flex-1">
            <SelectValue placeholder={uiText("select_a_session_to_compare_4a072dce")} />
          </SelectTrigger>
          <SelectContent>
            {chats.filter((c) => c.kind !== "child" && !c.parentSessionId).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.title || uiText("new_session_c57c30bc")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="icon" variant="ghost" aria-label={uiText("close_split_view_1e9b6e9d")} onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-3">
          {messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{uiText("select_a_session_to_view_33105165")}</p>
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
