import { describe, expect, it } from "vitest"
import { commandMatches, deadlineInstant, planningValue, workDeadlineStatus } from "./projectWorkControls"
import { commandContext } from "./testFixtures"

describe("explicit-offset desired deadline", () => {
  it("preserves the original offset and maps clearing only to null", () => {
    expect(planningValue({ priority: "high", expectedCompletionAt: "2026-10-18T01:30:00+08:00" })).toEqual({ priority: "high", expectedCompletionAt: "2026-10-18T01:30:00+08:00" })
    expect(deadlineInstant("2026-10-18T01:30:00+08:00")).toBe(deadlineInstant("2026-10-17T17:30:00Z"))
    expect(planningValue({ priority: "medium", expectedCompletionAt: "  " })).toEqual({ priority: "medium", expectedCompletionAt: null })
  })
  it.each(["2026-10-18T09:00:00", "2026-10-18T09:00:00-00:00", "2026-02-29T00:00:00Z", "2026-02-31T00:00:00Z", "2026-10-18T24:00:00Z", "2026-10-18T09:00:00+24:00", "2026-10-18T09:00:00+08:60", "", "not a date"])("rejects invalid or unknown-zone %s", (value) => {
    expect(deadlineInstant(value)).toBeNull()
  })
  it("handles leap days and sub-millisecond boundaries without wall-clock guesses", () => {
    expect(deadlineInstant("2028-02-29T00:00:00Z")).not.toBeNull()
    expect(workDeadlineStatus("2026-10-18T00:00:00.000000001Z", "2026-10-18T00:00:00.000000002Z", "active")).toBe("overdue")
    expect(workDeadlineStatus("2026-10-18T00:00:00.000000002Z", "2026-10-18T00:00:00.000000002Z", "active")).toBe("within_deadline")
  })
  it("accepts RFC3339 lowercase separators without silently changing the instant", () => {
    expect(deadlineInstant("2026-10-18t00:00:00z")).toBe(deadlineInstant("2026-10-18T00:00:00Z"))
    expect(planningValue({ priority: "medium", expectedCompletionAt: "2026-10-18t00:00:00z" })?.expectedCompletionAt).toBe("2026-10-18t00:00:00z")
  })
  it("distinguishes missing, unset, invalid and unavailable snapshot time", () => {
    expect(workDeadlineStatus(undefined, null, "active")).toBe("unknown")
    expect(workDeadlineStatus(null, null, "active")).toBe("unset")
    expect(workDeadlineStatus("invalid", null, "active")).toBe("invalid")
    expect(workDeadlineStatus("2026-10-18T00:00:00Z", null, "active")).toBe("as_of_unknown")
  })
  it.each(["accepted", "cancelled"] as const)("suppresses active overdue warnings for %s without labelling cancelled done", (state) => {
    expect(workDeadlineStatus("2026-10-17T00:00:00Z", "2026-10-18T00:00:00Z", state)).toBe("terminal")
  })
})
it("requires exact Work generation/revision and real binding/whole-scope CAS", () => {
  const work = { id: "work-1", generation: 3, recordRevision: 8 }
  expect(commandMatches(commandContext(), work)).toBe(true)
  for (const patch of [{ workId: "other" }, { generation: 2 }, { recordRevision: 7 }, { expectedEpoch: 0 }, { expectedSeq: -1 }, { binding: { scope_id: "", supervisor_session_id: "owner", binding_revision: 1 } }]) {
    expect(commandMatches({ ...commandContext(), ...patch }, work)).toBe(false)
  }
})
