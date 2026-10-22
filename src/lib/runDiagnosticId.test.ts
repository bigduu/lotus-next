import { describe, expect, it } from "vitest"
import { extractDiagnosticId, isDiagnosticId } from "./runDiagnosticId"

const id = "9ab6cd70-bc43-4fed-9f10-50c2873fa287"
describe("frozen legacy terminal diagnostic marker", () => {
  it.each(["", "Initial request failed. ", "request deadline exceeded.\n"])("extracts only the bounded appended v4 ID after %j", (prefix) => {
    expect(extractDiagnosticId(prefix + "Diagnostic ID: " + id + ".\n")).toBe(id)
  })
  it.each([
    undefined, null, 42, {}, "Automatic retry limit reached after 1 request(s).",
    "Diagnostic ID: " + id.toUpperCase() + ".",
    "Diagnostic ID: " + id.replace("-4fed-", "-7fed-") + ".",
    "Diagnostic ID: " + id.replace("-9f10-", "-7f10-") + ".",
    "Diagnostic ID: " + id, "Diagnostic ID: " + id + ". More text.",
    "Diagnostic ID: not-an-id. Diagnostic ID: " + id + ".",
    "Diagnostic ID: " + id + ". Diagnostic ID: " + id + ".",
    "https://private.invalid/?Diagnostic ID: " + id + ".",
    "Diagnostic ID: " + id + ".\u0000", "x".repeat(16_385) + " Diagnostic ID: " + id + ".",
  ])("ignores absent, malformed, ambiguous or non-terminal marker %j", (value) => {
    expect(extractDiagnosticId(value)).toBeNull()
  })
  it("does not treat a marker ID as an execution or retry instruction", () => {
    expect(isDiagnosticId(id)).toBe(true)
    expect(isDiagnosticId("sk-private-value")).toBe(false)
  })
})
