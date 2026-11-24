import { afterEach, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { ApiError } from "@services/api";
import { agentClient, type HistoryResponse, type SessionSummary } from "@services/chat/AgentService";
import { managedSessionsClient } from "@services/supervisorScope/managedSessions";
import { currentUserManagedSessionsFixture } from "@services/supervisorScope/testFixtures";
import { acquireCompletedAnswerLease, getCompletedAnswerHandoffs, resetCompletedAnswerHandoffsForTest,
  retainCompletedAnswer } from "@/lib/completedAnswerHandoffRegistry";
import type { AppState } from "../..";
import { createChatSlice } from "../chatSessionSlice";
import { createTokenBudgetSlice } from "../tokenBudgetSlice";
import { sessionSummaryToChatItem } from "./messageMapping";

const id = "history-session";
const at = "2026-11-23T00:00:00Z";
const summary = (sessionId: string): SessionSummary => ({
  id: sessionId, kind: "root", title: sessionId, title_version: 0, pinned: false, root_session_id: sessionId,
  spawn_depth: 0, model: "fixture-model", created_at: at, updated_at: at, last_activity_at: at,
  message_count: 0, has_attachments: false, is_running: false,
});
type WireMessage = HistoryResponse["messages"][number];
const message = (id: string): WireMessage => ({ id, role: "user", content: `Original ${id}`, created_at: at });
const cursorAt = (index: number) => `page/${index}`;
const page = (ids: string[], total: number, start: number, sessionId = id): HistoryResponse => ({
  session_id: sessionId, messages: ids.map(message), is_delta: false, total_message_count: total, history_start_index: start,
  next_before_message_id: start ? cursorAt(start) : null,
});
const deferredHistory = () => {
  let resolve!: (value: HistoryResponse) => void;
  const promise = new Promise<HistoryResponse>((done) => { resolve = done; });
  return { promise, resolve };
};

const harness = (sessionId = id) => {
  const store = createStore<AppState>()((set, get, api) => ({
    ...createChatSlice(set, get, api), ...createTokenBudgetSlice(set, get, api), executionBySession: {},
  } as AppState));
  store.setState({ chats: [sessionSummaryToChatItem(summary(sessionId)), sessionSummaryToChatItem(summary("other"))],
    currentSessionId: sessionId, latestActiveSessionId: sessionId });
  return { store, actions: store.getState(), chat: () => store.getState().chats[0]!,
    loadEarlier: (beforePrepend = vi.fn()) => store.getState().loadEarlierChatHistory(sessionId, new AbortController().signal, beforePrepend) };
};

afterEach(() => {
  resetCompletedAnswerHandoffsForTest();
  vi.restoreAllMocks();
});

it("recovers a transcript beyond the legacy cap, including compressed originals and tool pairs", async () => {
  const { actions, chat, loadEarlier } = harness();
  const transcript = Array.from({ length: 2005 }, (_, index) => message(`m${index}`));
  transcript[0] = { ...transcript[0], compressed: true, compressed_by_event_id: "compact-1", content_parts: [
    { type: "image_url", image_url: { url: `bamboo-attachment://${id}/original.png` } },
  ] };
  transcript[1904] = { ...transcript[1904], role: "assistant", tool_calls: [
    { id: "tool-1", type: "function", function: { name: "Read", arguments: "{}" } },
  ] };
  transcript[1905] = { ...transcript[1905], role: "system" };
  transcript[1906] = { ...transcript[1906], role: "tool", tool_call_id: "tool-1", content: "Original tool result" };
  const getHistory = vi.spyOn(agentClient, "getHistory").mockImplementation(async (_, since, __, request) => {
    expect(since).toBeUndefined();
    expect(request?.limit).toBe(100);
    const end = request?.before_message_id
      ? Number(request.before_message_id.split("/")[1]) : transcript.length;
    expect(end).toBeGreaterThan(0);
    let start = Math.max(0, end - 100);
    while (start > 0 && ["tool", "system"].includes(transcript[start].role)) start--;
    return { session_id: id, messages: transcript.slice(start, end), is_delta: false, total_message_count: transcript.length,
      history_start_index: start, next_before_message_id: start ? cursorAt(start) : null };
  });
  await actions.loadChatHistory(id, { throwOnError: true });
  expect(chat().historyWindow?.beforeMessageId).toBe(cursorAt(1904));
  expect(chat().messages.slice(0, 4)).toMatchObject([
    { id: "m1904_text" }, { id: "m1904", type: "tool_call" }, { id: "m1905", role: "system" },
    { id: "m1906", type: "tool_result", toolName: "Read" },
  ]);
  for (let count = 0; count < 21 && chat().historyWindow?.beforeMessageId; count++) await loadEarlier();
  expect(getHistory).toHaveBeenCalledTimes(21);
  expect(chat().historyWindow).toEqual({ beforeMessageId: null, startIndex: 0, messageIds: transcript.map((item) => item.id) });
  expect(chat().messages[0]).toMatchObject({
    id: "m0", content: "Original m0", isCompressed: true, compressedEventId: "compact-1",
    images: [{ url: expect.stringContaining(`/sessions/${id}/attachments/original.png`) }],
  });
  expect(chat().config.syncCursor).toMatchObject({ messageCount: 2005, lastMessageId: "m2004" });
});

it("retains a completed older page while the latest page advances during and after the read", async () => {
  const { actions, chat, loadEarlier } = harness();
  const older = deferredHistory();
  vi.spyOn(agentClient, "getHistory")
    .mockResolvedValueOnce(page(["m3", "m4"], 4, 2))
    .mockImplementationOnce(() => older.promise)
    .mockResolvedValueOnce(page(["m4", "m5"], 5, 3))
    .mockResolvedValueOnce(page(["m5", "m6"], 6, 4));
  await actions.loadChatHistory(id);
  const capture = vi.fn();
  const pending = loadEarlier(capture);
  await actions.loadChatHistory(id, { mode: "monotonic", throwOnError: true });
  older.resolve(page(["m1", "m2"], 4, 0));
  await pending;
  expect(capture).toHaveBeenCalledOnce();
  expect(chat().messages.map((item) => item.id)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
  expect(chat().config.syncCursor).toMatchObject({ messageCount: 5, lastMessageId: "m5" });
  await actions.loadChatHistory(id, { throwOnError: true });
  expect(chat().messages.map((item) => item.id)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
  expect(chat().historyWindow?.beforeMessageId).toBeNull();
});

it("retires stale reads and replaces a deleted prefix even when a normal refresh wins the race", async () => {
  const { actions, chat, loadEarlier } = harness();
  const removed = { ...message("duplicate"), content: "Deleted original" };
  const kept = { ...message("duplicate"), content: "Retained original" };
  const recent = { ...message("duplicate"), content: "Recent original" };
  const tail = message("tail");
  const previous = [message("older-a"), message("older-b")];
  const before = [removed, ...previous, kept, recent, tail];
  const after = [...previous, kept, recent, tail];
  const reply = (messages: WireMessage[], total: number, start: number) =>
    ({ ...page(messages.map((item) => item.id), total, start), messages });
  const contents = () => chat().messages.map((item) => "content" in item ? item.content : undefined);
  const staleRead = deferredHistory();
  const deletionRead = deferredHistory();
  vi.spyOn(agentClient, "getHistory")
    .mockResolvedValueOnce(reply(before, before.length, 0))
    .mockImplementationOnce(() => staleRead.promise)
    .mockImplementationOnce(() => deletionRead.promise)
    .mockResolvedValueOnce(reply(after.slice(3), after.length, 3))
    .mockResolvedValueOnce(reply(after.slice(0, 3), after.length, 0));
  await actions.loadChatHistory(id, { throwOnError: true });
  expect(contents()).toContain(removed.content);
  const stale = expect(actions.loadChatHistory(id, { throwOnError: true })).rejects.toMatchObject({ name: "AbortError" });
  actions.invalidateHistoryAfterMessageDelete(id, removed.id);
  expect(chat().historyWindow?.invalidated).toBe(true);
  expect(contents()).not.toContain(removed.content);
  staleRead.resolve(reply(before, before.length, 0));
  await stale;
  const superseded = expect(actions.loadChatHistory(id, { resetHistoryWindow: true, throwOnError: true }))
    .rejects.toMatchObject({ name: "AbortError" });
  await actions.loadChatHistory(id, { mode: "monotonic", throwOnError: true });
  expect(chat().historyWindow?.invalidated).toBeUndefined();
  expect(contents()).toEqual([recent.content, tail.content]);
  deletionRead.resolve(reply(after.slice(3), after.length, 3));
  await superseded;
  await loadEarlier();
  expect(contents()).toEqual(after.map((item) => item.content));
});

it("bridges a disjoint append burst with the verified forward delta and retains already loaded earlier pages", async () => {
  const { actions, chat, loadEarlier } = harness();
  const ids = Array.from({ length: 212 }, (_, index) => `m${index}`);
  const reader = vi.spyOn(agentClient, "getHistory")
    .mockResolvedValueOnce(page(ids.slice(2, 4), 4, 2))
    .mockResolvedValueOnce(page(ids.slice(0, 2), 4, 0))
    .mockResolvedValueOnce(page(ids.slice(112), 212, 112))
    .mockResolvedValueOnce({ session_id: id, is_delta: true, messages: ids.slice(4).map(message), total_message_count: 208 });
  await actions.loadChatHistory(id, { throwOnError: true });
  await loadEarlier();
  await actions.loadChatHistory(id, { mode: "monotonic", throwOnError: true });
  expect(reader).toHaveBeenLastCalledWith(id, "m3", undefined, undefined);
  expect(chat().messages.map((item) => item.id)).toEqual(ids);
  expect(chat().historyWindow?.beforeMessageId).toBeNull();
  expect(chat().config.syncCursor).toMatchObject({ messageCount: 212, lastMessageId: "m211" });
});

it("bridges with opaque pages when a reused ID makes the forward delta ambiguous", async () => {
  const { actions, chat } = harness();
  const reader = vi.spyOn(agentClient, "getHistory")
    .mockResolvedValueOnce(page(["duplicate", "duplicate"], 2, 0))
    .mockResolvedValueOnce(page(["m4", "m5"], 6, 4))
    .mockResolvedValueOnce({ session_id: id, is_delta: true, messages: ["duplicate", "m2", "m3", "m4", "m5"].map(message) })
    .mockResolvedValueOnce(page(["m2", "m3"], 6, 2))
    .mockResolvedValueOnce(page(["duplicate", "duplicate"], 6, 0));
  await actions.loadChatHistory(id, { throwOnError: true });
  await actions.loadChatHistory(id, { mode: "monotonic", throwOnError: true });
  expect(reader).toHaveBeenLastCalledWith(id, undefined, undefined, { limit: 100, before_message_id: cursorAt(2) });
  expect(chat().messages.map((item) => item.id)).toEqual(["duplicate", "duplicate", "m2", "m3", "m4", "m5"]);
  expect(chat().config.syncCursor).toMatchObject({ messageCount: 6, lastMessageId: "m5" });
});

it.each([false, true])("hydrates a cold terminal turn beyond 100 records with a later tool delivery=%s", async (laterDelivery) => {
  const { actions, chat } = harness();
  const finalText = "The confirmed final text";
  const toolHistory: WireMessage[] = Array.from({ length: 52 }, (_, index) => [
    { ...message(`call-${index}`), role: "assistant" as const, content: "",
      tool_calls: [{ id: `tool-${index}`, type: "function", function: { name: "Read", arguments: "{}" } }] },
    { ...message(`result-${index}`), role: "tool" as const, content: `tool result ${index}`, tool_call_id: `tool-${index}` },
  ]).flat();
  const transcript = [message("acknowledged-user"), ...toolHistory,
    { ...message("final"), role: "assistant" as const, phase: "final_answer", content: finalText }];
  if (laterDelivery) transcript.push(
    { ...message("delivery-call"), role: "assistant", content: "",
      tool_calls: [{ id: "delivery", type: "function", function: { name: "Read", arguments: "{}" } }] },
    { ...message("delivery-result"), role: "tool", tool_call_id: "delivery" },
  );
  const start = laterDelivery ? 7 : 5;
  const response = page([], transcript.length, start);
  response.messages = transcript.slice(start);
  const older = page([], transcript.length, 0);
  older.messages = transcript.slice(0, start);
  const reader = vi.spyOn(agentClient, "getHistory").mockResolvedValueOnce(response).mockResolvedValueOnce(older);
  const lease = acquireCompletedAnswerLease(id);
  retainCompletedAnswer(lease, {
    sessionId: id, operationId: 1, handoffId: "long-terminal", text: finalText,
    acknowledgedMessageId: "acknowledged-user", baselineMessageId: null, baselineMessageIds: new Set(), anchorSeen: false,
  });
  await actions.loadChatHistory(id, { mode: "monotonic", waitForAssistant: true, retries: 1, throwOnError: true });
  expect(reader).toHaveBeenLastCalledWith(id, undefined, undefined, { limit: 100, before_message_id: cursorAt(start) });
  expect(lease.confirmed).toBe(true);
  expect(getCompletedAnswerHandoffs()).toEqual([]);
  expect(chat().messages.filter((item) => item.id === "final")).toHaveLength(1);
  expect(chat().messages[0]?.id).toBe("acknowledged-user");
  expect(chat().config.syncCursor).toMatchObject({ messageCount: transcript.length, lastMessageId: transcript.at(-1)?.id });
});

it("retires an earlier response across an A → B → A selection", async () => {
  const { actions, chat, loadEarlier } = harness();
  const older = deferredHistory();
  vi.spyOn(agentClient, "getHistory").mockResolvedValueOnce(page(["m2"], 2, 1)).mockReturnValueOnce(older.promise);
  await actions.loadChatHistory(id);
  const pending = loadEarlier();
  actions.selectSession("other");
  actions.selectSession(id);
  older.resolve(page(["m1"], 2, 0));
  await pending;
  expect(chat().messages.map((item) => item.id)).toEqual(["m2"]);
  expect(chat().historyWindow?.beforeMessageId).toBe(cursorAt(1));
});

it("retires a pending earlier page before cross-client clear reconciliation", async () => {
  const { actions, chat, loadEarlier } = harness();
  const older = deferredHistory();
  vi.spyOn(agentClient, "getHistory").mockResolvedValueOnce(page(["m2"], 2, 1))
    .mockReturnValueOnce(older.promise).mockResolvedValueOnce(page([], 0, 0));
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: summary(id) });
  await actions.loadChatHistory(id);
  const pending = loadEarlier();
  actions.reconcileClearedConversation(id);
  older.resolve(page(["m1"], 2, 0));
  await pending;
  await vi.waitFor(() => expect(chat().messages).toEqual([]));
  expect(chat().historyWindow?.beforeMessageId).toBeNull();
  expect(chat().config.syncCursor).toMatchObject({ messageCount: 0, lastMessageId: null });
});

it("refuses a bound prefix read when the retained Supervisor authority is no longer accepted", async () => {
  const fixture = currentUserManagedSessionsFixture();
  const selection = { supervisor: fixture.scope.supervisor, target: fixture.sessions[0]!.current_user_target! };
  const sessionId = selection.target.session_id;
  const { store, actions, chat } = harness(sessionId);
  const binding = { selection, status: "active" as const };
  store.setState({ managedHistoryBindings: { [sessionId]: binding } });
  const refusal = new ApiError("Target changed", 409, "Conflict", '{"code":"target_observation_stale"}');
  const readBound = vi.spyOn(managedSessionsClient, "readBoundHistory")
    .mockResolvedValueOnce({ ...page(["m2"], 2, 1, sessionId), bound_token_usage: null })
    .mockRejectedValueOnce(refusal);
  const unbound = vi.spyOn(agentClient, "getHistory");
  await actions.loadChatHistory(sessionId, { throwOnError: true });
  const displayed = chat();
  await expect(actions.readHistoryPrefix(sessionId, displayed.historyWindow!, () => true)).rejects.toBe(refusal);
  expect(readBound).toHaveBeenLastCalledWith(selection, {
    page: { limit: 100, before_message_id: cursorAt(1) }, signal: expect.any(AbortSignal),
  });
  expect(unbound).not.toHaveBeenCalled();
  expect(chat()).toBe(displayed);
});

it("retires a read-only prefix across clear without republishing the old history", async () => {
  const { actions, chat } = harness();
  const older = deferredHistory();
  const reader = vi.spyOn(agentClient, "getHistory").mockResolvedValueOnce(page(["m2"], 2, 1))
    .mockReturnValueOnce(older.promise).mockResolvedValueOnce(page([], 0, 0));
  vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: summary(id) });
  await actions.loadChatHistory(id);
  const exportRead = actions.readHistoryPrefix(id, chat().historyWindow!, () => true);
  const outcome = expect(exportRead).rejects.toMatchObject({ name: "AbortError" });
  actions.reconcileClearedConversation(id);
  expect(reader.mock.calls[1][2]?.aborted).toBe(true);
  older.resolve(page(["m1"], 2, 0));
  await outcome;
  await vi.waitFor(() => expect(chat().messages).toEqual([]));
  expect(chat().historyWindow?.beforeMessageId).toBeNull();
});

it("re-establishes a stale cursor using the latest page", async () => {
  const { actions, chat, loadEarlier } = harness();
  vi.spyOn(agentClient, "getHistory").mockResolvedValueOnce(page(["m3", "m4"], 4, 2))
    .mockResolvedValueOnce(page(["m2"], 4, 1))
    .mockRejectedValueOnce(new ApiError("cursor changed", 409, "Conflict", '{"error":{"code":"history_cursor_stale"}}'))
    .mockResolvedValueOnce(page(["m3", "m4"], 3, 1));
  await actions.loadChatHistory(id);
  await loadEarlier();
  expect(chat().historyWindow?.beforeMessageId).toBe(cursorAt(1));
  await loadEarlier();
  expect(chat().messages.map((item) => item.id)).toEqual(["m3", "m4"]);
  expect(chat().historyWindow?.beforeMessageId).toBe(cursorAt(1));
});

it("preserves distinct legacy occurrences even if they reuse a Bamboo message ID", async () => {
  const { actions, chat, loadEarlier } = harness();
  const older = page(["same"], 2, 0);
  older.messages[0].content = "Earlier occurrence";
  const read = vi.spyOn(agentClient, "getHistory").mockResolvedValueOnce(page(["same"], 2, 1)).mockResolvedValueOnce(older);
  await actions.loadChatHistory(id, { throwOnError: true });
  await loadEarlier();
  expect(read).toHaveBeenLastCalledWith(id, undefined, expect.any(AbortSignal), { limit: 100, before_message_id: cursorAt(1) });
  expect(chat().messages).toMatchObject([
    { id: "same", historyIndex: 0, content: "Earlier occurrence" },
    { id: "same", historyIndex: 1, content: "Original same" },
  ]);
  expect(chat().config.syncCursor).toMatchObject({ messageCount: 2, lastMessageId: "same" });
});

it("reconciles assistant text monotonically against its own duplicate ID occurrence", async () => {
  const { actions, chat } = harness();
  const initial = page(["same", "same"], 2, 0);
  initial.messages = [
    { ...initial.messages[0], role: "assistant", content: "Original" },
    { ...initial.messages[1], role: "assistant", content: "Original extra" },
  ];
  const advanced = page(["same", "same", "next"], 3, 0);
  advanced.messages = [...initial.messages, advanced.messages[2]];
  vi.spyOn(agentClient, "getHistory").mockResolvedValueOnce(initial).mockResolvedValueOnce(advanced);
  await actions.loadChatHistory(id, { throwOnError: true });
  await actions.loadChatHistory(id, { mode: "monotonic", throwOnError: true });
  expect(chat().messages.slice(0, 2)).toMatchObject([
    { id: "same", historyIndex: 0, content: "Original" },
    { id: "same", historyIndex: 1, content: "Original extra" },
  ]);
  expect(chat().config.syncCursor).toMatchObject({ messageCount: 3, lastMessageId: "next" });
});

it("carries unpositioned live assistant text into only the latest matching durable occurrence", async () => {
  const { actions, chat } = harness();
  const initial = page(["same"], 1, 0);
  initial.messages[0] = { ...initial.messages[0], role: "assistant", content: "Original" };
  const advanced = page(["same", "same", "next"], 3, 0);
  advanced.messages[0] = initial.messages[0];
  advanced.messages[1] = { ...advanced.messages[1], role: "assistant", content: "Current" };
  vi.spyOn(agentClient, "getHistory").mockResolvedValueOnce(initial).mockResolvedValueOnce(advanced);
  await actions.loadChatHistory(id, { throwOnError: true });
  await actions.addMessage(id, { id: "same", role: "assistant", type: "text", content: "Current live suffix", createdAt: at });
  await actions.loadChatHistory(id, { mode: "monotonic", throwOnError: true });
  expect(chat().messages.slice(0, 2)).toMatchObject([
    { id: "same", historyIndex: 0, content: "Original" },
    { id: "same", historyIndex: 1, content: "Current live suffix" },
  ]);
});

it("uses the preexisting unpaged response when Bamboo ignores the initial preference", async () => {
  const { actions, chat, loadEarlier } = harness();
  const getHistory = vi.spyOn(agentClient, "getHistory").mockResolvedValue({
    session_id: id, messages: [message("m1"), message("m2")], truncated: true, total_message_count: 5000,
  });
  await actions.loadChatHistory(id, { throwOnError: true });
  await loadEarlier();
  expect(getHistory).toHaveBeenCalledOnce();
  expect(chat().historyWindow).toBeUndefined();
  expect(chat().messages.map((item) => item.id)).toEqual(["m1", "m2"]);
  expect(chat().config.syncCursor).toMatchObject({ messageCount: 2, lastMessageId: "m2" });
});

it("reads older bound history through the currently selected Supervisor authority", async () => {
  const fixture = currentUserManagedSessionsFixture();
  const selection = { supervisor: fixture.scope.supervisor, target: fixture.sessions[0]!.current_user_target! };
  const sessionId = selection.target.session_id;
  const { store, actions, chat, loadEarlier } = harness(sessionId);
  store.setState({ managedHistoryBindings: { [sessionId]: { selection, status: "active" } } });
  const reader = vi.spyOn(managedSessionsClient, "readBoundHistory")
    .mockResolvedValueOnce({ ...page(["m2"], 2, 1, sessionId), bound_token_usage: null })
    .mockResolvedValueOnce({ ...page(["m1"], 2, 0, sessionId), bound_token_usage: null });
  const generic = vi.spyOn(agentClient, "getHistory");
  await actions.loadChatHistory(sessionId, { throwOnError: true });
  await loadEarlier();
  expect(chat().messages.map((item) => item.id)).toEqual(["m1", "m2"]);
  expect(reader).toHaveBeenNthCalledWith(2, selection, { page: { limit: 100, before_message_id: cursorAt(1) }, signal: expect.any(AbortSignal) });
  expect(generic).not.toHaveBeenCalled();
});
