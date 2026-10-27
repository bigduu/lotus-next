import { expect, it } from "vitest"
import type { Message } from "@shared/types/chat"
import { isCompletedAnswerHandoff, projectCompletedAnswers, type CompletedAnswerHandoff } from "./completedAnswerHandoff"

const user = (id: string): Message => ({ id, role: "user", content: id, createdAt: "" })
const assistant = (id: string, content = "Synthetic final"): Message => ({ id, role: "assistant", type: "text", content, createdAt: "" })
const entry = (patch: Partial<CompletedAnswerHandoff> = {}): CompletedAnswerHandoff => ({ sessionId: "synthetic-session", operationId: 1,
  text: "Synthetic final", acknowledgedMessageId: "user-1", baselineMessageId: "old-answer", baselineMessageIds: new Set(["old-user", "old-answer"]), anchorSeen: true, ...patch })

it("inserts the handoff before the following user without changing canonical records or cursors", () => {
  const canonical = [user("user-1"), user("user-2")]
  const projected = projectCompletedAnswers(canonical, [entry()])
  expect(projected.messages.map((message) => message.id)).toEqual(["user-1", "completed-answer-handoff-1", "user-2"])
  expect(canonical).toEqual([user("user-1"), user("user-2")])
  expect(isCompletedAnswerHandoff(projected.messages[1])).toBe(true)
})
it("retires a canonical answer in its own user window even when another turn follows", () => {
  const canonical = [user("user-1"), assistant("answer-1", "Canonical whitespace may differ.\n"), user("user-2")]
  expect(projectCompletedAnswers(canonical, [entry()])).toEqual({ messages: canonical, remaining: [] })
})
it("does not let an identical answer in a later turn confirm the missing earlier reply", () => {
  const canonical = [user("user-1"), user("user-2"), assistant("answer-2")]
  const projected = projectCompletedAnswers(canonical, [entry()])
  expect(projected.remaining).toHaveLength(1)
  expect(projected.messages.filter(isCompletedAnswerHandoff)).toHaveLength(1)
})
it("does not infer a known ACK from equal text while the exact user is absent", () => {
  const canonical = [user("other-user"), assistant("other-answer")]
  expect(projectCompletedAnswers(canonical, [entry({ anchorSeen: false })]).remaining).toHaveLength(1)
})
it("retires the handoff after clear/truncate removes a previously observed anchor", () => {
  expect(projectCompletedAnswers([], [entry()])).toEqual({ messages: [], remaining: [] })
})
it("keeps consecutive equal replies tied to separate user intervals", () => {
  const first = entry(), second = entry({ operationId: 2, acknowledgedMessageId: "user-2" })
  const canonical = [user("user-1"), assistant("answer-1"), user("user-2"), user("user-3")]
  const projected = projectCompletedAnswers(canonical, [first, second])
  expect(projected.remaining).toEqual([second])
  expect(projected.messages.map((message) => message.id)).toEqual(["user-1", "answer-1", "user-2", "completed-answer-handoff-2", "user-3"])
})
it("legacy ACKs require new canonical text rather than an older equal reply", () => {
  const legacy = entry({ acknowledgedMessageId: null, anchorSeen: false })
  const old = [user("old-user"), assistant("old-answer")]
  expect(projectCompletedAnswers(old, [legacy]).remaining).toHaveLength(1)
  expect(projectCompletedAnswers([...old, user("new-user"), assistant("new-answer")], [legacy]).remaining).toHaveLength(0)
})
it("waits past a partial body, then accepts full canonical text on the same ID in the exact user interval", () => {
  const retained = entry({ baselineMessageId: "partial-answer", baselineMessageIds: new Set(["user-1", "partial-answer"]) })
  expect(projectCompletedAnswers([user("user-1"), assistant("partial-answer", "Synthetic")], [retained]).remaining).toHaveLength(1)
  expect(projectCompletedAnswers([user("user-1"), assistant("partial-answer")], [retained]).remaining).toHaveLength(0)
})
