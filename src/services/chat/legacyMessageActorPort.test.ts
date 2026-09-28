import { beforeEach, describe, expect, it, vi } from "vitest"

import type { MessageHistoryResponse } from "./AgentService"
import type { MessageChannelHandlers } from "./v2Stream"

const mocks = vi.hoisted(() => ({
  getMessageHistory: vi.fn(),
  subscribeMessages: vi.fn(),
}))

vi.mock("./AgentService", () => ({
  agentClient: { getMessageHistory: mocks.getMessageHistory },
}))
vi.mock("./v2Stream", () => ({
  subscribeMessages: mocks.subscribeMessages,
}))

import { legacyMessageActorPort } from "./legacyMessageActorPort"
import { applyActorTopologySnapshot, emptyActorTopology, type ActorTopologyRow } from "./actorTopology"
import { VisibleActorSubscriptions } from "./visibleActorSubscriptions"

const row = (actorId: string, parentActorId: string | null): ActorTopologyRow => ({
  actorId,
  rootActorId: "root",
  parentActorId,
  title: actorId,
  role: null,
  lifecycle: "running",
  placement: "local",
  health: "healthy",
  queuedCount: 0,
  waitingForCount: 0,
  pendingRequestCount: 0,
  activationAttempt: 1,
  sequence: 0,
})

beforeEach(() => {
  mocks.getMessageHistory.mockReset()
  mocks.subscribeMessages.mockReset()
})

describe("legacy message actor port", () => {
  it("uses the existing message channel, reports gaps and waits for durable terminal content", () => {
    const close = vi.fn()
    mocks.subscribeMessages.mockReturnValue({ close })
    const onEvent = vi.fn()
    const onGap = vi.fn()
    const onTerminal = vi.fn()
    const subscription = legacyMessageActorPort.subscribe("child", null, {
      onEvent, onGap, onTerminal,
    })
    expect(mocks.subscribeMessages).toHaveBeenCalledTimes(1)
    expect(mocks.subscribeMessages.mock.calls[0][0]).toBe("child")
    const handlers = mocks.subscribeMessages.mock.calls[0][1] as MessageChannelHandlers

    handlers.onEvent({ type: "started", version: 1, message_id: "m", created_at: "now" })
    handlers.onControl({ type: "terminal", reason: "complete" })
    expect(onTerminal).not.toHaveBeenCalled()
    handlers.onControl({ type: "history_committed", version: 2 })
    handlers.onControl({ type: "history_committed", version: 2 })
    expect(onTerminal).toHaveBeenCalledTimes(1)
    handlers.onControl({ type: "gap", skipped: 2 })
    expect(onGap).toHaveBeenCalledTimes(1)
    expect(onEvent.mock.calls.map(([packet]) => packet.type)).toEqual([
      "live", "control", "control", "control",
    ])
    subscription.close()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it("recovers projected history without inventing a message resume cursor", async () => {
    const response: MessageHistoryResponse = {
      session_id: "child",
      projection: "messages",
      messages: [],
      is_delta: false,
      truncated: false,
      total_message_count: 0,
    }
    mocks.getMessageHistory.mockResolvedValue(response)
    await expect(legacyMessageActorPort.recover("child", null)).resolves.toEqual({
      snapshot: { type: "history", response }, cursor: null,
    })
    expect(mocks.getMessageHistory).toHaveBeenCalledWith("child")
  })

  it("gives one shared-v2 logical channel to selected and previewed consumers", () => {
    const closes: ReturnType<typeof vi.fn>[] = []
    mocks.subscribeMessages.mockImplementation(() => {
      const close = vi.fn()
      closes.push(close)
      return { close }
    })
    const topology = applyActorTopologySnapshot(emptyActorTopology("root"), {
      rootActorId: "root", revision: 1, actors: [row("root", null), row("child", "root")],
    })
    const manager = new VisibleActorSubscriptions(topology, legacyMessageActorPort)
    const selected = manager.acquire("child", "selected", vi.fn())
    const preview = manager.acquire("child", "previewed", vi.fn())
    expect(mocks.subscribeMessages).toHaveBeenCalledTimes(1)
    selected.close()
    expect(closes[0]).not.toHaveBeenCalled()
    preview.close()
    expect(closes[0]).toHaveBeenCalledTimes(1)
  })
})
