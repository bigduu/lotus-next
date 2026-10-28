import { isRetryRunId } from "@services/chat/upstreamRetry"

type PendingRecord = { version: 1; operationId: string; state: "pending"; origin?: "ordinary" | "continuous" }
type ConfirmedRecord = { version: 1; operationId: string; state: "confirmed"; runId: string; origin?: "ordinary" | "continuous" }
type StartedUnidentifiedRecord = { version: 1; operationId: string; state: "started_unidentified"; origin: "ordinary" }
type RecordValue = PendingRecord | ConfirmedRecord | StartedUnidentifiedRecord
type TabFence =
  | { kind: "clear"; raw: null }
  | { kind: "pending"; raw: string; operationId: string; origin: "ordinary" | "continuous" | "unknown" }
  | { kind: "started_unidentified"; raw: string; operationId: string; origin: "ordinary" }
  | { kind: "ambiguous" }
  | { kind: "unavailable" }
  | { kind: "confirmed"; raw: string; operationId: string; origin: "ordinary" | "continuous" | "unknown"; runId: string }
type SharedGuard = "clear" | "guarded" | "ambiguous" | "unavailable"
export type RetryFence =
  | { kind: "clear" | "pending" | "ambiguous" | "unavailable" }
  | { kind: "confirmed"; runId: string }
export type RetryFenceReservation = { tabKey: string; pendingRaw: string; priorTabRaw: string | null; operationId: string }
export type OrdinaryRetryFence = { operationId: string; started: boolean; runId: string | null }
export type OrdinaryRetryFenceResult =
  | { kind: "unguarded" }
  | { kind: "unavailable" }
  | { kind: "reserved"; reservation: RetryFenceReservation }

const operationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const scopeKey = (backend: string, sessionId: string) => encodeURIComponent(JSON.stringify([backend, sessionId]))
const guardKeyFor = (backend: string, sessionId: string) => `lotus-next.continuous-retry.guard.v1.${scopeKey(backend, sessionId)}`
const tabKeyFor = (backend: string, sessionId: string) => `lotus-next.continuous-retry.tab.v1.${scopeKey(backend, sessionId)}`
const guardValue = '{"version":1,"requiresExactStop":true}'

function parseRecord(raw: string): RecordValue | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    const value = parsed as { version?: unknown; operationId?: unknown; state?: unknown; runId?: unknown; origin?: unknown }
    if (value.version !== 1 || typeof value.operationId !== "string" || !operationPattern.test(value.operationId)) return null
    if (value.state === "pending") {
      if (value.origin === undefined) return { version: 1, operationId: value.operationId, state: "pending" }
      if (value.origin === "ordinary" || value.origin === "continuous")
        return { version: 1, operationId: value.operationId, state: "pending", origin: value.origin }
      return null
    }
    if (value.state === "started_unidentified" && value.origin === "ordinary" && value.runId === undefined)
      return { version: 1, operationId: value.operationId, state: "started_unidentified", origin: "ordinary" }
    if (value.state === "confirmed" && isRetryRunId(value.runId)) {
      if (value.origin === undefined) return { version: 1, operationId: value.operationId, state: "confirmed", runId: value.runId }
      if (value.origin === "ordinary" || value.origin === "continuous")
        return { version: 1, operationId: value.operationId, state: "confirmed", runId: value.runId, origin: value.origin }
      return null
    }
    return null
  } catch { return null }
}

// Only in-page ACK evidence is retained. Eviction or a reload leaves the receipt pending.
type RememberedOrdinaryStart = { tabKey: string; pendingRaw: string; confirmedRaw: string; createdAt: number; conflicting: boolean }
const rememberedOrdinaryStarts = new Map<string, RememberedOrdinaryStart>()
const maxRememberedOrdinaryStarts = 64, rememberedStartLifetimeMs = 5 * 60_000
let rememberedStartTimer: ReturnType<typeof setTimeout> | null = null
const rememberedStartKey = (tabKey: string, operationId: string) => JSON.stringify([tabKey, operationId])

function pruneRememberedStarts(now: number): void {
  for (const [key, entry] of rememberedOrdinaryStarts)
    if (now < entry.createdAt || now - entry.createdAt >= rememberedStartLifetimeMs) rememberedOrdinaryStarts.delete(key)
}

function scheduleRememberedStartCleanup(): void {
  if (rememberedStartTimer !== null) clearTimeout(rememberedStartTimer)
  rememberedStartTimer = null
  const now = Date.now()
  pruneRememberedStarts(now)
  if (rememberedOrdinaryStarts.size === 0) return
  let earliest = Infinity
  for (const entry of rememberedOrdinaryStarts.values()) earliest = Math.min(earliest, entry.createdAt + rememberedStartLifetimeMs)
  try {
    rememberedStartTimer = setTimeout(() => { rememberedStartTimer = null; scheduleRememberedStartCleanup() }, Math.max(0, earliest - now))
    ;(rememberedStartTimer as unknown as { unref?: () => void }).unref?.()
  } catch { rememberedOrdinaryStarts.clear() }
}

function forgetRememberedStartsForTab(tabKey: string): void {
  for (const [key, entry] of rememberedOrdinaryStarts) if (entry.tabKey === tabKey) rememberedOrdinaryStarts.delete(key)
  scheduleRememberedStartCleanup()
}

function rememberOrdinaryStart(reservation: RetryFenceReservation, confirmedRaw: string): void {
  // Cap both entry count and retained input sizes; unusually large keys fail closed.
  if (reservation.tabKey.length > 4096 || reservation.pendingRaw.length > 1024) return
  const now = Date.now()
  if (!Number.isFinite(now)) return
  pruneRememberedStarts(now)
  const key = rememberedStartKey(reservation.tabKey, reservation.operationId), previous = rememberedOrdinaryStarts.get(key)
  if (previous) {
    if (previous.pendingRaw !== reservation.pendingRaw || previous.confirmedRaw !== confirmedRaw) previous.conflicting = true
  } else {
    rememberedOrdinaryStarts.set(key, { tabKey: reservation.tabKey, pendingRaw: reservation.pendingRaw, confirmedRaw, createdAt: now, conflicting: false })
  }
  while (rememberedOrdinaryStarts.size > maxRememberedOrdinaryStarts) rememberedOrdinaryStarts.delete(rememberedOrdinaryStarts.keys().next().value!)
  scheduleRememberedStartCleanup()
}

function takeRememberedOrdinaryStart(tabKey: string, operationId: string, pendingRaw: string): string | null {
  pruneRememberedStarts(Date.now())
  const key = rememberedStartKey(tabKey, operationId), entry = rememberedOrdinaryStarts.get(key)
  rememberedOrdinaryStarts.delete(key)
  scheduleRememberedStartCleanup()
  return entry && !entry.conflicting && entry.pendingRaw === pendingRaw ? entry.confirmedRaw : null
}

function recordStartedAck(reservation: RetryFenceReservation, pending: PendingRecord, confirmedRaw: string): boolean {
  try {
    const currentRaw = sessionStorage.getItem(reservation.tabKey)
    if (currentRaw !== reservation.pendingRaw) {
      const current = currentRaw === null ? null : parseRecord(currentRaw)
      if (pending.origin === "ordinary" && current?.state === "pending" && current.operationId !== pending.operationId)
        rememberOrdinaryStart(reservation, confirmedRaw)
      return false
    }
    sessionStorage.setItem(reservation.tabKey, confirmedRaw)
    const confirmed = sessionStorage.getItem(reservation.tabKey) === confirmedRaw
    if (confirmed) forgetRememberedStartsForTab(reservation.tabKey)
    return confirmed
  } catch { return false }
}

function readTabFence(backend: string, sessionId: string): TabFence {
  try {
    const raw = sessionStorage.getItem(tabKeyFor(backend, sessionId))
    if (raw === null) return { kind: "clear", raw: null }
    const value = parseRecord(raw)
    if (!value) return { kind: "ambiguous" }
    if (value.state === "pending") return { kind: "pending", raw, operationId: value.operationId, origin: value.origin ?? "unknown" }
    if (value.state === "started_unidentified") return { kind: "started_unidentified", raw, operationId: value.operationId, origin: "ordinary" }
    return { kind: "confirmed", raw, operationId: value.operationId, origin: value.origin ?? "unknown", runId: value.runId }
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
  if (tab.kind === "started_unidentified") return { kind: "ambiguous" }
  if (tab.kind === "pending" || tab.kind === "ambiguous" || tab.kind === "unavailable") return { kind: tab.kind }
  const guard = readSharedGuard(backend, sessionId)
  if (guard === "clear") return { kind: "clear" }
  if (guard === "ambiguous" || guard === "unavailable") return { kind: guard }
  return { kind: "ambiguous" }
}

/** Return only this tab's ordinary receipt while its shared guard is valid. */
export function readOrdinaryRetryFence(backend: string, sessionId: string): OrdinaryRetryFence | null {
  if (readSharedGuard(backend, sessionId) !== "guarded") return null
  const tab = readTabFence(backend, sessionId)
  if ((tab.kind !== "pending" && tab.kind !== "confirmed" && tab.kind !== "started_unidentified") || tab.origin !== "ordinary") return null
  if (readSharedGuard(backend, sessionId) !== "guarded") return null
  return { operationId: tab.operationId, started: tab.kind !== "pending", runId: tab.kind === "confirmed" ? tab.runId : null }
}

/** Check that this exact ordinary generation still owns the current tab receipt. */
export function isOrdinaryRetryFenceCurrent(backend: string, sessionId: string, operationId: string): boolean {
  return readOrdinaryRetryFence(backend, sessionId)?.operationId === operationId
}

/** Persist the shared guard and this tab's pending receipt before Execute. */
export function beginContinuousRetryFence(backend: string, sessionId: string): RetryFenceReservation | null {
  const tab = readTabFence(backend, sessionId), guard = readSharedGuard(backend, sessionId)
  if ((tab.kind !== "clear" && tab.kind !== "confirmed" && tab.kind !== "started_unidentified"
      && !(tab.kind === "pending" && tab.origin === "ordinary")) || (guard !== "clear" && guard !== "guarded")) return null
  let reservation: RetryFenceReservation | null = null
  try {
    const operationId = crypto.randomUUID(), tabKey = tabKeyFor(backend, sessionId), guardKey = guardKeyFor(backend, sessionId)
    if (!operationPattern.test(operationId) || (tab.raw !== null && parseRecord(tab.raw)?.operationId === operationId)) return null
    const pendingRaw = JSON.stringify({ version: 1, operationId, state: "pending", origin: "continuous" } satisfies PendingRecord)
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

/** Restore only after the caller verifies that this operation's ACK proves it did not start. */
export function restoreConfirmedUnstartedRetryFence(reservation: RetryFenceReservation): boolean {
  if (!discardUnsentContinuousRetryFence(reservation)) return false
  const previousRaw = reservation.priorTabRaw, previous = previousRaw === null ? null : parseRecord(previousRaw)
  if (!previous || previous.state !== "pending" || previous.origin !== "ordinary" || previousRaw === null) return true
  const confirmedRaw = takeRememberedOrdinaryStart(reservation.tabKey, previous.operationId, previousRaw)
  if (confirmedRaw === null) return true
  try {
    if (sessionStorage.getItem(reservation.tabKey) !== previousRaw) return true
    sessionStorage.setItem(reservation.tabKey, confirmedRaw)
    if (sessionStorage.getItem(reservation.tabKey) === confirmedRaw) forgetRememberedStartsForTab(reservation.tabKey)
  } catch { /* Keep the persisted receipt fail-closed. */ }
  return true
}

/** A malformed or late ACK cannot confirm a newer tab operation. */
export function confirmContinuousRetryFence(reservation: RetryFenceReservation, runId: unknown): boolean {
  if (!isRetryRunId(runId)) return false
  const pending = parseRecord(reservation.pendingRaw)
  if (!pending || pending.state !== "pending" || pending.operationId !== reservation.operationId) return false
  const raw = JSON.stringify({ version: 1, operationId: reservation.operationId, state: "confirmed", runId,
    ...(pending.origin ? { origin: pending.origin } : {}) } satisfies ConfirmedRecord)
  return recordStartedAck(reservation, pending, raw)
}

/** Record a started ACK with no run ID after the caller has validated its session and status. */
export function confirmOrdinaryStartedWithoutRunId(reservation: RetryFenceReservation): boolean {
  const pending = parseRecord(reservation.pendingRaw)
  if (!pending || pending.state !== "pending" || pending.origin !== "ordinary" || pending.operationId !== reservation.operationId) return false
  const raw = JSON.stringify({ version: 1, operationId: reservation.operationId, state: "started_unidentified", origin: "ordinary" } satisfies StartedUnidentifiedRecord)
  return recordStartedAck(reservation, pending, raw)
}

/** Verify protected-session storage writes without overwriting an existing key. */
function storageIsWritable(storage: Storage): boolean {
  const key = `lotus-next.continuous-retry.probe.${Date.now()}.${Math.random().toString(36).slice(2)}`
  const value = "probe"
  let attempted = false
  try {
    if (storage.getItem(key) !== null) return false
    attempted = true
    storage.setItem(key, value)
    if (storage.getItem(key) !== value) return false
    storage.removeItem(key)
    attempted = false
    return storage.getItem(key) === null
  } catch { return false }
  finally {
    if (attempted) {
      try { if (storage.getItem(key) === value) storage.removeItem(key) } catch { /* unavailable */ }
    }
  }
}

/** Reserve a new tab generation synchronously before sending a guarded ordinary Execute. */
export function beginOrdinaryRetryFence(backend: string, sessionId: string, options?: { ensureGuard?: boolean }): OrdinaryRetryFenceResult {
  const unavailable: OrdinaryRetryFenceResult = { kind: "unavailable" }
  const tab = readTabFence(backend, sessionId), guard = readSharedGuard(backend, sessionId)
  if (tab.kind === "ambiguous" || tab.kind === "unavailable" || guard === "ambiguous" || guard === "unavailable") return unavailable
  let reservation: RetryFenceReservation | null = null
  try {
    if (guard === "clear" && tab.kind === "clear" && !options?.ensureGuard) {
      return readSharedGuard(backend, sessionId) === "clear" && sessionStorage.getItem(tabKeyFor(backend, sessionId)) === null
        ? { kind: "unguarded" } : unavailable
    }
    if (!storageIsWritable(localStorage) || !storageIsWritable(sessionStorage)) return unavailable
    // Recheck after the probes so an intervening receipt or guard change is never mistaken for a clear session.
    if (readSharedGuard(backend, sessionId) !== guard || sessionStorage.getItem(tabKeyFor(backend, sessionId)) !== tab.raw) return unavailable
    // Restore prior protection or establish it for an exact-stop-capable ordinary Execute.
    if (guard === "clear") {
      localStorage.setItem(guardKeyFor(backend, sessionId), guardValue)
      if (readSharedGuard(backend, sessionId) !== "guarded") return unavailable
    }

    const operationId = crypto.randomUUID(), tabKey = tabKeyFor(backend, sessionId)
    if (!operationPattern.test(operationId) || (tab.raw !== null && parseRecord(tab.raw)?.operationId === operationId)) return unavailable
    const pendingRaw = JSON.stringify({ version: 1, operationId, state: "pending", origin: "ordinary" } satisfies PendingRecord)
    reservation = { tabKey, pendingRaw, priorTabRaw: tab.raw, operationId }
    sessionStorage.setItem(tabKey, pendingRaw)
    if (sessionStorage.getItem(tabKey) === pendingRaw) return { kind: "reserved", reservation }
    discardUnsentContinuousRetryFence(reservation)
    return unavailable
  } catch {
    if (reservation) discardUnsentContinuousRetryFence(reservation)
    return unavailable
  }
}
