import { uiText, useUiLocale } from "@shared/i18n/ui"
import { guidanceService, type PendingGuidance } from "@services/chat/guidance"
import { Button } from "@/components/ui/button"

export function SessionGuidance({ sessionId, messages, busy, onCancel, onPreview }: {
  sessionId: string
  messages: PendingGuidance[]
  busy: boolean
  onCancel: (id: string) => void
  onPreview: (url: string) => void
}) {
  useUiLocale()
  if (!messages.length) return null
  return <details aria-label={uiText("message_queue_9dc5a845")} className="group mx-auto mb-2 w-full max-w-6xl rounded-lg border bg-card text-xs">
    <summary aria-label={uiText("queued_messages_daa57141", { v0: messages.length , count: messages.length })} className="cursor-pointer whitespace-nowrap rounded px-3 py-2 tabular-nums text-muted-foreground hover:bg-accent">{uiText("queued_f9e719c6")} {messages.length}</summary>
    <div className="max-h-[min(12rem,25dvh)] overflow-y-auto overscroll-contain border-t px-3 py-1">
      {messages.map((item) => <div key={item.id} className="flex items-center gap-2 border-b py-2 last:border-0">
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-muted-foreground">{item.mode === "after_run" ? uiText("after_run_81638e07") : uiText("after_tool_call_252b019e")}</div>
          {item.text && <div className="whitespace-pre-wrap break-words">{item.text}</div>}
          {!!item.images?.length && <div className="mt-1 flex flex-wrap gap-1">{item.images.map((id, index) => {
            const url = guidanceService.imageUrl(sessionId, id)
            return <button key={`${id}-${index}`} onClick={() => onPreview(url)} aria-label={uiText("view_queued_image_81c3b7ba", { v0: index + 1 })}><img src={url} alt={uiText("queued_image_009dcc09", { v0: index + 1 })} className="size-12 rounded border object-cover" /></button>
          })}</div>}
        </div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onCancel(item.id)}>{uiText("withdraw_6b581989")}</Button>
      </div>)}
    </div>
  </details>
}
