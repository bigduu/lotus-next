import type { ProjectScopeIntent, ProjectScopeResponse, ScopeErrorCode } from "./types"

export const nativeConfirmationUnavailableCodes = ["native_confirmation_not_enabled", "native_confirmation_unsupported_platform",
  "native_confirmation_no_gui", "native_confirmation_thread_unavailable", "native_confirmation_unavailable"] as const
export const nativeCancellationCodes = ["native_confirmation_cancelled", "native_confirmation_window_closed", "native_confirmation_timed_out"] as const
export type NativeConfirmationUnavailableCode = typeof nativeConfirmationUnavailableCodes[number]
export type NativeCancellationCode = typeof nativeCancellationCodes[number]
export type ProjectScopeOwnerErrorCode = ScopeErrorCode | NativeConfirmationUnavailableCode
export type ProjectScopeOwnerNoticeCode = ProjectScopeOwnerErrorCode | NativeCancellationCode
export interface NativeConfirmationProfile {
  readonly kind: "bamboo_native_confirmation_v1"
  readonly confirmation_available: boolean
  readonly confirmation_required_per_request: true
  readonly unavailable_code: NativeConfirmationUnavailableCode | null
}
/** Local native-port result, not an IPC envelope or an HTTP capability. */
export interface ProjectScopeOwnerAvailability {
  readonly transport_ready: boolean
  readonly authority_profile: NativeConfirmationProfile | null
}
export interface NativeScopeCancellation {
  readonly kind: "cancelled"
  readonly code: NativeCancellationCode
  readonly status_code: 409
  readonly not_submitted: true
}
export type ProjectScopeOwnerOutcome =
  | NativeScopeCancellation // Only a verified pre-CAS native cancellation can assert not_submitted.
  | { readonly kind: "unavailable" }
  | { readonly kind: "applied"; readonly receipt: unknown }
  | { readonly kind: "rejected"; readonly status: number; readonly code?: ProjectScopeOwnerErrorCode }
  | { readonly kind: "unknown" }

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
export const isNativeConfirmationUnavailableCode = (value: unknown): value is NativeConfirmationUnavailableCode => nativeConfirmationUnavailableCodes.includes(value as NativeConfirmationUnavailableCode)
export function decodeProjectScopeOwnerAvailability(value: unknown): ProjectScopeOwnerAvailability | null {
  const body = record(value)
  if (!body || typeof body.transport_ready !== "boolean") return null
  if (body.authority_profile === null) return { transport_ready: body.transport_ready, authority_profile: null }
  const profile = record(body.authority_profile)
  if (!profile || Object.keys(profile).length !== 4 || profile.kind !== "bamboo_native_confirmation_v1"
    || typeof profile.confirmation_available !== "boolean" || profile.confirmation_required_per_request !== true
    || (profile.confirmation_available ? profile.unavailable_code !== null : !isNativeConfirmationUnavailableCode(profile.unavailable_code))) return null
  return { transport_ready: body.transport_ready, authority_profile: { kind: "bamboo_native_confirmation_v1",
    confirmation_available: profile.confirmation_available, confirmation_required_per_request: true,
    unavailable_code: profile.unavailable_code as NativeConfirmationUnavailableCode | null } }
}
export const nativeConfirmationReady = (value: ProjectScopeOwnerAvailability | null) => value?.transport_ready === true && value.authority_profile?.confirmation_available === true
export function isNativeScopeCancellation(value: unknown): value is NativeScopeCancellation {
  const body = record(value)
  return !!body && Object.keys(body).length === 4 && body.kind === "cancelled" && body.status_code === 409
    && body.not_submitted === true && nativeCancellationCodes.includes(body.code as NativeCancellationCode)
}

export interface ProjectScopeOwnerBridge {
  /** Native binds the owned child/generation; HTTP owner.available does not gate this profile. */
  inspectAvailability(observation: ProjectScopeResponse): Promise<ProjectScopeOwnerAvailability>
  /** Requests Bamboo's own per-intent confirmation and one CAS. No proof enters JS. */
  confirmAndApply(intent: ProjectScopeIntent): Promise<ProjectScopeOwnerOutcome>
}

// No Tauri command, environment flag, owner header, HTTP write or credential fallback.
export const unavailableProjectScopeOwnerBridge: ProjectScopeOwnerBridge = Object.freeze({
  inspectAvailability: async () => ({ transport_ready: false, authority_profile: null }),
  confirmAndApply: async () => ({ kind: "unavailable" as const }),
})
