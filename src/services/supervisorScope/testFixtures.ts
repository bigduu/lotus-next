import type { NativeCancellationCode, NativeConfirmationUnavailableCode, NativeScopeCancellation, ProjectScopeOwnerAvailability } from "./ownerBridge"
import type { ProjectScopeResponse } from "./types"
export const scopeFixture = (): ProjectScopeResponse => ({ code: "project_scope_configured",
  scope: { supervisor: { session_id: "bamboo-default-supervisor", incarnation_id: "11111111-1111-4111-8111-111111111111" }, state_revision: 0, allowed_projects: ["p1"] },
  capabilities: { project_scope_v1: true, supervised_root_create_v1: true },
  owner_authorization: { available: true, required: true, kind: "trusted_host_intent", http_registration: false } })

export const nativeAvailabilityFixture = (available = true, transportReady = true, code: NativeConfirmationUnavailableCode = "native_confirmation_unavailable"): ProjectScopeOwnerAvailability => ({
  transport_ready: transportReady, authority_profile: { kind: "bamboo_native_confirmation_v1", confirmation_available: available,
    confirmation_required_per_request: true, unavailable_code: available ? null : code },
})
export const nativeCancellationFixture = (code: NativeCancellationCode = "native_confirmation_cancelled"): NativeScopeCancellation => ({ kind: "cancelled", code, status_code: 409, not_submitted: true })
