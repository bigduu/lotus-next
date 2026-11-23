import { ArrowUp, Square } from "@lucide/solid"
import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js"
import { appStore } from "@shared/store/appStore/state"
import { newSessionPermissionStore } from "@shared/store/newSessionPermissionState"
import { createDraftCompletionRequest } from "@services/chat/draftCompletion"
import { getDraftCompletionEnabled, subscribeDraftCompletionEnabled } from "@shared/store/draftCompletionPreferenceState"
import { Button } from "../ui/button"
import { createStoreSelector } from "../state/createStoreSelector"
import { ComposerEditor, type ComposerFocusSnapshot } from "../composer/ComposerEditor"
import { createUiText } from "../shell/uiText"
import type { createChat } from "./createChat"

type Chat = ReturnType<typeof createChat>

export function ComposerPanel(props: {
  chat: Chat
  workspacePath: string | null
  projectId: string | null
  captureSessionCreated: () => (sessionId: string) => void
}) {
  const text = createUiText()
  const draftKey = () => props.chat.currentSessionId ?? ""
  const inputs = createStoreSelector(appStore, (state) => state.inputStates)
  const value = () => inputs()[draftKey()]?.content ?? ""
  const [predict, setPredict] = createSignal(getDraftCompletionEnabled())
  const [submitting, setSubmitting] = createSignal(false)
  let active = false
  const focusSnapshots = new Map<string, { current: ComposerFocusSnapshot }>()
  const draftIdentity = createMemo(() => ({ key: draftKey() }), {
    equals: (previous, next) => previous?.key === next.key,
  })

  onSettled(() => subscribeDraftCompletionEnabled(() => setPredict(getDraftCompletionEnabled())))
  const completion = createMemo(() => predict()
    ? createDraftCompletionRequest(props.chat.currentSessionId, props.chat.messages)
    : undefined)

  createEffect(draftKey, (key) => {
    if (key === "") void newSessionPermissionStore.getState().refresh()
  })

  const send = async () => {
    const key = draftKey()
    const draft = appStore.getState().inputStates[key]
    if (!draft?.content.trim() || props.chat.sending || props.chat.submissionPending || active) return
    active = true
    setSubmitting(true)
    const projectId = props.projectId
    const sessionCreated = props.captureSessionCreated()
    try {
      const result = await props.chat.send(draft.content, {
        projectId,
        workspacePath: props.workspacePath,
        permissionMode: key === "" ? newSessionPermissionStore.getState().mode : undefined,
        rootOrchestrationOnly: key === "" && draft.thinkingMode !== undefined ? draft.thinkingMode === "ultra" : undefined,
        thinkingMode: key === "" ? draft.thinkingMode : undefined,
        reasoningSelection: key === "" ? draft.reasoningEffort : undefined,
      })
      if (result.kind !== "accepted") return
      if (!key && projectId) sessionCreated(result.sessionId)
      const latest = appStore.getState()
      const cleared = latest.setInputContentIfRevision(key, draft.contentRevision, "")
      if (!cleared && result.navigated && key !== result.sessionId) {
        latest.moveInputContentIfRevision(key, latest.inputStates[key]?.contentRevision ?? 0, result.sessionId)
      }
      if (result.navigated && key !== result.sessionId) {
        if (draft.thinkingModeRevision !== undefined) latest.clearInputThinkingModeIfRevision(key, draft.thinkingModeRevision)
        if (latest.inputStates[key]?.reasoningEffort === draft.reasoningEffort) latest.clearInputReasoningEffort(key)
      }
    } catch (error) {
      console.error("[solid-composer] Submission failed:", error)
    } finally {
      active = false
      setSubmitting(false)
    }
  }

  return (
    <div data-composer-column="" class="mx-auto w-full max-w-4xl px-3 pb-3 sm:px-6">
      <Show when={props.chat.sendFailure}>
        {(failure) => <div role="alert" class="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {failure().message || text("submission_is_unconfirmed_refresh_or_retry_the_last_sub_f3127c94")}
        </div>}
      </Show>
      <div class="min-w-0 rounded-3xl border bg-background p-2">
        <Show when={draftIdentity()} keyed>
          {(entry) => {
            const previous = focusSnapshots.get(entry.key) ?? { current: null }
            focusSnapshots.set(entry.key, previous)
            return <ComposerEditor
              id="lotus-message-input"
              value={value()}
              busy={submitting() || props.chat.submissionPending}
              label={text("messages_4da199fa")}
              title={text("enter_to_send_shift_enter_for_a_new_line_b6153e81")}
              placeholder={text("send_a_message_ae2f86f0")}
              mentionsEnabled={false}
              onChange={(content) => appStore.getState().setInputContent(entry.key, content)}
              onSubmit={() => { void send() }}
              onAddFiles={() => {}}
              onSuggestionChange={() => {}}
              focusSnapshot={previous}
              requestDraftCompletion={completion()}
            />
          }}
        </Show>
        <div data-composer-toolbar="" class="flex flex-wrap items-center justify-end gap-1">
          <Show when={props.chat.sending} fallback={
            <Button size="icon" class="rounded-full" type="button"
              aria-label={text("send_message_00881483")}
              disabled={!props.chat.booted || !value().trim() || submitting() || props.chat.submissionPending}
              onClick={() => { void send() }}>
              <ArrowUp />
            </Button>
          }>
            <Button size="icon" class="rounded-full" type="button"
              aria-label={text("stop_ca4d973c")} onClick={() => { void props.chat.stop() }}>
              <Square class="size-3.5" />
            </Button>
          </Show>
        </div>
      </div>
    </div>
  )
}
