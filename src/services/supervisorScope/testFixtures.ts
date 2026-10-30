import type { NativeCancellationCode, NativeConfirmationUnavailableCode, NativeScopeCancellation, ProjectScopeOwnerAvailability } from "./ownerBridge"
import type { ProjectScopeResponse } from "./types"
import type { CurrentUserSessionTarget, ManagedSessionsResponse } from "./managedSessions"
export const scopeFixture = (): ProjectScopeResponse => ({ code: "project_scope_configured",
  scope: { supervisor: { session_id: "bamboo-default-supervisor", incarnation_id: "11111111-1111-4111-8111-111111111111" }, state_revision: 0, allowed_projects: ["p1"] },
  capabilities: { project_scope_v1: true, supervised_root_create_v1: true },
  owner_authorization: { available: true, required: true, kind: "trusted_host_intent", http_registration: false } })

export const nativeAvailabilityFixture = (available = true, transportReady = true, code: NativeConfirmationUnavailableCode = "native_confirmation_unavailable"): ProjectScopeOwnerAvailability => ({
  transport_ready: transportReady, authority_profile: { kind: "bamboo_native_confirmation_v1", confirmation_available: available,
    confirmation_required_per_request: true, unavailable_code: available ? null : code },
})
export const nativeCancellationFixture = (code: NativeCancellationCode = "native_confirmation_cancelled"): NativeScopeCancellation => ({ kind: "cancelled", code, status_code: 409, not_submitted: true })

export const httpScopeFixture = (available = true): ProjectScopeResponse => ({ ...scopeFixture(),
  capabilities: { ...scopeFixture().capabilities, project_scope_http_write_v1: true },
  owner_authorization: { available, required: true, kind: "existing_access", http_registration: false, code: null } })

export const currentUserScopeFixture = (): ProjectScopeResponse => ({ ...httpScopeFixture(),
  code: "current_user_scope_ready",
  scope: { ...scopeFixture().scope, allowed_projects: [] },
  capabilities: { ...httpScopeFixture().capabilities, supervisor_current_user_scope_v1: true },
  management_access: { kind: "current_user", default_all_projects: true, default_all_sessions: true,
    requires_project_authorization: false, requires_session_attachment: false, orchestration_revision: 7 } })

export const currentUserManagedSessionsFixture = (next_after: string | null = null): ManagedSessionsResponse => {
  const targets: CurrentUserSessionTarget[] = [
    { session_id: "root-a", kind: "root", root_session_id: "root-a", parent_session_id: null, project_id: null,
      created_at: "2026-10-27T00:00:00Z", metadata_version: 2, authority_sha256: "a".repeat(64), ancestry_sha256: "b".repeat(64) },
    { session_id: "child-a", kind: "child", root_session_id: "root-a", parent_session_id: "root-a", project_id: "outside-legacy",
      created_at: "2026-10-27T00:01:00Z", metadata_version: 3, authority_sha256: "c".repeat(64), ancestry_sha256: "d".repeat(64) },
  ]
  return { capabilities: { managed_sessions_http_v1: true, supervisor_current_user_scope_v1: true, current_user_bound_history_v1: true },
    scope: { ...httpScopeFixture().scope, state_revision: 4, allowed_projects: [] },
    owner_authorization: { available: true, required: true, kind: "existing_access", http_registration: false, code: null },
    management_access: { kind: "current_user", requires_session_attachment: false }, next_after,
    legacy_links: { "legacy-only": { revision: 3, enabled: false, target_created_at: "2026-10-26T00:00:00Z", target_project_id: "p1", target_metadata_version: 1 } },
    sessions: targets.map((target) => ({ session_id: target.session_id, kind: target.kind, root_session_id: target.root_session_id,
      parent_session_id: target.parent_session_id, link_revision: 0, enabled: true, authorized: true, authorization_error: null,
      target_created_at: target.created_at, target_project_id: target.project_id, target_metadata_version: target.metadata_version, current_user_target: target })) }
}
