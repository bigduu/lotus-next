import { act, useSyncExternalStore } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/ui"
import { ApiError } from "@services/api/errors"
import { beginSessionCompatibilityRead, clearSessionCompatibilityObservations, failSessionCompatibilityRead,
  getSessionCompatibilitySnapshot, subscribeSessionCompatibility } from "@services/chat/sessionExecutionCompatibility"
import type { SessionExecutionCompatibilityView } from "@/hooks/useSessionExecutionCompatibility"
import { SessionCompatibilityNotice } from "./SessionCompatibilityNotice"

const mocks = vi.hoisted(() => ({ assess: vi.fn(), migrate: vi.fn(), getSession: vi.fn() }))
vi.mock("@services/chat/AgentService", () => ({ agentClient: { getSession: mocks.getSession } }))
vi.mock("@services/chat/sessionVersionMigration", async (original) => ({
  ...await original<typeof import("@services/chat/sessionVersionMigration")>(),
  sessionVersionMigrationClient: { assess: mocks.assess, migrate: mocks.migrate },
}))
const assessment = { session_id: "legacy-a", birth_token: "d".repeat(64), session_version: null,
  current_session_version: 2, metadata_version: 5, snapshot_sha256: "a".repeat(64), eligible: true, blockers: [] }
const view = (blocked = false): SessionExecutionCompatibilityView => ({ observed: true, legacy: false, loading: false,
  readError: false, blocked, refresh: vi.fn(async () => {}), report: { session_version: blocked ? 99 : null,
    current_session_version: 2, status: blocked ? "conflict" : "legacy_compatible", history_readable: true,
    execution_allowed: !blocked, conflicts: [] } })
let root: Root | null
const mount = async (blocked = false) => act(async () => root!.render(<SessionCompatibilityNotice sessionId="legacy-a" state={view(blocked)} />))
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  mocks.assess.mockReset().mockResolvedValue(assessment)
  mocks.migrate.mockReset().mockImplementation(async (intent) => ({ status: "committed", session_id: intent.sessionId,
    operation_id: intent.request.operation_id, source_version: null, target_version: 2,
    before_sha256: "a".repeat(64), after_sha256: "b".repeat(64) }))
  mocks.getSession.mockReset()
  root = createRoot(document.body.appendChild(document.createElement("div")))
})
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.replaceChildren(); clearSessionCompatibilityObservations(); vi.unstubAllGlobals() })

it("offers explicit migration while retaining the compatible legacy message and performs no automatic write", async () => {
  await mount()
  expect(document.body.textContent).toContain(uiText("session_compatibility_legacy_compatible"))
  expect(document.body.textContent).toContain(uiText("session_migration_action"))
  expect(mocks.migrate).not.toHaveBeenCalled()
})
it("keeps the action pending until a matching receipt is followed by canonical current state", async () => {
  let finish!: (value: unknown) => void
  mocks.getSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await mount()
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent === uiText("session_migration_action"))!
  await act(async () => button.click())
  expect(mocks.migrate).toHaveBeenCalledTimes(1)
  expect(mocks.migrate.mock.calls[0][0].sessionId).toBe("legacy-a")
  expect(document.body.textContent).not.toContain(uiText("session_migration_completed"))
  expect(button.disabled).toBe(true)
  await act(async () => { finish({ session: { id: "legacy-a", root_mode_birth_token: "d".repeat(64), execution_compatibility: { session_version: 2,
    current_session_version: 2, status: "compatible", history_readable: true, execution_allowed: true, conflicts: [] } } }); await Promise.resolve() })
  expect(document.body.textContent).toContain(uiText("session_migration_completed"))
})
it("older backends leave legacy continuation intact without a nonfunctional migration action", async () => {
  mocks.assess.mockRejectedValue(new ApiError("unsupported", 404, "Not Found", "{}"))
  await mount()
  expect(document.body.textContent).toContain(uiText("session_compatibility_legacy_compatible"))
  expect(document.querySelector('[data-testid="session-version-migration"]')).toBeNull()
  expect(mocks.migrate).not.toHaveBeenCalled()
})
it("never offers migration for an execution-conflicting approval or Session binding", async () => {
  await mount(true)
  expect(mocks.assess).not.toHaveBeenCalled()
  expect(mocks.migrate).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain(uiText("session_compatibility_execution_blocked"))
})
it("a cold detail failure still exposes read-only recovery of the server's exact pending migration", async () => {
  const request = { operation_id: "131cdeaf-4b8c-4815-a813-1697a2688bfa", birth_token: assessment.birth_token,
    expected_session_version: null, expected_metadata_version: 5, expected_snapshot_sha256: "a".repeat(64) }
  mocks.assess.mockResolvedValue({ ...assessment, eligible: false,
    blockers: [{ code: "migration_pending", message: "Pending migration" }], pending_operation: request })
  mocks.getSession.mockResolvedValue({ session: { id: "legacy-a", root_mode_birth_token: assessment.birth_token,
    execution_compatibility: { session_version: 2, current_session_version: 2, status: "compatible",
      history_readable: true, execution_allowed: true, conflicts: [] } } })
  const cold: SessionExecutionCompatibilityView = { ...view(), observed: false, report: null, readError: true }
  await act(async () => root!.render(<SessionCompatibilityNotice sessionId="legacy-a" state={cold} />))
  expect(mocks.assess).toHaveBeenCalledTimes(1)
  expect(mocks.migrate).not.toHaveBeenCalled()
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent === uiText("session_migration_confirm_result"))!
  expect(button).toBeDefined()
  await act(async () => button.click())
  expect(mocks.migrate.mock.calls[0][0].request).toEqual(request)
  expect(document.body.textContent).toContain(uiText("session_migration_completed"))
})
it("a cold detail failure cannot start a new operation from readiness alone", async () => {
  const cold: SessionExecutionCompatibilityView = { ...view(), observed: false, report: null, readError: true }
  await act(async () => root!.render(<SessionCompatibilityNotice sessionId="legacy-a" state={cold} />))
  expect(mocks.assess).toHaveBeenCalledTimes(1)
  expect(mocks.migrate).not.toHaveBeenCalled()
  expect(document.body.textContent).not.toContain(uiText("session_migration_action"))
})
it("subscribed cold recovery stays mounted through loading and retains its exact acknowledged request on readback failure", async () => {
  const request = { operation_id: "131cdeaf-4b8c-4815-a813-1697a2688bfa", birth_token: assessment.birth_token,
    expected_session_version: null, expected_metadata_version: 5, expected_snapshot_sha256: "a".repeat(64) }
  mocks.assess.mockResolvedValue({ ...assessment, eligible: false,
    blockers: [{ code: "migration_pending", message: "Pending migration" }], pending_operation: request })
  let rejectRead!: (failure: unknown) => void
  mocks.getSession.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject }))
  const ticket = beginSessionCompatibilityRead("legacy-a")
  failSessionCompatibilityRead("legacy-a", ticket)
  function SubscribedNotice() {
    const snapshot = useSyncExternalStore(subscribeSessionCompatibility,
      () => getSessionCompatibilitySnapshot("legacy-a"), () => getSessionCompatibilitySnapshot(null))
    return <SessionCompatibilityNotice sessionId="legacy-a" state={{ ...snapshot,
      blocked: snapshot.report?.status === "conflict", refresh: async () => {} }} />
  }
  await act(async () => root!.render(<SubscribedNotice />))
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent === uiText("session_migration_confirm_result"))!
  await act(async () => button.click())
  expect(getSessionCompatibilitySnapshot("legacy-a").loading).toBe(true)
  expect(document.querySelector('[data-testid="session-version-migration"]')).not.toBeNull()
  await act(async () => { rejectRead(new ApiError("still pending", 409, "Conflict", "{}")); await Promise.resolve() })
  expect(document.body.textContent).toContain(uiText("session_migration_unconfirmed"))
  expect(document.body.textContent).toContain(uiText("session_migration_confirm_result"))
  expect(mocks.migrate).toHaveBeenCalledTimes(1)
  expect(mocks.migrate.mock.calls[0][0].request).toEqual(request)
})
