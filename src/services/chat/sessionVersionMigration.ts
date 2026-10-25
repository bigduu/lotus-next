import { apiClient } from "@services/api"

export interface SessionVersionMigrationRequest {
  operation_id: string
  birth_token: string
  expected_session_version: number | null
  expected_metadata_version: number
  expected_snapshot_sha256: string
}
export interface SessionVersionMigrationAssessment {
  session_id: string
  birth_token: string
  session_version: number | null
  current_session_version: number
  metadata_version: number
  snapshot_sha256: string
  eligible: boolean
  blockers: readonly { code: string; message: string }[]
  pending_operation?: SessionVersionMigrationRequest
}
export interface SessionVersionMigrationIntent {
  sessionId: string
  targetVersion: number
  request: Readonly<SessionVersionMigrationRequest>
}
export interface SessionVersionMigrationReceipt {
  status: "committed"
  operation_id: string
  session_id: string
  source_version: number | null
  target_version: number
  before_sha256: string
  after_sha256: string
  birth_token: string
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
const revision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const version = (value: unknown): value is number => revision(value) && value <= 0xffffffff
const retainedVersion = (value: unknown): value is number | null => value === null || version(value)
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
// Opaque canonical lifetime token from Session::root_mode_birth_token.
const birth = digest
const invalid = (): never => { throw new Error("invalid_session_version_migration_response") }

function decodeRequest(value: unknown): SessionVersionMigrationRequest {
  const body = record(value)
  if (!body || !uuid(body.operation_id) || !birth(body.birth_token) || !retainedVersion(body.expected_session_version)
    || !revision(body.expected_metadata_version) || !digest(body.expected_snapshot_sha256)) return invalid()
  return { operation_id: body.operation_id, birth_token: body.birth_token, expected_session_version: body.expected_session_version,
    expected_metadata_version: body.expected_metadata_version, expected_snapshot_sha256: body.expected_snapshot_sha256 }
}

export function decodeSessionVersionMigrationAssessment(value: unknown, sessionId: string): SessionVersionMigrationAssessment {
  const body = record(value)
  if (!body || body.session_id !== sessionId || !birth(body.birth_token) || !retainedVersion(body.session_version)
    || !version(body.current_session_version) || !revision(body.metadata_version) || !digest(body.snapshot_sha256)
    || typeof body.eligible !== "boolean" || !Array.isArray(body.blockers) || body.blockers.length > 32) return invalid()
  const blockers = body.blockers.map((item: unknown) => {
    const reason = record(item)
    if (!reason || typeof reason.code !== "string" || !reason.code || typeof reason.message !== "string") return invalid()
    return { code: reason.code, message: reason.message }
  })
  if (body.eligible && blockers.length) return invalid()
  const pending = body.pending_operation == null ? undefined : decodeRequest(body.pending_operation)
  if (pending && pending.birth_token !== body.birth_token) return invalid()
  return { session_id: sessionId, birth_token: body.birth_token, session_version: body.session_version,
    current_session_version: body.current_session_version, metadata_version: body.metadata_version,
    snapshot_sha256: body.snapshot_sha256, eligible: body.eligible, blockers,
    ...(pending ? { pending_operation: pending } : {}) }
}

export function freezeSessionVersionMigrationIntent(assessment: SessionVersionMigrationAssessment, recover = false): SessionVersionMigrationIntent {
  const request = recover ? assessment.pending_operation : assessment.eligible ? {
    operation_id: crypto.randomUUID(), birth_token: assessment.birth_token,
    expected_session_version: assessment.session_version, expected_metadata_version: assessment.metadata_version,
    expected_snapshot_sha256: assessment.snapshot_sha256,
  } : null
  if (!request) return invalid()
  return Object.freeze({ sessionId: assessment.session_id, targetVersion: assessment.current_session_version,
    request: Object.freeze(decodeRequest(request)) })
}

export function decodeSessionVersionMigrationReceipt(value: unknown, intent: SessionVersionMigrationIntent): SessionVersionMigrationReceipt {
  const body = record(value)
  if (!body || body.status !== "committed" || body.session_id !== intent.sessionId || body.operation_id !== intent.request.operation_id
    || body.source_version !== intent.request.expected_session_version || body.target_version !== intent.targetVersion
    || body.before_sha256 !== intent.request.expected_snapshot_sha256 || !digest(body.after_sha256)
    || body.birth_token !== intent.request.birth_token) return invalid()
  return { status: "committed", session_id: intent.sessionId, operation_id: intent.request.operation_id,
    source_version: intent.request.expected_session_version, target_version: intent.targetVersion,
    before_sha256: body.before_sha256 as string, after_sha256: body.after_sha256, birth_token: intent.request.birth_token }
}

const endpoint = (id: string) => "sessions/" + encodeURIComponent(id) + "/version-migration"
export const sessionVersionMigrationClient = {
  async assess(sessionId: string) {
    return decodeSessionVersionMigrationAssessment(await apiClient.get<unknown>(endpoint(sessionId), { cache: "no-store" }), sessionId)
  },
  async migrate(intent: SessionVersionMigrationIntent) {
    return decodeSessionVersionMigrationReceipt(await apiClient.postOnce<unknown>(endpoint(intent.sessionId), intent.request), intent)
  },
}
