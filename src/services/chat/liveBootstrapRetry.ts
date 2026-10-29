import { apiClient, getBackendStorageScope } from "@services/api"
import { isApiError } from "@services/api/errors"
import { isRetryRunId } from "./upstreamRetry"

export type LiveBootstrapCapability = { offerTimeoutMs: number }
export type LiveBootstrapOffer = { kind: "unavailable" } | {
  kind: "waiting"; runId: string; expiresInMs: number; confirming: boolean
}

/** Negotiate the concrete protocol; an old, malformed or unreachable service is unsupported. */
export async function readLiveBootstrapCapability(): Promise<LiveBootstrapCapability | null> {
  let result: unknown
  try { result = await apiClient.get<unknown>("execute/defaults", { cache: "no-store" }) }
  catch { return null }
  if (!result || typeof result !== "object" || Array.isArray(result)) return null
  const value = result as { upstream_retry?: unknown; live_bootstrap_resume?: unknown }
  if (!value.upstream_retry || typeof value.upstream_retry !== "object" || Array.isArray(value.upstream_retry)
      || !value.live_bootstrap_resume || typeof value.live_bootstrap_resume !== "object" || Array.isArray(value.live_bootstrap_resume)) return null
  const policy = value.upstream_retry as { supported_modes?: unknown }
  const live = value.live_bootstrap_resume as Record<string, unknown>
  if (!Array.isArray(policy.supported_modes) || !policy.supported_modes.every((mode: unknown) => typeof mode === "string")
      || !policy.supported_modes.includes("until_cancelled") || live.protocol_version !== 1
      || live.waiting_endpoint !== "execute/{session_id}/retry" || live.continue_run_header !== "Bamboo-Run-Id"
      || live.initial_opt_in_field !== "live_bootstrap_resume" || !Number.isSafeInteger(live.offer_timeout_ms)
      || (live.offer_timeout_ms as number) <= 0) return null
  return { offerTimeoutMs: live.offer_timeout_ms as number }
}

/** A waiting offer is an observation, not permission to create a new run. */
export async function readLiveBootstrapOffer(sessionId: string, offerTimeoutMs: number): Promise<LiveBootstrapOffer> {
  const result = await apiClient.get<unknown>(`execute/${encodeURIComponent(sessionId)}/retry`, { cache: "no-store" })
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid retry offer")
  const value = result as Record<string, unknown>
  if (value.session_id !== sessionId) throw new Error("Retry offer belongs to another session")
  if (value.status === "unavailable" && value.run_id === undefined) return { kind: "unavailable" }
  if (value.status !== "retry_waiting" || !isRetryRunId(value.run_id)
      || !Number.isSafeInteger(value.expires_in_ms) || (value.expires_in_ms as number) < 0
      || (value.expires_in_ms as number) > offerTimeoutMs || typeof value.confirming !== "boolean")
    throw new Error("Invalid retry offer")
  return { kind: "waiting", runId: value.run_id, expiresInMs: value.expires_in_ms as number, confirming: value.confirming }
}

/** Confirmation selects the original run and cannot change model or input. */
export async function confirmLiveBootstrapOffer(sessionId: string, runId: string): Promise<void> {
  if (!isRetryRunId(runId)) throw new Error("Invalid retry run identity")
  const result = await apiClient.postOnce<unknown>(`execute/${encodeURIComponent(sessionId)}`,
    { upstream_retry: { mode: "until_cancelled" } }, { headers: { "Bamboo-Run-Id": runId } })
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid retry confirmation")
  const value = result as Record<string, unknown>
  if (value.session_id !== sessionId || value.run_id !== runId || value.status !== "retry_continuing")
    throw new Error("Retry confirmation did not match the selected run")
}

/** Only this session's explicit refusal proves the continuation did not start. */
export function isLiveBootstrapNotPrepared(error: unknown, sessionId: string): boolean {
  if (!isApiError(error) || error.status !== 409 || !error.body) return false
  try {
    const body: unknown = JSON.parse(error.body)
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "run_id")) return false
    const value = body as { session_id?: unknown; error?: unknown }
    return value.session_id === sessionId && !!value.error && typeof value.error === "object"
      && !Array.isArray(value.error) && (value.error as { code?: unknown }).code === "retry_resume_not_prepared"
  } catch { return false }
}

type ConfirmationRecord = { version: 1; runId: string; operationId: string; state: "pending" | "accepted" }
export type LiveBootstrapConfirmation = { key: string; pending: string }
export type LiveBootstrapConfirmationState = "clear" | "pending" | "accepted" | "unavailable"
const operationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const confirmationKey = (sessionId: string) => `lotus-next.live-bootstrap-confirm.v1.${encodeURIComponent(JSON.stringify([getBackendStorageScope(), sessionId]))}`
function parseConfirmation(raw: string): ConfirmationRecord | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const record = value as Partial<ConfirmationRecord>
    return record.version === 1 && isRetryRunId(record.runId) && typeof record.operationId === "string"
      && operationPattern.test(record.operationId) && (record.state === "pending" || record.state === "accepted")
      ? record as ConfirmationRecord : null
  } catch { return null }
}

/** Uncertain confirmations survive reload; an unrelated newer run remains separate. */
export function readLiveBootstrapConfirmation(sessionId: string, runId: string): LiveBootstrapConfirmationState {
  try {
    const raw = sessionStorage.getItem(confirmationKey(sessionId))
    if (raw === null) return "clear"
    const record = parseConfirmation(raw)
    if (!record) return "unavailable"
    return record.runId === runId ? record.state : "clear"
  } catch { return "unavailable" }
}

export function beginLiveBootstrapConfirmation(sessionId: string, runId: string): LiveBootstrapConfirmation | null {
  if (!isRetryRunId(runId)) return null
  try {
    const key = confirmationKey(sessionId), previous = sessionStorage.getItem(key)
    const record = previous === null ? null : parseConfirmation(previous)
    if (previous !== null && (!record || record.runId === runId)) return null
    const operationId = crypto.randomUUID()
    if (!operationPattern.test(operationId)) return null
    const pending = JSON.stringify({ version: 1, runId, operationId, state: "pending" } satisfies ConfirmationRecord)
    if (sessionStorage.getItem(key) !== previous) return null
    sessionStorage.setItem(key, pending)
    return sessionStorage.getItem(key) === pending ? { key, pending } : null
  } catch { return null }
}

/** Compare before changing this tab's record; late responses cannot settle a successor. */
export function finishLiveBootstrapConfirmation(reservation: LiveBootstrapConfirmation, result: "accepted" | "refused" | "unknown"): boolean {
  try {
    if (sessionStorage.getItem(reservation.key) !== reservation.pending) return false
    if (result === "unknown") return true
    if (result === "refused") sessionStorage.removeItem(reservation.key)
    else {
      const record = parseConfirmation(reservation.pending)
      if (!record) return false
      sessionStorage.setItem(reservation.key, JSON.stringify({ ...record, state: "accepted" } satisfies ConfirmationRecord))
    }
    return true
  } catch { return false }
}
