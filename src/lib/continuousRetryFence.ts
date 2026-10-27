import { isRetryRunId } from "@services/chat/upstreamRetry"

type PendingRecord = { version: 1; operationId: string; state: "pending" }
type ConfirmedRecord = { version: 1; operationId: string; state: "confirmed"; runId: string }
type RecordValue = PendingRecord | ConfirmedRecord
type TabFence =
  | { kind: "clear"; raw: null }
  | { kind: "pending"; raw: string }
  | { kind: "ambiguous" | "unavailable" }
  | { kind: "confirmed"; raw: string; runId: string }
type SharedGuard = "clear" | "guarded" | "ambiguous" | "unavailable"
export type RetryFence =
  | { kind: "clear" | "pending" | "ambiguous" | "unavailable" }
  | { kind: "confirmed"; runId: string }
export type RetryFenceReservation = { tabKey: string; pendingRaw: string; priorTabRaw: string | null; operationId: string }
export type OrdinaryRetryFenceSnapshot = { tabKey: string; tabRaw: string | null }

const operationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const scopeKey = (backend: string, sessionId: string) => encodeURIComponent(JSON.stringify([backend, sessionId]))
const guardKeyFor = (backend: string, sessionId: string) => `lotus-next.continuous-retry.guard.v1.${scopeKey(backend, sessionId)}`
const tabKeyFor = (backend: string, sessionId: string) => `lotus-next.continuous-retry.tab.v1.${scopeKey(backend, sessionId)}`
const guardValue = '{"version":1,"requiresExactStop":true}'

function parseRecord(raw: string): RecordValue | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    const value = parsed as { version?: unknown; operationId?: unknown; state?: unknown; runId?: unknown }
    if (value.version !== 1 || typeof value.operationId !== "string" || !operationPattern.test(value.operationId)) return null
    if (value.state === "pending") return { version: 1, operationId: value.operationId, state: "pending" }
    if (value.state === "confirmed" && isRetryRunId(value.runId))
      return { version: 1, operationId: value.operationId, state: "confirmed", runId: value.runId }
    return null
  } catch { return null }
}

function readTabFence(backend: string, sessionId: string): TabFence {
  try {
    const raw = sessionStorage.getItem(tabKeyFor(backend, sessionId))
    if (raw === null) return { kind: "clear", raw: null }
    const value = parseRecord(raw)
    if (!value) return { kind: "ambiguous" }
    return value.state === "pending" ? { kind: "pending", raw } : { kind: "confirmed", raw, runId: value.runId }
  } catch { return { kind: "unavailable" } }
}

function readSharedGuard(backend: string, sessionId: string): SharedGuard {
  try {
    const raw = localStorage.getItem(guardKeyFor(backend, sessionId))
    return raw === null ? "clear" : raw === guardValue ? "guarded" : "ambiguous"
  } catch { return "unavailable" }
}

/** A shared guard prevents another tab from guessing which run it may stop. */
export function readContinuousRetryFence(backend: string, sessionId: string): RetryFence {
  const tab = readTabFence(backend, sessionId)
  if (tab.kind === "confirmed") return { kind: "confirmed", runId: tab.runId }
  if (tab.kind === "pending" || tab.kind === "ambiguous") return { kind: tab.kind }
  const guard = readSharedGuard(backend, sessionId)
  if (guard === "clear") return { kind: "clear" }
  if (guard === "ambiguous" || guard === "unavailable") return { kind: guard }
  return { kind: tab.kind === "unavailable" ? "unavailable" : "ambiguous" }
}

/** Persist the shared guard and this tab's pending receipt before Execute. */
export function beginContinuousRetryFence(backend: string, sessionId: string): RetryFenceReservation | null {
  const tab = readTabFence(backend, sessionId), guard = readSharedGuard(backend, sessionId)
  if ((tab.kind !== "clear" && tab.kind !== "confirmed") || (guard !== "clear" && guard !== "guarded")) return null
  let reservation: RetryFenceReservation | null = null
  try {
    const operationId = crypto.randomUUID(), tabKey = tabKeyFor(backend, sessionId), guardKey = guardKeyFor(backend, sessionId)
    const pendingRaw = JSON.stringify({ version: 1, operationId, state: "pending" } satisfies PendingRecord)
    reservation = { tabKey, pendingRaw, priorTabRaw: tab.raw, operationId }
    if (sessionStorage.getItem(tabKey) !== tab.raw) return null
    if (guard === "clear") localStorage.setItem(guardKey, guardValue)
    if (localStorage.getItem(guardKey) !== guardValue) return null
    sessionStorage.setItem(tabKey, pendingRaw)
    if (sessionStorage.getItem(tabKey) === pendingRaw) return reservation
    discardUnsentContinuousRetryFence(reservation)
    return null
  } catch {
    if (reservation) discardUnsentContinuousRetryFence(reservation)
    return null
  }
}

/** Restore only this tab's definitely unsent operation; retain the shared guard. */
export function discardUnsentContinuousRetryFence(reservation: RetryFenceReservation): boolean {
  try {
    if (sessionStorage.getItem(reservation.tabKey) !== reservation.pendingRaw) return false
    if (reservation.priorTabRaw === null) sessionStorage.removeItem(reservation.tabKey)
    else sessionStorage.setItem(reservation.tabKey, reservation.priorTabRaw)
    return sessionStorage.getItem(reservation.tabKey) === reservation.priorTabRaw
  } catch { return false }
}

/** A malformed or late ACK cannot confirm a newer tab operation. */
export function confirmContinuousRetryFence(reservation: RetryFenceReservation, runId: unknown): boolean {
  if (!isRetryRunId(runId)) return false
  const raw = JSON.stringify({ version: 1, operationId: reservation.operationId, state: "confirmed", runId } satisfies ConfirmedRecord)
  try {
    if (sessionStorage.getItem(reservation.tabKey) !== reservation.pendingRaw) return false
    sessionStorage.setItem(reservation.tabKey, raw)
    return sessionStorage.getItem(reservation.tabKey) === raw
  } catch { return false }
}

/** Capture this tab before an ordinary Execute, without changing its receipt. */
export function captureOrdinaryRetryFence(backend: string, sessionId: string): OrdinaryRetryFenceSnapshot | null {
  const tab = readTabFence(backend, sessionId)
  if (tab.kind === "confirmed" || tab.kind === "pending") return { tabKey: tabKeyFor(backend, sessionId), tabRaw: tab.raw }
  if (tab.kind !== "clear" || readSharedGuard(backend, sessionId) !== "guarded") return null
  return { tabKey: tabKeyFor(backend, sessionId), tabRaw: null }
}

/** A newly acknowledged ordinary run only replaces the unchanged tab receipt. */
export function advanceOrdinaryRetryFence(snapshot: OrdinaryRetryFenceSnapshot, runId: unknown): boolean {
  if (!isRetryRunId(runId)) return false
  try {
    if (sessionStorage.getItem(snapshot.tabKey) !== snapshot.tabRaw) return false
    const raw = JSON.stringify({ version: 1, operationId: crypto.randomUUID(), state: "confirmed", runId } satisfies ConfirmedRecord)
    sessionStorage.setItem(snapshot.tabKey, raw)
    return sessionStorage.getItem(snapshot.tabKey) === raw
  } catch { return false }
}
