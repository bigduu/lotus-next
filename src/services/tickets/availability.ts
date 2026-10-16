import type { TicketInitialization, TicketScope, TicketScopeReasonCode } from "./types"
import { getErrorMessage, isApiError } from "@services/api"

export type TicketAvailabilityKind = "loading" | "ready" | "disabled" | "uninitialized" | "unbound" | "unsupported" | "forbidden" | "error"
export interface TicketAvailability { kind: TicketAvailabilityKind; detail?: string; reasonCode?: TicketScopeReasonCode; initialization?: TicketInitialization }

// Keep legacy exact reasons separate from the frozen #1971 v1 reason codes.
export class TicketScopeUnavailableError extends Error {
  constructor(public readonly kind: Exclude<TicketAvailabilityKind, "loading" | "ready">, detail?: string, public readonly presentation?: TicketAvailability) {
    super(detail)
    this.name = "TicketScopeUnavailableError"
  }
}

export function unavailableScope(reason: unknown): TicketScopeUnavailableError {
  const detail = typeof reason === "string" ? reason.trim() : undefined
  if (detail === "authority_unavailable: Ticket mutation feature is disabled") {
    return new TicketScopeUnavailableError("disabled", detail)
  }
  if (detail === "authority_unavailable: existing Supervisor needs explicit attach/import; no automatic takeover") {
    return new TicketScopeUnavailableError("uninitialized", detail)
  }
  return new TicketScopeUnavailableError("error", detail)
}

export function ticketAvailabilityFailure(failure: unknown): TicketAvailability {
  if (failure instanceof TicketScopeUnavailableError) return failure.presentation ?? { kind: failure.kind, detail: failure.message || undefined }
  return { kind: isApiError(failure) && [401, 403].includes(failure.status) ? "forbidden" : "error", detail: getErrorMessage(failure) }
}

export function isTicketInitialization(value: unknown, sessionId: string): value is TicketInitialization {
  if (!value || typeof value !== "object") return false
  const payload = value as Partial<TicketInitialization>
  return typeof sessionId === "string" && sessionId.length > 0 && payload.supervisor_session_id === sessionId
    && typeof payload.incarnation_id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.incarnation_id)
    && typeof payload.binding_revision === "number" && Number.isSafeInteger(payload.binding_revision) && payload.binding_revision > 0
}

const scopeKinds = new Set(["ready", "uninitialized", "disabled", "forbidden", "error"])
const reasonCodes = new Set<TicketScopeReasonCode>(["scope_ready", "scope_uninitialized", "ticket_mutation_disabled", "supervisor_mode_required", "supervisor_identity_mismatch", "scope_binding_mismatch", "scope_requires_recovery", "scope_io_error"])

/** Undefined means the old service contract; malformed v1 never falls back. */
export function scopeAvailability(scope: TicketScope, sessionId: string): TicketAvailability | undefined {
  if (scope.availability === undefined && scope.readable === undefined && scope.can_initialize === undefined
    && scope.initialization === undefined && scope.capabilities?.scope_initialize_v1 !== true) return undefined
  const remote = scope.availability
  if (!remote || !scopeKinds.has(remote.kind) || !reasonCodes.has(remote.reason_code)
    || scope.reason !== undefined && typeof scope.reason !== "string"
    || typeof scope.mutation_enabled !== "boolean" || typeof scope.dispatch_enabled !== "boolean"
    || typeof scope.available !== "boolean" || scope.readable !== scope.available || typeof scope.can_initialize !== "boolean"
    || (remote.kind === "ready") !== scope.readable || (remote.reason_code === "scope_ready") !== scope.readable
    || scope.initialization !== null && !isTicketInitialization(scope.initialization, sessionId)
    || !scope.can_initialize && scope.initialization !== null) throw new Error("invalid_scope_availability")
  const result: TicketAvailability = { kind: remote.kind, reasonCode: remote.reason_code }
  if (scope.reason) result.detail = scope.reason
  if (scope.can_initialize) {
    if (remote.kind !== "uninitialized" || remote.reason_code !== "scope_uninitialized"
      || scope.capabilities?.scope_initialize_v1 !== true || scope.mutation_enabled !== true
      || !isTicketInitialization(scope.initialization, sessionId)) throw new Error("invalid_scope_availability")
    // This is service-confirmed eligibility, never derived from Ultra or title.
    result.initialization = { supervisor_session_id: scope.initialization.supervisor_session_id,
      incarnation_id: scope.initialization.incarnation_id, binding_revision: scope.initialization.binding_revision }
  }
  return result
}

/** Only documented status/code pairs describe a known initialization refusal. */
export function initializationRefusal(failure: unknown): "initialization_conflict" | TicketScopeReasonCode | undefined {
  if (!isApiError(failure) || !failure.body || ![409, 503].includes(failure.status)) return undefined
  try {
    const body = JSON.parse(failure.body) as { code?: unknown }
    if (failure.status === 409 && ["initialization_conflict", "scope_requires_recovery", "scope_binding_mismatch"].includes(String(body.code))) {
      return body.code as "initialization_conflict" | TicketScopeReasonCode
    }
    if (failure.status === 503 && reasonCodes.has(body.code as TicketScopeReasonCode)) return body.code as TicketScopeReasonCode
  } catch { /* Unknown write outcomes remain unconfirmed and are never replayed. */ }
  return undefined
}


/** A post-authentication scope refusal can explain 403 without granting reads. */
export function initializationDenial(failure: unknown, sessionId: string): TicketAvailability | undefined {
  if (!isApiError(failure) || failure.status !== 403 || !failure.body) return undefined
  try {
    const body = JSON.parse(failure.body) as { code?: unknown; scope?: TicketScope }
    if (!["supervisor_mode_required", "supervisor_identity_mismatch"].includes(String(body.code)) || !body.scope) return undefined
    const presentation = scopeAvailability(body.scope, sessionId)
    if (presentation?.kind === "forbidden" && presentation.reasonCode === body.code && !presentation.initialization) return presentation
  } catch { /* Malformed or contradictory denials never confer access. */ }
  return undefined
}
