import type { ReasoningEffort } from "@services/chat/AgentService"
import type { BambooConfig, BambooMemoryConfig } from "@services/common/ServiceFactory"

/** One persisted model-limit override row (mirrors backend `ModelLimit`). */
export interface ModelLimitOverride {
  model_pattern: string
  max_context_tokens: number
  max_output_tokens?: number | null
  unlimited_output?: boolean
  safety_margin?: number | null
}

export type ContextManagementStrategy = "summary" | "message_summary" | "retrieval_window"

export interface RetrievalWindowConfig {
  min_recent_user_turns?: number
  trigger_usage_ratio?: number
  target_usage_ratio?: number
  history_tool_required?: boolean
  fallback_strategy?: "none" | "summary"
}

export interface ContextManagementConfig {
  strategy?: ContextManagementStrategy
  retrieval_window?: RetrievalWindowConfig
}

export interface WorkFeatureFlags {
  ticket_mutation: boolean
  ticket_dispatch: boolean
  work_ultra_by_default?: boolean
  work_execution?: WorkExecutionSettings
}

export interface WorkExecutionSettings {
  reasoning_effort: ReasoningEffort | null
  max_parallel: number | null
}

/**
 * BambooConfig with the extra sections this panel edits typed out
 * (the base interface only carries an index signature for them).
 */
export interface SystemBambooConfig extends BambooConfig {
  features?: Partial<WorkFeatureFlags>
  memory?: BambooMemoryConfig & { auto_dream_interval_secs?: number }
  hooks?: { image_fallback?: { enabled?: boolean; mode?: string } }
  model_limits?: ModelLimitOverride[]
  access_control?: { password_enabled?: boolean }
  context_management?: ContextManagementConfig
}

/** Inline status line state shared by the section forms. */
export type SectionMessage = { kind: "ok" | "error"; text: string } | null
