import { For, Show } from "solid-js"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import type { createSessionExecutionCompatibility } from "../observation"

const reasons = {
  unsupported_session_version: "session_compatibility_version_conflict",
  session_version_mismatch: "session_compatibility_observation_conflict",
  unsupported_runtime_state_version: "session_compatibility_runtime_conflict",
  unsupported_model_context_version: "session_compatibility_context_conflict",
} as const

export function SessionCompatibilityNotice(props: { state: ReturnType<typeof createSessionExecutionCompatibility> }) {
  const text = createUiText()
  const show = () => props.state.blocked || props.state.readError
    || (props.state.observed && props.state.report?.status === "legacy_compatible")
  const notice = () => props.state.blocked ? "session_compatibility_execution_blocked"
    : props.state.report?.status === "legacy_compatible" ? "session_compatibility_legacy_compatible"
      : props.state.legacy ? "session_compatibility_legacy_unassessed" : "session_compatibility_unassessed"
  return <Show when={show()}>
    <section class="border-b px-3 py-2 text-sm" aria-label={text("session_compatibility_label")}
      data-session-execution-blocked={props.state.blocked ? "true" : "false"}>
      <p role={props.state.blocked ? "alert" : "status"} class={props.state.blocked ? "font-medium text-destructive" : "text-muted-foreground"}>
        {text(notice())}
      </p>
      <Show when={props.state.report}>{(report) => (
        <p class="mt-1 text-xs text-muted-foreground">{text("session_compatibility_versions", {
          session: report().session_version ?? text("session_compatibility_unmarked"), current: report().current_session_version,
        })}</p>
      )}</Show>
      <Show when={props.state.blocked}>
        <p class="mt-1 text-xs">{text("session_compatibility_recovery")}</p>
        <For each={props.state.report?.conflicts}>{(reason) => (
          <div class="mt-1 text-xs">
            <p>{text(Object.hasOwn(reasons, reason.code) ? reasons[reason.code as keyof typeof reasons] : "session_compatibility_other_conflict")}</p>
            <details>
              <summary>{text("session_compatibility_diagnostic")}</summary>
              <p class="break-words">{reason.code}: {reason.message}</p>
            </details>
          </div>
        )}</For>
      </Show>
      <Show when={props.state.readError}>
        <p role="status" class="mt-1 text-xs">{text("session_compatibility_read_error")}</p>
      </Show>
      <Button type="button" size="sm" variant="ghost" disabled={props.state.loading}
        onClick={() => { void props.state.refresh() }}>
        {text("session_compatibility_refresh")}
      </Button>
    </section>
  </Show>
}
