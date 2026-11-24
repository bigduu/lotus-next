import { createMemo, createSignal, For, Show, untrack, type Accessor } from "solid-js"
import { permissionDecisionFor, permissionOperation } from "@services/chat/permissionDecision"
import type { PermissionRequest } from "@services/chat/AgentService"
import type { AssistantToolResultMessage } from "@shared/types/chatMessages"
import { createUiText } from "../shell/uiText"
import { Button } from "../ui/button"
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle,
} from "../ui/responsive-dialog"
import { Textarea } from "../ui/textarea"
import type { createChat, PendingApproval, PendingQuestion } from "./createChat"
import { ApprovalPresentation } from "./interactions/ApprovalPresentation"
import type { TimelineAttachment } from "./interactions/timelineAttachments"
import { SessionCompatibilityNotice } from "./status/SessionCompatibilityNotice"

type Chat = ReturnType<typeof createChat>
type Text = ReturnType<typeof createUiText>
type PermissionQuestion = Extract<PendingQuestion, { interaction_kind: "permission" }>
type Clarification = Extract<PendingQuestion, { interaction_kind: "clarification" }>
type HistoryDecision = NonNullable<NonNullable<AssistantToolResultMessage["permissionHistory"]>["decision"]>
type OperationDetails = { operation: string; workingDirectory?: string }

const permissionKey = (request: PermissionRequest) =>
  JSON.stringify(["permission", request.session_id, request.request_id, request.request_generation])

function questionIdentity(sessionId: string | null, question: PendingQuestion): string {
  return question.interaction_kind === "permission"
    ? JSON.stringify([permissionKey(question.permission_request), question.permission_request.policy_revision])
    : JSON.stringify([sessionId, question.interaction_kind, question.tool_call_id])
}

function ApprovalOperation(props: OperationDetails & { text: Text }) {
  return <>
    <pre class="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-2 text-xs leading-relaxed">
      {props.operation}
    </pre>
    <Show when={props.workingDirectory}>
      <p class="break-all text-xs text-muted-foreground">
        {props.text("working_directory_3db7b06b")} <span class="font-mono">{props.workingDirectory}</span>
      </p>
    </Show>
  </>
}

function receiptLabel(text: Text, decision: HistoryDecision, continued: boolean) {
  if (decision === "allow_session") {
    return text(continued ? "permission_session_allow_continued" : "permission_session_allow_recorded")
  }
  if (continued) {
    return text(decision.startsWith("deny_") ? "permission_denied_and_continued" : "permission_allowed_and_continued")
  }
  return text(decision.startsWith("deny_") ? "permission_deny_recorded" : "permission_allow_recorded")
}

function PermissionReceipt(props: OperationDetails & { decision: HistoryDecision; continued: boolean; text: Text }) {
  return <ApprovalPresentation title={receiptLabel(props.text, props.decision, props.continued)} actions={[]}>
    <ApprovalOperation operation={props.operation} workingDirectory={props.workingDirectory} text={props.text} />
  </ApprovalPresentation>
}

function QuestionStatus(props: { chat: Chat; text: Text; retry: () => void; compact?: boolean }) {
  const waiting = () => props.chat.questionLoading || props.chat.questionSubmitting
  return <>
    <Show when={waiting()}>
      <p role="status" class={props.compact ? "text-xs text-muted-foreground" : "mt-3 text-sm text-muted-foreground"}>
        {props.text(props.chat.questionSubmitting ? "submitting_26ef00b7" : "refreshing_71659de8")}
      </p>
    </Show>
    <Show when={props.chat.questionError}>
      <p role="alert" class={props.compact ? "text-xs text-destructive" : "mt-3 text-sm text-destructive"}>
        {props.chat.questionError}
      </p>
    </Show>
    <div class={props.compact ? "flex flex-wrap gap-2" : "mt-3 flex gap-2"}>
      <Button type="button" variant="outline" size={props.compact ? "sm" : undefined} disabled={waiting()}
        onClick={() => { void props.chat.refreshQuestion() }}>
        {props.text("refresh_request_0ab317cc")}
      </Button>
      <Show when={props.chat.questionCanRetry}>
        <Button type="button" variant="secondary" size={props.compact ? "sm" : undefined}
          disabled={waiting()} onClick={props.retry}>
          {props.text("retry_last_submission_2970e28a")}
        </Button>
      </Show>
    </div>
  </>
}

function questionDisabled(chat: Chat) {
  return chat.executionCompatibility.blocked || chat.questionLoading || chat.questionSubmitting
    || chat.questionUnavailable || chat.questionCanRetry
}

function PermissionCard(props: {
  question: PermissionQuestion
  workspace?: string | null
  chat: Chat
  text: Text
  answer: (choice: string) => void
  retry: () => void
}) {
  const operation = createMemo(() => permissionOperation(
    props.question.permission_request, props.question.tool_arguments, props.workspace,
  ))
  const actions = createMemo(() => {
    const request = props.question.permission_request
    const shell = request.tool_name === "exec_command" || request.tool_name === "Bash"
    const choices = [
      ["deny_once", "deny_once_29b8bbf3"],
      ["allow_once", "allow_once_390dd1fc"],
      ["allow_session", shell ? "permission_allow_command_for_session" : "permission_allow_resource_for_session"],
    ] as const
    return choices.filter(([choice]) => permissionDecisionFor(request, choice) !== null)
      .map(([choice, label]) => ({
        id: choice,
        label: props.text(label),
        onSelect: () => props.answer(choice),
      }))
  })
  const exactResource = () => props.question.permission_request.resource
  return (
    <ApprovalPresentation
      title={props.text("action_approval_required_3bd71c54")}
      description={props.question.question.includes(operation().operation) ? undefined : props.question.question}
      actions={actions()} disabled={questionDisabled(props.chat)}
      footer={<>
        <Show when={actions().length === 0}>
          <p class="text-xs text-muted-foreground">
            {props.text("no_action_choices_are_available_for_this_request_refres_7be8bf22")}
          </p>
        </Show>
        <QuestionStatus chat={props.chat} text={props.text} retry={props.retry} compact />
      </>}>
      <ApprovalOperation operation={operation().operation} workingDirectory={operation().workingDirectory} text={props.text} />
      <Show when={exactResource() && exactResource() !== operation().operation}>
        <p class="break-all text-xs text-muted-foreground">
          {props.text("resource_05e94286")} <span class="font-mono">{exactResource()}</span>
        </p>
      </Show>
    </ApprovalPresentation>
  )
}

function ClarificationDialog(props: {
  question: Clarification
  chat: Chat
  text: Text
  answer: (choice: string) => void
  retry: () => void
}) {
  const [draft, setDraft] = createSignal("")
  const disabled = () => questionDisabled(props.chat)
  return (
    <ResponsiveDialog open>
      <ResponsiveDialogContent dismissable={false} showCloseButton={false} class="p-5">
        <ResponsiveDialogTitle>{props.text("your_confirmation_is_needed_383ebd59")}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription class="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {props.question.question}
        </ResponsiveDialogDescription>
        <div class="mt-4 flex flex-col gap-2">
          <For each={props.question.options}>
            {(option) => (
              <Button type="button" variant="secondary" class="h-auto justify-start whitespace-normal py-2 text-left"
                disabled={disabled()} onClick={() => props.answer(option)}>
                {option}
              </Button>
            )}
          </For>
        </div>
        <Show when={props.question.allow_custom}>
          <div class="mt-3">
            <Textarea value={draft()} disabled={disabled()} onInput={(event) => setDraft(event.currentTarget.value)}
              placeholder={props.text("or_type_a_custom_response_ba17604e")} rows={2} class="rounded-lg border px-3 py-2" />
            <Button type="button" class="mt-2 w-full" disabled={disabled() || !draft().trim()}
              onClick={() => props.answer(draft().trim())}>
              {props.text("submit_answer_0c1762dd")}
            </Button>
          </div>
        </Show>
        <QuestionStatus chat={props.chat} text={props.text} retry={props.retry} />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function ChildApprovalCard(props: { request: PendingApproval; chat: Chat; text: Text }) {
  const respond = (approved: boolean) => {
    if (props.chat.pendingApproval === props.request) void props.chat.respondApproval(approved)
  }
  return (
    <ApprovalPresentation title={props.text("subagent_approval_request_4321e83b")}
      description={props.text("a_subagent_requests_approval_for_an_operation_940aa95b")}
      disabled={props.chat.approvalSubmitting || props.chat.approvalCompatibility.blocked}
      actions={[
        { id: "deny", label: props.text("deny_136de7a8"), onSelect: () => respond(false) },
        { id: "approve", label: props.text("approve_8cbe697b"), onSelect: () => respond(true) },
      ]}
      footer={<>
        <Show when={props.chat.approvalSubmitting}>
          <p role="status" class="mt-3 text-sm text-muted-foreground">{props.text("submitting_26ef00b7")}</p>
        </Show>
        <Show when={props.chat.approvalError}>
          <p role="alert" class="mt-3 text-sm text-destructive">{props.chat.approvalError}</p>
        </Show>
      </>}>
      <div class="mt-3 space-y-1 rounded-lg border p-3 text-sm">
        <Show when={props.request.toolName}>
          <div><span class="text-muted-foreground">{props.text("tool_3e990ad5")}</span> {props.request.toolName}</div>
        </Show>
        <Show when={props.request.permission}>
          <div><span class="text-muted-foreground">{props.text("permission_5ab9623e")}</span> {props.request.permission}</div>
        </Show>
        <Show when={props.request.resource}>
          <div class="break-all"><span class="text-muted-foreground">{props.text("resource_05e94286")}</span> {props.request.resource}</div>
        </Show>
      </div>
    </ApprovalPresentation>
  )
}

function visibleQuestion(chat: Chat) {
  const question = chat.pendingQuestion
  if (!question || chat.executionCompatibility.blocked) return null
  if (question.interaction_kind === "clarification" && chat.pendingApproval && !chat.approvalCompatibility.blocked) return null
  return question
}

export function createRunInteractionTimeline(options: {
  chat: Chat
  workspace: Accessor<string | null | undefined>
}): Accessor<TimelineAttachment[]> {
  const text = createUiText()
  const chat = options.chat
  const history = createMemo(() => {
    const entries = new Map<string, TimelineAttachment>()
    const anchors = new Map<string, string>()
    for (const message of chat.messages) {
      if (message.role !== "assistant" || message.type !== "tool_result" || !message.permissionHistory) continue
      const record = message.permissionHistory
      const key = JSON.stringify(["permission", chat.currentSessionId, record.requestId, record.generation])
      const decision = record.decision
      anchors.set(key, message.id)
      if (decision) entries.set(key, {
        key, afterMessageId: message.id,
        render: () => <PermissionReceipt operation={record.operation} workingDirectory={record.workingDirectory}
          decision={decision} continued={false} text={text} />,
      })
    }
    return { entries, anchors }
  })

  return createMemo(() => {
    const { entries, anchors } = history()
    const cards = new Map(entries)
    const recorded = chat.recordedPermission
    if (recorded) {
      const key = permissionKey(recorded.question.permission_request)
      const operation = () => permissionOperation(
        recorded.question.permission_request, recorded.question.tool_arguments, options.workspace(),
      )
      cards.set(key, {
        key, afterMessageId: anchors.get(key) ?? null,
        render: () => <PermissionReceipt operation={operation().operation} workingDirectory={operation().workingDirectory}
          decision={recorded.decision} continued={recorded.continued} text={text} />,
      })
    }

    const initial = visibleQuestion(chat)
    if (initial?.interaction_kind === "permission") {
      const key = permissionKey(initial.permission_request)
      if (!cards.has(key)) {
        const identity = questionIdentity(chat.currentSessionId, initial)
        const answer = chat.answerQuestion
        const retry = chat.retryQuestion
        const question = () => {
          const latest = visibleQuestion(chat)
          const confirmed = chat.recordedPermission
          if (confirmed && permissionKey(confirmed.question.permission_request) === key) return null
          return latest?.interaction_kind === "permission" && questionIdentity(chat.currentSessionId, latest) === identity
            ? latest : null
        }
        cards.set(key, {
          key, afterMessageId: anchors.get(key) ?? null,
          render: () => <Show when={question()}>{(current) => (
            <PermissionCard question={current()} workspace={options.workspace()} chat={chat} text={text}
              answer={(choice) => { void answer(choice) }} retry={() => { void retry() }} />
          )}</Show>,
        })
      }
    }
    const approval = chat.pendingApproval
    if (approval && !chat.approvalCompatibility.blocked) {
      const key = JSON.stringify(["child-approval", approval.childSessionId, approval.requestId])
      cards.set(key, {
        key, afterMessageId: null,
        render: () => <Show when={chat.pendingApproval === approval && !chat.approvalCompatibility.blocked}>
          <ChildApprovalCard request={approval} chat={chat} text={text} />
        </Show>,
      })
    }
    return [...cards.values()]
  })
}

export function RunInteractions(props: { chat: Chat }) {
  const text = createUiText()
  const pending = () => visibleQuestion(props.chat)
  const pendingIdentity = () => {
    const question = pending()
    return question ? questionIdentity(props.chat.currentSessionId, question) : null
  }
  const needsStandaloneError = () => {
    if (!props.chat.questionError) return false
    const question = pending()
    if (!question) return true
    if (question.interaction_kind !== "permission") return false
    const request = question.permission_request
    const recorded = props.chat.recordedPermission
    return (recorded && permissionKey(recorded.question.permission_request) === permissionKey(request))
      || props.chat.messages.some((message) => message.role === "assistant" && message.type === "tool_result"
        && message.permissionHistory?.decision && message.permissionHistory.requestId === request.request_id
        && message.permissionHistory.generation === request.request_generation)
  }

  return <>
    <SessionCompatibilityNotice state={props.chat.executionCompatibility} />
    <Show when={props.chat.pendingApproval && props.chat.approvalCompatibility.blocked}>
      <section aria-label={text("subagent_approval_request_4321e83b")}>
        <p class="px-3 pt-2 text-sm font-medium">{text("subagent_approval_request_4321e83b")}</p>
        <SessionCompatibilityNotice state={props.chat.approvalCompatibility} />
      </section>
    </Show>
    <Show when={pending()?.interaction_kind === "clarification" ? pendingIdentity() : null} keyed>
      {(identity) => {
        const initial = untrack(pending)
        if (initial?.interaction_kind !== "clarification") return null
        const answer = untrack(() => props.chat.answerQuestion)
        const retry = untrack(() => props.chat.retryQuestion)
        const question = () => {
          const current = pending()
          return current?.interaction_kind === "clarification" && pendingIdentity() === identity ? current : initial
        }
        return <ClarificationDialog question={question()} chat={props.chat} text={text}
          answer={(choice) => { void answer(choice) }} retry={() => { void retry() }} />
      }}
    </Show>
    <Show when={needsStandaloneError()}>
      <div role="alert" class="mx-4 mb-3 flex items-center gap-3 rounded-lg border p-3 text-sm">
        <span>{props.chat.questionError}</span>
        <button type="button" class="shrink-0 underline" disabled={props.chat.questionLoading || props.chat.questionSubmitting}
          onClick={() => { void props.chat.refreshQuestion() }}>
          {text(props.chat.questionLoading ? "refreshing_71659de8" : "refresh_request_0ab317cc")}
        </button>
      </div>
    </Show>
  </>
}
