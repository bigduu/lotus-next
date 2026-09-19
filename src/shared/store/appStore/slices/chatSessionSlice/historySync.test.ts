import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

import {
  agentClient,
  type HistoryResponse,
  type SessionSummary,
} from "@services/chat/AgentService";
import type { AppState } from "../..";
import { createChatSlice, hasTerminalAssistantTail } from "../chatSessionSlice";
import { sessionSummaryToChatItem } from "./messageMapping";

const summary = (): SessionSummary => ({
  id: "session-1",
  kind: "root",
  title: "History sync",
  title_version: 0,
  pinned: false,
  root_session_id: "session-1",
  spawn_depth: 0,
  model: "fixture-model",
  created_at: "2026-09-19T12:00:00Z",
  updated_at: "2026-09-19T12:00:00Z",
  last_activity_at: "2026-09-19T12:00:00Z",
  message_count: 3,
  has_attachments: false,
  is_running: false,
});

const staleToolTail: HistoryResponse = {
  session_id: "session-1",
  messages: [
    {
      id: "user-1",
      role: "user",
      content: "inspect it",
      created_at: "2026-09-19T12:00:00Z",
    },
    {
      id: "assistant-tool",
      role: "assistant",
      content: "",
      tool_calls: [{
        id: "call-1",
        type: "function",
        function: { name: "Bash", arguments: "{}" },
      }],
      created_at: "2026-09-19T12:00:01Z",
    },
    {
      id: "tool-1",
      role: "tool",
      content: "ok",
      tool_call_id: "call-1",
      created_at: "2026-09-19T12:00:02Z",
    },
  ],
};

const committedHistory: HistoryResponse = {
  ...staleToolTail,
  messages: [
    ...staleToolTail.messages,
    {
      id: "assistant-final",
      role: "assistant",
      content: "final answer",
      created_at: "2026-09-19T12:00:03Z",
    },
  ],
};

const harness = () => {
  const store = createStore<AppState>()((set, get, api) => ({
    ...createChatSlice(set, get, api),
    executionBySession: {},
  } as AppState));
  store.setState({
    chats: [sessionSummaryToChatItem(summary())],
    currentSessionId: "session-1",
  });
  return store;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("terminal history synchronization", () => {
  it("does not treat a tool tail as a committed assistant reply", () => {
    expect(hasTerminalAssistantTail(staleToolTail.messages)).toBe(false);
    expect(hasTerminalAssistantTail(committedHistory.messages)).toBe(true);
  });

  it("retries a tool-tail snapshot and applies the durable assistant tail", async () => {
    const getHistory = vi.spyOn(agentClient, "getHistory")
      .mockResolvedValueOnce(staleToolTail)
      .mockResolvedValueOnce(committedHistory);
    const store = harness();

    await store.getState().loadChatHistory("session-1", {
      waitForAssistant: true,
      retries: 1,
      retryDelayMs: 1,
    });

    expect(getHistory).toHaveBeenCalledTimes(2);
    const messages = store.getState().chats[0].messages;
    expect(messages.at(-1)).toMatchObject({
      id: "assistant-final",
      role: "assistant",
      type: "text",
      content: "final answer",
    });
  });
});
