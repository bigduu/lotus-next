import { uiText, useUiLocale } from "@shared/i18n/ui"

type Props = {
  sessionId: string | null
  child: boolean
  unsafe: boolean
  selected: boolean | null
  confirmed: boolean | null
  loading: boolean
  pending: boolean
  recovering: boolean
  recoverable: boolean
  error: string | null
  conflict: string | null
  onRetry: () => void
}

export function RootOrchestrationControl({
  sessionId, child, unsafe, selected, confirmed, loading, pending, recovering, recoverable,
  error, conflict, onRetry,
}: Props) {
  useUiLocale()
  if (child) return null
  const changed = sessionId && typeof selected === "boolean" && typeof confirmed === "boolean"
    && selected !== confirmed
  const status = unsafe && pending && !error && !conflict
    ? uiText("waiting_for_server_confirmation_71efb37a")
    : unsafe
    ? recovering ? uiText("recovering_permission_result_7a4a9813") : uiText("permission_result_unknown_37e663a7")
    : child
    ? uiText("only_root_can_configure_this_33c9ea08")
    : loading
      ? uiText("reading_server_state_14b7f241")
      : sessionId && selected === null
        ? uiText("state_unavailable_a9dcef67")
        : pending
          ? uiText("waiting_for_server_confirmation_71efb37a")
          : !sessionId
            ? selected ? uiText("use_ultra_orchestration_for_the_next_session_7f755f23") : uiText("use_standard_mode_for_the_next_session_b08ea9c5")
            : changed
              ? selected ? uiText("pending_enable_currently_off_b175d612") : uiText("pending_disable_currently_on_8e846da7")
              : confirmed ? uiText("server_confirmed_ultra_orchestration_25a54375") : uiText("server_confirmed_standard_mode_fb0ea60d")

  return (
    <div className={error || conflict ? "flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-xs" : "sr-only"} aria-busy={loading || pending || recovering}>
      <span role="status" aria-live="polite" className="sr-only">{status}</span>
      {error || conflict ? (
        <span role="alert" className="basis-full text-destructive">
          {conflict || error}
          {recoverable && !child ? (
            <button type="button" className="ml-1 underline" disabled={recovering || pending} onClick={onRetry}>{uiText("recover_mode_change_ca1cc75a")}</button>
          ) : error && !child && !unsafe ? (
            <button type="button" className="ml-1 underline" disabled={pending} onClick={onRetry}>{uiText("reload_state_df7392cc")}</button>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}
