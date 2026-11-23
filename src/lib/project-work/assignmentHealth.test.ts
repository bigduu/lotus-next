import { describe, expect, it } from "vitest"
import {
  currentAssignment, healthReadStatus, recoveryState, sessionAccess, timestampMs, verifiedObservation,
  type AssignmentAttempt, type AssignmentObservation, type HealthRead, type PatrolIncident,
} from "./assignmentHealth"

const now = Date.parse("2026-10-17T17:30:00Z")
const read = <T,>(value: T): Extract<HealthRead<T>, { status: "available" }> => ({ status: "available", value, updatedAt: "2026-10-17T17:29:59Z", validUntil: "2026-10-17T17:31:00Z" })
const attempt = (extra: Partial<AssignmentAttempt> = {}): AssignmentAttempt => ({
  id: "a-current", work_id: "work", generation: 2, authority_epoch: 3, state: "running",
  runtime: { session_id: "session-current", run_id: "run-current" }, workspace: null, ...extra,
})
const observation = (extra: Partial<AssignmentObservation> = {}): AssignmentObservation => ({
  work_id: "work", assignment_id: "a-current", generation: 2, authority_epoch: 3,
  session_id: "session-current", run_id: "run-current", execution: "running", heartbeat_at: "2026-10-17T17:29:58Z", ...extra,
})
const incident = (extra: Partial<PatrolIncident> = {}): PatrolIncident => ({
  id: "incident-stable", work_id: "work", assignment_id: "a-current", generation: 2, authority_epoch: 3,
  source_revision: "revision-17", evidence_ref: "receipt-17", opened_at: "2026-10-17T17:20:00Z", progress_sequence: 8,
  phase: "open", reason: "Repeated identical tool error", ...extra,
})
const current = (attempts: AssignmentAttempt[], extra = {}) => currentAssignment({ workId: "work", generation: 2, authorityEpoch: 3, currentAssignmentId: "a-current", attempts: read(attempts), nowMs: now, ...extra })

describe("Assignment/receipt identity and freshness contract", () => {
  it("uses only the canonical active assignment, never the newest heartbeat or array order", () => {
    const old = attempt({ id: "a-old", generation: 1, runtime: { session_id: "session-old", run_id: "run-old" } })
    for (const attempts of [[old, attempt()], [attempt(), old]]) expect(current(attempts).attempt?.runtime?.session_id).toBe("session-current")
    expect(verifiedObservation(attempt(), read([observation({ assignment_id: old.id, generation: 1, heartbeat_at: "2026-10-17T17:29:59Z" })]), now)).toBeUndefined()
  })
  it.each([
    { generation: 1 }, { authority_epoch: 2 }, { work_id: "another-work" }, { role: "collaborator" as const }, { role: "reviewer" as const },
    { state: "submitted" }, { state: "cancelled" }, { state: "failed" }, { state: "new-unknown-state" }, { process_stopped: true }, { runtime: null },
  ])("does not confirm an owner from mismatched, terminal or non-executor facts: %j", (extra) => {
    expect(current([attempt(extra)]).status).toBe("unknown")
  })
  it("does not select one of duplicate claimant records or infer an owner without the canonical ID", () => {
    expect(current([attempt(), attempt({ role: "reviewer" })]).status).toBe("unknown")
    expect(current([attempt()], { currentAssignmentId: null }).status).toBe("none")
    expect(current([attempt({ generation: undefined })]).status).toBe("unknown")
  })
  it("keeps legacy snapshot refs available without inventing wall-clock timestamps", () => {
    const legacy = { status: "available" as const, value: [attempt()], updatedAt: null }
    expect(healthReadStatus(legacy, now)).toBe("available")
    expect(current([attempt()], { attempts: legacy }).status).toBe("confirmed")
    expect(healthReadStatus(legacy, now, true)).toBe("unknown")
    expect(timestampMs("17")).toBeNull()
    expect(timestampMs("2026-10-17T17:30:00")).toBeNull()
  })
  it.each([
    { validUntil: "2026-10-17T17:30:00Z" }, { updatedAt: "2026-10-17T17:31:00Z" }, { validUntil: "invalid" }, { updatedAt: "invalid" },
  ])("expires explicitly stale or invalid evidence without claiming the process stopped: %j", (extra) => {
    expect(current([attempt()], { attempts: { ...read([attempt()]), ...extra } }).status).toBe("unknown")
  })
  it("requires fresh, unique, receipt-matching observations and treats heartbeat separately from progress", () => {
    const observed = verifiedObservation(attempt(), read([observation()]), now)!
    expect(observed.heartbeat_at).toBeDefined()
    expect(observed.progress).toBeUndefined()
    expect(verifiedObservation(attempt(), read([observation(), observation()]), now)).toBeUndefined()
    expect(verifiedObservation(attempt(), read([observation({ run_id: "another-run" })]), now)).toBeUndefined()
    expect(verifiedObservation(attempt(), read([observation({ session_id: "another-session" })]), now)).toBeUndefined()
    expect(verifiedObservation(attempt(), { ...read([observation()]), validUntil: null }, now)).toBeUndefined()
    expect(verifiedObservation(attempt(), read([observation({ heartbeat_at: "2026-10-17T17:30:00Z" })]), now)).toBeUndefined()
  })
  it("requires exact accessible Assignment/session/run refs, rejecting duplicate and expired permissions", () => {
    const ref = { assignment_id: "a-current", session_id: "session-current", run_id: "run-current", access: "accessible" as const }
    expect(sessionAccess(attempt(), read([ref]), now)).toBe("accessible")
    expect(sessionAccess(attempt(), read([{ ...ref, run_id: "other" }]), now)).toBe("unknown")
    expect(sessionAccess(attempt(), read([ref, { ...ref, access: "denied" }]), now)).toBe("unknown")
    expect(sessionAccess(attempt(), { ...read([ref]), validUntil: "2026-10-17T17:29:00Z" }, now)).toBe("unknown")
  })
})

describe("recovery evidence contract", () => {
  const requested = { requested_at: "2026-10-17T17:25:00Z", acknowledged_at: "2026-10-17T17:26:00Z" }
  it("does not resolve heartbeat-only incidents on a recovery request or runtime ACK", () => {
    expect(recoveryState(incident({ recovery: { requested_at: requested.requested_at } }), observation(), now)).toBe("requested")
    expect(recoveryState(incident({ recovery: requested }), observation(), now)).toBe("acknowledged")
    expect(recoveryState(incident({ phase: "resolved", recovery: requested }), observation(), now)).toBe("unconfirmed")
  })
  it("confirms only a later effective progress sequence with scoped evidence", () => {
    const resumed = observation({ progress: { sequence: 9, at: "2026-10-17T17:28:00Z", evidence_ref: "tool-receipt-9" } })
    expect(recoveryState(incident({ recovery: requested }), resumed, now)).toBe("progress_observed")
    expect(recoveryState(incident({ recovery: requested }), { ...resumed, generation: 1 }, now)).toBe("acknowledged")
    expect(recoveryState(incident({ recovery: requested }), { ...resumed, progress: { ...resumed.progress!, sequence: 8 } }, now)).toBe("acknowledged")
    expect(recoveryState(incident({ recovery: requested }), { ...resumed, progress: { ...resumed.progress!, at: "2026-10-17T17:24:59Z" } }, now)).toBe("acknowledged")
    expect(recoveryState(incident({ progress_sequence: null }), resumed, now)).toBe("not_recorded")
  })
  it("keeps an observed terminal result distinct from Work acceptance and rejects invalid ACK ordering", () => {
    expect(recoveryState(incident({ recovery: requested }), observation({ terminal: { at: "2026-10-17T17:29:00Z", state: "failed", evidence_ref: "terminal-receipt" } }), now)).toBe("terminal_observed")
    expect(recoveryState(incident({ recovery: { acknowledged_at: requested.acknowledged_at } }), observation(), now)).toBe("unconfirmed")
    expect(recoveryState(incident({ recovery: { ...requested, acknowledged_at: "2026-10-17T17:24:00Z" } }), observation(), now)).toBe("unconfirmed")
  })
})
