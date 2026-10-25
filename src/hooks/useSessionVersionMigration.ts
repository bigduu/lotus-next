import { useCallback, useEffect, useRef, useState } from "react"
import { isApiError } from "@services/api"
import { agentClient } from "@services/chat/AgentService"
import { beginSessionCompatibilityRead, completeSessionCompatibilityRead, decodeSessionExecutionCompatibility,
  failSessionCompatibilityRead } from "@services/chat/sessionExecutionCompatibility"
import { freezeSessionVersionMigrationIntent, sessionVersionMigrationClient,
  type SessionVersionMigrationAssessment, type SessionVersionMigrationIntent } from "@services/chat/sessionVersionMigration"

interface MigrationState {
  assessment: SessionVersionMigrationAssessment | null
  reading: boolean
  submitting: boolean
  phase: "idle" | "committed" | "unconfirmed" | "error"
  problem: "unsupported" | "unavailable" | "rejected" | null
}
const initial: MigrationState = { assessment: null, reading: false, submitting: false, phase: "idle", problem: null }

/** A transient owner action; canonical migration state lives only in Bamboo. */
export function useSessionVersionMigration(sessionId: string | null, enabled: boolean, allowNewMigration = true) {
  const [state, setState] = useState<MigrationState>(initial)
  const scope = useRef({ sessionId, enabled })
  scope.current = { sessionId, enabled }
  const generation = useRef(0)
  const activeOperation = useRef<symbol | null>(null)
  const pending = useRef<SessionVersionMigrationIntent | null>(null)
  const current = useCallback((id: string, revision: number) => scope.current.enabled
    && scope.current.sessionId === id && generation.current === revision, [])
  const invalidate = useCallback(() => { ++generation.current }, [])

  const read = useCallback(async (id: string, revision: number) => {
    setState((previous) => ({ ...previous, reading: true, problem: null }))
    try {
      const assessment = await sessionVersionMigrationClient.assess(id)
      if (!current(id, revision)) return
      if (!pending.current && assessment.pending_operation) {
        pending.current = freezeSessionVersionMigrationIntent(assessment, true)
      }
      setState((previous) => ({ ...previous, assessment, reading: false }))
    } catch (error) {
      if (!current(id, revision)) return
      setState((previous) => ({ ...previous, reading: false,
        problem: isApiError(error) && (error.status === 404 || error.status === 501) ? "unsupported" : "unavailable" }))
    }
  }, [current])

  useEffect(() => {
    const revision = ++generation.current
    pending.current = null
    activeOperation.current = null
    setState(initial)
    if (enabled && sessionId) void read(sessionId, revision)
    return invalidate
  }, [sessionId, enabled, read, invalidate])

  const refresh = useCallback(async () => {
    if (!sessionId || !enabled || activeOperation.current) return
    await read(sessionId, ++generation.current)
  }, [sessionId, enabled, read])

  const migrate = useCallback(async () => {
    if (!sessionId || !enabled || activeOperation.current || state.reading || state.phase === "committed") return
    let intent = pending.current
    if (!intent) {
      if (!allowNewMigration || !state.assessment?.eligible) return
      intent = freezeSessionVersionMigrationIntent(state.assessment)
      pending.current = intent
    }
    if (intent.sessionId !== sessionId) return
    const revision = generation.current, operation = Symbol()
    activeOperation.current = operation
    setState((previous) => ({ ...previous, submitting: true, problem: null }))
    let acknowledged = false
    try {
      const receipt = await sessionVersionMigrationClient.migrate(intent)
      acknowledged = true
      if (!current(sessionId, revision)) return
      // A matching durable receipt is followed by a canonical compatibility
      // read. An admitted request alone never becomes a success message.
      const compatibilityRead = beginSessionCompatibilityRead(sessionId)
      try {
        const detail = await agentClient.getSession(sessionId)
        const report = decodeSessionExecutionCompatibility(detail.session.execution_compatibility)
        if (detail.session.id !== sessionId || !report || !report.execution_allowed
          || report.session_version !== receipt.target_version) throw new Error("migration_readback_unconfirmed")
        // Root detail already carries its lifetime witness. Child detail may
        // omit it; the focused owner assessment supplies the same canonical
        // witness without deriving it from version numbers or creation dates.
        let witness = detail.session.root_mode_birth_token
        if (witness == null) {
          const observation = await sessionVersionMigrationClient.assess(sessionId)
          if (observation.session_version !== receipt.target_version) throw new Error("migration_version_changed")
          witness = observation.birth_token
        }
        if (witness !== intent.request.birth_token) throw new Error("migration_lifetime_changed")
        if (!completeSessionCompatibilityRead(sessionId, compatibilityRead, detail)) throw new Error("migration_readback_superseded")
      } catch (error) {
        failSessionCompatibilityRead(sessionId, compatibilityRead)
        throw error
      }
      if (!current(sessionId, revision)) return
      pending.current = null
      setState((previous) => ({ ...previous, phase: "committed", problem: null }))
    } catch (error) {
      if (!current(sessionId, revision)) return
      const rejected = !acknowledged && isApiError(error) && [400, 401, 403, 404, 409, 412].includes(error.status)
      if (rejected) pending.current = null
      setState((previous) => ({ ...previous, phase: rejected ? "error" : "unconfirmed",
        problem: rejected ? "rejected" : null }))
      // Rejected intents require a fresh canonical assessment. Never retry a
      // mutation automatically; uncertain outcomes retain the exact UUID/CAS.
      if (rejected) await read(sessionId, revision)
    } finally {
      if (activeOperation.current === operation) activeOperation.current = null
      if (current(sessionId, revision)) setState((previous) => ({ ...previous, submitting: false }))
    }
  }, [sessionId, enabled, allowNewMigration, state.assessment, state.reading, state.phase, current, read])

  return { ...state, canStart: allowNewMigration && state.assessment?.eligible === true,
    canRecover: pending.current !== null, refresh, migrate }
}
