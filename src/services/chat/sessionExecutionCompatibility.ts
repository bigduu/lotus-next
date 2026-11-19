import { isApiError } from "../api/errors"
import { DEFAULT_SUPERVISOR_SESSION_ID } from "@/lib/supervisor"
import { isReasoningEffort } from "@shared/utils/reasoningEffort"
import type { ReasoningEffort } from "./AgentService"

export interface SessionExecutionCompatibility {
  session_version: number | null
  current_session_version: number
  status: "compatible" | "legacy_compatible" | "conflict"
  history_readable: true
  execution_allowed: boolean
  conflicts: readonly { code: string; message: string }[]
}
export interface SessionCompatibilitySnapshot {
  report: SessionExecutionCompatibility | null
  observed: boolean
  legacy: boolean
  loading: boolean
  readError: boolean
  workReasoning?: { createdAt: string; updatedAtMs: number; requestedAtMs: number; effort: ReasoningEffort | null }
}
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
const u32 = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff

function readWorkReasoning(id: string, session: Record<string, unknown>, requestedAtMs: number): SessionCompatibilitySnapshot["workReasoning"] {
  // Bamboo gives native Work children deterministic ticket IDs. Work Roots
  // already read their saved effort through the Root mode authority.
  if (session.kind !== "child" || session.parent_session_id !== DEFAULT_SUPERVISOR_SESSION_ID
    || !/^ticket-[a-f0-9]{32}$/.test(id) || typeof session.created_at !== "string"
    || typeof session.updated_at !== "string") return undefined
  const updatedAtMs = Date.parse(session.updated_at)
  const effort = session.reasoning_effort ?? record(session.model_ref)?.reasoning_effort
  if (!Number.isFinite(updatedAtMs) || (effort != null && !isReasoningEffort(effort))) return undefined
  return { createdAt: session.created_at, updatedAtMs, requestedAtMs, effort: effort ?? null }
}

export function decodeSessionExecutionCompatibility(value: unknown): SessionExecutionCompatibility | null {
  const body = record(value)
  if (!body || body.session_version !== null && !u32(body.session_version) || !u32(body.current_session_version)
    || typeof body.status !== "string" || !["compatible", "legacy_compatible", "conflict"].includes(body.status)
    || body.history_readable !== true || typeof body.execution_allowed !== "boolean"
    || (body.status === "conflict") === body.execution_allowed
    || !Array.isArray(body.conflicts)) return null
  const conflicts: { code: string; message: string }[] = []
  for (const entry of body.conflicts) {
    const reason = record(entry)
    if (!reason || typeof reason.code !== "string" || !reason.code
      || typeof reason.message !== "string") return null
    conflicts.push({ code: reason.code, message: reason.message })
  }
  // Versions are displayed, never compared here to invent a support policy.
  return { session_version: body.session_version as number | null, current_session_version: body.current_session_version,
    status: body.status as SessionExecutionCompatibility["status"], history_readable: true,
    execution_allowed: body.execution_allowed, conflicts }
}

const empty: SessionCompatibilitySnapshot = { report: null, observed: false, legacy: false, loading: false, readError: false }
const snapshots = new Map<string, SessionCompatibilitySnapshot>()
const generations = new Map<string, { generation: number; requestedAtMs: number }>()
const listeners = new Set<() => void>()
let sequence = 0
export const getSessionCompatibilitySnapshot = (id: string | null): SessionCompatibilitySnapshot => id ? snapshots.get(id) ?? empty : empty
export const isSessionExecutionBlocked = (id: string | null | undefined): boolean => !!id && snapshots.get(id)?.report?.status === "conflict"
export function subscribeSessionCompatibility(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
function publish(id: string, value: SessionCompatibilitySnapshot) {
  snapshots.set(id, value)
  for (const listener of listeners) listener()
}
export function beginSessionCompatibilityRead(id: string): number {
  const generation = ++sequence
  generations.set(id, { generation, requestedAtMs: Date.now() })
  publish(id, { ...getSessionCompatibilitySnapshot(id), loading: true, readError: false })
  return generation
}
export function completeSessionCompatibilityRead(id: string, generation: number, value: unknown): boolean {
  const read = generations.get(id)
  if (read?.generation !== generation) return false
  const session = record(record(value)?.session)
  if (session?.id !== id) { failSessionCompatibilityRead(id, generation); return false }
  const previous = getSessionCompatibilitySnapshot(id)
  const report = decodeSessionExecutionCompatibility(session.execution_compatibility)
  const invalid = session.execution_compatibility != null && !report
  const workReasoning = readWorkReasoning(id, session, read.requestedAtMs)
  publish(id, { report: report ?? (previous.report?.status === "conflict" ? previous.report : null), observed: true,
    legacy: !report && session.session_version == null, loading: false, readError: invalid,
    ...(workReasoning ? { workReasoning } : {}) })
  return !invalid
}
export function failSessionCompatibilityRead(id: string, generation: number) {
  if (generations.get(id)?.generation === generation) publish(id, { ...getSessionCompatibilitySnapshot(id), loading: false, readError: true })
}
/** A typed refusal invalidates older in-flight reads; a later canonical read may recover it. */
export function observeSessionExecutionConflict(id: string | null | undefined, error: unknown): boolean {
  if (!id || !isApiError(error) || error.status !== 409) return false
  try {
    const body = record(JSON.parse(error.body ?? "null")), detail = record(body?.error)
    if (body?.session_id !== id || detail?.code !== "session_execution_incompatible") return false
    const report = decodeSessionExecutionCompatibility(body.compatibility)
    if (report?.status !== "conflict") return false
    generations.set(id, { generation: ++sequence, requestedAtMs: Date.now() })
    publish(id, { ...getSessionCompatibilitySnapshot(id), report, observed: true, legacy: false, loading: false, readError: false })
    return true
  } catch { return false }
}
/** Memory-only observations, not a persistent version, permission, or migration store. */
export function clearSessionCompatibilityObservations() { snapshots.clear(); generations.clear(); for (const listener of listeners) listener() }
