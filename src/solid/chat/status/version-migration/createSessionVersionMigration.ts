import { createEffect, createMemo, createSignal, onSettled, type Accessor } from "solid-js"
import { isApiError } from "@services/api/errors"
import { agentClient } from "@services/chat/AgentService"
import {
  beginSessionCompatibilityRead, completeSessionCompatibilityRead, decodeSessionExecutionCompatibility,
  failSessionCompatibilityRead,
} from "@services/chat/sessionExecutionCompatibility"
import {
  freezeSessionVersionMigrationIntent, sessionVersionMigrationClient,
  type SessionVersionMigrationAssessment, type SessionVersionMigrationIntent, type SessionVersionMigrationReceipt,
} from "@services/chat/sessionVersionMigration"

interface MigrationState {
  assessment: SessionVersionMigrationAssessment | null
  pending: SessionVersionMigrationIntent | null
  reading: boolean
  submitting: boolean
  phase: "idle" | "committed" | "unconfirmed" | "error"
  problem: "unsupported" | "unavailable" | "rejected" | null
}

interface Visit {
  id: string | null
  revision: number
  operation: symbol | null
}

const initial: MigrationState = {
  assessment: null, pending: null, reading: false, submitting: false, phase: "idle", problem: null,
}

async function confirmMigrationReadback(intent: SessionVersionMigrationIntent, receipt: SessionVersionMigrationReceipt) {
  const { sessionId } = intent
  const revision = beginSessionCompatibilityRead(sessionId)
  let published = false
  try {
    const detail = await agentClient.getSession(sessionId)
    const report = decodeSessionExecutionCompatibility(detail.session.execution_compatibility)
    if (detail.session.id !== sessionId || !report) throw new Error("migration_readback_unconfirmed")
    if (!completeSessionCompatibilityRead(sessionId, revision, detail)) throw new Error("migration_readback_superseded")
    published = true

    // The canonical report still controls execution when a matching receipt
    // cannot prove the session's current version or identity.
    if (!report.execution_allowed || report.session_version !== receipt.target_version) throw new Error("migration_readback_unconfirmed")
    let witness = detail.session.root_mode_birth_token
    if (witness == null) {
      const observed = await sessionVersionMigrationClient.assess(sessionId)
      if (observed.session_version !== receipt.target_version) throw new Error("migration_version_changed")
      witness = observed.birth_token
    }
    if (witness !== intent.request.birth_token) throw new Error("migration_lifetime_changed")
    // A Child may have awaited a separate lifetime read, during which a
    // newer canonical compatibility observation can supersede this receipt.
    if (!completeSessionCompatibilityRead(sessionId, revision, detail)) throw new Error("migration_readback_superseded")
  } catch (error) {
    if (!published) failSessionCompatibilityRead(sessionId, revision)
    throw error
  }
}

/** Prepare and explicitly confirm server-owned session migration. */
export function createSessionVersionMigration(options: {
  sessionId: Accessor<string | null>
  enabled: Accessor<boolean>
  allowNewMigration: Accessor<boolean>
  autoAssess: Accessor<boolean>
}) {
  const visit = createMemo<Visit>(() => ({
    id: options.enabled() ? options.sessionId() : null, revision: 0, operation: null,
  }), { equals: (previous, next) => previous?.id === next.id })
  const autoAssess = createMemo(options.autoAssess)
  const [snapshot, setSnapshot] = createSignal<{ origin: Visit; state: MigrationState }>()
  let mounted = true

  onSettled(() => () => { mounted = false })
  const state = () => {
    const saved = snapshot()
    return saved?.origin === visit() ? saved.state : initial
  }
  const owns = (origin: Visit, revision: number) =>
    mounted && visit() === origin && origin.revision === revision

  function publish(origin: Visit, revision: number, changes: Partial<MigrationState>) {
    if (!owns(origin, revision)) return
    setSnapshot((previous) => ({
      origin, state: { ...(previous?.origin === origin ? previous.state : initial), ...changes },
    }))
  }

  async function assess(origin: Visit, id: string, revision: number) {
    publish(origin, revision, { reading: true, problem: null })
    try {
      const assessment = await sessionVersionMigrationClient.assess(id)
      if (!owns(origin, revision)) return
      const pending = state().pending ?? (assessment.pending_operation ? freezeSessionVersionMigrationIntent(assessment, true) : null)
      publish(origin, revision, { assessment, pending, reading: false })
    } catch (error) {
      const unsupported = isApiError(error) && (error.status === 404 || error.status === 501)
      publish(origin, revision, { reading: false, problem: unsupported ? "unsupported" : "unavailable" })
    }
  }

  createEffect(() => [visit(), autoAssess()] as const, ([origin, permitted]) => {
    if (origin.id && permitted && !origin.operation) void assess(origin, origin.id, ++origin.revision)
  })

  const canStart = () => options.allowNewMigration() && state().assessment?.eligible === true
    && !state().pending && state().problem === null

  async function refresh() {
    const origin = visit()
    if (!origin.id || origin.operation || state().reading) return
    await assess(origin, origin.id, ++origin.revision)
  }

  async function migrate() {
    const origin = visit()
    const { id, revision } = origin
    const saved = state()
    if (!id || origin.operation || saved.reading || saved.phase === "committed") return
    let intent = saved.pending
    if (!intent) {
      if (!canStart() || !saved.assessment) return
      try {
        intent = freezeSessionVersionMigrationIntent(saved.assessment)
      } catch {
        publish(origin, revision, { phase: "error", problem: "rejected" })
        return
      }
    }
    if (intent.sessionId !== id) return

    const operation = Symbol()
    origin.operation = operation
    publish(origin, revision, { pending: intent, submitting: true, problem: null })
    let acknowledged = false
    try {
      const receipt = await sessionVersionMigrationClient.migrate(intent)
      acknowledged = true
      if (!owns(origin, revision)) return
      await confirmMigrationReadback(intent, receipt)
      publish(origin, revision, { pending: null, phase: "committed", problem: null })
    } catch (error) {
      if (!owns(origin, revision)) return
      const rejected = !acknowledged && isApiError(error) && [400, 401, 403, 404, 409, 412].includes(error.status)
      if (rejected) {
        publish(origin, revision, { pending: null, phase: "error", problem: "rejected" })
        // A definitive refusal needs a fresh assessment. This never submits
        // a new migration or replaces an unconfirmed receipt with a new UUID.
        await assess(origin, id, revision)
      } else publish(origin, revision, { phase: "unconfirmed", problem: null })
    } finally {
      if (origin.operation === operation) origin.operation = null
      publish(origin, revision, { submitting: false })
    }
  }

  return { state, canStart, canRecover: () => state().pending !== null, refresh, migrate }
}
