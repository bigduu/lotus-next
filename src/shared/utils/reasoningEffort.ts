import type { ReasoningEffort } from "@services/chat/AgentService";
import type { ProviderInstancesConfig } from "@shared/types/providerConfig";
import type { ProviderModelRef } from "@shared/types/providerModelRef";

/**
 * The single terminal default for reasoning effort, used when nothing is
 * configured anywhere in the resolution chain. This is the ONE place the
 * `"medium"` default lives on the frontend — mirror of the backend's
 * `DEFAULT_REASONING_EFFORT`. Do not hardcode a level at call sites.
 */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

/** Picker state. `auto` means no override at this layer; it is never sent. */
export type ReasoningEffortSelection = ReasoningEffort | "auto";

/**
 * Resolve the *effective* reasoning effort a session will use right now, from
 * the layered sources, most specific first:
 *   session config → pending input selection → persisted input → provider
 *   default → {@link DEFAULT_REASONING_EFFORT}.
 *
 * This is the single source of the precedence order. Every display/use site
 * (input box, question dialog) must call this instead of re-spelling the chain,
 * so they can never drift apart. (Session *creation* is intentionally separate:
 * it seeds from the provider default and may pass `undefined`, letting the
 * backend decide — it must NOT force a terminal default.)
 */
export const resolveEffectiveReasoningEffort = (sources: {
  sessionEffort?: ReasoningEffort | null;
  inputEffort?: ReasoningEffort | null;
  persistedEffort?: ReasoningEffort | null;
  providerDefault?: ReasoningEffort | null;
}): ReasoningEffort =>
  sources.sessionEffort ??
  sources.inputEffort ??
  sources.persistedEffort ??
  sources.providerDefault ??
  DEFAULT_REASONING_EFFORT;

const REASONING_EFFORTS: ReadonlySet<string> = new Set([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const isReasoningEffort = (value: unknown): value is ReasoningEffort =>
  typeof value === "string" && REASONING_EFFORTS.has(value);

export const isReasoningEffortSelection = (
  value: unknown,
): value is ReasoningEffortSelection => value === "auto" || isReasoningEffort(value);

const readEffort = (cfg: Record<string, unknown> | undefined): ReasoningEffort | undefined => {
  const effort = cfg?.reasoning_effort;
  return isReasoningEffort(effort) ? effort : undefined;
};

/**
 * Resolve the configured reasoning effort for one exact provider instance id.
 * Provider kinds are never accepted as routing aliases.
 */
const resolveReasoningEffortByKey = (
  providerSnapshot: ProviderInstancesConfig | null | undefined,
  instanceId?: string | null,
): ReasoningEffort | undefined => {
  const key = instanceId?.trim();
  if (!key) return undefined;
  const instance = providerSnapshot?.instances.find((item) => item.id === key);
  return readEffort(instance?.config);
};

export const getReasoningEffortForProvider = (
  providerSnapshot: ProviderInstancesConfig | null | undefined,
  instanceId?: string | null,
): ReasoningEffort | undefined => {
  return resolveReasoningEffortByKey(providerSnapshot, instanceId);
};

export const resolveProviderDefaultReasoningEffort = (
  providerSnapshot: ProviderInstancesConfig | null | undefined,
  modelRef?: ProviderModelRef | null,
  fallbackInstanceId?: string | null,
): ReasoningEffort | undefined => {
  const effectiveRef = modelRef ?? providerSnapshot?.defaults?.chat;
  if (effectiveRef?.reasoning_effort) return effectiveRef.reasoning_effort;

  const instanceId =
    effectiveRef?.provider?.trim() ||
    providerSnapshot?.defaults?.chat.provider.trim() ||
    fallbackInstanceId?.trim();

  return resolveReasoningEffortByKey(providerSnapshot, instanceId);
};
