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
  return <details className="group text-xs">
    <summary aria-label={`待发 ${messages.length} 条消息`} className="cursor-pointer list-none whitespace-nowrap rounded px-1.5 py-1 tabular-nums text-muted-foreground hover:bg-accent"><span className="hidden sm:inline">待发 </span>{messages.length}</summary>
    <div className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-64 overflow-y-auto rounded-lg border bg-popover p-2 shadow-md">
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
