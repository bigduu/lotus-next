import { describe, expect, it } from "vitest";
import {
  findProviderSnapshotRelationIssues,
  parseProviderInstancesConfig,
  ProviderSnapshotValidationError,
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
    chat: { provider: "work", model: "gpt-5.6-sol" },
    fast: { provider: "work", model: "gpt-5.6-luna" },
  },
  features: { provider_model_ref: true },
});

describe("parseProviderInstancesConfig", () => {
  it("accepts and normalizes an instance-native snapshot", () => {
    expect(parseProviderInstancesConfig(validPayload())).toEqual(validPayload());
  });

  it("normalizes an omitted default id to null", () => {
    const payload = validPayload();
    const { default_provider_instance_id: _defaultId, ...withoutDefault } = payload;

    expect(parseProviderInstancesConfig(withoutDefault).default_provider_instance_id).toBeNull();
  });

  it.each([
    null,
    {},
    { instances: "invalid" },
    { instances: [{ id: "work", type: "openai", label: "Work", enabled: true }] },
    { ...validPayload(), default_provider_instance_id: "" },
    { ...validPayload(), defaults: null },
    { ...validPayload(), defaults: { ...validPayload().defaults, fast: null } },
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
