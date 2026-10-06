import { describe, expect, it } from "vitest";
import {
  findProviderSnapshotRelationIssues,
  getRuntimeModelIds,
  parseProviderInstancesConfig,
  ProviderSnapshotValidationError,
  resolveNewChatModelRef,
} from "./providerConfig";

const validPayload = () => ({
  default_provider_instance_id: "work",
  instances: [
    {
      id: "work",
      type: "openai",
      label: "Work",
      enabled: true,
      config: { api_key: "****...****", reasoning_effort: "high", custom: true },
    },
  ],
  defaults: {
    chat: { provider: "work", model: "gpt-5.6-sol", reasoning_effort: "high" },
    fast: { provider: "work", model: "gpt-5.6-luna", reasoning_effort: "low" },
  },
  features: { provider_model_ref: true },
});

describe("runtime model admission", () => {
  it("seeds legacy admission only from configured models and matching defaults", () => {
    const snapshot = parseProviderInstancesConfig({
      ...validPayload(),
      defaults: {
        ...validPayload().defaults,
        vision: { provider: "other", model: "other-only" },
        subagent_models: { reviewer: { provider: "work", model: "custom-review" } },
      },
    });
    snapshot.instances[0].config.model = " configured ";
    snapshot.instances[0].config.fast_model = "configured-fast";
    snapshot.instances[0].config.vision_model = "configured";

    expect(getRuntimeModelIds(snapshot.instances[0], snapshot.defaults)).toEqual([
      "configured", "configured-fast", "gpt-5.6-sol", "gpt-5.6-luna", "custom-review",
    ]);
  });

  it("keeps explicit empty admission empty even with configured defaults", () => {
    const snapshot = parseProviderInstancesConfig(validPayload());
    snapshot.instances[0].config.runtime_models = [];
    snapshot.instances[0].config.model = "configured";
    expect(getRuntimeModelIds(snapshot.instances[0], snapshot.defaults)).toEqual([]);
  });

  it("resolves literal custom ids only within the current Chat provider's admission", () => {
    const snapshot = parseProviderInstancesConfig(validPayload());
    snapshot.instances[0].config.runtime_models = ["gpt-5.6-sol", "vendor:custom-name"];
    expect(resolveNewChatModelRef(snapshot, " vendor:custom-name ")).toEqual({ provider: "work", model: "vendor:custom-name" });
    expect(resolveNewChatModelRef(snapshot, "other-provider-only")).toEqual({ provider: "work", model: "gpt-5.6-sol" });
    snapshot.instances[0].config.runtime_models = [];
    expect(resolveNewChatModelRef(snapshot, "gpt-5.6-sol")).toBeUndefined();
    snapshot.instances[0].config.runtime_models = ["gpt-5.6-sol"];
    snapshot.instances[0].enabled = false;
    expect(resolveNewChatModelRef(snapshot, "gpt-5.6-sol")).toBeUndefined();
    expect(resolveNewChatModelRef(null, "gpt-5.6-sol")).toBeUndefined();
  });

  it("uses exact compatibility instance admission only while Chat defaults are absent", () => {
    const snapshot = parseProviderInstancesConfig(validPayload());
    snapshot.defaults = undefined;
    snapshot.instances[0].config.model = "instance-default";
    snapshot.instances[0].config.runtime_models = ["instance-default", "instance-custom"];
    expect(resolveNewChatModelRef(snapshot, "instance-custom")).toEqual({ provider: "work", model: "instance-custom" });
    expect(resolveNewChatModelRef(snapshot, "foreign-cached")).toEqual({ provider: "work", model: "instance-default" });
    snapshot.defaults = { chat: { provider: "deleted", model: "instance-default" } };
    expect(resolveNewChatModelRef(snapshot, "instance-custom")).toBeUndefined();
    snapshot.defaults = undefined;
    snapshot.instances[0].config.runtime_models = [];
    expect(resolveNewChatModelRef(snapshot, "instance-default")).toBeUndefined();
    snapshot.default_provider_instance_id = null;
    snapshot.instances[0].config.runtime_models = ["instance-default"];
    expect(resolveNewChatModelRef(snapshot, "instance-default")).toBeUndefined();
  });

  it.each([null, "all", [""], [42]])("rejects invalid admission lists %#", (runtime_models) => {
    const payload = validPayload();
    const instance = { ...payload.instances[0], config: { ...payload.instances[0].config, runtime_models } };
    expect(() => parseProviderInstancesConfig({ ...payload, instances: [instance] })).toThrow(ProviderSnapshotValidationError);
  });
});

describe("parseProviderInstancesConfig", () => {
  it("accepts and normalizes an instance-native snapshot", () => {
    expect(parseProviderInstancesConfig(validPayload())).toEqual(validPayload());
  });

  it("accepts none as an explicit reasoning override", () => {
    const payload = validPayload();
    payload.instances[0].config.reasoning_effort = "none";
    payload.defaults.chat.reasoning_effort = "none";

    expect(parseProviderInstancesConfig(payload)).toEqual(payload);
  });

  it("normalizes an omitted default id to null", () => {
    const payload = validPayload();
    const { default_provider_instance_id: _defaultId, ...withoutDefault } = payload;

    expect(parseProviderInstancesConfig(withoutDefault).default_provider_instance_id).toBeNull();
  });

  it.each([null, undefined])("normalizes absent role defaults %s without losing saved instance admission", (defaults) => {
    const payload = validPayload();
    const parsed = parseProviderInstancesConfig({
      ...payload,
      defaults,
      instances: [{ ...payload.instances[0], config: { model: "instance-default", runtime_models: ["instance-default", "vendor:custom-name"] } }],
    });
    expect(parsed.defaults).toBeUndefined();
    expect(findProviderSnapshotRelationIssues(parsed)).toEqual([]);
    expect(resolveNewChatModelRef(parsed, "vendor:custom-name")).toEqual({ provider: "work", model: "vendor:custom-name" });
    expect(resolveNewChatModelRef(parsed, "stale-other-provider")).toEqual({ provider: "work", model: "instance-default" });
  });

  it.each([
    null,
    {},
    { instances: "invalid" },
    { instances: [{ id: "work", type: "openai", label: "Work", enabled: true }] },
    { ...validPayload(), default_provider_instance_id: "" },
    { ...validPayload(), defaults: {} },
    { ...validPayload(), defaults: [] },
    { ...validPayload(), defaults: "unconfigured" },
    { ...validPayload(), defaults: { ...validPayload().defaults, fast: null } },
    {
      ...validPayload(),
      defaults: {
        ...validPayload().defaults,
        fast: { provider: "work", model: "gpt-5.6-luna", reasoning_effort: "ultra" },
      },
    },
    { ...validPayload(), features: null },
    { ...validPayload(), features: { provider_model_ref: "yes" } },
    {
      ...validPayload(),
      defaults: {
        ...validPayload().defaults,
        subagent_models: { reviewer: { provider: "work", model: "" } },
      },
    },
  ])("rejects an incompatible payload %#", (payload) => {
    expect(() => parseProviderInstancesConfig(payload)).toThrow(ProviderSnapshotValidationError);
  });

  it("rejects duplicate instance ids", () => {
    const payload = validPayload();
    payload.instances.push({ ...payload.instances[0] });

    expect(() => parseProviderInstancesConfig(payload)).toThrow("must be unique");
  });

  it("keeps structurally valid instances repairable when defaults reference unknown ids", () => {
    const payload = {
      ...validPayload(),
      default_provider_instance_id: "deleted-default",
      defaults: {
        ...validPayload().defaults,
        fast: { provider: "deleted-fast", model: "fast-model" },
        subagent_models: {
          reviewer: { provider: "deleted-reviewer", model: "review-model" },
        },
      },
    };

    const parsed = parseProviderInstancesConfig(payload);

    expect(parsed.instances).toEqual(validPayload().instances);
    expect(findProviderSnapshotRelationIssues(parsed)).toEqual([
      {
        kind: "default_provider_instance",
        path: "default_provider_instance_id",
        provider: "deleted-default",
      },
      {
        kind: "default_model_ref",
        path: "defaults.fast",
        provider: "deleted-fast",
        role: "fast",
      },
      {
        kind: "subagent_model_ref",
        path: "defaults.subagent_models.reviewer",
        provider: "deleted-reviewer",
        subagent: "reviewer",
      },
    ]);
  });
});
