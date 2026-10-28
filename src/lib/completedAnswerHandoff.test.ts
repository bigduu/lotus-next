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
  const canonical = [user("user-1"), assistant("answer-1", "  Synthetic final\n"), user("user-2")]
  expect(projectCompletedAnswers(canonical, [entry()])).toEqual({ messages: canonical, remaining: [] })
})
it("accepts a canonical answer with normalized line endings", () => {
  const canonical = [user("user-1"), assistant("answer-1", "Synthetic\r\nfinal"), user("user-2")]
  expect(projectCompletedAnswers(canonical, [entry({ text: "Synthetic\nfinal" })])).toEqual({ messages: canonical, remaining: [] })
})
it("does not retire a completed answer for a different intermediate body in its user turn", () => {
  const canonical = [user("user-1"), assistant("intermediate", "Synthetic intermediate step"), user("user-2")]
  const projected = projectCompletedAnswers(canonical, [entry()])
  expect(projected.remaining).toHaveLength(1)
  expect(projected.messages.map((message) => message.id)).toEqual(["user-1", "intermediate", "completed-answer-handoff-1", "user-2"])
  const saved = [user("user-1"), assistant("intermediate", "Synthetic intermediate step"), assistant("final"), user("user-2")]
  expect(projectCompletedAnswers(saved, projected.remaining)).toEqual({ messages: saved, remaining: [] })
})
it("does not let an identical answer in a later turn confirm the missing earlier reply", () => {
  const canonical = [user("user-1"), user("user-2"), assistant("answer-2")]
  const projected = projectCompletedAnswers(canonical, [entry()])
  expect(projected.remaining).toHaveLength(1)
  expect(projected.messages.filter(isCompletedAnswerHandoff)).toHaveLength(1)
})
it("does not infer a known ACK from equal text while the exact user is absent", () => {
  const canonical = [user("other-user"), assistant("other-answer")]
  const pending = entry({ anchorSeen: false })
  expect(projectCompletedAnswers(canonical, [pending])).toEqual({ messages: canonical, remaining: [pending] })
})
it("keeps an observed anchor pending but hidden when a later history snapshot omits it", () => {
  const pending = entry(), stale = [user("old-user")]
  expect(projectCompletedAnswers(stale, [pending])).toEqual({ messages: stale, remaining: [pending] })
  expect(projectCompletedAnswers([user("user-1")], [pending]).remaining).toEqual([pending])
})
it("never retires two distinct runs from the same single canonical answer", () => {
  const first = entry({ handoffId: "one", runId: "run-1" })
  const second = entry({ handoffId: "two", runId: "run-2" })
  const canonical = [user("user-1"), assistant("answer-1"), user("user-2")]
  const projected = projectCompletedAnswers(canonical, [first, second])
  expect(projected.remaining).toEqual([second])
  expect(projected.messages.filter(isCompletedAnswerHandoff)).toHaveLength(1)
})
it("does not use unchanged pre-run canonical text as evidence of a new run", () => {
  const pending = entry({ baselineMessageId: "old-answer", baselineMessageText: "Synthetic final" })
  const canonical = [user("user-1"), assistant("old-answer")]
  expect(projectCompletedAnswers(canonical, [pending]).remaining).toEqual([pending])
})
it("keeps consecutive equal replies tied to separate user intervals", () => {
  const first = entry(), second = entry({ operationId: 2, acknowledgedMessageId: "user-2" })
  const canonical = [user("user-1"), assistant("answer-1"), user("user-2"), user("user-3")]
  const projected = projectCompletedAnswers(canonical, [first, second])
  expect(projected.remaining).toEqual([second])
  expect(projected.messages.map((message) => message.id)).toEqual(["user-1", "answer-1", "user-2", "completed-answer-handoff-2", "user-3"])
})
it("does not use an unanchored legacy answer to confirm a completed run", () => {
  const pending = entry({ acknowledgedMessageId: null, anchorSeen: false, baselineMessageId: "missing-tool" })
  const unanchored = [assistant("unrelated-answer")]
  expect(projectCompletedAnswers(unanchored, [pending])).toEqual({ messages: unanchored, remaining: [pending] })
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


it("shows one complete reply while an exact-turn checkpoint is only a prefix", () => {
  const canonical = [user("user-1"), assistant("partial-answer", "Synthetic"), user("user-2")]
  const original = [...canonical]
  const projected = projectCompletedAnswers(canonical, [entry()])
  expect(projected.messages.map((message) => message.id)).toEqual(["user-1", "completed-answer-handoff-1", "user-2"])
  expect(projected.remaining).toHaveLength(1)
  expect(canonical).toEqual(original)

  const saved = [user("user-1"), assistant("partial-answer"), user("user-2")]
  expect(projectCompletedAnswers(saved, projected.remaining)).toEqual({ messages: saved, remaining: [] })
})

it("keeps a baseline prefix and another turn's prefix when their identities are not the new answer", () => {
  const canonical = [user("user-1"), assistant("baseline-prefix", "Synthetic"), user("user-2"), assistant("later-prefix", "Synthetic")]
  const pending = entry({ baselineMessageId: "baseline-prefix", baselineMessageIds: new Set(["baseline-prefix"]) })
  const projected = projectCompletedAnswers(canonical, [pending])
  expect(projected.messages.map((message) => message.id)).toEqual(["user-1", "baseline-prefix", "completed-answer-handoff-1", "user-2", "later-prefix"])
  expect(canonical).toHaveLength(4)
})


it("retains checkpoint reasoning and provenance while displaying the complete handoff", () => {
  const partial = { ...assistant("partial-answer", "Synthetic"), model: "synthetic-model",
    metadata: { reasoning: "Synthetic reasoning" } }
  const canonical = [user("user-1"), partial, user("user-2")]
  const projected = projectCompletedAnswers(canonical, [entry()])
  const handoff = projected.messages.find(isCompletedAnswerHandoff)
  expect(handoff).toMatchObject({ content: "Synthetic final", model: "synthetic-model",
    metadata: { reasoning: "Synthetic reasoning", completedAnswerHandoff: true } })
  expect(canonical[1]).toEqual(partial)
})
