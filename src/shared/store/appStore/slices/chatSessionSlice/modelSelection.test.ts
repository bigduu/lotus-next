import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { agentClient, type SessionSummary } from "@services/chat/AgentService";
import type { AppState } from "../..";
import { createChatSlice } from "../chatSessionSlice";
import { sessionSummaryToChatItem } from "./messageMapping";

const summary = (id: string, isRunning = false): SessionSummary => ({
  id,
  kind: "root",
  title: id,
  title_version: 0,
  pinned: false,
  root_session_id: id,
  spawn_depth: 0,
  model: "gpt-6-sol",
  model_ref: { provider: "easycli", model: "gpt-6-sol" },
  created_at: "2026-09-25T00:00:00Z",
  updated_at: "2026-09-25T00:00:00Z",
  last_activity_at: "2026-09-25T00:00:00Z",
  message_count: 0,
  has_attachments: false,
  is_running: isRunning,
});

const storeWithSessions = (...sessions: SessionSummary[]) => {
  const store = createStore<AppState>()((set, get, api) => ({
    ...createChatSlice(set, get, api),
    executionBySession: {},
  } as AppState));
  store.setState({ chats: sessions.map(sessionSummaryToChatItem) });
  return store;
};

afterEach(() => vi.restoreAllMocks());

describe("session model selection", () => {
  it("persists the provider-qualified model before changing the displayed session", async () => {
    let resolvePatch!: () => void;
    const pendingPatch = new Promise<void>((resolve) => { resolvePatch = resolve; });
    const patch = vi.spyOn(agentClient, "patchSession").mockReturnValue(pendingPatch);
    const store = storeWithSessions(summary("target"), summary("other"));

    const operation = store.getState().changeSessionModel("target", "grok-4.7");
    expect(patch).toHaveBeenCalledExactlyOnceWith("target", {
      model: "grok-4.7",
      provider: "easycli",
      model_ref: { provider: "easycli", model: "grok-4.7" },
    });
    expect(store.getState().chats[0].config.model).toBe("gpt-6-sol");

    resolvePatch();
    await operation;
    expect(store.getState().chats[0].config).toMatchObject({
      model: "grok-4.7",
      model_ref: { provider: "easycli", model: "grok-4.7" },
    });
    expect(store.getState().chats[1].config.model).toBe("gpt-6-sol");
  });

  it("keeps the previous model when persistence fails or the session is running", async () => {
    const patch = vi.spyOn(agentClient, "patchSession").mockRejectedValue(new Error("offline"));
    const store = storeWithSessions(summary("idle"), summary("running", true));

    await expect(store.getState().changeSessionModel("idle", "grok-4.7")).rejects.toThrow("offline");
    expect(store.getState().chats[0].config.model).toBe("gpt-6-sol");
    await expect(store.getState().changeSessionModel("running", "grok-4.7")).rejects.toThrow();
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it("does not replace a legacy session's provider with the global Chat default", async () => {
    const patch = vi.spyOn(agentClient, "patchSession").mockResolvedValue(undefined);
    const legacy = { ...summary("legacy"), model_ref: null };
    const store = storeWithSessions(legacy);

    await store.getState().changeSessionModel("legacy", "grok-4.7");

    expect(patch).toHaveBeenCalledExactlyOnceWith("legacy", { model: "grok-4.7" });
    expect(store.getState().chats[0].config.model_ref).toBeNull();
  });
});
