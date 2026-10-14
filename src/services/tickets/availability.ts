import type { TicketInitialization } from "./types"
import { getErrorMessage, isApiError } from "@services/api"

export type TicketAvailabilityKind = "loading" | "ready" | "disabled" | "uninitialized" | "unbound" | "unsupported" | "forbidden" | "error"
export interface TicketAvailability { kind: TicketAvailabilityKind; detail?: string }

// These are local presentation states, not invented server response fields.
// Older Bamboo exposes only available/reason; match only verified exact reasons.
export class TicketScopeUnavailableError extends Error {
  constructor(public readonly kind: Exclude<TicketAvailabilityKind, "loading" | "ready">, detail?: string) {
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
  if (failure instanceof TicketScopeUnavailableError) return { kind: failure.kind, detail: failure.message || undefined }
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
