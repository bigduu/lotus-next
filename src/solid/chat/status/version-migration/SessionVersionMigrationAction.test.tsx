import { render } from "@solidjs/web"
import { flush } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/text"
import { ApiError } from "@services/api/errors"
import { beginSessionCompatibilityRead, clearSessionCompatibilityObservations, failSessionCompatibilityRead,
  completeSessionCompatibilityRead, getSessionCompatibilitySnapshot, isSessionExecutionBlocked,
  subscribeSessionCompatibility } from "@services/chat/sessionExecutionCompatibility"
import { createExternalSnapshot } from "../../snapshots"
import { SessionCompatibilityNotice } from "../SessionCompatibilityNotice"
import { SessionVersionMigrationGate } from "./SessionVersionMigrationAction"

type SessionExecutionCompatibilityView = Parameters<typeof SessionCompatibilityNotice>[0]["state"]
function Notices(props: { state: SessionExecutionCompatibilityView }) {
  return <>
    <SessionCompatibilityNotice state={props.state} />
    <SessionVersionMigrationGate sessionId="legacy-a" state={props.state} />
  </>
}

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
let dispose: (() => void) | undefined
async function settle(action: () => unknown) {
  await action()
  for (let turn = 0; turn < 12; turn += 1) {
    await Promise.resolve()
    flush()
  }
}
async function mountView(view: Parameters<typeof render>[0]) {
  const host = document.body.appendChild(document.createElement("div"))
  dispose = render(view, host)
  await settle(() => {})
}
const mount = (blocked = false) => mountView(() => <Notices state={view(blocked)} />)
const refreshMigration = async () => settle(async () => {
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent === uiText("session_migration_refresh"))!
  expect(button).toBeDefined()
  button.click()
})
function SubscribedNotice() {
  const snapshot = createExternalSnapshot(subscribeSessionCompatibility, () => getSessionCompatibilitySnapshot("legacy-a"))
  return <Notices state={{ ...snapshot(), blocked: snapshot().report?.status === "conflict", refresh: async () => {} }} />
}
beforeEach(() => {
  mocks.assess.mockReset().mockResolvedValue(assessment)
  mocks.migrate.mockReset().mockImplementation(async (intent) => ({ status: "committed", session_id: intent.sessionId,
    operation_id: intent.request.operation_id, source_version: null, target_version: 2,
    before_sha256: "a".repeat(64), after_sha256: "b".repeat(64) }))
  mocks.getSession.mockReset()
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  clearSessionCompatibilityObservations()
})

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
  await settle(async () => button.click())
  expect(mocks.migrate).toHaveBeenCalledTimes(1)
  expect(mocks.migrate.mock.calls[0][0].sessionId).toBe("legacy-a")
  expect(document.body.textContent).not.toContain(uiText("session_migration_completed"))
  expect(button.disabled).toBe(true)
  await settle(async () => { finish({ session: { id: "legacy-a", root_mode_birth_token: "d".repeat(64), execution_compatibility: { session_version: 2,
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
it("reads a conflicting Session only on explicit recovery and never starts a new migration", async () => {
  await mount(true)
  expect(mocks.assess).not.toHaveBeenCalled()
  await refreshMigration()
  expect(mocks.assess).toHaveBeenCalledTimes(1)
  expect(mocks.migrate).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain(uiText("session_compatibility_execution_blocked"))
  expect(document.body.textContent).not.toContain(uiText("session_migration_action"))
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
  await mountView(() => <Notices state={cold} />)
  expect(mocks.assess).not.toHaveBeenCalled()
  await refreshMigration()
  expect(mocks.assess).toHaveBeenCalledTimes(1)
  expect(mocks.migrate).not.toHaveBeenCalled()
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent === uiText("session_migration_confirm_result"))!
  expect(button).toBeDefined()
  await settle(async () => button.click())
  expect(mocks.migrate.mock.calls[0][0].request).toEqual(request)
  expect(document.body.textContent).toContain(uiText("session_migration_completed"))
})
it("a cold detail failure cannot start a new operation from readiness alone", async () => {
  const cold: SessionExecutionCompatibilityView = { ...view(), observed: false, report: null, readError: true }
  await mountView(() => <Notices state={cold} />)
  expect(mocks.assess).not.toHaveBeenCalled()
  await refreshMigration()
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
  await mountView(() => <SubscribedNotice />)
  await refreshMigration()
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent === uiText("session_migration_confirm_result"))!
  await settle(async () => button.click())
  expect(getSessionCompatibilitySnapshot("legacy-a").loading).toBe(true)
  expect(document.querySelector('[data-testid="session-version-migration"]')).not.toBeNull()
  await settle(async () => { rejectRead(new ApiError("still pending", 409, "Conflict", "{}")); await Promise.resolve() })
  expect(document.body.textContent).toContain(uiText("session_migration_unconfirmed"))
  expect(document.body.textContent).toContain(uiText("session_migration_confirm_result"))
  expect(mocks.migrate).toHaveBeenCalledTimes(1)
  expect(mocks.migrate.mock.calls[0][0].request).toEqual(request)
})
it("a subscribed canonical conflict blocks execution and preserves only manual recovery of the existing intent", async () => {
  const ticket = beginSessionCompatibilityRead("legacy-a")
  completeSessionCompatibilityRead("legacy-a", ticket, { session: { id: "legacy-a", execution_compatibility: view().report } })
  mocks.getSession.mockResolvedValue({ session: { id: "legacy-a", root_mode_birth_token: assessment.birth_token,
    execution_compatibility: { ...view(true).report, conflicts: [{ code: "unsupported_session_version", message: "Future version" }] } } })
  await mountView(() => <SubscribedNotice />)
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent === uiText("session_migration_action"))!
  await settle(async () => button.click())
  expect(isSessionExecutionBlocked("legacy-a")).toBe(true)
  expect(getSessionCompatibilitySnapshot("legacy-a")).toMatchObject({ report: { status: "conflict", session_version: 99 }, readError: false, loading: false })
  expect(document.body.textContent).toContain(uiText("session_migration_unconfirmed"))
  expect(document.body.textContent).not.toContain(uiText("session_migration_completed"))
  expect(document.body.textContent).not.toContain(uiText("session_compatibility_read_error"))
  expect([...document.querySelectorAll("button")].some((node) => node.textContent === uiText("session_migration_action"))).toBe(false)
  expect(mocks.migrate).toHaveBeenCalledTimes(1)
  const intent = mocks.migrate.mock.calls[0][0]
  const recover = [...document.querySelectorAll("button")].find((node) => node.textContent === uiText("session_migration_confirm_result"))!
  expect(recover).toBeDefined()
  await settle(async () => recover.click())
  expect(mocks.migrate).toHaveBeenCalledTimes(2)
  expect(mocks.migrate.mock.calls[1][0]).toEqual(intent)
  expect(isSessionExecutionBlocked("legacy-a")).toBe(true)
  expect(getSessionCompatibilitySnapshot("legacy-a").readError).toBe(false)
  expect(document.body.textContent).toContain(uiText("session_migration_unconfirmed"))
})

it.each(["loading", "unknown", "current", "read-error"] as const)("does not automatically assess %s Sessions and hides idle controls unless recovery is needed", async (kind) => {
  const state: SessionExecutionCompatibilityView = kind === "current" ? { ...view(), report: {
    ...view().report!, session_version: 2, status: "compatible" } } : { ...view(), report: null,
    observed: kind === "unknown", loading: kind === "loading", readError: kind === "read-error" }
  await mountView(() => <Notices state={state} />)
  expect(mocks.assess).not.toHaveBeenCalled()
  expect(mocks.migrate).not.toHaveBeenCalled()
  if (kind === "read-error") {
    await refreshMigration()
    expect(mocks.assess).toHaveBeenCalledTimes(1)
  } else {
    expect(document.querySelector('[data-testid="session-version-migration"]')).toBeNull()
    expect(document.body.textContent).toBe("")
  }
  expect(document.body.textContent).not.toContain(uiText("session_migration_action"))
  expect(mocks.migrate).not.toHaveBeenCalled()
})

it("loading followed by canonical current-v2 and permission refreshes never probes migration authority", async () => {
  const ticket = beginSessionCompatibilityRead("legacy-a")
  await mountView(() => <SubscribedNotice />)
  const current = { session: { id: "legacy-a", session_version: 2, execution_compatibility: {
    ...view().report!, session_version: 2, status: "compatible" } } }
  await settle(async () => { completeSessionCompatibilityRead("legacy-a", ticket, current) })
  for (const permission_mode of ["default", "auto", "default"]) {
    await settle(async () => {
      const refresh = beginSessionCompatibilityRead("legacy-a")
      completeSessionCompatibilityRead("legacy-a", refresh, { session: { ...current.session, permission_mode } })
    })
  }
  expect(mocks.assess).not.toHaveBeenCalled()
  expect(mocks.migrate).not.toHaveBeenCalled()
})

it("subscribed canonical current-v2 does not reset the acknowledged intent while Child lifetime confirmation is pending", async () => {
  const ticket = beginSessionCompatibilityRead("legacy-a")
  completeSessionCompatibilityRead("legacy-a", ticket, { session: { id: "legacy-a", execution_compatibility: view().report } })
  let finishLifetime!: (value: unknown) => void
  mocks.assess.mockResolvedValueOnce(assessment)
    .mockImplementationOnce(() => new Promise((resolve) => { finishLifetime = resolve }))
  mocks.getSession.mockResolvedValue({ session: { id: "legacy-a", execution_compatibility: {
    ...view().report!, session_version: 2, status: "compatible" } } })
  await mountView(() => <SubscribedNotice />)
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent === uiText("session_migration_action"))!
  await settle(async () => button.click())
  expect(getSessionCompatibilitySnapshot("legacy-a").report?.session_version).toBe(2)
  expect(mocks.assess).toHaveBeenCalledTimes(2)
  expect(document.body.textContent).not.toContain(uiText("session_migration_completed"))
  expect(document.body.textContent).toContain(uiText("session_migration_in_progress"))
  const intent = mocks.migrate.mock.calls[0][0]
  await settle(async () => { finishLifetime({ ...assessment, session_version: 2, eligible: false }); await Promise.resolve() })
  expect(document.querySelector('[data-testid="session-version-migration"]')).toBeNull()
  expect(document.body.textContent).toBe("")
  expect(mocks.migrate).toHaveBeenCalledTimes(1)
  expect(mocks.migrate.mock.calls[0][0]).toEqual(intent)
  expect(mocks.assess).toHaveBeenCalledTimes(2)
})
