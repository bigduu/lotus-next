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

vi.mock("./AgentService", () => ({
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

vi.mock("@shared/store/appStore", () => ({
  useAppStore: {
    getState: () => mockState.store,
  },
  selectShouldObserve: mockState.selectShouldObserve,
}));

vi.mock("@/lib/notify", () => ({ notify: mockState.notify }));

import {
  isAccountFeedDisconnected,
  startAccountFeed,
  stopAccountFeed,
} from "./accountFeed";

const CURSOR_STORAGE_KEY = "lotus_account_feed_cursor_v1";

const createStore = () => ({
  currentSessionId: null as string | null,
  setAgentAvailability: vi.fn(),
  refreshSessionsIndex: vi.fn(async () => {}),
  refreshChatsNow: vi.fn(async () => {}),
  reconcileOpenSession: vi.fn(),
  applyServerTitle: vi.fn(),
  applyServerPinned: vi.fn(),
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
