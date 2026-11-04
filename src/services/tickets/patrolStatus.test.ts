import { beforeEach, describe, expect, it, vi } from "vitest"
import { apiClient, ApiError } from "@services/api"
import { readPatrolStatus } from "./patrolStatus"

vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(), apiClient: { postOnce: vi.fn() } }))

const target = { projectId: "project", workId: "work", assignmentId: "attempt", generation: 2,
  assignmentAuthorityEpoch: 4, snapshot: { commit: "commit", seq: 24, authority_epoch: 5 } }
const scope = { project_id: "project", work_id: "work", assignment_id: "attempt", generation: 2, authority_epoch: 4 }
const id = { scope, progress_sequence: 10 }
const incident = {
  id, reason: "evidence_unknown", phase: "blocked", blocked_reason: { budget: "work" },
  attempts: 1, last_diagnosis_at_ms: null, accounting_pending: true,
  escalation: { operation: { kind: "escalation", incident: id }, reason: "budget_blocked",
    deliveries: 1, queued: true, next_delivery_ms: 3000 },
}
const checkpoint = { version: 3, cursor: 20, source_revision: 19, last_check_ms: 1000, next_check_ms: 2000,
  execution_facts_match: true, incident }
const wire = { state: "available", scope, ticket_commit: "commit", ticket_cursor: 24, execution_facts_revision: 19, checkpoint }
const post = vi.mocked(apiClient.postOnce)
const signal = new AbortController().signal
const read = () => readPatrolStatus(target, signal)

describe("readPatrolStatus", () => {
  beforeEach(() => { post.mockReset() })

  it("reads the exact current attempt, including an older immutable epoch after restart", async () => {
    post.mockResolvedValue(wire)
    expect(await read()).toEqual({
      status: "available", checkpoint: { lastCheck: 1000, nextCheck: 2000, incident: {
        assignmentId: "attempt", progressSequence: 10, reason: "evidence_unknown", phase: "blocked", attempts: 1,
        lastDiagnosis: null, blockedReason: "budget/work", accountingPending: true,
        escalation: { reason: "budget_blocked", deliveries: 1, queued: true, nextDelivery: 3000 },
      } },
    })
    expect(post).toHaveBeenCalledExactlyOnceWith("tickets/patrol/status",
      { project_id: "project", work_id: "work", assignment_id: "attempt" }, { signal, cache: "no-store" })
  })

  it("preserves stale checkpoint data as history", async () => {
    post.mockResolvedValue({ ...wire, state: "stale", execution_facts_revision: 21,
      checkpoint: { ...checkpoint, execution_facts_match: false } })
    expect(await read()).toMatchObject({ status: "stale", checkpoint: { incident: { progressSequence: 10 } } })
  })

  it.each(["not_checked", "busy", "unavailable", "corrupt", "unsupported"])("keeps %s distinct without a checkpoint", async (state) => {
    post.mockResolvedValue({ ...wire, state, checkpoint: null })
    expect(await read()).toEqual({ status: state })
  })

  it.each(Object.keys(scope))("rejects a mismatched %s fence", async (key) => {
    post.mockResolvedValue({ ...wire, scope: { ...scope, [key]: "foreign" } })
    expect(await read()).toEqual({ status: "unknown" })
  })

  it.each([
    { ...wire, ticket_commit: "different" },
    { ...wire, ticket_cursor: 23 },
    { ...wire, execution_facts_revision: 25 },
    { ...wire, state: "busy" },
    { ...wire, checkpoint: { ...checkpoint, source_revision: 18 } },
    { ...wire, checkpoint: { ...checkpoint, cursor: 25 } },
    { ...wire, checkpoint: { ...checkpoint, next_check_ms: 999 } },
    { ...wire, checkpoint: { ...checkpoint, incident: { ...incident, last_diagnosis_at_ms: 1001 } } },
    { ...wire, checkpoint: { ...checkpoint, incident: { ...incident, attempts: 9 } } },
    { ...wire, checkpoint: { ...checkpoint, incident: { ...incident, attempts: 0, phase: "diagnosing", blocked_reason: null, accounting_pending: false } } },
    { ...wire, checkpoint: { ...checkpoint, incident: { ...incident, escalation: { ...incident.escalation, deliveries: 0 } } } },
    { ...wire, checkpoint: { ...checkpoint, incident: { ...incident, escalation: { ...incident.escalation, deliveries: 9 } } } },
    { ...wire, checkpoint: { ...checkpoint, next_check_ms: Number.MAX_SAFE_INTEGER } },
    { ...wire, checkpoint: { ...checkpoint, incident: { ...incident, id: { ...id, progress_sequence: 21 } } } },
    { ...wire, checkpoint: { ...checkpoint, incident: { ...incident, id: { ...id, scope: { ...scope, generation: 1 } } } } },
    { ...wire, checkpoint: { ...checkpoint, incident: { ...incident, phase: "completed" } } },
    { ...wire, checkpoint: { ...checkpoint, incident: { ...incident, escalation: { ...incident.escalation, queued: "yes" } } } },
    { ...wire, checkpoint: { ...checkpoint, incident: { ...incident,
      escalation: { ...incident.escalation, operation: { kind: "escalation", incident: { ...id, progress_sequence: 9 } } } } } },
  ])("withholds inconsistent or malformed evidence %#", async (payload) => {
    post.mockResolvedValue(payload)
    expect(await read()).toEqual({ status: "unknown" })
  })

  it.each([[401, "denied"], [403, "denied"], [404, "unavailable"], [409, "unknown"], [500, "unknown"]] as const)(
    "retains a safe result after HTTP %d", async (code, status) => {
      post.mockRejectedValue(new ApiError("private internal path", code, "Failed"))
      expect(await read()).toEqual({ status })
    },
  )
})
