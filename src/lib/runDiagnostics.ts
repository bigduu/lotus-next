import { decodeRunDiagnostic, type PublicRunDiagnostic } from "@services/chat/runDiagnostic"
import { isDiagnosticId, type RunDiagnosticsSubject } from "./runDiagnosticId"

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const version = /^(?:0|[1-9][0-9]{0,3})\.[0-9]{1,2}\.[0-9]{1,3}(?:-[A-Za-z0-9][A-Za-z0-9.-]{0,63})?$/
const revision = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const checked = (value: unknown, pattern: RegExp): string | null =>
  typeof value === "string" && pattern.test(value) ? value : null

export type DiagnosticEvidence = Readonly<{
  diagnostic: Readonly<PublicRunDiagnostic> | null
  source: "live_event" | "canonical_read"
  canonicalStatus: "not_checked" | "loading" | "confirmed" | "not_provided" | "unavailable" | "changed"
}>

/** Build from explicit safe primitives. Never spread a runtime/error/config object. */
export function createRunDiagnostics(
  subject: RunDiagnosticsSubject,
  expectedSessionId: string | null,
  runtime: unknown,
  collectedAt = new Date().toISOString(),
  evidence?: DiagnosticEvidence,
) {
  if (subject.sessionId !== expectedSessionId) return null
  if (subject.failureKind !== "generation-failed" && subject.failureKind !== "submission-unconfirmed") return null
  const artifact = record(record(runtime).artifact)
  const hostKind = record(record(runtime).host).kind
  if (evidence?.canonicalStatus === "changed") return null
  const value = evidence === undefined ? subject.liveDiagnostic : evidence.diagnostic
  const detail = subject.sessionId !== null && typeof subject.errorBinding === "string"
    ? decodeRunDiagnostic(value, subject.sessionId, subject.errorBinding) : null
  const diagnosticId = detail?.diagnostic_id ?? (isDiagnosticId(subject.diagnosticId) ? subject.diagnosticId : null)
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(collectedAt)
    && Number.isFinite(Date.parse(collectedAt)) ? collectedAt : null
  return Object.freeze({
    schema_version: 1 as const,
    collected_at: timestamp,
    frontend: Object.freeze({
      package_name: "@bigduu/lotus-next" as const,
      version: checked(artifact.version, version),
      source_revision: checked(artifact.revision, revision),
      host_kind: hostKind === "browser" || hostKind === "bamboo-embedded" || hostKind === "bodhi-desktop" ? hostKind : null,
    }),
    context: Object.freeze({
      session_id: subject.sessionId === "bamboo-default-supervisor" ? subject.sessionId : checked(subject.sessionId, uuid),
      client_operation_id: Number.isSafeInteger(subject.localOperationId) && subject.localOperationId !== null && subject.localOperationId >= 0
        ? subject.localOperationId : null,
      failure_kind: subject.failureKind,
    }),
    diagnostic: Object.freeze({
      diagnostic_id: diagnosticId,
      source: detail ? evidence?.source ?? "live_event" : diagnosticId ? "legacy_terminal_error_marker" : "not_provided",
      structured_details: detail ? "provided" : "not_provided",
      canonical_status: evidence?.canonicalStatus ?? "not_checked",
      request_id: detail?.request_id ?? null,
      error_id: detail?.error_id ?? null,
      observed_at: detail?.observed_at ?? null,
      provider: detail?.provider ?? null,
      session_hash: detail?.session_hash ?? null,
      // Runtime correlation is distinct from the Host activation/backendRunId.
      runtime_run_id: detail?.run_id ?? null,
      backend_run_id: null,
      failure_stage: detail?.phase ?? null,
      attempt: detail?.attempt ?? null,
      attempt_limit: detail?.attempt_limit ?? null,
      status: detail?.status ?? null,
      attempt_timeout_ms: detail?.attempt_timeout_ms ?? null,
      total_budget_ms: detail?.total_budget_ms ?? null,
      attempt_elapsed_ms: detail?.attempt_elapsed_ms ?? null,
      total_elapsed_ms: detail?.total_elapsed_ms ?? null,
      remaining_budget_ms: detail?.remaining_budget_ms ?? null,
      retry_delay_ms: detail?.retry_delay_ms ?? null,
      retry_stop_reason: detail?.stop_reason ?? null,
      upstream_outcome: detail?.upstream_outcome ?? null,
    }),
  })
}

export type RunDiagnosticsReport = NonNullable<ReturnType<typeof createRunDiagnostics>>

/** Called only after the user reviewed this newly constructed allowlist report. */
export function downloadRunDiagnostics(report: RunDiagnosticsReport): void {
  const blob = new Blob([JSON.stringify(report, null, 2) + "\n"], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  try {
    link.href = url
    link.download = "bamboo-run-diagnostics.json"
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
