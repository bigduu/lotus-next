import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  advanceOrdinaryRetryFence, beginContinuousRetryFence, captureOrdinaryRetryFence,
  confirmContinuousRetryFence, discardUnsentContinuousRetryFence, readContinuousRetryFence,
} from "./continuousRetryFence"

const backend = "https://fixture.test/api/v1", sid = "session-a"
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear() })

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
    const snapshot = captureOrdinaryRetryFence(backend, sid)!
    expect(advanceOrdinaryRetryFence(snapshot, "ordinary-run")).toBe(true)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "ordinary-run" })
    sessionStorage.setItem(tabKey, oldTab)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "old-run" })
  })
  it("does not let delayed ACKs overwrite a newer operation", () => {
    const first = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(first, "old-run")).toBe(true)
    const oldSnapshot = captureOrdinaryRetryFence(backend, sid)!
    const newer = beginContinuousRetryFence(backend, sid)!
    expect(confirmContinuousRetryFence(newer, "new-run")).toBe(true)
    expect(advanceOrdinaryRetryFence(oldSnapshot, "late-ordinary-run")).toBe(false)
    expect(confirmContinuousRetryFence(first, "late-retry-run")).toBe(false)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "new-run" })
  })
  it("can safely recover a pending receipt only from a newly started ordinary ACK", () => {
    const pending = beginContinuousRetryFence(backend, sid)!
    const snapshot = captureOrdinaryRetryFence(backend, sid)!
    expect(advanceOrdinaryRetryFence(snapshot, "new-run")).toBe(true)
    expect(confirmContinuousRetryFence(pending, "late-original")).toBe(false)
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "confirmed", runId: "new-run" })
  })
  it("fails closed for a corrupt guard or unavailable storage", () => {
    beginContinuousRetryFence(backend, sid)
    sessionStorage.clear()
    localStorage.setItem(localStorage.key(0)!, "not-json")
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "ambiguous" })
    expect(beginContinuousRetryFence(backend, sid)).toBeNull()
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
    expect(beginContinuousRetryFence(backend, sid)).toBeNull()
    expect(readContinuousRetryFence(backend, sid)).toEqual({ kind: "unavailable" })
  })
})
