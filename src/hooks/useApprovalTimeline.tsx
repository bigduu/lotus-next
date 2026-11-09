import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import type { TimelineAttachment } from "@/components/app/MessageList"
import { ApprovalReceipt, type QuestionControls } from "@/components/chat/PermissionTimeline"
import { QuestionDialog } from "@/components/chat/Dialogs"
import { SupervisorApprovalCard, type ApprovalReceipt as SupervisorReceipt, type OpenRecordedSession } from "@/components/chat/SupervisorApprovalCards"
import { Button } from "@/components/ui/button"
import type { PendingQuestion, RecordedPermission } from "@/hooks/useChat"
import { DEFAULT_SUPERVISOR_SESSION_ID } from "@/lib/supervisor"
import { isApiError } from "@services/api/errors"
import { agentClient, type PermissionDecisionChoice, type SupervisorApprovalCardData } from "@services/chat/AgentService"
import { permissionDecisionFor, permissionOperation } from "@services/chat/permissionDecision"
import { useUiText } from "@shared/i18n/ui"
import { useAppStore } from "@shared/store/appStore"
import type { Message } from "@shared/types/chatMessages"

type PermissionQuestion = Extract<PendingQuestion, { interaction_kind: "permission" }>

function permissionEntryKey(requestId: string, generation: string) {
  return JSON.stringify(["permission", requestId, generation])
}

export function usePermissionTimeline(messages: Message[], pending: PermissionQuestion | null,
  recorded: RecordedPermission | undefined, workspace: string | null | undefined, controls: QuestionControls) {
  const history = useMemo(() => messages.flatMap((message) =>
    message.role === "assistant" && message.type === "tool_result" && message.permissionHistory
      ? [{ anchor: message.id, record: message.permissionHistory }] : []), [messages])
  const entries = new Map<string, TimelineAttachment>()
  const anchors = new Map<string, string>()
  for (const { anchor, record } of history) {
    const key = permissionEntryKey(record.requestId, record.generation)
    anchors.set(key, anchor)
    if (record.decision) entries.set(key, { key, afterMessageId: anchor,
      node: <ApprovalReceipt operation={record.operation} workingDirectory={record.workingDirectory} decision={record.decision} /> })
  }
  if (recorded) {
    const { request_id, request_generation } = recorded.question.permission_request
    const key = permissionEntryKey(request_id, request_generation)
    entries.set(key, { key, afterMessageId: anchors.get(key),
      node: <ApprovalReceipt {...permissionOperation(recorded.question.permission_request, recorded.question.tool_arguments, workspace)}
        decision={recorded.decision} continued={recorded.continued} /> })
  }
  if (pending) {
    const { request_id, request_generation } = pending.permission_request
    const key = permissionEntryKey(request_id, request_generation)
    if (!entries.has(key)) entries.set(key, { key, afterMessageId: anchors.get(key),
      node: <QuestionDialog q={pending} workspace={workspace} {...controls} /> })
  }
  return [...entries.values()]
}

type ObservedApproval = { key: string; order: number; card: SupervisorApprovalCardData; afterMessageId: string | null }
type ApprovalSnapshot = { key: string; cards: ObservedApproval[]; failed: boolean }
type ApprovalAttempt = { phase: "submitting" | "failed"; readKey: string }

function approvalKey(card: SupervisorApprovalCardData) {
  return JSON.stringify([card.sessionId, card.createdAt, card.request.request_id, card.request.request_generation])
}

export function useSupervisorApprovalTimeline(active: boolean, anchor: string | null,
  onOpenSession?: OpenRecordedSession): TimelineAttachment[] {
  const t = useUiText()
  const pendingRevision = useAppStore((state) => active ? JSON.stringify(state.chats
    .filter((chat) => chat.kind === "root" && chat.id !== DEFAULT_SUPERVISOR_SESSION_ID
      && state.executionBySession[chat.id]?.backend.hasPendingQuestion === true)
    .map((chat) => [chat.id, chat.createdAtExact, chat.updatedAt])) : "[]")
  const [activation, setActivation] = useState({ active, epoch: 0 })
  if (activation.active !== active) setActivation({ active, epoch: activation.epoch + 1 })
  const [revision, refresh] = useReducer((previous: number) => previous + 1, 0)
  const [snapshot, setSnapshot] = useState<ApprovalSnapshot | null>(null)
  const [recorded, setRecorded] = useState<(ObservedApproval & SupervisorReceipt)[]>([])
  const [attempts, setAttempts] = useState<Record<string, ApprovalAttempt>>({})
  // Virtualized cards can unmount during a submit. Keep the fence with the pane.
  const inFlight = useRef(new Set<string>())
  const nextOrder = useRef(0)
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor
  const readKey = JSON.stringify([activation.epoch, pendingRevision, revision])

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    void agentClient.listSupervisorApprovals(controller.signal).then((cards) => {
      if (controller.signal.aborted) return
      const currentAnchor = anchorRef.current
      const firstOrder = nextOrder.current
      nextOrder.current += cards.length
      setSnapshot((previous) => ({
        key: readKey, failed: false,
        cards: cards.map((card, index) => {
          const key = approvalKey(card)
          const existing = previous?.cards.find((observed) => observed.key === key)
          return { key, card, order: existing?.order ?? firstOrder + index,
            afterMessageId: existing ? existing.afterMessageId : currentAnchor }
        }),
      }))
      const keys = new Set(cards.map(approvalKey))
      setAttempts((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => keys.has(key))))
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (isApiError(error) && error.status === 404) {
        setSnapshot({ key: readKey, cards: [], failed: false })
        return
      }
      setSnapshot((previous) => ({ key: readKey, cards: previous?.cards ?? [], failed: true }))
    })
    return () => controller.abort()
  }, [active, readKey])

  useEffect(() => {
    if (!active || !anchor) return
    // The pending read can win the race with history hydration. Anchor those
    // cards once the transcript arrives, then retain their original position.
    setSnapshot((previous) => previous?.cards.some((entry) => !entry.afterMessageId)
      ? { ...previous, cards: previous.cards.map((entry) => entry.afterMessageId ? entry : { ...entry, afterMessageId: anchor }) }
      : previous)
  }, [active, anchor])

  if (!active) return []
  const entries: (TimelineAttachment & { order: number })[] = recorded.map((entry) => ({
    key: entry.key, order: entry.order, afterMessageId: entry.afterMessageId,
    node: <SupervisorApprovalCard card={entry.card} stale={false} receipt={entry}
      onOpenSession={onOpenSession} onRefresh={refresh} />,
  }))
  const decide = async (observed: ObservedApproval, choice: PermissionDecisionChoice) => {
    const { card, key } = observed
    const decision = permissionDecisionFor(card.request, choice)
    if (!decision || !snapshot || snapshot.failed || snapshot.key !== readKey
        || inFlight.current.has(key) || attempts[key]?.readKey === readKey) return
    inFlight.current.add(key)
    setAttempts((previous) => ({ ...previous, [key]: { phase: "submitting", readKey } }))
    try {
      const result = await agentClient.submitPermissionDecision(card.sessionId, decision)
      setRecorded((previous) => [...previous.filter((entry) => entry.key !== key),
        { ...observed, decision: choice, continued: result.continuationConfirmed && !!result.autoResumeStatus }].slice(-8))
      refresh()
      void useAppStore.getState().refreshChatsNow().catch(() => {})
    } catch {
      setAttempts((previous) => ({ ...previous, [key]: { phase: "failed", readKey } }))
    } finally {
      inFlight.current.delete(key)
    }
  }
  if (snapshot) {
    const stale = snapshot.key !== readKey || snapshot.failed
    for (const observed of snapshot.cards) {
      if (recorded.some((entry) => entry.key === observed.key)) continue
      entries.push({
        key: observed.key, order: observed.order, afterMessageId: observed.afterMessageId,
        node: <SupervisorApprovalCard card={observed.card} stale={stale}
          submitting={inFlight.current.has(observed.key)}
          failed={attempts[observed.key]?.phase === "failed" && attempts[observed.key]?.readKey === snapshot.key}
          onOpenSession={onOpenSession} onRefresh={refresh} onDecide={(choice) => void decide(observed, choice)} />,
      })
    }
    if (snapshot.failed && (snapshot.cards.length || pendingRevision !== "[]")) {
      entries.push({
        key: "supervisor-approvals-error",
        order: Number.MAX_SAFE_INTEGER,
        node: <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
          <span>{t("supervisor_approvals_unavailable")}</span>
          <Button type="button" variant="outline" size="sm" disabled={snapshot.key !== readKey} onClick={refresh}>
            {t("refresh_request_0ab317cc")}
          </Button>
        </div>,
      })
    }
  }
  return entries.sort((left, right) => left.order - right.order)
}
