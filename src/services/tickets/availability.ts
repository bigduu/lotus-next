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
