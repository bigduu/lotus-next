import { isTauriEnvironment } from "@/utils/environment"
import { decodeProjectScopeReceipt } from "./client"
import { decodeProjectScopeOwnerAvailability, isNativeConfirmationUnavailableCode, isNativeScopeCancellation, unavailableProjectScopeOwnerBridge,
  type ProjectScopeOwnerAvailability, type ProjectScopeOwnerBridge, type ProjectScopeOwnerErrorCode, type ProjectScopeOwnerOutcome } from "./ownerBridge"
import { scopeErrorCodes, type ProjectScopeIntent, type ProjectScopeResponse } from "./types"

type NativeInvoke = typeof import("@tauri-apps/api/core").invoke
async function loadNativeInvoke(): Promise<NativeInvoke | null> {
  if (!isTauriEnvironment()) return null
  try {
    const core = await import("@tauri-apps/api/core")
    return core.isTauri() && typeof core.invoke === "function" ? core.invoke : null
  } catch { return null }
}
function decodeOutcome(value: unknown, intent: ProjectScopeIntent): ProjectScopeOwnerOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "unknown" }
  const body = value as Record<string, unknown>, fields = Object.keys(body).length
  if (isNativeScopeCancellation(value)) return { kind: "cancelled", code: value.code, status_code: 409, not_submitted: true }
  if (body.kind === "unavailable" && fields === 1) return { kind: "unavailable" }
  if (body.kind === "applied" && fields === 2 && "receipt" in body) {
    try { return { kind: "applied", receipt: decodeProjectScopeReceipt(body.receipt, intent) } } catch { return { kind: "unknown" } }
  }
  if (body.kind === "rejected" && fields === 3 && Number.isInteger(body.status) && (body.status as number) >= 400 && (body.status as number) <= 599
    && (scopeErrorCodes.includes(body.code as typeof scopeErrorCodes[number]) || isNativeConfirmationUnavailableCode(body.code))) {
    return { kind: "rejected", status: body.status as number, code: body.code as ProjectScopeOwnerErrorCode }
  }
  return { kind: "unknown" }
}

/** Fixed native commands only. Window/origin/owned-child authority is checked by Bodhi. */
export const nativeProjectScopeOwnerBridge: ProjectScopeOwnerBridge = Object.freeze({
  async inspectAvailability(observation: ProjectScopeResponse): Promise<ProjectScopeOwnerAvailability> {
    try {
      const captured = structuredClone(observation), invoke = await loadNativeInvoke()
      if (invoke) {
        const value = await invoke<unknown>("supervisor_scope_inspect_availability", { observation: captured })
        const availability = decodeProjectScopeOwnerAvailability(value)
        if (availability) return availability
      }
    } catch { /* Inspection confers no consent. Remain unavailable. */ }
    return unavailableProjectScopeOwnerBridge.inspectAvailability(observation)
  },
  async confirmAndApply(intent: ProjectScopeIntent): Promise<ProjectScopeOwnerOutcome> {
    let captured: ProjectScopeIntent, invoke: NativeInvoke | null
    try { captured = structuredClone(intent); invoke = await loadNativeInvoke() } catch { return { kind: "unavailable" } }
    if (!invoke) return { kind: "unavailable" }
    // Once invoke starts, a rejection may follow submission. Never retry or claim cancellation.
    try { return decodeOutcome(await invoke<unknown>("supervisor_scope_confirm_and_apply", { intent: captured }), captured) }
    catch { return { kind: "unknown" } }
  },
})
