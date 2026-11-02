import { afterEach, expect, it } from "vitest"
import type { Message } from "@shared/types/chatMessages"
import { renderProbe } from "@/lib/renderProbe"
import { collectSubAgentOrigins, groupSubAgents, placeSubAgents } from "./subAgentGroups"
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

const compactCall = (id: string, parameters: unknown = { message: "bounded assignment" }): Message => ({
  id, role: "assistant", type: "tool_call", createdAt: "", toolCalls: [{ toolCallId: id, toolName: "SubAgent", parameters: parameters as Record<string, unknown> }],
})
const actorResult = (id: string, child = "child", extra: Record<string, unknown> = {}): Message => ({
  id: `${id}-result`, role: "assistant", type: "tool_result", createdAt: "", toolCallId: id, toolName: "SubAgent", isError: false,
  result: { tool_name: "SubAgent", result: JSON.stringify({ actor_id: child, ...extra }), display_preference: "Default" },
})
it.each([
  { message: "bounded assignment" },
  { intent: "chat", message: "bounded assignment" },
  { intent: "chat", role: "explorer", message: "bounded assignment" },
  { target: "", role: "", reply_to: "", message: "bounded assignment" },
  { target: null, role: null, reply_to: null, message: "bounded assignment" },
  { intent: "chat", target: "", role: "explorer", reply_to: null, message: "bounded assignment" },
])("anchors compact creation at its matched actor_id result (%j)", (parameters) => {
  const view = groupSubAgents([{ key: "birth", messages: [compactCall("new", parameters), actorResult("new")] }], { child: { status: "completed" } })
  expect(Object.keys(view.byOrigin.get("birth") ?? {})).toEqual(["child"])
  expect(view.unplaced).toEqual({})
})
it.each([
  { intent: "chat", target: "existing", message: "correction" },
  { intent: "inspect", message: "tree" },
  { intent: "control", target: "existing", message: "retry" },
  { intent: "ask_parent", message: "question" },
  { reply_to: "parent-request", message: "answer" },
  { message: "" }, { message: "   " },
  { prompt: "legacy without explicit create" },
  { message: "task", unknown: true },
  null, [], "invalid parameters",
])("does not infer compact creation from a non-create or malformed call (%j)", (parameters) => {
  const view = groupSubAgents([{ key: "not-birth", messages: [compactCall("other", parameters), actorResult("other")] }], { child: {} })
  expect(view.byOrigin.size).toBe(0); expect(Object.keys(view.unplaced)).toEqual(["child"])
})
it("keeps the first compact creation across later target chat, reuse and duplicate results", () => {
  const groups = [{ key: "birth", messages: [compactCall("new"), actorResult("new")] },
    { key: "later", messages: [compactCall("correction", { target: "child", message: "continue" }), actorResult("correction"), actorResult("new"), call("reuse"), result("reuse", "child", { reused: true })] }]
  expect([...groupSubAgents(groups, { child: { status: "running" } }).byOrigin.keys()]).toEqual(["birth"])
  expect([...groupSubAgents(groups, { child: { status: "completed" } }).byOrigin.keys()]).toEqual(["birth"])
})
it("requires the matching legacy/compact result shape and preserves failed or unmatched origins", () => {
  const failed = actorResult("failed"); failed.isError = true
  const groups = [{ key: "not-birth", messages: [compactCall("compact"), result("compact"), call("legacy"), actorResult("legacy"),
    actorResult("unmatched"), compactCall("failed"), failed, compactCall("reused"), actorResult("reused", "child", { reused: true })] }]
  expect(groupSubAgents(groups, { child: {} }).byOrigin.size).toBe(0)
})

afterEach(() => { renderProbe.disable(); renderProbe.reset() })

it("parses a create result once no matter how often the transcript is re-scanned", () => {
  renderProbe.enable(); renderProbe.reset()
  const groups = [{ key: "birth", messages: [call("create"), result("create")] }]
  expect(collectSubAgentOrigins(groups)).toEqual([{ key: "birth", id: "child" }])
  const parsedOnce = renderProbe.read()["subagent.origins.parse"]
  collectSubAgentOrigins(groups)
  collectSubAgentOrigins(groups)
  expect(renderProbe.read()["subagent.origins.parse"]).toBe(parsedOnce)
  expect(renderProbe.read()["subagent.origins.cache-hit"]).toBe(2)
})

it("re-parses when a streamed result grows instead of trusting the cached row", () => {
  renderProbe.enable(); renderProbe.reset()
  const streamed = result("create")
  expect(collectSubAgentOrigins([{ key: "birth", messages: [call("create"), streamed] }]))
    .toEqual([{ key: "birth", id: "child" }])
  // The same message object grows in place, exactly like a streamed result.
  ;(streamed as unknown as { result: unknown }).result =
    { tool_name: "sub_agent", result: JSON.stringify({ child_session_id: "grown" }), display_preference: "Default" }
  expect(collectSubAgentOrigins([{ key: "birth", messages: [call("create"), streamed] }]))
    .toEqual([{ key: "birth", id: "grown" }])
  expect(renderProbe.read()["subagent.origins.parse"]).toBe(2)
})

it("derives candidates from the transcript alone and lets agents decide placement", () => {
  const groups = [{ key: "birth", messages: [call("create"), result("create")] }]
  const candidates = collectSubAgentOrigins(groups)
  // Re-deriving must not depend on any child-state map.
  expect(collectSubAgentOrigins(groups)).toEqual(candidates)
  expect(placeSubAgents(candidates, { child: { status: "running" } }).byOrigin.get("birth")).toEqual({ child: { status: "running" } })
  // An id the index does not know yet stays out of every group.
  expect(placeSubAgents(candidates, {}).byOrigin.size).toBe(0)
  expect(placeSubAgents(candidates, {})).toEqual(groupSubAgents(groups, {}))
})
