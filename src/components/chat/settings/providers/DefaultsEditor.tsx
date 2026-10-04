import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useMemo, useRef, useState } from "react"
import type { ReasoningEffort } from "@services/chat/AgentService"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import {
  PROVIDER_DEFAULT_MODEL_REF_KEYS,
  findProviderSnapshotRelationIssues,
  type DefaultsConfig,
  type ProviderDefaultModelRefKey,
  type ProviderSnapshotRelationIssue,
} from "@shared/types/providerConfig"
import type { ProviderModelRef } from "@shared/types/providerModelRef"
import { apiClient, getErrorMessage } from "@services/api"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { EditableModelCombobox } from "./EditableModelCombobox"

const UNSET = "__unset__"
const AUTO_EFFORT = "__auto__"
const REASONING_EFFORTS: readonly { value: ReasoningEffort; label: string }[] = [
  { value: "none", get label() { return uiText("reasoning_none") } },
  { value: "low", get label() { return uiText("low_aa9e366f") } },
  { value: "medium", get label() { return uiText("medium_a567bdaa") } },
  { value: "high", get label() { return uiText("high_b1c27820") } },
  { value: "xhigh", get label() { return uiText("extra_high_392d0dce") } },
  { value: "max", get label() { return uiText("max_9730c15f") } },
]

interface ModelRoleDefinition {
  key: ProviderDefaultModelRefKey
  label: string
  description: string
  required: boolean
}

const PRIMARY_ROLES = [
  {
    key: "chat",
    get label() { return uiText("chat_required_e8946535") },
    get description() { return uiText("used_for_main_chat_and_as_the_final_fallback_for_other__56810104") },
    required: true,
  },
  {
    key: "fast",
    get label() { return uiText("fast_db945cfe") },
    get description() { return uiText("used_for_lightweight_tasks_such_as_title_generation_and_5614b007") },
    required: false,
  },
  {
    key: "vision",
    get label() { return uiText("vision_209c47b5") },
    get description() { return uiText("used_for_image_understanding_and_vision_fallback_falls__5854c68e") },
    required: false,
  },
  {
    key: "sub_agent",
    get label() { return uiText("sub_agent_acd37b4c") },
    get description() { return uiText("default_for_new_subagents_falls_back_to_fast_then_chat__41df0ee5") },
    required: false,
  },
] as const satisfies readonly ModelRoleDefinition[]

const ADVANCED_ROLES = [
  {
    key: "task_summary",
    get label() { return uiText("task_summary_6c36c26b") },
    get description() { return uiText("used_for_task_summaries_and_conversation_compression_fa_a7e90752") },
    required: false,
  },
  {
    key: "memory_background",
    get label() { return uiText("memory_background_86e700b0") },
    get description() { return uiText("used_for_memory_reranking_background_recall_and_auto_dr_1069ef2e") },
    required: false,
  },
  {
    key: "planning",
    get label() { return uiText("planning_29d38fc5") },
    get description() { return uiText("used_for_task_breakdown_architecture_and_coordination_f_e1bd2846") },
    required: false,
  },
  {
    key: "search",
    get label() { return uiText("search_44ce7ae9") },
    get description() { return uiText("used_for_code_search_file_navigation_and_symbol_lookup__7ea18af5") },
    required: false,
  },
  {
    key: "code_review",
    get label() { return uiText("code_review_1fa3244c") },
    get description() { return uiText("used_for_code_review_and_pr_analysis_falls_back_to_fast_5273eb65") },
    required: false,
  },
] as const satisfies readonly ModelRoleDefinition[]

const ROLES: readonly ModelRoleDefinition[] = [...PRIMARY_ROLES, ...ADVANCED_ROLES]

type DraftRef = { provider: string; model: string; reasoningEffort: ReasoningEffort | "" }
type DraftRefs = Record<ProviderDefaultModelRefKey, DraftRef>

interface DefaultsDraft {
  roles: DraftRefs
  subagentModels: Record<string, DraftRef>
}

const emptyRef = (): DraftRef => ({ provider: "", model: "", reasoningEffort: "" })

const copyRef = (ref?: ProviderModelRef): DraftRef => ({
  provider: ref?.provider ?? "",
  model: ref?.model ?? "",
  reasoningEffort: ref?.reasoning_effort ?? "",
})

const payloadRef = (value: DraftRef): ProviderModelRef => ({
  provider: value.provider,
  model: value.model.trim(),
  ...(value.reasoningEffort ? { reasoning_effort: value.reasoningEffort } : {}),
})

function draftFromDefaults(defaults: DefaultsConfig | undefined): DefaultsDraft {
  const roles = Object.fromEntries(
    PROVIDER_DEFAULT_MODEL_REF_KEYS.map((key) => [key, copyRef(defaults?.[key])]),
  ) as DraftRefs

  const subagentModels = Object.fromEntries(
    Object.entries(defaults?.subagent_models ?? {}).map(([name, ref]) => [
      name,
      copyRef(ref),
    ]),
  )
  return { roles, subagentModels }
}

const serializeDraft = (draft: DefaultsDraft): string => JSON.stringify(draft)

const hasCompatibilityRouteIssue = (issues: readonly ProviderSnapshotRelationIssue[]) =>
  issues.some((issue) => issue.kind === "default_provider_instance")

const hasRoleIssue = (
  issues: readonly ProviderSnapshotRelationIssue[],
  role: ProviderDefaultModelRefKey,
) => issues.some((issue) => issue.kind === "default_model_ref" && issue.role === role)

const hasSubagentIssue = (
  issues: readonly ProviderSnapshotRelationIssue[],
  subagent: string,
) => issues.some((issue) => issue.kind === "subagent_model_ref" && issue.subagent === subagent)

/** Edit all defaults.* references while preserving server authority. */
export function DefaultsEditor() {
  useUiLocale()
  const runtimeSnapshot = useProviderStore((state) => state.providerSnapshot)
  const repairSnapshot = useProviderStore((state) => state.providerRepairSnapshot)
  const repairIssues = useProviderStore((state) => state.providerRepairIssues)
  const providerStatus = useProviderStore((state) => state.providerStatus)
  const providerError = useProviderStore((state) => state.providerError)
  const loadProviderInstances = useProviderStore((state) => state.loadProviderInstances)
  const getModelsForProvider = useProviderStore((state) => state.getModelsForProvider)
  const catalog = useProviderStore((state) => state.catalog)

  const snapshot = runtimeSnapshot ?? repairSnapshot
  const instances = snapshot?.instances ?? []
  const defaults = snapshot?.defaults
  const canManage = providerStatus === "ready" || providerStatus === "degraded"

  const initialDraft = draftFromDefaults(defaults)
  const [draft, setDraft] = useState<DefaultsDraft>(() => initialDraft)
  const [baseline, setBaseline] = useState(() => serializeDraft(initialDraft))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty = useMemo(() => serializeDraft(draft) !== baseline, [draft, baseline])
  const compatibilitySyncRequired =
    (defaults?.chat.provider ?? "") !== "" &&
    defaults?.chat.provider !== (snapshot?.default_provider_instance_id ?? "")
  const dirtyRef = useRef(dirty)
  const savingRef = useRef(false)
  dirtyRef.current = dirty

  useEffect(() => {
    if (dirtyRef.current || savingRef.current) return
    const next = draftFromDefaults(defaults)
    setDraft(next)
    setBaseline(serializeDraft(next))
  }, [defaults])

  const setRole = (role: ProviderDefaultModelRefKey, patch: Partial<DraftRef>) =>
    setDraft((current) => ({
      ...current,
      roles: {
        ...current.roles,
        [role]: { ...current.roles[role], ...patch },
      },
    }))

  const setSubagent = (subagent: string, patch: Partial<DraftRef>) =>
    setDraft((current) => ({
      ...current,
      subagentModels: {
        ...current.subagentModels,
        [subagent]: { ...(current.subagentModels[subagent] ?? emptyRef()), ...patch },
      },
    }))

  const save = async () => {
    const instancesById = new Map(instances.map((instance) => [instance.id, instance]))
    for (const role of ROLES) {
      const value = draft.roles[role.key]
      if (!value.provider && !value.model.trim()) {
        if (role.required) {
          setError(uiText("select_a_provider_and_model_for_the_chat_default_5d2bf930"))
          return
        }
        if (hasRoleIssue(repairIssues, role.key)) {
          setError(uiText("explicitly_replace_the_broken_reference_with_an_existin_158974d9", { v0: role.label }))
          return
        }
        continue
      }
      if (!value.provider || !value.model.trim()) {
        setError(uiText("select_both_a_provider_and_model_for_ebb2b990", { v0: role.label }))
        return
      }
      const selectedInstance = instancesById.get(value.provider)
      if (!selectedInstance) {
        setError(uiText("the_provider_referenced_by_is_invalid_select_an_existin_55330622", { v0: role.label }))
        return
      }
      if (!selectedInstance.enabled) {
        setError(uiText("the_provider_referenced_by_is_disabled_enable_it_or_sel_e71c0c57", { v0: role.label }))
        return
      }
    }

    for (const [subagent, value] of Object.entries(draft.subagentModels)) {
      const selectedInstance = instancesById.get(value.provider)
      if (!value.provider || !value.model.trim() || !selectedInstance) {
        setError(uiText("explicitly_replace_the_broken_subagent_reference_with_a_523237bc", { v0: subagent }))
        return
      }
      if (!selectedInstance.enabled) {
        setError(uiText("the_provider_for_subagent_is_disabled_enable_it_or_sele_ef0263ac", { v0: subagent }))
        return
      }
    }

    savingRef.current = true
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const payload: Record<string, unknown> = {}
      for (const role of ROLES) {
        const value = draft.roles[role.key]
        const filled = value.provider !== "" && value.model.trim() !== ""
        payload[role.key] = filled
          ? payloadRef(value)
          : null
      }
      payload.subagent_models = Object.fromEntries(
        Object.entries(draft.subagentModels).map(([subagent, value]) => [
          subagent,
          payloadRef(value),
        ]),
      )

      // Bamboo rewrites model_limits.json on every config write, so carry the
      // current value to avoid deleting an unrelated authoritative sidecar.
      const current = await apiClient.get<{ model_limits?: unknown }>("/bamboo/config")
      await apiClient.post("/bamboo/config", {
        defaults: payload,
        // Bamboo still needs this compatibility route internally. The Chat
        // model preference is the sole user choice, so keep both values atomic.
        default_provider_instance: draft.roles.chat.provider,
        ...(current?.model_limits !== undefined ? { model_limits: current.model_limits } : {}),
      })

      const refreshed = await loadProviderInstances()
      const confirmed = draftFromDefaults(refreshed.defaults)
      setDraft(confirmed)
      setBaseline(serializeDraft(confirmed))
      dirtyRef.current = false

      const remainingIssues = findProviderSnapshotRelationIssues(refreshed)
      if (remainingIssues.length > 0) {
        setError(
          uiText("preferences_saved_but_references_remain_invalid_repair__777c4ffa", { v0: remainingIssues.length }),
        )
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } catch (caught) {
      setError(getErrorMessage(caught))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const providerOptions = (current: string) => {
    const known = instances.some((instance) => instance.id === current)
    return (
      <>
        {current && !known ? (
          <SelectItem value={current} disabled>
            {current}{uiText("invalid_replace_67f9041a")}</SelectItem>
        ) : null}
        {instances.map((instance) => (
          <SelectItem key={instance.id} value={instance.id} disabled={!instance.enabled}>
            {instance.label || instance.type}
            {!instance.enabled ? uiText("disabled_7f9b2a77") : ""}
          </SelectItem>
        ))}
      </>
    )
  }

  const renderRoleEditor = (role: ModelRoleDefinition) => {
    const value = draft.roles[role.key]
    const models = value.provider && catalog ? getModelsForProvider(value.provider) : []
    const invalid = hasRoleIssue(repairIssues, role.key)
    return (
      <div
        key={role.key}
        className={cn(
          "rounded-md border p-2.5",
          invalid && "border-amber-500/50 bg-amber-500/5",
        )}
      >
        <div className="mb-2">
          <div className="text-xs font-medium text-foreground">{role.label}</div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {role.description}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem]">
          <Select
            value={value.provider || UNSET}
            onValueChange={(provider) => {
              if (provider === UNSET) {
                setRole(role.key, emptyRef())
                return
              }
              setRole(role.key, {
                provider,
                model: provider === value.provider ? value.model : "",
              })
            }}
          >
            <SelectTrigger className="w-full" aria-label={uiText("provider_a386a8dd", { v0: role.label })}>
              <SelectValue placeholder={uiText("provider_9e218722")} />
            </SelectTrigger>
            <SelectContent>
              {!role.required && !invalid ? <SelectItem value={UNSET}>{uiText("not_set_2f5f1d6f")}</SelectItem> : null}
              {providerOptions(value.provider)}
            </SelectContent>
          </Select>
          <EditableModelCombobox
            label={uiText("model_a40c0922", { v0: role.label })}
            hideLabel
            value={value.model}
            models={models}
            placeholder={uiText("model_id_8b84338d")}
            disabled={!value.provider}
            onChange={(model) => setRole(role.key, { model })}
          />
          <Select
            value={value.reasoningEffort || AUTO_EFFORT}
            disabled={!value.provider}
            onValueChange={(effort) =>
              setRole(role.key, {
                reasoningEffort:
                  effort === AUTO_EFFORT ? "" : (effort as ReasoningEffort),
              })
            }
          >
            <SelectTrigger className="w-full" aria-label={uiText("reasoning_level_fab1021c", { v0: role.label })}>
              <SelectValue placeholder={uiText("reasoning_level_c8c14507")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_EFFORT}>{uiText("auto_7eb336e4")}</SelectItem>
              {REASONING_EFFORTS.map((effort) => (
                <SelectItem key={effort.value} value={effort.value}>
                  {effort.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    )
  }

  const configuredAdvancedRoleCount = ADVANCED_ROLES.filter(({ key }) => {
    const value = draft.roles[key]
    return value.provider !== "" && value.model.trim() !== ""
  }).length
  const hasAdvancedRepairIssue = ADVANCED_ROLES.some(({ key }) =>
    hasRoleIssue(repairIssues, key),
  )

  if (!canManage) {
    const message =
      providerStatus === "incompatible"
        ? uiText("this_bamboo_provider_configuration_format_is_incompatib_8eefe79f")
        : providerStatus === "unavailable"
          ? uiText("provider_settings_are_currently_unavailable_b04506b2")
          : uiText("loading_provider_settings_46da40c3")
    return (
      <section className="rounded-lg border p-3">
        <p
          role={
            providerStatus === "unavailable" || providerStatus === "incompatible"
              ? "alert"
              : undefined
          }
          className="text-xs text-muted-foreground"
        >
          {message}
          {providerError ? ` ${providerError}` : ""}
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("default_model_preferences_acdce210")}</div>
      <p className="mb-2 text-xs text-muted-foreground">
        {uiText("four_common_purposes_appear_first_unset_specialist_mode_50869c72")}</p>

      {hasCompatibilityRouteIssue(repairIssues) || compatibilitySyncRequired ? (
        <p role="alert" className="mb-2 rounded-md border border-amber-500/50 p-2 text-xs text-amber-700 dark:text-amber-300">
          {uiText("provider_routing_is_not_synchronized_with_chat_preferen_23f833cd")}</p>
      ) : null}

      <div role="group" aria-label={uiText("common_model_purposes_4ad51f49")} className="space-y-2">
        {PRIMARY_ROLES.map(renderRoleEditor)}
      </div>

      <details
        className="mt-3 rounded-md border"
        open={hasAdvancedRepairIssue || undefined}
      >
        <summary className="cursor-pointer px-2.5 py-2 text-xs font-medium text-muted-foreground">
          {uiText("advanced_model_routing_62a178ed")} <span className="font-normal">
            {uiText("usually_unnecessary_f3a49923")}
            {configuredAdvancedRoleCount > 0 ? uiText("configured_e17db314", { v0: configuredAdvancedRoleCount }) : ""}
          </span>
        </summary>
        <div className="border-t p-2.5">
          <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
            {uiText("override_common_models_only_for_the_corresponding_speci_e1d880b7")}</p>
          <div role="group" aria-label={uiText("advanced_model_purposes_c23c6a8e")} className="space-y-2">
            {ADVANCED_ROLES.map(renderRoleEditor)}
          </div>
        </div>
      </details>

      {Object.keys(draft.subagentModels).length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">{uiText("subagent_model_mapping_4238aed0")}</div>
          {Object.entries(draft.subagentModels).map(([subagent, value]) => {
            const models = value.provider && catalog ? getModelsForProvider(value.provider) : []
            const invalid = hasSubagentIssue(repairIssues, subagent)
            return (
              <div
                key={subagent}
                className={cn(
                  "rounded-md",
                  invalid && "border border-amber-500/50 bg-amber-500/5 p-1",
                )}
              >
                <span className="mb-1 block truncate text-xs text-muted-foreground" title={subagent}>
                  {subagent}
                </span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem]">
                  <Select
                    value={value.provider}
                    onValueChange={(provider) =>
                      setSubagent(subagent, {
                        provider,
                        model: provider === value.provider ? value.model : "",
                      })
                    }
                  >
                    <SelectTrigger className="w-full" aria-label={uiText("subagent_provider_7c3689a7", { v0: subagent })}>
                      <SelectValue placeholder={uiText("provider_9e218722")} />
                    </SelectTrigger>
                    <SelectContent>{providerOptions(value.provider)}</SelectContent>
                  </Select>
                  <EditableModelCombobox
                    label={uiText("subagent_model_f8fb17fb", { v0: subagent })}
                    hideLabel
                    value={value.model}
                    models={models}
                    placeholder={uiText("model_id_8b84338d")}
                    disabled={!value.provider}
                    onChange={(model) => setSubagent(subagent, { model })}
                  />
                  <Select
                    value={value.reasoningEffort || AUTO_EFFORT}
                    disabled={!value.provider}
                    onValueChange={(effort) =>
                      setSubagent(subagent, {
                        reasoningEffort:
                          effort === AUTO_EFFORT
                            ? ""
                            : (effort as ReasoningEffort),
                      })
                    }
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label={uiText("subagent_reasoning_level_f14c2262", { v0: subagent })}
                    >
                      <SelectValue placeholder={uiText("reasoning_level_c8c14507")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO_EFFORT}>{uiText("auto_7eb336e4")}</SelectItem>
                      {REASONING_EFFORTS.map((effort) => (
                        <SelectItem key={effort.value} value={effort.value}>
                          {effort.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

      <div className="mt-2.5 flex items-center justify-end gap-2">
        {saved ? <span className="text-xs text-emerald-500">{uiText("saved_1bd91a7d")}</span> : null}
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={saving || (!dirty && !compatibilitySyncRequired)}
        >
          {saving ? uiText("saving_ff509c9b") : uiText("save_preferences_f96c9903")}
        </Button>
      </div>
    </section>
  )
}
