import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ApiError } from "@services/api/errors"
import { beginSessionCompatibilityRead, clearSessionCompatibilityObservations, completeSessionCompatibilityRead,
  getSessionCompatibilitySnapshot, isSessionExecutionBlocked } from "@services/chat/sessionExecutionCompatibility"
import { useSessionVersionMigration } from "./useSessionVersionMigration"

const mocks = vi.hoisted(() => ({ assess: vi.fn(), migrate: vi.fn(), getSession: vi.fn() }))
vi.mock("@services/chat/AgentService", () => ({ agentClient: { getSession: mocks.getSession } }))
vi.mock("@services/chat/sessionVersionMigration", async (original) => ({
  ...await original<typeof import("@services/chat/sessionVersionMigration")>(),
  sessionVersionMigrationClient: { assess: mocks.assess, migrate: mocks.migrate },
}))
const assessment = (id = "a") => ({ session_id: id, birth_token: "d".repeat(64),
  session_version: null, current_session_version: 2, metadata_version: 5,
  snapshot_sha256: "a".repeat(64), eligible: true, blockers: [] })
const detail = (id = "a", version = 2) => ({ session: { id, root_mode_birth_token: "d".repeat(64), execution_compatibility: {
  session_version: version, current_session_version: 2, status: "compatible", history_readable: true,
  execution_allowed: true, conflicts: [] } } })
let root: Root | null
let value: ReturnType<typeof useSessionVersionMigration>
function Pane({ id, enabled = true }: { id: string | null; enabled?: boolean }) { value = useSessionVersionMigration(id, enabled); return null }
const mount = async (id: string | null, enabled = true) => act(async () => root!.render(<Pane id={id} enabled={enabled} />))
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  mocks.assess.mockReset().mockImplementation(async (id: string) => assessment(id))
  mocks.migrate.mockReset().mockImplementation(async (intent) => ({ status: "committed", session_id: intent.sessionId,
    operation_id: intent.request.operation_id, source_version: intent.request.expected_session_version,
    target_version: intent.targetVersion, before_sha256: intent.request.expected_snapshot_sha256, after_sha256: "b".repeat(64) }))
  mocks.getSession.mockReset().mockImplementation(async (id: string) => detail(id))
  root = createRoot(document.body.appendChild(document.createElement("div")))
})
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.replaceChildren(); clearSessionCompatibilityObservations(); vi.unstubAllGlobals() })

it("does not mutate on observation and confirms completion through canonical compatibility", async () => {
  await mount("a")
  expect(mocks.migrate).not.toHaveBeenCalled()
  await act(async () => { await value.migrate() })
  expect(value.phase).toBe("committed")
  expect(mocks.migrate).toHaveBeenCalledTimes(1)
  expect(getSessionCompatibilitySnapshot("a").report?.session_version).toBe(2)
})
it("an uncertain result keeps the same operation and retries only after another explicit action", async () => {
  mocks.migrate.mockRejectedValueOnce(new Error("timeout"))
  await mount("a")
  await act(async () => { await value.migrate() })
  expect(value.phase).toBe("unconfirmed")
  const original = mocks.migrate.mock.calls[0][0]
  expect(mocks.migrate).toHaveBeenCalledTimes(1)
  await act(async () => { await value.migrate() })
  expect(mocks.migrate.mock.calls[1][0]).toEqual(original)
  expect(value.phase).toBe("committed")
})
it("a matching receipt without current canonical version stays unconfirmed", async () => {
  mocks.getSession.mockResolvedValue(detail("a", 1))
  await mount("a")
  await act(async () => { await value.migrate() })
  expect(value.phase).toBe("unconfirmed")
  expect(value.canRecover).toBe(true)
})
it("publishes a canonical execution conflict without reporting a read failure or migration success", async () => {
  const prior = beginSessionCompatibilityRead("a")
  completeSessionCompatibilityRead("a", prior, detail("a", 1))
  mocks.getSession.mockResolvedValue({ session: { ...detail("a", 99).session, execution_compatibility: {
    ...detail("a", 99).session.execution_compatibility, status: "conflict", execution_allowed: false,
    conflicts: [{ code: "unsupported_session_version", message: "A newer behavior version was observed" }] } } })
  await mount("a")
  await act(async () => { await value.migrate() })
  expect(isSessionExecutionBlocked("a")).toBe(true)
  expect(getSessionCompatibilitySnapshot("a")).toMatchObject({ report: { status: "conflict", session_version: 99 },
    loading: false, readError: false })
  expect(value.phase).toBe("unconfirmed")
  expect(value.canRecover).toBe(true)
  expect(mocks.migrate).toHaveBeenCalledTimes(1)
})
it.each(["foreign", "invalid"])("a %s canonical read cannot publish compatibility or confirm migration", async (mode) => {
  const prior = beginSessionCompatibilityRead("a")
  completeSessionCompatibilityRead("a", prior, detail("a", 1))
  mocks.getSession.mockResolvedValue(mode === "foreign" ? detail("other") : {
    session: { ...detail().session, execution_compatibility: { status: "conflict", execution_allowed: false } } })
  await mount("a")
  await act(async () => { await value.migrate() })
  expect(getSessionCompatibilitySnapshot("a").report?.session_version).toBe(1)
  expect(getSessionCompatibilitySnapshot("a").readError).toBe(true)
  expect(getSessionCompatibilitySnapshot("other").observed).toBe(false)
  expect(value.phase).toBe("unconfirmed")
  expect(value.canRecover).toBe(true)
  expect(mocks.migrate).toHaveBeenCalledTimes(1)
})
it("a typed refusal during readback cannot erase an already acknowledged migration intent", async () => {
  mocks.getSession.mockRejectedValueOnce(new ApiError("pending", 409, "Conflict", "{}"))
    .mockResolvedValueOnce(detail())
  await mount("a")
  await act(async () => { await value.migrate() })
  const original = mocks.migrate.mock.calls[0][0]
  expect(value.phase).toBe("unconfirmed")
  expect(value.canRecover).toBe(true)
  expect(mocks.assess).toHaveBeenCalledTimes(1)
  await act(async () => { await value.migrate() })
  expect(mocks.migrate.mock.calls[1][0]).toEqual(original)
  expect(value.phase).toBe("committed")
})
it("a same-ID replacement cannot claim preserved-history success for the original lifetime", async () => {
  mocks.getSession.mockResolvedValue({ session: { ...detail().session, root_mode_birth_token: "e".repeat(64) } })
  await mount("a")
  await act(async () => { await value.migrate() })
  expect(value.phase).toBe("unconfirmed")
  expect(value.canRecover).toBe(true)
  expect(getSessionCompatibilitySnapshot("a")).toMatchObject({ report: { session_version: 2 }, readError: false })
})
it("a newer canonical observation supersedes delayed migration readback without losing the original intent", async () => {
  let finish!: (result: unknown) => void
  mocks.getSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await mount("a")
  let operation!: Promise<void>
  await act(async () => { operation = value.migrate() })
  const intent = mocks.migrate.mock.calls[0][0]
  const newer = beginSessionCompatibilityRead("a")
  expect(completeSessionCompatibilityRead("a", newer, { session: { ...detail().session,
    root_mode_birth_token: "e".repeat(64) } })).toBe(true)
  await act(async () => { finish({ session: { ...detail("a", 99).session, execution_compatibility: {
    ...detail("a", 99).session.execution_compatibility, status: "conflict", execution_allowed: false,
    conflicts: [{ code: "unsupported_session_version", message: "Superseded conflict" }] } } }); await operation })
  expect(value.phase).toBe("unconfirmed")
  expect(value.canRecover).toBe(true)
  expect(mocks.migrate.mock.calls[0][0]).toEqual(intent)
  expect(getSessionCompatibilitySnapshot("a")).toMatchObject({ report: { session_version: 2, status: "compatible" }, readError: false })
})
it("Child readback without a Root token uses the server's focused lifetime witness", async () => {
  mocks.getSession.mockResolvedValue({ session: { ...detail().session, root_mode_birth_token: undefined } })
  mocks.assess.mockResolvedValueOnce(assessment()).mockResolvedValueOnce({ ...assessment(), session_version: 2,
    eligible: false, blockers: [{ code: "already_current", message: "Current" }] })
  await mount("a")
  await act(async () => { await value.migrate() })
  expect(value.phase).toBe("committed")
  expect(mocks.assess).toHaveBeenCalledTimes(2)
})
it("a newer compatibility read during Child lifetime verification prevents migration success", async () => {
  let finish!: (result: unknown) => void
  mocks.getSession.mockResolvedValue({ session: { ...detail().session, root_mode_birth_token: undefined } })
  mocks.assess.mockResolvedValueOnce(assessment()).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await mount("a")
  let operation!: Promise<void>
  await act(async () => { operation = value.migrate() })
  expect(getSessionCompatibilitySnapshot("a").report?.session_version).toBe(2)
  const newer = beginSessionCompatibilityRead("a")
  completeSessionCompatibilityRead("a", newer, { session: { ...detail("a", 99).session, execution_compatibility: {
    ...detail("a", 99).session.execution_compatibility, status: "conflict", execution_allowed: false,
    conflicts: [{ code: "unsupported_session_version", message: "Newer conflict" }] } } })
  await act(async () => { finish({ ...assessment(), session_version: 2 }); await operation })
  expect(isSessionExecutionBlocked("a")).toBe(true)
  expect(getSessionCompatibilitySnapshot("a").readError).toBe(false)
  expect(value.phase).toBe("unconfirmed")
  expect(value.canRecover).toBe(true)
})
it("CAS refusal refreshes readiness and does not resend the rejected operation", async () => {
  mocks.migrate.mockRejectedValue(new ApiError("changed", 412, "Precondition Failed", "{}"))
  mocks.assess.mockResolvedValueOnce(assessment()).mockResolvedValueOnce({ ...assessment(), eligible: false,
    blockers: [{ code: "busy", message: "Session is running" }] })
  await mount("a")
  await act(async () => { await value.migrate() })
  expect(value.phase).toBe("error")
  expect(value.assessment?.eligible).toBe(false)
  expect(value.canRecover).toBe(false)
  expect(mocks.migrate).toHaveBeenCalledTimes(1)
  expect(mocks.assess).toHaveBeenCalledTimes(2)
})
it("late assessments and mutation receipts cannot update a different selected session", async () => {
  let finish!: (result: unknown) => void
  mocks.migrate.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await mount("a")
  let pending!: Promise<void>
  await act(async () => { pending = value.migrate() })
  const original = mocks.migrate.mock.calls[0][0]
  await mount("b")
  await act(async () => { finish({ status: "committed", session_id: "a", operation_id: original.request.operation_id,
    source_version: null, target_version: 2, before_sha256: "a".repeat(64), after_sha256: "b".repeat(64) }); await pending })
  expect(value.assessment?.session_id).toBe("b")
  expect(value.phase).toBe("idle")
  expect(mocks.getSession).not.toHaveBeenCalled()
})
it("a newer binding ignores a late readiness read", async () => {
  let finish!: (result: unknown) => void
  mocks.assess.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await mount("a"); await mount("b")
  await act(async () => { finish(assessment("a")); await Promise.resolve() })
  expect(value.assessment?.session_id).toBe("b")
})
it("does not assess or migrate an unassessed or incompatible execution binding", async () => {
  await mount("a", false)
  await act(async () => { await value.migrate() })
  expect(mocks.assess).not.toHaveBeenCalled()
  expect(mocks.migrate).not.toHaveBeenCalled()
})
it("recovers the server's exact pending operation after a new view is mounted", async () => {
  const request = { operation_id: "131cdeaf-4b8c-4815-a813-1697a2688bfa", birth_token: assessment().birth_token,
    expected_session_version: null, expected_metadata_version: 5, expected_snapshot_sha256: "a".repeat(64) }
  mocks.assess.mockResolvedValue({ ...assessment(), eligible: false,
    blockers: [{ code: "migration_pending", message: "Pending migration" }], pending_operation: request })
  await mount("a")
  expect(value.canRecover).toBe(true)
  expect(mocks.migrate).not.toHaveBeenCalled()
  await act(async () => { await value.migrate() })
  expect(mocks.migrate.mock.calls[0][0].request).toEqual(request)
  expect(value.phase).toBe("committed")
})
