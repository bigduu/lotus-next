import { createSignal, flush } from "solid-js"
import { render } from "@solidjs/web"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { changeLocale } from "@shared/i18n/runtime"
import { uiText } from "@shared/i18n/text"
import { apiClient } from "@services/api"
import { readPatrolStatus, type PatrolStatusRead } from "@services/tickets/patrolStatus"
import { readRuntimeObservation, type RuntimeObservationRead } from "@services/tickets/runtimeObservation"
import {
  assignmentHealthCopyKeys, type AssignmentAttempt, type AssignmentHealthCopy, type HealthRead,
} from "@/lib/project-work/assignmentHealth"
import { AssignmentHealthPanel, type AssignmentHealthPanelProps } from "./AssignmentHealthPanel"

const copy = Object.fromEntries(assignmentHealthCopyKeys.map((key) => [key, `copy:${key}`])) as AssignmentHealthCopy
const now = Date.parse("2026-10-17T17:30:00Z")
const read = <T,>(value: T): Extract<HealthRead<T>, { status: "available" }> => ({
  status: "available", value, updatedAt: "2026-10-17T17:29:59Z", validUntil: "2026-10-17T17:31:00Z",
})
const attempt = (extra: Partial<AssignmentAttempt> = {}): AssignmentAttempt => ({
  id: "assignment-current", work_id: "work", generation: 2, authority_epoch: 3, state: "running", workspace: null,
  runtime: { session_id: "session-current", run_id: "run-current" }, ...extra,
})
const target = {
  projectId: "project", workId: "work", assignmentId: "assignment-current", generation: 2, assignmentAuthorityEpoch: 3,
  snapshot: { commit: "commit-10", seq: 10, authority_epoch: 3 },
}
const scope = {
  project_id: target.projectId, work_id: target.workId, assignment_id: target.assignmentId,
  generation: target.generation, authority_epoch: target.assignmentAuthorityEpoch,
}
const signal = () => new AbortController().signal
type RuntimeFacts = Extract<RuntimeObservationRead, { status: "sample" }>["facts"]
const sample = (facts: Partial<RuntimeFacts> = {}): RuntimeObservationRead => ({
  status: "sample", facts: { startedAt: null, heartbeatAt: null, progress: null, wait: null, outcomeUnknown: false, ...facts },
})
type Checkpoint = Extract<PatrolStatusRead, { checkpoint: unknown }>["checkpoint"]
const checkpoint = (incident: Partial<NonNullable<Checkpoint["incident"]>> = {}): Checkpoint => ({
  lastCheck: now - 1000, nextCheck: now + 60_000,
  incident: {
    assignmentId: target.assignmentId, progressSequence: 8, reason: "repeated_errors", phase: "open",
    attempts: 0, lastDiagnosis: null, blockedReason: null, accountingPending: false, escalation: null,
    ...incident,
  },
})
const openSession = vi.fn()
const base = (): AssignmentHealthPanelProps => ({
  workId: target.workId, generation: target.generation, authorityEpoch: target.assignmentAuthorityEpoch,
  currentAssignmentId: target.assignmentId, attempts: read([attempt()]), runtimeObservation: { status: "unknown" },
  patrolStatus: { status: "unsupported" }, sessions: { status: "unknown" }, nowMs: now, locale: "en-US", copy, onOpenSession: openSession,
})

let host: HTMLDivElement
let dispose: () => void
let setProps: (props: AssignmentHealthPanelProps) => void
function mount() {
  const [props, update] = createSignal(base())
  setProps = update
  dispose = render(() => <AssignmentHealthPanel {...props()} />, host)
}
function update(extra: Partial<AssignmentHealthPanelProps> = {}) {
  setProps({ ...base(), ...extra })
  flush()
}
const content = (id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent ?? ""
const metric = (label: string) =>
  [...host.querySelectorAll("[data-testid='assignment-observation'] dt")].find((element) => element.textContent === label)?.nextElementSibling

beforeEach(async () => {
  await changeLocale("en-US")
  host = document.body.appendChild(document.createElement("div"))
  openSession.mockReset()
  mount()
})
afterEach(() => { dispose(); host.remove() })

it("shows exact Assignment/session/run refs with unrecorded timestamps while telemetry is unavailable", () => {
  update({ attempts: { status: "available", value: [attempt()], updatedAt: null }, runtimeObservation: { status: "unavailable" } })
  expect(content("assignment-owner-status")).toBe(copy.confirmed)
  expect(content("assignment-current")).toContain("session-current")
  expect(content("assignment-current")).toContain("run-current")
  expect(metric(copy.heartbeat)?.textContent).toBe(copy.unknown)
  expect(content("assignment-observation-status")).toBe(copy.runtimeUnavailable)
  expect(content("patrol-checkpoint-state")).toBe(uiText("assignment_health_unsupported"))
  expect(host.querySelector("time")).toBeNull()
  expect(host.querySelector("button")).toBeNull()
})

it.each(["unsupported", "unknown"] as const)("does not present %s assignment authority as an empty successful read", (status) => {
  update({ attempts: { status, reason: "Authoritative read unavailable" } })
  expect(content("assignment-source-status")).toBe(copy[status])
  expect(content("assignment-owner-status")).toBe(copy.ownerUnknown)
  expect(content("assignment-history")).not.toContain(copy.emptyHistory)
  expect(host.textContent).toContain("Authoritative read unavailable")
})

it("downgrades an expired assignment snapshot while retaining locatable history", () => {
  update({ attempts: { ...read([attempt()]), validUntil: "2026-10-17T17:30:00Z" } })
  expect(content("assignment-source-status")).toBe(copy.unknown)
  expect(content("assignment-owner-status")).toBe(copy.ownerUnknown)
  expect(metric(copy.heartbeat)?.textContent).toBe(copy.unknown)
  expect(content("assignment-history")).toContain("session-current")
  expect(host.querySelector("time")?.dateTime).toBe("2026-10-17T17:29:59Z")
})

it("navigates only verified exact attempts and retains blocked historical references with reasons", () => {
  const past = (suffix: string) => attempt({ id: `assignment-${suffix}`, generation: 1, role: "reviewer",
    runtime: { session_id: `session-${suffix}`, run_id: `run-${suffix}` }, end_reason: "Handed off after review" })
  const attempts = [attempt(), past("denied"), past("missing"), past("unknown")]
  update({ attempts: read(attempts), sessions: read(attempts.map((item, index) => ({
    assignment_id: item.id, ...item.runtime!, access: (["accessible", "denied", "missing", "unknown"] as const)[index],
  }))) })
  expect(host.querySelectorAll("button")).toHaveLength(1)
  host.querySelector("button")!.click()
  expect(openSession).toHaveBeenCalledExactlyOnceWith({
    assignment_id: "assignment-current", session_id: "session-current", run_id: "run-current",
  })
  for (const key of ["sessionDenied", "sessionMissing", "sessionUnknown"] as const) expect(content("assignment-history")).toContain(copy[key])
  for (const text of ["session-denied", "session-missing", copy.reviewer, "Handed off after review"]) {
    expect(content("assignment-history")).toContain(text)
  }
  expect(host.querySelector("a")).toBeNull()
})

it("allows a verified historical session without transferring current ownership", () => {
  const collaborator = attempt({ id: "collaboration-ref", role: "collaborator",
    runtime: { session_id: "collaborator-session", run_id: "collaborator-run" } })
  update({ attempts: read([collaborator, attempt()]), sessions: read([{ assignment_id: collaborator.id, ...collaborator.runtime!, access: "accessible" }]) })
  expect(content("assignment-current")).toContain("session-current")
  expect(content("assignment-current")).not.toContain("collaborator-session")
  expect(content("assignment-history")).toContain(copy.collaborator)
  host.querySelector("button")!.click()
  expect(openSession).toHaveBeenCalledExactlyOnceWith({ assignment_id: collaborator.id, ...collaborator.runtime! })
})

it("rejects a late old-generation heartbeat while retaining its historical attempt", async () => {
  const old = attempt({ id: "assignment-old", generation: 1, runtime: { session_id: "session-old", run_id: "run-old" } })
  update({ attempts: read([old]), currentAssignmentId: old.id, generation: 1 })
  vi.spyOn(apiClient, "postOnce").mockResolvedValueOnce({
    scope: { ...scope, assignment_id: old.id, generation: 1 }, ticket_commit: target.snapshot.commit,
    state: "observed", started_at_ms: now - 1000, heartbeat_at_ms: now, progress: null, expected_wait: null, execution_outcome_unknown: false,
  })
  const observation = await readRuntimeObservation({ ...target, mode: "active" }, signal())
  expect(observation).toEqual({ status: "unknown" })
  update({ attempts: read([old, attempt()]), runtimeObservation: observation })
  expect(content("assignment-current")).toContain("session-current")
  expect(content("assignment-current")).not.toContain("session-old")
  expect(content("assignment-history")).toContain("session-old")
  expect(metric(copy.heartbeat)?.textContent).toBe(copy.unknown)
})

it("renders heartbeat, progress, waiting and block reasons as independent facts", () => {
  update({ runtimeObservation: sample({
    startedAt: now - 10_000, heartbeatAt: now - 2000,
    wait: { kind: "running_tool", issuedAt: now - 4000, allowanceUntil: now + 60_000 },
  }), blockReason: "Waiting for an accepted dependency" })
  expect(content("assignment-observation")).toContain(copy.heartbeatHint)
  expect(content("assignment-observation")).toContain(copy.running_tool)
  expect(content("assignment-observation")).toContain("Waiting for an accepted dependency")
  expect(metric(copy.progress)?.textContent).toBe(copy.unknown)
  expect(metric(copy.heartbeat)?.querySelector("time")?.dateTime).toBe("2026-10-17T17:29:58.000Z")
})

it("keeps explicit outcome uncertainty separate from runtime progress or acceptance", () => {
  update({ attempts: read([attempt({ state: "outcome_unknown" })]), runtimeObservation: sample({ outcomeUnknown: true }) })
  expect(content("assignment-observation")).toContain(copy.outcomeUnknown)
  expect(metric(copy.progress)?.textContent).toBe(copy.unknown)
  expect(metric(copy.heartbeat)?.textContent).toBe(copy.unknown)
  expect(content("assignment-observation")).not.toContain(copy.terminal_observed)
})

it("rejects cross-Work attempt/Patrol facts without exposing session or incident evidence", async () => {
  vi.spyOn(apiClient, "postOnce").mockResolvedValueOnce({
    scope: { ...scope, work_id: "another-work" }, ticket_commit: target.snapshot.commit, checkpoint: { secret: "hidden-evidence" },
  })
  const patrolStatus = await readPatrolStatus(target, signal())
  update({ attempts: read([attempt({ work_id: "another-work", runtime: { session_id: "hidden-session", run_id: "hidden-run" } })]),
    patrolStatus })
  expect(content("assignment-source-status")).toBe(copy.unknown)
  expect(content("assignment-owner-status")).toBe(copy.ownerUnknown)
  expect(content("patrol-checkpoint-state")).toBe(uiText("assignment_health_unknown"))
  expect(host.textContent).not.toContain("hidden-session")
  expect(host.textContent).not.toContain("hidden-evidence")
  expect(content("assignment-patrol")).not.toContain(uiText("assignment_health_no_incidents"))
})

it("does not infer process termination from a missing active-assignment reference", () => {
  update({ currentAssignmentId: null, attempts: read([attempt({ state: "cancelled" }),
    attempt({ id: "confirmed-stopped", state: "cancelled", process_stopped: true })]) })
  expect(content("assignment-owner-status")).toBe(copy.noCurrentExecutor)
  expect(content("assignment-current")).toContain(copy.noCurrentHint)
  expect(metric(copy.heartbeat)?.textContent).toBe(copy.unknown)
  expect(content("assignment-history")).toContain(copy.stopUnconfirmed)
  expect(content("assignment-history")).toContain(copy.stoppedConfirmed)
})

it("keeps saved Patrol phase independent of heartbeat and observed effective progress", () => {
  update({ patrolStatus: { status: "available", checkpoint: checkpoint({ escalation: {
    reason: "uncertain", deliveries: 1, queued: true, nextDelivery: now,
  } }) }, runtimeObservation: sample({ startedAt: now - 2000, heartbeatAt: now }) })
  expect(content("assignment-patrol")).toContain(uiText("assignment_health_open"))
  expect(content("assignment-patrol")).toContain(uiText("patrol_status_escalation_queued"))
  expect(metric(copy.progress)?.textContent).toBe(copy.unknown)
  update({ patrolStatus: { status: "available", checkpoint: checkpoint() },
    runtimeObservation: sample({ startedAt: now - 2000, heartbeatAt: now, progress: { sequence: 9, at: now - 1000 } }) })
  expect(metric(copy.progressSequence)?.textContent).toBe("9")
  expect(content("assignment-patrol")).toContain(uiText("assignment_health_open"))
  expect(content("assignment-patrol")).not.toContain(uiText("patrol_status_resolved"))
})

it("shows stale Patrol checkpoints as historical and distinguishes unknown from an empty saved record", () => {
  update({ patrolStatus: { status: "stale", checkpoint: checkpoint({ phase: "resolved" }) } })
  expect(content("patrol-checkpoint-state")).toBe(uiText("patrol_status_stale"))
  expect(content("assignment-patrol")).toContain(uiText("patrol_status_historical_hint"))
  expect(content("assignment-patrol")).toContain(target.assignmentId)
  update({ patrolStatus: { status: "unknown" } })
  expect(content("assignment-patrol")).not.toContain(target.assignmentId)
  expect(content("assignment-patrol")).not.toContain(uiText("assignment_health_no_incidents"))
})

it("renders the same saved attempt identity on remount without transport, timers or recovery actions", () => {
  const transport = vi.spyOn(apiClient, "postOnce")
  const fetch = vi.spyOn(globalThis, "fetch")
  const interval = vi.spyOn(window, "setInterval")
  const status: PatrolStatusRead = { status: "available", checkpoint: checkpoint() }
  update({ patrolStatus: status })
  const before = content("assignment-patrol")
  dispose()
  mount()
  update({ patrolStatus: status })
  expect(before).toContain(target.assignmentId)
  expect(content("assignment-patrol")).toBe(before)
  expect(transport).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(interval).not.toHaveBeenCalled()
  expect(openSession).not.toHaveBeenCalled()
  expect(host.querySelector("button")).toBeNull()
})
