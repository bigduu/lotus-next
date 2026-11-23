import { createMemo, createSignal, createUniqueId, Show, untrack } from "solid-js"
import { ChevronDown, ChevronRight } from "@lucide/solid"
import {
  getRuntimeModelIds, PROVIDER_KINDS, PROVIDER_LABELS, type DefaultsConfig,
  type NewProviderKind, type ProviderInstance, type ProviderKind,
} from "@shared/types/providerConfig"
import i18n from "@shared/i18n/runtime"
import type { ProviderModelDescriptor } from "@shared/types/providerModelRef"
import { isMaskedSecret } from "@/lib/maskedSettingsValue"
import { VENDOR_PRESETS } from "@/lib/providerPresets"
import { createUiText } from "../shell/uiText"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Switch } from "../ui/switch"
import { Textarea } from "../ui/textarea"
import { Select } from "../ui/select"
import { EditableModelCombobox } from "./EditableModelCombobox"
import { buildPayload, draftFromInstance, redactProviderError, str, type Draft, type InstanceSavePayload } from "./instanceDraft"
import { RuntimeModelsEditor, type ModelDiscoveryNotice } from "./RuntimeModelsEditor"

const UNSET = "__unset__"
const REASONING = [
  ["none", "reasoning_none"], ["low", "low_aa9e366f"], ["medium", "medium_a567bdaa"],
  ["high", "high_b1c27820"], ["xhigh", "extra_high_392d0dce"], ["max", "max_9730c15f"],
] as const
const KEY_PLACEHOLDER: Record<ProviderKind, string> = {
  anthropic: "sk-ant-…", openai: "sk-…", gemini: "AIza…", bodhi: "bhi_sk_…",
}
const BASE_URL_PLACEHOLDER: Record<Exclude<ProviderKind, "openai">, string> = {
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  bodhi: "http://localhost:8080",
}

interface InstanceEditorProps {
  instance: ProviderInstance | null
  onSave: (payload: InstanceSavePayload) => Promise<void>
  onCancel: () => void
  modelOptions?: readonly ProviderModelDescriptor[]
  initialRuntimeModels?: readonly string[]
  defaults?: DefaultsConfig
  onFetchModels?: () => void
  fetchingModels?: boolean
  fetchModelsNotice?: ModelDiscoveryNotice
}

function Field(props: {
  label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string
}) {
  return (
    <label class="block">
      <span class="mb-1 block text-xs text-muted-foreground">{props.label}</span>
      <Input type={props.type ?? "text"} value={props.value} placeholder={props.placeholder}
        onInput={(event) => props.onChange(event.currentTarget.value)} />
    </label>
  )
}

export function InstanceEditor(props: InstanceEditorProps) {
  const text = createUiText()
  const initial = untrack(() => {
    const initial = draftFromInstance(props.instance)
    const models = props.initialRuntimeModels
    return models ? { ...initial, runtimeModels: [...models], initialRuntimeModels: [...models] } : initial
  })
  const [draft, setDraft] = createSignal(initial)
  const [advanced, setAdvanced] = createSignal(!!initial.requestOverridesJson || !!initial.responsesOnlyModels ||
    initial.fastModel !== null || initial.visionModel !== null)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [presetId, setPresetId] = createSignal("")
  const litellmId = createUniqueId()

  const patch = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }))
  const edit = () => props.instance !== null
  const type = () => draft().type
  const baseUrlPlaceholder = () => {
    const provider = type()
    return provider === "openai"
      ? String(i18n.t("settings.providerTab.openaiBaseUrlPlaceholder"))
      : BASE_URL_PLACEHOLDER[provider]
  }
  const preset = createMemo(() => VENDOR_PRESETS.find((candidate) => candidate.id === presetId()))
  const hasStoredKey = () => isMaskedSecret(props.instance?.config.api_key)
  const litellmWireTypes = () => props.instance?.experiments?.litellm_wire_types
  const connectionChanged = createMemo(() => {
    const config = props.instance?.config
    const value = draft()
    return !!config && (
      value.baseUrl.trim() !== str(config.base_url).trim() ||
      (!!value.apiKey.trim() && value.apiKey.trim() !== str(config.api_key).trim()) ||
      value.targetProvider !== str(config.target_provider)
    )
  })

  const applyPreset = (id: string) => {
    if (id === UNSET) { setPresetId(""); return }
    const matching = VENDOR_PRESETS.find((candidate) => candidate.id === id)
    if (!matching || (edit() && matching.provider_type !== type())) return
    setPresetId(id)
    setDraft((value) => ({
      ...value, type: matching.provider_type, baseUrl: matching.base_url,
      label: value.label.trim() ? value.label : matching.label,
    }))
  }

  const submit = async () => {
    if (saving()) return
    const instance = props.instance
    const value = draft()
    if (instance) {
      const required = getRuntimeModelIds({
        ...instance,
        config: { fast_model: value.fastModel, vision_model: value.visionModel },
      }, props.defaults)
      const missing = required.find((model) => !value.runtimeModels.includes(model))
      if (missing) {
        setError(text("runtime_models_in_use", { model: missing }))
        return
      }
    }
    const result = buildPayload(value, edit(), hasStoredKey(), text)
    if ("error" in result) { setError(result.error); return }
    setSaving(true)
    setError(null)
    try {
      await props.onSave(result.payload)
    } catch (caught) {
      setError(redactProviderError(caught, [value.apiKey.trim(), instance?.config.api_key]))
    } finally {
      setSaving(false)
    }
  }

  const defaultModelOptions = createMemo(() => draft().runtimeModels.map((model): ProviderModelDescriptor =>
    props.modelOptions?.find((item) => item.reference.model === model) ?? {
      reference: { provider: props.instance?.id ?? "", model },
      display_name: model,
      provider_display_name: props.instance?.label ?? "",
      capabilities: { supports_tools: true, supports_vision: false, supports_reasoning: false },
      source: "manual",
    },
  ))

  return (
    <div class="space-y-2.5 rounded-lg border bg-muted/30 p-3">
      <div>
        <span class="mb-1 block text-xs text-muted-foreground">
          {text("vendor_preset_optional_fills_the_form_without_being_sav_b2935f04")}
        </span>
        <Select label={text("vendor_preset_65edf224")} class="w-full" value={presetId() || UNSET} onValueChange={applyPreset}
          options={[
            { value: UNSET, label: text("no_preset_64c25942") },
            ...VENDOR_PRESETS.map((entry) => ({
              value: entry.id, label: entry.label, disabled: edit() && entry.provider_type !== type(),
            })),
          ]} />
        <Show when={preset()?.note}><span class="mt-1 block text-xs text-muted-foreground">{preset()?.note}</span></Show>
      </div>

      <div>
        <span class="mb-1 block text-xs text-muted-foreground">
          {text("type_ba40014f")}{edit() ? text("cannot_be_changed_after_creation_0f2775dc") : ""}
        </span>
        <Select label={text("provider_type_6c9c029c")} class="w-full" value={type()} disabled={edit()}
          options={(edit() ? [type()] : PROVIDER_KINDS).map((value) => ({ value, label: PROVIDER_LABELS[value] ?? value }))}
          onValueChange={(value) => { setPresetId(""); patch({ type: value as NewProviderKind }) }} />
      </div>

      <Field label={text("name_d44e9b3d")} value={draft().label} onChange={(label) => patch({ label })}
        placeholder={text("e_g_my_c85274e7", { v0: PROVIDER_LABELS[type()] })} />
      <div class="flex items-center justify-between rounded-md border bg-background px-2.5 py-2">
        <span class="text-sm">{text("enable_this_instance_271435c3")}</span>
        <Switch aria-label={text("enable_this_instance_271435c3")} checked={draft().enabled}
          onCheckedChange={(enabled) => patch({ enabled })} />
      </div>
      <Field label="API Key" type="password" value={draft().apiKey} onChange={(apiKey) => patch({ apiKey })}
        placeholder={hasStoredKey() ? text("configured_leave_blank_to_keep_f3805ede") : KEY_PLACEHOLDER[type()]} />
      <Field label={text("base_url_optional_0ae73047")} value={draft().baseUrl}
        onChange={(baseUrl) => patch({ baseUrl })} placeholder={baseUrlPlaceholder()} />

      <Show when={type() === "bodhi"}>
        <div>
          <span class="mb-1 block text-xs text-muted-foreground">{text("upstream_target_optional_df6cf793")}</span>
          <Select label={text("upstream_target_optional_df6cf793")} class="w-full" value={draft().targetProvider || UNSET}
            onValueChange={(value) => patch({ targetProvider: value === UNSET ? "" : value })}
            options={[
              { value: UNSET, label: text("not_set_2f5f1d6f") },
              { value: "openai", label: "OpenAI" }, { value: "anthropic", label: "Anthropic" },
              { value: "gemini", label: "Gemini" },
            ]} />
        </div>
      </Show>

      <RuntimeModelsEditor
        value={draft().runtimeModels}
        onChange={(runtimeModels) => patch({ runtimeModels })}
        candidates={props.modelOptions ?? []}
        onFetchModels={edit() && !connectionChanged() && !saving() ? props.onFetchModels : undefined}
        fetchingModels={props.fetchingModels}
        fetchModelsNotice={props.fetchModelsNotice}
        fetchModelsHint={!edit() ? text("runtime_models_fetch_save_first")
          : connectionChanged() ? text("runtime_models_fetch_save_changes") : undefined}
        modelCapabilities={draft().modelCapabilities}
        onVisionChange={(model, supports_vision) => setDraft((value) => ({
          ...value, modelCapabilities: {
            ...value.modelCapabilities, [model]: { ...value.modelCapabilities[model], supports_vision },
          },
        }))}
      />
      <EditableModelCombobox label={text("default_model_optional_d2c2a9cc")}
        value={draft().model} onChange={(model) => patch({ model })} models={defaultModelOptions()}
        placeholder={preset()?.suggested_models.join(", ") ?? "glm-5.2"} />
      <div>
        <span class="mb-1 block text-xs text-muted-foreground">{text("reasoning_level_optional_2191ceaa")}</span>
        <Select label={text("reasoning_level_optional_2191ceaa")} class="w-full" value={draft().reasoningEffort || UNSET}
          onValueChange={(value) => patch({ reasoningEffort: value === UNSET ? "" : value })}
          options={[{ value: UNSET, label: text("default_unspecified_1c38331c") },
            ...REASONING.map(([value, label]) => ({ value, label: text(label) }))]} />
      </div>

      <button type="button" aria-expanded={advanced() ? "true" : "false"}
        onClick={() => setAdvanced((value) => !value)}
        class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        {advanced() ? <ChevronDown class="size-3.5" /> : <ChevronRight class="size-3.5" />}
        {text("advanced_settings_44455611")}
      </button>
      <Show when={advanced()}>
        <div class="space-y-2.5">
          <Show when={draft().fastModel !== null || draft().visionModel !== null}>
            <fieldset class="space-y-2 rounded-md border p-2.5">
              <legend class="px-1 text-xs font-medium">{text("runtime_models_legacy_assignments")}</legend>
              <p class="text-xs text-muted-foreground">{text("runtime_models_legacy_assignments_hint")}</p>
              <Show when={draft().fastModel !== null}>
                <Field label={text("runtime_models_legacy_fast_model")} value={draft().fastModel ?? ""}
                  onChange={(fastModel) => patch({ fastModel })} />
              </Show>
              <Show when={draft().visionModel !== null}>
                <Field label={text("runtime_models_legacy_vision_model")} value={draft().visionModel ?? ""}
                  onChange={(visionModel) => patch({ visionModel })} />
              </Show>
            </fieldset>
          </Show>
          <Show when={type() === "openai"}>
            <label class="block">
              <span class="mb-1 block text-xs text-muted-foreground">{text("responses_only_models_optional_separate_with_spaces_com_ff7e394c")}</span>
              <Textarea class="min-h-14 resize-y font-mono text-xs" value={draft().responsesOnlyModels}
                placeholder={"gpt-5.3-codex\ngpt-5*"}
                onInput={(event) => patch({ responsesOnlyModels: event.currentTarget.value })} />
            </label>
          </Show>
          <label class="block">
            <span class="mb-1 block text-xs text-muted-foreground">{text("request_overrides_optional_json_6388420b")}</span>
            <Textarea class="min-h-20 resize-y font-mono text-xs" value={draft().requestOverridesJson}
              placeholder='{"common":{"headers":{"X-Custom":"value"}}}'
              onInput={(event) => patch({ requestOverridesJson: event.currentTarget.value })} />
          </label>
        </div>
      </Show>

      <Show when={typeof litellmWireTypes() === "boolean"}>
        <fieldset class="rounded-md border p-2.5">
          <legend class="px-1 text-xs font-medium">{text("provider_experiments")}</legend>
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 space-y-1">
              <label for={litellmId} class="block text-sm font-medium">{text("provider_experiments_litellm")}</label>
              <p id={`${litellmId}-hint`} class="text-xs text-muted-foreground">{text("provider_experiments_litellm_hint")}</p>
            </div>
            <Switch id={litellmId} aria-describedby={`${litellmId}-hint`} disabled={saving()}
              checked={draft().litellmWireTypes ?? litellmWireTypes()}
              onCheckedChange={(checked) => patch({ litellmWireTypes: checked === litellmWireTypes() ? undefined : checked })} />
          </div>
        </fieldset>
      </Show>
      <Show when={error()}><p role="alert" class="text-xs text-destructive">{error()}</p></Show>
      <div class="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="secondary" onClick={() => props.onCancel()} disabled={saving()}>{text("cancel_2cd0f3be")}</Button>
        <Button size="sm" onClick={() => void submit()} disabled={saving()}>{text(saving() ? "saving_ff509c9b" : "save_a3030bf8")}</Button>
      </div>
    </div>
  )
}
