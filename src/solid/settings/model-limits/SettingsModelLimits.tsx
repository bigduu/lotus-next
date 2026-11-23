import { createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { Plus } from "@lucide/solid"
import { apiClient, getErrorMessage } from "@services/api"
import { serviceFactory, type ModelLimitDefault } from "@services/common/ServiceFactory"
import { appStore } from "@shared/store/appStore/state"
import { providerStore } from "@shared/store/appStore/slices/providerState"
import { getUsedModels, removeUsedModel } from "@shared/utils/usedModels"
import {
  buildLimitRows, DEFAULT_CONTEXT_WINDOW_TOKENS, formatTokenCount,
  nextModelLimitRowId, UNLIMITED_OUTPUT, validateLimitRows, type LimitRowDraft,
} from "@/components/chat/settings/system/modelLimits"
import type { ModelLimitOverride, SectionMessage } from "@shared/types/systemConfig"
import { createUiText } from "../../shell/uiText"
import { createStoreSelector } from "../../state/createStoreSelector"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../../ui/responsive-dialog"
import { Skeleton } from "../../ui/skeleton"
import { EditableValueCombobox } from "./EditableValueCombobox"

const tokenPreset = (tokens: number) => {
  const value = formatTokenCount(tokens)
  return { value, label: value, description: tokens.toLocaleString("en-US") + " tokens" }
}
const CONTEXT_PRESETS = [16_000, 32_000, 64_000, 128_000, 200_000, 256_000, 258_000, 400_000, 1_000_000, 2_000_000].map(tokenPreset)
const OUTPUT_PRESETS = [4_000, 8_000, 16_000, 32_000, 64_000, 128_000].map(tokenPreset)

export function SettingsModelLimits() {
  const text = createUiText()
  const [initial, setInitial] = createSignal<ModelLimitOverride[] | null>(null)
  const [loadError, setLoadError] = createSignal<string | null>(null)
  let request: AbortController | undefined

  async function load() {
    request?.abort()
    const controller = new AbortController()
    request = controller
    setLoadError(null)
    try {
      const config = await apiClient.get<{ model_limits?: ModelLimitOverride[] }>("bamboo/config", { signal: controller.signal })
      if (!controller.signal.aborted) setInitial(Array.isArray(config.model_limits) ? config.model_limits : [])
    } catch (failure) {
      if (!controller.signal.aborted) setLoadError(getErrorMessage(failure))
    }
  }

  onSettled(() => {
    void load()
    return () => { request?.abort() }
  })

  return <Show when={initial()} fallback={
    <Show when={loadError()} fallback={
      <div class="space-y-3" aria-busy="true">
        <Skeleton class="h-24 w-full rounded-lg" />
        <Skeleton class="h-64 w-full rounded-lg" />
      </div>
    }>
      <section class="space-y-2 rounded-lg border p-3">
        <p class="text-xs text-destructive" role="alert">{text("could_not_load_model_limits_f49c4361")}{loadError()}</p>
        <Button size="sm" variant="secondary" onClick={() => void load()}>{text("retry_b8784c8d")}</Button>
      </section>
    </Show>
  } keyed>{(overrides) => <ModelLimitEditor initial={overrides} />}</Show>
}

function ModelLimitEditor(props: { initial: ModelLimitOverride[] }) {
  const text = createUiText()
  const availableModels = createStoreSelector(appStore, (state) => state.models)
  const providerSnapshot = createStoreSelector(providerStore, (state) => state.providerSnapshot ?? state.providerRepairSnapshot)
  const catalogModels = createStoreSelector(providerStore, (state) => state.catalog?.models)
  const [usedModels, setUsedModels] = createSignal(getUsedModels())
  const [rows, setRows] = createSignal(buildLimitRows(props.initial, usedModels()))
  const [fallback, setFallback] = createSignal<ModelLimitDefault>()
  const [unlimited, setUnlimited] = createSignal(props.initial.some((row) => row.unlimited_output === true))
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal<SectionMessage>(null)
  const [confirmReset, setConfirmReset] = createSignal(false)
  const [resetError, setResetError] = createSignal<string | null>(null)
  let active = true

  onSettled(() => {
    void serviceFactory.getModelLimitDefaults().then((response) => {
      if (!active) return
      const defaults = response.model_limits?.[0]
      if (defaults && [defaults.max_context_tokens, defaults.max_output_tokens, defaults.safety_margin].every(Number.isSafeInteger)
        && defaults.max_context_tokens > 0 && defaults.max_output_tokens > 0 && defaults.safety_margin >= 0) {
        setFallback(defaults)
      }
      if (response.supports_unlimited_output === true) setUnlimited(true)
    }).catch(() => undefined)
    return () => { active = false }
  })

  const automatic = () => text("automatic_model_limit")
  const contextDefault = () => formatTokenCount(fallback()?.max_context_tokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS)
  const inheritedContext = () => fallback() ? text("model_limits_context_fallback", { tokens: contextDefault() }) : "—"
  const outputPresets = createMemo(() => unlimited() ? [
    { value: UNLIMITED_OUTPUT, label: text("unlimited_model_output"), description: text("unlimited_model_output_description") },
    ...OUTPUT_PRESETS,
  ] : OUTPUT_PRESETS)
  const modelOptions = createMemo(() => {
    const preferences = providerSnapshot()?.defaults
    const options = [
      ...usedModels(), ...rows().map((row) => row.model_pattern), ...availableModels(),
      ...(catalogModels()?.map((model) => model.reference.model) ?? []),
      preferences?.chat?.model, preferences?.fast?.model, preferences?.task_summary?.model,
      preferences?.vision?.model, preferences?.memory_background?.model, preferences?.planning?.model,
      preferences?.search?.model, preferences?.code_review?.model, preferences?.work_review?.model,
      preferences?.sub_agent?.model, ...Object.values(preferences?.subagent_models ?? {}).map((model) => model.model),
    ]
    const seen = new Set<string>()
    return options.flatMap((option) => {
      const model = typeof option === "string" ? option.trim() : ""
      if (!model) return []
      const key = model.toLocaleLowerCase()
      if (seen.has(key)) return []
      seen.add(key)
      return [{ value: model, label: model }]
    })
  })

  function update(id: string, patch: Partial<LimitRowDraft>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
    setMessage(null)
  }

  function add() {
    setRows((current) => [...current, {
      id: nextModelLimitRowId(), model_pattern: "", isCustom: true, customized: true,
      max_context_tokens: contextDefault(), max_output_tokens: null, safety_margin: "",
    }])
    setMessage(null)
  }

  function remove(row: LimitRowDraft) {
    if (!row.isCustom) setUsedModels(removeUsedModel(row.model_pattern))
    setRows((current) => current.filter((candidate) => candidate.id !== row.id))
    setMessage(null)
  }

  async function persist(overrides: ModelLimitOverride[], clearAll = false) {
    if (busy()) return
    setBusy(true)
    if (clearAll) setResetError(null)
    else setMessage(null)
    try {
      const patch = { model_limits: overrides }
      const validation = await serviceFactory.validateBambooConfigPatch(patch)
      if (!validation.valid) {
        const issue = Object.values(validation.errors ?? {}).flat().filter(Boolean)[0]
        throw new Error(issue?.message || text("configuration_validation_failed_ed3442af"))
      }
      const saved = (await serviceFactory.setBambooConfig(patch)) as { model_limits?: ModelLimitOverride[] }
      if (!active) return
      const discovered = getUsedModels()
      setUsedModels(discovered)
      setRows(buildLimitRows(saved.model_limits ?? [], discovered))
      if (clearAll) setConfirmReset(false)
      setMessage({ kind: "ok", text: text(clearAll ? "restored_global_defaults_4f47beee" : "saved_1bd91a7d") })
    } catch (failure) {
      if (!active) return
      const explanation = getErrorMessage(failure)
      if (clearAll) setResetError(explanation)
      else setMessage({ kind: "error", text: explanation })
    } finally {
      if (active) setBusy(false)
    }
  }

  function save() {
    if (busy()) return
    const result = validateLimitRows(rows(), unlimited())
    if ("error" in result) setMessage({ kind: "error", text: result.error })
    else void persist(result.overrides)
  }

  return <section data-settings-model-limits="" class="space-y-3">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold">{text("model_limits_05ff605e")}</h2>
        <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{text("models_confirmed_through_sending_appear_automatically_u_1e3a1de2")}</p>
      </div>
      <Button size="sm" variant="secondary" disabled={busy()} onClick={add}>
        <Plus class="size-4" aria-hidden="true" />{text("add_model_e552c2ac")}
      </Button>
    </div>

    <Show when={fallback()}>{(defaults) =>
      <div class="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        {text("model_limits_compatibility_fallback")}
        {" · "}{text("context_window_bb074b86")} <span class="font-medium text-foreground">{formatTokenCount(defaults().max_context_tokens)}</span>
        {" · "}{text("max_output_d6601037")} <span class="font-medium text-foreground">{formatTokenCount(defaults().max_output_tokens)}</span>
        {" · "}{text("safety_margin_40253c60")} <span class="font-medium text-foreground">{formatTokenCount(defaults().safety_margin)}</span>
      </div>
    }</Show>

    <p class="text-xs leading-relaxed text-muted-foreground">{text("choose_or_type_a_model_pattern_context_and_output_limit_eb2906c4")}</p>
    <div class="overflow-x-auto rounded-lg border">
      <table class="w-full min-w-[820px] text-xs">
        <thead class="bg-muted/40 text-muted-foreground">
          <tr class="[&>th]:px-2 [&>th]:py-2 [&>th]:font-medium">
            <th scope="col" class="w-[220px] text-left">{text("model_c98e118e")}</th>
            <th scope="col" class="w-[150px] text-left">{text("context_window_bb074b86")}</th>
            <th scope="col" class="w-[130px] text-left">{text("max_output_d6601037")}</th>
            <th scope="col" class="w-[130px] text-left">{text("safety_margin_40253c60")}</th>
            <th scope="col" class="w-[90px] text-left">{text("status_6320b4a8")}</th>
            <th scope="col" class="w-[150px] text-right">{text("action_ed31fbb4")}</th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()} keyed={(row) => row.id}>{(row) => {
            const model = () => row().model_pattern || text("new_model")
            const disabled = () => busy() || !row().customized
            return <tr class="border-t align-top [&>td]:px-2 [&>td]:py-2">
              <td>
                <Show when={row().isCustom} fallback={
                  <div class="flex h-8 items-center font-mono font-medium" title={row().model_pattern}>
                    <span class="truncate">{row().model_pattern}</span>
                  </div>
                }>
                  <EditableValueCombobox label={text("model_pattern_e5fe9bd4")}
                    value={row().model_pattern} onChange={(value) => update(row().id, { model_pattern: value })}
                    options={modelOptions()} placeholder={text("e_g_gpt_5_or_glm_5_3_63bebb83")} disabled={busy()} />
                </Show>
              </td>
              <td>
                <EditableValueCombobox label={text("context_window_74c09029", { v0: model() })}
                  value={row().customized ? row().max_context_tokens : inheritedContext()}
                  onChange={(value) => update(row().id, { max_context_tokens: value })}
                  options={CONTEXT_PRESETS} placeholder={text("e_g_258k_or_1m_0a242a0c")} disabled={disabled()} inputMode="decimal" />
              </td>
              <td>
                <EditableValueCombobox label={text("maximum_output_5e8920ca", { v0: model() })}
                  value={row().max_output_tokens ?? ""} onChange={(value) => update(row().id, { max_output_tokens: value })}
                  options={outputPresets()} placeholder={automatic()} disabled={disabled()} inputMode="decimal" />
              </td>
              <td>
                <Input class="h-8 text-xs" aria-label={text("safety_margin_b3945952", { v0: model() })}
                  inputmode="decimal" placeholder={automatic()} value={row().safety_margin} disabled={disabled()}
                  onInput={(event) => update(row().id, { safety_margin: event.currentTarget.value })} />
              </td>
              <td class="pt-3!">
                <Badge variant={row().customized ? "success" : "secondary"}>{text(row().customized ? "overridden_4ae1bfcb" : "follow_defaults_a44f9f9f")}</Badge>
              </td>
              <td>
                <div class="flex justify-end gap-1">
                  <Show when={!row().customized} fallback={
                    <Show when={!row().isCustom}>
                      <Button size="sm" variant="ghost" class="h-8 px-2" disabled={busy()} onClick={() => update(row().id, {
                        customized: false, max_context_tokens: "", max_output_tokens: null, safety_margin: "",
                      })}>{text("reset_to_default_ba2e93e7")}</Button>
                    </Show>
                  }>
                    <Button size="sm" variant="ghost" class="h-8 px-2" disabled={busy()} onClick={() => update(row().id, {
                      customized: true, max_context_tokens: contextDefault(),
                    })}>{text("customize_4eafa9e9")}</Button>
                  </Show>
                  <Button size="sm" variant="ghost" class="h-8 px-2 text-destructive hover:text-destructive" disabled={busy()} onClick={() => remove(row())}>
                    {text("remove_6135d415")}
                  </Button>
                </div>
              </td>
            </tr>
          }}</For>
        </tbody>
      </table>
      <Show when={!rows().length}>
        <div class="border-t px-3 py-8 text-center text-xs text-muted-foreground">{text("models_you_have_used_appear_here_after_sending_you_can__d8f967ba")}</div>
      </Show>
    </div>

    <div class="flex items-center justify-between gap-2">
      <Show when={message()}>{(notice) =>
        <p role={notice().kind === "error" ? "alert" : "status"} class={notice().kind === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{notice().text}</p>
      }</Show>
      <div class="ml-auto flex gap-2">
        <Button size="sm" variant="secondary" disabled={busy()} onClick={() => { setResetError(null); setConfirmReset(true) }}>
          {text("reset_all_to_default_3b6c48ce")}
        </Button>
        <Button size="sm" disabled={busy()} onClick={save}>{text(busy() ? "saving_ff509c9b" : "save_a3030bf8")}</Button>
      </div>
    </div>

    <ResponsiveDialog open={confirmReset()} onOpenChange={(open) => { if (!busy()) setConfirmReset(open) }}>
      <ResponsiveDialogContent class="gap-0 p-4 sm:max-w-sm" dismissable={!busy()}>
        <ResponsiveDialogTitle>{text("clear_all_model_limits_86ec2499")}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription class="mt-2 leading-relaxed">{text("remove_all_per_model_overrides_used_models_stay_in_the__d570aece")}</ResponsiveDialogDescription>
        <Show when={resetError()}><p role="alert" class="mt-2 text-xs text-destructive">{resetError()}</p></Show>
        <div class="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" disabled={busy()} onClick={() => setConfirmReset(false)}>{text("cancel_2cd0f3be")}</Button>
          <Button size="sm" variant="destructive" disabled={busy()} onClick={() => void persist([], true)}>
            {text(busy() ? "processing_d3d21191" : "clear_bce23772")}
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  </section>
}
