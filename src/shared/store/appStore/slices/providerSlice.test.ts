import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  getProviderInstances: vi.fn(),
  createProviderInstance: vi.fn(),
  updateProviderInstance: vi.fn(),
  deleteProviderInstance: vi.fn(),
  getProviderCatalog: vi.fn(),
  fetchCatalogModels: vi.fn(),
}));

vi.mock("@services/config/SettingsService", () => ({ settingsService: service }));

import { providerStore } from "./providerState";
import { resolveNewChatModelRef, type ProviderInstancesConfig } from "@shared/types/providerConfig";

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
    providerStore.setState({
      providerSnapshot: null,
      providerRepairSnapshot: null,
      providerRepairIssues: [],
      providerStatus: "idle",
      providerError: null,
      catalog: null,
      isCatalogFetching: false,
      discoveredModelsByProvider: {},
    });
  });

  it("loads one validated snapshot and derives defaults from it", async () => {
    service.getProviderInstances.mockResolvedValue(snapshot());

    await expect(providerStore.getState().loadProviderInstances()).resolves.toEqual(snapshot());

    const state = providerStore.getState();
    expect(state.providerStatus).toBe("ready");
    expect(state.providerSnapshot).toEqual(snapshot());
    expect(state.getActiveModel()).toBe("gpt-5.6-sol");
    expect(state.getFastModel()).toBe("gpt-5.6-luna");
    expect(state.getVisionModel()).toBe("gpt-5.6-sol");
    expect(state.isProviderModelRefEnabled()).toBe(true);
  });

  it("loads Bamboo null role defaults as ready and retains exact first-instance admission", async () => {
    const initial = snapshot();
    const wire = {
      ...initial,
      defaults: null,
      features: { provider_model_ref: false },
      instances: [{ ...initial.instances[0], config: { model: "instance-default", runtime_models: ["instance-default", "vendor:custom-name"] } }],
    };
    service.getProviderInstances.mockResolvedValue(wire);
    await expect(providerStore.getState().loadProviderInstances()).resolves.toEqual({ ...wire, defaults: undefined });
    const state = providerStore.getState();
    expect(state.providerStatus).toBe("ready");
    expect(state.providerSnapshot?.defaults).toBeUndefined();
    expect(state.providerRepairIssues).toEqual([]);
    expect(state.catalog).toBeNull();
    const selected = { provider: "work", model: "vendor:custom-name" };
    expect(resolveNewChatModelRef(state.providerSnapshot, selected)).toEqual(selected);
    expect(state.isProviderModelRefEnabled()).toBe(false);
  });

  it("revokes direct runtime authority while an authoritative reload is pending", async () => {
    let finishReload!: (value: ProviderInstancesConfig) => void;
    service.getProviderInstances.mockReturnValue(
      new Promise((resolve) => {
        finishReload = resolve;
      }),
    );
    providerStore.setState({
      providerSnapshot: snapshot(),
      providerStatus: "ready",
    });

    const reload = providerStore.getState().loadProviderInstances();

    expect(providerStore.getState()).toMatchObject({
      providerSnapshot: null,
      providerRepairSnapshot: null,
      providerRepairIssues: [],
      providerStatus: "loading",
    });
    expect(providerStore.getState().getActiveModel()).toBeUndefined();

    finishReload(snapshot("reloaded"));
    await reload;
    expect(providerStore.getState().providerSnapshot?.defaults?.chat.model).toBe("reloaded");
  });

  it("fails unavailable without retaining stale provider data", async () => {
    providerStore.setState({ providerSnapshot: snapshot(), providerStatus: "ready" });
    service.getProviderInstances.mockRejectedValue(new Error("private backend details"));

    await expect(providerStore.getState().loadProviderInstances()).rejects.toThrow(
      "Provider settings are unavailable",
    );

    expect(providerStore.getState()).toMatchObject({
      providerSnapshot: null,
      providerStatus: "unavailable",
      providerError: "Provider settings are unavailable",
    });
  });

  it("marks a malformed success payload incompatible", async () => {
    service.getProviderInstances.mockResolvedValue({ instances: "wrong" });

    await expect(providerStore.getState().loadProviderInstances()).rejects.toThrow(
      "Provider instances payload is invalid",
    );
    expect(providerStore.getState()).toMatchObject({
      providerSnapshot: null,
      providerStatus: "incompatible",
    });
  });

  it("keeps valid instances in repair state while runtime defaults fail closed", async () => {
    const degraded = {
      ...snapshot(),
      default_provider_instance_id: "deleted-default",
      defaults: {
        ...snapshot().defaults,
        chat: { provider: "deleted-chat", model: "stale-model" },
        subagent_models: {
          reviewer: { provider: "deleted-reviewer", model: "review-model" },
        },
      },
    } satisfies ProviderInstancesConfig;
    service.getProviderInstances.mockResolvedValue(degraded);

    await expect(providerStore.getState().loadProviderInstances()).resolves.toEqual(degraded);

    const state = providerStore.getState();
    expect(state).toMatchObject({
      providerSnapshot: null,
      providerRepairSnapshot: degraded,
      providerStatus: "degraded",
    });
    expect(state.providerRepairIssues.map((issue) => issue.path)).toEqual([
      "default_provider_instance_id",
      "defaults.chat",
      "defaults.subagent_models.reviewer",
    ]);
    expect(state.getActiveModel()).toBeUndefined();
    expect(state.getFastModel()).toBeUndefined();
    expect(state.getVisionModel()).toBeUndefined();
    expect(state.getFastModelRef()).toBeNull();
    expect(state.getVisionModelRef()).toBeNull();
    expect(state.isProviderModelRefEnabled()).toBe(false);
    expect(state.getProviderDisplayLabel("work")).toBe("Work");
  });

  it("filters catalog models by exact instance id without a provider-kind fallback", () => {
    providerStore.setState({
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

    expect(providerStore.getState().getModelsForProvider("work").map((item) => item.reference.model)).toEqual([
      "instance-model",
    ]);
  });

  it("rejects a provider model refresh when the request fails", async () => {
    service.fetchCatalogModels.mockRejectedValue(new Error("catalog transport failed"));

    await expect(providerStore.getState().fetchCatalogModels("work")).rejects.toThrow(
      "Provider model discovery failed",
    );

    expect(service.getProviderCatalog).not.toHaveBeenCalled();
    expect(providerStore.getState().isCatalogFetching).toBe(false);
  });

  it("rejects a provider model refresh when Bamboo reports an instance error", async () => {
    const canary = "upstream-secret-canary";
    service.fetchCatalogModels.mockResolvedValue({
      fetched: [{ provider: "work", error: `provider discovery failed: ${canary}` }],
    });

    await expect(providerStore.getState().fetchCatalogModels("work")).rejects.toThrow(
      "Provider model discovery failed",
    );

    expect(service.getProviderCatalog).not.toHaveBeenCalled();
    expect(providerStore.getState().isCatalogFetching).toBe(false);
    expect(JSON.stringify(providerStore.getState())).not.toContain(canary);
  });

  it("stores targeted discoveries separately without admitting them or refetching providers", async () => {
    const discovered = {
      reference: { provider: "work", model: "gpt-new" },
      display_name: "GPT New",
      provider_display_name: "Work",
      capabilities: { supports_tools: true, supports_vision: false, supports_reasoning: true },
    };
    service.fetchCatalogModels.mockResolvedValue({
      fetched: [{ provider: "work", models: [discovered] }],
    });
    providerStore.setState({
      catalog: {
        providers: [],
        models: [
          { ...discovered, reference: { provider: "work", model: "stale" } },
          { ...discovered, reference: { provider: "other", model: "keep" } },
        ],
      },
    });

    await providerStore.getState().fetchCatalogModels("work");

    expect(service.fetchCatalogModels).toHaveBeenCalledWith("work");
    expect(service.getProviderCatalog).not.toHaveBeenCalled();
    expect(
      providerStore.getState().catalog?.models.map((model) => model.reference),
    ).toEqual([
      { provider: "work", model: "stale" },
      { provider: "other", model: "keep" },
    ]);
    expect(providerStore.getState().discoveredModelsByProvider.work).toEqual([discovered]);
  });

  it("keeps a slow runtime catalog read independent from discovery candidates", async () => {
    let resolveCatalog!: (catalog: {
      providers: never[];
      models: Array<{
        reference: { provider: string; model: string };
        display_name: string;
        provider_display_name: string;
        capabilities: {
          supports_tools: boolean;
          supports_vision: boolean;
          supports_reasoning: boolean;
        };
      }>;
    }) => void;
    service.getProviderCatalog.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = resolve;
      }),
    );
    const fullCatalogLoad = providerStore.getState().loadCatalog();
    const duplicateLoad = providerStore.getState().loadCatalog();
    await Promise.resolve();

    expect(duplicateLoad).toBe(fullCatalogLoad);
    expect(service.getProviderCatalog).toHaveBeenCalledOnce();

    const fresh = {
      reference: { provider: "work", model: "fresh-targeted" },
      display_name: "Fresh targeted",
      provider_display_name: "Work",
      capabilities: { supports_tools: true, supports_vision: false, supports_reasoning: true },
    };
    service.fetchCatalogModels.mockResolvedValue({
      fetched: [{ provider: "work", models: [fresh] }],
    });
    await providerStore.getState().fetchCatalogModels("work");

    resolveCatalog({
      providers: [],
      models: [
        {
          ...fresh,
          reference: { provider: "work", model: "stale-full-read" },
        },
      ],
    });
    await fullCatalogLoad;

    expect(providerStore.getState().getModelsForProvider("work").map((model) => model.reference.model)).toEqual([
      "stale-full-read",
    ]);
    expect(providerStore.getState().discoveredModelsByProvider.work).toEqual([fresh]);
  });

  it("clears empty discovery candidates while preserving admitted runtime models", async () => {
    service.fetchCatalogModels.mockResolvedValue({
      fetched: [{ provider: "work", models: [] }],
    });
    providerStore.setState({
      catalog: {
        providers: [],
        models: [
          {
            reference: { provider: "work", model: "stale" },
            display_name: "Stale",
            provider_display_name: "Work",
            capabilities: {
              supports_tools: true,
              supports_vision: false,
              supports_reasoning: true,
            },
          },
        ],
      },
    });

    await providerStore.getState().fetchCatalogModels("work");

    expect(providerStore.getState().getModelsForProvider("work").map((model) => model.reference.model)).toEqual(["stale"]);
    expect(providerStore.getState().discoveredModelsByProvider.work).toEqual([]);
    expect(service.getProviderCatalog).not.toHaveBeenCalled();
  });

  it.each([
    ["updateProviderInstance", "updateProviderInstance", ["work", { enabled: false }]],
    ["deleteProviderInstance", "deleteProviderInstance", ["work"]],
  ] as const)("refreshes the authoritative snapshot after %s", async (action, method, args) => {
    service[method].mockResolvedValue(undefined);
    service.getProviderInstances.mockResolvedValue(snapshot("refreshed"));

    await (providerStore.getState()[action] as (...values: unknown[]) => Promise<unknown>)(...args);

    expect(service[method]).toHaveBeenCalledOnce();
    expect(service.getProviderInstances).toHaveBeenCalledOnce();
    expect(providerStore.getState().providerSnapshot?.defaults?.chat.model).toBe("refreshed");
  });

  it("returns the exact server-created instance after refreshing authority", async () => {
    const created = {
      id: "server-generated-id",
      type: "openai",
      label: "Created",
      enabled: true,
      config: { api_key: "****...****" },
    } as const;
    service.createProviderInstance.mockResolvedValue(created);
    service.getProviderInstances.mockResolvedValue({
      ...snapshot(),
      instances: [...snapshot().instances, created],
    });

    const result = await providerStore.getState().createProviderInstance({
      type: "openai",
      config: { api_key: "secret" },
    });

    expect(result).toEqual({
      instance: created,
      responseValid: true,
      authorityRefreshed: true,
      instanceConfirmed: true,
    });
    expect(result.instance).toBe(created);
    expect(service.getProviderInstances).toHaveBeenCalledOnce();
  });

  it("does not confirm a created instance that is absent from the refreshed collection", async () => {
    const created = {
      id: "server-generated-id",
      type: "openai",
      label: "Created",
      enabled: true,
      config: {},
    } as const;
    service.createProviderInstance.mockResolvedValue(created);
    service.getProviderInstances.mockResolvedValue(snapshot());

    const result = await providerStore.getState().createProviderInstance({
      type: "openai",
      config: { api_key: "secret" },
    });

    expect(result).toEqual({
      instance: created,
      responseValid: true,
      authorityRefreshed: true,
      instanceConfirmed: false,
    });
  });

  it("preserves a successful create when the authoritative reload fails", async () => {
    const created = {
      id: "created-before-refresh-failed",
      type: "openai",
      label: "Created",
      enabled: true,
      config: {},
    } as const;
    service.createProviderInstance.mockResolvedValue(created);
    service.getProviderInstances.mockRejectedValue(new Error("offline"));

    const result = await providerStore.getState().createProviderInstance({
      type: "openai",
      config: { api_key: "secret" },
    });

    expect(result).toEqual({
      instance: created,
      responseValid: true,
      authorityRefreshed: false,
      instanceConfirmed: false,
    });
    expect(result.instance).toBe(created);
    expect(providerStore.getState()).toMatchObject({
      providerStatus: "unavailable",
      providerSnapshot: null,
      providerRepairSnapshot: null,
    });
  });

  it("does not expose or target-fetch from a malformed successful create response", async () => {
    service.createProviderInstance.mockResolvedValue({ type: "openai", label: "Missing id" });
    service.getProviderInstances.mockResolvedValue(snapshot());

    const result = await providerStore.getState().createProviderInstance({
      type: "openai",
      config: { api_key: "secret" },
    });

    expect(result).toEqual({
      instance: null,
      responseValid: false,
      authorityRefreshed: true,
      instanceConfirmed: false,
    });
    expect(service.fetchCatalogModels).not.toHaveBeenCalled();
  });

  it("rejects malformed targeted models without changing the catalog", async () => {
    const originalCatalog = {
      providers: [],
      models: [
        {
          reference: { provider: "work", model: "known" },
          display_name: "Known",
          provider_display_name: "Work",
          capabilities: {
            supports_tools: true,
            supports_vision: false,
            supports_reasoning: true,
          },
        },
      ],
    };
    providerStore.setState({ catalog: originalCatalog });
    service.fetchCatalogModels.mockResolvedValue({
      fetched: [{ provider: "work", models: [{ display_name: "missing reference" }] }],
    });

    await expect(providerStore.getState().fetchCatalogModels("work")).rejects.toThrow(
      "Provider model discovery failed",
    );

    expect(providerStore.getState().catalog).toBe(originalCatalog);
  });

  it("drops cross-instance models from a targeted refresh", async () => {
    const descriptor = {
      display_name: "Model",
      provider_display_name: "Provider",
      capabilities: {
        supports_tools: true,
        supports_vision: false,
        supports_reasoning: true,
      },
    };
    service.fetchCatalogModels.mockResolvedValue({
      fetched: [
        {
          provider: "work",
          models: [
            { ...descriptor, reference: { provider: "work", model: "keep" } },
            { ...descriptor, reference: { provider: "other", model: "drop" } },
          ],
        },
      ],
    });

    await providerStore.getState().fetchCatalogModels("work");

    expect(providerStore.getState().discoveredModelsByProvider.work.map((model) => model.reference)).toEqual([
      { provider: "work", model: "keep" },
    ]);
    expect(providerStore.getState().catalog).toBeNull();
  });

  it("does not expose a credential-bearing mutation error", async () => {
    service.createProviderInstance.mockRejectedValue(new Error("request contained sk-secret"));

    await expect(
      providerStore.getState().createProviderInstance({
        type: "openai",
        config: { api_key: "sk-secret" },
      }),
    ).rejects.toThrow("Failed to create provider instance");
    expect(service.getProviderInstances).not.toHaveBeenCalled();
    expect(JSON.stringify(providerStore.getState())).not.toContain("sk-secret");
  });

  it("does not report a mutation complete when its authoritative refresh is incompatible", async () => {
    providerStore.setState({ providerSnapshot: snapshot(), providerStatus: "ready" });
    service.updateProviderInstance.mockResolvedValue(undefined);
    service.getProviderInstances.mockResolvedValue({ instances: "invalid" });

    await expect(
      providerStore.getState().updateProviderInstance("work", { enabled: false }),
    ).rejects.toThrow("Provider instances payload is invalid");

    expect(providerStore.getState()).toMatchObject({
      providerSnapshot: null,
      providerRepairSnapshot: null,
      providerStatus: "incompatible",
    });
  });
});
