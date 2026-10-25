import { uiText, useUiLocale } from "@shared/i18n/ui"
import type { SessionExecutionCompatibilityView } from "@/hooks/useSessionExecutionCompatibility"
import { Button } from "@/components/ui/button"
import { SessionVersionMigrationAction } from "./SessionVersionMigrationAction"

const reasons = {
  unsupported_session_version: "session_compatibility_version_conflict",
  session_version_mismatch: "session_compatibility_observation_conflict",
  unsupported_runtime_state_version: "session_compatibility_runtime_conflict",
  unsupported_model_context_version: "session_compatibility_context_conflict",
} as const
export function SessionCompatibilityNotice({ state, sessionId }: { state?: SessionExecutionCompatibilityView; sessionId?: string | null }) {
  useUiLocale()
  if (!state || !state.observed && !state.readError && !state.loading) return null
  const report = state.report
  return <section className="border-b px-3 py-2 text-sm" aria-label={uiText("session_compatibility_label")}
    data-session-execution-blocked={state.blocked}>
    <p role={state.blocked ? "alert" : "status"} className={state.blocked ? "font-medium text-destructive" : "text-muted-foreground"}>
      {uiText(state.blocked ? "session_compatibility_execution_blocked" : report?.status === "legacy_compatible"
        ? "session_compatibility_legacy_compatible" : report?.status === "compatible" ? "session_compatibility_compatible"
          : state.legacy ? "session_compatibility_legacy_unassessed" : "session_compatibility_unassessed")}
    </p>
    {report ? <p className="mt-1 text-xs text-muted-foreground">{uiText("session_compatibility_versions", {
      session: report.session_version ?? uiText("session_compatibility_unmarked"), current: report.current_session_version,
    })}</p> : null}
    {state.blocked ? <>
      <p className="mt-1 text-xs">{uiText("session_compatibility_recovery")}</p>
      {report?.conflicts.map((reason, index) => <div key={`${reason.code}-${index}`} className="mt-1 text-xs">
        <p>{uiText(reasons[reason.code as keyof typeof reasons] ?? "session_compatibility_other_conflict")}</p>
        <details><summary>{uiText("session_compatibility_diagnostic")}</summary><p className="break-words">{reason.code}: {reason.message}</p></details>
      </div>)}
    </> : null}
    {state.readError ? <p role="status" className="mt-1 text-xs">{uiText("session_compatibility_read_error")}</p> : null}
    <Button size="sm" variant="ghost" disabled={state.loading} onClick={() => void state.refresh()}>
      {uiText("session_compatibility_refresh")}
    </Button>
    {sessionId ? <SessionVersionMigrationAction sessionId={sessionId}
      enabled={state.loading || state.readError || state.observed && (state.blocked || state.report?.execution_allowed === true)}
      allowNewMigration={state.observed && !state.readError && !state.blocked && state.report?.execution_allowed === true} /> : null}
  </section>
}
