import { beforeEach, expect, it, vi } from "vitest"
import { ApiError, apiClient } from "@services/api"
import { readRuntimeObservation } from "./runtimeObservation"

vi.mock("@services/api", async (original) => ({
  ...await original<typeof import("@services/api")>(),
  apiClient: { postOnce: vi.fn() },
}))

const scope = { project_id: "project", work_id: "work", assignment_id: "assignment", generation: 2, authority_epoch: 3 }
const target = { mode: "active" as const, projectId: "project", workId: "work", assignmentId: "assignment", generation: 2, assignmentAuthorityEpoch: 3,
  snapshot: { commit: "snapshot", seq: 18, authority_epoch: 3 } }
const unknown = { state: "unknown", scope, ticket_commit: "snapshot", started_at_ms: null,
  heartbeat_at_ms: null, progress: null, expected_wait: null, execution_outcome_unknown: false }
const post = vi.mocked(apiClient.postOnce)
const read = () => readRuntimeObservation(target, new AbortController().signal)
const at = 1793700000000

beforeEach(() => { post.mockReset() })

it("uses the authenticated one-shot route and keeps heartbeat independent of progress", async () => {
  post.mockResolvedValue({ ...unknown, state: "observed", started_at_ms: at - 10, heartbeat_at_ms: at })
  const { signal } = new AbortController()
  await expect(readRuntimeObservation(target, signal)).resolves.toEqual({ status: "sample",
    facts: { startedAt: at - 10, heartbeatAt: at, progress: null, wait: null, outcomeUnknown: false } })
  expect(post).toHaveBeenCalledExactlyOnceWith("tickets/patrol/observation",
    { project_id: "project", work_id: "work", assignment_id: "assignment" }, { signal, cache: "no-store" })
})

it.each(["dependency", "running_tool"])("keeps %s wait allowance separate from progress", async (kind) => {
  post.mockResolvedValue({ ...unknown, state: "observed", started_at_ms: at, progress: { sequence: 17, at_ms: at + 2 },
    expected_wait: { kind, issued_at_ms: at + 3, diagnostic_allowance_until_ms: at + 5000 } })
  await expect(read()).resolves.toEqual({ status: "sample", facts: {
    startedAt: at, heartbeatAt: null, progress: { sequence: 17, at: at + 2 },
    wait: { kind, issuedAt: at + 3, allowanceUntil: at + 5000 }, outcomeUnknown: false,
  } })
})

it("reads a stopped yielded Question under a newer writer epoch without treating its allowance as progress", async () => {
  post.mockResolvedValue({ ...unknown, state: "observed",
    expected_wait: { kind: "user", issued_at_ms: at, diagnostic_allowance_until_ms: at + 5000 } })
  const reopened = { ...target, mode: "yielded_question" as const, snapshot: { ...target.snapshot, authority_epoch: 4 } }
  await expect(readRuntimeObservation(reopened, new AbortController().signal)).resolves.toEqual({
    status: "sample", facts: { startedAt: null, heartbeatAt: null, progress: null,
      wait: { kind: "user", issuedAt: at, allowanceUntil: at + 5000 }, outcomeUnknown: false },
  })
})

it("preserves explicit outcome uncertainty even without a runtime sample", async () => {
  post.mockResolvedValue({ ...unknown, execution_outcome_unknown: true })
  await expect(read()).resolves.toEqual({ status: "sample", facts: {
    startedAt: null, heartbeatAt: null, progress: null, wait: null, outcomeUnknown: true,
  } })
})

it.each(Object.keys(scope))("discards a mismatched %s fence", async (field) => {
  post.mockResolvedValue({ ...unknown, state: "observed", started_at_ms: at - 10, heartbeat_at_ms: at, scope: { ...scope, [field]: "foreign" } })
  await expect(read()).resolves.toEqual({ status: "unknown" })
})

it.each([
  ["stale Ticket commit", { ticket_commit: "older" }],
  ["non-ISO-range timestamp", { heartbeat_at_ms: Number.MAX_SAFE_INTEGER }],
  ["missing fact", { started_at_ms: undefined }],
  ["inconsistent state", { state: "unknown" }],
  ["unverified progress sequence", { progress: { sequence: 19, at_ms: at } }],
  ["invalid wait window", { expected_wait: { kind: "user", issued_at_ms: at, diagnostic_allowance_until_ms: at - 1 } }],
  ["unsupported wait kind", { expected_wait: { kind: "custom", issued_at_ms: at, diagnostic_allowance_until_ms: at + 1 } }],
  ["execution outcome uncertainty with live facts", { execution_outcome_unknown: true }],
  ["heartbeat before entry", { heartbeat_at_ms: at - 11 }],
  ["progress before entry", { progress: { sequence: 9, at_ms: at - 11 } }],
  ["empty wait window", { expected_wait: { kind: "user", issued_at_ms: at, diagnostic_allowance_until_ms: at } }],
  ["missing outcome flag", { execution_outcome_unknown: undefined }],
])("keeps evidence unknown for %s", async (_reason, overrides) => {
  post.mockResolvedValue({ ...unknown, state: "observed", started_at_ms: at - 10, heartbeat_at_ms: at, ...overrides })
  await expect(read()).resolves.toEqual({ status: "unknown" })
})

it.each([[401, "denied"], [403, "denied"], [404, "unavailable"], [405, "unavailable"], [409, "unknown"], [503, "unknown"]] as const)(
  "classifies HTTP %s without exposing the response body", async (status, expected) => {
    post.mockRejectedValue(new ApiError("private error", status, "fixture"))
    await expect(read()).resolves.toEqual({ status: expected })
    expect(post).toHaveBeenCalledTimes(1)
  },
)

it("keeps network failures unknown", async () => {
  post.mockRejectedValue(new Error("transport unavailable"))
  await expect(read()).resolves.toEqual({ status: "unknown" })
})
