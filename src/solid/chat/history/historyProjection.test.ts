import { expect, it } from "vitest"
import { projectCompletedAnswers } from "@/lib/completedAnswerHandoff"
import { uiText } from "@shared/i18n/text"
import { mapHistoryMessagesToUi } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import type { Message } from "@shared/types/chatMessages"
import {
  buildDisplayItems, buildHistoryEntries, buildLiveItems, buildRenderItems,
  collectMessageActions, findRegenerationKey, itemTimestamp, toolCallCount,
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
  expect(items.flatMap((item) => item.kind === "msg" && item.m.role === "assistant" ? [item.m.id] : []))
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

it("places an admitted image-only message between the frozen and active replies", () => {
  const message = { id: "interjection", role: "user", content: "", createdAt: at } as const
  const image = { id: "image", url: "/image.png", name: "map", size: 0, type: "image/png" }
  const queued = new Map([[message.id, { ...message, images: [image] }]])
  const items = buildLiveItems([
    { kind: "text", text: "Before", reasoning: null },
    { kind: "interjection", messageId: message.id, message },
  ], "After", null, true, null, uiText, queued)

  expect(items).toMatchObject([
    { kind: "msg", m: { content: "Before" } },
    { kind: "msg", m: { ...message, images: [image] } },
    { kind: "msg", streaming: true, m: { content: "After" } },
  ])
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
  expect(items.flatMap((item) => item.kind === "msg" && item.m.role === "assistant" ? [item.m] : []))
    .toEqual([expect.objectContaining({ id: "completed-answer-handoff-1", content: "Synthetic handoff body" })])
  expect(items.filter((item) => item.kind === "process").flatMap((item) => item.parts))
    .toEqual([expect.objectContaining({ kind: "reasoning", text: "Synthetic reasoning" })])
  expect(canonical[1]?.id).toBe("synthetic-partial")
  const entries = buildHistoryEntries(buildDisplayItems(items, true))
  expect(collectMessageActions(entries, true).has("message-completed-answer-handoff-1")).toBe(false)
})

it("joins saved tools and reasoning across empty entries and splits at a visible body", () => {
  const thought = (id: string, content = ""): Message => ({
    id, role: "assistant", type: "text", content, createdAt: at, metadata: { reasoning: id },
  })
  const tool = (id: string): Message => ({
    id, role: "assistant", type: "tool_call", createdAt: at,
    toolCalls: [{ toolCallId: id, toolName: "Read", parameters: {} }],
  })
  const items = buildRenderItems([
    tool("one"), thought("first thought"), { id: "empty", role: "assistant", type: "text", content: "", createdAt: at },
    { id: "system", role: "system", content: "hidden system record", createdAt: at },
    tool("two"), thought("second thought"), thought("body thought", "Visible progress"), tool("three"), thought("last thought"),
  ])

  expect(items.map((item) => item.kind)).toEqual(["process", "msg", "process"])
  expect(items[1]).toMatchObject({ m: { content: "Visible progress" } })
  const groups = items.filter((item) => item.kind === "process")
  expect(groups[0]?.parts.map((part) => part.kind)).toEqual(["tools", "reasoning", "tools", "reasoning", "reasoning"])
  expect(groups[0]?.parts.filter((part) => part.kind === "reasoning").map((part) => part.text))
    .toEqual(["first thought", "second thought", "body thought"])
  expect(groups[1]?.parts.at(-1)).toMatchObject({ text: "last thought" })
  expect(groups.map((group) => toolCallCount([group]))).toEqual([2, 1])
})

it("keeps the open tail outside a turn fold until a saved summary and retains the next turn", () => {
  const user: Message = { id: "user", role: "user", content: "First request", createdAt: "2026-11-08T00:00:00Z" }
  const intermediate: Message = { id: "intermediate", role: "assistant", type: "text", content: "Working", createdAt: "2026-11-08T00:00:10Z" }
  const call: Message = { id: "call", role: "assistant", type: "tool_call", createdAt: "2026-11-08T00:00:20Z",
    toolCalls: [{ toolCallId: "read", toolName: "Read", parameters: {} }] }
  const result: Message = { id: "result", role: "assistant", type: "tool_result", createdAt: "2026-11-08T00:00:30Z",
    toolName: "Read", toolCallId: "read", isError: false,
    result: { tool_name: "Read", display_preference: "Default", result: "Done" } }
  const final: Message = { id: "final", role: "assistant", type: "text", content: "Conclusion", createdAt: "2026-11-08T00:01:05Z",
    metadata: { reasoning: "Final thought" } }
  const messages = [user, intermediate, call, result]
  const live = buildDisplayItems(buildRenderItems(messages), false)
  expect(live.map((item) => item.kind)).toEqual(["msg", "msg", "process"])
  expect(live[1]).toMatchObject({ m: intermediate })

  const settled = buildDisplayItems(buildRenderItems([...messages, final]), true)
  expect(settled.map((item) => item.kind)).toEqual(["msg", "collapsedTurn", "msg"])
  const divider = settled.find((item) => item.kind === "collapsedTurn")!
  expect(divider).toMatchObject({ key: "collapsed-turn-final", toolCalls: 1,
    items: [{ kind: "msg", m: intermediate }, { kind: "process" }] })
  expect(divider.finishedAt! - divider.startedAt!).toBe(55_000)
  const activity = divider.items.find((item) => item.kind === "process")!
  expect(itemTimestamp(activity, "last")! - itemTimestamp(activity)!).toBe(45_000)
  expect(activity.parts.filter((part) => part.kind === "reasoning")).toEqual([
    { kind: "reasoning", text: "Final thought", createdAt: final.createdAt },
  ])
  expect(settled.at(-1)).toMatchObject({ m: final })

  const next = buildDisplayItems(buildRenderItems([...messages, final,
    { ...user, id: "next-user", content: "Next request" },
    { ...final, id: "next-answer", content: "Next response", metadata: undefined },
  ]), false)
  expect(next.find((item) => item.kind === "collapsedTurn")?.key).toBe(divider.key)
  expect(next.at(-1)).toMatchObject({ m: { id: "next-answer", content: "Next response" } })
})

it("does not turn a saved tool round active just because an inactive text tail is still retained", () => {
  const tool: Message = { id: "persisted-tool", role: "assistant", type: "tool_call", createdAt: at,
    toolCalls: [{ toolCallId: "read", toolName: "Read", parameters: {} }] }

  const items = [...buildRenderItems([tool]), ...buildLiveItems([], "Retained final text", null, false, null, uiText)]

  expect(items).toHaveLength(2)
  expect(items[0]).toMatchObject({ kind: "process", key: "activity-persisted-tool" })
  expect(items[0]).not.toHaveProperty("active")
  expect(items[1]).toMatchObject({ kind: "msg", streaming: false, m: { content: "Retained final text" } })
})

it("treats an image-only user message from the attachment protocol as a visible activity boundary", () => {
  const call = (id: string) => ({ id, role: "assistant" as const, content: "", created_at: at,
    tool_calls: [{ id, type: "function", function: { name: "Read", arguments: "{}" } }] })
  const messages = mapHistoryMessagesToUi("projection", [call("before"), {
    id: "image-only", role: "user", content: "", created_at: at,
    content_parts: [{ type: "image_url", image_url: { url: "bamboo-attachment://projection/asset" } }],
  }, call("after")])

  const items = buildRenderItems(messages)
  expect(items.map((item) => item.kind)).toEqual(["process", "msg", "process"])
  expect(items[1]).toMatchObject({ m: { id: "image-only", role: "user", content: "",
    images: [{ url: expect.stringMatching(/\/sessions\/projection\/attachments\/asset$/) }] } })
})
