import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { SprintSummary, SprintView, SprintWorkVersion } from "@services/tickets/sprints"
import { formatSprintUtcDateTime, parseSprintUtcDateTime, SprintOwnerControls, type SprintOwnerControlsProps } from "./SprintOwnerControls"
import { sprintOwnerControlsEnglish as copy } from "./SprintOwnerControls.copy"
import { sprintOwnerControlsChinese } from "@/test/fixtures/sprintOwnerCopy"

let root: Root
const render = async (props: SprintOwnerControlsProps) => act(async () => root.render(<SprintOwnerControls {...props} />))
const button = (label: string) => [...document.querySelectorAll("button")].find((element) => element.textContent === label)!
const field = (label: string) => [...document.querySelectorAll("label")].find((element) => element.querySelector("span")?.textContent === label)!.querySelector("input,textarea,select") as HTMLInputElement
const value = async (element: HTMLInputElement | HTMLSelectElement, next: string) => act(async () => {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, next)
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }))
})
const click = async (label: string) => act(async () => button(label).click())
const submit = () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
const version = (state: SprintWorkVersion["state"] = "active", accepted = false): SprintWorkVersion => ({
  record_revision: 2, contract_revision: 1, generation: 1, state, blocked_resume_state: null,
  paused: false, archived: false, current_submission: null, accepted_submission: null,
  active_assignment: state === "active" ? "assignment-a" : null, context_hash: null, accepted,
})
const summary = (id = "next-sprint", revision = 2, status: SprintSummary["status"] = "planned", projectId = "project-a"): SprintSummary => ({
  id, project_id: projectId, definition: { name: id, goal: "Reviewed Work", starts_at: null, ends_at: null }, status,
  revision, created_seq: 1, updated_seq: 5, member_count: 0, closure_counts: null,
})
function view(status: SprintSummary["status"] = "active", states: Record<string, SprintWorkVersion> = { "work-a": version() }): SprintView {
  return {
    sprint: { id: "sprint-a", project_id: "project-a", definition: { name: "Sprint A", goal: "Ship reviewed Work", starts_at: null, ends_at: null },
      status, revision: 3, created_seq: 1, updated_seq: 5, members: Object.keys(states), history: [], closure: null },
    current_members: states,
    current_counts: { total: Object.keys(states).length, accepted: 0, cancelled: 0, unfinished: Object.keys(states).length, blocked: 0, pending_acceptance: 0 },
  }
}
function props(changes: Partial<SprintOwnerControlsProps> = {}): SprintOwnerControlsProps {
  return { projectId: "project-a", view: view(), sprints: [summary()], canWrite: true, busy: false,
    request: null, copy, onCommand: vi.fn().mockResolvedValue(undefined), onReconcile: vi.fn().mockResolvedValue(undefined),
    onReviewLatest: vi.fn(), ...changes }
}
const selectDestination = async (workId: string, destination: string) => value(field(`${copy.destination}: ${workId}`) as unknown as HTMLSelectElement, destination)

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.body.replaceChildren()
  root = createRoot(document.body.appendChild(document.createElement("div")))
})
afterEach(() => act(() => root?.unmount()))

it("creates one stable Sprint with explicit nullable dates, without claiming a lifecycle change", async () => {
  const current = props({ view: null })
  await render(current)
  await value(field(copy.name), "Sprint B")
  await value(field(copy.goal), "Review existing Work")
  await act(async () => { submit(); submit() })
  expect(current.onCommand).toHaveBeenCalledOnce()
  expect(current.onCommand).toHaveBeenCalledWith(expect.stringMatching(/^[a-f\d-]{36}$/i), {
    op: "create", definition: { name: "Sprint B", goal: "Review existing Work", starts_at: null, ends_at: null },
  })
  expect(document.body.textContent).toContain(copy.unknown)
  expect(document.body.textContent).toContain(copy.receiptHelp)
  expect(button(copy.create).disabled).toBe(true)
  expect(button(copy.reconcile)).toBeTruthy()
  expect(document.body.textContent).not.toContain(copy.closedReadOnly)
})

it("preserves a create UUID and draft after a conflict; review never retries the rejected CAS", async () => {
  const current = props({ view: null })
  await render(current)
  await value(field(copy.name), "My preserved draft")
  await value(field(copy.goal), "Keep this goal")
  await click(copy.create)
  const firstId = vi.mocked(current.onCommand).mock.calls[0][0]
  current.request = { status: "conflict", message: "scope changed" }
  await render(current)
  expect(field(copy.name).value).toBe("My preserved draft")
  expect(document.body.textContent).toContain(copy.conflict)
  expect(button(copy.reconcile)).toBeUndefined()
  await click(copy.reviewLatest)
  expect(current.onReviewLatest).toHaveBeenCalledOnce()
  expect(current.onCommand).toHaveBeenCalledOnce()
  current.request = null
  await render(current)
  await click(copy.create)
  expect(vi.mocked(current.onCommand).mock.calls[1][0]).toBe(firstId)
  expect(vi.mocked(current.onCommand).mock.calls[1][1]).toMatchObject({ definition: { name: "My preserved draft", goal: "Keep this goal" } })
})

it("generates a fresh Sprint ID only after a committed create and explicit review for another Sprint", async () => {
  const current = props({ view: null })
  await render(current)
  await value(field(copy.name), "Another planning iteration")
  await value(field(copy.goal), "Keep the reviewed draft")
  await click(copy.create)
  const firstId = vi.mocked(current.onCommand).mock.calls[0][0]
  current.request = { status: "committed", operationId: "create-operation-a", committedSeq: 8 }
  await render(current)
  expect(button(copy.create).disabled).toBe(true)
  await click(copy.reviewLatest)
  expect(current.onReviewLatest).toHaveBeenCalledOnce()
  expect(current.onCommand).toHaveBeenCalledOnce()
  expect(field(copy.name).value).toBe("Another planning iteration")
  current.request = null
  await render(current)
  await click(copy.create)
  const nextId = vi.mocked(current.onCommand).mock.calls[1][0]
  expect(nextId).toMatch(/^[a-f\d-]{36}$/i)
  expect(nextId).not.toBe(firstId)
})

it("edits against the original displayed revision and leaves authoritative data unchanged", async () => {
  const current = props()
  await render(current)
  expect(button(copy.save).disabled).toBe(true)
  await value(field(copy.goal), "An explicitly reviewed goal")
  await click(copy.save)
  expect(current.onCommand).toHaveBeenCalledExactlyOnceWith("sprint-a", {
    op: "edit", expected_revision: 3,
    definition: { name: "Sprint A", goal: "An explicitly reviewed goal", starts_at: null, ends_at: null },
  })
  expect(current.view!.sprint.definition.goal).toBe("Ship reviewed Work")
  expect(current.view!.sprint.status).toBe("active")
})

it("uses native second-precision UTC dates and sends the exact selected instants", async () => {
  const current = props()
  await render(current)
  expect(field(copy.startsAt).type).toBe("datetime-local")
  expect(field(copy.endsAt).step).toBe("1")
  expect(copy.startsAt).toContain("UTC")
  expect(copy.endsAt).toContain("UTC")
  await value(field(copy.startsAt), "2026-10-18T09:10:11")
  await value(field(copy.endsAt), "2026-10-19T10:11:12")
  await click(copy.save)
  expect(current.onCommand).toHaveBeenCalledExactlyOnceWith("sprint-a", {
    op: "edit", expected_revision: 3,
    definition: { name: "Sprint A", goal: "Ship reviewed Work", starts_at: 1792314611, ends_at: 1792404672 },
  })
  expect(document.body.textContent).toContain(copy.datesHelp)
})

it.each([
  -1, 0, 1, -62135596800, 1792314611, 253402300799,
])("preserves exact prefilling and API values when editing an unrelated field at %s seconds", async (seconds) => {
  const current = props()
  current.view!.sprint.definition.starts_at = seconds
  await render(current)
  expect(parseSprintUtcDateTime(field(copy.startsAt).value)).toBe(seconds)
  expect(formatSprintUtcDateTime(seconds)).toBeDefined()
  expect(button(copy.save).disabled).toBe(true)
  await value(field(copy.goal), "Only the goal changed")
  await click(copy.save)
  expect(current.onCommand).toHaveBeenCalledExactlyOnceWith("sprint-a", {
    op: "edit", expected_revision: 3,
    definition: { name: "Sprint A", goal: "Only the goal changed", starts_at: seconds, ends_at: null },
  })
})

it("round-trips negative and zero timestamps through edited native date fields", async () => {
  const current = props()
  current.view!.sprint.definition.starts_at = -1
  current.view!.sprint.definition.ends_at = 0
  await render(current)
  expect(parseSprintUtcDateTime(field(copy.startsAt).value)).toBe(-1)
  expect(parseSprintUtcDateTime(field(copy.endsAt).value)).toBe(0)
  await value(field(copy.startsAt), "1969-12-31T23:59:58")
  await value(field(copy.startsAt), "1969-12-31T23:59:59")
  await value(field(copy.goal), "Preserve both instants")
  await click(copy.save)
  expect(current.onCommand).toHaveBeenCalledExactlyOnceWith("sprint-a", expect.objectContaining({
    definition: { name: "Sprint A", goal: "Preserve both instants", starts_at: -1, ends_at: 0 },
  }))
})

it.each([Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, -62167219200, 253402300800])("preserves an undisplayable backend time %s without silently clearing or rounding it", async (seconds) => {
  const current = props()
  current.view!.sprint.definition.starts_at = seconds
  await render(current)
  expect(formatSprintUtcDateTime(seconds)).toBeUndefined()
  expect(field(copy.startsAt).value).toBe("")
  await value(field(copy.goal), "Keep the original date")
  await click(copy.save)
  expect(current.onCommand).toHaveBeenCalledExactlyOnceWith("sprint-a", expect.objectContaining({
    definition: { name: "Sprint A", goal: "Keep the original date", starts_at: seconds, ends_at: null },
  }))
})

it.each([0, Number.MAX_SAFE_INTEGER])("clears an existing date %s only with the explicit clear action", async (seconds) => {
  const current = props()
  current.view!.sprint.definition.starts_at = seconds
  await render(current)
  expect(button(copy.clearStart).disabled).toBe(false)
  await click(copy.clearStart)
  await click(copy.save)
  expect(current.onCommand).toHaveBeenCalledExactlyOnceWith("sprint-a", expect.objectContaining({
    definition: { name: "Sprint A", goal: "Ship reviewed Work", starts_at: null, ends_at: null },
  }))
})

it("does not turn a manually emptied or partial native field into null", async () => {
  const current = props()
  current.view!.sprint.definition.starts_at = 0
  await render(current)
  await value(field(copy.startsAt), "")
  await act(async () => submit())
  expect(field(copy.startsAt).getAttribute("aria-invalid")).toBe("true")
  expect(button(copy.save).disabled).toBe(true)
  expect(current.onCommand).not.toHaveBeenCalled()
  await click(copy.clearStart)
  await click(copy.save)
  expect(current.onCommand).toHaveBeenCalledOnce()
  expect(vi.mocked(current.onCommand).mock.calls[0][1]).toMatchObject({ definition: { starts_at: null } })
})

it.each(["2026-02-30T09:00:00", "2026-10-18T12:30:00.5", "2026-10-18T12", "2026-13-01T00:00:00"])("blocks native invalid/partial input %s without silently clearing the saved date", async (input) => {
  const current = props()
  current.view!.sprint.definition.starts_at = 0
  await render(current)
  await value(field(copy.startsAt), input)
  await act(async () => submit())
  expect(button(copy.save).disabled).toBe(true)
  expect(current.onCommand).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(copy.invalidDefinition)
})

it("rejects reversed UTC dates while preserving the draft", async () => {
  const current = props()
  await render(current)
  await value(field(copy.startsAt), "2026-10-19T10:00:01")
  await value(field(copy.endsAt), "2026-10-19T10:00:00")
  await act(async () => submit())
  expect(button(copy.save).disabled).toBe(true)
  expect(parseSprintUtcDateTime(field(copy.startsAt).value)).toBe(1792404001)
  expect(current.onCommand).not.toHaveBeenCalled()
})

it.each(["", "2026-02-30T09:00:00", "1900-02-29T00:00:00", "2026-13-01T00:00:00", "2026-01-01T24:00:00",
  "2026-01-01T00:00:60", "0000-01-01T00:00:00", "2026-10-18T00:00:00.5", "2026-10-18T00:00:00Z",
  "2026-10-18", "2026-10-18T10:00:00+08:00"])("rejects calendar normalization or non-UTC-control input %s", (input) => {
  expect(parseSprintUtcDateTime(input)).toBeUndefined()
})

it("interprets local DST gap/overlap labels as UTC and preserves early years without the 1900 shortcut", () => {
  expect(formatSprintUtcDateTime(parseSprintUtcDateTime("2026-03-08T02:30:00")!)).toBe("2026-03-08T02:30:00")
  expect(formatSprintUtcDateTime(parseSprintUtcDateTime("2026-11-01T01:30:00")!)).toBe("2026-11-01T01:30:00")
  expect(formatSprintUtcDateTime(parseSprintUtcDateTime("0099-02-28T10:11:12")!)).toBe("0099-02-28T10:11:12")
  expect(formatSprintUtcDateTime(parseSprintUtcDateTime("2000-02-29T10:11:12")!)).toBe("2000-02-29T10:11:12")
  expect(parseSprintUtcDateTime("1970-01-01T00:00:01.000")).toBe(1)
})

it("validates UTF-8 byte bounds and nonblank definitions", async () => {
  const current = props()
  await render(current)
  for (const name of [" ", "界".repeat(86)]) {
    await value(field(copy.name), name)
    expect(button(copy.save).disabled).toBe(true)
  }
  await value(field(copy.name), "界".repeat(85))
  expect(button(copy.save).disabled).toBe(false)
  await value(field(copy.goal), "界".repeat(1366))
  expect(button(copy.save).disabled).toBe(true)
  expect(current.onCommand).not.toHaveBeenCalled()
})

it.each([{ canWrite: false }, { busy: true }, { projectId: "another-project" }])("blocks unavailable authority, busy reads and a foreign Project (%j)", async (change) => {
  const current = props(change)
  await render(current)
  await act(async () => submit())
  expect(button(copy.save).disabled).toBe(true)
  expect(button(copy.add).disabled).toBe(true)
  expect(button(copy.close).disabled).toBe(true)
  expect(current.onCommand).not.toHaveBeenCalled()
})

it("makes closed Sprint planning read only", async () => {
  const current = props({ view: view("closed") })
  await render(current)
  expect(document.body.textContent).toContain(copy.closedReadOnly)
  expect(document.querySelectorAll("input,textarea,select,form")).toHaveLength(0)
  expect(current.onCommand).not.toHaveBeenCalled()
})

it("starts only a planned Sprint when this Project has no other known active Sprint", async () => {
  const current = props({ view: view("planned"), sprints: [summary("other-active", 2, "active")] })
  await render(current)
  expect(button(copy.start).disabled).toBe(true)
  await click(copy.start)
  expect(current.onCommand).not.toHaveBeenCalled()
  current.sprints = [summary("foreign-active", 1, "active", "foreign-project")]
  await render(current)
  await click(copy.start)
  expect(current.onCommand).toHaveBeenCalledExactlyOnceWith("sprint-a", { op: "start", expected_revision: 3 })
  expect(current.view!.sprint.status).toBe("planned")
})

it.each(["add", "remove"] as const)("sends only a canonical existing Work ID for %s", async (op) => {
  const current = props()
  await render(current)
  await value(field(copy.workId), op === "add" ? "work-b" : "work-a")
  await click(copy[op])
  expect(current.onCommand).toHaveBeenCalledExactlyOnceWith("sprint-a", {
    op, expected_revision: 3, work_id: op === "add" ? "work-b" : "work-a",
  })
  expect(document.body.textContent).toContain(copy.workIdHelp)
})

it("requires a nonblank canonical Work ID and known source membership for removal", async () => {
  const current = props()
  await render(current)
  for (const workId of ["", " work-a", "work-a ", " "]) {
    await value(field(copy.workId), workId)
    expect(button(copy.add).disabled).toBe(true)
    expect(button(copy.remove).disabled).toBe(true)
  }
  await value(field(copy.workId), "work-b")
  expect(button(copy.remove).disabled).toBe(true)
  await value(field(copy.workId), "work-a")
  expect(button(copy.add).disabled).toBe(true)
  expect(current.onCommand).not.toHaveBeenCalled()
})

it("requires explicit dispositions for Active, Submitted, Blocked and unverified accepted state; excludes accepted evidence and cancellation", async () => {
  const current = props({ view: view("active", {
    "work-active": version("active"), "work-submitted": version("submitted"), "work-blocked": version("blocked"),
    "work-unverified": version("accepted", false), "work-accepted": version("accepted", true), "work-cancelled": version("cancelled"),
  }) })
  await render(current)
  expect(document.querySelectorAll("select")).toHaveLength(4)
  expect([...document.querySelectorAll("select")].every((select) => select.value === "")).toBe(true)
  expect(button(copy.close).disabled).toBe(true)
  for (const workId of ["work-active", "work-submitted", "work-blocked"]) await selectDestination(workId, "backlog")
  expect(button(copy.close).disabled).toBe(true)
  await selectDestination("work-unverified", "backlog")
  await click(copy.close)
  expect(current.onCommand).toHaveBeenCalledExactlyOnceWith("sprint-a", {
    op: "close", expected_revision: 3, target_revisions: {}, dispositions: {
      "work-active": { destination: "backlog" }, "work-submitted": { destination: "backlog" },
      "work-blocked": { destination: "backlog" }, "work-unverified": { destination: "backlog" },
    },
  })
  expect(document.body.textContent).toContain(copy.closeHelp)
})

it("sends the exact distinct target revisions and no dispositions for terminal members", async () => {
  const current = props({ view: view("active", { a: version(), b: version("submitted"), c: version("blocked"), d: version("cancelled") }) })
  await render(current)
  await selectDestination("a", "sprint:next-sprint")
  await selectDestination("b", "sprint:next-sprint")
  await selectDestination("c", "backlog")
  await click(copy.close)
  expect(current.onCommand).toHaveBeenCalledExactlyOnceWith("sprint-a", {
    op: "close", expected_revision: 3, target_revisions: { "next-sprint": 2 }, dispositions: {
      a: { destination: "sprint", sprint_id: "next-sprint" }, b: { destination: "sprint", sprint_id: "next-sprint" }, c: { destination: "backlog" },
    },
  })
})

it("offers only other open same-Project Sprints as explicit carry-forward targets", async () => {
  const current = props({ sprints: [summary("sprint-a"), summary("next-planned"), summary("next-active", 3, "active"),
    summary("old-closed", 4, "closed"), summary("foreign", 2, "planned", "another-project")] })
  await render(current)
  expect([...document.querySelectorAll("select option")].map((option) => option.getAttribute("value"))).toEqual(["", "backlog", "sprint:next-planned", "sprint:next-active"])
  expect((document.querySelector("select") as HTMLSelectElement).value).toBe("")
})

it("requires complete inspect observations and never infers a missing member as terminal", async () => {
  const current = props()
  current.view!.sprint.members.push("missing-work")
  await render(current)
  expect(button(copy.close).disabled).toBe(true)
  expect(document.body.textContent).toContain(copy.incompleteInspect)
  await click(copy.close)
  expect(current.onCommand).not.toHaveBeenCalled()
})

it("closes an empty active Sprint with explicit empty disposition maps", async () => {
  const current = props({ view: view("active", {}) })
  await render(current)
  await click(copy.close)
  expect(current.onCommand).toHaveBeenCalledExactlyOnceWith("sprint-a", {
    op: "close", expected_revision: 3, dispositions: {}, target_revisions: {},
  })
})

it("keeps opaque canonical Work IDs as own payload keys", async () => {
  const current = props({ view: view("active", Object.fromEntries([["__proto__", version()], ["constructor", version("submitted")]])) })
  await render(current)
  await selectDestination("__proto__", "backlog")
  await selectDestination("constructor", "sprint:next-sprint")
  await click(copy.close)
  expect(current.onCommand).toHaveBeenCalledOnce()
  const action = vi.mocked(current.onCommand).mock.calls[0][1]
  expect(action.op).toBe("close")
  if (action.op !== "close") throw new Error("Expected close action")
  expect(Object.keys(action.dispositions)).toEqual(["__proto__", "constructor"])
  expect(Object.hasOwn(action.dispositions, "__proto__")).toBe(true)
  expect(action.dispositions["__proto__"]).toEqual({ destination: "backlog" })
  expect(action.target_revisions).toEqual({ "next-sprint": 2 })
})

it("preserves a create draft if secure UUID generation is unavailable", async () => {
  const current = props({ view: null })
  vi.stubGlobal("crypto", { randomUUID: () => { throw new Error("Unavailable") } })
  await render(current)
  await value(field(copy.name), "Preserve name")
  await value(field(copy.goal), "Preserve goal")
  await click(copy.create)
  expect(document.body.textContent).toContain(copy.createIdUnavailable)
  expect(field(copy.name).value).toBe("Preserve name")
  expect(current.onCommand).not.toHaveBeenCalled()
})

it("preserves definition drafts across Sprint revisions and requires explicit review without replay", async () => {
  const current = props()
  await render(current)
  await value(field(copy.goal), "Keep this draft")
  current.view = { ...current.view!, sprint: { ...current.view!.sprint, revision: 4 } }
  await render(current)
  expect(field(copy.goal).value).toBe("Keep this draft")
  expect(button(copy.save).disabled).toBe(true)
  expect(document.body.textContent).toContain(copy.draftStale)
  await act(async () => submit())
  expect(current.onCommand).not.toHaveBeenCalled()
  await click(copy.reviewLatest)
  expect(current.onReviewLatest).toHaveBeenCalledOnce()
  expect(current.onCommand).not.toHaveBeenCalled()
  await click(copy.save)
  expect(current.onCommand).toHaveBeenCalledExactlyOnceWith("sprint-a", expect.objectContaining({ op: "edit", expected_revision: 4 }))
})

it("never silently updates a selected target revision", async () => {
  const current = props()
  await render(current)
  await selectDestination("work-a", "sprint:next-sprint")
  current.sprints = [summary("next-sprint", 3)]
  await render(current)
  expect(button(copy.close).disabled).toBe(true)
  expect(document.body.textContent).toContain(`${copy.targetRevision}: 2`)
  await click(copy.close)
  expect(current.onCommand).not.toHaveBeenCalled()
  await click(copy.reviewLatest)
  expect((document.querySelector("select") as HTMLSelectElement).value).toBe("sprint:next-sprint")
  await click(copy.close)
  expect(current.onCommand).toHaveBeenCalledExactlyOnceWith("sprint-a", expect.objectContaining({ target_revisions: { "next-sprint": 3 } }))
})

it("preserves a conflict draft and has no conflict retry or automatic CAS refresh", async () => {
  const current = props()
  await render(current)
  await value(field(copy.goal), "My conflicting draft")
  current.request = { status: "conflict", message: "HTTP 409" }
  await render(current)
  expect(field(copy.goal).value).toBe("My conflicting draft")
  expect(button(copy.reconcile)).toBeUndefined()
  await act(async () => submit())
  expect(current.onCommand).not.toHaveBeenCalled()
  expect(current.onReviewLatest).not.toHaveBeenCalled()
  await click(copy.reviewLatest)
  expect(current.onReviewLatest).toHaveBeenCalledOnce()
  expect(current.onCommand).not.toHaveBeenCalled()
})

it("guards duplicate commands and reconciles unknown outcomes only through the original parent command", async () => {
  let complete!: () => void
  const current = props({ onCommand: vi.fn(() => new Promise<void>((resolve) => { complete = resolve })) })
  await render(current)
  await selectDestination("work-a", "backlog")
  await act(async () => { button(copy.close).click(); button(copy.close).click() })
  expect(current.onCommand).toHaveBeenCalledOnce()
  expect(document.body.textContent).toContain(copy.submitting)
  await act(async () => complete())
  expect(document.body.textContent).toContain(copy.unknown)
  expect(button(copy.reviewLatest)).toBeUndefined()
  current.request = { status: "unknown", message: "connection lost" }
  await render(current)
  await act(async () => { button(copy.reconcile).click(); button(copy.reconcile).click() })
  expect(current.onReconcile).toHaveBeenCalledOnce()
  expect(current.onCommand).toHaveBeenCalledOnce()
  expect(current.view!.sprint.status).toBe("active")
})

it("treats a callback exception as unknown and does not permit a new command", async () => {
  const current = props({ onCommand: vi.fn().mockRejectedValue(new Error("transport failed after send")) })
  await render(current)
  await value(field(copy.workId), "work-b")
  await click(copy.add)
  expect(document.body.textContent).toContain(copy.unknown)
  expect(button(copy.add).disabled).toBe(true)
  expect(button(copy.reviewLatest)).toBeUndefined()
  await click(copy.reconcile)
  expect(current.onReconcile).toHaveBeenCalledOnce()
  expect(current.onCommand).toHaveBeenCalledOnce()
})

it("labels a committed receipt without changing Work, Sprint or runtime facts", async () => {
  const current = props({ request: { status: "committed", operationId: "planning-op-a", committedSeq: 7 } })
  await render(current)
  expect(document.body.textContent).toContain(`${copy.committed}: planning-op-a · 7`)
  expect(document.body.textContent).toContain(copy.receiptHelp)
  expect(current.view!.sprint.status).toBe("active")
  expect(current.view!.current_members["work-a"].active_assignment).toBe("assignment-a")
  expect(current.onCommand).not.toHaveBeenCalled()
})

it("resets drafts only when changing Project or Sprint identity, and supports the required Chinese copy", async () => {
  const current = props()
  await render(current)
  await value(field(copy.goal), "Old selection draft")
  current.view = { ...current.view!, sprint: { ...current.view!.sprint, id: "another-sprint", definition: { ...current.view!.sprint.definition, goal: "Another Sprint goal" } } }
  await render(current)
  expect(field(copy.goal).value).toBe("Another Sprint goal")
  current.copy = sprintOwnerControlsChinese
  await render(current)
  expect(document.body.textContent).toContain(sprintOwnerControlsChinese.closeHelp)
  expect(Object.keys(sprintOwnerControlsChinese).sort()).toEqual(Object.keys(copy).sort())
})
