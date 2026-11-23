import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import { DEFAULT_SUPERVISOR_SESSION_ID } from "@/lib/supervisor"
import { isApiError } from "@services/api/errors"
import { agentClient, type PermissionDecisionChoice, type SupervisorApprovalCardData } from "@services/chat/AgentService"
import { permissionDecisionFor } from "@services/chat/permissionDecision"
import { appStore } from "@shared/store/appStore/state"

import { createStoreSelector } from "../../state/createStoreSelector"

export type ApprovalReceipt = { decision: PermissionDecisionChoice; continued: boolean }

type ObservedApproval = { key: string; order: number; card: SupervisorApprovalCardData; afterMessageId: string | null }
type Snapshot = { request: object; cards: ObservedApproval[]; failed: boolean }
type Attempt = { phase: "submitting" | "failed" | "confirmed"; request: object }
type RecordedApproval = ObservedApproval & ApprovalReceipt
export type SupervisorApprovalEntry =
  | (ObservedApproval & { kind: "card"; stale: boolean; submitting: boolean; failed: boolean; receipt?: ApprovalReceipt })
  | { kind: "read-error"; key: string; order: number; afterMessageId: null; stale: boolean }

function identity(card: SupervisorApprovalCardData) {
  return JSON.stringify([card.sessionId, card.createdAt, card.request.request_id, card.request.request_generation])
}

function unique(cards: readonly SupervisorApprovalCardData[]) {
  const entries = new Map<string, SupervisorApprovalCardData>()
  for (const card of cards) {
    const key = identity(card)
    const previous = entries.get(key)
    if (previous && JSON.stringify(previous) !== JSON.stringify(card)) {
      throw new Error("Conflicting observations for the same approval")
    }
    entries.set(key, card)
  }
  return entries
}

/** A single owner-scoped inbox, retained with the chat pane across session switches. */
export function createSupervisorApprovals(options: { active: Accessor<boolean>; anchor: Accessor<string | null> }) {
  const pendingRevision = createStoreSelector(appStore, (state) => options.active() ? JSON.stringify(state.chats
    .filter((chat) => chat.kind === "root" && chat.id !== DEFAULT_SUPERVISOR_SESSION_ID
      && state.executionBySession[chat.id]?.backend.hasPendingQuestion === true)
    .map((chat) => [chat.id, chat.createdAtExact, chat.updatedAt]).sort(([left], [right]) => String(left).localeCompare(String(right)))) : "[]")
  const [revision, setRevision] = createSignal(0)
  const [snapshot, setSnapshot] = createSignal<Snapshot | null>(null)
  const [recorded, setRecorded] = createSignal<RecordedApproval[]>([])
  const [attempts, setAttempts] = createSignal<ReadonlyMap<string, Attempt>>(new Map())
  const inFlight = new Set<string>()
  let nextOrder = 0
  let alive = true
  onCleanup(() => { alive = false })
  const request = createMemo(() => ({ active: options.active(), pending: pendingRevision(), revision: revision() }), {
    equals: (previous, next) => previous.active === next.active && previous.pending === next.pending && previous.revision === next.revision,
  })
  const refresh = () => { if (alive && options.active()) setRevision((previous) => previous + 1) }

  createEffect(request, (scope) => {
    if (!scope.active) return
    const abort = new AbortController()
    const current = () => alive && !abort.signal.aborted && request() === scope && options.active()
    void agentClient.listSupervisorApprovals(abort.signal).then((cards) => {
      if (!current()) return
      const approvals = unique(cards)
      const anchor = options.anchor()
      setSnapshot((previous) => {
        const existing = new Map(previous?.cards.map((entry) => [entry.key, entry]))
        return { request: scope, failed: false, cards: [...approvals].map(([key, card]) => {
          const old = existing.get(key)
          return { key, card, order: old?.order ?? nextOrder++, afterMessageId: old ? old.afterMessageId : anchor }
        }) }
      })
      setAttempts((previous) => new Map([...previous].filter(([key]) => approvals.has(key) || inFlight.has(key))))
    }).catch((error) => {
      if (!current()) return
      if (isApiError(error) && error.status === 404) {
        setSnapshot({ request: scope, cards: [], failed: false })
      } else {
        setSnapshot((previous) => ({ request: scope, cards: previous?.cards ?? [], failed: true }))
      }
    })
    return () => abort.abort()
  })

  createEffect(() => options.active() ? options.anchor() : null, (anchor) => {
    if (!anchor) return
    const attach = <T extends ObservedApproval>(entry: T): T => entry.afterMessageId ? entry : { ...entry, afterMessageId: anchor }
    setSnapshot((previous) => previous?.cards.some((entry) => !entry.afterMessageId) ? { ...previous, cards: previous.cards.map(attach) } : previous)
    setRecorded((previous) => previous.some((entry) => !entry.afterMessageId) ? previous.map(attach) : previous)
  })

  const setAttempt = (key: string, value: Attempt) => setAttempts((previous) => new Map(previous).set(key, value))
  const decide = async (entry: SupervisorApprovalEntry, choice: PermissionDecisionChoice) => {
    if (entry.kind !== "card" || entry.receipt || !alive || !options.active()) return
    const read = snapshot(), scope = request()
    const exact = read?.cards.find((candidate) => candidate.key === entry.key && candidate.card === entry.card)
    if (!exact || !read || read.failed || read.request !== scope || inFlight.has(entry.key)
      || recorded().some((receipt) => receipt.key === entry.key) || attempts().get(entry.key)?.phase === "confirmed"
      || attempts().get(entry.key)?.request === scope) return
    const decision = permissionDecisionFor(exact.card.request, choice)
    if (!decision) return
    inFlight.add(entry.key)
    setAttempt(entry.key, { phase: "submitting", request: scope })
    try {
      const result = await agentClient.submitPermissionDecision(exact.card.sessionId, decision)
      if (!alive) return
      setAttempt(entry.key, { phase: "confirmed", request: scope })
      setRecorded((previous) => [...previous.filter((receipt) => receipt.key !== exact.key), {
        ...exact, afterMessageId: exact.afterMessageId ?? (options.active() ? options.anchor() : null),
        decision: choice, continued: result.continuationConfirmed && Boolean(result.autoResumeStatus),
      }].slice(-8))
      refresh()
      void appStore.getState().refreshChatsNow().catch(() => {})
    } catch {
      if (alive) setAttempt(entry.key, { phase: "failed", request: scope })
    } finally {
      inFlight.delete(entry.key)
      if (alive) setAttempts((previous) => {
        const pending = previous.get(entry.key)
        if (pending?.phase !== "submitting") return previous
        const next = new Map(previous)
        next.delete(entry.key)
        return next
      })
    }
  }

  const entries = createMemo<SupervisorApprovalEntry[]>(() => {
    if (!options.active()) return []
    const read = snapshot(), scope = request(), prior = recorded(), attemptsById = attempts()
    const entries: SupervisorApprovalEntry[] = prior.map((receipt) => ({
      ...receipt, kind: "card", stale: false, submitting: false, failed: false, receipt,
    }))
    if (read) {
      const stale = read.request !== scope || read.failed
      for (const card of read.cards) {
        if (prior.some((receipt) => receipt.key === card.key)) continue
        const attempt = attemptsById.get(card.key)
        entries.push({ ...card, kind: "card", stale, submitting: attempt?.phase === "submitting",
          failed: attempt?.phase === "failed" && attempt.request === read.request })
      }
      if (read.failed && (read.cards.length > 0 || scope.pending !== "[]")) {
        entries.push({ kind: "read-error", key: "supervisor-approvals-error", order: Number.MAX_SAFE_INTEGER,
          afterMessageId: null, stale: read.request !== scope })
      }
    }
    return entries.sort((left, right) => left.order - right.order)
  })
  return { entries, refresh, decide }
}
