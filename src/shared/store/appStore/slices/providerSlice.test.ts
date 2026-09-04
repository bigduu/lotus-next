import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  getProviderInstances: vi.fn(),
  createProviderInstance: vi.fn(),
  updateProviderInstance: vi.fn(),
  deleteProviderInstance: vi.fn(),
  setDefaultProviderInstance: vi.fn(),
  getProviderCatalog: vi.fn(),
  fetchCatalogModels: vi.fn(),
}));

vi.mock("@services/config/SettingsService", () => ({ settingsService: service }));

import { useProviderStore } from "./providerSlice";
import type { ProviderInstancesConfig } from "@shared/types/providerConfig";

const snapshot = (model = "gpt-5.6-sol"): ProviderInstancesConfig => ({
  default_provider_instance_id: "work",
  instances: [
    {
      id: "work",
      type: "openai",
      label: "Work",
      enabled: true,
      config: { reasoning_effort: "high" },
    },
  ],
  defaults: {
    chat: { provider: "work", model },
    fast: { provider: "work", model: "gpt-5.6-luna" },
  },
  features: { provider_model_ref: true },
});

describe("provider instance authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProviderStore.setState({
      providerSnapshot: null,
      providerStatus: "idle",
      providerError: null,
      catalog: null,
      isCatalogFetching: false,
    });
  });

  it("loads one validated snapshot and derives defaults from it", async () => {
    service.getProviderInstances.mockResolvedValue(snapshot());

    await expect(useProviderStore.getState().loadProviderInstances()).resolves.toEqual(snapshot());

    const state = useProviderStore.getState();
    expect(state.providerStatus).toBe("ready");
    expect(state.providerSnapshot).toEqual(snapshot());
    expect(state.getActiveModel()).toBe("gpt-5.6-sol");
    expect(state.getFastModel()).toBe("gpt-5.6-luna");
    expect(state.getVisionModel()).toBe("gpt-5.6-sol");
    expect(state.isProviderModelRefEnabled()).toBe(true);
    expect(state.getProviderType("work")).toBe("openai");
    expect(state.getProviderType("openai")).toBeUndefined();
  });

  it("fails unavailable without retaining stale provider data", async () => {
    useProviderStore.setState({ providerSnapshot: snapshot(), providerStatus: "ready" });
    service.getProviderInstances.mockRejectedValue(new Error("private backend details"));

    await expect(useProviderStore.getState().loadProviderInstances()).rejects.toThrow(
      "Provider settings are unavailable",
    );

    expect(useProviderStore.getState()).toMatchObject({
      providerSnapshot: null,
      providerStatus: "unavailable",
      providerError: "Provider settings are unavailable",
    });
  });

  it("marks a malformed success payload incompatible", async () => {
    service.getProviderInstances.mockResolvedValue({ instances: "wrong" });

    await expect(useProviderStore.getState().loadProviderInstances()).rejects.toThrow(
      "Provider instances payload is invalid",
    );
    expect(useProviderStore.getState()).toMatchObject({
      providerSnapshot: null,
      providerStatus: "incompatible",
    });
  });

  it("filters catalog models by exact instance id without a provider-kind fallback", () => {
    useProviderStore.setState({
      providerSnapshot: snapshot(),
      providerStatus: "ready",
      catalog: {
        providers: [],
        models: [
          {
            reference: { provider: "work", model: "instance-model" },
            display_name: "Instance",
            provider_display_name: "Work",
            capabilities: { supports_tools: true, supports_vision: false, supports_reasoning: true },
          },
          {
            reference: { provider: "openai", model: "kind-model" },
            display_name: "Kind alias",
            provider_display_name: "OpenAI",
            capabilities: { supports_tools: true, supports_vision: false, supports_reasoning: true },
          },
        ],
      },
    });

    expect(useProviderStore.getState().getModelsForProvider("work").map((item) => item.reference.model)).toEqual([
      "instance-model",
    ]);
  });

  it("rejects a provider model refresh when the request fails", async () => {
    service.fetchCatalogModels.mockRejectedValue(new Error("catalog transport failed"));

    await expect(useProviderStore.getState().fetchCatalogModels("work")).rejects.toThrow(
      "catalog transport failed",
    );

    expect(service.getProviderCatalog).not.toHaveBeenCalled();
    expect(useProviderStore.getState().isCatalogFetching).toBe(false);
  });

  it("rejects a provider model refresh when Bamboo reports an instance error", async () => {
    service.fetchCatalogModels.mockResolvedValue({
      fetched: [{ provider: "work", error: "provider discovery failed" }],
    });

    await expect(useProviderStore.getState().fetchCatalogModels("work")).rejects.toThrow(
      "provider discovery failed",
    );

    expect(service.getProviderCatalog).not.toHaveBeenCalled();
    expect(useProviderStore.getState().isCatalogFetching).toBe(false);
  });

  it.each([
    ["createProviderInstance", "createProviderInstance", [{ type: "openai", config: {} }]],
    ["updateProviderInstance", "updateProviderInstance", ["work", { enabled: false }]],
    ["deleteProviderInstance", "deleteProviderInstance", ["work"]],
    ["setDefaultProviderInstance", "setDefaultProviderInstance", ["work"]],
  ] as const)("refreshes the authoritative snapshot after %s", async (action, method, args) => {
    service[method].mockResolvedValue(undefined);
    service.getProviderInstances.mockResolvedValue(snapshot("refreshed"));

    await (useProviderStore.getState()[action] as (...values: unknown[]) => Promise<unknown>)(...args);

    expect(service[method]).toHaveBeenCalledOnce();
    expect(service.getProviderInstances).toHaveBeenCalledOnce();
    expect(useProviderStore.getState().providerSnapshot?.defaults?.chat.model).toBe("refreshed");
  });

  it("does not expose a credential-bearing mutation error", async () => {
    service.createProviderInstance.mockRejectedValue(new Error("request contained sk-secret"));

    await expect(
      useProviderStore.getState().createProviderInstance({
        type: "openai",
        config: { api_key: "sk-secret" },
      }),
    ).rejects.toThrow("Failed to create provider instance");
    expect(service.getProviderInstances).not.toHaveBeenCalled();
    expect(JSON.stringify(useProviderStore.getState())).not.toContain("sk-secret");
  });

  it("does not report a mutation complete when its authoritative refresh is incompatible", async () => {
    useProviderStore.setState({ providerSnapshot: snapshot(), providerStatus: "ready" });
    service.updateProviderInstance.mockResolvedValue(undefined);
    service.getProviderInstances.mockResolvedValue({ instances: "invalid" });

    await expect(
      useProviderStore.getState().updateProviderInstance("work", { enabled: false }),
    ).rejects.toThrow("Provider instances payload is invalid");

    expect(useProviderStore.getState()).toMatchObject({
      providerSnapshot: null,
      providerStatus: "incompatible",
    });
  });
});
