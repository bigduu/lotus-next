import { describe, expect, it } from "vitest";
import type { ProviderInstancesConfig } from "@shared/types/providerConfig";
import {
  getReasoningEffortForProvider,
  resolveProviderDefaultReasoningEffort,
} from "./reasoningEffort";

const snapshot: ProviderInstancesConfig = {
  default_provider_instance_id: "work",
  instances: [
    {
      id: "work",
      type: "openai",
      label: "Work",
      enabled: true,
      config: { reasoning_effort: "high" },
    },
    {
      id: "personal",
      type: "openai",
      label: "Personal",
      enabled: true,
      config: { reasoning_effort: "low" },
    },
  ],
  defaults: { chat: { provider: "personal", model: "gpt" } },
};

describe("instance-native reasoning effort", () => {
  it("resolves only exact instance ids", () => {
    expect(getReasoningEffortForProvider(snapshot, "work")).toBe("high");
    expect(getReasoningEffortForProvider(snapshot, "openai")).toBeUndefined();
  });

  it("uses model ref, typed chat default, explicit fallback, then default instance", () => {
    expect(resolveProviderDefaultReasoningEffort(snapshot, { provider: "work", model: "gpt" })).toBe("high");
    expect(resolveProviderDefaultReasoningEffort(snapshot)).toBe("low");

    const noDefaults = { ...snapshot, defaults: undefined };
    expect(resolveProviderDefaultReasoningEffort(noDefaults, null, "personal")).toBe("low");
    expect(resolveProviderDefaultReasoningEffort(noDefaults)).toBe("high");
  });

  it("rejects invalid configured efforts", () => {
    const invalid = {
      ...snapshot,
      instances: [{ ...snapshot.instances[0], config: { reasoning_effort: "extreme" } }],
      defaults: { chat: { provider: "work", model: "gpt" } },
    };
    expect(resolveProviderDefaultReasoningEffort(invalid)).toBeUndefined();
  });
});
