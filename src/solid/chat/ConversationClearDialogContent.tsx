import { Show } from "solid-js"
import type { ConversationClearFailure } from "@services/chat/conversationClear"
import { appStore } from "@shared/store/appStore/state"
import { createUiText } from "../shell/uiText"
import { createStoreSelector } from "../state/createStoreSelector"
import { Button } from "../ui/button"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../ui/responsive-dialog"

const errors = {
  active_run: "conversation_clear_active_run",
  pending_approval: "conversation_clear_pending_approval",
  state_unavailable: "conversation_clear_state_unavailable",
  authority_conflict: "conversation_clear_authority_conflict",
  incompatible: "conversation_clear_incompatible",
  unsupported: "conversation_clear_unsupported",
  unknown: "conversation_clear_unknown",
  readback_failed: "conversation_clear_readback_failed",
} as const satisfies Record<ConversationClearFailure, string>

export function ConversationClearDialogContent(props: { sessionId: string; title: string; onClose: () => void }) {
  const text = createUiText()
  const state = createStoreSelector(appStore, (snapshot) => snapshot.conversationClears[props.sessionId])
  const uncertain = () => state()?.error === "unknown" || state()?.error === "readback_failed"
  const close = () => {
    const id = props.sessionId
    if (appStore.getState().conversationClears[id]?.busy) return
    appStore.getState().dismissConversationClear(id)
    props.onClose()
  }
  let inFlight = false
  const run = async (refresh: boolean) => {
    if (inFlight) return
    inFlight = true
    const store = appStore.getState()
    const id = props.sessionId
    try {
      const operation = refresh ? uncertain() ? store.verifyConversationClear : store.refreshConversationClear : store.clearConversation
      await operation(id)
    } catch {
      // The shared state retains typed failures and readback receipts.
    } finally { inFlight = false }
  }
  return (
    <ResponsiveDialog open onOpenChange={(open) => { if (!open) close() }}>
      <ResponsiveDialogContent dismissable={!state()?.busy} class="gap-3 overflow-y-auto p-4 sm:pb-4 sm:max-w-lg">
        <ResponsiveDialogTitle>{text("conversation_clear_title")}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription class="space-y-2 text-sm text-muted-foreground">
          <span class="block break-all font-medium text-foreground">{props.title} · {props.sessionId}</span>
          <span class="block">{text("conversation_clear_impact")}</span>
          <span class="block">{text("conversation_clear_limits")}</span>
        </ResponsiveDialogDescription>
        <Show when={state()?.confirmed}><p role="status" class="text-sm">{text("conversation_clear_confirmed")}</p></Show>
        <Show when={state()?.error}>{(error) => <p role="alert" class="text-sm text-destructive">{text(errors[error()])}</p>}</Show>
        <Show when={state()?.readbackConfirmed}><p role="status" class="text-sm">{text("conversation_clear_readback_only")}</p></Show>
        <Show when={state()?.refreshFailed}><p role="alert" class="text-sm text-destructive">{text("conversation_clear_refresh_failed")}</p></Show>
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={state()?.busy} onClick={close}>
            {text(state()?.confirmed || uncertain() ? "close_3fd47edc" : "cancel_2cd0f3be")}
          </Button>
          <Show when={state()?.error}>
            <Button variant="outline" size="sm" disabled={state()?.busy} onClick={() => { void run(true) }}>
              {text(state()?.busy ? "processing_d3d21191" : "conversation_clear_refresh")}
            </Button>
          </Show>
          <Show when={!uncertain() && !state()?.confirmed}>
            <Button variant="destructive" size="sm" disabled={state()?.busy} onClick={() => { void run(false) }}>
              {text(state()?.busy ? "processing_d3d21191" : "conversation_clear_action")}
            </Button>
          </Show>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
