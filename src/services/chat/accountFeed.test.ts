import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountStreamHandlers, ChangeEvent } from "./AgentService";

const mockState = vi.hoisted(() => ({
  handlers: null as unknown,
  options: null as unknown,
  store: null as unknown,
  reconnectedListener: null as unknown,
  subscriptionClose: vi.fn(),
  offReconnected: vi.fn(),
  subscribeToAccountStream: vi.fn(),
  isFeedOpen: vi.fn(() => true),
  onReconnected: vi.fn(),
  selectShouldObserve: vi.fn(() => () => false),
  notify: vi.fn(),
}));

vi.mock("./AgentService", async (importOriginal) => ({
  ...await importOriginal<typeof import("./AgentService")>(),
  AgentClient: {
    getInstance: () => ({
      subscribeToAccountStream: mockState.subscribeToAccountStream,
    }),
  },
}));

vi.mock("./v2Stream", () => ({
  isFeedOpen: mockState.isFeedOpen,
  onReconnected: mockState.onReconnected,
}));

vi.mock("@shared/store/appStore/state", () => ({
  appStore: {
    getState: () => mockState.store,
  },
  selectShouldObserve: mockState.selectShouldObserve,
}));

vi.mock("@/lib/notify", () => ({ notify: mockState.notify, isNotifyEnabled: () => false, notifyPermission: () => "denied" }));

import {
  isAccountFeedDisconnected,
  observeSessionTaskList,
  startAccountFeed,
  stopAccountFeed,
} from "./accountFeed";

const CURSOR_STORAGE_KEY = "lotus_account_feed_cursor_v1";

const createStore = () => ({
  currentSessionId: null as string | null,
  chats: [] as Array<{ id: string }>,
  setAgentAvailability: vi.fn(),
  refreshSessionsIndex: vi.fn(async () => {}),
  refreshChatsNow: vi.fn(async () => {}),
  reconcileOpenSession: vi.fn(),
  reconcileClearedConversation: vi.fn(),
  invalidateSessionNavigation: vi.fn(),
  applyServerTitle: vi.fn(),
  applyServerPinned: vi.fn(),
  setTaskList: vi.fn(),
  updateTaskListDelta: vi.fn(),
  loadTaskList: vi.fn(async () => null),
});

type TestStore = ReturnType<typeof createStore>;

const change = (
  seq: number,
  event: ChangeEvent["event"] = { type: "message_appended" },
): ChangeEvent => ({
  seq,
  ts: "2026-09-01T00:00:00Z",
  session_id: "session-1",
  event,
});

const capturedHandlers = (): AccountStreamHandlers =>
  mockState.handlers as AccountStreamHandlers;

describe("accountFeed cursor and reset lifecycle", () => {
  let store: TestStore;

  it("fences and refetches cleared content even for an inactive session", () => {
    store.chats = [{ id: "session-1" }];
    store.currentSessionId = "another-session";
    startAccountFeed();
    capturedHandlers().onChange(change(8, { type: "session_cleared" }));
    expect(store.reconcileClearedConversation).toHaveBeenCalledExactlyOnceWith("session-1");
    expect(store.reconcileOpenSession).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", class {});
    store = createStore();
    mockState.store = store;
    mockState.handlers = null;
    mockState.options = null;
    mockState.reconnectedListener = null;
    mockState.isFeedOpen.mockReturnValue(true);
    mockState.onReconnected.mockImplementation((listener: () => void) => {
      mockState.reconnectedListener = listener;
      return mockState.offReconnected;
    });
    mockState.subscribeToAccountStream.mockImplementation(
      (handlers, options) => {
        mockState.handlers = handlers;
        mockState.options = options;
        return { close: mockState.subscriptionClose };
      },
    );
  });

  afterEach(() => {
    stopAccountFeed();
    vi.unstubAllGlobals();
  });

  it("immediately fences pending opens when a remote session is deleted", () => {
    startAccountFeed();
    capturedHandlers().onChange(change(8, { type: "session_deleted" }));
    expect(store.invalidateSessionNavigation).toHaveBeenCalledExactlyOnceWith("session-1");
    expect(store.refreshSessionsIndex).not.toHaveBeenCalled();
  });

  it("keeps feed delivery failure authoritative over HTTP health", () => {
    startAccountFeed();
    expect(isAccountFeedDisconnected()).toBe(false);

    mockState.isFeedOpen.mockReturnValue(false);
    expect(isAccountFeedDisconnected()).toBe(true);

    stopAccountFeed();
    expect(isAccountFeedDisconnected()).toBe(false);
  });

  it.each(["1", "42", String(Number.MAX_SAFE_INTEGER)])(
    "hydrates canonical safe cursor %s",
    (raw) => {
      localStorage.setItem(CURSOR_STORAGE_KEY, raw);

      startAccountFeed();

      expect(mockState.options).toEqual({ since: Number(raw) });
    },
  );

  it.each([
    null,
    "",
    "0",
    "-1",
    "+1",
    "01",
    "1.0",
    "1e3",
    " 1",
    "1 ",
    "7junk",
    "NaN",
    "Infinity",
    String(Number.MAX_SAFE_INTEGER + 1),
  ])("fails malformed or unsafe stored cursor %s closed to zero", (raw) => {
    if (raw !== null) localStorage.setItem(CURSOR_STORAGE_KEY, raw);

    startAccountFeed();

    expect(mockState.options).toEqual({ since: 0 });
  });

  it("never overwrites a larger valid stored cursor", () => {
    localStorage.setItem(CURSOR_STORAGE_KEY, "10");
    const setItem = vi.spyOn(localStorage, "setItem");
    startAccountFeed();

    capturedHandlers().onChange(change(9, { type: "notification" }));
    capturedHandlers().onChange(change(10, { type: "notification" }));
    capturedHandlers().onChange(change(11, { type: "notification" }));
    capturedHandlers().onChange(change(10, { type: "notification" }));

    expect(localStorage.getItem(CURSOR_STORAGE_KEY)).toBe("11");
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith(CURSOR_STORAGE_KEY, "11");
  });

  it("applies a change before persisting it and does not persist an apply failure", () => {
    localStorage.setItem(CURSOR_STORAGE_KEY, "4");
    const order: string[] = [];
    const originalSetItem = localStorage.setItem.bind(localStorage);
    store.applyServerTitle.mockImplementation(() => {
      order.push("apply");
      expect(localStorage.getItem(CURSOR_STORAGE_KEY)).toBe("4");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      order.push("persist");
      originalSetItem(key, value);
    });
    startAccountFeed();

    capturedHandlers().onChange(
      change(5, {
        type: "session_title_updated",
        title: "new",
        title_version: 2,
      }),
    );

    expect(order).toEqual(["apply", "persist"]);
    expect(localStorage.getItem(CURSOR_STORAGE_KEY)).toBe("5");

    store.applyServerTitle.mockImplementationOnce(() => {
      throw new Error("apply failed");
    });
    expect(() =>
      capturedHandlers().onChange(
        change(6, {
          type: "session_title_updated",
          title: "newer",
          title_version: 3,
        }),
      ),
    ).toThrow("apply failed");
    expect(localStorage.getItem(CURSOR_STORAGE_KEY)).toBe("5");
  });

  it("offers title motion only for an explicitly live model update", () => {
    startAccountFeed();
    const { onChange } = capturedHandlers();
    const title = (seq: number, source: "auto" | "manual" | "fallback") => change(seq, {
      type: "session_title_updated", title: `Title ${seq}`, title_version: seq, title_generated: true, source,
    });
    onChange(title(1, "auto"));
    onChange(title(2, "manual"), "live");
    onChange(title(3, "fallback"), "live");
    onChange(title(4, "auto"), "live");
    expect(store.applyServerTitle.mock.calls.map((args) => args[3])).toEqual([false, false, false, true]);
  });

  it("clears the cursor before one immediate authoritative reset resync", () => {
    localStorage.setItem(CURSOR_STORAGE_KEY, "8");
    const order: string[] = [];
    const originalRemoveItem = localStorage.removeItem.bind(localStorage);
    vi.spyOn(localStorage, "removeItem").mockImplementation((key) => {
      order.push("clear");
      originalRemoveItem(key);
    });
    store.refreshChatsNow.mockImplementation(async () => {
      order.push("resync");
      expect(localStorage.getItem(CURSOR_STORAGE_KEY)).toBeNull();
    });
    startAccountFeed();

    capturedHandlers().onReset?.();

    expect(order).toEqual(["clear", "resync"]);
    expect(store.refreshChatsNow).toHaveBeenCalledTimes(1);
    expect(store.refreshSessionsIndex).not.toHaveBeenCalled();
  });

  it("cancels a pending account-feed debounce before reset resync", () => {
    startAccountFeed();
    capturedHandlers().onChange(change(1));

    capturedHandlers().onReset?.();
    vi.advanceTimersByTime(400);

    expect(store.refreshChatsNow).toHaveBeenCalledTimes(1);
    expect(store.refreshSessionsIndex).not.toHaveBeenCalled();
    expect(localStorage.getItem(CURSOR_STORAGE_KEY)).toBeNull();
  });

  it("applies Task updates only to observed Session owners and refreshes on a feed reset", () => {
    const closeFirst = observeSessionTaskList("session-1");
    const closeSecond = observeSessionTaskList("session-1");
    try {
      startAccountFeed();
      closeFirst();
      const taskList = { session_id: "session-1", title: "Plan", items: [], created_at: "", updated_at: "" };
      capturedHandlers().onChange(change(1, { type: "task_list_updated", task_list: taskList, version: 4 }));
      capturedHandlers().onChange({
        ...change(2, { type: "task_list_updated", task_list: taskList, version: 5 }),
        session_id: "other-session",
      });
      expect(store.setTaskList).toHaveBeenCalledExactlyOnceWith("session-1", { ...taskList, version: 4 });

      capturedHandlers().onReset?.();
      expect(store.loadTaskList).toHaveBeenCalledExactlyOnceWith("session-1");

      closeSecond();
      capturedHandlers().onChange(change(3, { type: "task_list_updated", task_list: taskList, version: 5 }));
      expect(store.setTaskList).toHaveBeenCalledTimes(1);
    } finally {
      closeSecond();
    }
  });

  it("forwards live Task progress only for the matching observed Session", () => {
    const close = observeSessionTaskList("session-1");
    try {
      startAccountFeed();
      const delta = { session_id: "session-1", item_id: "review", status: "in_progress", tool_calls_count: 2, version: 6 };
      const progress = { ...delta, type: "task_list_item_progress" } as const;
      capturedHandlers().onChange(change(1, progress));
      capturedHandlers().onChange(change(2, { ...progress, session_id: "other-session" }));
      capturedHandlers().onChange(change(3, { ...progress, status: "unknown" }));
      expect(store.updateTaskListDelta).toHaveBeenCalledExactlyOnceWith("session-1", delta);

      close();
      capturedHandlers().onChange(change(4, { ...progress, version: 7 }));
      expect(store.updateTaskListDelta).toHaveBeenCalledTimes(1);
    } finally {
      close();
    }
  });

  it.each(["message_appended", "complete", "session_history_committed"] as const)(
    "uses the %s WebSocket change to reconcile the open conversation",
    (eventType) => {
      store.currentSessionId = "session-1";
      startAccountFeed();

      capturedHandlers().onChange(change(1, { type: eventType }));

      expect(store.reconcileOpenSession).toHaveBeenCalledExactlyOnceWith(
        "session-1",
        eventType,
      );
    },
  );

  it("uses the history-commit barrier to reconcile a loaded bound session", () => {
    store.currentSessionId = "session-current";
    store.chats = [{ id: "session-current" }, { id: "session-1" }];
    startAccountFeed();

    capturedHandlers().onChange(change(1, { type: "session_history_committed" }));

    expect(store.reconcileOpenSession).toHaveBeenCalledExactlyOnceWith(
      "session-1",
      "session_history_committed",
    );
  });

  it("cleans up the debounce, reconnect listener, and subscription on stop", () => {
    startAccountFeed();
    capturedHandlers().onChange(change(1));

    stopAccountFeed();
    vi.advanceTimersByTime(400);

    expect(store.refreshSessionsIndex).not.toHaveBeenCalled();
    expect(mockState.offReconnected).toHaveBeenCalledTimes(1);
    expect(mockState.subscriptionClose).toHaveBeenCalledTimes(1);
  });

  it("keeps storage read, write, and remove failures best-effort", () => {
    const getItem = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("read denied");
    });

    expect(() => startAccountFeed()).not.toThrow();
    expect(mockState.options).toEqual({ since: 0 });

    getItem.mockRestore();
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("write denied");
    });
    expect(() =>
      capturedHandlers().onChange(change(1, { type: "notification" })),
    ).not.toThrow();

    setItem.mockRestore();
    const readDuringWrite = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("comparison read denied");
    });
    const writeAfterReadFailure = vi.spyOn(localStorage, "setItem");
    expect(() =>
      capturedHandlers().onChange(change(2, { type: "notification" })),
    ).not.toThrow();
    expect(writeAfterReadFailure).not.toHaveBeenCalled();

    readDuringWrite.mockRestore();
    writeAfterReadFailure.mockRestore();
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
      throw new Error("remove denied");
    });
    expect(() => capturedHandlers().onReset?.()).not.toThrow();
    expect(store.refreshChatsNow).toHaveBeenCalledTimes(1);
  });

  it("handles an authoritative reset resync rejection without an unhandled failure", async () => {
    const error = new Error("backend unavailable");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    store.refreshChatsNow.mockRejectedValueOnce(error);
    startAccountFeed();

    capturedHandlers().onReset?.();
    await Promise.resolve();

    expect(warn).toHaveBeenCalledWith(
      "[AccountFeed] Failed to resync sessions after reset:",
      error,
    );
  });
});
