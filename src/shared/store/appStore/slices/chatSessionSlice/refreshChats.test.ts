import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import {
  agentClient,
  type ListSessionsResponse,
  type SessionSummary,
} from "@services/chat/AgentService";
import type { AppState } from "../../";
import { createChatSlice } from "../chatSessionSlice";
import { sessionSummaryToChatItem } from "./messageMapping";
import {
  applySessionsList,
  executeLoadSubagentSessions,
  listAllSessionPages,
} from "./refreshChats";

const summary = (
  id: string,
  options: {
    kind?: "root" | "child";
    rootSessionId?: string;
    parentSessionId?: string | null;
    subagentCount?: number;
    title?: string;
  } = {},
): SessionSummary => {
  const kind = options.kind ?? "root";
  const rootSessionId = options.rootSessionId ?? id;
  return {
    id,
    kind,
    title: options.title ?? `Session ${id}`,
    title_version: 0,
    pinned: false,
    parent_session_id: options.parentSessionId ?? (kind === "child" ? rootSessionId : null),
    root_session_id: rootSessionId,
    spawn_depth: kind === "child" ? 1 : 0,
    model: "fixture-model",
    created_at: "2026-09-16T00:00:00Z",
    updated_at: "2026-09-16T00:00:00Z",
    last_activity_at: "2026-09-16T00:00:00Z",
    message_count: 0,
    has_attachments: false,
    is_running: false,
    subagent_count: options.subagentCount ?? 0,
  };
};

const page = (
  sessions: SessionSummary[],
  offset: number,
  nextOffset?: number,
): ListSessionsResponse => ({
  sessions,
  total: sessions.length + (nextOffset ?? offset),
  limit: 2,
  offset,
  ...(nextOffset === undefined ? {} : { next_offset: nextOffset }),
});

const minimalStore = (sessions: SessionSummary[]) =>
  createStore<AppState>(() => ({
    chats: sessions.map(sessionSummaryToChatItem),
    currentSessionId: sessions[0]?.id ?? null,
    latestActiveSessionId: sessions[0]?.id ?? null,
    executionBySession: {},
    reconcileSessionPermissionModes: vi.fn(),
  }) as unknown as AppState);

const chatStore = () =>
  createStore<AppState>()((set, get, api) => ({
    ...createChatSlice(set, get, api),
    executionBySession: {},
    resetSessionPermissionModes: vi.fn(),
    reconcileSessionPermissionModes: vi.fn(),
  }) as unknown as AppState);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lazy session index loading", () => {
  it("follows every filtered page and deduplicates rows if a mutable offset shifts", async () => {
    const listSessions = vi.fn()
      .mockResolvedValueOnce(page([summary("root-3"), summary("root-2")], 0, 2))
      .mockResolvedValueOnce(page([summary("root-2"), summary("root-1")], 2));

    const result = await listAllSessionPages(
      { kind: "root", limit: 2 },
      { listSessions },
    );

    expect(result.map((session) => session.id)).toEqual(["root-3", "root-2", "root-1"]);
    expect(listSessions.mock.calls).toEqual([
      [{ kind: "root", limit: 2, offset: 0 }],
      [{ kind: "root", limit: 2, offset: 2 }],
    ]);
  });

  it("fails closed when a filtered response leaks a row from another scope", async () => {
    const listSessions = vi.fn().mockResolvedValueOnce(
      page([summary("child-b", { kind: "child", rootSessionId: "root-b" })], 0),
    );
    await expect(listAllSessionPages(
      { kind: "child", root_session_id: "root-a" },
      { listSessions },
    )).rejects.toThrow("another root tree");
  });

  it("refreshes roots without discarding an already-hydrated child tree", () => {
    const root = summary("root", { subagentCount: 1 });
    const child = summary("child", { kind: "child", rootSessionId: "root" });
    const store = minimalStore([root, child]);
    const childBefore = store.getState().chats[1];

    applySessionsList(
      [{ ...root, title: "Fresh root", title_version: 1 }],
      store.setState,
      { kind: "roots" },
    );

    expect(store.getState().chats.map((chat) => chat.id)).toEqual(["root", "child"]);
    expect(store.getState().chats[0].title).toBe("Fresh root");
    expect(store.getState().chats[1]).toBe(childBefore);
  });

  it("drops an orphaned child tree when its root disappears", () => {
    const rootA = summary("root-a", { subagentCount: 1 });
    const rootB = summary("root-b", { subagentCount: 1 });
    const childA = summary("child-a", { kind: "child", rootSessionId: "root-a" });
    const childB = summary("child-b", { kind: "child", rootSessionId: "root-b" });
    const store = minimalStore([rootA, rootB, childA, childB]);

    applySessionsList([rootA], store.setState, { kind: "roots" });

    expect(store.getState().chats.map((chat) => chat.id)).toEqual(["root-a", "child-a"]);
  });

  it("replaces only the requested child tree and removes deleted children", () => {
    const rootA = summary("root-a", { subagentCount: 1 });
    const rootB = summary("root-b", { subagentCount: 1 });
    const oldA = summary("old-a", { kind: "child", rootSessionId: "root-a" });
    const childB = summary("child-b", { kind: "child", rootSessionId: "root-b" });
    const store = minimalStore([rootA, rootB, oldA, childB]);
    const unrelatedBefore = store.getState().chats[3];
    const freshA = summary("fresh-a", { kind: "child", rootSessionId: "root-a" });

    applySessionsList([freshA], store.setState, {
      kind: "children",
      rootSessionId: "root-a",
    });

    expect(store.getState().chats.map((chat) => chat.id)).toEqual([
      "root-a",
      "root-b",
      "child-b",
      "fresh-a",
    ]);
    expect(store.getState().chats.find((chat) => chat.id === "child-b")).toBe(unrelatedBefore);
  });

  it("removes a stale tree without a request when the root reports no children", async () => {
    const root = summary("root", { subagentCount: 0 });
    const stale = summary("stale", { kind: "child", rootSessionId: "root" });
    const store = minimalStore([root, stale]);
    const list = vi.spyOn(agentClient, "listSessions");

    await executeLoadSubagentSessions("root", store.setState, store.getState);

    expect(list).not.toHaveBeenCalled();
    expect(store.getState().chats.map((chat) => chat.id)).toEqual(["root"]);
  });

  it("coalesces duplicate tree hydration and requests only that root", async () => {
    const root = summary("root/a", { subagentCount: 2 });
    const childA = summary("child/a", { kind: "child", rootSessionId: "root/a" });
    const childB = summary("child/b", { kind: "child", rootSessionId: "root/a" });
    const store = minimalStore([root]);
    const pending = deferred<ListSessionsResponse>();
    const list = vi.spyOn(agentClient, "listSessions")
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ sessions: [childB], total: 2, limit: 200, offset: 1 });

    const first = executeLoadSubagentSessions("root/a", store.setState, store.getState);
    const second = executeLoadSubagentSessions("root/a", store.setState, store.getState);
    expect(list).toHaveBeenCalledExactlyOnceWith({
      kind: "child",
      root_session_id: "root/a",
      limit: 200,
      offset: 0,
    });

    pending.resolve({
      sessions: [childA],
      total: 2,
      limit: 200,
      offset: 0,
      next_offset: 1,
    });
    await Promise.all([first, second]);
    expect(list.mock.calls).toEqual([
      [{ kind: "child", root_session_id: "root/a", limit: 200, offset: 0 }],
      [{ kind: "child", root_session_id: "root/a", limit: 200, offset: 1 }],
    ]);
    expect(store.getState().chats.map((chat) => chat.id)).toEqual([
      "root/a",
      "child/a",
      "child/b",
    ]);
  });

  it("bootstraps through root-only pages and never calls the legacy unfiltered list", async () => {
    const newest = summary("root-new");
    const older = summary("root-old");
    const store = chatStore();
    const list = vi.spyOn(agentClient, "listSessions")
      .mockResolvedValueOnce({
        sessions: [newest],
        total: 2,
        limit: 200,
        offset: 0,
        next_offset: 1,
      })
      .mockResolvedValueOnce({ sessions: [older], total: 2, limit: 200, offset: 1 });
    vi.spyOn(agentClient, "getRunningSessions").mockResolvedValueOnce({ sessions: [] });
    vi.spyOn(agentClient, "getHistory").mockResolvedValueOnce({
      session_id: "root-new",
      messages: [],
    });

    await store.getState().loadChats();

    expect(list.mock.calls).toEqual([
      [{ kind: "root", limit: 200, offset: 0 }],
      [{ kind: "root", limit: 200, offset: 1 }],
    ]);
    expect(store.getState().chats.map((chat) => chat.id)).toEqual(["root-new", "root-old"]);
  });

  it("restores a persisted child through detail lookup and its own root tree", async () => {
    const root = summary("root", { subagentCount: 1 });
    const child = summary("child", { kind: "child", rootSessionId: "root" });
    const store = chatStore();
    const detail = vi.spyOn(agentClient, "getSession")
      .mockResolvedValueOnce({ session: child })
      .mockResolvedValueOnce({ session: root });
    vi.spyOn(agentClient, "listSessions").mockResolvedValueOnce({
      sessions: [child],
      total: 1,
      limit: 200,
      offset: 0,
    });

    await expect(store.getState().restoreSession("child")).resolves.toBe(true);
    expect(detail.mock.calls).toEqual([["child"], ["root"]]);
    expect(store.getState().chats.map((chat) => chat.id)).toEqual(["root", "child"]);
  });
});
