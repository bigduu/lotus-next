import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { DefaultsConfig, ProviderInstance, ProviderKind } from "@shared/types/providerConfig"
import type { ProviderModelDescriptor } from "@shared/types/providerModelRef"
import { getRuntimeModelIds, PROVIDER_LABELS } from "@shared/types/providerConfig"
import { getErrorMessage } from "@services/api"
import { isMaskedSecret } from "@/lib/secrets"
import { VENDOR_PRESETS } from "@/lib/providerPresets"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CopilotAuth } from "./CopilotAuth"
import { EditableModelCombobox } from "./EditableModelCombobox"
import { RuntimeModelsEditor } from "./RuntimeModelsEditor"

const PROVIDER_TYPES: ProviderKind[] = ["anthropic", "openai", "gemini", "copilot", "bodhi"]
const REASONING_EFFORTS = [
  { value: "none", get label() { return uiText("reasoning_none") } },
  { value: "low", get label() { return uiText("low_aa9e366f") } },
  { value: "medium", get label() { return uiText("medium_a567bdaa") } },
  { value: "high", get label() { return uiText("high_b1c27820") } },
  { value: "xhigh", get label() { return uiText("extra_high_392d0dce") } },
  { value: "max", get label() { return uiText("max_9730c15f") } },
] as const
const UNSET = "__unset__"

const API_KEY_PLACEHOLDER: Record<ProviderKind, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
  gemini: "AIza…",
  copilot: "",
  bodhi: "bhi_sk_…",
}

export interface InstanceSavePayload {
  type: ProviderKind
  label: string
  enabled: boolean
  config: Record<string, unknown>
}

interface Draft {
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
  modelCapabilities: NonNullable<ProviderInstance["config"]["model_capabilities"]>
  reasoningEffort: string
  responsesOnlyModels: string
  headlessAuth: boolean
  targetProvider: string
  requestOverridesJson: string
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v))

function draftFromInstance(inst: ProviderInstance | null): Draft {
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
    modelCapabilities: structuredClone(inst?.config.model_capabilities ?? {}),
    reasoningEffort: str(cfg.reasoning_effort),
    responsesOnlyModels: Array.isArray(cfg.responses_only_models)
      ? (cfg.responses_only_models as unknown[]).map(str).filter(Boolean).join("\n")
      : "",
    headlessAuth: cfg.headless_auth === true,
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
function buildPayload(
  draft: Draft,
  isEdit: boolean,
  hasStoredApiKey: boolean,
): { payload: InstanceSavePayload } | { error: string } {
  const type = draft.type
  const config: Record<string, unknown> = {}
  if (Object.keys(draft.modelCapabilities).length > 0) {
    config.model_capabilities = draft.modelCapabilities
  }
  config.runtime_models = [...new Set(draft.runtimeModels.map((model) => model.trim()).filter(Boolean))]
  if (draft.model.trim() && !(config.runtime_models as string[]).includes(draft.model.trim())) {
    return { error: uiText("runtime_models_default_required") }
  }

  const setOrClear = (key: string, value: unknown, hasValue: boolean) => {
    if (hasValue) config[key] = value
    else if (isEdit) config[key] = null
  }

  if (type !== "copilot") {
    const apiKey = draft.apiKey.trim()
    if (apiKey && isMaskedSecret(apiKey)) {
      if (!(isEdit && hasStoredApiKey)) {
        return { error: uiText("a_masked_api_key_cannot_be_used_2b50d591") }
      }
    } else if (apiKey) {
      config.api_key = apiKey
    } else if (!(isEdit && hasStoredApiKey)) {
      return { error: uiText("api_key_is_required_91482829") }
    }
    // Empty while editing a configured instance: omit api_key = keep stored key.
    setOrClear("base_url", draft.baseUrl.trim(), draft.baseUrl.trim() !== "")
  }

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

  if (type === "openai" || type === "copilot") {
    const models = draft.responsesOnlyModels
      .split(/[\s,]+/)
      .map((m) => m.trim())
      .filter(Boolean)
    if (models.length > 0 || isEdit) config.responses_only_models = models
  }

  if (type === "copilot") {
    config.headless_auth = draft.headlessAuth
  }

  if (type === "bodhi") {
    setOrClear("target_provider", draft.targetProvider, draft.targetProvider !== "")
  }

  const overridesRaw = draft.requestOverridesJson.trim()
  if (overridesRaw) {
    try {
      config.request_overrides = JSON.parse(overridesRaw)
    } catch (e) {
      return { error: uiText("could_not_parse_request_overrides_json_d2ce243c", { v0: (e as Error).message }) }
    }
  } else if (isEdit) {
    config.request_overrides = null
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

const redactProviderError = (error: unknown, secrets: readonly unknown[]): string => {
  let message = getErrorMessage(error)
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.trim() === "") continue
    message = message.replaceAll(secret, "[REDACTED]")
  }
  return message.replace(/[*.]{4,}/g, "[REDACTED]")
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  useUiLocale()
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <Input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/**
 * Create / edit form for a provider instance.
 *
 * The provider type is locked on existing instances — the backend PUT strips
 * `provider_type` from config patches, so editing it would be silently dropped.
 */
export function InstanceEditor({
  instance,
  onSave,
  onCancel,
  modelOptions = [],
  initialRuntimeModels,
  defaults,
}: {
  /** null = create mode */
  instance: ProviderInstance | null
  /** Should throw on failure — the error is surfaced inline. */
  onSave: (payload: InstanceSavePayload) => Promise<void>
  onCancel: () => void
  /** Server-discovered suggestions; custom ids remain valid without them. */
  modelOptions?: readonly ProviderModelDescriptor[]
  /** Includes configured legacy defaults; an explicit empty list stays empty. */
  initialRuntimeModels?: readonly string[]
  defaults?: DefaultsConfig
}) {
  useUiLocale()
  const isEdit = instance != null
  const hasStoredApiKey = isMaskedSecret(
    ((instance?.config ?? {}) as Record<string, unknown>).api_key,
  )
  const [draft, setDraft] = useState<Draft>(() => ({
    ...draftFromInstance(instance),
    ...(initialRuntimeModels ? { runtimeModels: [...initialRuntimeModels] } : {}),
  }))
  const [showAdvanced, setShowAdvanced] = useState(() => {
    const d = draftFromInstance(instance)
    return d.requestOverridesJson !== "" || d.responsesOnlyModels !== ""
      || d.fastModel !== null || d.visionModel !== null
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Purely a form-filling helper — the selection itself is never persisted.
  const [presetId, setPresetId] = useState("")

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))
  const type = draft.type
  const preset = VENDOR_PRESETS.find((p) => p.id === presetId) ?? null

  const applyPreset = (id: string) => {
    if (id === UNSET) {
      setPresetId("")
      return
    }
    const p = VENDOR_PRESETS.find((x) => x.id === id)
    if (!p) return
    setPresetId(id)
    setDraft((d) => ({
      ...d,
      // Type is immutable on existing instances; mismatched presets are
      // disabled in edit mode so this never flips a locked type.
      type: p.provider_type,
      baseUrl: p.base_url,
      label: d.label.trim() === "" ? p.label : d.label,
    }))
  }

  const submit = async () => {
    if (instance) {
      const required = getRuntimeModelIds({
        ...instance,
        config: { fast_model: draft.fastModel, vision_model: draft.visionModel },
      }, defaults)
      const removed = required.find((model) => !draft.runtimeModels.includes(model))
      if (removed) {
        setError(uiText("runtime_models_in_use", { model: removed }))
        return
      }
    }
    const result = buildPayload(draft, isEdit, hasStoredApiKey)
    if ("error" in result) {
      setError(result.error)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(result.payload)
    } catch (e) {
      const storedApiKey = ((instance?.config ?? {}) as Record<string, unknown>).api_key
      setError(redactProviderError(e, [draft.apiKey.trim(), storedApiKey]))
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">
          {uiText("vendor_preset_optional_fills_the_form_without_being_sav_b2935f04")}</span>
        <Select value={presetId || UNSET} onValueChange={applyPreset}>
          <SelectTrigger className="w-full" aria-label={uiText("vendor_preset_65edf224")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>{uiText("no_preset_64c25942")}</SelectItem>
            {VENDOR_PRESETS.map((p) => (
              <SelectItem
                key={p.id}
                value={p.id}
                disabled={isEdit && p.provider_type !== type}
              >
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {preset?.note ? (
          <span className="mt-1 block text-xs text-muted-foreground">{preset.note}</span>
        ) : null}
      </label>

      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">
          {uiText("type_ba40014f")}{isEdit ? uiText("cannot_be_changed_after_creation_0f2775dc") : ""}
        </span>
        <Select
          value={type}
          onValueChange={(v) => {
            // A preset implies a type — manual type edits detach the preset.
            setPresetId("")
            patch({ type: v as ProviderKind })
          }}
          disabled={isEdit}
        >
          <SelectTrigger className="w-full" aria-label={uiText("provider_type_6c9c029c")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {PROVIDER_LABELS[t] ?? t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <Field label={uiText("name_d44e9b3d")} value={draft.label} onChange={(v) => patch({ label: v })} placeholder={uiText("e_g_my_c85274e7", { v0: PROVIDER_LABELS[type] })} />

      <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2">
        <span className="text-sm">{uiText("enable_this_instance_271435c3")}</span>
        <Switch checked={draft.enabled} onCheckedChange={(v) => patch({ enabled: v })} />
      </div>

      {type === "copilot" ? (
        <CopilotAuth />
      ) : (
        <>
          <Field
            label="API Key"
            value={draft.apiKey}
            onChange={(v) => patch({ apiKey: v })}
            type="password"
            placeholder={hasStoredApiKey ? uiText("configured_leave_blank_to_keep_f3805ede") : API_KEY_PLACEHOLDER[type]}
          />
          <Field
            label={uiText("base_url_optional_0ae73047")}
            value={draft.baseUrl}
            onChange={(v) => patch({ baseUrl: v })}
            placeholder={
              type === "anthropic"
                ? "https://api.anthropic.com"
                : type === "openai"
                  ? "https://api.openai.com/v1"
                  : type === "gemini"
                    ? "https://generativelanguage.googleapis.com/v1beta"
                    : "http://localhost:8080"
            }
          />
        </>
      )}

      {type === "bodhi" ? (
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">{uiText("upstream_target_optional_df6cf793")}</span>
          <Select
            value={draft.targetProvider || UNSET}
            onValueChange={(v) => patch({ targetProvider: v === UNSET ? "" : v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>{uiText("not_set_2f5f1d6f")}</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="gemini">Gemini</SelectItem>
            </SelectContent>
          </Select>
        </label>
      ) : null}

      {type === "copilot" ? (
        <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2">
          <div>
            <div className="text-sm">{uiText("headless_authorization_b4707eb5")}</div>
            <div className="text-xs text-muted-foreground">{uiText("print_the_sign_in_url_in_the_console_without_opening_a__55e7a61e")}</div>
          </div>
          <Switch checked={draft.headlessAuth} onCheckedChange={(v) => patch({ headlessAuth: v })} />
        </div>
      ) : null}

      <RuntimeModelsEditor
        value={draft.runtimeModels}
        onChange={(runtimeModels) => patch({ runtimeModels })}
        candidates={modelOptions}
        modelCapabilities={draft.modelCapabilities}
        onVisionChange={(model, supportsVision) => patch({
          modelCapabilities: {
            ...draft.modelCapabilities,
            [model]: { ...draft.modelCapabilities[model], supports_vision: supportsVision },
          },
        })}
      />

      <EditableModelCombobox
        label={uiText("default_model_optional_d2c2a9cc")}
        value={draft.model}
        onChange={(v) => patch({ model: v })}
        models={draft.runtimeModels.map((model) => modelOptions.find((item) => item.reference.model === model) ?? {
          reference: { provider: instance?.id ?? "", model },
          display_name: model,
          provider_display_name: instance?.label ?? "",
          capabilities: { supports_tools: true, supports_vision: false, supports_reasoning: false },
          source: "manual",
        })}
        placeholder={preset ? preset.suggested_models.join(", ") : "glm-5.2"}
      />

      <div>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">{uiText("reasoning_level_optional_2191ceaa")}</span>
          <Select
            value={draft.reasoningEffort || UNSET}
            onValueChange={(v) => patch({ reasoningEffort: v === UNSET ? "" : v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>{uiText("default_unspecified_1c38331c")}</SelectItem>
              {REASONING_EFFORTS.map((effort) => (
                <SelectItem key={effort.value} value={effort.value}>
                  {effort.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {showAdvanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {uiText("advanced_settings_44455611")}</button>

      {showAdvanced ? (
        <div className="space-y-2.5">
          {draft.fastModel !== null || draft.visionModel !== null ? (
            <fieldset className="space-y-2 rounded-md border p-2.5">
              <legend className="px-1 text-xs font-medium">{uiText("runtime_models_legacy_assignments")}</legend>
              <p className="text-xs text-muted-foreground">{uiText("runtime_models_legacy_assignments_hint")}</p>
              {draft.fastModel !== null ? (
                <Field label={uiText("runtime_models_legacy_fast_model")} value={draft.fastModel}
                  onChange={(fastModel) => patch({ fastModel })} />
              ) : null}
              {draft.visionModel !== null ? (
                <Field label={uiText("runtime_models_legacy_vision_model")} value={draft.visionModel}
                  onChange={(visionModel) => patch({ visionModel })} />
              ) : null}
            </fieldset>
          ) : null}
          {type === "openai" || type === "copilot" ? (
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">
                {uiText("responses_only_models_optional_separate_with_spaces_com_ff7e394c")}</span>
              <Textarea
                className="min-h-14 resize-y font-mono text-xs"
                value={draft.responsesOnlyModels}
                placeholder={"gpt-5.3-codex\ngpt-5*"}
                onChange={(e) => patch({ responsesOnlyModels: e.target.value })}
              />
            </label>
          ) : null}
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">
              {uiText("request_overrides_optional_json_6388420b")}</span>
            <Textarea
              className="min-h-20 resize-y font-mono text-xs"
              value={draft.requestOverridesJson}
              placeholder='{"common":{"headers":{"X-Custom":"value"}}}'
              onChange={(e) => patch({ requestOverridesJson: e.target.value })}
            />
          </label>
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
          {uiText("cancel_2cd0f3be")}</Button>
        <Button size="sm" onClick={() => void submit()} disabled={saving}>
          {saving ? uiText("saving_ff509c9b") : uiText("save_a3030bf8")}
        </Button>
      </div>
    </div>
  )
}
