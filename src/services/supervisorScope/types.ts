export interface SupervisorReference {
  readonly session_id: "bamboo-default-supervisor"
  readonly incarnation_id: string
}
export const ownerAuthenticationCodes = ["owner_authentication_required", "owner_authentication_unconfigured", "owner_authentication_unavailable"] as const
export type OwnerAuthenticationCode = typeof ownerAuthenticationCodes[number]
export interface ProjectScopeResponse {
  readonly code: "project_scope_uninitialized" | "project_scope_configured"
  readonly scope: { readonly supervisor: SupervisorReference; readonly state_revision: number; readonly allowed_projects: readonly string[] }
  readonly capabilities: { readonly project_scope_v1: true; readonly supervised_root_create_v1: boolean; readonly project_scope_http_write_v1?: true }
  readonly owner_authorization: { readonly available: boolean; readonly required: true; readonly http_registration: false } & (
    { readonly kind: "trusted_host_intent"; readonly code?: never }
    | { readonly kind: "authenticated_owner"; readonly code: OwnerAuthenticationCode | null }
  )
}
export interface ProjectOption { readonly id: string; readonly name: string; readonly status: "active" | "archived" }
/** Immutable full-set review; HTTP encodes only the three frozen PUT fields. */
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
export const scopeErrorCodes = [...ownerAuthenticationCodes, "owner_request_origin_invalid", "supervisor_missing", "supervisor_identity_mismatch", "host_owner_authorization_unavailable",
  "host_owner_authorization_required", "scope_revision_conflict", "project_unavailable", "project_archived",
  "project_scope_invalid", "scope_authority_invalid", "scope_unavailable", "project_store_unavailable"] as const
export type ScopeErrorCode = typeof scopeErrorCodes[number]
export interface ScopeProblem { readonly kind: "unsupported" | "missing" | "authentication" | "forbidden" | "conflict" | "unavailable" | "invalid" | "error"; readonly code?: ScopeErrorCode }
