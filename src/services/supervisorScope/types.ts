export interface SupervisorReference {
  readonly session_id: "bamboo-default-supervisor"
  readonly incarnation_id: string
}
export interface ProjectScopeResponse {
  readonly code: "project_scope_uninitialized" | "project_scope_configured"
  readonly scope: { readonly supervisor: SupervisorReference; readonly state_revision: number; readonly allowed_projects: readonly string[] }
  readonly capabilities: { readonly project_scope_v1: true; readonly supervised_root_create_v1: boolean }
  readonly owner_authorization: { readonly available: boolean; readonly required: true; readonly kind: "trusted_host_intent"; readonly http_registration: false }
}
export interface ProjectOption { readonly id: string; readonly name: string; readonly status: "active" | "archived" }
/** Local bridge port, not a frozen Tauri command or a proof wire format. */
export interface ProjectScopeIntent {
  readonly supervisor: SupervisorReference
  readonly expected_state_revision: number
  readonly mutation: { readonly kind: "configure_project_scope"; readonly allowed_projects: readonly string[] }
}
export interface ProjectScopeReceipt {
  readonly supervisor: SupervisorReference
  readonly state_revision: number
  readonly changed: boolean
  readonly link_revision: number | null
}
export const scopeErrorCodes = ["supervisor_missing", "supervisor_identity_mismatch", "host_owner_authorization_unavailable",
  "host_owner_authorization_required", "scope_revision_conflict", "project_unavailable", "project_archived",
  "project_scope_invalid", "scope_authority_invalid", "scope_unavailable", "project_store_unavailable"] as const
export type ScopeErrorCode = typeof scopeErrorCodes[number]
export interface ScopeProblem { readonly kind: "unsupported" | "missing" | "forbidden" | "conflict" | "unavailable" | "invalid" | "error"; readonly code?: ScopeErrorCode }
