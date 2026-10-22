import { describe, expect, it, vi } from "vitest"
import { ApiError, NetworkRequestError, RequestTimeoutError } from "@services/api/errors"
import type { AgentClient, HistoryResponse, SessionSummary } from "./AgentService"
import { readClearedConversation, requestConversationClear } from "./conversationClear"

const session = { id: "fixture/session", is_running: false, token_usage: null, message_count: 1 } as SessionSummary
const history: HistoryResponse = { session_id: session.id, messages: [
  { id: "system", role: "system", content: "retained", created_at: "2026-10-22T00:00:00Z" },
] }
const harness = () => ({
  getSession: vi.fn<AgentClient["getSession"]>().mockResolvedValue({ session }),
  getHistory: vi.fn<AgentClient["getHistory"]>().mockResolvedValue(history),
  getPendingQuestion: vi.fn<AgentClient["getPendingQuestion"]>().mockResolvedValue({ has_pending_question: false }),
  clearSession: vi.fn<AgentClient["clearSession"]>().mockResolvedValue(undefined),
})
const apiError = (status: number, code: string) => new ApiError("fixture error", status, "fixture", JSON.stringify({ error: { code } }))

describe("C1 conversation clear boundary", () => {
  it("checks fresh identity, running and pending state before a single clear request", async () => {
    const client = harness()
    await requestConversationClear(session.id, client)
    expect(client.getSession).toHaveBeenCalledExactlyOnceWith(session.id)
    expect(client.getPendingQuestion).toHaveBeenCalledExactlyOnceWith(session.id)
    expect(client.clearSession).toHaveBeenCalledExactlyOnceWith(session.id)
    expect(client.getHistory).not.toHaveBeenCalled()
  })

  it.each([
    { patch: { is_running: true }, reason: "active_run" },
    { patch: { id: "foreign" }, reason: "state_unavailable" },
    { patch: { is_running: undefined }, reason: "state_unavailable" },
    { patch: { plan_mode: { status: "awaiting_approval" } }, reason: "pending_approval" },
  ])("refuses $reason without sending a mutation", async ({ patch, reason }) => {
    const client = harness()
    client.getSession.mockResolvedValue({ session: { ...session, ...patch } as SessionSummary })
    await expect(requestConversationClear(session.id, client)).rejects.toMatchObject({ reason })
    expect(client.clearSession).not.toHaveBeenCalled()
  })

  it("does not clear when a pending question/approval or its read cannot be confirmed", async () => {
    const client = harness()
    client.getPendingQuestion.mockRejectedValueOnce(new Error("unavailable"))
    await expect(requestConversationClear(session.id, client)).rejects.toMatchObject({ reason: "state_unavailable" })
    client.getPendingQuestion.mockResolvedValueOnce({ has_pending_question: true } as never)
    await expect(requestConversationClear(session.id, client)).rejects.toMatchObject({ reason: "pending_approval" })
    expect(client.clearSession).not.toHaveBeenCalled()
  })

  it.each([
    { error: apiError(409, "session_clear_authority_conflict"), reason: "authority_conflict" },
    { error: apiError(409, "session_execution_incompatible"), reason: "incompatible" },
    { error: apiError(404, "missing"), reason: "unsupported" },
    { error: apiError(500, "session_clear_outcome_unknown"), reason: "unknown" },
    { error: apiError(500, "unsupported"), reason: "unknown" },
    { error: apiError(409, "future_conflict"), reason: "unknown" },
    { error: new NetworkRequestError(), reason: "unknown" },
    { error: new RequestTimeoutError(), reason: "unknown" },
    { error: new Error("malformed receipt"), reason: "unknown" },
  ])("classifies $reason with no repeat POST or fallback", async ({ error, reason }) => {
    const client = harness()
    client.clearSession.mockRejectedValue(error)
    await expect(requestConversationClear(session.id, client)).rejects.toMatchObject({ reason })
    expect(client.clearSession).toHaveBeenCalledTimes(1)
  })

  it("accepts only the readable C1 postcondition, retaining compression events", async () => {
    const client = harness()
    const next = { ...history, compression_events: [{ id: "retained", created_at: "fixture", messages_compressed: 4, segments_removed: 2 }] }
    client.getHistory.mockResolvedValue(next)
    await expect(readClearedConversation(session.id, client)).resolves.toEqual({ session, history: next })
    expect(client.clearSession).not.toHaveBeenCalled()
  })

  it.each([
    { session: { ...session, id: "foreign" }, history },
    { session, history: { ...history, session_id: "foreign" } },
    { session: { ...session, token_usage: undefined }, history },
    { session: { ...session, token_usage: {} }, history },
    { session: { ...session, is_running: true }, history },
    { session: { ...session, has_pending_question: true }, history },
    { session: { ...session, message_count: 0 }, history },
    { session, history: { ...history, messages: [{ ...history.messages[0], role: "assistant" }] } },
    { session, history: { ...history, messages: [...history.messages, ...history.messages] } },
  ])("rejects unconfirmed readback %# without a mutation", async (snapshot) => {
    const client = harness()
    client.getSession.mockResolvedValue({ session: snapshot.session as SessionSummary })
    client.getHistory.mockResolvedValue(snapshot.history as HistoryResponse)
    await expect(readClearedConversation(session.id, client)).rejects.toMatchObject({ reason: "readback_failed" })
    expect(client.clearSession).not.toHaveBeenCalled()
  })
})
