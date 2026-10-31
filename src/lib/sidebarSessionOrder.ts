import { useSyncExternalStore } from "react"

/**
 * Sidebar session ordering.
 *
 * Two independent, device-local facts drive the list:
 *
 * - `activity[sessionId]`: when the user last submitted input to that session.
 *   This is the recency key, so a session the user just typed into moves to the
 *   front (and into today's date group) without waiting for a refresh.
 * - `ranks[sessionId]`: the explicit position a user set by dragging a row.
 *   Higher renders first. A session without a rank falls back to recency, so
 *   sessions the user never touched keep their previous order.
 *
 * A rank is global per session rather than per bucket, so one gesture works in
 * the date view and the project view without duplicating order state. Ordering
 * only ever compares sessions that share a visible bucket, so ranks from other
 * buckets never leak into a comparison.
 *
 * This is presentation state only: Bamboo remains authoritative for session
 * membership, titles and timestamps.
 */

const STORAGE_KEY = "lotus.sidebar.session-order.v1"
/** Upper bound on remembered ids so an abandoned device cannot expand forever. */
const MAX_IDS = 4_000

export type SessionOrder = {
  version: 1
  /** Explicit drag position; higher renders first. */
  ranks: Record<string, number>
  /** Last user submission time in epoch milliseconds. */
  activity: Record<string, number>
}

/** The minimum a caller must expose to be ordered. */
type OrderableChat = { id: string; createdAt: number }

const emptyOrder: SessionOrder = { version: 1, ranks: {}, activity: {} }
/** Neutral ordering: no manual position and no recorded submission. */
export const emptySessionOrder = emptyOrder

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)
const validId = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= 256
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

const readNumbers = (value: unknown): Record<string, number> => {
  if (!isRecord(value)) return {}
  const entries = Object.entries(value).filter((entry): entry is [string, number] => validId(entry[0]) && finite(entry[1]))
  return Object.fromEntries(entries.slice(0, MAX_IDS))
}

/** Keep the most significant ids when a stored map grows past the cap. */
function prune(records: Record<string, number>): Record<string, number> {
  const entries = Object.entries(records)
  if (entries.length <= MAX_IDS) return records
  return Object.fromEntries(entries.sort((left, right) => right[1] - left[1]).slice(0, MAX_IDS))
}

export function parseSessionOrder(raw: string | null): SessionOrder {
  try {
    const value: unknown = JSON.parse(raw ?? "null")
    if (!isRecord(value) || value.version !== 1) return emptyOrder
    return { version: 1, ranks: readNumbers(value.ranks), activity: readNumbers(value.activity) }
  } catch {
    return emptyOrder
  }
}

function load(): SessionOrder {
  try {
    if (typeof localStorage === "undefined") return emptyOrder
    return parseSessionOrder(localStorage.getItem(STORAGE_KEY))
  } catch {
    return emptyOrder
  }
}

function save(order: SessionOrder): void {
  try {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
  } catch {
    // The in-memory snapshot still orders this session's sidebar.
  }
}

let snapshot: SessionOrder = load()
const listeners = new Set<() => void>()

function publish(next: SessionOrder): SessionOrder {
  if (next === snapshot) return snapshot
  const pruned = { version: 1 as const, ranks: prune(next.ranks), activity: prune(next.activity) }
  snapshot = pruned
  save(pruned)
  for (const listener of listeners) listener()
  return pruned
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", storageChanged)
  return () => {
    listeners.delete(listener)
    if (!listeners.size && typeof window !== "undefined") window.removeEventListener("storage", storageChanged)
  }
}

function storageChanged(event: StorageEvent) {
  if (event.key !== STORAGE_KEY && event.key !== null) return
  const next = load()
  if (next === snapshot) return
  snapshot = next
  for (const listener of listeners) listener()
}

/** Current ordering without subscribing; use inside event handlers. */
export const sessionOrderSnapshot = (): SessionOrder => snapshot

/** Subscribe the sidebar so a send can reorder rows immediately. */
export function useSessionOrder(): SessionOrder {
  return useSyncExternalStore(subscribe, () => snapshot, () => emptyOrder)
}

const nextRank = (order: SessionOrder): number => {
  let top = 0
  for (const rank of Object.values(order.ranks)) if (rank > top) top = rank
  return top + 1
}

/**
 * Record a user's submission: the session becomes the most recent one, which
 * puts it ahead of everything else in its bucket. A stale or duplicated
 * submission for the same session (an older `at`) never reorders anything.
 */
export function recordSessionUserInput(sessionId: string, at = Date.now()): SessionOrder {
  if (!validId(sessionId)) return snapshot
  const previousActivity = snapshot.activity[sessionId] ?? 0
  if (at < previousActivity) return snapshot
  return publish({
    version: 1,
    activity: { ...snapshot.activity, [sessionId]: Math.max(at, previousActivity) },
    ranks: { ...snapshot.ranks, [sessionId]: nextRank(snapshot) },
  })
}

/**
 * Place `sessionId` immediately before or after `targetId` among `orderedIds`
 * (that bucket's current render order, sorted). Ranks for the bucket are
 * re-based into one contiguous band first so a session that never had a rank
 * can still be positioned between two of its neighbours.
 *
 * Pure: commit the result with `commitSessionOrder`.
 */
export function rankSessionAt(
  order: SessionOrder,
  orderedIds: readonly string[],
  sessionId: string,
  targetId: string | null,
  after = false,
): SessionOrder {
  if (!validId(sessionId) || sessionId === targetId) return order
  const rest = orderedIds.filter((id) => id !== sessionId)
  const targetIndex = targetId === null ? -1 : rest.indexOf(targetId)
  if (targetId !== null && targetIndex < 0) return order
  const index = targetId === null ? rest.length : targetIndex + (after ? 1 : 0)

  let top = 0
  for (const rank of Object.values(order.ranks)) if (rank > top) top = rank
  top += rest.length + 1

  const ranks = { ...order.ranks }
  rest.forEach((id, position) => { ranks[id] = top - 1 - position })

  const before = index > 0 ? ranks[rest[index - 1]!] : undefined
  const after_ = index < rest.length ? ranks[rest[index]!] : undefined
  ranks[sessionId] = before !== undefined && after_ !== undefined
    ? (before + after_) / 2
    : before !== undefined
      ? before - 0.5
      : after_ !== undefined
        ? after_ + 0.5
        : top
  return { ...order, ranks }
}

/** Persist and broadcast an order produced by `rankSessionAt`. */
export function commitSessionOrder(order: SessionOrder): SessionOrder {
  return publish(order)
}

/** Recency key: later wins. */
export function sessionSortTime(chat: OrderableChat, order: SessionOrder = emptyOrder): number {
  const created = finite(chat.createdAt) ? chat.createdAt : 0
  return Math.max(created, order.activity[chat.id] ?? 0)
}

/** Explicit drag position first, newest user input next. */
export function compareSidebarSessions(left: OrderableChat, right: OrderableChat, order: SessionOrder = emptyOrder): number {
  const leftRank = order.ranks[left.id] ?? Number.NEGATIVE_INFINITY
  const rightRank = order.ranks[right.id] ?? Number.NEGATIVE_INFINITY
  if (leftRank !== rightRank) return leftRank > rightRank ? -1 : 1
  return sessionSortTime(right, order) - sessionSortTime(left, order)
}

/** Test/support hook: forget every remembered position and activity time. */
export function clearSessionOrder(): void {
  publish({ version: 1, ranks: {}, activity: {} })
}

export { STORAGE_KEY as SESSION_ORDER_STORAGE_KEY }
