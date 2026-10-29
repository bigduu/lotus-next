import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createStore } from "zustand/vanilla"
import { agentClient, type HistoryResponse, type SessionSummary, type TokenBudgetUsage } from "@services/chat/AgentService"
import { NetworkRequestError } from "@services/api/errors"
import type { AppState } from "../.."
import { createChatSlice } from "../chatSessionSlice"
import { createTokenBudgetSlice } from "../tokenBudgetSlice"
import { mapHistoryMessagesToUi, sessionSummaryToChatItem } from "./messageMapping"
import { acquireCompletedAnswerLease, getCompletedAnswerHandoffs, resetCompletedAnswerHandoffsForTest,
  retainCompletedAnswer } from "@/lib/completedAnswerHandoffRegistry"

const summary = (id = "fixture/a"): SessionSummary => ({
  id, kind: "root", title: id, title_version: 2, pinned: true, root_session_id: id, spawn_depth: 0,
  model: "fixture", created_at: "2026-10-22T00:00:00Z", updated_at: "2026-10-22T00:00:00Z",
  last_activity_at: "2026-10-22T00:00:00Z", message_count: 1, has_attachments: false, is_running: false,
  project_id: "project-retained",
})
const old: HistoryResponse = { session_id: "fixture/a", messages: [
  { id: "old", role: "user", content: "synthetic previous conversation", created_at: "2026-10-22T00:00:00Z" },
] }
const cleared: HistoryResponse = { session_id: "fixture/a", messages: [
  { ...old.messages[0], id: "system", role: "system", content: "retained system" },
] }
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { resolve, promise }
}
const harness = () => {
  const store = createStore<AppState>()((set, get, api) => ({
    ...createChatSlice(set, get, api), ...createTokenBudgetSlice(set, get, api), executionBySession: {},
    resetSessionPermissionModes: vi.fn(),
  } as unknown as AppState))
  const first = sessionSummaryToChatItem(summary())
  first.messages = mapHistoryMessagesToUi(first.id, old.messages)
  const other = sessionSummaryToChatItem(summary("fixture/b"))
  store.setState({ chats: [first, other], currentSessionId: first.id })
  return store
}
beforeEach(() => {
  vi.spyOn(agentClient, "getSession").mockImplementation(async (id) => ({ session: summary(id) }))
  vi.spyOn(agentClient, "getPendingQuestion").mockResolvedValue({ has_pending_question: false })
  vi.spyOn(agentClient, "clearSession").mockResolvedValue(undefined)
  vi.spyOn(agentClient, "getHistory").mockResolvedValue(cleared)
  vi.spyOn(agentClient, "patchSession").mockResolvedValue(undefined)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => { resetCompletedAnswerHandoffsForTest(); vi.restoreAllMocks(); vi.useRealTimers() })

describe("verified conversation clear state", () => {
  it("retires only the cleared session's pending handoff and fences an older callback", async () => {
    const store = harness()
    const pending = { sessionId: "fixture/a", operationId: 1, handoffId: "cleared-answer", text: "synthetic answer",
      acknowledgedMessageId: "old", baselineMessageId: null, baselineMessageIds: new Set<string>(), anchorSeen: true }
    const other = { ...pending, sessionId: "fixture/b", handoffId: "other-answer" }
    retainCompletedAnswer(acquireCompletedAnswerLease("fixture/a"), pending)
    retainCompletedAnswer(acquireCompletedAnswerLease("fixture/b"), other)
    const late = acquireCompletedAnswerLease("fixture/a")
    await store.getState().clearConversation("fixture/a")
    retainCompletedAnswer(late, { ...pending, handoffId: "late-answer" })
    expect(getCompletedAnswerHandoffs().map((item) => item.handoffId)).toEqual(["other-answer"])
  })
  it("fences a remote clear at notification time without discarding newer work during its delayed read", async () => {
    const store = harness(), held = deferred<HistoryResponse>()
    vi.mocked(agentClient.getHistory).mockReturnValueOnce(held.promise)
    const oldAnswer = { sessionId: "fixture/a", operationId: 1, handoffId: "before-event", text: "old synthetic answer",
      acknowledgedMessageId: "old", baselineMessageId: null, baselineMessageIds: new Set<string>(), anchorSeen: true }
    retainCompletedAnswer(acquireCompletedAnswerLease("fixture/a"), oldAnswer)
    store.getState().reconcileClearedConversation("fixture/a")
    expect(getCompletedAnswerHandoffs()).toHaveLength(0)
    const newer = { ...oldAnswer, handoffId: "after-event", acknowledgedMessageId: "new-user", anchorSeen: false }
    retainCompletedAnswer(acquireCompletedAnswerLease("fixture/a"), newer)
    held.resolve(cleared)
    await vi.waitFor(() => expect(store.getState().chats[0].messages.map((message) => message.id)).toEqual(["system"]))
    expect(getCompletedAnswerHandoffs().map((item) => item.handoffId)).toEqual(["after-event"])
  })

  it("keeps identity, scope, other sessions and unfinished tasks; success waits for canonical readback", async () => {
    const store = harness(), read = deferred<HistoryResponse>()
    const before = store.getState().chats[0], other = store.getState().chats[1]
    const unfinished = { "fixture/a": { id: "synthetic-unfinished" } }
    store.setState({ taskLists: unfinished } as unknown as Partial<AppState>)
    vi.mocked(agentClient.getHistory).mockReturnValue(read.promise)
    const action = store.getState().clearConversation(before.id)
    await vi.waitFor(() => expect(agentClient.getHistory).toHaveBeenCalled())
    expect(store.getState().chats[0]).toBe(before)
    expect(store.getState().conversationClears[before.id]).toEqual({ busy: true })
    read.resolve(cleared); await action
    expect(store.getState().conversationClears[before.id]).toEqual({ busy: false, confirmed: true })
    expect(store.getState().chats[0]).toMatchObject({ id: before.id, title: before.title, pinned: true,
      config: { projectId: "project-retained" }, messages: [{ id: "system", role: "system" }] })
    expect(store.getState().chats[1]).toBe(other)
    expect((store.getState() as unknown as { taskLists: object }).taskLists).toBe(unfinished)
    expect(agentClient.patchSession).not.toHaveBeenCalled()
    store.getState().dismissConversationClear(before.id)
    expect(store.getState().conversationClears[before.id]).toBeUndefined()
  })

  it("does not swallow readback failure or erase messages; GET-only verification recovers an acknowledged clear", async () => {
    const store = harness(), before = store.getState().chats[0]
    vi.mocked(agentClient.getHistory).mockRejectedValueOnce(new Error("read unavailable"))
    await expect(store.getState().clearConversation(before.id)).rejects.toMatchObject({ reason: "readback_failed" })
    expect(store.getState().chats[0]).toBe(before)
    store.getState().dismissConversationClear(before.id)
    await expect(store.getState().clearConversation(before.id)).rejects.toMatchObject({ reason: "readback_failed" })
    await store.getState().verifyConversationClear(before.id)
    expect(store.getState().conversationClears[before.id]?.confirmed).toBe(true)
    expect(agentClient.clearSession).toHaveBeenCalledTimes(1)
  })

  it("keeps unknown outcomes across dialog reopen and never converts bare readback into a successful request", async () => {
    const store = harness(), before = store.getState().chats[0]
    vi.mocked(agentClient.clearSession).mockRejectedValue(new NetworkRequestError())
    await expect(store.getState().clearConversation(before.id)).rejects.toMatchObject({ reason: "unknown" })
    expect(store.getState().chats[0]).toBe(before)
    store.getState().dismissConversationClear(before.id)
    await expect(store.getState().clearConversation(before.id)).rejects.toMatchObject({ reason: "unknown" })
    await store.getState().verifyConversationClear(before.id)
    expect(store.getState().conversationClears[before.id]).toEqual({ busy: false, error: "unknown", readbackConfirmed: true })
    expect(agentClient.clearSession).toHaveBeenCalledTimes(1)
  })

  it("fences a pre-clear read and does not apply it after a verified clear", async () => {
    const store = harness(), stale = deferred<HistoryResponse>()
    vi.mocked(agentClient.getHistory).mockReturnValueOnce(stale.promise).mockResolvedValueOnce(cleared)
    const previous = store.getState().loadChatHistory("fixture/a")
    await store.getState().clearConversation("fixture/a")
    stale.resolve(old); await previous
    expect(store.getState().chats[0].messages.map((message) => message.id)).toEqual(["system"])
  })

  it("does not accept ordinary history requests during a clear or duplicate a concurrent clear", async () => {
    const store = harness(), write = deferred<void>()
    vi.mocked(agentClient.clearSession).mockReturnValue(write.promise)
    const action = store.getState().clearConversation("fixture/a")
    await vi.waitFor(() => expect(agentClient.clearSession).toHaveBeenCalled())
    await store.getState().clearConversation("fixture/a")
    await store.getState().loadChatHistory("fixture/a")
    expect(agentClient.getHistory).not.toHaveBeenCalled()
    write.resolve(); await action
    expect(agentClient.clearSession).toHaveBeenCalledTimes(1)
  })

  it.each(["open", "inactive"])("replaces %s history on a cross-client clear event and fences the old response", async (kind) => {
    const store = harness(), stale = deferred<HistoryResponse>()
    if (kind === "inactive") store.setState({ currentSessionId: "fixture/b" })
    vi.mocked(agentClient.getHistory).mockReturnValueOnce(stale.promise).mockResolvedValueOnce(cleared)
    const previous = store.getState().loadChatHistory("fixture/a")
    store.getState().reconcileClearedConversation("fixture/a")
    await vi.waitFor(() => expect(store.getState().chats[0].messages.map((message) => message.id)).toEqual(["system"]))
    stale.resolve(old); await previous
    expect(store.getState().chats[0].messages.map((message) => message.id)).toEqual(["system"])
    expect(agentClient.clearSession).not.toHaveBeenCalled()
  })

  it("fences a held refusal-refresh GET immediately on feed clear and refetches when busy settles", async () => {
    const store = harness(), stale = deferred<HistoryResponse>()
    const applied: string[][] = [], update = store.getState().updateSession
    vi.spyOn(store.getState(), "updateSession").mockImplementation((sid, next, options) => {
      if (next.messages) applied.push(next.messages.map((message) => message.id))
      update(sid, next, options)
    })
    store.setState({ conversationClears: { "fixture/a": { busy: false, error: "authority_conflict" } },
      refreshChatsNow: vi.fn(async () => {}) })
    vi.mocked(agentClient.getHistory).mockReturnValueOnce(stale.promise).mockResolvedValueOnce(cleared)
    const refresh = store.getState().refreshConversationClear("fixture/a").catch((error: unknown) => error)
    expect(store.getState().conversationClears["fixture/a"]?.busy).toBe(true)
    store.getState().reconcileClearedConversation("fixture/a")
    expect(agentClient.getHistory).toHaveBeenCalledTimes(1)
    stale.resolve(old)
    expect(await refresh).toMatchObject({ name: "AbortError" })
    await vi.waitFor(() => expect(agentClient.getHistory).toHaveBeenCalledTimes(2))
    expect(applied).toEqual([["system"]])
    expect(store.getState().chats[0].messages.map((message) => message.id)).toEqual(["system"])
    expect(agentClient.clearSession).not.toHaveBeenCalled()
  })

  it("defers a feed-clear read during an in-flight mutation and flushes it without another POST", async () => {
    const store = harness(), write = deferred<void>()
    vi.mocked(agentClient.clearSession).mockReturnValueOnce(write.promise)
    const action = store.getState().clearConversation("fixture/a")
    await vi.waitFor(() => expect(agentClient.clearSession).toHaveBeenCalledTimes(1))
    store.getState().reconcileClearedConversation("fixture/a")
    expect(agentClient.getHistory).not.toHaveBeenCalled()
    write.resolve(); await action
    await vi.waitFor(() => expect(agentClient.getHistory).toHaveBeenCalledTimes(2))
    expect(store.getState().chats[0].messages.map((message) => message.id)).toEqual(["system"])
    expect(agentClient.clearSession).toHaveBeenCalledTimes(1)
  })

  it("keeps replacement intent when the 300ms message-appended read supersedes a clear GET", async () => {
    vi.useFakeTimers()
    const store = harness(), held = deferred<HistoryResponse>()
    const deleted = Array.from({ length: 5 }, (_, n) => ({ ...old.messages[0], id: `deleted-${n}` }))
    store.setState({ chats: [{ ...store.getState().chats[0], messages: mapHistoryMessagesToUi("fixture/a", deleted) }],
      clearPendingQuestion: vi.fn() })
    const shorter = { ...cleared, messages: [...cleared.messages, { ...old.messages[0], id: "after-clear", content: "new conversation" }] }
    vi.mocked(agentClient.getHistory).mockReturnValueOnce(held.promise).mockResolvedValueOnce(shorter)
    store.getState().reconcileClearedConversation("fixture/a")
    store.getState().reconcileOpenSession("fixture/a", "message_appended")
    await vi.advanceTimersByTimeAsync(300)
    expect(agentClient.getHistory).toHaveBeenCalledTimes(2)
    expect(store.getState().chats[0].messages.map((message) => message.id)).toEqual(["system", "after-clear"])
    held.resolve({ ...old, messages: deleted }); await Promise.resolve()
    expect(store.getState().chats[0].messages.map((message) => message.id)).toEqual(["system", "after-clear"])
    expect(agentClient.clearSession).not.toHaveBeenCalled()
  })

  it("retains replacement intent and token evidence when detail fails, until a fresh read succeeds", async () => {
    const store = harness()
    const usage = { systemTokens: 1, summaryTokens: 2, windowTokens: 3, totalTokens: 6, budgetLimit: 100 }
    store.getState().updateTokenUsage("fixture/a", usage)
    vi.mocked(agentClient.getSession).mockRejectedValueOnce(new Error("detail unavailable"))
    store.getState().reconcileClearedConversation("fixture/a")
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())
    expect(store.getState().chats[0].messages.map((message) => message.id)).toEqual(["old"])
    expect(store.getState().tokenUsages["fixture/a"]).toBe(usage)
    await store.getState().loadChatHistory("fixture/a", { mode: "monotonic", throwOnError: true })
    expect(store.getState().chats[0].messages.map((message) => message.id)).toEqual(["system"])
    expect(store.getState().tokenUsages["fixture/a"]).toBeUndefined()
  })

  it.each([false, true])("replaces both live/config token caches from authoritative detail, new usage=%s", async (newUsage) => {
    const store = harness(), before = { systemTokens: 1, summaryTokens: 2, windowTokens: 3, totalTokens: 6, budgetLimit: 100,
      cacheReadInputTokens: 99, prefixCache: { inputTokens: 1, cacheCreationInputTokens: 2, cacheReadInputTokens: 99 } }
    store.getState().updateTokenUsage("fixture/a", before)
    store.getState().updateTokenUsage("fixture/b", before)
    const other = store.getState().tokenUsages["fixture/b"]
    store.getState().setTruncationInfo("fixture/a", true, 9)
    store.getState().updateSession("fixture/a", { config: { ...store.getState().chats[0].config, tokenUsage: before } }, { skipBackendPatch: true })
    const usage: TokenBudgetUsage = { system_tokens: 1, summary_tokens: 0, window_tokens: 1, total_tokens: 2,
      budget_limit: 100, truncation_occurred: false, segments_removed: 0 }
    vi.mocked(agentClient.getSession).mockResolvedValue({ session: { ...summary(), ...(newUsage ? { token_usage: usage } : {}) } })
    store.getState().reconcileClearedConversation("fixture/a")
    await vi.waitFor(() => expect(store.getState().chats[0].messages.map((message) => message.id)).toEqual(["system"]))
    expect(store.getState().chats[0].config.tokenUsage?.totalTokens).toBe(newUsage ? 2 : undefined)
    expect(store.getState().tokenUsages["fixture/a"]?.totalTokens).toBe(newUsage ? 2 : undefined)
    expect(store.getState().tokenUsages["fixture/a"]?.prefixCache).toBeUndefined()
    expect(store.getState().tokenUsages["fixture/a"]?.cacheReadInputTokens ?? 0).toBe(0)
    expect(store.getState().truncationOccurred["fixture/a"]).toBeUndefined()
    expect(store.getState().segmentsRemoved["fixture/a"]).toBeUndefined()
    expect(store.getState().tokenUsages["fixture/b"]).toBe(other)
    expect(agentClient.clearSession).not.toHaveBeenCalled()
  })
})
