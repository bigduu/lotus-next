import { afterEach, describe, expect, it } from "vitest"
import { ApiError } from "../api/errors"
import { beginSessionCompatibilityRead, clearSessionCompatibilityObservations, completeSessionCompatibilityRead,
  decodeSessionExecutionCompatibility, failSessionCompatibilityRead, getSessionCompatibilitySnapshot,
  isSessionExecutionBlocked, observeSessionExecutionConflict, type SessionExecutionCompatibility } from "./sessionExecutionCompatibility"

afterEach(clearSessionCompatibilityObservations)
const report = (status: SessionExecutionCompatibility["status"] = "conflict"): SessionExecutionCompatibility => ({
  session_version: status === "legacy_compatible" ? null : 99, current_session_version: 1, status,
  history_readable: true, execution_allowed: status !== "conflict",
  conflicts: status === "conflict" ? [{ code: "unsupported_session_version", message: "unsupported behavior" }] : [],
})
const refusal = (id = "session-a", value: unknown = report(), code = "session_execution_incompatible", status = 409) =>
  new ApiError("rejected", status, "", JSON.stringify({ session_id: id, error: { type: "conflict", code, message: "unsupported" }, compatibility: value }))
const read = (id: string, value: unknown = report("compatible")) => {
  const generation = beginSessionCompatibilityRead(id)
  completeSessionCompatibilityRead(id, generation, { session: { id, ...(value === undefined ? {} : { execution_compatibility: value }) } })
}

describe("session compatibility report and explicit refusal", () => {
  it.each(["compatible", "legacy_compatible", "conflict"] as const)("decodes %s without deriving policy from version numbers", (status) => {
    const value = report(status)
    expect(decodeSessionExecutionCompatibility(value)).toEqual(value)
    read("session-a", value)
    expect(isSessionExecutionBlocked("session-a")).toBe(status === "conflict")
  })
  it("allows a service-declared compatible version beyond the client and accepts missing-version compatibility", () => {
    read("session-a", { ...report("compatible"), session_version: 12, current_session_version: 14 })
    expect(isSessionExecutionBlocked("session-a")).toBe(false)
    read("session-a", report("legacy_compatible"))
    expect(getSessionCompatibilitySnapshot("session-a").report?.session_version).toBeNull()
    expect(isSessionExecutionBlocked("session-a")).toBe(false)
  })
  it("does not turn missing report/version or an initial read failure into unsupported", () => {
    const generation = beginSessionCompatibilityRead("session-a")
    completeSessionCompatibilityRead("session-a", generation, { session: { id: "session-a" } })
    expect(getSessionCompatibilitySnapshot("session-a")).toMatchObject({ report: null, legacy: true, observed: true })
    failSessionCompatibilityRead("session-b", beginSessionCompatibilityRead("session-b"))
    expect(isSessionExecutionBlocked("session-a")).toBe(false); expect(isSessionExecutionBlocked("session-b")).toBe(false)
  })
  it("blocks missing-version sessions only when a separate actual state conflict is explicit", () => {
    read("session-a", { ...report(), session_version: null, conflicts: [{ code: "unsupported_runtime_state_version", message: "unsupported runtime format" }] })
    expect(isSessionExecutionBlocked("session-a")).toBe(true)
  })
  it.each([null, {}, { ...report(), session_version: -1 }, { ...report(), current_session_version: 1.1 },
    { ...report(), status: "future" }, { ...report(), execution_allowed: true }, { ...report(), history_readable: false },
    { ...report(), conflicts: [{ code: "unsupported_runtime_state_version", message: 42 }] }])("does not fabricate a conflict from malformed report %#", (value) => {
    expect(decodeSessionExecutionCompatibility(value)).toBeNull()
    read("session-a", value); expect(isSessionExecutionBlocked("session-a")).toBe(false)
  })
  it("retains an explicit conflict with unknown codes and long diagnostics without inventing new field limits", () => {
    const value = { ...report(), conflicts: [{ code: "future_" + "x".repeat(160), message: "diagnostic ".repeat(600) }] }
    expect(decodeSessionExecutionCompatibility(value)).toEqual(value)
    read("session-a", value); expect(isSessionExecutionBlocked("session-a")).toBe(true)
  })
  it.each([refusal("other-session"), refusal("session-a", report(), "scope_revision_conflict"),
    refusal("session-a", report(), "session_execution_incompatible", 503), refusal("session-a", report("compatible")), new Error("network")])("keeps unrelated failures distinct %#", (error) => {
    expect(observeSessionExecutionConflict("session-a", error)).toBe(false)
    expect(isSessionExecutionBlocked("session-a")).toBe(false)
  })
  it("a typed refusal beats older compatible reads and affects only its session", () => {
    const earlier = beginSessionCompatibilityRead("session-a")
    expect(observeSessionExecutionConflict("session-a", refusal())).toBe(true)
    completeSessionCompatibilityRead("session-a", earlier, { session: { id: "session-a", execution_compatibility: report("compatible") } })
    expect(isSessionExecutionBlocked("session-a")).toBe(true); expect(isSessionExecutionBlocked("session-b")).toBe(false)
  })
  it("retains confirmed conflict on missing detail, bad identity and read failure; fresh compatible detail recovers", () => {
    observeSessionExecutionConflict("session-a", refusal())
    let generation = beginSessionCompatibilityRead("session-a")
    completeSessionCompatibilityRead("session-a", generation, { session: { id: "session-a" } })
    expect(isSessionExecutionBlocked("session-a")).toBe(true)
    generation = beginSessionCompatibilityRead("session-a")
    completeSessionCompatibilityRead("session-a", generation, { session: { id: "other", execution_compatibility: report("compatible") } })
    expect(isSessionExecutionBlocked("session-a")).toBe(true)
    failSessionCompatibilityRead("session-a", beginSessionCompatibilityRead("session-a"))
    expect(isSessionExecutionBlocked("session-a")).toBe(true)
    read("session-a", report("legacy_compatible")); expect(isSessionExecutionBlocked("session-a")).toBe(false)
  })
  it("clearing memory observations cannot let an old in-flight read overwrite a new one", () => {
    const earlier = beginSessionCompatibilityRead("session-a")
    clearSessionCompatibilityObservations()
    read("session-a", report())
    completeSessionCompatibilityRead("session-a", earlier, { session: { id: "session-a", execution_compatibility: report("compatible") } })
    expect(isSessionExecutionBlocked("session-a")).toBe(true)
  })
})
