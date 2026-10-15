import { describe, expect, it } from "vitest"
import { hasExecutedPermissionCommand } from "../e2e/support/permissionEvidence.ts"

const expected = { toolCallId: "fixture-call", command: "printf 'fixture-marker'", marker: "fixture-marker" }
const fixture = () => [
  { role: "assistant", tool_calls: [{ id: expected.toolCallId, type: "function", function: {
    name: "exec_command", arguments: JSON.stringify({ cmd: expected.command, yield_time_ms: 10000 }),
  } }] },
  { role: "tool", tool_call_id: expected.toolCallId, tool_success: true,
    content: JSON.stringify({ status: "completed", output: expected.marker, exit_code: 0 }) },
]
const changePayload = (history, change) => {
  history[1].content = JSON.stringify({ ...JSON.parse(history[1].content), ...change })
}

describe("actual canonical permission-command evidence", () => {
  it("accepts the exact call followed by its completed zero-exit output", () => {
    expect(hasExecutedPermissionCommand(fixture(), expected)).toBe(true)
  })

  it.each([
    ["approval placeholder", { status: "awaiting_permission_approval", resource: expected.command }],
    ["running session", { status: "running", session_id: "owned-session" }],
    ["retained session", { session_id: "owned-session" }],
    ["command failure", { exit_code: 1 }],
    ["killed command", { status: "killed" }],
    ["capture error", { error: "output capture failed" }],
    ["truncated output", { output_omitted_bytes: 1 }],
    ["different stdout", { output: "unrelated" }],
    ["command text alone", { output: expected.command }],
  ])("rejects %s even when the marker/exit fields look successful", (_name, change) => {
    const history = fixture(); changePayload(history, change)
    expect(hasExecutedPermissionCommand(history, expected)).toBe(false)
  })

  it.each([
    ["missing call", (h) => h.splice(0, 1)],
    ["missing result", (h) => h.pop()],
    ["duplicate call", (h) => h.unshift(structuredClone(h[0]))],
    ["duplicate result", (h) => h.push(structuredClone(h[1]))],
    ["result before call", (h) => h.reverse()],
    ["foreign result", (h) => { h[1].tool_call_id = "foreign" }],
    ["foreign call", (h) => { h[0].tool_calls[0].id = "foreign" }],
    ["failed tool transport", (h) => { h[1].tool_success = false }],
    ["legacy tool name", (h) => { h[0].tool_calls[0].function.name = "Bash" }],
    ["wrong command", (h) => { h[0].tool_calls[0].function.arguments = JSON.stringify({ cmd: "other", yield_time_ms: 10000 }) }],
    ["extra command parameter", (h) => { h[0].tool_calls[0].function.arguments = JSON.stringify({ cmd: expected.command, yield_time_ms: 10000, interactive: true }) }],
    ["malformed arguments", (h) => { h[0].tool_calls[0].function.arguments = "{" }],
    ["malformed result", (h) => { h[1].content = "{" }],
  ])("rejects %s", (_name, change) => {
    const history = fixture(); change(history)
    expect(hasExecutedPermissionCommand(history, expected)).toBe(false)
  })

  it.each([null, {}, [], [null], ["untrusted text"]])("rejects malformed history %j", (history) => {
    expect(hasExecutedPermissionCommand(history, expected)).toBe(false)
  })
})
