import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

import {
  agentClient,
  type HistoryResponse,
  type SessionSummary,
} from "@services/chat/AgentService";
import type { AppState } from "../..";
import { createChatSlice, hasTerminalAssistantTail } from "../chatSessionSlice";
import { mapHistoryMessagesToUi, sessionSummaryToChatItem } from "./messageMapping";

const summary = (id = "session-1"): SessionSummary => ({
  id,
  kind: "root",
  title: "History sync",
  title_version: 0,
  pinned: false,
  root_session_id: id,
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

const harness = (ids = ["session-1"]) => {
  const store = createStore<AppState>()((set, get, api) => ({
    ...createChatSlice(set, get, api),
    executionBySession: {},
  } as AppState));
  store.setState({
    chats: ids.map((id) => sessionSummaryToChatItem(summary(id))),
    currentSessionId: ids[0] ?? null,
  });
  return store;
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

afterEach(() => {
  vi.useRealTimers();
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

  it("applies an appended queued user message without waiting for an assistant tail", async () => {
    vi.useFakeTimers();
    const queuedHistory: HistoryResponse = {
      ...staleToolTail,
      messages: [
        ...staleToolTail.messages,
        {
          id: "queued-user",
          role: "user",
          content: "use this correction next",
          created_at: "2026-09-19T12:00:03Z",
        },
      ],
    };
    const getHistory = vi.spyOn(agentClient, "getHistory").mockResolvedValue(queuedHistory);
    vi.spyOn(agentClient, "getPendingQuestion").mockResolvedValue({
      has_pending_question: false,
    });
    const store = harness();

    store.getState().reconcileOpenSession("session-1", "message_appended");
    await vi.advanceTimersByTimeAsync(300);

    expect(getHistory).toHaveBeenCalledTimes(1);
    expect(store.getState().chats[0].messages.at(-1)).toMatchObject({
      id: "queued-user",
      role: "user",
      content: "use this correction next",
    });
  });
});


describe("explicit history read outcomes", () => {
  it("rejects opted-in failures without changing messages, and supports a later read-only retry", async () => {
    const store = harness()
    const before = store.getState().chats[0]
    const failure = new Error("503 unavailable")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const read = vi.spyOn(agentClient, "getHistory").mockRejectedValueOnce(failure).mockResolvedValueOnce(committedHistory)
    await expect(store.getState().loadChatHistory("session-1", { throwOnError: true })).rejects.toBe(failure)
    expect(store.getState().chats[0]).toBe(before)
    expect(read).toHaveBeenCalledTimes(1)
    await store.getState().loadChatHistory("session-1", { throwOnError: true })
    expect(store.getState().chats[0].messages.at(-1)?.id).toBe("assistant-final")
  })

  it("does not apply an aborted old read over a newer read for the same session", async () => {
    const store = harness()
    let resolve!: (value: HistoryResponse) => void
    vi.spyOn(agentClient, "getHistory").mockImplementationOnce(() => new Promise((done) => { resolve = done }))
      .mockResolvedValueOnce(committedHistory)
    const controller = new AbortController()
    const abandoned = store.getState().loadChatHistory("session-1", { throwOnError: true, signal: controller.signal })
    const cancelled = expect(abandoned).rejects.toMatchObject({ name: "AbortError" })
    controller.abort()
    await store.getState().loadChatHistory("session-1", { throwOnError: true })
    resolve({ session_id: "session-1", messages: [] })
    await cancelled
    expect(store.getState().chats[0].messages.at(-1)?.id).toBe("assistant-final")
  })

  it("keeps legacy best-effort callers compatible and rejects foreign history for explicit reads", async () => {
    const store = harness()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(agentClient, "getHistory").mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce({ session_id: "another-session", messages: [] })
    await expect(store.getState().loadChatHistory("session-1")).resolves.toBeUndefined()
    await expect(store.getState().loadChatHistory("session-1", { throwOnError: true })).rejects.toThrow("History session mismatch")
    expect(store.getState().chats[0].messageCount).toBe(3)
  })
})

describe("concurrent history read authority", () => {
  const completedTool: HistoryResponse = {
    ...committedHistory,
    messages: committedHistory.messages.map((message) => message.role === "tool" ? {
      ...message,
      content: '{"exit_code":0,"stdout":"done"}',
      tool_success: true,
      metadata: { status: "completed", exit_code: 0 },
    } : message),
  };
  const incomplete = [
    { name: "missing tool result", history: { ...staleToolTail, messages: staleToolTail.messages.slice(0, 2) } },
    { name: "running tool result", history: { ...staleToolTail, messages: staleToolTail.messages.map((message) => message.role === "tool"
      ? { ...message, content: "running", metadata: { status: "running" } } : message) } },
  ];

  it.each(incomplete)("ignores an older $name after a newer completed/exit-0 history applies, without Abort", async ({ history }) => {
    const old = deferred<HistoryResponse>();
    const fresh = deferred<HistoryResponse>();
    const read = vi.spyOn(agentClient, "getHistory").mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const store = harness();
    const older = store.getState().loadChatHistory("session-1");
    const newer = store.getState().loadChatHistory("session-1");
    fresh.resolve(completedTool);
    await newer;
    const published = store.getState().chats[0];
    expect(published.messages.find((message) => message.id === "assistant-tool")).toMatchObject({ metadata: { status: "completed", exit_code: 0 } });
    expect(published.messages.find((message) => message.id === "tool-1")).toMatchObject({ type: "tool_result", isError: false, result: { result: '{"exit_code":0,"stdout":"done"}' } });
    old.resolve(history);
    await older;
    expect(store.getState().chats[0]).toBe(published);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("confirms a genuine current-store monotonic no-op with strict=%s", async (strict) => {
    const pending = deferred<HistoryResponse>();
    vi.spyOn(agentClient, "getHistory").mockReturnValueOnce(pending.promise);
    const store = harness();
    const reading = store.getState().loadChatHistory("session-1", { mode: "monotonic", throwOnError: strict });
    const messages = mapHistoryMessagesToUi("session-1", completedTool.messages);
    store.getState().updateSession("session-1", { messages, messageCount: 12 });
    pending.resolve(staleToolTail);
    await expect(reading).resolves.toBeUndefined();
    expect(store.getState().chats[0].messages).toBe(messages);
    expect(store.getState().chats[0].messageCount).toBe(12);
  });

  it("keeps reads for different sessions independent", async () => {
    const a = deferred<HistoryResponse>();
    const b = deferred<HistoryResponse>();
    vi.spyOn(agentClient, "getHistory").mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const store = harness(["a", "b"]);
    const first = store.getState().loadChatHistory("a");
    const second = store.getState().loadChatHistory("b");
    b.resolve({ ...completedTool, session_id: "b" });
    await second;
    a.resolve({ ...completedTool, session_id: "a" });
    await first;
    for (const chat of store.getState().chats) expect(chat.messages.at(-1)?.id).toBe("assistant-final");
  });

  it.each([false, true])("does not let an older settled read release the newer pending reader with strict=%s", async (strict) => {
    const old = deferred<HistoryResponse>();
    const fresh = deferred<HistoryResponse>();
    vi.spyOn(agentClient, "getHistory").mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const store = harness();
    const published = store.getState().chats[0];
    const older = store.getState().loadChatHistory("session-1", { throwOnError: strict });
    const outcome = older.then(() => null, (error: unknown) => error);
    const newer = store.getState().loadChatHistory("session-1");
    old.resolve(staleToolTail);
    if (strict) expect(await outcome).toMatchObject({ name: "AbortError" });
    else expect(await outcome).toBeNull();
    expect(store.getState().chats[0]).toBe(published);
    fresh.resolve(completedTool);
    await newer;
    expect(store.getState().chats[0].messages.at(-1)?.id).toBe("assistant-final");
  });

  it("keeps separate stores with the same session id independent", async () => {
    const a = deferred<HistoryResponse>();
    const b = deferred<HistoryResponse>();
    vi.spyOn(agentClient, "getHistory").mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const firstStore = harness();
    const secondStore = harness();
    const first = firstStore.getState().loadChatHistory("session-1");
    const second = secondStore.getState().loadChatHistory("session-1");
    b.resolve(completedTool);
    await second;
    a.resolve(completedTool);
    await first;
    expect(firstStore.getState().chats[0].messages.at(-1)?.id).toBe("assistant-final");
    expect(secondStore.getState().chats[0].messages.at(-1)?.id).toBe("assistant-final");
  });

  it("does not revive an old success after the newer read fails, and allows an explicit retry", async () => {
    const old = deferred<HistoryResponse>();
    const fresh = deferred<HistoryResponse>();
    const failure = new Error("newer read unavailable");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(agentClient, "getHistory").mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise).mockResolvedValueOnce(completedTool);
    const store = harness();
    const published = store.getState().chats[0];
    const older = store.getState().loadChatHistory("session-1");
    const newer = store.getState().loadChatHistory("session-1", { throwOnError: true });
    const failureOutcome = expect(newer).rejects.toBe(failure);
    fresh.reject(failure);
    await failureOutcome;
    old.resolve(staleToolTail);
    await older;
    expect(store.getState().chats[0]).toBe(published);
    await store.getState().loadChatHistory("session-1", { throwOnError: true });
    expect(store.getState().chats[0].messages.at(-1)?.id).toBe("assistant-final");
  });

  it("does not confirm discarded strict error hydration when a competing feed read fails", async () => {
    const hydration = deferred<HistoryResponse>();
    const feed = deferred<HistoryResponse>();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const read = vi.spyOn(agentClient, "getHistory").mockReturnValueOnce(hydration.promise).mockReturnValueOnce(feed.promise);
    const store = harness();
    const published = store.getState().chats[0];
    const completedEvidence = mapHistoryMessagesToUi("session-1", completedTool.messages);
    let visibleEvidence = completedEvidence;
    let historyLoaded = false;
    // A strict consumer may retire live evidence only after a confirmed read.
    // loadChatHistory itself is the real store action; only HTTP is deferred.
    const settled = store.getState().loadChatHistory("session-1", { throwOnError: true }).then(() => {
      historyLoaded = true;
      visibleEvidence = [];
      return null;
    }, (error: unknown) => error);
    const reconciling = store.getState().loadChatHistory("session-1", { mode: "monotonic" });
    feed.reject(new Error("feed history unavailable"));
    await reconciling;
    hydration.resolve(completedTool);
    expect(await settled).toMatchObject({ name: "AbortError" });
    expect(historyLoaded).toBe(false);
    expect(visibleEvidence).toBe(completedEvidence);
    expect(visibleEvidence.find((message) => message.id === "tool-1")).toMatchObject({ isError: false, result: { result: '{"exit_code":0,"stdout":"done"}' } });
    expect(store.getState().chats[0]).toBe(published);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("still rejects an opted-in old failure without issuing stale retries", async () => {
    const old = deferred<HistoryResponse>();
    const failure = new Error("old read unavailable");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const read = vi.spyOn(agentClient, "getHistory").mockReturnValueOnce(old.promise).mockResolvedValue(completedTool);
    const store = harness();
    const older = store.getState().loadChatHistory("session-1", { throwOnError: true, retries: 1, retryDelayMs: 1 });
    const outcome = older.then(() => ({ error: null }), (error: unknown) => ({ error }));
    await store.getState().loadChatHistory("session-1");
    const published = store.getState().chats[0];
    old.reject(failure);
    expect((await outcome).error).toBe(failure);
    expect(read).toHaveBeenCalledTimes(2);
    expect(store.getState().chats[0]).toBe(published);
  });

  it.each(["superseded", "aborted"])("preserves an opted-in failure when its retry delay is %s", async (reason) => {
    vi.useFakeTimers();
    const failure = new Error("retrying read unavailable");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const read = vi.spyOn(agentClient, "getHistory").mockRejectedValueOnce(failure).mockResolvedValue(completedTool);
    const store = harness();
    const controller = new AbortController();
    const older = store.getState().loadChatHistory("session-1", { throwOnError: true, retries: 1, retryDelayMs: 10, signal: controller.signal });
    const outcome = older.then(() => ({ error: null }), (error: unknown) => ({ error }));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(1);
    if (reason === "superseded") await store.getState().loadChatHistory("session-1");
    else controller.abort();
    await vi.advanceTimersByTimeAsync(10);
    expect((await outcome).error).toBe(failure);
    expect(read).toHaveBeenCalledTimes(reason === "superseded" ? 2 : 1);
  });

  it.each([false, true])("stops a superseded assistant-tail retry without reading again with strict=%s", async (strict) => {
    vi.useFakeTimers();
    const read = vi.spyOn(agentClient, "getHistory").mockResolvedValueOnce(staleToolTail).mockResolvedValue(completedTool);
    const store = harness();
    const older = store.getState().loadChatHistory("session-1", { waitForAssistant: true, retries: 1, retryDelayMs: 10, throwOnError: strict });
    const outcome = older.then(() => null, (error: unknown) => error);
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(1);
    await store.getState().loadChatHistory("session-1");
    const published = store.getState().chats[0];
    await vi.advanceTimersByTimeAsync(10);
    if (strict) expect(await outcome).toMatchObject({ name: "AbortError" });
    else expect(await outcome).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
    expect(store.getState().chats[0]).toBe(published);
  });

  it.each([false, true])("does not let a pre-aborted invocation supersede an active read with strict=%s", async (strict) => {
    const pending = deferred<HistoryResponse>();
    const read = vi.spyOn(agentClient, "getHistory").mockReturnValueOnce(pending.promise);
    const store = harness();
    const older = store.getState().loadChatHistory("session-1");
    const controller = new AbortController();
    controller.abort();
    const abandoned = store.getState().loadChatHistory("session-1", { signal: controller.signal, throwOnError: strict });
    if (strict) await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
    else await expect(abandoned).resolves.toBeUndefined();
    pending.resolve(completedTool);
    await older;
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.getState().chats[0].messages.at(-1)?.id).toBe("assistant-final");
  });

  it.each([false, true])("keeps an aborted failure's strict=%s error contract without releasing a newer reader", async (strict) => {
    const old = deferred<HistoryResponse>();
    const fresh = deferred<HistoryResponse>();
    vi.spyOn(agentClient, "getHistory").mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const store = harness();
    const controller = new AbortController();
    const older = store.getState().loadChatHistory("session-1", { signal: controller.signal, throwOnError: strict });
    const outcome = older.then(() => null, (error: unknown) => error);
    const newer = store.getState().loadChatHistory("session-1");
    controller.abort();
    const failure = new Error("abandoned failure");
    old.reject(failure);
    expect(await outcome).toBe(strict ? failure : null);
    fresh.resolve(completedTool);
    await newer;
    expect(store.getState().chats[0].messages.at(-1)?.id).toBe("assistant-final");
  });

  it("does not revive old success after the newest read is aborted, and accepts a later retry", async () => {
    const old = deferred<HistoryResponse>();
    const fresh = deferred<HistoryResponse>();
    vi.spyOn(agentClient, "getHistory").mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise).mockResolvedValueOnce(completedTool);
    const store = harness();
    const published = store.getState().chats[0];
    const older = store.getState().loadChatHistory("session-1");
    const controller = new AbortController();
    const newer = store.getState().loadChatHistory("session-1", { signal: controller.signal, throwOnError: true });
    const cancelled = expect(newer).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    fresh.resolve(completedTool);
    await cancelled;
    old.resolve(staleToolTail);
    await older;
    expect(store.getState().chats[0]).toBe(published);
    await store.getState().loadChatHistory("session-1", { throwOnError: true });
    expect(store.getState().chats[0].messages.at(-1)?.id).toBe("assistant-final");
  });

  it("preserves the explicit session-mismatch error even for a superseded read", async () => {
    const old = deferred<HistoryResponse>();
    vi.spyOn(agentClient, "getHistory").mockReturnValueOnce(old.promise).mockResolvedValueOnce(completedTool);
    const store = harness();
    const older = store.getState().loadChatHistory("session-1", { throwOnError: true });
    const outcome = expect(older).rejects.toThrow("History session mismatch");
    await store.getState().loadChatHistory("session-1");
    const published = store.getState().chats[0];
    old.resolve({ session_id: "foreign-session", messages: [] });
    await outcome;
    expect(store.getState().chats[0]).toBe(published);
  });

  it.each([false, true])("reports a removed current chat as unconfirmed with strict=%s", async (strict) => {
    const pending = deferred<HistoryResponse>();
    const read = vi.spyOn(agentClient, "getHistory").mockReturnValueOnce(pending.promise);
    const store = harness();
    const reading = store.getState().loadChatHistory("session-1", { throwOnError: strict, retries: 2, retryDelayMs: 1 });
    const outcome = reading.then(() => null, (error: unknown) => error);
    store.setState({ chats: [] });
    pending.resolve(completedTool);
    if (strict) expect(await outcome).toMatchObject({ name: "AbortError" });
    else expect(await outcome).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.getState().chats).toEqual([]);
  });
});
