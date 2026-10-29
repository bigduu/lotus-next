import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useSessionVersionMigration } from "@/hooks/useSessionVersionMigration"
import { Button } from "@/components/ui/button"

export function SessionVersionMigrationAction({ sessionId, enabled, allowNewMigration = true, autoAssess = allowNewMigration, hideIdle = false, className = "" }: {
  sessionId: string; enabled: boolean; allowNewMigration?: boolean; autoAssess?: boolean; hideIdle?: boolean; className?: string
}) {
  useUiLocale()
  const migration = useSessionVersionMigration(sessionId, enabled, allowNewMigration, autoAssess)
  if (!enabled || migration.problem === "unsupported") return null
  const needsAttention = migration.reading || migration.submitting || migration.canRecover
    || migration.phase === "unconfirmed" || migration.phase === "error" || migration.problem !== null
  if (hideIdle && (migration.phase === "committed" || !needsAttention)) return null
  const blockers = migration.assessment?.blockers.filter((reason) => reason.code !== "already_current") ?? []
  return <div className={`mt-2 space-y-1 text-xs ${className}`} data-testid="session-version-migration">
    {migration.phase === "committed" ? <p role="status">{uiText("session_migration_completed")}</p> : <>
      {migration.canStart ? <p className="text-muted-foreground">{uiText("session_migration_preserves_context")}</p> : null}
      {migration.phase === "unconfirmed" ? <p role="status">{uiText("session_migration_unconfirmed")}</p> : null}
      {migration.problem || migration.phase === "error" ? <p role="status">{uiText(migration.phase === "error" ? "session_migration_rejected" : "session_migration_read_error")}</p> : null}
      {blockers.length ? <details><summary>{uiText("session_migration_blocked")}</summary>
        <ul className="mt-1 space-y-1">{blockers.map((reason, index) => <li key={reason.code + index}>{reason.message}</li>)}</ul>
      </details> : null}
      <div className="flex flex-wrap gap-2">
        {migration.canStart || migration.canRecover ? <Button size="sm" variant="outline"
          disabled={migration.reading || migration.submitting} onClick={() => void migration.migrate()}>
          {uiText(migration.submitting ? "session_migration_in_progress" : migration.canRecover ? "session_migration_confirm_result" : "session_migration_action")}
        </Button> : null}
        <Button size="sm" variant="ghost" disabled={migration.reading || migration.submitting} onClick={() => void migration.refresh()}>
          {uiText("session_migration_refresh")}
        </Button>
      </div>
    </>}
  </div>
}
