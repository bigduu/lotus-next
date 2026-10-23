import { diagnosticSessionHash } from "./diagnosticSessionHash"

export const diagnosticStopGuidance = {
  attempts_exhausted: "Automatic retry attempt limit reached",
  time_budget_exhausted: "Automatic retry time budget exhausted",
  retry_delay_exceeds_budget: "Required retry delay exceeds the remaining time budget",
  non_retryable_transport: "Transport failure is not automatically retryable",
  unclassified_error_body: "Upstream error response could not be safely classified",
  cancelled_or_dropped: "Request cancelled or its caller stopped waiting",
} as const
export type DiagnosticStopReason = keyof typeof diagnosticStopGuidance
export type DiagnosticPhase = "send_headers" | "error_body" | "response_status" | "backoff"
export interface PublicRunDiagnostic {
  schema_version: 1; diagnostic_id: string; request_id: string; error_id: string
  observed_at: string; provider: "anthropic"; session_hash: string; run_id: string | null
  attempt: number; attempt_limit: number; event: "stop"; phase: DiagnosticPhase
  failure: string; status: number | null; attempt_timeout_ms: number; total_budget_ms: number
  attempt_elapsed_ms: number; total_elapsed_ms: number; remaining_budget_ms: number
  retry_delay_ms: number | null; stop_reason: DiagnosticStopReason
  upstream_outcome: "unknown" | "response_received"
}
const fields = [
  "schema_version","diagnostic_id","request_id","error_id","observed_at","provider","session_hash","run_id",
  "attempt","attempt_limit","event","phase","failure","status","attempt_timeout_ms","total_budget_ms",
  "attempt_elapsed_ms","total_elapsed_ms","remaining_budget_ms","retry_delay_ms","stop_reason","upstream_outcome",
]
const failures = new Set([
  "none","request deadline exceeded","request attempt limit reached","initial response headers timed out",
  "timeout","connect","request","body","decode","status","transport","upstream error body deadline exceeded",
  "upstream error body read failed","connector database is temporarily recovering","temporary upstream failure",
])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const budgetUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const nat = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
export const diagnosticErrorText = (v: string) => v.startsWith("LLM error: ") ? v.slice(11) : v

/** Mirrors the frozen generated error solely for exact association, never prose classification. */
export function generatedDiagnosticError(d: PublicRunDiagnostic): string {
  return "Anthropic upstream request failed (" + (d.status === null ? "no HTTP response" : "HTTP " + d.status)
    + "): " + d.failure + ". " + diagnosticStopGuidance[d.stop_reason] + " after " + d.attempt
    + " request(s) (limit " + d.attempt_limit + "). Diagnostic ID: " + d.diagnostic_id
    + ". Try again later or contact the upstream gateway administrator."
}

/** Public stop-only schema1; reject unknown/free-text/foreign data before state or export. */
export function decodeRunDiagnostic(value: unknown, sessionId: string, error: string): Readonly<PublicRunDiagnostic> | null {
  try {
    const v = record(value), keys = Object.keys(v)
    if (keys.length !== fields.length || keys.some((k) => !fields.includes(k))) return null
    if (v.schema_version !== 1 || v.provider !== "anthropic" || v.event !== "stop") return null
    if (typeof v.diagnostic_id !== "string" || !budgetUuid.test(v.diagnostic_id)
      || v.request_id !== v.diagnostic_id || v.error_id !== v.diagnostic_id) return null
    const expectedHash = diagnosticSessionHash(sessionId)
    if (!expectedHash || v.session_hash !== expectedHash) return null
    if (v.run_id !== null && (typeof v.run_id !== "string" || !uuid.test(v.run_id))) return null
    if (typeof v.observed_at !== "string" || v.observed_at.length > 40
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(v.observed_at)
      || !Number.isFinite(Date.parse(v.observed_at))) return null
    if (!nat(v.attempt_limit) || v.attempt_limit < 1 || v.attempt_limit > 4 || !nat(v.attempt) || v.attempt > v.attempt_limit) return null
    if (v.status !== null && (!nat(v.status) || v.status < 100 || v.status > 599)) return null
    if (!["send_headers","error_body","response_status","backoff"].includes(v.phase as string)
      || !["unknown","response_received"].includes(v.upstream_outcome as string)
      || typeof v.failure !== "string" || !failures.has(v.failure)
      || typeof v.stop_reason !== "string" || !Object.hasOwn(diagnosticStopGuidance, v.stop_reason)) return null
    for (const k of ["attempt_timeout_ms","total_budget_ms","attempt_elapsed_ms","total_elapsed_ms","remaining_budget_ms"]) if (!nat(v[k])) return null
    if ((v.attempt_timeout_ms as number) > 60_000 || (v.total_budget_ms as number) > 60_000
      || (v.remaining_budget_ms as number) > (v.total_budget_ms as number)) return null
    if (v.retry_delay_ms !== null && !nat(v.retry_delay_ms)) return null
    if (new TextEncoder().encode(JSON.stringify(v)).length > 4096) return null
    const d = v as unknown as PublicRunDiagnostic
    if (diagnosticErrorText(error) !== generatedDiagnosticError(d)) return null
    return Object.freeze({
      schema_version:1, diagnostic_id:d.diagnostic_id, request_id:d.request_id, error_id:d.error_id,
      observed_at:d.observed_at, provider:d.provider, session_hash:d.session_hash, run_id:d.run_id,
      attempt:d.attempt, attempt_limit:d.attempt_limit, event:d.event, phase:d.phase, failure:d.failure, status:d.status,
      attempt_timeout_ms:d.attempt_timeout_ms, total_budget_ms:d.total_budget_ms, attempt_elapsed_ms:d.attempt_elapsed_ms,
      total_elapsed_ms:d.total_elapsed_ms, remaining_budget_ms:d.remaining_budget_ms, retry_delay_ms:d.retry_delay_ms,
      stop_reason:d.stop_reason, upstream_outcome:d.upstream_outcome,
    })
  } catch { return null }
}

export function inspectCanonicalDiagnostic(value: unknown, sessionId: string, error: string) {
  const s = record(value)
  if (s.id !== sessionId || s.is_running === true || s.last_run_status !== undefined && s.last_run_status !== "error"
    || typeof s.last_run_error === "string" && diagnosticErrorText(s.last_run_error) !== diagnosticErrorText(error)) {
    return { status: "changed" as const, diagnostic: null }
  }
  const diagnostic = s.last_run_status === "error" && typeof s.last_run_error === "string"
    ? decodeRunDiagnostic(s.last_run_diagnostic, sessionId, s.last_run_error) : null
  return { status: diagnostic ? "confirmed" as const : "not_provided" as const, diagnostic }
}
