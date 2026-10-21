import type { ProviderDefaultModelRefKey } from "./providerConfig"

/** Data only: no local paths, credential references, runtime or permission state. */
export interface ShareSelection {
  providers: string[]
  provider_base_urls: string[]
  provider_api_keys: string[]
  scenarios: ProviderDefaultModelRefKey[]
  subagent_models: string[]
  /** Values are excluded unless explicitly selected for each name. */
  env: Record<string, boolean>
}

export const emptyShareSelection = (): ShareSelection => ({
  providers: [], provider_base_urls: [], provider_api_keys: [],
  scenarios: [], subagent_models: [], env: Object.create(null),
})

export type ShareChoice = { action: "skip" | "replace" } | { action: "rename"; target: string }
export interface ShareDecisions {
  providers: Record<string, ShareChoice>
  scenarios: Partial<Record<ProviderDefaultModelRefKey, ShareChoice>>
  subagent_models: Record<string, ShareChoice>
  env: Record<string, ShareChoice>
}
export const emptyShareDecisions = (): ShareDecisions => ({
  providers: Object.create(null), scenarios: Object.create(null), subagent_models: Object.create(null), env: Object.create(null),
})

export interface ShareRevisions { providers: number; env: number; credentials: number }
export interface ShareProviderPreview {
  id: string
  provider_type: string
  label?: string
  has_api_key: boolean
  has_base_url: boolean
  conflict: boolean
  /** Same-ID providers of a different type can only be skipped or renamed. */
  replace_allowed: boolean
  /** Canonical HTTP(S) origins only; never full URLs or secret-bearing values. */
  source_origin?: string
  target_origin?: string
  retains_existing_api_key: boolean
  /** A same-ID origin change can retain credentials or request overrides. */
  credential_origin_risk: boolean
}
export interface SharePreview {
  providers: ShareProviderPreview[]
  scenarios: { scenario: ProviderDefaultModelRefKey; provider: string; model: string; conflict: boolean }[]
  subagent_models: { name: string; provider: string; model: string; conflict: boolean }[]
  env: { name: string; has_value: boolean; secret: boolean; conflict: boolean }[]
  contains_secrets: boolean
}
export interface SharePreviewResponse {
  preview_token: string
  expected_revisions: ShareRevisions
  preview: SharePreview
  apply_blocked: boolean
  warnings?: ("automatic_provider_authentication_blocked" | "credential_key_uninitialized")[]
}
export interface ShareInput { share_string: string; passphrase?: string }
export interface ShareApplyRequest extends ShareInput {
  choices: ShareDecisions
  expected_revisions: ShareRevisions
  preview_token: string
  operation_id: string
}
export interface ShareOperation {
  operation_id: string
  state: "committed" | "pending" | "rejected" | "not_found"
  revisions?: ShareRevisions
}
export interface ShareInventory {
  providers: { id: string; label: string; type: string }[]
  scenarios: { name: ProviderDefaultModelRefKey; provider: string; model: string }[]
  subagent_models: { name: string; provider: string; model: string }[]
  env: { name: string; secret: boolean; has_value: boolean }[]
}

/** Character limit is also checked as UTF-8 bytes before any request. */
export const MAX_SHARE_STRING_BYTES = 1_048_576
export const MAX_SHARE_PASSPHRASE_BYTES = 1_024
export const MIN_SHARE_PASSPHRASE_BYTES = 12
