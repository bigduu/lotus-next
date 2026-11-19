import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { agentClient, type SessionSummary } from "@services/chat/AgentService";
import type { AppState } from "../..";
import { createChatSlice } from "../chatSessionSlice";
import { useProviderStore } from "../providerSlice";
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

describe("ordinary effort authority readback", () => {
  it("uses matching GET as success when the PATCH response was lost", async () => {
    vi.spyOn(agentClient, "patchSession").mockRejectedValue(new Error("response lost"));
    vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: { ...summary("target"), reasoning_effort: "max" } });
    const store = storeWithSessions(summary("target"), summary("peer"));
    await expect(store.getState().changeSessionReasoningEffort("target", "max")).resolves.toBeUndefined();
    expect(store.getState().chats[0].config.reasoningEffort).toBe("max");
    expect(store.getState().chats[1].config.reasoningEffort).not.toBe("max");
  });
  it("confirms Auto through an omitted override", async () => {
    const patch = vi.spyOn(agentClient, "patchSession").mockResolvedValue(undefined);
    vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: summary("target") });
    const store = storeWithSessions({ ...summary("target"), reasoning_effort: "high" });
    await store.getState().changeSessionReasoningEffort("target", null);
    expect(patch).toHaveBeenCalledWith("target", { clear_reasoning_effort: true });
    expect(store.getState().chats[0].config.reasoningEffort).toBeNull();
  });
  it.each([false, true])("retains actual GET value on mismatch (lost PATCH=%s)", async (lost) => {
    vi.spyOn(agentClient, "patchSession").mockImplementation(async () => { if (lost) throw new Error("response lost"); });
    vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: { ...summary("target"), reasoning_effort: "low" } });
    const store = storeWithSessions({ ...summary("target"), reasoning_effort: "high" });
    await expect(store.getState().changeSessionReasoningEffort("target", "max")).rejects.toThrow(lost ? "response lost" : "与选择不一致");
    expect(store.getState().chats[0].config.reasoningEffort).toBe("low");
  });
  it.each(["failure", "wrong-session", "invalid-effort"])("does not claim a requested choice when GET is %s", async (outcome) => {
    vi.spyOn(agentClient, "patchSession").mockResolvedValue(undefined);
    vi.spyOn(agentClient, "getSession").mockImplementation(async () => {
      if (outcome === "failure") throw new Error("GET offline");
      return { session: { ...summary(outcome === "wrong-session" ? "another" : "target"), reasoning_effort: outcome === "invalid-effort" ? "ultra" : "max" } } as Awaited<ReturnType<typeof agentClient.getSession>>;
    });
    const store = storeWithSessions({ ...summary("target"), reasoning_effort: "high" });
    await expect(store.getState().changeSessionReasoningEffort("target", "max")).rejects.toThrow();
    expect(store.getState().chats[0].config.reasoningEffort).toBe("high");
  });
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
  const nextModel = { provider: "relay", model: "grok-4.7" };
  const initialProviderState = useProviderStore.getState();

  beforeEach(() => {
    useProviderStore.setState({
      providerStatus: "ready",
      providerSnapshot: {
        default_provider_instance_id: "easycli",
        instances: [
          { id: "easycli", type: "openai", label: "Easycli", enabled: true, config: { runtime_models: ["gpt-6-sol"] } },
          { id: "relay", type: "openai", label: "Relay", enabled: true, config: { runtime_models: ["grok-4.7"] } },
        ],
        defaults: { chat: { provider: "easycli", model: "gpt-6-sol" } },
      },
    });
  });
  afterEach(() => useProviderStore.setState(initialProviderState, true));

  it("persists the provider-qualified model before changing the displayed session", async () => {
    let resolvePatch!: () => void;
    const pendingPatch = new Promise<void>((resolve) => { resolvePatch = resolve; });
    const patch = vi.spyOn(agentClient, "patchSession").mockReturnValue(pendingPatch);
    const store = storeWithSessions(summary("target"), summary("other"));

    const operation = store.getState().changeSessionModel("target", nextModel);
    expect(patch).toHaveBeenCalledExactlyOnceWith("target", {
      model: "grok-4.7",
      provider: "relay",
      model_ref: nextModel,
    });
    expect(store.getState().chats[0].config.model).toBe("gpt-6-sol");

    resolvePatch();
    await operation;
    expect(store.getState().chats[0].config).toMatchObject({
      model: "grok-4.7",
      model_ref: nextModel,
    });
    expect(store.getState().chats[1].config.model).toBe("gpt-6-sol");
  });

  it("keeps the previous model when persistence fails or the session is running", async () => {
    const patch = vi.spyOn(agentClient, "patchSession").mockRejectedValue(new Error("offline"));
    const store = storeWithSessions(summary("idle"), summary("running", true));

    await expect(store.getState().changeSessionModel("idle", nextModel)).rejects.toThrow("offline");
    expect(store.getState().chats[0].config.model).toBe("gpt-6-sol");
    await expect(store.getState().changeSessionModel("running", nextModel)).rejects.toThrow();
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it("binds a legacy session to the explicitly selected provider", async () => {
    const patch = vi.spyOn(agentClient, "patchSession").mockResolvedValue(undefined);
    const legacy = { ...summary("legacy"), model_ref: null };
    const store = storeWithSessions(legacy);

    await store.getState().changeSessionModel("legacy", nextModel);

    expect(patch).toHaveBeenCalledExactlyOnceWith("legacy", {
      model: nextModel.model, provider: nextModel.provider, model_ref: nextModel,
    });
    expect(store.getState().chats[0].config.model_ref).toEqual(nextModel);
  });

  it("rejects a stale choice after its provider is disabled", async () => {
    const patch = vi.spyOn(agentClient, "patchSession");
    const store = storeWithSessions(summary("target"));
    useProviderStore.getState().providerSnapshot!.instances[1].enabled = false;
    await expect(store.getState().changeSessionModel("target", nextModel)).rejects.toThrow();
    expect(patch).not.toHaveBeenCalled();
  });
});
