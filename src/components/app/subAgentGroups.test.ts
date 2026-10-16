import { expect, it } from "vitest"
import type { Message } from "@shared/types/chatMessages"
import { groupSubAgents } from "./subAgentGroups"
const call = (id: string, toolName = "sub_agent", action = "create"): Message => ({
  id, role: "assistant", type: "tool_call", createdAt: "", toolCalls: [{ toolCallId: id, toolName, parameters: { action } }],
})
const result = (id: string, child = "child", extra: Record<string, unknown> = {}): Message => ({
  id: `${id}-result`, role: "assistant", type: "tool_result", createdAt: "", toolCallId: id, toolName: "sub_agent", isError: false,
  result: { tool_name: "sub_agent", result: JSON.stringify({ child_session_id: child, ...extra }), display_preference: "Default" },
})
it("keeps the first verified creation, ignoring later waits, reuses and duplicate results", () => {
  const groups = [{ key: "birth", messages: [call("create"), result("create")] },
    { key: "later", messages: [call("wait", "sub_agent", "wait"), result("wait"), call("reuse"), result("reuse", "child", { reused: true }), result("create")] }]
  expect([...groupSubAgents(groups, { child: { status: "running" } }).byOrigin.keys()]).toEqual(["birth"])
  expect([...groupSubAgents(groups, { child: { status: "completed" } }).byOrigin.keys()]).toEqual(["birth"])
})
it.each(["Task", "TaskList", "spawn", "sub_agent_inspect"])("does not infer provenance from a %s tool name", (name) => {
  const view = groupSubAgents([{ key: "wrong", messages: [call("x", name), result("x")] }], { child: {} })
  expect(view.byOrigin.size).toBe(0); expect(Object.keys(view.unplaced)).toEqual(["child"])
})
it("rejects unmatched, failed, malformed, reused-only and arbitrary user text", () => {
  const failed = result("bad"); failed.isError = true
  const groups = [{ key: "wrong", messages: [result("missing"), call("bad"), failed, call("reused"), result("reused", "child", { reused: true }),
    { id: "spoof", role: "user", content: JSON.stringify({ child_session_id: "child" }), createdAt: "" } as Message,
    call("malformed"), { ...result("malformed"), result: { tool_name: "sub_agent", result: "partial{", display_preference: "Default" } } as Message] }]
  expect(groupSubAgents(groups, { child: {} }).byOrigin.size).toBe(0)
})
