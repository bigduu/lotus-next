import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AssignmentHealthPanel, type AssignmentHealthPanelProps } from "./AssignmentHealthPanel"
import { assignmentHealthCopyKeys, type AssignmentAttempt, type AssignmentHealthCopy, type AssignmentObservation, type HealthRead, type PatrolIncident } from "./assignmentHealth"

// Every visible label is injected by the parent's shared i18n adapter.
const copy = Object.fromEntries(assignmentHealthCopyKeys.map((key) => [key, `copy:${key}`])) as AssignmentHealthCopy
const now = Date.parse("2026-10-17T17:30:00Z")
const read = <T,>(value: T): Extract<HealthRead<T>, { status: "available" }> => ({ status: "available", value, updatedAt: "2026-10-17T17:29:59Z", validUntil: "2026-10-17T17:31:00Z" })
const attempt = (extra: Partial<AssignmentAttempt> = {}): AssignmentAttempt => ({
  id: "assignment-current", work_id: "work", generation: 2, authority_epoch: 3, state: "running", workspace: null,
  runtime: { session_id: "session-current", run_id: "run-current" }, ...extra,
})
const observation = (extra: Partial<AssignmentObservation> = {}): AssignmentObservation => ({
  assignment_id: "assignment-current", work_id: "work", generation: 2, authority_epoch: 3,
  session_id: "session-current", run_id: "run-current", execution: "running", heartbeat_at: "2026-10-17T17:29:58Z", ...extra,
})
const incident = (extra: Partial<PatrolIncident> = {}): PatrolIncident => ({
  id: "incident-persisted", assignment_id: "assignment-current", work_id: "work", generation: 2, authority_epoch: 3,
  source_revision: "source-17", evidence_ref: "receipt-17", phase: "open", opened_at: "2026-10-17T17:20:00Z", progress_sequence: 8,
  reason: "No effective progress after repeated tool errors", ...extra,
})
let root: Root
let host: HTMLDivElement
const openSession = vi.fn()
const base = (): AssignmentHealthPanelProps => ({ workId: "work", generation: 2, authorityEpoch: 3, currentAssignmentId: "assignment-current", attempts: read([attempt()]), nowMs: now, locale: "en-US", copy, onOpenSession: openSession })
const render = async (extra: Partial<AssignmentHealthPanelProps> = {}) => { await act(async () => root.render(<AssignmentHealthPanel {...base()} {...extra} />)) }
const content = (testId: string) => host.querySelector(`[data-testid="${testId}"]`)?.textContent ?? ""
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  openSession.mockReset()
})
afterEach(() => { act(() => root.unmount()); host.remove() })

it("shows existing Assignment/receipt refs while unsupported telemetry stays unknown and timestamps stay unrecorded", async () => {
  await render({ attempts: { status: "available", value: [attempt()], updatedAt: null } })
  expect(content("assignment-owner-status")).toBe(copy.confirmed)
  expect(content("assignment-current")).toContain("session-current")
  expect(content("assignment-current")).toContain("run-current")
  expect(content("assignment-execution-status")).toBe(copy.unknown)
  expect(content("assignment-observation-status")).toBe(copy.unsupported)
  expect(content("assignment-patrol")).toContain(copy.patrolUnsupported)
  expect(host.querySelector("time")).toBeNull()
  expect(host.querySelector("button")).toBeNull()
})
it.each(["unsupported", "unknown"] as const)("does not present %s assignment capability as an empty successful read", async (status) => {
  await render({ attempts: { status, reason: "Authoritative read unavailable" } })
  expect(content("assignment-source-status")).toBe(copy[status])
  expect(content("assignment-owner-status")).toBe(copy.ownerUnknown)
  expect(content("assignment-history")).not.toContain(copy.emptyHistory)
  expect(host.textContent).toContain("Authoritative read unavailable")
})
it("downgrades an expired running snapshot to unknown while retaining locatable history refs", async () => {
  await render({ attempts: { ...read([attempt()]), validUntil: "2026-10-17T17:30:00Z" }, observations: read([observation()]) })
  expect(content("assignment-source-status")).toBe(copy.unknown)
  expect(content("assignment-owner-status")).toBe(copy.ownerUnknown)
  expect(content("assignment-execution-status")).toBe(copy.unknown)
  expect(content("assignment-history")).toContain("session-current")
  expect(host.querySelector("time")?.getAttribute("dateTime")).toBe("2026-10-17T17:29:59Z")
})
it("navigates only verified exact sessions and retains denied, missing and unresolved history IDs with reasons", async () => {
  const past = (suffix: string) => attempt({ id: `assignment-${suffix}`, generation: 1, role: "reviewer", runtime: { session_id: `session-${suffix}`, run_id: `run-${suffix}` }, end_reason: "Handed off after review" })
  const attempts = [attempt(), past("denied"), past("missing"), past("unknown")]
  await render({ attempts: read(attempts), sessions: read(attempts.map((item, index) => ({ assignment_id: item.id, ...item.runtime!, access: (["accessible", "denied", "missing", "unknown"] as const)[index] }))) })
  expect(host.querySelectorAll("button")).toHaveLength(1)
  await act(async () => (host.querySelector("button") as HTMLButtonElement).click())
  expect(openSession).toHaveBeenCalledExactlyOnceWith("session-current")
  for (const key of ["sessionDenied", "sessionMissing", "sessionUnknown"] as const) expect(content("assignment-history")).toContain(copy[key])
  expect(content("assignment-history")).toContain("session-denied")
  expect(content("assignment-history")).toContain("session-missing")
  expect(content("assignment-history")).toContain(copy.reviewer)
  expect(content("assignment-history")).toContain("Handed off after review")
  expect(host.querySelector("a")).toBeNull()
})
it("allows an accessible historical session without transferring ownership to collaborators or reviewers", async () => {
  const collaborator = attempt({ id: "collaboration-ref", role: "collaborator", runtime: { session_id: "collaborator-session", run_id: "collaborator-run" } })
  await render({ attempts: read([collaborator, attempt()]), sessions: read([{ assignment_id: collaborator.id, ...collaborator.runtime!, access: "accessible" }]) })
  expect(content("assignment-current")).toContain("session-current")
  expect(content("assignment-current")).not.toContain("collaborator-session")
  expect(content("assignment-history")).toContain(copy.collaborator)
  await act(async () => (host.querySelector("button") as HTMLButtonElement).click())
  expect(openSession).toHaveBeenCalledExactlyOnceWith("collaborator-session")
})
it("updates controlled props without letting a late old-generation heartbeat replace the new owner", async () => {
  const old = attempt({ id: "assignment-old", generation: 1, runtime: { session_id: "session-old", run_id: "run-old" } })
  await render({ attempts: read([old]), currentAssignmentId: old.id, generation: 1 })
  await render({ attempts: read([old, attempt()]), observations: read([observation({ assignment_id: old.id, generation: 1, session_id: "session-old", run_id: "run-old" })]) })
  expect(content("assignment-current")).toContain("session-current")
  expect(content("assignment-current")).not.toContain("session-old")
  expect(content("assignment-execution-status")).toBe(copy.unknown)
  expect(content("assignment-history")).toContain("session-old")
})
it("shows heartbeat, effective progress and expected waiting/tool reasons as separate facts", async () => {
  await render({ observations: read([observation({ execution: "waiting", wait_reason: "Long compilation is still executing", next_check_at: "2026-10-17T17:31:00Z" })]), blockReason: "Waiting for an accepted dependency" })
  expect(content("assignment-execution-status")).toBe(copy.waiting)
  expect(content("assignment-observation")).toContain(copy.heartbeatHint)
  expect(content("assignment-observation")).toContain("Long compilation is still executing")
  expect(content("assignment-observation")).toContain("Waiting for an accepted dependency")
  const metrics = [...host.querySelectorAll("[data-testid='assignment-observation'] dt")]
  expect(metrics.find((element) => element.textContent === copy.progress)?.nextElementSibling?.textContent).toBe(copy.notRecorded)
  expect(metrics.find((element) => element.textContent === copy.heartbeat)?.nextElementSibling?.querySelector("time")?.dateTime).toBe("2026-10-17T17:29:58Z")
})
it("keeps runtime outcome-unknown/cancelling facts unknown despite a running observation", async () => {
  for (const state of ["outcome_unknown", "cancelling"]) {
    await render({ attempts: read([attempt({ state })]), observations: read([observation()]) })
    expect(content("assignment-execution-status")).toBe(copy.unknown)
  }
})
it("rejects cross-Work projections without exposing their session or incident evidence", async () => {
  await render({ attempts: read([attempt({ work_id: "another-work", runtime: { session_id: "hidden-session", run_id: "hidden-run" } })]), incidents: read([incident({ work_id: "another-work", evidence_ref: "hidden-evidence" })]) })
  expect(content("assignment-source-status")).toBe(copy.unknown)
  expect(content("assignment-owner-status")).toBe(copy.ownerUnknown)
  expect(content("assignment-patrol")).toContain(copy.unknown)
  expect(host.textContent).not.toContain("hidden-session")
  expect(host.textContent).not.toContain("hidden-evidence")
  expect(content("assignment-patrol")).not.toContain(copy.noIncidents)
})
it("does not infer process termination from a missing active-assignment reference", async () => {
  await render({ currentAssignmentId: null, attempts: read([attempt({ state: "cancelled" }), attempt({ id: "confirmed-stopped", state: "cancelled", process_stopped: true })]) })
  expect(content("assignment-owner-status")).toBe(copy.noCurrentExecutor)
  expect(content("assignment-current")).toContain(copy.noCurrentHint)
  expect(content("assignment-execution-status")).toBe(copy.unknown)
  expect(content("assignment-history")).toContain(copy.stopUnconfirmed)
  expect(content("assignment-history")).toContain(copy.stoppedConfirmed)
})
it("keeps a persisted incident open after recovery ACK, then displays actual progress without implying acceptance", async () => {
  const value = incident({ recovery: { requested_at: "2026-10-17T17:25:00Z", acknowledged_at: "2026-10-17T17:26:00Z" }, findings: "Same tool error", uncertainty: "Tool effect still needs reconciliation", escalation: "Awaiting orchestrator decision" })
  await render({ observations: read([observation()]), incidents: read([value]) })
  expect(content("assignment-recovery-status")).toBe(copy.acknowledged)
  expect(content("assignment-incident-phase")).toBe(copy.open)
  expect(content("assignment-incident")).toContain(value.uncertainty)
  expect(content("assignment-incident")).toContain(copy.recoveryHint)
  await render({ observations: read([observation({ progress: { sequence: 9, at: "2026-10-17T17:28:00Z", evidence_ref: "real-progress-receipt" } })]), incidents: read([{ ...value, phase: "resolved" }]) })
  expect(content("assignment-recovery-status")).toBe(copy.progress_observed)
  expect(content("assignment-incident-phase")).toBe(copy.resolved)
  expect(content("assignment-incident")).toContain("incident-persisted")
})
it("does not accept old-generation, duplicate, stale or heartbeat-only resolved incidents as current recovery", async () => {
  for (const values of [[incident({ generation: 1, phase: "resolved" })], [incident({ phase: "resolved" })], [incident(), incident()]]) {
    await render({ incidents: read(values), observations: read([observation()]) })
    expect(content("assignment-incident-phase")).toBe(copy.unconfirmed)
    expect(content("assignment-recovery-status")).toBe(copy.unconfirmed)
  }
  await render({ incidents: { ...read([incident({ phase: "resolved" })]), validUntil: "2026-10-17T17:29:00Z" } })
  expect(content("assignment-incident-phase")).toBe(copy.unconfirmed)
})
it("shows a proven failed terminal receipt as a terminal outcome, without calling it progress or acceptance", async () => {
  await render({ incidents: read([incident({ phase: "resolved" })]), observations: read([observation({ terminal: { at: "2026-10-17T17:28:00Z", state: "failed", evidence_ref: "failed-terminal-receipt" } })]) })
  expect(content("assignment-execution-status")).toBe(copy.terminal_observed)
  expect(content("assignment-recovery-status")).toBe(copy.terminal_observed)
  expect(content("assignment-observation")).toContain("failed")
  expect(content("assignment-observation")).toContain("failed-terminal-receipt")
  expect(content("assignment-incident")).toContain(copy.recoveryHint)
})
it("retains same incident identity on remount and performs no transport, timer, model or recovery action", async () => {
  const fetch = vi.spyOn(globalThis, "fetch")
  const interval = vi.spyOn(globalThis, "setInterval")
  await render({ incidents: read([incident()]) })
  act(() => root.unmount())
  root = createRoot(host)
  await render({ incidents: read([incident()]) })
  expect(content("assignment-incident")).toContain("incident-persisted")
  expect(fetch).not.toHaveBeenCalled()
  expect(interval).not.toHaveBeenCalled()
  expect(openSession).not.toHaveBeenCalled()
  expect(host.querySelector("button")).toBeNull()
})
