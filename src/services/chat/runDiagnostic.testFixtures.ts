import { diagnosticSessionHash } from "./diagnosticSessionHash"
import type { PublicRunDiagnostic } from "./runDiagnostic"

export const diagnosticFixtureId = "9ab6cd70-bc43-4fed-9f10-50c2873fa287"
export function diagnosticFixture(sessionId: string): PublicRunDiagnostic {
  return { schema_version:1, diagnostic_id:diagnosticFixtureId, request_id:diagnosticFixtureId, error_id:diagnosticFixtureId,
    observed_at:"2026-10-22T16:00:00.000Z", provider:"anthropic", session_hash:diagnosticSessionHash(sessionId)!, run_id:null,
    attempt:1, attempt_limit:4, event:"stop", phase:"send_headers", failure:"initial response headers timed out", status:null,
    attempt_timeout_ms:20000, total_budget_ms:60000, attempt_elapsed_ms:20000, total_elapsed_ms:60000,
    remaining_budget_ms:0, retry_delay_ms:null, stop_reason:"time_budget_exhausted", upstream_outcome:"unknown" }
}
// Independent literal from the frozen Rust formatter, not built by the decoder.
export const diagnosticFixtureError = "LLM error: Anthropic upstream request failed (no HTTP response): initial response headers timed out. Automatic retry time budget exhausted after 1 request(s) (limit 4). Diagnostic ID: "
  + diagnosticFixtureId + ". Try again later or contact the upstream gateway administrator."
