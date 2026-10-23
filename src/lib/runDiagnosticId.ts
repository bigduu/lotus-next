/** Observational support ID only; it never grants execution or retry authority. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MARKER = /(?:^|\s)Diagnostic ID: ([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(?: Try again later or contact the upstream gateway administrator\.)?\s*$/

export const isDiagnosticId = (value: unknown): value is string =>
  typeof value === "string" && UUID_V4.test(value)

/** Frozen legacy transport: one appended, lowercase UUID-v4 marker, no prose inference. */
export function extractDiagnosticId(message: unknown): string | null {
  if (typeof message !== "string" || message.length > 16_384) return null
  if (message.split("Diagnostic ID:").length !== 2) return null
  return MARKER.exec(message)?.[1] ?? null
}

export type RunDiagnosticsSubject = Readonly<{
  sessionId: string | null
  localOperationId: number | null
  failureKind: "generation-failed" | "submission-unconfirmed"
  diagnosticId: string | null
  /** Private equality binding only; never rendered or exported. */
  errorBinding?: string | null
  liveDiagnostic?: import("@services/chat/runDiagnostic").PublicRunDiagnostic | null
}>
