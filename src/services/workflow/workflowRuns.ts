import { apiClient, isApiError } from "../api"
import { parseWorkflowArguments, type TypedWorkflowDraft, type WorkflowCatalogEntry } from "../command/workflowCatalog"
import { uiText } from "@shared/i18n/ui"

export type WorkflowRunStatus = "queued" | "running" | "suspended" | "succeeded" | "failed" | "cancelled"
export type WorkflowStepStatus = WorkflowRunStatus | "skipped"
const runStatuses: readonly string[] = ["queued", "running", "suspended", "succeeded", "failed", "cancelled"]
const failureCodes = ["invalid_definition", "invalid_input", "invalid_output", "unknown_reference", "permission_denied",
  "untrusted_workspace", "budget_exceeded", "retry_exhausted", "execution_failed", "cancelled", "recovery_suspended",
  "suspended", "dependency_skipped", "storage"] as const
export type WorkflowFailureCode = typeof failureCodes[number]
type Failure = { code: WorkflowFailureCode; retryable: boolean }
export type WorkflowRunSnapshot = {
  run_id: string; session_id: string; workflow_id: string; workflow_revision: number
  status: WorkflowRunStatus; can_cancel: boolean; last_sequence: number
  steps: { id: string; status: WorkflowStepStatus; attempts: number; failure?: Failure }[]
  budget: { max_steps: number; max_retries: number; max_agents: number; wall_time_ms: number; max_tokens: number | null; max_cost_micros: number | null }
  usage: { steps: number; retries: number; agents: number; tokens: number; cost_micros: number | null }
  child_agent_count: number; failure?: Failure; suspension?: "tool_approval" | "tool_running" | "recovery"
  created_at: string; updated_at: string
}
export type WorkflowRunEvent = { run_id: string; sequence: number; type: string; phase?: WorkflowPhase }
const eventTypes = ["run_queued", "run_started", "phase", "step_queued", "step_started", "step_suspended", "step_completed",
  "step_failed", "step_cancelled", "step_skipped", "run_suspended", "run_succeeded", "run_failed", "run_cancelled"]
const phases = ["preflight_completed", "step_reserved", "retry_reserved", "agent_usage_recorded", "suspension_context_persisted", "workflow_progressed"] as const
type WorkflowPhase = typeof phases[number]
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
function invalid(): never { throw new Error(uiText("workflow_run_invalid_response")) }
function record(value: unknown): Record<string, unknown> { return object(value) ? value : invalid() }
function text(value: unknown): string { return typeof value === "string" && value.trim() ? value : invalid() }
function count(value: unknown): number { return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : invalid() }
function optionalLimit(value: unknown): number | null { return value === null ? null : count(value) }
function failure(value: unknown): Failure | undefined {
  if (value === undefined) return undefined
  const raw = record(value)
  if (!failureCodes.includes(raw.code as WorkflowFailureCode) || typeof raw.retryable !== "boolean") invalid()
  return { code: raw.code as WorkflowFailureCode, retryable: raw.retryable }
}

/** Project only the public metadata the panel uses; args, outputs and diagnostics never enter UI state. */
export function parseWorkflowRun(value: unknown, sessionId: string, runId?: string): WorkflowRunSnapshot {
  const raw = record(value), budget = record(raw.budget), usage = record(raw.usage)
  if (raw.session_id !== sessionId || (runId !== undefined && raw.run_id !== runId)
    || !runStatuses.includes(raw.status as string) || typeof raw.can_cancel !== "boolean") invalid()
  const steps = Object.entries(record(raw.steps)).map(([key, value]) => {
    const step = record(value)
    if (step.id !== key || ![...runStatuses, "skipped"].includes(step.status as string)) invalid()
    return { id: text(step.id), status: step.status as WorkflowStepStatus, attempts: count(step.attempts), failure: failure(step.failure) }
  })
  let suspension: WorkflowRunSnapshot["suspension"]
  if (raw.suspension !== undefined) {
    const kind = record(raw.suspension).type
    if (!["tool_approval", "tool_running", "recovery"].includes(kind as string)) invalid()
    suspension = kind as WorkflowRunSnapshot["suspension"]
  }
  const created = text(raw.created_at), updated = text(raw.updated_at)
  if (!Number.isFinite(Date.parse(created)) || !Number.isFinite(Date.parse(updated))) invalid()
  const revision = count(raw.workflow_revision)
  if (!revision) invalid()
  return { run_id: text(raw.run_id), session_id: sessionId, workflow_id: text(raw.workflow_id), workflow_revision: revision,
    status: raw.status as WorkflowRunStatus, can_cancel: raw.can_cancel, last_sequence: count(raw.last_sequence), steps,
    budget: { max_steps: count(budget.max_steps), max_retries: count(budget.max_retries), max_agents: count(budget.max_agents),
      wall_time_ms: count(budget.wall_time_ms), max_tokens: optionalLimit(budget.max_tokens ?? null), max_cost_micros: optionalLimit(budget.max_cost_micros ?? null) },
    usage: { steps: count(usage.steps), retries: count(usage.retries), agents: count(usage.agents), tokens: count(usage.tokens), cost_micros: optionalLimit(usage.cost_micros) },
    child_agent_count: count(raw.child_agent_count), failure: failure(raw.failure), suspension, created_at: created, updated_at: updated }
}

export function workflowRunUnavailableReason(entry: WorkflowCatalogEntry): string | null {
  if (entry.kind !== "orchestration") return uiText("workflow_run_instruction_only")
  if (entry.status !== "valid") return uiText("invalid_definition_d28c9eaf")
  if (!entry.winner) return uiText("not_the_active_source_ed72c73c")
  if (!Number.isSafeInteger(entry.revision) || entry.revision <= 0) return uiText("no_sendable_revision_119eaea0")
  if (entry.invocation_policy.explicit !== true) return uiText("explicit_selection_is_not_allowed_ac1f6f64")
  return null
}
export function prepareWorkflowRun(draft: TypedWorkflowDraft) {
  const reason = workflowRunUnavailableReason(draft.entry)
  if (reason) throw new Error(reason)
  return { workflow_id: draft.entry.id, revision: draft.entry.revision, args: parseWorkflowArguments(draft.entry, draft.argsText) }
}
function route(sessionId: string, runId?: string) {
  if (!sessionId.trim() || (runId !== undefined && !runId.trim())) invalid()
  return `sessions/${encodeURIComponent(sessionId)}/workflow-runs${runId === undefined ? "" : `/${encodeURIComponent(runId)}`}`
}
export const workflowRuns = {
  async list(sessionId: string, signal?: AbortSignal) {
    const raw = await apiClient.get<unknown>(route(sessionId), { signal })
    if (!Array.isArray(raw)) invalid()
    const runs = raw.map((value) => parseWorkflowRun(value, sessionId))
    if (new Set(runs.map((run) => run.run_id)).size !== runs.length) invalid()
    return runs
  },
  async detail(sessionId: string, runId: string, signal?: AbortSignal) {
    return parseWorkflowRun(await apiClient.get<unknown>(route(sessionId, runId), { signal }), sessionId, runId)
  },
  async events(sessionId: string, runId: string, since: number, signal?: AbortSignal): Promise<WorkflowRunEvent[]> {
    const raw = await apiClient.get<unknown>(`${route(sessionId, runId)}/events?since=${count(since)}`, { signal })
    if (!Array.isArray(raw)) invalid()
    let cursor = since
    return raw.map((value) => {
      const event = record(value), sequence = count(event.sequence)
      if (event.run_id !== runId || sequence <= cursor || !eventTypes.includes(event.type as string)) invalid()
      cursor = sequence
      return { run_id: runId, sequence, type: event.type as string,
        ...(event.type === "phase" ? { phase: phases.includes(event.name as WorkflowPhase) ? event.name as WorkflowPhase : "workflow_progressed" as const } : {}) }
    })
  },
  async start(sessionId: string, draft: TypedWorkflowDraft) {
    const request = prepareWorkflowRun(draft)
    const run = parseWorkflowRun(await apiClient.postOnce<unknown>(route(sessionId), request), sessionId)
    if (run.workflow_id !== request.workflow_id || run.workflow_revision !== request.revision) invalid()
    return run
  },
  async cancel(sessionId: string, runId: string) {
    return parseWorkflowRun(await apiClient.postOnce<unknown>(`${route(sessionId, runId)}/cancel`, {}), sessionId, runId)
  },
}
export function isWorkflowRunTerminal(run: WorkflowRunSnapshot): boolean {
  return ["succeeded", "failed", "cancelled"].includes(run.status)
}
/** Do not render arbitrary response bodies or transport diagnostics in run history. */
export function workflowRunError(error: unknown, mutation = false): string {
  if (isApiError(error)) {
    if (error.status === 401 || error.status === 403) return uiText("workflow_run_not_authorized")
    if (error.status === 404) return uiText("workflow_run_not_found")
    if (error.status === 409) return uiText("workflow_run_conflict")
    if (error.status === 400) {
      try {
        if (JSON.parse(error.body ?? "null")?.code === "workflow_monetary_budget_unsupported") {
          return uiText("workflow_run_monetary_budget_unsupported")
        }
      } catch { /* An unrecognized response keeps the general rejection message. */ }
      return uiText("workflow_run_rejected")
    }
  }
  return uiText(mutation ? "workflow_run_unconfirmed" : "workflow_run_unavailable")
}
