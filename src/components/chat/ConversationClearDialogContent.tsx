import { useRef } from "react"
import { useUiText } from "@shared/i18n/ui"
import { useAppStore } from "@shared/store/appStore"
import type { ConversationClearFailure } from "@services/chat/conversationClear"
import { Button } from "@/components/ui/button"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog"

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

/** Shared by ordinary chats, Supervisor and simple-mode settings. */
export function ConversationClearDialogContent({ sessionId, title, onClose }: {
  sessionId: string
  title: string
  onClose: () => void
}) {
  const t = useUiText()
  const state = useAppStore((s) => s.conversationClears[sessionId])
  const action = useRef(false)
  const uncertain = state?.error === "unknown" || state?.error === "readback_failed"
  const close = () => {
    if (useAppStore.getState().conversationClears[sessionId]?.busy) return
    useAppStore.getState().dismissConversationClear(sessionId)
    onClose()
  }
  const run = async (verify: boolean) => {
    if (action.current) return
    action.current = true
    try {
      const store = useAppStore.getState()
      await (verify ? uncertain ? store.verifyConversationClear(sessionId) : store.refreshConversationClear(sessionId) : store.clearConversation(sessionId))
    } catch {
      // The shared store retains typed failures across entry/dialog reopen.
    } finally { action.current = false }
  }
  return <ResponsiveDialog open onOpenChange={(open) => { if (!open) close() }}>
    <ResponsiveDialogContent showCloseButton={!state?.busy} dismissable={!state?.busy} className="gap-3 overflow-y-auto p-4 sm:pb-4 sm:max-w-lg">
      <ResponsiveDialogTitle>{t("conversation_clear_title")}</ResponsiveDialogTitle>
      <ResponsiveDialogDescription asChild>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p className="break-all font-medium text-foreground">{title} · {sessionId}</p>
          <p>{t("conversation_clear_impact")}</p>
          <p>{t("conversation_clear_limits")}</p>
        </div>
      </ResponsiveDialogDescription>
      {state?.confirmed ? <p role="status" className="text-sm">{t("conversation_clear_confirmed")}</p> : null}
      {state?.error ? <p role="alert" className="text-sm text-destructive">{t(errors[state.error])}</p> : null}
      {state?.readbackConfirmed ? <p role="status" className="text-sm">{t("conversation_clear_readback_only")}</p> : null}
      {state?.refreshFailed ? <p role="alert" className="text-sm text-destructive">{t("conversation_clear_refresh_failed")}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="sm" disabled={state?.busy} onClick={close}>
          {state?.confirmed || uncertain ? t("close_3fd47edc") : t("cancel_2cd0f3be")}
        </Button>
        {state?.error ? <Button variant="outline" size="sm" disabled={state?.busy} onClick={() => void run(true)}>
          {state?.busy ? t("processing_d3d21191") : t("conversation_clear_refresh")}
        </Button> : null}
        {!uncertain && !state?.confirmed ? <Button variant="destructive" size="sm" disabled={state?.busy} onClick={() => void run(false)}>
          {state?.busy ? t("processing_d3d21191") : t("conversation_clear_action")}
        </Button> : null}
      </div>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}
