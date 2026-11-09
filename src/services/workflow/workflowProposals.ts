import { uiText } from "@shared/i18n/ui"
import { apiClient, isApiError } from "../api"
import type { WorkflowRunStatus } from "./workflowRuns"

export const SKILL_CURATOR_ID = "skill-curator"
const runStatuses: readonly string[] = ["queued", "running", "suspended", "succeeded", "failed", "cancelled"]
const digest = /^[a-f0-9]{64}$/

type DefinitionStep = Record<string, unknown> & {
  id: string
  type: string
  tool?: string
  agent?: string
}
export type AuthoredDefinition = Record<string, unknown> & {
  id: string
  revision: number
  steps: DefinitionStep[]
}
export type WorkflowDraftProposal = {
  decision: "draft"
  project_id: string
  description: string
  definition: AuthoredDefinition
  base: { definition: AuthoredDefinition; content_digest: string; skill_digest: string } | null
}
type ProposalResult = WorkflowDraftProposal | { decision: "clarify"; question: string } | { decision: "no_change" }
export type WorkflowProposal = { run_id: string; status: WorkflowRunStatus; result?: ProposalResult }
export type PublishedWorkflow = { id: string; revision: number; catalogAvailable: boolean }

function invalid(): never { throw new Error(uiText("workflow_run_invalid_response")) }
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid()
}
function text(value: unknown): string { return typeof value === "string" && value.trim() ? value : invalid() }
function definition(value: unknown): AuthoredDefinition {
  const raw = record(value)
  if (raw.workflow_schema !== 1 || !Number.isSafeInteger(raw.revision) || Number(raw.revision) <= 0
    || !Array.isArray(raw.steps) || raw.steps.length === 0) invalid()
  const steps = raw.steps.map((value) => {
    const step = record(value)
    return { ...step, id: text(step.id), type: text(step.type),
      ...(step.tool !== undefined ? { tool: text(step.tool) } : {}),
      ...(step.agent !== undefined ? { agent: text(step.agent) } : {}) }
  })
  if (new Set(steps.map((step) => step.id)).size !== steps.length) invalid()
  return { ...raw, id: text(raw.id), revision: Number(raw.revision), steps }
}

function result(value: unknown): ProposalResult {
  const raw = record(value)
  if (raw.decision === "clarify") return { decision: "clarify", question: text(raw.question) }
  if (raw.decision === "no_change") return { decision: "no_change" }
  if (raw.decision !== "draft") invalid()
  const proposed = definition(raw.definition)
  const base = raw.base === null ? null : record(raw.base)
  const previous = base && definition(base.definition)
  if (base && previous) {
    if (!digest.test(text(base.content_digest)) || !digest.test(text(base.skill_digest))
      || proposed.id !== previous.id || proposed.revision !== previous.revision + 1) invalid()
  } else if (proposed.revision !== 1) invalid()
  return { decision: "draft", project_id: text(raw.project_id), description: text(raw.description), definition: proposed,
    base: base && previous ? { definition: previous, content_digest: text(base.content_digest), skill_digest: text(base.skill_digest) } : null }
}

function parseProposal(value: unknown, sessionId: string, runId?: string): WorkflowProposal {
  const raw = record(value)
  if (raw.session_id !== sessionId || (runId !== undefined && raw.run_id !== runId)
    || !runStatuses.includes(raw.status as string)) invalid()
  return { run_id: text(raw.run_id), status: raw.status as WorkflowRunStatus,
    ...(runId !== undefined && raw.status === "succeeded" ? { result: result(raw.result) } : {}) }
}
function proposalRoute(sessionId: string, runId?: string) {
  const route = `sessions/${encodeURIComponent(sessionId)}/workflow-proposals`
  return runId === undefined ? route : `${route}/${encodeURIComponent(runId)}`
}

export const workflowProposals = {
  async start(sessionId: string, instruction: string, workflowId?: string) {
    const raw = await apiClient.postOnce<unknown>(proposalRoute(sessionId), {
      instruction, ...(workflowId ? { workflow_id: workflowId } : {}),
    })
    return parseProposal(raw, sessionId)
  },
  async read(sessionId: string, runId: string, signal?: AbortSignal) {
    return parseProposal(await apiClient.get<unknown>(proposalRoute(sessionId, runId), { signal }), sessionId, runId)
  },
  async publish(sessionId: string, proposal: WorkflowDraftProposal): Promise<PublishedWorkflow> {
    const route = "bamboo/workflow-definitions"
    const body = { target: "project", session_id: sessionId, expected_project_id: proposal.project_id, definition: proposal.definition }
    const previous = proposal.base
    const raw = record(previous
      ? await apiClient.putOnce<unknown>(`${route}/${encodeURIComponent(proposal.definition.id)}`, {
        ...body, expected_revision: previous.definition.revision, expected_digest: previous.content_digest,
        expected_skill_digest: previous.skill_digest,
      })
      : await apiClient.postOnce<unknown>(route, { ...body, description: proposal.description }))
    const saved = definition(raw.definition)
    if (raw.saved !== true || raw.source !== "project" || typeof raw.catalog_available !== "boolean"
      || saved.id !== proposal.definition.id || saved.revision !== proposal.definition.revision) invalid()
    return { id: saved.id, revision: saved.revision, catalogAvailable: raw.catalog_available }
  },
}

export function workflowProposalError(error: unknown, operation: "start" | "read" | "save"): string {
  if (isApiError(error)) {
    if (error.status === 401 || error.status === 403) return uiText("workflow_run_not_authorized")
    if (error.status === 404) return uiText("workflow_authoring_unavailable")
    if (error.status === 409) return uiText("workflow_authoring_conflict")
    if (error.status === 422) return uiText("workflow_authoring_invalid_proposal")
    if (error.status === 501) return uiText("workflow_authoring_update_unavailable")
    if (error.status === 400 || error.status === 413) return uiText("workflow_authoring_rejected")
  }
  return uiText(operation === "save" ? "workflow_authoring_save_unconfirmed" :
    operation === "start" ? "workflow_authoring_start_unconfirmed" : "workflow_authoring_unavailable")
}
