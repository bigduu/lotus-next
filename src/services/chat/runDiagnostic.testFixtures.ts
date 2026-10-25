import { diagnosticSessionHash } from "./diagnosticSessionHash"
import type { PublicRequestDiagnostic, PublicStreamTimeoutDiagnostic } from "./runDiagnostic"

export const diagnosticFixtureId = "9ab6cd70-bc43-4fed-9f10-50c2873fa287"
export function diagnosticFixture(sessionId: string): PublicRequestDiagnostic {
  return { schema_version:1, diagnostic_id:diagnosticFixtureId, request_id:diagnosticFixtureId, error_id:diagnosticFixtureId,
    observed_at:"2026-10-22T16:00:00.000Z", provider:"anthropic", session_hash:diagnosticSessionHash(sessionId)!, run_id:null,
    attempt:1, attempt_limit:4, event:"stop", phase:"send_headers", failure:"initial response headers timed out", status:null,
    attempt_timeout_ms:20000, total_budget_ms:60000, attempt_elapsed_ms:20000, total_elapsed_ms:60000,
    remaining_budget_ms:0, retry_delay_ms:null, stop_reason:"time_budget_exhausted", upstream_outcome:"unknown" }
}
// Independent literal from the frozen Rust formatter, not built by the decoder.
export const diagnosticFixtureError = "LLM error: Anthropic upstream request failed (no HTTP response): initial response headers timed out. Automatic retry time budget exhausted after 1 request(s) (limit 4). Diagnostic ID: "
  + diagnosticFixtureId + ". Try again later or contact the upstream gateway administrator."

export function timeoutDiagnosticFixture(sessionId: string): PublicStreamTimeoutDiagnostic {
  return { schema_version:1, kind:"stream_timeout", diagnostic_id:diagnosticFixtureId, error_id:diagnosticFixtureId,
    observed_at:"2026-10-25T04:51:29.725Z", provider:"a2a3cebf-8abc-45cb-8407-66c90fd9a978", model:"gpt-6-astra",
    session_hash:diagnosticSessionHash(sessionId)!, run_id:"b65d9caa-1250-4a89-8d77-2c77b06c634b", phase:"transport_idle",
    deadline_ms:120000, last_transport_ms_ago:120002, last_semantic_ms_ago:120002,
    semantic_output_started:true, retry_safe:false, last_http_status:null, retry_delay_ms:null }
}
// Independent literal from the Rust timeout formatter, including its unique error association.
export const timeoutDiagnosticFixtureError = "Stream timed out: phase=transport_idle, deadline_ms=120000, provider=a2a3cebf-8abc-45cb-8407-66c90fd9a978, model=gpt-6-astra, last_transport_ms_ago=120002, last_semantic_ms_ago=120002ms, semantic_output_started=true, retry_safe=false. Diagnostic ID: 9ab6cd70-bc43-4fed-9f10-50c2873fa287."
