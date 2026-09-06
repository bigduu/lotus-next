import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import {
  agentClient,
  SessionPermissionContractError,
  type HistoryResponse,
  type SessionPermissionMode,
  type SessionPermissionSnapshot,
  type SessionSummary,
} from "@services/chat/AgentService";
import { ApiError, NetworkRequestError } from "@services/api";
import type { AppState } from "../";
import { createChatSlice } from "./chatSessionSlice";
import { createPermissionModeSlice } from "./permissionModeSlice";
import { sessionSummaryToChatItem } from "./chatSessionSlice/messageMapping";
import { applySessionsList } from "./chatSessionSlice/refreshChats";
import { canReuseSessionListChat } from "./chatSessionSlice/equality";

const read = vi.fn<typeof agentClient.getSessionPermissionMode>();
const patch = vi.fn<typeof agentClient.patchSessionPermissionMode>();
const list = vi.fn<typeof agentClient.listSessions>();

const summary = (id = "a", mode: SessionPermissionMode | undefined = "default"): SessionSummary => ({
  id, kind: "root", title: `Session ${id}`, title_version: 0, pinned: false,
  root_session_id: id, spawn_depth: 0, model: "fixture-model",
  created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
  last_activity_at: "2026-09-06T00:00:00Z", message_count: 0,
  has_attachments: false, is_running: false, permission_mode: mode,
  bypass_permissions: mode !== "default",
});
const snapshot = (mode: SessionPermissionMode, etag = '"7"', sessionId = "a"): SessionPermissionSnapshot => ({ sessionId, mode, etag });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function harness(summaries = [summary()]) {
  const store = createStore<AppState>()((set, get, api) => ({
    ...createChatSlice(set, get, api),
    ...createPermissionModeSlice(set, get, api),
    executionBySession: {},
  } as AppState));
  store.setState({ chats: summaries.map(sessionSummaryToChatItem), currentSessionId: summaries[0]?.id ?? null });
  return store;
}
const config = (store: ReturnType<typeof harness>, id = "a") => store.getState().chats.find((chat) => chat.id === id)!.config;
async function ready(store: ReturnType<typeof harness>, mode: SessionPermissionMode = "default", etag = '"7"', id = "a") {
  read.mockResolvedValueOnce(snapshot(mode, etag, id));
  await store.getState().refreshSessionPermissionMode(id);
  expect(store.getState().permissionModeRequests[id].status).toBe("ready");
}

beforeEach(() => {
  read.mockReset().mockImplementation(async (id) => snapshot("default", '"7"', id));
  patch.mockReset(); list.mockReset();
  vi.spyOn(agentClient, "getSessionPermissionMode").mockImplementation(read);
  vi.spyOn(agentClient, "patchSessionPermissionMode").mockImplementation(patch);
  vi.spyOn(agentClient, "listSessions").mockImplementation(list);
});

describe("server-authoritative session permission state", () => {
  it("does not trust a summary or a restored-looking ETag before a real detail read", async () => {
    const store = harness([summary("a", "auto")]);
    store.setState({ chats: store.getState().chats.map((chat) => ({ ...chat, config: { ...chat.config, permissionModeEtag: '"7"' } })) });
    await store.getState().changeSessionPermissionMode("a", "bypass", '"7"');
    expect(patch).not.toHaveBeenCalled();
    read.mockRejectedValueOnce(new SessionPermissionContractError());
    await store.getState().refreshSessionPermissionMode("a");
    expect(store.getState().permissionModeRequests.a).toMatchObject({ status: "unsupported", error: "unsupported" });
    await store.getState().changeSessionPermissionMode("a", "default", '"7"');
    expect(patch).not.toHaveBeenCalled();
  });

  it("never maps a missing/unknown typed mode from the legacy Boolean", () => {
    for (const mode of [undefined, null, "future"]) {
      const row = { ...summary(), permission_mode: mode, bypass_permissions: true } as SessionSummary;
      expect(sessionSummaryToChatItem(row).config).toMatchObject({ bypassPermissions: true, permissionMode: null });
    }
  });

  it("waits for the typed PATCH response and preserves messages, draft and other config", async () => {
    const store = harness();
    await ready(store);
    const before = store.getState().chats[0];
    const inputs: AppState["inputStates"] = {
      a: { content: "draft stays here", contentRevision: 1, referenceText: null, attachments: [], reasoningEffort: "medium" },
    };
    store.setState({ inputStates: inputs });
    const pending = deferred<SessionPermissionSnapshot>();
    patch.mockReturnValueOnce(pending.promise);
    const operation = store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    expect(patch).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(patch).toHaveBeenCalledExactlyOnceWith("a", "auto", '"7"');
    expect(config(store).permissionMode).toBe("default");
    expect(store.getState().permissionModeRequests.a.status).toBe("saving");
    pending.resolve(snapshot("auto", '"8"'));
    await operation;
    expect(config(store)).toMatchObject({ permissionMode: "auto", permissionModeEtag: '"8"', bypassPermissions: true, model: before.config.model });
    expect(store.getState().chats[0].messages).toBe(before.messages);
    expect(store.getState().inputStates).toBe(inputs);
    expect(store.getState().permissionModeRequests.a).toMatchObject({ status: "ready", error: undefined });
  });

  it("fences same-session re-entry synchronously and never queues a later write", async () => {
    const store = harness(); await ready(store);
    const pending = deferred<SessionPermissionSnapshot>(); patch.mockReturnValueOnce(pending.promise);
    const first = store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    await store.getState().changeSessionPermissionMode("a", "bypass", '"7"');
    await store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    expect(patch).toHaveBeenCalledTimes(1);
    pending.resolve(snapshot("auto", '"8"')); await first;
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it("allows another session to change while navigation cannot retarget the first request", async () => {
    const store = harness([summary(), summary("b")]);
    await ready(store); await ready(store, "default", '"3"', "b");
    const first = deferred<SessionPermissionSnapshot>();
    const second = deferred<SessionPermissionSnapshot>();
    patch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    read.mockResolvedValueOnce(snapshot("default", '"7"')).mockResolvedValueOnce(snapshot("default", '"3"', "b"));
    const a = store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    store.getState().selectSession("b");
    const b = store.getState().changeSessionPermissionMode("b", "bypass", '"3"');
    second.resolve(snapshot("bypass", '"4"', "b")); await b;
    first.resolve(snapshot("auto", '"8"')); await a;
    expect(patch.mock.calls).toEqual([["a", "auto", '"7"'], ["b", "bypass", '"3"']]);
    expect(config(store, "a").permissionMode).toBe("auto");
    expect(config(store, "b").permissionMode).toBe("bypass");
    expect(store.getState().currentSessionId).toBe("b");
  });

  it("rejects a stale confirmation token before contacting the server", async () => {
    const store = harness(); await ready(store);
    await store.getState().changeSessionPermissionMode("a", "auto", '"6"');
    expect(patch).not.toHaveBeenCalled();
    expect(store.getState().permissionModeRequests.a.error).toBe("changed");
  });

  it("preflights a metadata-only revision bump and sends exactly one PATCH with the fresh exact ETag", async () => {
    const store = harness(); await ready(store, "default", '"0"');
    read.mockResolvedValueOnce(snapshot("default", '"1"'));
    patch.mockResolvedValueOnce(snapshot("bypass", '"2"'));
    await store.getState().changeSessionPermissionMode("a", "bypass", '"0"');
    expect(patch).toHaveBeenCalledExactlyOnceWith("a", "bypass", '"1"');
    expect(read).toHaveBeenCalledTimes(2);
    expect(config(store)).toMatchObject({ permissionMode: "bypass", permissionModeEtag: '"2"' });
    expect(store.getState().permissionModeRequests.a).toMatchObject({ status: "ready", error: undefined });
  });

  it.each(["bypass", "auto"] as const)("requires re-selection when preflight finds mode %s instead of the observed mode", async (freshMode) => {
    const store = harness(); await ready(store);
    read.mockResolvedValueOnce(snapshot(freshMode, '"8"'));
    await store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    expect(patch).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(2);
    expect(config(store)).toMatchObject({ permissionMode: freshMode, permissionModeEtag: '"8"' });
    expect(store.getState().permissionModeRequests.a).toMatchObject({ status: "ready", error: "changed" });
  });

  it.each([
    [new NetworkRequestError(), "unconfirmed"],
    [new SessionPermissionContractError(), "unsupported"],
  ] as const)("fails closed without PATCH when preflight cannot confirm support: %s", async (error, status) => {
    const store = harness(); await ready(store);
    read.mockRejectedValueOnce(error);
    await store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    expect(patch).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(2);
    expect(config(store)).toMatchObject({ permissionMode: "default", permissionModeEtag: '"7"' });
    expect(store.getState().permissionModeRequests.a.status).toBe(status);
  });

  it.each([snapshot("default", '"6"'), snapshot("auto", '"7"'), snapshot("default", '"8"', "wrong-id")])(
    "never writes from a stale or inconsistent preflight snapshot", async (incoming) => {
      const store = harness(); await ready(store);
      read.mockResolvedValueOnce(incoming);
      await store.getState().changeSessionPermissionMode("a", "auto", '"7"');
      expect(patch).not.toHaveBeenCalled();
      expect(store.getState().permissionModeRequests.a).toMatchObject({ status: "unconfirmed", error: "stale" });
    },
  );

  it("holds the synchronous fence during preflight and never writes after that session is reset", async () => {
    const store = harness(); await ready(store);
    const pending = deferred<SessionPermissionSnapshot>(); read.mockReturnValueOnce(pending.promise);
    const first = store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    expect(store.getState().permissionModeRequests.a.status).toBe("saving");
    await store.getState().changeSessionPermissionMode("a", "bypass", '"7"');
    expect(read).toHaveBeenCalledTimes(2); expect(patch).not.toHaveBeenCalled();
    store.getState().resetSessionPermissionModes(["a"]);
    pending.resolve(snapshot("default", '"8"')); await first;
    expect(patch).not.toHaveBeenCalled();
    expect(store.getState().permissionModeRequests.a).toBeUndefined();
  });

  it("reconciles a 412 once without overwriting the winner or automatically retrying", async () => {
    const store = harness(); await ready(store);
    patch.mockRejectedValueOnce(new ApiError("Conflict", 412, "Precondition Failed"));
    read.mockResolvedValueOnce(snapshot("default")).mockResolvedValueOnce(snapshot("bypass", '"8"'));
    await store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    expect(config(store)).toMatchObject({ permissionMode: "bypass", permissionModeEtag: '"8"' });
    expect(store.getState().permissionModeRequests.a).toMatchObject({ status: "ready", error: "conflict" });
    expect(patch).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(3);
    read.mockResolvedValueOnce(snapshot("bypass", '"8"'));
    patch.mockResolvedValueOnce(snapshot("auto", '"9"'));
    await store.getState().changeSessionPermissionMode("a", "auto", '"8"');
    expect(patch.mock.calls[1]).toEqual(["a", "auto", '"8"']);
  });

  it("shows a rejected request only with the subsequently read server mode", async () => {
    const store = harness(); await ready(store);
    patch.mockRejectedValueOnce(new ApiError("Denied", 403, "Forbidden"));
    read.mockResolvedValueOnce(snapshot("default")).mockResolvedValueOnce(snapshot("default"));
    await store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    expect(config(store).permissionMode).toBe("default");
    expect(store.getState().permissionModeRequests.a).toMatchObject({ status: "ready", error: "rejected" });
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it("reconciles a lost response from the server without claiming PATCH success", async () => {
    const store = harness(); await ready(store);
    patch.mockRejectedValueOnce(new NetworkRequestError());
    read.mockResolvedValueOnce(snapshot("default")).mockResolvedValueOnce(snapshot("auto", '"8"'));
    await store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    expect(config(store).permissionMode).toBe("auto");
    expect(store.getState().permissionModeRequests.a).toMatchObject({ status: "ready", error: "ambiguous" });
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it("disables unconfirmed state if both PATCH and reconciliation fail, until a read succeeds", async () => {
    const store = harness(); await ready(store);
    patch.mockRejectedValueOnce(new NetworkRequestError());
    read.mockResolvedValueOnce(snapshot("default")).mockRejectedValueOnce(new NetworkRequestError());
    await store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    expect(store.getState().permissionModeRequests.a).toMatchObject({ status: "unconfirmed", error: "unconfirmed" });
    await store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    expect(patch).toHaveBeenCalledTimes(1);
    await ready(store, "auto", '"8"');
    expect(config(store).permissionMode).toBe("auto");
  });

  it("cannot let a pre-PATCH session-index request roll back the confirmed mode", async () => {
    const store = harness(); await ready(store);
    const stale = deferred<{ sessions: SessionSummary[] }>(); list.mockReturnValueOnce(stale.promise);
    const refresh = store.getState().refreshChatsNow();
    patch.mockResolvedValueOnce(snapshot("auto", '"8"'));
    await store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    read.mockResolvedValueOnce(snapshot("auto", '"8"'));
    stale.resolve({ sessions: [{ ...summary(), updated_at: "2099-01-01T00:00:00Z" }] });
    await refresh;
    await vi.waitFor(() => expect(store.getState().permissionModeRequests.a.status).toBe("ready"));
    expect(config(store)).toMatchObject({ permissionMode: "auto", permissionModeEtag: '"8"', bypassPermissions: true });
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it("uses differing or unsupported summaries only as hints for revisioned reads", async () => {
    const store = harness(); await ready(store, "auto", '"8"');
    const incoming = summary("a", "bypass");
    applySessionsList([incoming], store.setState);
    expect(config(store).permissionMode).toBe("auto");
    read.mockResolvedValueOnce(snapshot("bypass", '"9"'));
    store.getState().reconcileSessionPermissionModes([incoming]);
    await vi.waitFor(() => expect(config(store).permissionMode).toBe("bypass"));
    const unsupported = { ...incoming, permission_mode: undefined };
    applySessionsList([unsupported], store.setState);
    read.mockRejectedValueOnce(new SessionPermissionContractError());
    store.getState().reconcileSessionPermissionModes([unsupported]);
    await vi.waitFor(() => expect(store.getState().permissionModeRequests.a.status).toBe("unsupported"));
    expect(patch).not.toHaveBeenCalled();
  });

  it.each([false, true])("consumes a newer summary hint after an older detail read (previously confirmed: %s)", async (previouslyConfirmed) => {
    const store = harness();
    if (previouslyConfirmed) await ready(store);
    const oldRead = deferred<SessionPermissionSnapshot>();
    const followupRead = deferred<SessionPermissionSnapshot>();
    read.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(followupRead.promise);
    const operation = store.getState().refreshSessionPermissionMode("a");
    const incoming = summary("a", "auto");
    applySessionsList([incoming], store.setState);
    store.getState().reconcileSessionPermissionModes([incoming]);
    store.getState().reconcileSessionPermissionModes([incoming]);
    oldRead.resolve(snapshot("default"));
    const expectedReads = previouslyConfirmed ? 3 : 2;
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(expectedReads));
    expect(store.getState().permissionModeRequests.a.status).toBe("loading");
    expect(patch).not.toHaveBeenCalled();
    followupRead.resolve(snapshot("auto", '"8"')); await operation;
    expect(read).toHaveBeenCalledTimes(expectedReads);
    expect(config(store)).toMatchObject({ permissionMode: "auto", permissionModeEtag: '"8"' });
    expect(store.getState().permissionModeRequests.a.status).toBe("ready");
  });

  it("lets failed-write reconciliation consume earlier hints without extra reads or replay", async () => {
    const store = harness(); await ready(store);
    const pending = deferred<SessionPermissionSnapshot>(); patch.mockReturnValueOnce(pending.promise);
    read.mockResolvedValueOnce(snapshot("default"))
      .mockResolvedValueOnce(snapshot("bypass", '"8"'));
    const operation = store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    await Promise.resolve();
    store.getState().reconcileSessionPermissionModes([summary("a", "bypass")]);
    pending.reject(new ApiError("Conflict", 412, "Precondition Failed")); await operation;
    expect(patch).toHaveBeenCalledExactlyOnceWith("a", "auto", '"7"');
    expect(read).toHaveBeenCalledTimes(3);
    expect(config(store).permissionMode).toBe("bypass");
    expect(store.getState().permissionModeRequests.a).toMatchObject({ status: "ready", error: "conflict" });
  });

  it("reconciles a hint received during preflight only after the single successful write settles", async () => {
    const store = harness(); await ready(store);
    const preflight = deferred<SessionPermissionSnapshot>();
    const pending = deferred<SessionPermissionSnapshot>(); patch.mockReturnValueOnce(pending.promise);
    read.mockReturnValueOnce(preflight.promise).mockResolvedValueOnce(snapshot("bypass", '"9"'));
    const operation = store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    store.getState().reconcileSessionPermissionModes([summary("a", "bypass")]);
    preflight.resolve(snapshot("default")); await Promise.resolve();
    expect(store.getState().permissionModeRequests.a.status).toBe("saving");
    expect(config(store).permissionMode).toBe("default");
    expect(patch).toHaveBeenCalledExactlyOnceWith("a", "auto", '"7"');
    pending.resolve(snapshot("auto", '"8"')); await operation;
    expect(read).toHaveBeenCalledTimes(3);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(config(store)).toMatchObject({ permissionMode: "bypass", permissionModeEtag: '"9"' });
  });

  it("does not lose a newer hint arriving during a failed-write reconciliation read", async () => {
    const store = harness(); await ready(store);
    const reconciliation = deferred<SessionPermissionSnapshot>();
    read.mockResolvedValueOnce(snapshot("default")).mockReturnValueOnce(reconciliation.promise)
      .mockResolvedValueOnce(snapshot("auto", '"9"'));
    patch.mockRejectedValueOnce(new ApiError("Conflict", 412, "Precondition Failed"));
    const operation = store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    store.getState().reconcileSessionPermissionModes([summary("a", "auto")]);
    reconciliation.resolve(snapshot("bypass", '"8"')); await operation;
    expect(read).toHaveBeenCalledTimes(4);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(config(store)).toMatchObject({ permissionMode: "auto", permissionModeEtag: '"9"' });
    expect(store.getState().permissionModeRequests.a).toMatchObject({ status: "ready", error: "conflict" });
  });

  it("hydrates late history without erasing newly confirmed permission or sending a metadata PATCH", async () => {
    const store = harness(); await ready(store);
    const metadataPatch = vi.spyOn(agentClient, "patchSession").mockResolvedValue(undefined);
    const pending = deferred<HistoryResponse>();
    vi.spyOn(agentClient, "getHistory").mockReturnValueOnce(pending.promise);
    const history = store.getState().loadChatHistory("a");
    store.getState().updateSession("a", { config: {
      ...config(store), model: "newer-model", reasoningEffort: "high",
    } }, { skipBackendPatch: true });
    patch.mockResolvedValueOnce(snapshot("auto", '"8"'));
    await store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    pending.resolve({
      session_id: "a",
      messages: [{ id: "history-message", role: "assistant", content: "Hydrated", created_at: "2026-09-06T00:01:00Z" }],
      gold_config: { enabled: true, auto_answer_enabled: false, auto_continue_enabled: false },
      compression_events: [{ id: "compression", created_at: "2026-09-06T00:01:00Z", messages_compressed: 2, segments_removed: 1 }],
    });
    await history;
    expect(config(store)).toMatchObject({
      permissionMode: "auto", permissionModeEtag: '"8"', bypassPermissions: true,
      model: "newer-model", reasoningEffort: "high", goldConfig: { enabled: true },
      compressionEvents: [{ id: "compression", messagesCompressed: 2, segmentsRemoved: 1 }],
      syncCursor: { messageCount: 1, lastMessageId: "history-message" },
    });
    expect(store.getState().chats[0].messageCount).toBe(1);
    expect(metadataPatch).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(store.getState().permissionModeRequests.a.status).toBe("ready");
  });

  it.each([
    snapshot("default", '"6"'), snapshot("auto", '"7"'), snapshot("auto", '"9"', "wrong-id"),
  ])("rejects an older or inconsistent read without changing the snapshot", async (incoming) => {
    const store = harness(); await ready(store);
    read.mockResolvedValueOnce(incoming);
    await store.getState().refreshSessionPermissionMode("a");
    expect(config(store)).toMatchObject({ permissionMode: "default", permissionModeEtag: '"7"' });
    expect(store.getState().permissionModeRequests.a).toMatchObject({ status: "unconfirmed", error: "stale" });
  });

  it("does not accept a changed mode without a newer PATCH revision", async () => {
    const store = harness(); await ready(store);
    patch.mockResolvedValueOnce(snapshot("auto", '"7"'));
    await store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    expect(config(store).permissionMode).toBe("default");
    expect(store.getState().permissionModeRequests.a).toMatchObject({ status: "unconfirmed", error: "stale" });
  });

  it("reports a newer server winner instead of pretending the requested mode won", async () => {
    const store = harness(); await ready(store);
    patch.mockResolvedValueOnce(snapshot("bypass", '"9"'));
    await store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    expect(config(store).permissionMode).toBe("bypass");
    expect(store.getState().permissionModeRequests.a.error).toBe("changed");
  });

  it("deduplicates initial reads and invalidates their late response on reset", async () => {
    const store = harness();
    const pending = deferred<SessionPermissionSnapshot>(); read.mockReturnValueOnce(pending.promise);
    const first = store.getState().refreshSessionPermissionMode("a");
    const second = store.getState().refreshSessionPermissionMode("a");
    expect(first).toBe(second); expect(read).toHaveBeenCalledTimes(1);
    store.getState().resetSessionPermissionModes();
    await ready(store, "bypass", '"9"');
    pending.resolve(snapshot("auto", '"8"')); await first;
    expect(config(store).permissionMode).toBe("bypass");
    expect(store.getState().permissionModeRequests.a.status).toBe("ready");
  });

  it("cleans root and child request state on deletion and ignores late mutations", async () => {
    const store = harness([summary(), { ...summary("child"), root_session_id: "a", parent_session_id: "a" }]);
    await ready(store); await ready(store, "default", '"1"', "child");
    const pending = deferred<SessionPermissionSnapshot>(); patch.mockReturnValueOnce(pending.promise);
    const operation = store.getState().changeSessionPermissionMode("a", "auto", '"7"');
    vi.spyOn(agentClient, "deleteSession").mockResolvedValueOnce(undefined);
    await store.getState().deleteSession("a");
    pending.resolve(snapshot("auto", '"8"')); await operation;
    expect(store.getState().chats).toEqual([]);
    expect(store.getState().permissionModeRequests).toEqual({});
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("detects permission-only changes in session-list equality", () => {
    const chat = sessionSummaryToChatItem(summary());
    for (const fields of [{ permissionMode: "auto" as const }, { permissionModeEtag: '"8"' }, { bypassPermissions: true }]) {
      expect(canReuseSessionListChat(chat, { ...chat, config: { ...chat.config, ...fields } })).toBe(false);
    }
  });
});
