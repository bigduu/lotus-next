import type { ReasoningEffort } from "@services/chat/AgentService"
import type { uiText as translate } from "@shared/i18n/text"
import {
  findProviderSnapshotRelationIssues,
  getRuntimeModelIds,
  PROVIDER_DEFAULT_MODEL_REF_KEYS,
  type DefaultsConfig,
  type ProviderDefaultModelRefKey,
  type ProviderInstancesConfig,
  type ProviderSnapshotRelationIssue,
} from "@shared/types/providerConfig"
import type { ProviderModelRef } from "@shared/types/providerModelRef"
import { apiClient } from "@services/api"
import { providerStore } from "@shared/store/appStore/slices/providerState"

type UiText = typeof translate

interface ModelRoleDefinition {
  key: ProviderDefaultModelRefKey
  label: Parameters<UiText>[0]
  description: Parameters<UiText>[0]
  required: boolean
}

export const PRIMARY_ROLES = [
  {
    key: "chat",
    label: "chat_required_e8946535",
    description: "used_for_main_chat_and_as_the_final_fallback_for_other__56810104",
    required: true,
  },
  {
    key: "fast",
    label: "fast_db945cfe",
    description: "used_for_lightweight_tasks_such_as_title_generation_and_5614b007",
    required: false,
  },
  {
    key: "vision",
    label: "vision_209c47b5",
    description: "used_for_image_understanding_and_vision_fallback_falls__5854c68e",
    required: false,
  },
  {
    key: "sub_agent",
    label: "sub_agent_acd37b4c",
    description: "default_for_new_subagents_falls_back_to_fast_then_chat__41df0ee5",
    required: false,
  },
] as const satisfies readonly ModelRoleDefinition[]

export const ADVANCED_ROLES = [
  {
    key: "task_summary",
    label: "task_summary_6c36c26b",
    description: "used_for_task_summaries_and_conversation_compression_fa_a7e90752",
    required: false,
  },
  {
    key: "memory_background",
    label: "memory_background_86e700b0",
    description: "used_for_memory_reranking_background_recall_and_auto_dr_1069ef2e",
    required: false,
  },
  {
    key: "planning",
    label: "planning_29d38fc5",
    description: "used_for_task_breakdown_architecture_and_coordination_f_e1bd2846",
    required: false,
  },
  {
    key: "search",
    label: "search_44ce7ae9",
    description: "used_for_code_search_file_navigation_and_symbol_lookup__7ea18af5",
    required: false,
  },
  {
    key: "code_review",
    label: "code_review_1fa3244c",
    description: "used_for_code_review_and_pr_analysis_falls_back_to_fast_5273eb65",
    required: false,
  },
  {
    key: "work_review",
    label: "work_review_model_purpose",
    description: "work_review_model_description",
    required: false,
  },
] as const satisfies readonly ModelRoleDefinition[]

const ROLES: readonly ModelRoleDefinition[] = [...PRIMARY_ROLES, ...ADVANCED_ROLES]

export type DraftRef = { provider: string; model: string; reasoningEffort: ReasoningEffort | "" }
type DraftRefs = Record<ProviderDefaultModelRefKey, DraftRef>

export interface DefaultsDraft {
  roles: DraftRefs
  subagentModels: Record<string, DraftRef>
  chatUltra: boolean
}

export const emptyRef = (): DraftRef => ({ provider: "", model: "", reasoningEffort: "" })

const copyRef = (ref?: ProviderModelRef): DraftRef => ({
  provider: ref?.provider ?? "",
  model: ref?.model ?? "",
  reasoningEffort: ref?.reasoning_effort ?? "",
})

export const payloadRef = (value: DraftRef): ProviderModelRef => ({
  provider: value.provider,
  model: value.model.trim(),
  ...(value.reasoningEffort ? { reasoning_effort: value.reasoningEffort } : {}),
})

export function draftFromDefaults(defaults: DefaultsConfig | undefined, chatUltra: boolean): DefaultsDraft {
  const roles = Object.fromEntries(
    PROVIDER_DEFAULT_MODEL_REF_KEYS.map((key) => [key, copyRef(defaults?.[key])]),
  ) as DraftRefs

  const subagentModels = Object.fromEntries(
    Object.entries(defaults?.subagent_models ?? {}).map(([name, ref]) => [
      name,
      copyRef(ref),
    ]),
  )
  return { roles, subagentModels, chatUltra }
}

export const hasCompatibilityRouteIssue = (issues: readonly ProviderSnapshotRelationIssue[]) =>
  issues.some((issue) => issue.kind === "default_provider_instance")

export const hasRoleIssue = (
  issues: readonly ProviderSnapshotRelationIssue[],
  role: ProviderDefaultModelRefKey,
) => issues.some((issue) => issue.kind === "default_model_ref" && issue.role === role)

export const hasSubagentIssue = (
  issues: readonly ProviderSnapshotRelationIssue[],
  subagent: string,
) => issues.some((issue) => issue.kind === "subagent_model_ref" && issue.subagent === subagent)

export function validateDefaults(
  snapshot: ProviderInstancesConfig,
  draft: DefaultsDraft,
  repairIssues: readonly ProviderSnapshotRelationIssue[],
  text: UiText,
): string | undefined {
  const instancesById = new Map(snapshot.instances.map((instance) => [instance.id, instance]))
  for (const role of ROLES) {
    const value = draft.roles[role.key]
    if (!value.provider && !value.model.trim()) {
      if (role.required) {
        return text("select_a_provider_and_model_for_the_chat_default_5d2bf930")
      }
      if (hasRoleIssue(repairIssues, role.key)) {
        return text("explicitly_replace_the_broken_reference_with_an_existin_158974d9", { v0: text(role.label) })
      }
      continue
    }
    if (!value.provider || !value.model.trim()) {
      return text("select_both_a_provider_and_model_for_ebb2b990", { v0: text(role.label) })
    }
    const selectedInstance = instancesById.get(value.provider)
    if (!selectedInstance) {
      return text("the_provider_referenced_by_is_invalid_select_an_existin_55330622", { v0: text(role.label) })
    }
    if (!selectedInstance.enabled) {
      return text("the_provider_referenced_by_is_disabled_enable_it_or_sel_e71c0c57", { v0: text(role.label) })
    }
    if (!getRuntimeModelIds(selectedInstance, snapshot.defaults).includes(value.model.trim())) {
      return text("runtime_models_role_required", { model: value.model.trim() })
    }
  }

  for (const [subagent, value] of Object.entries(draft.subagentModels)) {
    const selectedInstance = instancesById.get(value.provider)
    if (!value.provider || !value.model.trim() || !selectedInstance) {
      return text("explicitly_replace_the_broken_subagent_reference_with_a_523237bc", { v0: subagent })
    }
    if (!selectedInstance.enabled) {
      return text("the_provider_for_subagent_is_disabled_enable_it_or_sele_ef0263ac", { v0: subagent })
    }
    if (!getRuntimeModelIds(selectedInstance, snapshot.defaults).includes(value.model.trim())) {
      return text("runtime_models_role_required", { model: value.model.trim() })
    }
  }
  return undefined
}

export async function saveDefaults(draft: DefaultsDraft, baseline: DefaultsDraft, text: UiText) {
  const payload: Record<string, unknown> = {}
  for (const role of ROLES) {
    const value = draft.roles[role.key]
    const filled = value.provider !== "" && value.model.trim() !== ""
    payload[role.key] = filled
      ? payloadRef(value)
      : null
  }
  const chat = draft.roles.chat
  if (!chat.reasoningEffort && baseline.roles.chat.reasoningEffort) {
    payload.chat = { ...payloadRef(chat), reasoning_effort: null }
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
  const chatUltraChanged = draft.chatUltra !== baseline.chatUltra
  await apiClient.post("/bamboo/config", {
    defaults: payload,
    ...(chatUltraChanged ? { features: { chat_ultra_by_default: draft.chatUltra } } : {}),
    // Bamboo still needs this compatibility route internally. The Chat
    // model preference is the sole user choice, so keep both values atomic.
    default_provider_instance: draft.roles.chat.provider,
    ...(current?.model_limits !== undefined ? { model_limits: current.model_limits } : {}),
  })

  const refreshed = await providerStore.getState().loadProviderInstances()
  if (chatUltraChanged && refreshed.features?.chat_ultra_by_default !== draft.chatUltra) {
    throw new Error(text("chat_ultra_default_unconfirmed"))
  }
  return {
    confirmed: draftFromDefaults(refreshed.defaults, refreshed.features?.chat_ultra_by_default === true),
    remainingIssues: findProviderSnapshotRelationIssues(refreshed),
  }
}
