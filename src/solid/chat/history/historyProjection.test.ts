import { expect, it } from "vitest"
import { projectCompletedAnswers } from "@/lib/completedAnswerHandoff"
import { uiText } from "@shared/i18n/text"
import { mapHistoryMessagesToUi } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import type { Message } from "@shared/types/chatMessages"
import {
  buildDisplayItems, buildHistoryEntries, buildLiveItems, buildRenderItems,
  collectMessageActions, findRegenerationKey,
} from "./historyProjection"

const at = "2026-11-08T06:50:00Z"

const historyEntries = (raw: Parameters<typeof mapHistoryMessagesToUi>[1]) =>
  buildHistoryEntries(buildDisplayItems(buildRenderItems(mapHistoryMessagesToUi("projection", raw)), true))

it("preserves the exact running tool identity when it has streamed output", () => {
  const items = buildLiveItems([{
    kind: "tools",
    calls: [
      { toolCallId: "still-running", toolName: "Read", output: "partial output", status: "running" },
      { toolCallId: "already-done", toolName: "Read", output: "final output", status: "completed" },
    ],
  }], null, null, true, null, uiText)

  expect(items).toEqual([
    expect.objectContaining({ kind: "process", active: true, thinking: false, parts: [
      expect.objectContaining({ kind: "tools", runningCallIds: new Set(["still-running"]), items: [
        expect.objectContaining({ type: "tool_call", toolCalls: [expect.objectContaining({ toolCallId: "still-running" })] }),
        expect.objectContaining({ type: "tool_result", toolCallId: "still-running" }),
        expect.objectContaining({ type: "tool_call", toolCalls: [expect.objectContaining({ toolCallId: "already-done" })] }),
        expect.objectContaining({ type: "tool_result", toolCallId: "already-done" }),
      ] }),
    ] }),
  ])
})

it.each([false, true])("keeps all four completed assistant bodies separate from collapsed activity (compressed=%s)", (compressed) => {
  const raw = Array.from({ length: 4 }, (_, index) => [
    { id: `synthetic-user-${index}`, role: "user" as const, content: `Synthetic request ${index}`, compressed, created_at: at },
    { id: `synthetic-call-${index}`, role: "assistant" as const, content: "", compressed, created_at: at,
      tool_calls: [{ id: `call-${index}`, type: "function", function: { name: "Read", arguments: "{}" } }] },
    { id: `synthetic-result-${index}`, role: "tool" as const, content: "Synthetic tool evidence", tool_call_id: `call-${index}`, compressed, created_at: at },
    { id: `synthetic-final-${index}`, role: "assistant" as const, content: `Synthetic final body ${index}`, compressed, created_at: at },
  ]).flat()
  const items = historyEntries(raw).map((entry) => entry.item)

  expect(items.filter((item) => item.kind === "collapsedTurn")).toHaveLength(4)
  expect(items.filter((item) => item.kind === "msg" && item.m.role === "assistant").map((item) => item.m.id))
    .toEqual(["synthetic-final-0", "synthetic-final-1", "synthetic-final-2", "synthetic-final-3"])
})

it("retains individual message actions while blocking regeneration for a user turn with multiple recorded deliveries", () => {
  const user = { id: "c-user", role: "user" as const, content: "Dispatch C", created_at: at }
  const replies = [
    ["c-dispatch", "C dispatched"], ["c-recovery", "C restarted"], ["b-delivery", "B delivered"],
    ["a-delivery", "A delivered"], ["c-delivery", "C delivered"],
  ].map(([id, content]) => ({ id, role: "assistant" as const, phase: "final_answer" as const, content, created_at: at }))
  const entries = historyEntries([user, replies[0], {
    id: "recover-call", role: "assistant" as const, phase: "commentary" as const,
    content: "Checking why C stopped", created_at: at,
    tool_calls: [{ id: "inspect-c", type: "function", function: { name: "session_history", arguments: "{}" } }],
  }, {
    id: "recover-result", role: "tool" as const, content: "C failed on startup", tool_call_id: "inspect-c", created_at: at,
  }, ...replies.slice(1)])

  expect(entries.find((entry) => entry.key === "collapsed-turn-c-recovery")?.item.kind).toBe("collapsedTurn")
  const actions = collectMessageActions(entries, true)
  expect([...actions.values()].filter((message) => message.role === "assistant").map((message) => message.id))
    .toEqual(replies.map((reply) => reply.id))
  expect(findRegenerationKey(entries)).toBeNull()
  expect(findRegenerationKey(historyEntries([user, replies[0]]))).toBe("message-c-dispatch")
})

it("only marks the active tail as streaming while retaining frozen text and progress order", () => {
  const persisted: Message = { id: "saved", role: "assistant", type: "text", content: "persisted assistant", createdAt: at }
  const items = [
    ...buildRenderItems([persisted]),
    ...buildLiveItems([{ kind: "text", text: "frozen round", reasoning: null }], "active tail", null, true, "Compressing context", uiText),
  ]
  expect(items).toMatchObject([
    { kind: "msg", m: { content: "persisted assistant" } },
    { kind: "msg", streaming: false, m: { content: "frozen round" } },
    { kind: "msg", streaming: true, m: { content: "active tail" } },
    { kind: "process", active: true, thinking: false, status: "Compressing context" },
  ])
  expect(items[0]).not.toHaveProperty("streaming")
})

it("shows one local completed body with no mutation target while exact-turn history still has a partial checkpoint", () => {
  const canonical: Message[] = [
    { id: "synthetic-user", role: "user", content: "Synthetic request", createdAt: at },
    { id: "synthetic-partial", role: "assistant", type: "text", content: "Synthetic", createdAt: at, metadata: { reasoning: "Synthetic reasoning" } },
    { id: "synthetic-next", role: "user", content: "Synthetic follow-up", createdAt: at },
  ]
  const projected = projectCompletedAnswers(canonical, [{
    sessionId: "projection", operationId: 1, text: "Synthetic handoff body", acknowledgedMessageId: "synthetic-user",
    baselineMessageId: null, baselineMessageIds: new Set(), anchorSeen: true,
  }])
  const items = buildRenderItems(projected.messages)
  expect(items.filter((item) => item.kind === "msg" && item.m.role === "assistant").map((item) => item.m))
    .toEqual([expect.objectContaining({ id: "completed-answer-handoff-1", content: "Synthetic handoff body" })])
  expect(items.filter((item) => item.kind === "process").flatMap((item) => item.parts))
    .toEqual([expect.objectContaining({ kind: "reasoning", text: "Synthetic reasoning" })])
  expect(canonical[1]?.id).toBe("synthetic-partial")
  const entries = buildHistoryEntries(buildDisplayItems(items, true))
  expect(collectMessageActions(entries, true).has("message-completed-answer-handoff-1")).toBe(false)
})
