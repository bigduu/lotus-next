import { RotateCcw } from "@lucide/solid"
import { createMemo, Show } from "solid-js"
import { backgroundExecWaitActive } from "@/lib/chat/runtimeNotices"
import { extractDiagnosticId, type RunDiagnosticsSubject } from "@/lib/runDiagnosticId"
import { describeRunFailure } from "@/lib/runFailureGuidance"
import { appStore } from "@shared/store/appStore/state"
import type { UpstreamRetryFeedback } from "@services/chat/upstreamRetry"
import { createUiLocale, createUiText } from "../../shell/uiText"
import { createStoreSelector } from "../../state/createStoreSelector"
import { Button } from "../../ui/button"
import type { createChat } from "../createChat"
import { RunDiagnosticsEntry } from "./RunDiagnosticsEntry"

const upstreamStatus = {
  requesting: "upstream_retry_requesting",
  already_running: "upstream_retry_already_running",
  enabled: "upstream_retry_enabled",
  stopping: "upstream_retry_stopping",
  stop_requested: "upstream_retry_stop_requested",
  not_started: "upstream_retry_not_started",
  unavailable: "upstream_retry_unavailable",
  identity_unsaved: "upstream_retry_identity_unsaved",
  identity_unavailable: "upstream_retry_identity_unavailable",
  stop_unconfirmed: "upstream_retry_stop_unconfirmed",
} as const satisfies Record<UpstreamRetryFeedback, string>

export function ChatRunStatus(props: {
  chat: ReturnType<typeof createChat>
  rootUnsafe?: boolean
  retryDisabled?: boolean
  onContinueEditing: () => void
}) {
  const text = createUiText()
  const locale = createUiLocale()
  const chat = props.chat
  const active = () => chat.currentChat
  const currentId = () => chat.currentSessionId
  const managedHistoryStale = createStoreSelector(appStore, (state) => {
    const id = currentId()
    return !!id && state.managedHistoryBindings[id]?.status === "stale"
  })
  const waitingForHuman = () => Boolean(chat.pendingQuestion || chat.pendingApproval)
    || active()?.activity === "waiting_user" || active()?.planMode?.status === "awaiting_approval"
  const currentlyRunning = createMemo(() => {
    const session = active()
    if (session?.isRunning || (chat.sending && chat.streaming !== null)) return true
    if (!session || session.lastRunStatus !== "suspended"
      || chat.pendingQuestion || chat.pendingApproval
      || (session.activity !== undefined && session.activity !== "waiting_bash")) return false
    const last = session.messages.at(-1)
    return !!last && backgroundExecWaitActive([{
      metadata: (last as { metadata?: { runtime_kind?: unknown } }).metadata,
      content: "content" in last ? last.content : undefined,
    }])
  })
  const visibleFailure = createMemo(() => {
    const failure = chat.sendFailure
    return failure && failure.sessionId === currentId()
      && (failure.kind === "submission-unconfirmed" || !waitingForHuman()) ? failure : null
  })
  const persistedError = createMemo(() => !visibleFailure() && !waitingForHuman() && !currentlyRunning() && active()?.lastRunStatus === "error"
    ? active()?.lastRunError?.trim() || text("generation_failed_the_server_provided_no_error_details_d70c7744") : null)
  const generationFailed = () => visibleFailure()?.kind === "generation-failed" || persistedError() !== null
  const errorDetail = createMemo(() => visibleFailure()?.message?.trim()
    || (generationFailed() && active()?.lastRunStatus === "error" ? active()?.lastRunError?.trim() || persistedError() : null))
  const canonicalRevision = createMemo(() => JSON.stringify([active()?.createdAtExact ?? active()?.createdAt, active()?.updatedAt]))
  const guidance = createMemo(() => {
    locale()
    return generationFailed() ? describeRunFailure(errorDetail()) : null
  })
  const subject = createMemo<RunDiagnosticsSubject>(() => {
    // A new canonical session revision invalidates an open receipt even if the
    // string of its terminal error happens to match.
    canonicalRevision()
    const failure = visibleFailure()
    const detail = errorDetail()
    return {
      sessionId: currentId(), localOperationId: failure?.operationId ?? null,
      failureKind: failure?.kind ?? "generation-failed",
      diagnosticId: extractDiagnosticId(detail), errorBinding: detail,
      liveDiagnostic: failure?.kind === "generation-failed" ? failure.diagnostic : null,
    }
  })
  const title = () => {
    const failure = visibleFailure()
    if (failure?.kind === "submission-unconfirmed") {
      if (!failure.rejectionCode) return text("sending_is_unconfirmed_your_content_is_preserved_4f66238c")
      return text(failure.rootModeSelectionSubmitted
        ? "bamboo_rejected_the_mode_change_your_content_is_preserv_3445f2fc"
        : "bamboo_rejected_the_request_your_content_is_preserved_74a6cc8c")
    }
    if (props.rootUnsafe && generationFailed()) return text("message_saved_but_execution_is_stopped_for_this_session_bacf408a")
    return guidance()?.title ?? text("message_sent_but_generation_was_interrupted_62a4d83d")
  }
  const instruction = () => {
    if (props.rootUnsafe && generationFailed()) return text("the_root_permission_change_is_unconfirmed_your_message__fd9a5b04")
    const failure = visibleFailure()
    if (failure?.kind === "submission-unconfirmed" && failure.rejectionCode === "session_project_running_conflict") {
      return text("session_source_conflict_action")
    }
    return guidance()?.action
  }
  const retry = () => {
    if (props.rootUnsafe || props.retryDisabled || chat.executionCompatibility.blocked || chat.sending || !generationFailed()) return
    const failure = visibleFailure()
    void chat.retry(failure?.kind === "generation-failed" ? failure : undefined)
  }

  return <>
    <Show when={managedHistoryStale()}>
      <div role="alert" class="mx-4 mb-2 text-xs text-destructive">{text("supervisor_managed_history_stale")}</div>
    </Show>
    <Show when={visibleFailure() || persistedError()}>
      <div role="alert" aria-live="assertive"
        class="mx-auto mb-1 flex w-[calc(100%-1.5rem)] max-w-full shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
        <div class="min-w-0 flex-1 text-destructive">
          <p class="font-medium">{title()}</p>
          <Show when={instruction()}>{(message) => <p class="mt-1 text-xs">{message()}</p>}</Show>
          <Show when={errorDetail()}>{(detail) => (
            <Show when={visibleFailure()?.kind === "submission-unconfirmed"} fallback={
              <details class="mt-1 text-xs">
                <summary>{text("technical_details_c26fb419")}</summary>
                <p class="mt-1 break-words">{detail()}</p>
              </details>
            }>
              <p class="mt-1 break-words text-xs">{detail()}</p>
            </Show>
          )}</Show>
        </div>
        <Show when={!currentlyRunning()}><RunDiagnosticsEntry subject={subject()} /></Show>
        <Show when={!props.rootUnsafe}>
          <Show when={generationFailed()} fallback={
            <Button type="button" size="sm" variant="secondary" onClick={props.onContinueEditing}>{text("continue_editing_fd4b9e3b")}</Button>
          }>
            <Button type="button" size="sm" variant="secondary"
              disabled={chat.sending || props.retryDisabled || chat.executionCompatibility.blocked} onClick={retry}>
              <RotateCcw class="size-3.5" />{text("retry_generation_37960b38")}
            </Button>
          </Show>
        </Show>
      </div>
    </Show>
    <Show when={chat.upstreamRetryNotice}>{(notice) =>
      <p role="status" class="mx-4 mb-2 text-xs text-muted-foreground">{notice()}</p>
    }</Show>
    <Show when={chat.upstreamRetryStatus}>{(status) =>
      <p role="status" class="mx-4 mb-2 text-xs text-muted-foreground">{text(upstreamStatus[status()])}</p>
    }</Show>
  </>
}
