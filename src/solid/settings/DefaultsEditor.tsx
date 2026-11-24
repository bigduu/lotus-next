import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js"
import type { ReasoningEffort } from "@services/chat/AgentService"
import { getErrorMessage } from "@services/api"
import { providerStore } from "@shared/store/appStore/slices/providerState"
import type { ProviderDefaultModelRefKey, ProviderInstance } from "@shared/types/providerConfig"
import type { ProviderModelDescriptor } from "@shared/types/providerModelRef"
import { cn } from "@/lib/utils"
import { createStoreSelector } from "../state/createStoreSelector"
import { createUiText } from "../shell/uiText"
import { Button } from "../ui/button"
import { Select, type SelectOption } from "../ui/select"
import { EditableModelCombobox } from "./EditableModelCombobox"
import {
  ADVANCED_ROLES,
  PRIMARY_ROLES,
  draftFromDefaults,
  emptyRef,
  hasCompatibilityRouteIssue,
  hasRoleIssue,
  hasSubagentIssue,
  saveDefaults,
  validateDefaults,
  type DraftRef,
} from "./providerDefaults"

const UNSET = "__unset__"
const AUTO_EFFORT = "__auto__"
const EFFORTS = [
  { value: "none", label: "reasoning_none" },
  { value: "low", label: "low_aa9e366f" },
  { value: "medium", label: "medium_a567bdaa" },
  { value: "high", label: "high_b1c27820" },
  { value: "xhigh", label: "extra_high_392d0dce" },
  { value: "max", label: "max_9730c15f" },
] as const

type Purpose = typeof PRIMARY_ROLES[number] | typeof ADVANCED_ROLES[number]

interface ModelFieldsProps {
  value: DraftRef
  instances: readonly ProviderInstance[]
  models?: readonly ProviderModelDescriptor[]
  providerLabel: string
  modelLabel: string
  effortLabel: string
  canUnset?: boolean
  disabled?: boolean
  ultra?: boolean
  onUltra?(enabled: boolean): void
  update(patch: Partial<DraftRef>): void
}

function ModelFields(props: ModelFieldsProps) {
  const text = createUiText()

  const providerOptions = createMemo(() => {
    const current = props.value.provider
    const options: SelectOption[] = props.instances.map((instance) => ({
      value: instance.id,
      label: (instance.label || instance.type) + (instance.enabled ? "" : text("disabled_7f9b2a77")),
      disabled: !instance.enabled,
    }))
    if (current && !props.instances.some((instance) => instance.id === current)) {
      options.unshift({ value: current, label: current + text("invalid_replace_67f9041a"), disabled: true })
    }
    if (props.canUnset) options.unshift({ value: UNSET, label: text("not_set_2f5f1d6f") })
    return options
  })
  const effortOptions = createMemo(() => [
    { value: AUTO_EFFORT, label: text("auto_7eb336e4") },
    ...EFFORTS.map((effort) => ({ value: effort.value, label: text(effort.label) })),
    ...(props.onUltra ? [{ value: "ultra", label: text("ultra_orchestration_5857fcd7") }] : []),
  ])
  return (
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem]">
      <Select selectOnly class="w-full"
        label={props.providerLabel}
        value={props.value.provider || (props.canUnset ? UNSET : undefined)}
        disabled={props.disabled}
        options={providerOptions()}
        placeholder={text("provider_9e218722")}
        onValueChange={(value) => {
          if (value === UNSET) props.update(emptyRef())
          else props.update({ provider: value, model: value === props.value.provider ? props.value.model : "" })
        }}
      />
      <EditableModelCombobox
        label={props.modelLabel}
        hideLabel
        value={props.value.model}
        models={props.models}
        placeholder={text("model_id_8b84338d")}
        disabled={!props.value.provider || props.disabled}
        onChange={(model) => props.update({ model })}
      />
      <Select selectOnly class="w-full"
        label={props.effortLabel}
        options={effortOptions()}
        disabled={!props.value.provider || props.disabled}
        value={props.ultra ? "ultra" : props.value.reasoningEffort || AUTO_EFFORT}
        onValueChange={(effort) => {
          props.onUltra?.(effort === "ultra")
          if (effort !== "ultra") props.update({ reasoningEffort: effort === AUTO_EFFORT ? "" : effort as ReasoningEffort })
        }}
      />
    </div>
  )
}

export function DefaultsEditor() {
  const text = createUiText()
  const state = createStoreSelector(providerStore, (value) => value)
  const snapshot = createMemo(() => state().providerSnapshot ?? state().providerRepairSnapshot)
  const canManage = () => state().providerStatus === "ready" || state().providerStatus === "degraded"
  const [baseline, setBaseline] = createSignal(draftFromDefaults(undefined, false))
  const [draft, setDraft] = createSignal(draftFromDefaults(undefined, false))
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [saved, setSaved] = createSignal(false)
  let savedTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const dirty = createMemo(() => JSON.stringify(draft()) !== JSON.stringify(baseline()))
  const compatibilitySync = createMemo(() => {
    const current = snapshot()
    return !!current?.defaults?.chat.provider &&
      current.defaults.chat.provider !== (current.default_provider_instance_id ?? "")
  })
  createEffect(snapshot, (value) => {
    if (!value || untrack(() => dirty() || saving())) return
    const next = draftFromDefaults(value.defaults, value.features?.chat_ultra_by_default === true)
    setDraft(next)
    setBaseline(next)
  })
  onSettled(() => () => {
    disposed = true
    clearTimeout(savedTimer)
  })

  const applyPatch = (value: DraftRef, patch: Partial<DraftRef>): DraftRef => {
    const next = { ...value, ...patch }
    return next.provider === value.provider && next.model === value.model &&
      next.reasoningEffort === value.reasoningEffort ? value : next
  }
  const setRole = (role: ProviderDefaultModelRefKey, patch: Partial<DraftRef>) =>
    setDraft((current) => {
      const value = current.roles[role]
      const next = applyPatch(value, patch)
      return next === value ? current : { ...current, roles: { ...current.roles, [role]: next } }
    })
  const setSubagent = (name: string, patch: Partial<DraftRef>) =>
    setDraft((current) => {
      const value = current.subagentModels[name] ?? emptyRef()
      const next = applyPatch(value, patch)
      return next === value ? current : { ...current, subagentModels: { ...current.subagentModels, [name]: next } }
    })

  const modelsFor = (provider: string) => provider && state().catalog
    ? state().getModelsForProvider(provider) : []
  const save = async () => {
    const current = snapshot()
    if (!current || saving()) return
    const selected = draft()
    const invalid = validateDefaults(current, selected, state().providerRepairIssues, text)
    if (invalid) { setError(invalid); return }

    const previous = baseline()
    setSaving(true)
    setError(null)
    setSaved(false)
    clearTimeout(savedTimer)
    try {
      const { confirmed, remainingIssues } = await saveDefaults(selected, previous, text)
      if (disposed) return
      setDraft(confirmed)
      setBaseline(confirmed)
      if (remainingIssues.length) {
        setError(text("preferences_saved_but_references_remain_invalid_repair__777c4ffa", { v0: remainingIssues.length }))
      } else {
        setSaved(true)
        savedTimer = setTimeout(() => setSaved(false), 2500)
      }
    } catch (caught) {
      if (!disposed) setError(getErrorMessage(caught))
    } finally {
      if (!disposed) setSaving(false)
    }
  }

  const roleEditor = (role: Purpose) => {
    const label = () => text(role.label)
    const value = () => draft().roles[role.key]
    const invalid = () => hasRoleIssue(state().providerRepairIssues, role.key)
    const isChat = role.key === "chat"
    return (
      <div class={cn("rounded-md border p-2.5", invalid() && "border-amber-500/50 bg-amber-500/5")}>
        <div class="mb-2">
          <div class="text-xs font-medium text-foreground">{label()}</div>
          <p class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{text(role.description)}</p>
        </div>
        <ModelFields
          value={value()}
          instances={snapshot()?.instances ?? []}
          models={modelsFor(value().provider)}
          providerLabel={text("provider_a386a8dd", { v0: label() })}
          modelLabel={text("model_a40c0922", { v0: label() })}
          effortLabel={text("reasoning_level_fab1021c", { v0: label() })}
          canUnset={!role.required && !invalid()}
          disabled={saving()}
          ultra={isChat && draft().chatUltra}
          onUltra={isChat ? (chatUltra) => setDraft((value) => chatUltra === value.chatUltra ? value : { ...value, chatUltra }) : undefined}
          update={(patch) => setRole(role.key, patch)}
        />
        <Show when={isChat && draft().chatUltra}>
          <p class="mt-2 text-[11px] text-muted-foreground">{text("chat_ultra_default_description")}</p>
        </Show>
      </div>
    )
  }
  const advancedConfigured = () => ADVANCED_ROLES.filter(({ key }) => {
    const ref = draft().roles[key]
    return !!ref.provider && !!ref.model.trim()
  }).length
  const hasAdvancedIssue = () => ADVANCED_ROLES.some(({ key }) => hasRoleIssue(state().providerRepairIssues, key))

  return (
    <Show when={canManage()}>
      <section class="rounded-lg border p-3">
        <div class="mb-2 text-xs font-medium text-muted-foreground">{text("default_model_preferences_acdce210")}</div>
        <p class="mb-2 text-xs text-muted-foreground">{text("four_common_purposes_appear_first_unset_specialist_mode_50869c72")}</p>

        <Show when={hasCompatibilityRouteIssue(state().providerRepairIssues) || compatibilitySync()}>
          <p role="alert" class="mb-2 rounded-md border border-amber-500/50 p-2 text-xs text-amber-700 dark:text-amber-300">
            {text("provider_routing_is_not_synchronized_with_chat_preferen_23f833cd")}
          </p>
        </Show>
        <div role="group" aria-label={text("common_model_purposes_4ad51f49")} class="space-y-2">
          <For each={PRIMARY_ROLES}>{roleEditor}</For>
        </div>
        <details class="mt-3 rounded-md border" open={hasAdvancedIssue()}>
          <summary class="cursor-pointer px-2.5 py-2 text-xs font-medium text-muted-foreground">
            {text("advanced_model_routing_62a178ed")} <span class="font-normal">
              {text("usually_unnecessary_f3a49923")}
              {advancedConfigured() ? text("configured_e17db314", { v0: advancedConfigured() }) : ""}
            </span>
          </summary>
          <div class="border-t p-2.5">
            <p class="mb-2 text-[11px] leading-relaxed text-muted-foreground">
              {text("override_common_models_only_for_the_corresponding_speci_e1d880b7")}
            </p>
            <div role="group" aria-label={text("advanced_model_purposes_c23c6a8e")} class="space-y-2">
              <For each={ADVANCED_ROLES}>{roleEditor}</For>
            </div>
          </div>
        </details>
        <Show when={Object.keys(draft().subagentModels).length}>
          <div class="mt-3 space-y-2">
            <div class="text-xs font-medium text-muted-foreground">{text("subagent_model_mapping_4238aed0")}</div>
            <For each={Object.keys(draft().subagentModels)}>{(name) => {
              const value = () => draft().subagentModels[name]
              return (
                <div class={cn("rounded-md", hasSubagentIssue(state().providerRepairIssues, name) && "border border-amber-500/50 bg-amber-500/5 p-1")}>
                  <span class="mb-1 block truncate text-xs text-muted-foreground" title={name}>{name}</span>
                  <ModelFields value={value()} instances={snapshot()?.instances ?? []} models={modelsFor(value().provider)}
                    providerLabel={text("subagent_provider_7c3689a7", { v0: name })}
                    modelLabel={text("subagent_model_f8fb17fb", { v0: name })}
                    effortLabel={text("subagent_reasoning_level_f14c2262", { v0: name })}
                    disabled={saving()} update={(patch) => setSubagent(name, patch)} />
                </div>
              )
            }}</For>
          </div>
        </Show>
        <Show when={error()}>
          <p role="alert" class="mt-2 text-xs text-destructive">{error()}</p>
        </Show>
        <div class="mt-2.5 flex items-center justify-end gap-2">
          <Show when={saved()}><span class="text-xs text-emerald-500">{text("saved_1bd91a7d")}</span></Show>
          <Button size="sm" onClick={() => void save()} disabled={saving() || (!dirty() && !compatibilitySync())}>
            {saving() ? text("saving_ff509c9b") : text("save_preferences_f96c9903")}
          </Button>
        </div>
      </section>
    </Show>
  )
}
