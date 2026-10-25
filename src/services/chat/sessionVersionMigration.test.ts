import { beforeEach, describe, expect, it, vi } from "vitest"
import { decodeSessionVersionMigrationAssessment, decodeSessionVersionMigrationReceipt,
  freezeSessionVersionMigrationIntent, sessionVersionMigrationClient } from "./sessionVersionMigration"

const mocks = vi.hoisted(() => ({ get: vi.fn(), postOnce: vi.fn() }))
vi.mock("@services/api", () => ({ apiClient: mocks }))
const uuid = "131cdeaf-4b8c-4815-a813-1697a2688bfa"
const assessment = () => ({ session_id: "legacy-a", birth_token: "d".repeat(64),
  session_version: null, current_session_version: 2, metadata_version: 5,
  snapshot_sha256: "a".repeat(64), eligible: true, blockers: [] })
const intent = () => ({ sessionId: "legacy-a", targetVersion: 2, request: {
  operation_id: uuid, birth_token: assessment().birth_token, expected_session_version: null,
  expected_metadata_version: 5, expected_snapshot_sha256: "a".repeat(64) } })
const receipt = () => ({ status: "committed", operation_id: uuid, session_id: "legacy-a", source_version: null,
  target_version: 2, before_sha256: "a".repeat(64), after_sha256: "b".repeat(64), birth_token: "d".repeat(64) })
beforeEach(() => { mocks.get.mockReset(); mocks.postOnce.mockReset() })

describe("server-owned Session migration", () => {
  it("uses server eligibility and freezes all original CAS fields", () => {
    const observed = decodeSessionVersionMigrationAssessment(assessment(), "legacy-a")
    const frozen = freezeSessionVersionMigrationIntent(observed)
    expect(frozen.request).toMatchObject({ birth_token: observed.birth_token, expected_session_version: null,
      expected_metadata_version: 5, expected_snapshot_sha256: observed.snapshot_sha256 })
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.request)).toBe(true)
    expect(() => freezeSessionVersionMigrationIntent({ ...observed, eligible: false })).toThrow()
  })
  it("recovers only the exact owner-visible pending operation", () => {
    const observed = decodeSessionVersionMigrationAssessment({ ...assessment(), eligible: false,
      blockers: [{ code: "migration_pending", message: "Pending operation" }], pending_operation: intent().request }, "legacy-a")
    expect(freezeSessionVersionMigrationIntent(observed, true)).toEqual(intent())
    expect(() => decodeSessionVersionMigrationAssessment({ ...assessment(), pending_operation: {
      ...intent().request, birth_token: "e".repeat(64) } }, "legacy-a")).toThrow()
  })
  it.each([
    { session_id: "other" }, { metadata_version: -1 }, { snapshot_sha256: "bad" },
    { eligible: true, blockers: [{ code: "busy", message: "Running" }] }, { blockers: [{}] },
    { birth_token: "2026-10-14T15:57:09.149101Z" },
  ])("rejects malformed or foreign readiness %j", (change) => {
    expect(() => decodeSessionVersionMigrationAssessment({ ...assessment(), ...change }, "legacy-a")).toThrow()
  })
  it.each([
    { session_id: "other" }, { operation_id: "other" }, { source_version: 1 },
    { target_version: 3 }, { before_sha256: "c".repeat(64) }, { status: "accepted" }, { after_sha256: "bad" },
    { birth_token: "e".repeat(64) }, { birth_token: undefined },
  ])("does not turn an unrelated or admitted receipt into success %j", (change) => {
    expect(() => decodeSessionVersionMigrationReceipt({ ...receipt(), ...change }, intent())).toThrow()
  })
  it("sends an exact POST once and never uses a generic retrying mutation", async () => {
    mocks.postOnce.mockResolvedValue(receipt())
    expect(await sessionVersionMigrationClient.migrate(intent())).toEqual(receipt())
    expect(mocks.postOnce).toHaveBeenCalledExactlyOnceWith("sessions/legacy-a/version-migration", intent().request)
    mocks.postOnce.mockRejectedValue(new Error("connection interrupted"))
    await expect(sessionVersionMigrationClient.migrate(intent())).rejects.toThrow("connection interrupted")
    expect(mocks.postOnce).toHaveBeenCalledTimes(2)
  })
})
