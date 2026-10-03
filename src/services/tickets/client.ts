import { apiClient, isApiError } from "@services/api"
import type { Cursor, ReadEnvelope, ResponseCommand, SnapshotRef, TicketScope, TicketSnapshot, WorkView } from "./types"

const sameSnapshot = (a: ReadEnvelope<unknown>, expected: SnapshotRef) => {
  if (a.snapshot.commit !== expected.commit || a.snapshot.seq !== expected.seq || a.snapshot.authority_epoch !== expected.authority_epoch
    || !Number.isSafeInteger(a.snapshot.seq) || a.snapshot.seq < 0
    || !Number.isSafeInteger(a.snapshot.authority_epoch) || a.snapshot.authority_epoch < 1) {
    throw new Error("工单快照不一致，请刷新后重试。")
  }
}
const completeCoverage = (coverage: string) => coverage === "authoritative_scope" || coverage === "complete"

export const ticketClient = {
  async scope(sessionId: string, signal?: AbortSignal): Promise<TicketSnapshot["scope"] | null> {
    let scope: TicketScope
    try { scope = await apiClient.get<TicketScope>("tickets/scope", { signal }) }
    catch (error) { if (isApiError(error) && error.status === 404) return null; throw error }
    if (!scope.available || !scope.binding || !scope.overview
      || scope.binding.supervisor_session_id !== sessionId
      || !scope.capabilities?.ticket_scope_v1 || !scope.capabilities.multi_pending_v1
      || !scope.capabilities.precise_request_response_v1) return null
    sameSnapshot(scope.overview, scope.overview.snapshot)
    return { ...scope, binding: scope.binding, overview: scope.overview }
  },
  async load(sessionId: string, signal?: AbortSignal): Promise<TicketSnapshot | null> {
    const scope = await ticketClient.scope(sessionId, signal)
    if (!scope) return null
    const snapshot = scope.overview.snapshot
    sameSnapshot(scope.overview, snapshot)
    const summaries: { id: string; kind: string }[] = []
    let cursor: Cursor | null = null
    let complete = completeCoverage(scope.overview.coverage) && !scope.overview.truncated
      && scope.overview.index_seq >= snapshot.seq
    for (let page = 0; page < 10; page++) {
      const result: ReadEnvelope<{ id: string; kind: string }[]> = await apiClient.post("tickets/search", {
        filter: { query: "", kind: null, state: null, updated_after: null, updated_before: null, include_archived: true },
        limit: 100, cursor, fixed_commit: snapshot.commit,
      }, { signal })
      sameSnapshot(result, snapshot)
      summaries.push(...result.data)
      cursor = result.next_cursor
      if (result.index_seq < snapshot.seq) complete = false
      if (!cursor) { complete = complete && completeCoverage(result.coverage); break }
      if (page === 9) complete = false
    }
    const views: WorkView[] = []
    // A complete contract is never silently cut to fit a batch budget.
    for (const row of summaries.filter((row) => row.kind !== "step")) {
      let result: ReadEnvelope<WorkView[]>
      try {
        result = await apiClient.post<ReadEnvelope<WorkView[]>>("tickets/inspect", {
          ids: [row.id], sections: ["requests", "submissions"], depth: 0,
          budget_bytes: 65536, fixed_commit: snapshot.commit,
        }, { signal })
      } catch (failure) {
        if (!isApiError(failure) || failure.status !== 422 || failure.message !== "context_budget_exceeded") throw failure
        complete = false; continue
      }
      sameSnapshot(result, snapshot)
      if (result.truncated || !completeCoverage(result.coverage)) complete = false
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
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("成果引用无效。")
    const response = await apiClient.fetchRaw("tickets/artifacts/" + hash)
    return response.blob()
  },
}
