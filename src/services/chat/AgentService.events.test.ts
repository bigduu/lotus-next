import { describe, expect, it, vi } from "vitest"

const stream = vi.hoisted(() => ({
  event: {
    type: "message_appended",
    session_id: "session-1",
    message_id: "queued-user",
    role: "user",
    content: "apply this next",
    created_at: "2026-09-21T00:00:00Z",
  },
}))

vi.mock("./v2Stream", () => ({
  subscribeAgent: vi.fn((_sessionId, handlers, dispatch) => {
    dispatch(stream.event, handlers)
    return { promise: Promise.resolve(), close: vi.fn() }
  }),
  stopAgent: vi.fn(() => false),
}))

import { AgentClient } from "./AgentService"

describe("AgentClient session event routing", () => {
  it("routes an admitted queued message instead of treating it as unknown", async () => {
    const onMessageAppended = vi.fn()

    await new AgentClient().subscribeToEvents("session-1", { onMessageAppended })

    expect(onMessageAppended).toHaveBeenCalledExactlyOnceWith(
      "session-1",
      "queued-user",
    )
  })
})
