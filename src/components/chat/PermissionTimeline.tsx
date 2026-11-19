import { Button } from "@/components/ui/button"
import type { PendingQuestion } from "@/hooks/useChat"
import { permissionOperation } from "@services/chat/permissionDecision"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { ApprovalPresentation } from "./ApprovalPresentation"
import { permissionActions, permissionReceiptText, type HistoryDecision } from "./permissionPresentation"

type PermissionQuestion = Extract<PendingQuestion, { interaction_kind: "permission" }>
type OperationDetails = { operation: string; workingDirectory?: string }

export function ApprovalOperation({ operation, workingDirectory }: OperationDetails) {
  useUiLocale()
  return <>
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-2 text-xs leading-relaxed">
      {operation}
    </pre>
    {workingDirectory ? <p className="break-all text-xs text-muted-foreground">
      {uiText("working_directory_3db7b06b")} <span className="font-mono">{workingDirectory}</span>
    </p> : null}
  </>
}

export function ApprovalReceipt({ decision, continued = false, ...details }: OperationDetails & {
  decision: HistoryDecision
  continued?: boolean
}) {
  useUiLocale()
  return <ApprovalPresentation title={permissionReceiptText(decision, continued)} actions={[]}>
    <ApprovalOperation {...details} />
  </ApprovalPresentation>
}

export type QuestionControls = {
  onAnswer: (choice: string) => void
  onRefresh: () => void
  onRetry: () => void
  loading: boolean
  submitting: boolean
  unavailable: boolean
  error: string | null
  canRetry: boolean
}

export function PermissionQuestionCard({ question, workspace, controls }: {
  question: PermissionQuestion
  workspace?: string | null
  controls: QuestionControls
}) {
  useUiLocale()
  const { onAnswer, onRefresh, onRetry, loading, submitting, unavailable, error, canRetry } = controls
  const details = permissionOperation(question.permission_request, question.tool_arguments, workspace)
  const actions = permissionActions(question.permission_request, onAnswer)
  return <ApprovalPresentation title={uiText("action_approval_required_3bd71c54")}
    description={question.question.includes(details.operation) ? undefined : question.question}
    disabled={loading || submitting || unavailable || canRetry} actions={actions}
    footer={<>
      {submitting || loading ? <p role="status" className="text-xs text-muted-foreground">
        {uiText(submitting ? "submitting_26ef00b7" : "refreshing_71659de8")}
      </p> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {!actions.length ? <p className="text-xs text-muted-foreground">
        {uiText("no_action_choices_are_available_for_this_request_refres_7be8bf22")}
      </p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={loading || submitting} onClick={onRefresh}>
          {uiText("refresh_request_0ab317cc")}
        </Button>
        {canRetry ? <Button type="button" variant="secondary" size="sm" disabled={loading || submitting} onClick={onRetry}>
          {uiText("retry_last_submission_2970e28a")}
        </Button> : null}
      </div>
    </>}>
    <ApprovalOperation {...details} />
  </ApprovalPresentation>
}
