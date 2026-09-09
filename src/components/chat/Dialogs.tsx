import { useState } from "react"
import type { PendingQuestion, PendingApproval } from "@/hooks/useChat"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"

export function QuestionDialog({
  q,
  onAnswer,
  loading = false,
  submitting = false,
  unavailable = false,
  error = null,
  canRetry = false,
  onRefresh,
  onRetry,
}: {
  q: PendingQuestion
  onAnswer: (text: string) => void
  loading?: boolean
  submitting?: boolean
  unavailable?: boolean
  error?: string | null
  canRetry?: boolean
  onRefresh: () => void
  onRetry: () => void
}) {
  const permission = q.interaction_kind === "permission" ? q.permission_request : null
  const identity = JSON.stringify([q.interaction_kind, q.tool_call_id, permission?.request_generation])
  const [draft, setDraft] = useState({ identity, text: "" })
  const custom = draft.identity === identity ? draft.text : ""
  const disabled = loading || submitting || unavailable || canRetry
  const options = permission
    ? [{ value: "allow_once", label: "仅本次允许" }, { value: "deny_once", label: "仅本次拒绝" }]
      .filter((option) => permission.allowed_decisions.includes(option.value))
    : q.options.map((value) => ({ value, label: value }))
  return (
    <ResponsiveDialog open>
      <ResponsiveDialogContent
        dismissable={false}
        showCloseButton={false}
        className="p-5"
      >
        <ResponsiveDialogTitle>{permission ? "需要操作授权" : "需要你确认"}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {q.question}
        </ResponsiveDialogDescription>
        <div className="mt-4 flex flex-col gap-2">
          {options.map((opt) => (
            <Button
              key={opt.value}
              variant="secondary"
              className="h-auto justify-start whitespace-normal py-2 text-left"
              disabled={disabled}
              onClick={() => onAnswer(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        {!permission && q.allow_custom ? (
          <div className="mt-3">
            <Textarea
              value={custom}
              disabled={disabled}
              onChange={(e) => setDraft({ identity, text: e.target.value })}
              placeholder="或输入自定义回答…"
              rows={2}
              className="rounded-lg border px-3 py-2"
            />
            <Button
              className="mt-2 w-full"
              disabled={disabled || !custom.trim()}
              onClick={() => onAnswer(custom.trim())}
            >
              提交回答
            </Button>
          </div>
        ) : null}
        {submitting || loading ? <p role="status" className="mt-3 text-sm text-muted-foreground">{submitting ? "正在提交…" : "正在刷新…"}</p> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
        {permission && options.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">当前没有可用的本次操作选项，请刷新请求。</p> : null}
        <div className="mt-3 flex gap-2">
          <Button variant="outline" disabled={loading || submitting} onClick={onRefresh}>刷新请求</Button>
          {canRetry ? <Button variant="secondary" disabled={loading || submitting} onClick={onRetry}>重试上次提交</Button> : null}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
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
    <ResponsiveDialog open>
      <ResponsiveDialogContent
        dismissable={false}
        showCloseButton={false}
        className="p-5"
      >
        <ResponsiveDialogTitle>子代理请求授权</ResponsiveDialogTitle>
        <p className="mt-2 text-sm text-muted-foreground">
          子代理请求执行需要批准的操作。
        </p>
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
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => onRespond(false)}
          >
            拒绝
          </Button>
          <Button className="flex-1" onClick={() => onRespond(true)}>
            批准
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
