import type { Message } from "@shared/types/chat"
import { projectCompletedAnswers, type CompletedAnswerHandoff } from "./completedAnswerHandoff"

// Pending final bodies live only in this frontend process. Bound both their
// number and lifetime: expiry/eviction may hide an unconfirmed body until
// canonical history arrives; neither event means the body was persisted.
export const COMPLETED_ANSWER_MAX_AGE_MS = 30 * 60 * 1000
export const COMPLETED_ANSWER_MAX_ENTRIES = 128

type Lease = { sessionId: string; valid: boolean; confirmed: boolean; handoffId?: string; runId?: string;
  handoff?: CompletedAnswerHandoff; excludedCanonicalIds: Set<string> }
type RecordEntry = { handoff: CompletedAnswerHandoff; expiresAt: number }
const listeners = new Set<() => void>()
const leases = new Map<string, Set<Lease>>()
let nextId = 0
let records: readonly RecordEntry[] = []
let snapshot: readonly CompletedAnswerHandoff[] = []
let expiry: ReturnType<typeof setTimeout> | undefined

export const newCompletedAnswerHandoffId = () => `local-${++nextId}`
export const getCompletedAnswerHandoffs = () => snapshot
export const subscribeCompletedAnswerHandoffs = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function publish(next: readonly RecordEntry[], force = false) {
  if (!force && next.length === records.length && next.every((entry, index) => entry === records[index])) return
  records = next
  snapshot = records.map(({ handoff }) => handoff)
  if (expiry !== undefined) clearTimeout(expiry)
  expiry = undefined
  if (records.length) {
    const firstExpiry = Math.min(...records.map((entry) => entry.expiresAt))
    expiry = setTimeout(() => publish(records.filter((entry) => entry.expiresAt > Date.now())), Math.max(0, firstExpiry - Date.now()))
  }
  for (const listener of listeners) listener()
}

export function acquireCompletedAnswerLease(sessionId: string): Lease {
  const lease: Lease = { sessionId, valid: true, confirmed: false, excludedCanonicalIds: new Set() }
  const active = leases.get(sessionId) ?? new Set<Lease>()
  active.add(lease)
  leases.set(sessionId, active)
  return lease
}

export function releaseCompletedAnswerLease(lease: Lease) {
  lease.valid = false
  const active = leases.get(lease.sessionId)
  active?.delete(lease)
  if (!active?.size) leases.delete(lease.sessionId)
}

export const isSameKnownCompletedRun = (left: CompletedAnswerHandoff, right: CompletedAnswerHandoff) =>
  !!left.runId && left.runId === right.runId && left.sessionId === right.sessionId && left.text === right.text
    && (left.acknowledgedMessageId === right.acknowledgedMessageId
      || left.acknowledgedMessageId === null || right.acknowledgedMessageId === null)

/** Handoff identity never relies on a hook-local operation ID or text alone. */
export function retainCompletedAnswer(lease: Lease, handoff: CompletedAnswerHandoff): string | undefined {
  if (!lease.valid || lease.sessionId !== handoff.sessionId || !handoff.handoffId || !handoff.text.trim()) return
  // An expired or evicted entry cannot be silently reinserted on unmount.
  if (lease.handoffId) return lease.handoffId
  const current = records.filter((record) => record.expiresAt > Date.now())
  const duplicate = current.findIndex(({ handoff: prior }) => prior.handoffId === handoff.handoffId || isSameKnownCompletedRun(prior, handoff))
  const id = duplicate < 0 ? handoff.handoffId : current[duplicate].handoff.handoffId!
  lease.handoffId = id
  lease.handoff = { ...handoff, handoffId: id }
  if (duplicate < 0) publish([...current, { handoff: lease.handoff, expiresAt: Date.now() + COMPLETED_ANSWER_MAX_AGE_MS }].slice(-COMPLETED_ANSWER_MAX_ENTRIES))
  else if (current[duplicate].handoff.acknowledgedMessageId === null && handoff.acknowledgedMessageId !== null) {
    const prior = current[duplicate]
    current[duplicate] = { ...prior, handoff: lease.handoff }
    publish(current)
  } else publish(current)
  return id
}

export function reconcileCompletedAnswers(sessionId: string, canonical: Message[]) {
  const selected = records.filter((record) => record.handoff.sessionId === sessionId)
  if (!selected.length) return
  const confirmed: Array<{ handoffId: string; messageId: string }> = []
  const projected = projectCompletedAnswers(canonical, selected.map((record) => record.handoff), (handoff, messageId) => {
    if (handoff.handoffId) confirmed.push({ handoffId: handoff.handoffId, messageId })
  })
  const remaining = new Map(projected.remaining.map((handoff) => [handoff.handoffId, handoff]))
  for (const lease of leases.get(sessionId) ?? []) {
    for (const item of confirmed) {
      if (lease.handoffId === item.handoffId) lease.confirmed = true
      else lease.excludedCanonicalIds.add(item.messageId)
    }
  }
  publish(records.flatMap((record) => {
    if (record.handoff.sessionId !== sessionId) return [record]
    const pending = remaining.get(record.handoff.handoffId)
    if (!pending) return []
    const excluded = new Set(pending.excludedCanonicalIds)
    for (const item of confirmed) excluded.add(item.messageId)
    const updated = confirmed.length ? { ...pending, excludedCanonicalIds: excluded } : pending
    return [updated === record.handoff ? record : { ...record, handoff: updated }]
  }))
}

// Discard only the targeted turn and later turns when their ordering is known.
// Unknown identities are dropped after an explicit destructive operation,
// rather than risking resurrection of content the user removed.
function affectedByTruncate(handoff: CompletedAnswerHandoff, messages: Message[], targetId: string | null) {
  const target = targetId === null ? -1 : messages.findIndex((message) => message.id === targetId)
  const anchor = handoff.acknowledgedMessageId === null ? -1 : messages.findIndex((message) =>
    message.role === "user" && message.id === handoff.acknowledgedMessageId)
  if (target < 0 || anchor < 0) return true
  const nextUser = messages.findIndex((message, index) => index > anchor && message.role === "user")
  return nextUser < 0 || nextUser > target
}

/** Fence in-flight older callbacks when a clear or truncate is confirmed. */
export function invalidateCompletedAnswers(sessionId: string, truncate?: { messages: Message[]; targetId: string | null }) {
  const affected = (handoff: CompletedAnswerHandoff) => truncate === undefined || affectedByTruncate(handoff, truncate.messages, truncate.targetId)
  for (const lease of leases.get(sessionId) ?? []) {
    if (!lease.handoff || affected(lease.handoff)) lease.valid = false
  }
  const active = leases.get(sessionId)
  if (active) {
    for (const lease of active) if (!lease.valid) active.delete(lease)
    if (!active.size) leases.delete(sessionId)
  }
  publish(records.filter(({ handoff }) => handoff.sessionId !== sessionId || !affected(handoff)), true)
}

/** A confirmed single-message deletion may invalidate its known user turn. */
export function invalidateCompletedAnswerForDeletedMessage(sessionId: string, messageId: string) {
  const affected = (handoff: CompletedAnswerHandoff) => handoff.acknowledgedMessageId === null
    || handoff.acknowledgedMessageId === messageId || handoff.baselineMessageId === messageId
  for (const lease of leases.get(sessionId) ?? []) {
    if (!lease.handoff || affected(lease.handoff)) lease.valid = false
  }
  const active = leases.get(sessionId)
  if (active) {
    for (const lease of active) if (!lease.valid) active.delete(lease)
    if (!active.size) leases.delete(sessionId)
  }
  publish(records.filter(({ handoff }) => handoff.sessionId !== sessionId || !affected(handoff)), true)
}

/** Only for isolated test fixtures. */
export function resetCompletedAnswerHandoffsForTest() {
  for (const active of leases.values()) for (const lease of active) lease.valid = false
  leases.clear()
  publish([], true)
}
