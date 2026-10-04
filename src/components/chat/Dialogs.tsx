import { uiText, useUiLocale } from "@shared/i18n/ui"
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
  useUiLocale()
  const permission = q.interaction_kind === "permission" ? q.permission_request : null
  const identity = JSON.stringify([q.interaction_kind, q.tool_call_id, permission?.request_generation])
  const [draft, setDraft] = useState({ identity, text: "" })
  const custom = draft.identity === identity ? draft.text : ""
  const disabled = loading || submitting || unavailable || canRetry
  const options = permission
    ? [{ value: "allow_once", label: uiText("allow_once_390dd1fc") }, { value: "deny_once", label: uiText("deny_once_29b8bbf3") }]
      .filter((option) => permission.allowed_decisions.includes(option.value))
    : q.options.map((value) => ({ value, label: value }))
  return (
    <ResponsiveDialog open>
      <ResponsiveDialogContent
        dismissable={false}
        showCloseButton={false}
        className="p-5"
      >
        <ResponsiveDialogTitle>{permission ? uiText("action_approval_required_3bd71c54") : uiText("your_confirmation_is_needed_383ebd59")}</ResponsiveDialogTitle>
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
              placeholder={uiText("or_type_a_custom_response_ba17604e")}
              rows={2}
              className="rounded-lg border px-3 py-2"
            />
            <Button
              className="mt-2 w-full"
              disabled={disabled || !custom.trim()}
              onClick={() => onAnswer(custom.trim())}
            >
              {uiText("submit_answer_0c1762dd")}</Button>
          </div>
        ) : null}
        {submitting || loading ? <p role="status" className="mt-3 text-sm text-muted-foreground">{submitting ? uiText("submitting_26ef00b7") : uiText("refreshing_71659de8")}</p> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
        {permission && options.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{uiText("no_action_choices_are_available_for_this_request_refres_7be8bf22")}</p> : null}
        <div className="mt-3 flex gap-2">
          <Button variant="outline" disabled={loading || submitting} onClick={onRefresh}>{uiText("refresh_request_0ab317cc")}</Button>
          {canRetry ? <Button variant="secondary" disabled={loading || submitting} onClick={onRetry}>{uiText("retry_last_submission_2970e28a")}</Button> : null}
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
  useUiLocale()
  return (
    <ResponsiveDialog open>
      <ResponsiveDialogContent
        dismissable={false}
        showCloseButton={false}
        className="p-5"
      >
        <ResponsiveDialogTitle>{uiText("subagent_approval_request_4321e83b")}</ResponsiveDialogTitle>
        <p className="mt-2 text-sm text-muted-foreground">
          {uiText("a_subagent_requests_approval_for_an_operation_940aa95b")}</p>
        <div className="mt-3 space-y-1 rounded-lg border p-3 text-sm">
          {a.toolName ? (
            <div>
              <span className="text-muted-foreground">{uiText("tool_3e990ad5")}</span> {a.toolName}
            </div>
          ) : null}
          {a.permission ? (
            <div>
              <span className="text-muted-foreground">{uiText("permission_5ab9623e")}</span> {a.permission}
            </div>
          ) : null}
          {a.resource ? (
            <div className="break-all">
              <span className="text-muted-foreground">{uiText("resource_05e94286")}</span> {a.resource}
            </div>
          ) : null}
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => onRespond(false)}
          >
            {uiText("deny_136de7a8")}</Button>
          <Button className="flex-1" onClick={() => onRespond(true)}>
            {uiText("approve_8cbe697b")}</Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
