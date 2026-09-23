import { beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock("@services/api", () => ({ apiClient: api }))

import {
  agentClient,
  MessageHistoryContractError,
  type MessageHistoryResponse,
} from "./AgentService"

const response = (): MessageHistoryResponse => ({
  session_id: "child/a ?",
  projection: "messages",
  messages: [
    {
      id: "user-1",
      role: "user",
      content: "question",
      created_at: "2026-09-22T00:00:00Z",
    },
    {
      id: "assistant-1",
      role: "assistant",
      content: "answer",
      created_at: "2026-09-22T00:00:01Z",
    },
  ],
  is_delta: false,
  truncated: false,
  total_message_count: 2,
})

beforeEach(() => {
  api.get.mockReset().mockResolvedValue(response())
})

describe("message-only history transport", () => {
  it("requests only the projected endpoint and encodes opaque ids and cursors", async () => {
    await expect(agentClient.getMessageHistory("child/a ?", "message/1 ?")).resolves.toEqual(response())

    expect(api.get).toHaveBeenCalledExactlyOnceWith(
      "sessions/child%2Fa%20%3F/history?projection=messages&since_message_id=message%2F1+%3F",
      { cache: "no-store" },
    )
  })

  it("accepts an exact empty projected response", async () => {
    const empty: MessageHistoryResponse = {
      session_id: "child/a ?",
      projection: "messages",
      messages: [],
      is_delta: false,
      truncated: false,
      total_message_count: 0,
    }
    api.get.mockResolvedValueOnce(empty)

    await expect(agentClient.getMessageHistory("child/a ?")).resolves.toEqual(empty)
  })

  it.each([
    ["top-level reasoning", { reasoning: "private" }],
    ["top-level metadata", { metadata: { private: true } }],
    ["top-level tool calls", { tool_calls: [{ name: "private" }] }],
  ])("rejects %s instead of widening the safe response", async (_label, extra) => {
    api.get.mockResolvedValueOnce({ ...response(), ...extra })

    await expect(agentClient.getMessageHistory("child/a ?"))
      .rejects.toBeInstanceOf(MessageHistoryContractError)
  })

  it.each([
    ["reasoning", { reasoning: "private" }],
    ["metadata", { metadata: { private: true } }],
    ["tool calls", { tool_calls: [{ name: "private" }] }],
    ["content parts", { content_parts: [{ type: "image" }] }],
  ])("rejects a projected message carrying %s", async (_label, extra) => {
    const value = response()
    api.get.mockResolvedValueOnce({
      ...value,
      messages: [{ ...value.messages[0], ...extra }],
    })

    await expect(agentClient.getMessageHistory("child/a ?"))
      .rejects.toBeInstanceOf(MessageHistoryContractError)
  })

  it("rejects role expansion and mismatched session identity", async () => {
    const value = response()
    api.get
      .mockResolvedValueOnce({
        ...value,
        messages: [{ ...value.messages[0], role: "tool" }],
      })
      .mockResolvedValueOnce({ ...value, session_id: "other-child" })

    await expect(agentClient.getMessageHistory("child/a ?"))
      .rejects.toBeInstanceOf(MessageHistoryContractError)
    await expect(agentClient.getMessageHistory("child/a ?"))
      .rejects.toBeInstanceOf(MessageHistoryContractError)
  })
})
