import { createRoot, createSignal, flush } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { ApiError } from "@services/api/errors"
import { beginSessionCompatibilityRead, clearSessionCompatibilityObservations, completeSessionCompatibilityRead,
  getSessionCompatibilitySnapshot, isSessionExecutionBlocked } from "@services/chat/sessionExecutionCompatibility"
import type { SessionVersionMigrationRequest } from "@services/chat/sessionVersionMigration"

import { createSessionVersionMigration } from "./createSessionVersionMigration"

const mocks = vi.hoisted(() => ({
  assess: vi.fn<(id: string) => Promise<unknown>>(),
  postOnce: vi.fn<(endpoint: string, request: SessionVersionMigrationRequest) => Promise<unknown>>(),
  getSession: vi.fn<(id: string) => Promise<unknown>>(),
}))
vi.mock("@services/chat/AgentService", () => ({ agentClient: { getSession: mocks.getSession } }))
vi.mock("@services/api", () => ({ apiClient: {
  get: (path: string, options: { cache: string }) => {
    expect(path).toMatch(/^sessions\/[^/]+\/version-migration$/)
    expect(options).toEqual({ cache: "no-store" })
    return mocks.assess(decodeURIComponent(path.split("/")[1]!))
  },
  postOnce: mocks.postOnce,
} }))
const assessment = (id = "a") => ({ session_id: id, birth_token: "d".repeat(64),
  session_version: null, current_session_version: 2, metadata_version: 5,
  snapshot_sha256: "a".repeat(64), eligible: true, blockers: [] })
const detail = (id = "a", version = 2) => ({ session: { id, root_mode_birth_token: "d".repeat(64), execution_compatibility: {
  session_version: version, current_session_version: 2, status: "compatible", history_readable: true,
  execution_allowed: true, conflicts: [] } } })
const receipt = (id: string, request: SessionVersionMigrationRequest) => ({
  status: "committed", session_id: id, operation_id: request.operation_id,
  source_version: request.expected_session_version, target_version: 2,
  before_sha256: request.expected_snapshot_sha256, after_sha256: "b".repeat(64), birth_token: request.birth_token,
})
let dispose: (() => void) | undefined
let value: ReturnType<typeof createSessionVersionMigration>
let selectSession: (id: string | null) => void
let setEnabled: (enabled: boolean) => void
let setAllowed: (allowed: boolean) => void

async function apply(change: () => void | Promise<void>) {
  const result = change()
  flush()
  await result
  await Promise.resolve()
  flush()
}

const mount = (id: string | null, enabled = true) => apply(() => { selectSession(id); setEnabled(enabled) })

beforeEach(() => {
  mocks.assess.mockReset().mockImplementation(async (id) => assessment(id))
  mocks.postOnce.mockReset().mockImplementation(async (path, request) => receipt(decodeURIComponent(path.split("/")[1]!), request))
  mocks.getSession.mockReset().mockImplementation(async (id) => detail(id))
  createRoot((cleanup) => {
    dispose = cleanup
    const [sessionId, updateSession] = createSignal<string | null>(null)
    const [enabled, updateEnabled] = createSignal(true)
    const [allowed, updateAllowed] = createSignal(true)
    selectSession = updateSession
    setEnabled = updateEnabled
    setAllowed = updateAllowed
    value = createSessionVersionMigration({ sessionId, enabled, allowNewMigration: allowed, autoAssess: allowed })
  })
  flush()
})
afterEach(() => { dispose?.(); dispose = undefined; clearSessionCompatibilityObservations() })

it("does not mutate on observation and confirms completion through canonical compatibility", async () => {
  await mount("a")
  expect(mocks.postOnce).not.toHaveBeenCalled()
  await apply(value.migrate)
  expect(value.state().phase).toBe("committed")
  expect(mocks.postOnce).toHaveBeenCalledTimes(1)
  expect(getSessionCompatibilitySnapshot("a").report?.session_version).toBe(2)
})
it("an uncertain result keeps the same operation and retries only after another explicit action", async () => {
  mocks.postOnce.mockRejectedValueOnce(new Error("timeout"))
  await mount("a")
  await apply(value.migrate)
  expect(value.state().phase).toBe("unconfirmed")
  const original = mocks.postOnce.mock.calls[0][1]
  expect(mocks.postOnce).toHaveBeenCalledTimes(1)
  await apply(value.migrate)
  expect(mocks.postOnce.mock.calls[1][1]).toEqual(original)
  expect(value.state().phase).toBe("committed")
})
it("a matching receipt without current canonical version stays unconfirmed", async () => {
  mocks.getSession.mockResolvedValue(detail("a", 1))
  await mount("a")
  await apply(value.migrate)
  expect(value.state().phase).toBe("unconfirmed")
  expect(value.canRecover()).toBe(true)
})
it("publishes a canonical execution conflict without reporting a read failure or migration success", async () => {
  const prior = beginSessionCompatibilityRead("a")
  completeSessionCompatibilityRead("a", prior, detail("a", 1))
  mocks.getSession.mockResolvedValue({ session: { ...detail("a", 99).session, execution_compatibility: {
    ...detail("a", 99).session.execution_compatibility, status: "conflict", execution_allowed: false,
    conflicts: [{ code: "unsupported_session_version", message: "A newer behavior version was observed" }] } } })
  await mount("a")
  await apply(value.migrate)
  expect(isSessionExecutionBlocked("a")).toBe(true)
  expect(getSessionCompatibilitySnapshot("a")).toMatchObject({ report: { status: "conflict", session_version: 99 },
    loading: false, readError: false })
  expect(value.state().phase).toBe("unconfirmed")
  expect(value.canRecover()).toBe(true)
  expect(mocks.postOnce).toHaveBeenCalledTimes(1)
})
it.each(["foreign", "invalid"])("a %s canonical read cannot publish compatibility or confirm migration", async (mode) => {
  const prior = beginSessionCompatibilityRead("a")
  completeSessionCompatibilityRead("a", prior, detail("a", 1))
  mocks.getSession.mockResolvedValue(mode === "foreign" ? detail("other") : {
    session: { ...detail().session, execution_compatibility: { status: "conflict", execution_allowed: false } } })
  await mount("a")
  await apply(value.migrate)
  expect(getSessionCompatibilitySnapshot("a").report?.session_version).toBe(1)
  expect(getSessionCompatibilitySnapshot("a").readError).toBe(true)
  expect(getSessionCompatibilitySnapshot("other").observed).toBe(false)
  expect(value.state().phase).toBe("unconfirmed")
  expect(value.canRecover()).toBe(true)
  expect(mocks.postOnce).toHaveBeenCalledTimes(1)
})
it("a typed refusal during readback cannot erase an already acknowledged migration intent", async () => {
  mocks.getSession.mockRejectedValueOnce(new ApiError("pending", 409, "Conflict", "{}"))
    .mockResolvedValueOnce(detail())
  await mount("a")
  await apply(value.migrate)
  const original = mocks.postOnce.mock.calls[0][1]
  expect(value.state().phase).toBe("unconfirmed")
  expect(value.canRecover()).toBe(true)
  expect(mocks.assess).toHaveBeenCalledTimes(1)
  await apply(value.migrate)
  expect(mocks.postOnce.mock.calls[1][1]).toEqual(original)
  expect(value.state().phase).toBe("committed")
})
it("a same-ID replacement cannot claim preserved-history success for the original lifetime", async () => {
  mocks.getSession.mockResolvedValue({ session: { ...detail().session, root_mode_birth_token: "e".repeat(64) } })
  await mount("a")
  await apply(value.migrate)
  expect(value.state().phase).toBe("unconfirmed")
  expect(value.canRecover()).toBe(true)
  expect(getSessionCompatibilitySnapshot("a")).toMatchObject({ report: { session_version: 2 }, readError: false })
})
it("a newer canonical observation supersedes delayed migration readback without losing the original intent", async () => {
  let finish!: (result: unknown) => void
  mocks.getSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await mount("a")
  let operation!: Promise<void>
  await apply(() => { operation = value.migrate() })
  const intent = mocks.postOnce.mock.calls[0][1]
  const newer = beginSessionCompatibilityRead("a")
  expect(completeSessionCompatibilityRead("a", newer, { session: { ...detail().session,
    root_mode_birth_token: "e".repeat(64) } })).toBe(true)
  await apply(async () => { finish({ session: { ...detail("a", 99).session, execution_compatibility: {
    ...detail("a", 99).session.execution_compatibility, status: "conflict", execution_allowed: false,
    conflicts: [{ code: "unsupported_session_version", message: "Superseded conflict" }] } } }); await operation })
  expect(value.state().phase).toBe("unconfirmed")
  expect(value.canRecover()).toBe(true)
  expect(mocks.postOnce.mock.calls[0][1]).toEqual(intent)
  expect(getSessionCompatibilitySnapshot("a")).toMatchObject({ report: { session_version: 2, status: "compatible" }, readError: false })
})
it("Child readback without a Root token uses the server's focused lifetime witness", async () => {
  mocks.getSession.mockResolvedValue({ session: { ...detail().session, root_mode_birth_token: undefined } })
  mocks.assess.mockResolvedValueOnce(assessment()).mockResolvedValueOnce({ ...assessment(), session_version: 2,
    eligible: false, blockers: [{ code: "already_current", message: "Current" }] })
  await mount("a")
  await apply(value.migrate)
  expect(value.state().phase).toBe("committed")
  expect(mocks.assess).toHaveBeenCalledTimes(2)
})
it("a newer compatibility read during Child lifetime verification prevents migration success", async () => {
  let finish!: (result: unknown) => void
  mocks.getSession.mockResolvedValue({ session: { ...detail().session, root_mode_birth_token: undefined } })
  mocks.assess.mockResolvedValueOnce(assessment()).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await mount("a")
  let operation!: Promise<void>
  await apply(() => { operation = value.migrate() })
  expect(getSessionCompatibilitySnapshot("a").report?.session_version).toBe(2)
  const newer = beginSessionCompatibilityRead("a")
  completeSessionCompatibilityRead("a", newer, { session: { ...detail("a", 99).session, execution_compatibility: {
    ...detail("a", 99).session.execution_compatibility, status: "conflict", execution_allowed: false,
    conflicts: [{ code: "unsupported_session_version", message: "Newer conflict" }] } } })
  await apply(async () => { finish({ ...assessment(), session_version: 2 }); await operation })
  expect(isSessionExecutionBlocked("a")).toBe(true)
  expect(getSessionCompatibilitySnapshot("a").readError).toBe(false)
  expect(value.state().phase).toBe("unconfirmed")
  expect(value.canRecover()).toBe(true)
})
it("CAS refusal refreshes readiness and does not resend the rejected operation", async () => {
  mocks.postOnce.mockRejectedValue(new ApiError("changed", 412, "Precondition Failed", "{}"))
  mocks.assess.mockResolvedValueOnce(assessment()).mockResolvedValueOnce({ ...assessment(), eligible: false,
    blockers: [{ code: "busy", message: "Session is running" }] })
  await mount("a")
  await apply(value.migrate)
  expect(value.state().phase).toBe("error")
  expect(value.state().assessment?.eligible).toBe(false)
  expect(value.canRecover()).toBe(false)
  expect(mocks.postOnce).toHaveBeenCalledTimes(1)
  expect(mocks.assess).toHaveBeenCalledTimes(2)
})
it("late assessments and mutation receipts cannot update a different selected session", async () => {
  let finish!: (result: unknown) => void
  mocks.postOnce.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await mount("a")
  let pending!: Promise<void>
  await apply(() => { pending = value.migrate() })
  const original = mocks.postOnce.mock.calls[0][1]
  await mount("b")
  await apply(async () => { finish({ status: "committed", session_id: "a", operation_id: original.operation_id,
    source_version: null, target_version: 2, before_sha256: "a".repeat(64), after_sha256: "b".repeat(64), birth_token: original.birth_token }); await pending })
  expect(value.state().assessment?.session_id).toBe("b")
  expect(value.state().phase).toBe("idle")
  expect(mocks.getSession).not.toHaveBeenCalled()
})
it("a newer binding ignores a late readiness read", async () => {
  let finish!: (result: unknown) => void
  mocks.assess.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await mount("a"); await mount("b")
  await apply(async () => { finish(assessment("a")); await Promise.resolve() })
  expect(value.state().assessment?.session_id).toBe("b")
})
it("does not assess or migrate an unassessed or incompatible execution binding", async () => {
  await mount("a", false)
  await apply(value.migrate)
  expect(mocks.assess).not.toHaveBeenCalled()
  expect(mocks.postOnce).not.toHaveBeenCalled()
})
it("recovers the server's exact pending operation after a new view is mounted", async () => {
  const request = { operation_id: "131cdeaf-4b8c-4815-a813-1697a2688bfa", birth_token: assessment().birth_token,
    expected_session_version: null, expected_metadata_version: 5, expected_snapshot_sha256: "a".repeat(64) }
  mocks.assess.mockResolvedValue({ ...assessment(), eligible: false,
    blockers: [{ code: "migration_pending", message: "Pending migration" }], pending_operation: request })
  await mount("a")
  expect(value.canRecover()).toBe(true)
  expect(mocks.postOnce).not.toHaveBeenCalled()
  await apply(value.migrate)
  expect(mocks.postOnce.mock.calls[0][1]).toEqual(request)
  expect(value.state().phase).toBe("committed")
})

it("holds an exact lost-response request through an unrelated receipt until canonical compatibility changes", async () => {
  const prior = beginSessionCompatibilityRead("a")
  completeSessionCompatibilityRead("a", prior, detail("a", 1))
  mocks.postOnce.mockRejectedValueOnce(new Error("connection closed without a response"))
    .mockImplementationOnce(async (_path, request) => ({ ...receipt("a", request), birth_token: "e".repeat(64) }))
  let finish!: (result: unknown) => void
  mocks.getSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await mount("a")
  await apply(value.migrate)
  const [endpoint, request] = mocks.postOnce.mock.calls[0]!
  expect(endpoint).toBe("sessions/a/version-migration")
  expect(request).toEqual({ operation_id: expect.any(String), birth_token: assessment().birth_token,
    expected_session_version: null, expected_metadata_version: 5, expected_snapshot_sha256: "a".repeat(64) })
  expect(Object.isFrozen(request)).toBe(true)
  await apply(value.migrate)
  expect(value.state().phase).toBe("unconfirmed")
  expect(mocks.getSession).not.toHaveBeenCalled()
  expect(getSessionCompatibilitySnapshot("a").report?.session_version).toBe(1)

  let operation!: Promise<void>
  await apply(() => { operation = value.migrate() })
  expect(mocks.postOnce.mock.calls).toEqual([[endpoint, request], [endpoint, request], [endpoint, request]])
  expect(value.state()).toMatchObject({ phase: "unconfirmed", submitting: true })
  expect(getSessionCompatibilitySnapshot("a").report?.session_version).toBe(1)
  await apply(async () => { finish(detail()); await operation })
  expect(value.state().phase).toBe("committed")
  expect(value.canRecover()).toBe(false)
  expect(getSessionCompatibilitySnapshot("a").report?.session_version).toBe(2)
})

it("does not create an intent if Bamboo refuses readiness for a mismatched managed lineage", async () => {
  const refused = new ApiError("Migration authority cannot currently be verified.", 503, "Service Unavailable",
    JSON.stringify({ error: { code: "migration_authority_unavailable" } }))
  mocks.assess.mockRejectedValue(refused)
  await mount("a")
  await apply(value.migrate)
  expect(mocks.assess).toHaveBeenCalledExactlyOnceWith("a")
  expect(mocks.postOnce).not.toHaveBeenCalled()
  expect(mocks.getSession).not.toHaveBeenCalled()
  expect(value.state()).toMatchObject({ assessment: null, problem: "unavailable", phase: "idle" })
  expect(value.canRecover()).toBe(false)
})

it("allows explicit readiness reads while the compatibility gate blocks new migration", async () => {
  await apply(() => { selectSession("a"); setAllowed(false) })
  expect(mocks.assess).not.toHaveBeenCalled()
  await apply(value.refresh)
  expect(value.state().assessment?.eligible).toBe(true)
  expect(value.canStart()).toBe(false)
  await apply(value.migrate)
  expect(mocks.postOnce).not.toHaveBeenCalled()
})
