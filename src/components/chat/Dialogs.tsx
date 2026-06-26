import { useState, type ReactNode } from "react"
import type { PendingQuestion, PendingApproval } from "@/hooks/useChat"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 md:items-center">
      <div
        className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-xl"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        {children}
      </div>
    </div>
  )
}

export function QuestionDialog({
  q,
  onAnswer,
}: {
  q: PendingQuestion
  onAnswer: (text: string) => void
}) {
  const [custom, setCustom] = useState("")
  return (
    <Overlay>
      <h2 className="text-base font-semibold">需要你确认</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{q.question}</p>
      <div className="mt-4 flex flex-col gap-2">
        {q.options.map((opt) => (
          <Button
            key={opt}
            variant="secondary"
            className="h-auto justify-start whitespace-normal py-2 text-left"
            onClick={() => onAnswer(opt)}
          >
            {opt}
          </Button>
        ))}
      </div>
      {q.allowCustom ? (
        <div className="mt-3">
          <Textarea
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="或输入自定义回答…"
            rows={2}
            className="rounded-lg border px-3 py-2"
          />
          <Button
            className="mt-2 w-full"
            disabled={!custom.trim()}
            onClick={() => onAnswer(custom.trim())}
          >
            提交回答
          </Button>
        </div>
      ) : null}
    </Overlay>
  )
}

export function ApprovalDialog({
  a,
  onRespond,
}: {
  a: PendingApproval
  onRespond: (approved: boolean) => void
}) {
  return (
    <Overlay>
      <h2 className="text-base font-semibold">子代理请求授权</h2>
      <p className="mt-2 text-sm text-muted-foreground">子代理请求执行需要批准的操作。</p>
      <div className="mt-3 space-y-1 rounded-lg border p-3 text-sm">
        {a.toolName ? (
          <div>
            <span className="text-muted-foreground">工具:</span> {a.toolName}
          </div>
        ) : null}
        {a.permission ? (
          <div>
            <span className="text-muted-foreground">权限:</span> {a.permission}
          </div>
        ) : null}
        {a.resource ? (
          <div className="break-all">
            <span className="text-muted-foreground">资源:</span> {a.resource}
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => onRespond(false)}>
          拒绝
        </Button>
        <Button className="flex-1" onClick={() => onRespond(true)}>
          批准
        </Button>
      </div>
    </Overlay>
  )
}
