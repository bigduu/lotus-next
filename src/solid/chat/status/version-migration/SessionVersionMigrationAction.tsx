import { For, Show } from "solid-js"
import { createUiText } from "../../../shell/uiText"
import { Button } from "../../../ui/button"
import type { createSessionExecutionCompatibility } from "../../observation"
import { createSessionVersionMigration } from "./createSessionVersionMigration"

export function SessionVersionMigrationAction(props: {
  sessionId: string
  enabled: boolean
  allowNewMigration?: boolean
  autoAssess?: boolean
  hideIdle?: boolean
  class?: string
}) {
  const text = createUiText()
  const migration = createSessionVersionMigration({
    sessionId: () => props.sessionId,
    enabled: () => props.enabled,
    allowNewMigration: () => props.allowNewMigration ?? true,
    autoAssess: () => props.autoAssess ?? props.allowNewMigration ?? true,
  })
  const { state, canStart, canRecover } = migration
  const needsAttention = () => state().reading || state().submitting || canRecover()
    || state().phase === "unconfirmed" || state().phase === "error" || state().problem !== null
  const visible = () => props.enabled && (state().problem !== "unsupported" || canRecover())
    && (!props.hideIdle || (state().phase !== "committed" && needsAttention()))
  const blockers = () => state().assessment?.blockers.filter((reason) => reason.code !== "already_current") ?? []
  const busy = () => state().reading || state().submitting

  return <Show when={visible()}>
    <div class={`mt-2 space-y-1 text-xs ${props.class ?? ""}`} data-testid="session-version-migration">
      <Show when={state().phase !== "committed"} fallback={<p role="status">{text("session_migration_completed")}</p>}>
        <Show when={canStart()}><p class="text-muted-foreground">{text("session_migration_preserves_context")}</p></Show>
        <Show when={state().phase === "unconfirmed"}><p role="status">{text("session_migration_unconfirmed")}</p></Show>
        <Show when={state().problem || state().phase === "error"}>
          <p role="status">{text(state().phase === "error" ? "session_migration_rejected" : "session_migration_read_error")}</p>
        </Show>
        <Show when={blockers().length}>
          <details>
            <summary>{text("session_migration_blocked")}</summary>
            <ul class="mt-1 space-y-1"><For each={blockers()}>{(reason) => <li>{reason.message}</li>}</For></ul>
          </details>
        </Show>
        <div class="flex flex-wrap gap-2">
          <Show when={canStart() || canRecover()}>
            <Button type="button" size="sm" variant="outline" disabled={busy()}
              onClick={() => { void migration.migrate() }}>
              {text(state().submitting ? "session_migration_in_progress"
                : canRecover() ? "session_migration_confirm_result" : "session_migration_action")}
            </Button>
          </Show>
          <Button type="button" size="sm" variant="ghost" disabled={busy()} onClick={() => { void migration.refresh() }}>
            {text("session_migration_refresh")}
          </Button>
        </div>
      </Show>
    </div>
  </Show>
}

/** Only an observed, compatible legacy session may initiate a migration. */
export function SessionVersionMigrationGate(props: {
  sessionId: string
  state: ReturnType<typeof createSessionExecutionCompatibility>
  enabled?: boolean
}) {
  const showNotice = () => props.state.blocked || props.state.readError
    || props.state.observed && props.state.report?.status === "legacy_compatible"
  const needsMigration = () => props.state.observed && !props.state.loading && !props.state.readError
    && !props.state.blocked && props.state.report?.status === "legacy_compatible" && props.state.report.execution_allowed
  return <SessionVersionMigrationAction sessionId={props.sessionId} enabled={props.enabled ?? true}
    allowNewMigration={needsMigration()} autoAssess={needsMigration()} hideIdle={!showNotice()} class="mx-4 mb-2" />
}
