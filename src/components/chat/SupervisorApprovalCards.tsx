import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { PermissionDecisionChoice, SupervisorApprovalCardData } from "@services/chat/AgentService"
import { useUiText } from "@shared/i18n/ui"
import { ApprovalPresentation } from "./ApprovalPresentation"
import { ApprovalOperation } from "./PermissionTimeline"
import { permissionActions, permissionReceiptText } from "./permissionPresentation"

export type OpenRecordedSession = (id: string, expectedCreatedAt: string) => Promise<boolean>
export type ApprovalReceipt = { decision: PermissionDecisionChoice; continued: boolean }

export function SupervisorApprovalCard({ card, stale, submitting, failed, receipt, onRefresh, onOpenSession, onDecide }: {
  card: SupervisorApprovalCardData
  stale: boolean
  submitting?: boolean
  failed?: boolean
  receipt?: ApprovalReceipt
  onRefresh: () => void
  onOpenSession?: OpenRecordedSession
  onDecide?: (choice: PermissionDecisionChoice) => void
}) {
  const t = useUiText()
  const [openFailed, setOpenFailed] = useState(false)
  const disabled = stale || submitting || failed

  return <ApprovalPresentation label={card.title} title={t("permission_from_managed_session")}
    source={<button type="button" disabled={!onOpenSession} className="max-w-full break-words text-sm underline underline-offset-2"
      onClick={() => {
        setOpenFailed(false)
        void onOpenSession?.(card.sessionId, card.createdAt).then((opened) => setOpenFailed(!opened))
          .catch(() => setOpenFailed(true))
      }}>{card.title}</button>}
    actions={onDecide ? permissionActions(card.request, onDecide) : []} disabled={disabled}
    footer={<>
      {submitting ? <p role="status" className="text-xs">{t("submitting_26ef00b7")}</p> : null}
      {failed ? <div role="alert" className="flex flex-wrap items-center gap-2 text-xs">
        <span>{t("supervisor_approval_refresh_before_retry")}</span>
        <Button type="button" variant="outline" size="sm" disabled={stale} onClick={onRefresh}>
          {t("refresh_request_0ab317cc")}
        </Button>
      </div> : null}
      {openFailed ? <p role="alert" className="text-xs text-destructive">{t("supervisor_sessions_open_failed")}</p> : null}
    </>}>
    <ApprovalOperation operation={card.operation} workingDirectory={card.workingDirectory} />
    {receipt ? <p role="status" className="text-xs text-muted-foreground">
      {permissionReceiptText(receipt.decision, receipt.continued)}
    </p> : card.supervisorHandoffAt ? <p className="text-xs text-muted-foreground">
      {t("supervisor_approval_handoff_at", { time: new Date(card.supervisorHandoffAt).toLocaleTimeString(undefined, {
        hour: "numeric", minute: "2-digit",
      }) })}
    </p> : null}
  </ApprovalPresentation>
}
