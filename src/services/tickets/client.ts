import { uiText } from "@shared/i18n/ui"
import { apiClient, isApiError } from "@services/api"
import { TicketScopeUnavailableError, unavailableScope, isTicketInitialization, scopeAvailability } from "./availability"
import type { Cursor, ReadEnvelope, ResponseCommand, SnapshotRef, TicketInitialization, TicketInitializationResult, TicketScope, TicketSnapshot, WorkView } from "./types"

const sameSnapshot = (a: ReadEnvelope<unknown>, expected: SnapshotRef) => {
  if (a.snapshot.commit !== expected.commit || a.snapshot.seq !== expected.seq || a.snapshot.authority_epoch !== expected.authority_epoch
    || !Number.isSafeInteger(a.snapshot.seq) || a.snapshot.seq < 0
    || !Number.isSafeInteger(a.snapshot.authority_epoch) || a.snapshot.authority_epoch < 1) {
    throw new Error(uiText("ticket_the_ticket_snapshot_is_inconsistent_refresh_a_4e2cb547"))
  }
}
const completeCoverage = (coverage: string) => coverage === "authoritative_scope" || coverage === "complete"

function verifiedScope(scope: TicketScope, sessionId: string): TicketSnapshot["scope"] {
  let presentation
  try { presentation = scope && scopeAvailability(scope, sessionId) }
  catch { throw new Error(uiText("supervisor_work_invalid_response")) }
  if (scope?.available === false) {
    if (presentation && presentation.kind !== "loading" && presentation.kind !== "ready") {
      throw new TicketScopeUnavailableError(presentation.kind, presentation.detail, presentation)
    }
    throw unavailableScope(scope.reason)
  }
  if (scope?.available !== true || !scope.binding || !scope.overview
    || typeof scope.mutation_enabled !== "boolean" || typeof scope.dispatch_enabled !== "boolean"
    || typeof scope.health !== "string" || !scope.health) {
    throw new Error(uiText("supervisor_work_invalid_response"))
  }
  if (scope.binding.supervisor_session_id !== sessionId) throw new TicketScopeUnavailableError("unbound")
  if (scope.capabilities?.ticket_scope_v1 !== true || scope.capabilities.multi_pending_v1 !== true
    || scope.capabilities.precise_request_response_v1 !== true) throw new TicketScopeUnavailableError("unsupported")
  sameSnapshot(scope.overview, scope.overview.snapshot)
  return { ...scope, binding: scope.binding, overview: scope.overview }
}

export const ticketClient = {
  async scope(sessionId: string, signal?: AbortSignal): Promise<TicketSnapshot["scope"] | null> {
    let scope: TicketScope
    try { scope = await apiClient.get<TicketScope>("tickets/scope", { signal }) }
    catch (error) {
      if (isApiError(error) && error.status === 404) throw new TicketScopeUnavailableError("unsupported", error.message)
      throw error
    }
    return verifiedScope(scope, sessionId)
  },
  async initialize(confirmation: TicketInitialization): Promise<TicketInitializationResult> {
    if (!isTicketInitialization(confirmation, confirmation?.supervisor_session_id)) {
      throw new Error(uiText("supervisor_work_initialization_unconfirmed"))
    }
    // Copy only the three confirmed wire fields. No caller option may enable
    // a gate, select a mode, import history, or change the binding.
    const command: TicketInitialization = {
      supervisor_session_id: confirmation.supervisor_session_id,
      incarnation_id: confirmation.incarnation_id,
      binding_revision: confirmation.binding_revision,
    }
    const response = await apiClient.postOnce<TicketInitializationResult>("tickets/initialize", command)
    if (!response || typeof response.created !== "boolean") throw new Error(uiText("supervisor_work_initialization_unconfirmed"))
    const scope = verifiedScope(response.scope, command.supervisor_session_id)
    if (!scope.availability || scope.readable !== true) throw new Error(uiText("supervisor_work_initialization_unconfirmed"))
    if (scope.binding.binding_revision !== command.binding_revision
      || scope.binding.scope_id !== "supervisor/" + command.incarnation_id) {
      throw new Error(uiText("supervisor_work_initialization_unconfirmed"))
    }
    return { created: response.created, scope }
  },
  async load(sessionId: string, signal?: AbortSignal): Promise<TicketSnapshot | null> {
    const scope = await ticketClient.scope(sessionId, signal)
    if (!scope) return null
    const snapshot = scope.overview.snapshot
    sameSnapshot(scope.overview, snapshot)
    const summaries: { id: string; kind: string }[] = []
    let cursor: Cursor | null = null
    let complete = completeCoverage(scope.overview.coverage) && !scope.overview.truncated
      && scope.overview.omitted_count === 0 && scope.overview.index_seq >= snapshot.seq
    for (let page = 0; page < 10; page++) {
      const result: ReadEnvelope<{ id: string; kind: string }[]> = await apiClient.post("tickets/search", {
        filter: { query: "", kind: null, state: null, updated_after: null, updated_before: null, include_archived: true },
        limit: 100, cursor, fixed_commit: snapshot.commit,
      }, { signal })
      sameSnapshot(result, snapshot)
      summaries.push(...result.data)
      cursor = result.next_cursor
      if (result.index_seq < snapshot.seq || result.truncated || result.omitted_count !== 0) complete = false
      if (!cursor) { complete = complete && completeCoverage(result.coverage); break }
      if (page === 9) complete = false
    }
    const views: WorkView[] = []
    // A complete contract is never silently cut to fit a batch budget.
    for (const row of summaries.filter((row) => row.kind !== "step")) {
      let result: ReadEnvelope<WorkView[]>
      const inspect = (sections: string[]) => apiClient.post<ReadEnvelope<WorkView[]>>("tickets/inspect", {
        ids: [row.id], sections, depth: 0, budget_bytes: 65536, fixed_commit: snapshot.commit,
      }, { signal })
      const overBudget = (failure: unknown) => isApiError(failure) && failure.status === 422 && failure.message === "context_budget_exceeded"
      try { result = await inspect(["assignments", "requests", "submissions"]) }
      catch (failure) {
        if (!overBudget(failure)) throw failure
        // Long execution histories must not hide an otherwise complete Work or
        // its exact decisions. Missing execution metadata stays explicitly unknown.
        try { result = await inspect(["requests", "submissions"]) }
        catch (fallback) { if (!overBudget(fallback)) throw fallback; complete = false; continue }
      }
      sameSnapshot(result, snapshot)
      if (result.truncated || result.omitted_count !== 0 || !completeCoverage(result.coverage)) complete = false
      views.push(...result.data)
    }
    return { scope: { ...scope, binding: scope.binding, overview: scope.overview }, snapshot, views, complete }
  },
  // Changes are a bounded invalidation signal. A newer high watermark causes
  // a new complete fixed snapshot; we never pretend the first page is all data.
  changes(sinceSeq: number, signal?: AbortSignal) {
    return apiClient.post<ReadEnvelope<{ seq: number; entity: string; id: string }[]>>("tickets/changes", {
      since_seq: sinceSeq, limit: 100, cursor: null,
    }, { signal })
  },
  respond(command: ResponseCommand) {
    return apiClient.postOnce<{ operation_id: string; committed_seq: number }>("tickets/requests/respond", command)
  },
  async artifact(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(uiText("ticket_the_artifact_reference_is_invalid__5e443df8"))
    const response = await apiClient.fetchRaw("tickets/artifacts/" + hash)
    return response.blob()
  },
}
