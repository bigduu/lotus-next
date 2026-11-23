import { getErrorMessage } from "@services/api"
import type { uiText as translate } from "@shared/i18n/text"
import { getRuntimeModelIds, PROVIDER_LABELS, type ProviderInstance, type ProviderKind } from "@shared/types/providerConfig"
import { isMaskedSecret } from "@/lib/maskedSettingsValue"

export interface InstanceSavePayload {
  type: ProviderKind
  label: string
  enabled: boolean
  config: Record<string, unknown>
}

export interface Draft {
  type: ProviderKind
  label: string
  enabled: boolean
  apiKey: string
  baseUrl: string
  model: string
  /** null means this instance has no legacy assignment to edit. */
  fastModel: string | null
  visionModel: string | null
  runtimeModels: string[]
  initialRuntimeModels: readonly string[]
  modelCapabilities: NonNullable<ProviderInstance["config"]["model_capabilities"]>
  reasoningEffort: string
  responsesOnlyModels: string
  targetProvider: string
  requestOverridesJson: string
  litellmWireTypes?: boolean
}

export const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v))

export function draftFromInstance(inst: ProviderInstance | null): Draft {
  const cfg = (inst?.config ?? {}) as Record<string, unknown>
  return {
    type: inst?.type ?? "anthropic",
    label: inst?.label ?? "",
    enabled: inst?.enabled ?? true,
    apiKey: isMaskedSecret(cfg.api_key) ? "" : str(cfg.api_key),
    baseUrl: str(cfg.base_url),
    model: str(cfg.model),
    fastModel: typeof cfg.fast_model === "string" && cfg.fast_model.trim() ? cfg.fast_model : null,
    visionModel: typeof cfg.vision_model === "string" && cfg.vision_model.trim() ? cfg.vision_model : null,
    runtimeModels: inst ? getRuntimeModelIds(inst) : [],
    initialRuntimeModels: inst ? getRuntimeModelIds(inst) : [],
    modelCapabilities: structuredClone(inst?.config.model_capabilities ?? {}),
    reasoningEffort: str(cfg.reasoning_effort),
    responsesOnlyModels: Array.isArray(cfg.responses_only_models)
      ? (cfg.responses_only_models as unknown[]).map(str).filter(Boolean).join("\n")
      : "",
    targetProvider: str(cfg.target_provider),
    requestOverridesJson:
      cfg.request_overrides != null ? JSON.stringify(cfg.request_overrides, null, 2) : "",
  }
}

/**
 * Build the config payload from the draft.
 *
 * Edit mode sends explicit `null` for cleared optional fields — the backend
 * PUT deep-merges the patch onto the existing instance, so omitting a key
 * would keep the old value instead of clearing it.
 */
export function buildPayload(
  draft: Draft,
  isEdit: boolean,
  hasStoredApiKey: boolean,
  text: typeof translate,
): { payload: InstanceSavePayload } | { error: string } {
  const type = draft.type
  const config: Record<string, unknown> = {}
  const modelCapabilities = { ...draft.modelCapabilities }
  for (const model of draft.runtimeModels) {
    if (!draft.initialRuntimeModels.includes(model) && modelCapabilities[model]?.supports_vision !== false) {
      modelCapabilities[model] = { ...modelCapabilities[model], supports_vision: true }
    }
  }
  config.model_capabilities = modelCapabilities
  config.runtime_models = [...new Set(draft.runtimeModels.map((model) => model.trim()).filter(Boolean))]
  if (draft.model.trim() && !(config.runtime_models as string[]).includes(draft.model.trim())) {
    return { error: text("runtime_models_default_required") }
  }

  const setOrClear = (key: string, value: unknown, hasValue: boolean) => {
    if (hasValue) config[key] = value
    else if (isEdit) config[key] = null
  }

  const apiKey = draft.apiKey.trim()
  if (apiKey && isMaskedSecret(apiKey)) {
    if (!(isEdit && hasStoredApiKey)) {
      return { error: text("a_masked_api_key_cannot_be_used_2b50d591") }
    }
  } else if (apiKey) {
    config.api_key = apiKey
  } else if (!(isEdit && hasStoredApiKey)) {
    return { error: text("api_key_is_required_91482829") }
  }
  // Empty while editing a configured instance: omit api_key = keep stored key.
  setOrClear("base_url", draft.baseUrl.trim(), draft.baseUrl.trim() !== "")

  setOrClear("model", draft.model.trim(), draft.model.trim() !== "")
  if (draft.fastModel !== null) {
    setOrClear("fast_model", draft.fastModel.trim(), draft.fastModel.trim() !== "")
  }
  if (draft.visionModel !== null) {
    setOrClear("vision_model", draft.visionModel.trim(), draft.visionModel.trim() !== "")
  }
  setOrClear("reasoning_effort", draft.reasoningEffort, draft.reasoningEffort !== "")

  // NOTE: no max_tokens field here on purpose — the backend instance→provider
  // projection hardcodes it to None (bamboo provider_registry.rs), so an
  // instance-level max_tokens would be accepted but silently inert.

  if (type === "openai") {
    const models = draft.responsesOnlyModels
      .split(/[\s,]+/)
      .map((m) => m.trim())
      .filter(Boolean)
    if (models.length > 0 || isEdit) config.responses_only_models = models
  }

  if (type === "bodhi") {
    setOrClear("target_provider", draft.targetProvider, draft.targetProvider !== "")
  }

  const overridesRaw = draft.requestOverridesJson.trim()
  if (overridesRaw) {
    try {
      config.request_overrides = JSON.parse(overridesRaw)
    } catch (e) {
      return { error: text("could_not_parse_request_overrides_json_d2ce243c", { v0: (e as Error).message }) }
    }
  } else if (isEdit) {
    config.request_overrides = null
  }

  if (draft.litellmWireTypes !== undefined) {
    config.litellm_wire_types = draft.litellmWireTypes
  }

  return {
    payload: {
      type,
      label: draft.label.trim() || PROVIDER_LABELS[type] || type,
      enabled: draft.enabled,
      config,
    },
  }
}

export const redactProviderError = (error: unknown, secrets: readonly unknown[]): string => {
  let message = getErrorMessage(error)
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.trim() === "") continue
    message = message.replaceAll(secret, "[REDACTED]")
  }
  return message.replace(/[*.]{4,}/g, "[REDACTED]")
}
