import { afterEach, expect, it, vi } from "vitest"
import type { Message } from "@shared/types/chat"
import type { CompletedAnswerHandoff } from "./completedAnswerHandoff"
import {
  COMPLETED_ANSWER_MAX_AGE_MS, COMPLETED_ANSWER_MAX_ENTRIES, acquireCompletedAnswerLease,
  getCompletedAnswerHandoffs, invalidateCompletedAnswerForDeletedMessage, invalidateCompletedAnswers, reconcileCompletedAnswers,
  resetCompletedAnswerHandoffsForTest, retainCompletedAnswer,
} from "./completedAnswerHandoffRegistry"

const user = (id: string): Message => ({ id, role: "user", content: id, createdAt: "" })
const answer = (id: string, content: string): Message => ({ id, role: "assistant", type: "text", content, createdAt: "" })
const entry = (patch: Partial<CompletedAnswerHandoff> = {}): CompletedAnswerHandoff => ({
  sessionId: "session-a", operationId: 1, handoffId: "local-1", runId: null,
  acknowledgedMessageId: "user-1", text: "synthetic answer", baselineMessageId: null,
  baselineMessageIds: new Set(), anchorSeen: true, ...patch,
})
const retain = (handoff: CompletedAnswerHandoff) => retainCompletedAnswer(acquireCompletedAnswerLease(handoff.sessionId), handoff)

afterEach(() => { resetCompletedAnswerHandoffsForTest(); vi.useRealTimers() })

it("keeps the same hook-local operation number distinct across sessions and turns", () => {
  retain(entry())
  retain(entry({ sessionId: "session-b", handoffId: "local-2", acknowledgedMessageId: "user-2" }))
  retain(entry({ handoffId: "local-3", acknowledgedMessageId: "user-3" }))
  expect(getCompletedAnswerHandoffs().map((item) => [item.sessionId, item.handoffId])).toEqual([
    ["session-a", "local-1"], ["session-b", "local-2"], ["session-a", "local-3"],
  ])
})

it("coalesces only a confirmed identical run, never matching ACK/text or operation number alone", () => {
  retain(entry({ handoffId: "one", runId: "run-1" }))
  retain(entry({ handoffId: "duplicate", runId: "run-1" }))
  retain(entry({ handoffId: "other-run", runId: "run-2" }))
  retain(entry({ handoffId: "unknown-1" }))
  retain(entry({ handoffId: "unknown-2" }))
  expect(getCompletedAnswerHandoffs().map((item) => item.handoffId)).toEqual(["one", "other-run", "unknown-1", "unknown-2"])
})

it("reconciles only an exact session and turn, without mutating canonical history", () => {
  const canonical = [user("user-1"), answer("saved", "synthetic answer"), user("user-2")]
  retain(entry()); retain(entry({ sessionId: "session-b", handoffId: "other" }))
  reconcileCompletedAnswers("session-a", canonical)
  expect(getCompletedAnswerHandoffs().map((item) => item.sessionId)).toEqual(["session-b"])
  expect(canonical).toHaveLength(3)
})

it("cannot reconcile two distinct runs with only one matching canonical message", () => {
  retain(entry({ handoffId: "first", runId: "run-1" }))
  retain(entry({ handoffId: "second", runId: "run-2" }))
  reconcileCompletedAnswers("session-a", [user("user-1"), answer("saved", "synthetic answer")])
  expect(getCompletedAnswerHandoffs().map((item) => item.handoffId)).toEqual(["second"])
  reconcileCompletedAnswers("session-a", [user("user-1"), answer("saved", "synthetic answer")])
  expect(getCompletedAnswerHandoffs().map((item) => item.handoffId)).toEqual(["second"])
})

it("does not reuse a claimed message for a different run that was already in flight", () => {
  retain(entry({ handoffId: "first", runId: "run-1" }))
  const second = acquireCompletedAnswerLease("session-a")
  const canonical = [user("user-1"), answer("saved", "synthetic answer")]
  reconcileCompletedAnswers("session-a", canonical)
  retainCompletedAnswer(second, entry({ handoffId: "second", runId: "run-2", excludedCanonicalIds: new Set(second.excludedCanonicalIds) }))
  reconcileCompletedAnswers("session-a", canonical)
  expect(getCompletedAnswerHandoffs().map((item) => item.handoffId)).toEqual(["second"])
})

it("expires an unconfirmed handoff without treating it as canonical", () => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  const canonical = [user("user-1")]
  retain(entry())
  vi.advanceTimersByTime(COMPLETED_ANSWER_MAX_AGE_MS - 1)
  expect(getCompletedAnswerHandoffs()).toHaveLength(1)
  vi.advanceTimersByTime(1)
  expect(getCompletedAnswerHandoffs()).toHaveLength(0)
  expect(canonical).toEqual([user("user-1")])
})

it("caps unresolved handoffs and evicts the oldest without claiming persistence", () => {
  for (let i = 0; i <= COMPLETED_ANSWER_MAX_ENTRIES; i += 1) {
    retain(entry({ handoffId: `id-${i}`, acknowledgedMessageId: `user-${i}` }))
  }
  expect(getCompletedAnswerHandoffs()).toHaveLength(COMPLETED_ANSWER_MAX_ENTRIES)
  expect(getCompletedAnswerHandoffs()[0].handoffId).toBe("id-1")
})

it("fences late completion after a confirmed truncate while retaining known earlier turns", () => {
  const messages = [user("user-1"), user("user-2"), user("user-3")]
  retain(entry({ handoffId: "earlier" }))
  retain(entry({ handoffId: "target", acknowledgedMessageId: "user-2" }))
  retain(entry({ sessionId: "session-b", handoffId: "other" }))
  const late = acquireCompletedAnswerLease("session-a")
  late.handoff = entry({ handoffId: "late", acknowledgedMessageId: "user-3" })
  invalidateCompletedAnswers("session-a", { messages, targetId: "user-2" })
  retainCompletedAnswer(late, late.handoff)
  expect(getCompletedAnswerHandoffs().map((item) => item.handoffId)).toEqual(["earlier", "other"])
})

it("invalidates a confirmed deleted user turn and unknown identities without deleting other turns", () => {
  retain(entry({ handoffId: "deleted" }))
  retain(entry({ handoffId: "other-turn", acknowledgedMessageId: "user-2" }))
  retain(entry({ handoffId: "unknown", acknowledgedMessageId: null }))
  retain(entry({ sessionId: "session-b", handoffId: "other-session" }))
  const late = acquireCompletedAnswerLease("session-a")
  invalidateCompletedAnswerForDeletedMessage("session-a", "user-1")
  retainCompletedAnswer(late, entry({ handoffId: "late" }))
  expect(getCompletedAnswerHandoffs().map((item) => item.handoffId)).toEqual(["other-turn", "other-session"])
})

it("fences unidentified older callbacks on a confirmed clear without touching another session", () => {
  retain(entry()); retain(entry({ sessionId: "session-b", handoffId: "other" }))
  const late = acquireCompletedAnswerLease("session-a")
  invalidateCompletedAnswers("session-a")
  retainCompletedAnswer(late, entry({ handoffId: "late" }))
  expect(getCompletedAnswerHandoffs().map((item) => item.handoffId)).toEqual(["other"])
})
