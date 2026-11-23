import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import type { PermissionDecisionChoice, PermissionRequest } from "@services/chat/AgentService"
import { permissionDecisionFor } from "@services/chat/permissionDecision"

import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { ApprovalPresentation } from "../interactions/ApprovalPresentation"
import type { ApprovalReceipt, SupervisorApprovalEntry as Entry } from "./createSupervisorApprovals"

export type OpenRecordedSession = (id: string, expectedCreatedAt: string) => Promise<boolean>

type Text = ReturnType<typeof createUiText>
function receiptText(text: Text, receipt: ApprovalReceipt) {
  if (receipt.decision === "allow_session") {
    return text(receipt.continued ? "permission_session_allow_continued" : "permission_session_allow_recorded")
  }
  if (receipt.continued) return text(receipt.decision === "deny_once" ? "permission_denied_and_continued" : "permission_allowed_and_continued")
  return text(receipt.decision === "deny_once" ? "permission_deny_recorded" : "permission_allow_recorded")
}

function actionsFor(request: PermissionRequest, text: Text, select: (choice: PermissionDecisionChoice) => void) {
  const shell = request.tool_name === "exec_command" || request.tool_name === "Bash"
  const choices = [
    ["deny_once", "deny_once_29b8bbf3"],
    ["allow_once", "allow_once_390dd1fc"],
    ["allow_session", shell ? "permission_allow_command_for_session" : "permission_allow_resource_for_session"],
  ] as const
  return choices.filter(([choice]) => permissionDecisionFor(request, choice) !== null)
    .map(([choice, label]) => ({ id: choice, label: text(label), onSelect: () => select(choice) }))
}

interface ApprovalEntryProps {
  entry: Entry
  onRefresh: () => void
  onDecide: (choice: PermissionDecisionChoice) => void
  onOpenSession?: OpenRecordedSession
}

export function SupervisorApprovalEntry(props: ApprovalEntryProps) {
  const text = createUiText()
  const card = () => props.entry.kind === "card" ? props.entry : null
  return <Show when={card()} fallback={
    <div role="alert" class="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm" data-supervisor-approval-error>
      <span>{text("supervisor_approvals_unavailable")}</span>
      <Button type="button" variant="outline" size="sm" disabled={props.entry.stale} onClick={props.onRefresh}>
        {text("refresh_request_0ab317cc")}
      </Button>
    </div>
  }>{(entry) => <ApprovalCard entry={entry()} onRefresh={props.onRefresh} onDecide={props.onDecide} onOpenSession={props.onOpenSession} />}</Show>
}

function ApprovalCard(props: Omit<ApprovalEntryProps, "entry"> & { entry: Extract<Entry, { kind: "card" }> }) {
  const text = createUiText()
  const [openFailed, setOpenFailed] = createSignal(false)
  const [opening, setOpening] = createSignal(false)
  const card = () => props.entry.card
  const choices = createMemo(() => props.entry.receipt ? [] : actionsFor(card().request, text, props.onDecide))
  let alive = true
  let inFlight = false
  onCleanup(() => { alive = false })
  const open = async () => {
    const navigate = props.onOpenSession
    if (!navigate || !alive || inFlight) return
    const { sessionId, createdAt } = card()
    inFlight = true
    setOpening(true)
    setOpenFailed(false)
    try {
      const opened = await navigate(sessionId, createdAt)
      if (alive) setOpenFailed(!opened)
    } catch { if (alive) setOpenFailed(true) }
    finally { inFlight = false; if (alive) setOpening(false) }
  }

  return <ApprovalPresentation label={card().title} title={text("permission_from_managed_session")}
    source={<button type="button" disabled={!props.onOpenSession || opening()} class="max-w-full break-words text-sm underline underline-offset-2"
      onClick={() => void open()}>{card().title}</button>}
    actions={choices()} disabled={props.entry.stale || props.entry.submitting || props.entry.failed}
    footer={<>
      <Show when={props.entry.submitting}><p role="status" class="text-xs">{text("submitting_26ef00b7")}</p></Show>
      <Show when={props.entry.failed}>
        <div role="alert" class="flex flex-wrap items-center gap-2 text-xs">
          <span>{text("supervisor_approval_refresh_before_retry")}</span>
          <Button type="button" variant="outline" size="sm" disabled={props.entry.stale} onClick={props.onRefresh}>
            {text("refresh_request_0ab317cc")}
          </Button>
        </div>
      </Show>
      <Show when={openFailed()}><p role="alert" class="text-xs text-destructive">{text("supervisor_sessions_open_failed")}</p></Show>
    </>}>
    <pre class="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-2 text-xs leading-relaxed">{card().operation}</pre>
    <Show when={card().workingDirectory}>
      <p class="break-all text-xs text-muted-foreground">
        {text("working_directory_3db7b06b")} <span class="font-mono">{card().workingDirectory}</span>
      </p>
    </Show>
    <Show when={props.entry.receipt} fallback={
      <Show when={card().supervisorHandoffAt}>{(at) => <p class="text-xs text-muted-foreground">
        {text("supervisor_approval_handoff_at", { time: new Date(at()).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) })}
      </p>}</Show>
    }>{(receipt) => <p role="status" class="text-xs text-muted-foreground">{receiptText(text, receipt())}</p>}</Show>
  </ApprovalPresentation>
}
