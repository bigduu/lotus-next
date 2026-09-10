import type { ProviderModelRef } from "./providerModelRef";

/**
 * Provider Configuration Types
 *
 * Types for configuring and switching between different LLM providers.
 */

export interface DefaultsConfig {
  chat: ProviderModelRef;
  fast?: ProviderModelRef;
  task_summary?: ProviderModelRef;
  vision?: ProviderModelRef;
  memory_background?: ProviderModelRef;
  planning?: ProviderModelRef;
  search?: ProviderModelRef;
  code_review?: ProviderModelRef;
  sub_agent?: ProviderModelRef;
  subagent_models?: Record<string, ProviderModelRef>;
}

export const PROVIDER_DEFAULT_MODEL_REF_KEYS = [
  "chat",
  "fast",
  "task_summary",
  "vision",
  "memory_background",
  "planning",
  "search",
  "code_review",
  "sub_agent",
] as const;

export type ProviderDefaultModelRefKey = (typeof PROVIDER_DEFAULT_MODEL_REF_KEYS)[number];

export interface RequestOverridesConfig {
  common?: RequestScopeOverride;
  endpoints?: Record<string, RequestScopeOverride>;
  rules?: ModelRequestRule[];
}

export interface ModelRequestRule {
  model_pattern: string;
  endpoint?: string;
  scope?: RequestScopeOverride;
}

export interface RequestScopeOverride {
  headers?: Record<string, TemplateExpr>;
  body_patch?: BodyPatch[];
}

export interface BodyPatch {
  path: string;
  op?: "set" | "remove";
  value?: PatchValue;
}

export type PatchValue = TemplateExpr | unknown;

export type TemplateExpr =
  | string
  | {
      type: "literal";
      value: string;
    }
  | {
      type: "env_ref";
      name: string;
      fallback?: string;
    }
  | {
      type: "generated";
      generator: "uuid" | "unix_ms";
    }
  | {
      type: "format";
      template: string;
    };

export const PROVIDER_KINDS = ["copilot", "openai", "anthropic", "gemini", "bodhi"] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  copilot: "GitHub Copilot",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  bodhi: "Bodhi",
};

// ── Provider Instance types (multi-instance) ─────────────────────

/**
 * Configuration payload for a single provider instance.
 *
 * The shape varies by provider kind and is intentionally stored as a generic
 * record so the frontend preserves provider-specific and future fields.
 */
export type ProviderInstanceConfig = Record<string, unknown>;

/**
 * A single configured provider instance.
 *
 * - `id` is the stable unique identifier used as the `provider` field in ProviderModelRef.
 * - `type` is the provider kind (openai, anthropic, gemini, copilot, bodhi).
 * - `label` is the user-visible display name.
 */
export interface ProviderInstance {
  id: string;
  type: ProviderKind;
  label: string;
  enabled: boolean;
  config: ProviderInstanceConfig;
}

/**
 * Request body for creating a new provider instance.
 */
export interface CreateProviderInstanceRequest {
  type: ProviderKind;
  label?: string;
  enabled?: boolean;
  config: ProviderInstanceConfig;
}

/**
 * Request body for updating an existing provider instance.
 */
export interface UpdateProviderInstanceRequest {
  label?: string;
  enabled?: boolean;
  config?: ProviderInstanceConfig;
}

/**
 * Response shape from GET /bamboo/settings/provider-instances.
 *
 * This is the sole provider authority consumed by the frontend.
 */
export interface ProviderInstancesConfig {
  /** The default provider instance id, or null when no default is configured. */
  default_provider_instance_id: string | null;
  instances: ProviderInstance[];
  defaults?: DefaultsConfig;
  features?: {
    provider_model_ref?: boolean;
  };
}

export class ProviderSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderSnapshotValidationError";
  }
}

export type ProviderSnapshotRelationIssue =
  | {
      kind: "default_provider_instance";
      path: "default_provider_instance_id";
      provider: string;
    }
  | {
      kind: "default_model_ref";
      path: `defaults.${ProviderDefaultModelRefKey}`;
      provider: string;
      role: ProviderDefaultModelRefKey;
    }
  | {
      kind: "subagent_model_ref";
      path: `defaults.subagent_models.${string}`;
      provider: string;
      subagent: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isModelRef = (value: unknown): value is ProviderModelRef =>
  isRecord(value) &&
  typeof value.provider === "string" &&
  value.provider.trim().length > 0 &&
  typeof value.model === "string" &&
  value.model.trim().length > 0;

/** Validate one untrusted provider instance, including create responses. */
export const parseProviderInstance = (
  value: unknown,
  context = "Provider instance",
): ProviderInstance => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    !PROVIDER_KINDS.includes(value.type as ProviderKind) ||
    typeof value.label !== "string" ||
    typeof value.enabled !== "boolean" ||
    !isRecord(value.config)
  ) {
    throw new ProviderSnapshotValidationError(`${context} is invalid`);
  }
  return value as unknown as ProviderInstance;
};

const assertDefaults = (value: unknown): DefaultsConfig | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isModelRef(value.chat)) {
    throw new ProviderSnapshotValidationError("Provider defaults must contain a valid chat model reference");
  }

  for (const key of PROVIDER_DEFAULT_MODEL_REF_KEYS) {
    const modelRef = value[key];
    if (modelRef !== undefined && !isModelRef(modelRef)) {
      throw new ProviderSnapshotValidationError(`Provider defaults.${key} is invalid`);
    }
  }

  const subagentModels = value.subagent_models;
  if (subagentModels !== undefined) {
    if (!isRecord(subagentModels)) {
      throw new ProviderSnapshotValidationError("Provider defaults.subagent_models is invalid");
    }
    for (const modelRef of Object.values(subagentModels)) {
      if (!isModelRef(modelRef)) {
        throw new ProviderSnapshotValidationError("Provider defaults.subagent_models contains an invalid reference");
      }
    }
  }

  return value as unknown as DefaultsConfig;
};

/** Validate and normalize the untrusted provider-instances API payload. */
export const parseProviderInstancesConfig = (value: unknown): ProviderInstancesConfig => {
  if (!isRecord(value) || !Array.isArray(value.instances)) {
    throw new ProviderSnapshotValidationError("Provider instances payload is invalid");
  }

  const instances: ProviderInstance[] = value.instances.map((entry, index) =>
    parseProviderInstance(entry, `Provider instance at index ${index}`),
  );

  const instanceIds = new Set(instances.map((instance) => instance.id));
  if (instanceIds.size !== instances.length) {
    throw new ProviderSnapshotValidationError("Provider instance ids must be unique");
  }

  const rawDefault = value.default_provider_instance_id;
  if (rawDefault !== undefined && rawDefault !== null && typeof rawDefault !== "string") {
    throw new ProviderSnapshotValidationError("Default provider instance id is invalid");
  }
  if (typeof rawDefault === "string" && rawDefault.trim().length === 0) {
    throw new ProviderSnapshotValidationError("Default provider instance id is invalid");
  }
  const defaultId = typeof rawDefault === "string" ? rawDefault : null;
  let features: ProviderInstancesConfig["features"];
  if (value.features !== undefined) {
    if (!isRecord(value.features) ||
      (value.features.provider_model_ref !== undefined &&
        typeof value.features.provider_model_ref !== "boolean")) {
      throw new ProviderSnapshotValidationError("Provider features payload is invalid");
    }
    features = value.features as ProviderInstancesConfig["features"];
  }

  return {
    default_provider_instance_id: defaultId,
    instances,
    defaults: assertDefaults(value.defaults),
    features,
  };
};

/**
 * Find reference-integrity failures that are safe to expose for repair.
 *
 * The payload has already passed structural validation at this point. Unknown
 * instance references must remain unavailable to chat/runtime consumers, but
 * they must not hide otherwise valid instances from the Settings repair UI.
 */
export const findProviderSnapshotRelationIssues = (
  snapshot: ProviderInstancesConfig,
): ProviderSnapshotRelationIssue[] => {
  const instanceIds = new Set(snapshot.instances.map((instance) => instance.id));
  const issues: ProviderSnapshotRelationIssue[] = [];

  const defaultId = snapshot.default_provider_instance_id;
  if (defaultId && !instanceIds.has(defaultId)) {
    issues.push({
      kind: "default_provider_instance",
      path: "default_provider_instance_id",
      provider: defaultId,
    });
  }

  for (const role of PROVIDER_DEFAULT_MODEL_REF_KEYS) {
    const modelRef = snapshot.defaults?.[role];
    if (modelRef && !instanceIds.has(modelRef.provider)) {
      issues.push({
        kind: "default_model_ref",
        path: `defaults.${role}`,
        provider: modelRef.provider,
        role,
      });
    }
  }

  for (const [subagent, modelRef] of Object.entries(snapshot.defaults?.subagent_models ?? {})) {
    if (!instanceIds.has(modelRef.provider)) {
      issues.push({
        kind: "subagent_model_ref",
        path: `defaults.subagent_models.${subagent}`,
        provider: modelRef.provider,
        subagent,
      });
    }
  }

  return issues;
};

export const OPENAI_MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { value: "gpt-4-turbo-preview", label: "GPT-4 Turbo Preview" },
  { value: "gpt-4", label: "GPT-4" },
  { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
] as const;

export const ANTHROPIC_MODELS = [
  { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
  { value: "claude-3-5-sonnet-20240620", label: "Claude 3.5 Sonnet (Legacy)" },
  { value: "claude-3-opus-20240229", label: "Claude 3 Opus" },
  { value: "claude-3-sonnet-20240229", label: "Claude 3 Sonnet" },
  { value: "claude-3-haiku-20240307", label: "Claude 3 Haiku" },
] as const;

export const GEMINI_MODELS = [
  { value: "gemini-pro", label: "Gemini Pro" },
  { value: "gemini-pro-vision", label: "Gemini Pro Vision" },
  { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
] as const;

// Fallback list used when backend model discovery isn't available yet.
export const COPILOT_MODELS = [
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
] as const;
