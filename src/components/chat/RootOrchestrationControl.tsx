import { uiText, useUiLocale } from "@shared/i18n/ui"
import { CircleHelp } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ReasoningEffortSelection } from "@shared/utils/reasoningEffort"

const ordinaryLabels: Record<ReasoningEffortSelection, string> = {
  get auto() { return uiText("auto_7eb336e4") }, get none() { return uiText("close_3fd47edc") }, get low() { return uiText("low_aa9e366f") }, get medium() { return uiText("medium_a567bdaa") }, get high() { return uiText("high_b1c27820") }, get xhigh() { return uiText("extra_high_392d0dce") }, get max() { return uiText("max_9730c15f") },
}

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
  ordinaryValue: ReasoningEffortSelection
  onRetry: () => void
}

export function RootOrchestrationControl({
  sessionId, child, unsafe, selected, confirmed, loading, pending, recovering, recoverable,
  error, conflict, ordinaryValue, onRetry,
}: Props) {
  useUiLocale()
  if (child) return null
  const changed = sessionId && typeof selected === "boolean" && typeof confirmed === "boolean"
    && selected !== confirmed
  const status = unsafe
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
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-xs" aria-busy={loading || pending || recovering}>
      <span role="status" aria-live="polite" className="text-muted-foreground">{status}</span>
      {selected !== null ? <span className="text-muted-foreground">{uiText("single_call_reasoning_14a4fc24")}{ordinaryLabels[ordinaryValue]}</span> : null}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={uiText("about_ultra_orchestration_85ab439b")} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <CircleHelp className="size-3.5" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="text-xs leading-relaxed">
          <p>{uiText("ultra_is_a_separate_root_orchestration_mode_above_max_r_d8ebbb6c")}</p>
          <p className="mt-2">{uiText("root_can_use_subagent_plan_task_session_history_current_0c8b74f6")}</p>
          <p className="mt-2">{uiText("this_mode_is_incompatible_with_skill_workflow_and_legac_7fbdc903")}</p>
        </PopoverContent>
      </Popover>
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
