import { createRoot, createSignal, flush } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MessageHistoryResponse } from "@services/chat/AgentService"
import type { MessageChannelHandlers } from "@services/chat/v2Stream"

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  getMessageHistory: vi.fn(),
  subscriptions: new Map<string, { handlers: MessageChannelHandlers; close: ReturnType<typeof vi.fn> }>(),
  reconnectListeners: new Set<() => void>(),
}))

vi.mock("@services/chat/AgentService", () => ({
  agentClient: {
    getMessageHistory: (...args: unknown[]) => {
      mocks.order.push(`history:${String(args[0])}`)
      return mocks.getMessageHistory(...args)
    },
  },
}))

vi.mock("@services/chat/v2Stream", () => ({
  subscribeMessages: (sessionId: string, handlers: MessageChannelHandlers) => {
    mocks.order.push(`subscribe:${sessionId}`)
    const close = vi.fn()
    mocks.subscriptions.set(sessionId, { handlers, close })
    return { close }
  },
  onReconnected: (listener: () => void) => {
    mocks.reconnectListeners.add(listener)
    return () => mocks.reconnectListeners.delete(listener)
  },
}))

import { createSubagentTranscript, type SubagentTranscript } from "./createSubagentTranscript"

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const history = (
  sessionId: string,
  messages: MessageHistoryResponse["messages"],
): MessageHistoryResponse => ({
  session_id: sessionId,
  projection: "messages",
  messages,
  is_delta: false,
  truncated: false,
  total_message_count: messages.length,
})

const createdAt = "2026-09-22T00:00:00Z"
let dispose: () => void
let current: SubagentTranscript
let renderSession: (sessionId: string | null) => void

const flushUpdate = (update: () => void) => {
  update()
  flush()
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  flush()
}

beforeEach(() => {
  mocks.order.length = 0
  mocks.getMessageHistory.mockReset()
  mocks.subscriptions.clear()
  mocks.reconnectListeners.clear()
  createRoot((cleanup) => {
    const [id, setId] = createSignal<string | null>(null)
    dispose = cleanup
    current = createSubagentTranscript(id)
    renderSession = (sessionId) => flushUpdate(() => setId(sessionId))
  })
  flush()
})

afterEach(() => {
  dispose()
  vi.unstubAllGlobals()
})

describe("createSubagentTranscript", () => {
  it("scopes the truncation notice to the selected child", async () => {
    mocks.getMessageHistory
      .mockResolvedValueOnce({ ...history("child-1", []), truncated: true })
      .mockResolvedValueOnce(history("child-2", []))

    renderSession("child-1")
    await flushMicrotasks()
    expect(current.truncated).toBe(true)

    renderSession("child-2")
    expect(current.truncated).toBe(false)
    await flushMicrotasks()
    expect(current.truncated).toBe(false)
  })

  it("subscribes to the safe live channel before requesting projected history", async () => {
    mocks.getMessageHistory.mockResolvedValue(history("child-1", []))

    renderSession("child-1")
    await flushMicrotasks()

    expect(mocks.order.slice(0, 2)).toEqual([
      "subscribe:child-1",
      "history:child-1",
    ])
    expect(current).toMatchObject({ loading: false, messages: [], error: null })
  })

  it("shows replay and live deltas while the initial history request is still pending", async () => {
    const initial = deferred<MessageHistoryResponse>()
    mocks.getMessageHistory
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValue(history("child-1", [
        { id: "user-1", role: "user", content: "question", created_at: createdAt },
        { id: "assistant-1", role: "assistant", content: "before", created_at: createdAt },
      ]))

    renderSession("child-1")
    const handlers = mocks.subscriptions.get("child-1")!.handlers
    flushUpdate(() => {
      handlers.onEvent({
        type: "snapshot",
        version: 2,
        messages: [{ id: "assistant-1", content: "before", created_at: createdAt }],
        history_committed: false,
      })
      handlers.onEvent({
        type: "delta",
        version: 3,
        message_id: "assistant-1",
        offset: 6,
        content: " after",
        created_at: createdAt,
      })
    })

    expect(current.messages).toMatchObject([
      { id: "assistant-1", content: "before after" },
    ])
    expect(current.loading).toBe(true)

    initial.resolve(history("child-1", [
      { id: "user-1", role: "user", content: "question", created_at: createdAt },
      { id: "assistant-1", role: "assistant", content: "before", created_at: createdAt },
    ]))
    await flushMicrotasks()

    expect(mocks.getMessageHistory).toHaveBeenCalledTimes(2)
    expect(current.messages).toMatchObject([
      { id: "user-1", content: "question" },
      { id: "assistant-1", content: "before after" },
    ])
  })

  it("keeps final replay visible until a post-commit history request succeeds", async () => {
    const beforeCommit = deferred<MessageHistoryResponse>()
    const afterCommit = deferred<MessageHistoryResponse>()
    mocks.getMessageHistory
      .mockReturnValueOnce(beforeCommit.promise)
      .mockReturnValueOnce(afterCommit.promise)

    renderSession("child-1")
    const handlers = mocks.subscriptions.get("child-1")!.handlers
    flushUpdate(() => {
      handlers.onEvent({
        type: "snapshot",
        version: 2,
        messages: [{ id: "assistant-1", content: "final", created_at: createdAt }],
        history_committed: false,
      })
      handlers.onControl({ type: "terminal", reason: "complete" })
      handlers.onControl({ type: "history_committed", version: 4 })
    })

    beforeCommit.resolve(history("child-1", [
      { id: "assistant-1", role: "assistant", content: "final", created_at: createdAt },
    ]))
    await flushMicrotasks()

    expect(mocks.getMessageHistory).toHaveBeenCalledTimes(2)
    expect(current.messages).toMatchObject([{ id: "assistant-1", content: "final" }])

    afterCommit.resolve(history("child-1", [
      { id: "assistant-1", role: "assistant", content: "final", created_at: createdAt },
    ]))
    await flushMicrotasks()

    expect(current.messages).toMatchObject([{ id: "assistant-1", content: "final" }])
    expect(current.loading).toBe(false)
  })

  it("does not retry projected history for every token after a request failure", async () => {
    mocks.getMessageHistory.mockRejectedValue(new Error("offline"))

    renderSession("child-1")
    await flushMicrotasks()
    expect(mocks.getMessageHistory).toHaveBeenCalledTimes(1)

    const handlers = mocks.subscriptions.get("child-1")!.handlers
    flushUpdate(() => {
      handlers.onEvent({
        type: "started",
        version: 1,
        message_id: "assistant-1",
        created_at: createdAt,
      })
    })
    await flushMicrotasks()
    expect(mocks.getMessageHistory).toHaveBeenCalledTimes(2)

    flushUpdate(() => {
      handlers.onEvent({
        type: "delta",
        version: 2,
        message_id: "assistant-1",
        offset: 0,
        content: "stream",
        created_at: createdAt,
      })
      handlers.onEvent({
        type: "delta",
        version: 3,
        message_id: "assistant-1",
        offset: 6,
        content: "ing",
        created_at: createdAt,
      })
    })
    await flushMicrotasks()

    expect(mocks.getMessageHistory).toHaveBeenCalledTimes(2)
    expect(current.messages).toMatchObject([
      { id: "assistant-1", content: "streaming" },
    ])
    expect(current.error).not.toBeNull()
  })

  it("closes the old channel and rejects stale responses and events after a rapid switch", async () => {
    const first = deferred<MessageHistoryResponse>()
    mocks.getMessageHistory.mockImplementation((sessionId: string) =>
      sessionId === "child-1"
        ? first.promise
        : Promise.resolve(history("child-2", [
            { id: "child-2-user", role: "user", content: "new child", created_at: createdAt },
          ])),
    )

    renderSession("child-1")
    const oldSubscription = mocks.subscriptions.get("child-1")!
    renderSession("child-2")
    await flushMicrotasks()

    expect(oldSubscription.close).toHaveBeenCalledTimes(1)
    expect(current.messages).toMatchObject([{ id: "child-2-user", content: "new child" }])

    flushUpdate(() => {
      oldSubscription.handlers.onEvent({
        type: "snapshot",
        version: 9,
        messages: [{ id: "stale", content: "old child", created_at: createdAt }],
        history_committed: false,
      })
    })
    first.resolve(history("child-1", [
      { id: "stale-history", role: "assistant", content: "old history", created_at: createdAt },
    ]))
    await flushMicrotasks()

    expect(current.messages).toMatchObject([{ id: "child-2-user", content: "new child" }])
  })
})
