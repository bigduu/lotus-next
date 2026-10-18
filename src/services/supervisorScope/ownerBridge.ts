import type { ProjectScopeIntent, ProjectScopeResponse, ScopeErrorCode } from "./types"

export type ProjectScopeOwnerOutcome =
  | { readonly kind: "cancelled" } // Native guarantees cancellation happened before submission.
  | { readonly kind: "unavailable" }
  | { readonly kind: "applied"; readonly receipt: unknown }
  | { readonly kind: "rejected"; readonly status: number; readonly code?: ScopeErrorCode }
  | { readonly kind: "unknown" }

export interface ProjectScopeOwnerBridge {
  /** Future native adapter must also bind the trusted sidecar target/generation. */
  inspectAvailability(observation: ProjectScopeResponse): Promise<boolean>
  /** Native owns consent, verification and one submission. No proof enters JS. */
  confirmAndApply(intent: ProjectScopeIntent): Promise<ProjectScopeOwnerOutcome>
}

// No Tauri command, environment flag, owner header, HTTP write or credential fallback.
export const unavailableProjectScopeOwnerBridge: ProjectScopeOwnerBridge = Object.freeze({
  inspectAvailability: async () => false,
  confirmAndApply: async () => ({ kind: "unavailable" as const }),
})
