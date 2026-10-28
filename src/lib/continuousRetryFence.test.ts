import { beforeEach, describe, expect, it, vi } from "vitest"
import { isRetryRunId } from "@services/chat/upstreamRetry"
import {
  beginContinuousRetryFence, beginOrdinaryRetryFence, confirmContinuousRetryFence, confirmOrdinaryStartedWithoutRunId,
  discardUnsentContinuousRetryFence, isOrdinaryRetryFenceCurrent, readContinuousRetryFence, readOrdinaryRetryFence, restoreConfirmedUnstartedRetryFence,
} from "./continuousRetryFence"

const backend = "https://fixture.test/api/v1", sid = "session-a"
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear() })

function reserveOrdinary(options?: { ensureGuard?: boolean }) {
  const result = beginOrdinaryRetryFence(backend, sid, options)
  expect(result.kind).toBe("reserved")
  if (result.kind !== "reserved") throw new Error("ordinary Execute was not reserved")
  return result.reservation
}

describe("continuous retry Stop recovery", () => {
  it("retains the acknowledged run identity across a fresh read", () => {
    const reservation = beginContinuousRetryFence(backend, sid)!
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
    expect(confirmContinuousRetryFence(reservation, "exact-original-run")).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "exact-original-run" })
  })
  it("isolates different backends and sessions even when their names contain separators", () => {
    const first = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(first, "run-a")).toBe(true)
    expect(readContinuousRetryFence(backend, "session-b")).toEqual({ kind: "clear" })
    expect(readContinuousRetryFence("https://other.test/api/v1", sid)).toEqual({ kind: "clear" })
    const dotted = beginContinuousRetryFence("https://fixture.test/api.v1", sid)!
    expect(confirmContinuousRetryFence(dotted, "run-dotted")).toBe(true)
    expect(readContinuousRetryFence("https://fixture.test/api", "v1.session-a")).toEqual({ kind: "clear" })
  })
  it("keeps each tab's receipt and never guesses a successor when a receipt is missing", () => {
    const first = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(first, "run-a")).toBe(true)
    const tabKey = sessionStorage.key(0)!, tabA = sessionStorage.getItem(tabKey)!
    sessionStorage.clear() // A second tab has independent session storage.
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "ambiguous" })
    const second = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(second, "run-b")).toBe(true)
    const tabB = sessionStorage.getItem(tabKey)!
    sessionStorage.clear()
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "ambiguous" })
    sessionStorage.setItem(tabKey, tabA)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "run-a" })
    sessionStorage.setItem(tabKey, tabB)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "run-b" })
  })
  it("keeps a missing or malformed ACK pending and refuses a guessed Stop", () => {
    const reservation = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(reservation, undefined)).toBe(false)
    expect(confirmContinuousRetryFence(reservation, "bad\nheader")).toBe(false)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
  })
  it("restores an earlier receipt only for a definitely unsent operation", () => {
    const first = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(first, "old-run")).toBe(true)
    const unsent = beginContinuousRetryFence(backend, sid)!
    expect(discardUnsentContinuousRetryFence(unsent)).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "old-run" })
    expect(discardUnsentContinuousRetryFence(first)).toBe(false)
    sessionStorage.clear()
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "ambiguous" })
  })
  it("advances only this tab when a new ordinary run is acknowledged", () => {
    const first = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(first, "old-run")).toBe(true)
    const tabKey = sessionStorage.key(0)!, oldTab = sessionStorage.getItem(tabKey)!
    const reservation = reserveOrdinary()
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
    expect(confirmContinuousRetryFence(reservation, "ordinary-run")).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "ordinary-run" })
    sessionStorage.setItem(tabKey, oldTab)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "old-run" })
  })
  it("does not let delayed ACKs overwrite a newer operation", () => {
    const first = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(first, "old-run")).toBe(true)
    const ordinary = reserveOrdinary()
    const newer = beginContinuousRetryFence(backend, sid)!
    expect(newer).not.toBeNull()
    expect(confirmContinuousRetryFence(ordinary, "ordinary-run")).toBe(false)
    expect(confirmContinuousRetryFence(newer, "new-run")).toBe(true)
    expect(confirmContinuousRetryFence(ordinary, "late-ordinary-run")).toBe(false)
    expect(confirmContinuousRetryFence(first, "late-retry-run")).toBe(false)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "new-run" })
  })
  it("rejects duplicate continuous starts while a continuous ACK is unknown", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(beginContinuousRetryFence(backend, sid)).toBeNull()
    expect(confirmContinuousRetryFence(initial, undefined)).toBe(false)
    expect(beginContinuousRetryFence(backend, sid)).toBeNull()
    expect(confirmContinuousRetryFence(initial, "continuous-run")).toBe(true)
    expect(confirmContinuousRetryFence(initial, "duplicate-run")).toBe(false)
  })
  it("treats older pending records without an origin as unknown continuous operations", () => {
    beginContinuousRetryFence(backend, sid)
    const tabKey = sessionStorage.key(0)!, legacy = JSON.parse(sessionStorage.getItem(tabKey)!)
    delete legacy.origin
    sessionStorage.setItem(tabKey, JSON.stringify(legacy))
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
    expect(beginContinuousRetryFence(backend, sid)).toBeNull()
    const ordinary = reserveOrdinary()
    expect(confirmContinuousRetryFence(ordinary, "ordinary-run")).toBe(true)
  })
  it("does not guess the origin of a malformed pending record", () => {
    beginContinuousRetryFence(backend, sid)
    const tabKey = sessionStorage.key(0)!, malformed = JSON.parse(sessionStorage.getItem(tabKey)!)
    malformed.origin = "unrecognized"
    sessionStorage.setItem(tabKey, JSON.stringify(malformed))
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "ambiguous" })
    expect(beginContinuousRetryFence(backend, sid)).toBeNull()
    expect(beginOrdinaryRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
  })
  it("can restore an ordinary pending receipt if a superseding continuous start was definitely unsent", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    const ordinary = reserveOrdinary(), continuous = beginContinuousRetryFence(backend, sid)!
    expect(continuous).not.toBeNull()
    expect(discardUnsentContinuousRetryFence(continuous)).toBe(true)
    expect(confirmContinuousRetryFence(continuous, "never-sent")).toBe(false)
    expect(confirmContinuousRetryFence(ordinary, "ordinary-run")).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "ordinary-run" })
  })
  it("refuses a continuous generation that reuses the superseded ordinary ID", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    const ordinary = reserveOrdinary()
    vi.spyOn(crypto, "randomUUID").mockReturnValue(ordinary.operationId as `${string}-${string}-${string}-${string}-${string}`)
    expect(beginContinuousRetryFence(backend, sid)).toBeNull()
    expect(confirmContinuousRetryFence(ordinary, "ordinary-run")).toBe(true)
  })
  it("can safely recover a pending receipt only from a newly started ordinary ACK", () => {
    const pending = beginContinuousRetryFence(backend, sid)!
    const ordinary = reserveOrdinary()
    expect(confirmContinuousRetryFence(pending, "late-original")).toBe(false)
    expect(confirmContinuousRetryFence(ordinary, "new-run")).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "new-run" })
  })
  it("lets the later ordinary Execute win when the earlier ACK arrives first", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    const earlier = reserveOrdinary()
    const later = reserveOrdinary()
    expect(earlier.operationId).not.toBe(later.operationId)
    expect(confirmContinuousRetryFence(earlier, "earlier-run")).toBe(false)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
    expect(confirmContinuousRetryFence(later, "later-run")).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "later-run" })
  })
  it("keeps the later ordinary run when its ACK arrives first", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    const earlier = reserveOrdinary(), later = reserveOrdinary()
    expect(confirmContinuousRetryFence(later, "later-run")).toBe(true)
    expect(confirmContinuousRetryFence(earlier, "earlier-run")).toBe(false)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "later-run" })
  })
  it("leaves a newer ordinary generation pending after a lost or malformed ACK", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    const earlier = reserveOrdinary(), later = reserveOrdinary()
    expect(confirmContinuousRetryFence(earlier, "earlier-run")).toBe(false)
    expect(confirmContinuousRetryFence(later, undefined)).toBe(false)
    expect(confirmContinuousRetryFence(later, "bad\nheader")).toBe(false)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
  })
  it("restores only the latest definitely unsent ordinary reservation", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    const earlier = reserveOrdinary(), later = reserveOrdinary()
    expect(discardUnsentContinuousRetryFence(earlier)).toBe(false)
    expect(discardUnsentContinuousRetryFence(later)).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
    expect(confirmContinuousRetryFence(earlier, "earlier-run")).toBe(true)
    expect(discardUnsentContinuousRetryFence(later)).toBe(false)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "earlier-run" })
    const unsent = reserveOrdinary()
    expect(discardUnsentContinuousRetryFence(unsent)).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "earlier-run" })
  })
  it("restores the prior receipt after an ACK proves the operation did not start", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    const rejected = reserveOrdinary()
    expect(restoreConfirmedUnstartedRetryFence(rejected)).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "old-run" })
  })
  it("cannot restore an acknowledged non-start over a newer ordinary generation", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    const rejected = reserveOrdinary(), newer = reserveOrdinary()
    expect(restoreConfirmedUnstartedRetryFence(rejected)).toBe(false)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
    expect(confirmContinuousRetryFence(newer, "new-run")).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "new-run" })
  })
  it("cannot restore an acknowledged non-start over a newer continuous generation", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    const rejected = reserveOrdinary(), newer = beginContinuousRetryFence(backend, sid)!
    expect(newer).not.toBeNull()
    expect(restoreConfirmedUnstartedRetryFence(rejected)).toBe(false)
    expect(confirmContinuousRetryFence(newer, "new-run")).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "new-run" })
  })
  it("recovers an earlier ordinary started ACK after a later non-start", () => {
    const earlier = reserveOrdinary({ ensureGuard: true }), later = reserveOrdinary()
    expect(confirmContinuousRetryFence(earlier, "earlier-run")).toBe(false)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: later.operationId, started: false, runId: null })
    expect(restoreConfirmedUnstartedRetryFence(later)).toBe(true)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: earlier.operationId, started: true, runId: "earlier-run" })
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "earlier-run" })
  })
  it("recovers an earlier ordinary started ACK without run ID after a later non-start", () => {
    const earlier = reserveOrdinary({ ensureGuard: true }), later = reserveOrdinary()
    expect(confirmOrdinaryStartedWithoutRunId(earlier)).toBe(false)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: later.operationId, started: false, runId: null })
    expect(restoreConfirmedUnstartedRetryFence(later)).toBe(true)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: earlier.operationId, started: true, runId: null })
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "ambiguous" })
  })
  it("never lets an older ACK overwrite a third ordinary generation", () => {
    const earlier = reserveOrdinary({ ensureGuard: true }), middle = reserveOrdinary()
    expect(confirmContinuousRetryFence(earlier, "earlier-run")).toBe(false)
    const newest = reserveOrdinary()
    expect(restoreConfirmedUnstartedRetryFence(middle)).toBe(false)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: newest.operationId, started: false, runId: null })
    expect(confirmContinuousRetryFence(newest, "newest-run")).toBe(true)
    expect(restoreConfirmedUnstartedRetryFence(middle)).toBe(false)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "newest-run" })
  })
  it("rechecks the current generation after rollback before replaying a remembered ACK", () => {
    const earlier = reserveOrdinary({ ensureGuard: true }), later = reserveOrdinary()
    expect(confirmContinuousRetryFence(earlier, "earlier-run")).toBe(false)
    const get = sessionStorage.getItem.bind(sessionStorage), set = sessionStorage.setItem.bind(sessionStorage)
    const newestId = crypto.randomUUID()
    const newestRaw = JSON.stringify({ version: 1, operationId: newestId, state: "pending", origin: "ordinary" })
    let tabReads = 0
    vi.spyOn(sessionStorage, "getItem").mockImplementation(key => {
      if (key === later.tabKey && ++tabReads === 3) set(key, newestRaw)
      return get(key)
    })
    expect(restoreConfirmedUnstartedRetryFence(later)).toBe(true)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: newestId, started: false, runId: null })
  })
  it("does not remember a malformed run ID or an earlier non-start", () => {
    const earlier = reserveOrdinary({ ensureGuard: true }), later = reserveOrdinary()
    expect(confirmContinuousRetryFence(earlier, "bad\nheader")).toBe(false)
    expect(restoreConfirmedUnstartedRetryFence(earlier)).toBe(false)
    expect(restoreConfirmedUnstartedRetryFence(later)).toBe(true)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: earlier.operationId, started: false, runId: null })
  })
  it("does not automatically replay an ACK after a merely unsent rollback", () => {
    const earlier = reserveOrdinary({ ensureGuard: true }), later = reserveOrdinary()
    expect(confirmContinuousRetryFence(earlier, "earlier-run")).toBe(false)
    expect(discardUnsentContinuousRetryFence(later)).toBe(true)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: earlier.operationId, started: false, runId: null })
  })
  it("does not remember a superseded continuous ACK as an ordinary one", () => {
    const continuous = beginContinuousRetryFence(backend, sid)!, ordinary = reserveOrdinary()
    expect(confirmContinuousRetryFence(continuous, "continuous-run")).toBe(false)
    expect(restoreConfirmedUnstartedRetryFence(ordinary)).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
    expect(readOrdinaryRetryFence(backend, sid)).toBeNull()
  })
  it("leaves conflicting started ACK identities pending rather than guessing", () => {
    const earlier = reserveOrdinary({ ensureGuard: true }), later = reserveOrdinary()
    expect(confirmContinuousRetryFence(earlier, "first-run")).toBe(false)
    expect(confirmContinuousRetryFence(earlier, "conflicting-run")).toBe(false)
    expect(restoreConfirmedUnstartedRetryFence(later)).toBe(true)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: earlier.operationId, started: false, runId: null })
  })
  it("does not replay expired ACK evidence", () => {
    let now = Date.now()
    vi.spyOn(Date, "now").mockImplementation(() => now)
    const earlier = reserveOrdinary({ ensureGuard: true }), later = reserveOrdinary()
    expect(confirmContinuousRetryFence(earlier, "earlier-run")).toBe(false)
    now += 5 * 60_000 + 1
    expect(restoreConfirmedUnstartedRetryFence(later)).toBe(true)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: earlier.operationId, started: false, runId: null })
  })
  it("bounds remembered ACKs and evicts the oldest evidence", () => {
    let first: { session: string; earlier: ReturnType<typeof reserveOrdinary>; later: ReturnType<typeof reserveOrdinary> } | undefined
    let last: typeof first
    for (let i = 0; i < 65; i++) {
      const session = `bounded-cache-${i}`
      const initial = beginOrdinaryRetryFence(backend, session, { ensureGuard: true })
      if (initial.kind !== "reserved") throw new Error("earlier operation was not reserved")
      const next = beginOrdinaryRetryFence(backend, session)
      if (next.kind !== "reserved") throw new Error("later operation was not reserved")
      expect(confirmContinuousRetryFence(initial.reservation, `run-${i}`)).toBe(false)
      last = { session, earlier: initial.reservation, later: next.reservation }
      first ??= last
    }
    expect(restoreConfirmedUnstartedRetryFence(first!.later)).toBe(true)
    expect(readOrdinaryRetryFence(backend, first!.session)).toEqual({ operationId: first!.earlier.operationId, started: false, runId: null })
    expect(restoreConfirmedUnstartedRetryFence(last!.later)).toBe(true)
    expect(readOrdinaryRetryFence(backend, last!.session)).toEqual({ operationId: last!.earlier.operationId, started: true, runId: "run-64" })
  })
  it("does not retain ACKs for unusually large session keys", () => {
    const session = "x".repeat(5000)
    const earlier = beginOrdinaryRetryFence(backend, session, { ensureGuard: true })
    const later = beginOrdinaryRetryFence(backend, session)
    if (earlier.kind !== "reserved" || later.kind !== "reserved") throw new Error("operations were not reserved")
    expect(confirmContinuousRetryFence(earlier.reservation, "earlier-run")).toBe(false)
    expect(restoreConfirmedUnstartedRetryFence(later.reservation)).toBe(true)
    expect(readOrdinaryRetryFence(backend, session)).toEqual({ operationId: earlier.reservation.operationId, started: false, runId: null })
  })
  it("keeps pending if replay cannot be written", () => {
    const earlier = reserveOrdinary({ ensureGuard: true }), later = reserveOrdinary()
    expect(confirmContinuousRetryFence(earlier, "earlier-run")).toBe(false)
    const set = sessionStorage.setItem.bind(sessionStorage)
    vi.spyOn(sessionStorage, "setItem").mockImplementation((key, value) => {
      if (key === later.tabKey && JSON.parse(value).state === "confirmed") throw new Error("blocked")
      set(key, value)
    })
    expect(restoreConfirmedUnstartedRetryFence(later)).toBe(true)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: earlier.operationId, started: false, runId: null })
  })
  it("cannot recover in-memory ACK evidence after a page/module reload", async () => {
    const earlier = reserveOrdinary({ ensureGuard: true }), later = reserveOrdinary()
    expect(confirmContinuousRetryFence(earlier, "earlier-run")).toBe(false)
    // Keep the real validator while reloading the fence module's in-memory state.
    vi.doMock("@services/chat/upstreamRetry", () => ({ isRetryRunId }))
    vi.resetModules()
    try {
      const reloaded = await import("./continuousRetryFence")
      expect(reloaded.restoreConfirmedUnstartedRetryFence(later)).toBe(true)
      expect(reloaded.readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: earlier.operationId, started: false, runId: null })
    } finally { vi.doUnmock("@services/chat/upstreamRetry") }
  })
  it("restores a continuous pending receipt when a superseding ordinary operation was unsent", () => {
    const pending = beginContinuousRetryFence(backend, sid)!
    const ordinary = reserveOrdinary()
    expect(discardUnsentContinuousRetryFence(ordinary)).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
    expect(confirmContinuousRetryFence(pending, "continuous-run")).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "continuous-run" })
  })
  it("allows a guarded session in another tab to reserve its own ordinary run", () => {
    const first = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(first, "tab-a-run")).toBe(true)
    const tabKey = sessionStorage.key(0)!, tabA = sessionStorage.getItem(tabKey)!
    sessionStorage.clear()
    const other = reserveOrdinary()
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
    expect(confirmContinuousRetryFence(other, "tab-b-run")).toBe(true)
    const tabB = sessionStorage.getItem(tabKey)!
    sessionStorage.setItem(tabKey, tabA)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "tab-a-run" })
    sessionStorage.setItem(tabKey, tabB)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "tab-b-run" })
  })
  it("distinguishes an unguarded session and leaves no probe records", () => {
    expect(beginOrdinaryRetryFence(backend, sid)).toEqual({ kind: "unguarded" })
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "clear" })
  })
  it("guards a first ordinary Execute before persisting its pending generation", () => {
    const scope = encodeURIComponent(JSON.stringify([backend, sid]))
    const guardKey = `lotus-next.continuous-retry.guard.v1.${scope}`
    const tabKey = `lotus-next.continuous-retry.tab.v1.${scope}`
    const set = sessionStorage.setItem.bind(sessionStorage)
    let observedPendingWrite = false
    vi.spyOn(sessionStorage, "setItem").mockImplementation((key, value) => {
      if (key === tabKey) {
        expect(localStorage.getItem(guardKey)).toBe('{"version":1,"requiresExactStop":true}')
        observedPendingWrite = true
      }
      set(key, value)
    })
    const result = beginOrdinaryRetryFence(backend, sid, { ensureGuard: true })
    expect(result.kind).toBe("reserved")
    if (result.kind !== "reserved") throw new Error("first exact-stop-capable Execute was not reserved")
    expect(observedPendingWrite).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
    expect(confirmContinuousRetryFence(result.reservation, undefined)).toBe(false)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
    expect(confirmContinuousRetryFence(result.reservation, "first-exact-run")).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "first-exact-run" })
  })
  it("preserves the unguarded path when guard creation is not requested", () => {
    expect(beginOrdinaryRetryFence(backend, sid, { ensureGuard: false })).toEqual({ kind: "unguarded" })
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
  it("rejects the first exact-capable Execute when the guard cannot be written", () => {
    const scope = encodeURIComponent(JSON.stringify([backend, sid]))
    const guardKey = `lotus-next.continuous-retry.guard.v1.${scope}`
    const set = localStorage.setItem.bind(localStorage)
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === guardKey) throw new Error("blocked")
      set(key, value)
    })
    expect(beginOrdinaryRetryFence(backend, sid, { ensureGuard: true })).toEqual({ kind: "unavailable" })
    expect(localStorage.getItem(guardKey)).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })
  it("retains the guard if the first ordinary pending receipt cannot be written", () => {
    const scope = encodeURIComponent(JSON.stringify([backend, sid]))
    const guardKey = `lotus-next.continuous-retry.guard.v1.${scope}`
    const tabKey = `lotus-next.continuous-retry.tab.v1.${scope}`
    const set = sessionStorage.setItem.bind(sessionStorage)
    vi.spyOn(sessionStorage, "setItem").mockImplementation((key, value) => {
      if (key === tabKey) throw new Error("blocked")
      set(key, value)
    })
    expect(beginOrdinaryRetryFence(backend, sid, { ensureGuard: true })).toEqual({ kind: "unavailable" })
    expect(localStorage.getItem(guardKey)).toBe('{"version":1,"requiresExactStop":true}')
    expect(sessionStorage.getItem(tabKey)).toBeNull()
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "ambiguous" })
  })
  it("rejects a first ordinary Execute if guard readback is corrupt", () => {
    const scope = encodeURIComponent(JSON.stringify([backend, sid]))
    const guardKey = `lotus-next.continuous-retry.guard.v1.${scope}`
    const set = localStorage.setItem.bind(localStorage)
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      set(key, key === guardKey ? "corrupt" : value)
    })
    expect(beginOrdinaryRetryFence(backend, sid, { ensureGuard: true })).toEqual({ kind: "unavailable" })
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "ambiguous" })
    expect(sessionStorage.length).toBe(0)
  })
  it.each(["local", "session"] as const)("rejects guard creation if %s storage cannot be written", which => {
    const storage = which === "local" ? localStorage : sessionStorage
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("blocked") })
    expect(beginOrdinaryRetryFence(backend, sid, { ensureGuard: true })).toEqual({ kind: "unavailable" })
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "clear" })
  })
  it("keeps later ordinary generations authoritative after first-run guard creation", () => {
    const initial = beginOrdinaryRetryFence(backend, sid, { ensureGuard: true })
    expect(initial.kind).toBe("reserved")
    if (initial.kind !== "reserved") throw new Error("first Execute was not reserved")
    const newer = reserveOrdinary()
    expect(confirmContinuousRetryFence(initial.reservation, "old-run")).toBe(false)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
    expect(confirmContinuousRetryFence(newer, "new-run")).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "new-run" })
  })
  it("exposes only the current ordinary pending and confirmed receipt", () => {
    const ordinary = reserveOrdinary({ ensureGuard: true })
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: ordinary.operationId, started: false, runId: null })
    expect(isOrdinaryRetryFenceCurrent(backend, sid, ordinary.operationId)).toBe(true)
    expect(confirmContinuousRetryFence(ordinary, "ordinary-run")).toBe(true)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: ordinary.operationId, started: true, runId: "ordinary-run" })
    expect(JSON.parse(sessionStorage.getItem(ordinary.tabKey)!).origin).toBe("ordinary")
    expect(isOrdinaryRetryFenceCurrent(backend, sid, ordinary.operationId)).toBe(true)
    expect(isOrdinaryRetryFenceCurrent(backend, "other-session", ordinary.operationId)).toBe(false)
    expect(isOrdinaryRetryFenceCurrent("https://other.test", sid, ordinary.operationId)).toBe(false)
  })
  it("marks a verified ordinary started ACK without a run ID without authorizing an exact Stop", () => {
    const ordinary = reserveOrdinary({ ensureGuard: true })
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: ordinary.operationId, started: false, runId: null })
    expect(confirmOrdinaryStartedWithoutRunId(ordinary)).toBe(true)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: ordinary.operationId, started: true, runId: null })
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "ambiguous" })
    expect(isOrdinaryRetryFenceCurrent(backend, sid, ordinary.operationId)).toBe(true)
    expect(confirmOrdinaryStartedWithoutRunId(ordinary)).toBe(false)
    expect(confirmContinuousRetryFence(ordinary, "duplicate-run")).toBe(false)
  })
  it("never marks continuous, stale, or already confirmed generations started without an ID", () => {
    const continuous = beginContinuousRetryFence(backend, sid)!
    expect(confirmOrdinaryStartedWithoutRunId(continuous)).toBe(false)
    const older = reserveOrdinary(), newer = reserveOrdinary()
    expect(confirmOrdinaryStartedWithoutRunId(older)).toBe(false)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: newer.operationId, started: false, runId: null })
    expect(confirmContinuousRetryFence(newer, "newer-run")).toBe(true)
    expect(confirmOrdinaryStartedWithoutRunId(newer)).toBe(false)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: newer.operationId, started: true, runId: "newer-run" })
  })
  it("keeps an invalid or absent ACK pending until the caller confirms a valid start", () => {
    const ordinary = reserveOrdinary({ ensureGuard: true })
    expect(confirmContinuousRetryFence(ordinary, undefined)).toBe(false)
    expect(confirmContinuousRetryFence(ordinary, "bad\nheader")).toBe(false)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: ordinary.operationId, started: false, runId: null })
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
  })
  it("keeps a failed write pending when recording a started ACK without an ID", () => {
    const ordinary = reserveOrdinary({ ensureGuard: true })
    vi.spyOn(sessionStorage, "setItem").mockImplementation(() => { throw new Error("blocked") })
    expect(confirmOrdinaryStartedWithoutRunId(ordinary)).toBe(false)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: ordinary.operationId, started: false, runId: null })
  })
  it("rejects a late unidentified ACK once a newer ordinary generation exists", () => {
    const older = reserveOrdinary({ ensureGuard: true }), newer = reserveOrdinary()
    expect(isOrdinaryRetryFenceCurrent(backend, sid, older.operationId)).toBe(false)
    expect(confirmOrdinaryStartedWithoutRunId(older)).toBe(false)
    expect(isOrdinaryRetryFenceCurrent(backend, sid, newer.operationId)).toBe(true)
    expect(confirmOrdinaryStartedWithoutRunId(newer)).toBe(true)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: newer.operationId, started: true, runId: null })
  })
  it("keeps an unidentified ordinary receipt isolated from a newer continuous operation", () => {
    const ordinary = reserveOrdinary({ ensureGuard: true })
    expect(confirmOrdinaryStartedWithoutRunId(ordinary)).toBe(true)
    const continuous = beginContinuousRetryFence(backend, sid)!
    expect(continuous).not.toBeNull()
    expect(readOrdinaryRetryFence(backend, sid)).toBeNull()
    expect(isOrdinaryRetryFenceCurrent(backend, sid, ordinary.operationId)).toBe(false)
    expect(confirmOrdinaryStartedWithoutRunId(ordinary)).toBe(false)
    expect(confirmContinuousRetryFence(continuous, "continuous-run")).toBe(true)
    expect(readOrdinaryRetryFence(backend, sid)).toBeNull()
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "continuous-run" })
    expect(JSON.parse(sessionStorage.getItem(continuous.tabKey)!).origin).toBe("continuous")
  })
  it("does not recognize continuous pending or confirmed receipts as ordinary", () => {
    const continuous = beginContinuousRetryFence(backend, sid)!
    expect(readOrdinaryRetryFence(backend, sid)).toBeNull()
    expect(isOrdinaryRetryFenceCurrent(backend, sid, continuous.operationId)).toBe(false)
    expect(confirmContinuousRetryFence(continuous, "continuous-run")).toBe(true)
    expect(readOrdinaryRetryFence(backend, sid)).toBeNull()
    expect(isOrdinaryRetryFenceCurrent(backend, sid, continuous.operationId)).toBe(false)
  })
  it("treats old pending and confirmed receipts without an origin as unknown to ordinary Stop", () => {
    const ordinary = reserveOrdinary({ ensureGuard: true })
    const pending = JSON.parse(sessionStorage.getItem(ordinary.tabKey)!)
    delete pending.origin
    sessionStorage.setItem(ordinary.tabKey, JSON.stringify(pending))
    expect(readOrdinaryRetryFence(backend, sid)).toBeNull()
    expect(isOrdinaryRetryFenceCurrent(backend, sid, ordinary.operationId)).toBe(false)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
    const confirmed = { version: 1, operationId: ordinary.operationId, state: "confirmed", runId: "old-run" }
    sessionStorage.setItem(ordinary.tabKey, JSON.stringify(confirmed))
    expect(readOrdinaryRetryFence(backend, sid)).toBeNull()
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "old-run" })
  })
  it("rejects malformed confirmed or unidentified record origins", () => {
    const ordinary = reserveOrdinary({ ensureGuard: true })
    const record = { version: 1, operationId: ordinary.operationId, state: "confirmed", runId: "run", origin: "bad" }
    sessionStorage.setItem(ordinary.tabKey, JSON.stringify(record))
    expect(readOrdinaryRetryFence(backend, sid)).toBeNull()
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "ambiguous" })
    sessionStorage.setItem(ordinary.tabKey, JSON.stringify({ ...record, state: "started_unidentified", origin: "ordinary" }))
    expect(readOrdinaryRetryFence(backend, sid)).toBeNull()
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "ambiguous" })
    sessionStorage.setItem(ordinary.tabKey, JSON.stringify({ version: 1, operationId: ordinary.operationId, state: "started_unidentified", origin: "continuous" }))
    expect(readOrdinaryRetryFence(backend, sid)).toBeNull()
    expect(beginContinuousRetryFence(backend, sid)).toBeNull()
  })
  it("refuses an ordinary receipt when its guard is missing, corrupt, or unavailable", () => {
    const ordinary = reserveOrdinary({ ensureGuard: true })
    const guardKey = localStorage.key(0)!, guard = localStorage.getItem(guardKey)!
    localStorage.removeItem(guardKey)
    expect(readOrdinaryRetryFence(backend, sid)).toBeNull()
    expect(isOrdinaryRetryFenceCurrent(backend, sid, ordinary.operationId)).toBe(false)
    localStorage.setItem(guardKey, "corrupt")
    expect(readOrdinaryRetryFence(backend, sid)).toBeNull()
    localStorage.setItem(guardKey, guard)
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
    expect(readOrdinaryRetryFence(backend, sid)).toBeNull()
    expect(isOrdinaryRetryFenceCurrent(backend, sid, ordinary.operationId)).toBe(false)
  })
  it("rejects a receipt if its shared guard changes during the read", () => {
    reserveOrdinary({ ensureGuard: true })
    const guardKey = localStorage.key(0)!, get = localStorage.getItem.bind(localStorage)
    let reads = 0
    vi.spyOn(localStorage, "getItem").mockImplementation(key => key === guardKey && ++reads === 2 ? null : get(key))
    expect(readOrdinaryRetryFence(backend, sid)).toBeNull()
  })
  it("does not borrow another tab's ordinary receipt", () => {
    const first = reserveOrdinary({ ensureGuard: true })
    expect(confirmContinuousRetryFence(first, "tab-a-run")).toBe(true)
    const tabA = sessionStorage.getItem(first.tabKey)!
    sessionStorage.clear()
    expect(readOrdinaryRetryFence(backend, sid)).toBeNull()
    expect(isOrdinaryRetryFenceCurrent(backend, sid, first.operationId)).toBe(false)
    const second = reserveOrdinary()
    expect(confirmOrdinaryStartedWithoutRunId(second)).toBe(true)
    const tabB = sessionStorage.getItem(first.tabKey)!
    sessionStorage.setItem(first.tabKey, tabA)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: first.operationId, started: true, runId: "tab-a-run" })
    sessionStorage.setItem(first.tabKey, tabB)
    expect(readOrdinaryRetryFence(backend, sid)).toEqual({ operationId: second.operationId, started: true, runId: null })
  })
  it("fails closed for a corrupt guard or unavailable storage", () => {
    beginContinuousRetryFence(backend, sid)
    sessionStorage.clear()
    localStorage.setItem(localStorage.key(0)!, "not-json")
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "ambiguous" })
    expect(beginContinuousRetryFence(backend, sid)).toBeNull()
    expect(beginOrdinaryRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
    expect(beginContinuousRetryFence(backend, sid)).toBeNull()
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
    expect(beginOrdinaryRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
  })
  it("treats a corrupt tab record or corrupt guard as unavailable and restores a missing guard", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    const guardKey = localStorage.key(0)!, tabKey = sessionStorage.key(0)!
    const guardRaw = localStorage.getItem(guardKey)!, tabRaw = sessionStorage.getItem(tabKey)!
    sessionStorage.setItem(tabKey, "broken")
    expect(beginOrdinaryRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
    sessionStorage.setItem(tabKey, tabRaw)
    localStorage.setItem(guardKey, "broken")
    expect(beginOrdinaryRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
    localStorage.removeItem(guardKey)
    const reservation = reserveOrdinary()
    expect(localStorage.getItem(guardKey)).toBe(guardRaw)
    expect(reservation.priorTabRaw).toBe(tabRaw)
    expect(confirmContinuousRetryFence(reservation, "ordinary-run")).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "ordinary-run" })
  })
  it("restores a missing shared guard for a pending tab receipt before ordinary Execute", () => {
    const pending = beginContinuousRetryFence(backend, sid)!
    const guardKey = localStorage.key(0)!, guardRaw = localStorage.getItem(guardKey)!
    localStorage.removeItem(guardKey)
    const ordinary = reserveOrdinary()
    expect(localStorage.getItem(guardKey)).toBe(guardRaw)
    expect(confirmContinuousRetryFence(pending, "old-run")).toBe(false)
    expect(confirmContinuousRetryFence(ordinary, "new-run")).toBe(true)
  })
  it("refuses a reused operation ID rather than accepting an older ACK", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    vi.spyOn(crypto, "randomUUID").mockReturnValue(initial.operationId as `${string}-${string}-${string}-${string}-${string}`)
    expect(beginOrdinaryRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "old-run" })
  })
  it.each([
    ["local", "getItem"], ["local", "setItem"], ["local", "removeItem"],
    ["session", "getItem"], ["session", "setItem"], ["session", "removeItem"],
  ] as const)("fails closed when protected %s storage %s is unavailable", (which, method) => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    const storage = which === "local" ? localStorage : sessionStorage
    const fail = () => { throw new Error("blocked") }
    if (method === "getItem") vi.spyOn(storage, "getItem").mockImplementation(fail)
    else if (method === "setItem") vi.spyOn(storage, "setItem").mockImplementation(fail)
    else vi.spyOn(storage, "removeItem").mockImplementation(fail)
    expect(beginOrdinaryRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
  })
  it.each(["local", "session"] as const)("keeps unguarded ordinary Execute available when %s storage cannot write", which => {
    const storage = which === "local" ? localStorage : sessionStorage
    const fail = () => { throw new Error("blocked") }
    vi.spyOn(storage, "setItem").mockImplementation(fail)
    vi.spyOn(storage, "removeItem").mockImplementation(fail)
    expect(beginOrdinaryRetryFence(backend, sid)).toEqual({ kind: "unguarded" })
  })
  it.each(["local", "session"] as const)("cannot guess that an unreadable %s storage is unguarded", which => {
    const storage = which === "local" ? localStorage : sessionStorage
    vi.spyOn(storage, "getItem").mockImplementation(() => { throw new Error("blocked") })
    expect(beginOrdinaryRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
  })
  it("does not treat an unreadable tab receipt as clear when the shared guard is absent", () => {
    vi.spyOn(sessionStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
    expect(beginOrdinaryRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
  })
  it("fails closed when writing the actual reservation fails after successful probes", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    const tabKey = sessionStorage.key(0)!, set = sessionStorage.setItem.bind(sessionStorage)
    vi.spyOn(sessionStorage, "setItem").mockImplementation((key, value) => {
      if (key === tabKey) throw new Error("blocked")
      set(key, value)
    })
    expect(beginOrdinaryRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "old-run" })
  })
  it("keeps the new receipt pending if a failed write cannot be rolled back", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    const tabKey = sessionStorage.key(0)!, set = sessionStorage.setItem.bind(sessionStorage)
    vi.spyOn(sessionStorage, "setItem").mockImplementation((key, value) => {
      if (key === tabKey) {
        if (JSON.parse(value).state === "pending") set(key, value)
        throw new Error("blocked")
      }
      set(key, value)
    })
    expect(beginOrdinaryRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "pending" })
  })
  it("refuses ordinary Execute if restoring a missing guard fails", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    const guardKey = localStorage.key(0)!, set = localStorage.setItem.bind(localStorage)
    localStorage.removeItem(guardKey)
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === guardKey) throw new Error("blocked")
      set(key, value)
    })
    expect(beginOrdinaryRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
    expect(localStorage.getItem(guardKey)).toBeNull()
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "old-run" })
  })
  it("fails closed if the shared guard changes while checking storage", () => {
    const initial = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(initial, "old-run")).toBe(true)
    const guardKey = localStorage.key(0)!, get = localStorage.getItem.bind(localStorage)
    let guardReads = 0
    vi.spyOn(localStorage, "getItem").mockImplementation(key => {
      if (key === guardKey && ++guardReads === 2) return null
      return get(key)
    })
    expect(beginOrdinaryRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
  })
})
