import { useEffect, useReducer, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { DEFAULT_SUPERVISOR_SESSION_ID } from "@/lib/supervisor"
import { isApiError } from "@services/api/errors"
import { agentClient, type PermissionOnceDecision, type SupervisorApprovalCardData } from "@services/chat/AgentService"
import { useUiText } from "@shared/i18n/ui"
import { useAppStore } from "@shared/store/appStore"
import { useOpenRecordedSession } from "./ExternalLinkDialog"

type ApprovalSnapshot = { key: string; cards: SupervisorApprovalCardData[]; failed: boolean }

export function SupervisorApprovalCards({
  onRecorded,
}: {
  onRecorded: (decision: PermissionOnceDecision, continuationConfirmed: boolean) => void
}) {
  const t = useUiText()
  const pendingRevision = useAppStore((state) => JSON.stringify(state.chats
    .filter((chat) => chat.kind === "root" && chat.id !== DEFAULT_SUPERVISOR_SESSION_ID
      && state.executionBySession[chat.id]?.backend.hasPendingQuestion === true)
    .map((chat) => [chat.id, chat.createdAtExact, chat.updatedAt])))
  const [revision, refresh] = useReducer((previous: number) => previous + 1, 0)
  const [snapshot, setSnapshot] = useState<ApprovalSnapshot | null>(null)
  const key = JSON.stringify([pendingRevision, revision])

  useEffect(() => {
    const controller = new AbortController()
    void agentClient.listSupervisorApprovals(controller.signal).then((cards) => {
      if (!controller.signal.aborted) setSnapshot({ key, cards, failed: false })
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (isApiError(error) && error.status === 404) {
        setSnapshot({ key, cards: [], failed: false })
        return
      }
      setSnapshot((previous) => ({ key, cards: previous?.cards ?? [], failed: true }))
    })
    return () => controller.abort()
  }, [key])

  if (!snapshot || (!snapshot.cards.length && (!snapshot.failed || pendingRevision === "[]"))) return null
  const stale = snapshot.key !== key || snapshot.failed

  return (
    <section aria-label={t("supervisor_pending_approvals")}
      className="mx-4 mb-2 space-y-2 overflow-y-auto" style={{ maxHeight: "min(38dvh, 24rem)" }}>
      {snapshot.failed ? <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
        <span>{t("supervisor_approvals_unavailable")}</span>
        <Button type="button" variant="outline" size="sm" disabled={snapshot.key !== key} onClick={refresh}>
          {t("refresh_request_0ab317cc")}
        </Button>
      </div> : null}
      {snapshot.cards.map((card) => (
        <ApprovalCard key={JSON.stringify([card.sessionId, card.createdAt, card.request.request_id, card.request.request_generation])}
          card={card} readKey={snapshot.key} stale={stale} onRefresh={refresh} onRecorded={onRecorded} />
      ))}
    </section>
  )
}

function ApprovalCard({ card, readKey, stale, onRefresh, onRecorded }: {
  card: SupervisorApprovalCardData
  readKey: string
  stale: boolean
  onRefresh: () => void
  onRecorded: (decision: PermissionOnceDecision, continuationConfirmed: boolean) => void
}) {
  const t = useUiText()
  const openSession = useOpenRecordedSession()
  const inFlight = useRef(false)
  const [attempt, setAttempt] = useState<{ phase: "ready" | "submitting" | "recorded" }
    | { phase: "failed"; readKey: string }>({ phase: "ready" })
  const [openFailed, setOpenFailed] = useState(false)
  const phase = attempt.phase === "failed" && attempt.readKey !== readKey ? "ready" : attempt.phase
  const disabled = stale || phase !== "ready"

  async function decide(decision: PermissionOnceDecision) {
    const request = card.request
    if (disabled || inFlight.current || !request.allowed_decisions.includes(decision)) return
    inFlight.current = true
    setAttempt({ phase: "submitting" })
    try {
      const result = await agentClient.submitPermissionDecision(card.sessionId, {
        request_id: request.request_id, request_generation: request.request_generation,
        expected_policy_revision: request.policy_revision, decision,
      })
      setAttempt({ phase: "recorded" })
      onRecorded(decision, result.continuationConfirmed)
      onRefresh()
      void useAppStore.getState().refreshChatsNow().catch(() => {})
    } catch {
      setAttempt({ phase: "failed", readKey })
    } finally {
      inFlight.current = false
    }
  }

  return (
    <article aria-label={card.title} className="space-y-2 rounded-xl border bg-card p-3 text-card-foreground"
      onKeyDownCapture={(event) => {
        if (event.key === "Enter" && (event.repeat || event.nativeEvent.isComposing)) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">{t("action_approval_required_3bd71c54")}</h2>
        <button type="button" disabled={!openSession} className="max-w-full break-words text-sm underline underline-offset-2"
          onClick={() => {
            setOpenFailed(false)
            void openSession?.(card.sessionId, card.createdAt).then((opened) => setOpenFailed(!opened))
              .catch(() => setOpenFailed(true))
          }}>{card.title}</button>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-2 text-xs leading-relaxed">
        {card.operation}
      </pre>
      {card.workingDirectory ? (
        <p className="break-all text-xs text-muted-foreground">
          {t("working_directory_3db7b06b")} <span className="font-mono">{card.workingDirectory}</span>
        </p>
      ) : null}
      {card.supervisorHandoffAt ? (
        <p className="text-xs text-muted-foreground">
          {t("supervisor_approval_handoff_at", {
            time: new Date(card.supervisorHandoffAt).toLocaleTimeString(undefined, {
              hour: "numeric", minute: "2-digit",
            }),
          })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {phase === "submitting" ? <span role="status" className="text-xs">{t("submitting_26ef00b7")}</span> : null}
        {card.request.allowed_decisions.includes("deny_once") ? (
          <Button type="button" size="sm" variant="outline" disabled={disabled}
            onClick={() => void decide("deny_once")}>{t("deny_once_29b8bbf3")}</Button>
        ) : null}
        {card.request.allowed_decisions.includes("allow_once") ? (
          <Button type="button" size="sm" disabled={disabled}
            onClick={() => void decide("allow_once")}>{t("allow_once_390dd1fc")}</Button>
        ) : null}
      </div>
      {phase === "failed" ? <div role="alert" className="flex items-center gap-2 text-xs">
        <span>{t("supervisor_approval_refresh_before_retry")}</span>
        <Button type="button" variant="outline" size="sm" disabled={stale} onClick={onRefresh}>
          {t("refresh_request_0ab317cc")}
        </Button>
      </div> : null}
      {openFailed ? <p role="alert" className="text-xs text-destructive">{t("supervisor_sessions_open_failed")}</p> : null}
    </article>
  )
}
