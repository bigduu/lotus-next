import { guidanceService, type PendingGuidance } from "@services/chat/guidance"
import { Button } from "@/components/ui/button"

export function SessionGuidance({ sessionId, messages, busy, onCancel, onPreview }: {
  sessionId: string
  messages: PendingGuidance[]
  busy: boolean
  onCancel: (id: string) => void
  onPreview: (url: string) => void
}) {
  if (!messages.length) return null
  return <details aria-label="待发送队列" className="group mx-auto mb-2 max-w-2xl rounded-lg border bg-card text-xs">
    <summary aria-label={`待发 ${messages.length} 条消息`} className="cursor-pointer whitespace-nowrap rounded px-3 py-2 tabular-nums text-muted-foreground hover:bg-accent">待发 {messages.length}</summary>
    <div className="max-h-[min(12rem,25dvh)] overflow-y-auto overscroll-contain border-t px-3 py-1">
      {messages.map((item) => <div key={item.id} className="flex items-center gap-2 border-b py-2 last:border-0">
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-muted-foreground">{item.mode === "after_run" ? "运行结束后" : "本轮结束后"}</div>
          {item.text && <div className="whitespace-pre-wrap break-words">{item.text}</div>}
          {!!item.images?.length && <div className="mt-1 flex flex-wrap gap-1">{item.images.map((id, index) => {
            const url = guidanceService.imageUrl(sessionId, id)
            return <button key={`${id}-${index}`} onClick={() => onPreview(url)} aria-label={`查看待发图片 ${index + 1}`}><img src={url} alt={`待发图片 ${index + 1}`} className="size-12 rounded border object-cover" /></button>
          })}</div>}
        </div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onCancel(item.id)}>撤回</Button>
      </div>)}
    </div>
  </details>
}
