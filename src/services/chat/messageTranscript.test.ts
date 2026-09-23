import { describe, expect, it } from "vitest"

import type { MessageHistoryResponse } from "./AgentService"
import {
  applyMessageChannelControl,
  applyMessageChannelEvent,
  applyMessageHistory,
  emptyMessageTranscript,
  messageTranscriptToUi,
} from "./messageTranscript"

const createdAt = "2026-09-22T00:00:00Z"
const history = (
  messages: MessageHistoryResponse["messages"],
  isDelta = false,
): MessageHistoryResponse => ({
  session_id: "child-1",
  projection: "messages",
  messages,
  is_delta: isDelta,
  truncated: false,
  total_message_count: messages.length,
})

describe("message-only transcript merge", () => {
  it("merges replay and deltas that arrive before projected history without duplication", () => {
    let state = emptyMessageTranscript()
    state = applyMessageChannelEvent(state, {
      type: "snapshot",
      version: 2,
      messages: [{ id: "assistant-1", content: "before", created_at: createdAt }],
      history_committed: false,
    })
    state = applyMessageChannelEvent(state, {
      type: "delta",
      version: 3,
      message_id: "assistant-1",
      offset: 6,
      content: " after",
      created_at: createdAt,
    })
    state = applyMessageHistory(state, history([
      { id: "user-1", role: "user", content: "question", created_at: createdAt },
      { id: "assistant-1", role: "assistant", content: "before", created_at: createdAt },
    ]))

    expect(messageTranscriptToUi(state).map((message) => [message.id, "content" in message ? message.content : null]))
      .toEqual([
        ["user-1", "question"],
        ["assistant-1", "before after"],
      ])
  })

  it("uses UTF-8 byte offsets and ignores duplicate versions", () => {
    let state = applyMessageChannelEvent(emptyMessageTranscript(), {
      type: "snapshot",
      version: 4,
      messages: [{ id: "assistant-1", content: "你好", created_at: createdAt }],
      history_committed: false,
    })
    state = applyMessageChannelEvent(state, {
      type: "delta",
      version: 5,
      message_id: "assistant-1",
      offset: 6,
      content: "！",
      created_at: createdAt,
    })
    state = applyMessageChannelEvent(state, {
      type: "delta",
      version: 5,
      message_id: "assistant-1",
      offset: 6,
      content: "duplicate",
      created_at: createdAt,
    })

    expect(state.live[0]?.content).toBe("你好！")
    expect(state.needsReconcile).toBe(true)
  })

  it("flags a missing byte range instead of guessing at lost content", () => {
    let state = applyMessageChannelEvent(emptyMessageTranscript(), {
      type: "started",
      version: 1,
      message_id: "assistant-1",
      created_at: createdAt,
    })
    state = applyMessageChannelEvent(state, {
      type: "delta",
      version: 2,
      message_id: "assistant-1",
      offset: 3,
      content: "lost",
      created_at: createdAt,
    })

    expect(state.live[0]?.content).toBe("")
    expect(state.needsReconcile).toBe(true)
  })

  it("removes a rolled-back attempt from both history and replay", () => {
    let state = applyMessageHistory(emptyMessageTranscript(), history([
      { id: "assistant-1", role: "assistant", content: "partial", created_at: createdAt },
    ]))
    state = applyMessageChannelEvent(state, {
      type: "snapshot",
      version: 1,
      messages: [{ id: "assistant-1", content: "partial", created_at: createdAt }],
      history_committed: false,
    })
    state = applyMessageChannelEvent(state, {
      type: "discarded",
      version: 2,
      message_id: "assistant-1",
    })

    expect(messageTranscriptToUi(state)).toEqual([])
  })

  it("retains terminal replay until committed projected history succeeds", () => {
    let state = applyMessageChannelEvent(emptyMessageTranscript(), {
      type: "snapshot",
      version: 2,
      messages: [{ id: "assistant-1", content: "final answer", created_at: createdAt }],
      history_committed: false,
    })
    state = applyMessageChannelControl(state, { type: "terminal", reason: "complete" })
    state = applyMessageChannelControl(state, { type: "history_committed", version: 4 })

    expect(messageTranscriptToUi(state)).toHaveLength(1)
    expect(state.commitPending).toBe(true)

    state = applyMessageHistory(state, history([
      { id: "assistant-1", role: "assistant", content: "final answer", created_at: createdAt },
    ]))
    expect(state.live).toEqual([])
    expect(state.commitPending).toBe(false)
    expect(messageTranscriptToUi(state)).toHaveLength(1)
  })

  it("does not let a pre-commit REST response retire replay", () => {
    let state = applyMessageChannelEvent(emptyMessageTranscript(), {
      type: "snapshot",
      version: 2,
      messages: [{ id: "assistant-1", content: "final", created_at: createdAt }],
      history_committed: false,
    })
    const staleRequestRevision = state.reconcileRevision
    state = applyMessageChannelControl(state, { type: "history_committed", version: 3 })
    state = applyMessageHistory(state, history([
      { id: "assistant-1", role: "assistant", content: "final", created_at: createdAt },
    ]), staleRequestRevision)

    expect(state.live).toEqual([])
    expect(state.committedReplay).toHaveLength(1)
    expect(state.commitPending).toBe(true)
    expect(state.needsReconcile).toBe(true)

    state = applyMessageHistory(state, history([
      { id: "assistant-1", role: "assistant", content: "final", created_at: createdAt },
    ]), state.reconcileRevision)
    expect(state.live).toEqual([])
    expect(state.committedReplay).toEqual([])
    expect(state.commitPending).toBe(false)
  })

  it("preserves committed replay while a replacement runner streams", () => {
    let state = applyMessageChannelEvent(emptyMessageTranscript(), {
      type: "snapshot",
      version: 2,
      messages: [{ id: "old-final", content: "old final", created_at: createdAt }],
      history_committed: false,
    })
    state = applyMessageChannelControl(state, { type: "history_committed", version: 3 })
    const staleRequestRevision = state.reconcileRevision - 1
    state = applyMessageHistory(state, history([]), staleRequestRevision)

    state = applyMessageChannelEvent(state, {
      type: "snapshot",
      version: 0,
      messages: [{ id: "new-live", content: "new", created_at: createdAt }],
      history_committed: false,
    })
    state = applyMessageChannelEvent(state, {
      type: "delta",
      version: 1,
      message_id: "new-live",
      offset: 3,
      content: " streaming",
      created_at: createdAt,
    })

    expect(messageTranscriptToUi(state).map((message) => [message.id, "content" in message ? message.content : null]))
      .toEqual([
        ["old-final", "old final"],
        ["new-live", "new streaming"],
      ])
    expect(state.commitPending).toBe(true)

    state = applyMessageHistory(state, history([
      { id: "old-final", role: "assistant", content: "old final", created_at: createdAt },
    ]), state.reconcileRevision)

    expect(state.committedReplay).toEqual([])
    expect(state.live).toMatchObject([{ id: "new-live", content: "new streaming" }])
    expect(messageTranscriptToUi(state).map((message) => [message.id, "content" in message ? message.content : null]))
      .toEqual([
        ["old-final", "old final"],
        ["new-live", "new streaming"],
      ])
  })

  it("keeps visible replay across a committed empty snapshot until REST reconciliation", () => {
    let state = applyMessageChannelEvent(emptyMessageTranscript(), {
      type: "snapshot",
      version: 3,
      messages: [{ id: "assistant-1", content: "visible", created_at: createdAt }],
      history_committed: false,
    })
    state = applyMessageChannelEvent(state, {
      type: "snapshot",
      version: 4,
      messages: [],
      history_committed: true,
      terminal: "complete",
    })

    expect(messageTranscriptToUi(state)[0]).toMatchObject({ id: "assistant-1", content: "visible" })
    expect(state.commitPending).toBe(true)
  })

  it("accepts a replacement runner snapshot even when its version restarts", () => {
    let state = applyMessageChannelEvent(emptyMessageTranscript(), {
      type: "snapshot",
      version: 10,
      messages: [{ id: "old", content: "old", created_at: createdAt }],
      history_committed: false,
    })
    state = applyMessageChannelEvent(state, {
      type: "snapshot",
      version: 0,
      messages: [{ id: "new", content: "new", created_at: createdAt }],
      history_committed: false,
    })

    expect(state.live.map((message) => message.id)).toEqual(["new"])
    expect(state.liveVersion).toBe(0)
  })
})
