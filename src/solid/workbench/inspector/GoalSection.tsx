import { createSignal, onSettled } from "solid-js"
import { agentClient, type GoldConfig, type GoalState } from "@services/chat/AgentService"
import { appStore } from "@shared/store/appStore/state"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"

export function GoalSection(props: {
  sessionId: string
  goldConfig?: GoldConfig | null
  goalState?: GoalState | null
}) {
  const uiText = createUiText()
  let mounted = true
  onSettled(() => () => { mounted = false })
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [autoContinue, setAutoContinue] = createSignal(false)
  const [recoverTimeouts, setRecoverTimeouts] = createSignal(false)
  const [resumeAfterRestart, setResumeAfterRestart] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [saveError, setSaveError] = createSignal("")
  const goal = () => props.goldConfig?.goal
  const visibleGoalState = () => props.goldConfig?.enabled && goal()?.trim() === props.goalState?.objective
    ? props.goalState
    : null
  const supportsRestartRecovery = () => typeof props.goldConfig?.resume_after_restart === "boolean"
  const recoveryPolicy = () => {
    const policy = props.goldConfig?.recovery
    return policy && policy.max_attempts > 0 ? policy : { max_attempts: 3, max_elapsed_seconds: 900 }
  }
  const stopReason = () => visibleGoalState()?.stop_reason === "continuation_budget"
    ? uiText("goal_stopped_at_continuation_limit")
    : visibleGoalState()?.stop_reason === "no_progress"
      ? uiText("goal_stopped_without_progress")
      : visibleGoalState()?.stop_reason === "verification_unavailable"
        ? uiText("goal_verification_unavailable")
        : null

  const save = async () => {
    if (saving()) return
    const g = draft().trim()
    setSaving(true)
    setSaveError("")
    try {
      await agentClient.patchSession(props.sessionId, {
        gold_config: {
          ...(props.goldConfig ?? { enabled: true }), enabled: true, goal: g || null,
          auto_continue_enabled: autoContinue(),
          ...(supportsRestartRecovery() ? { resume_after_restart: autoContinue() && resumeAfterRestart() } : {}),
          recovery: recoverTimeouts() && autoContinue()
            ? recoveryPolicy()
            : { max_attempts: 0, max_elapsed_seconds: 0 },
        },
      })
      if (mounted) setEditing(false)
      await appStore.getState().loadChatHistory(props.sessionId)
    } catch { if (mounted) setSaveError("failed") }
    finally { if (mounted) setSaving(false) }
  }

  return (
    <section class="rounded-lg border p-3">
      <div class="mb-2 flex items-center justify-between">
        <span class="text-xs font-medium text-muted-foreground">{uiText("target_57060c88")}</span>
        {!editing() ? (
          <button
            type="button"
            onClick={() => {
              setDraft(goal() ?? "")
              setAutoContinue(props.goldConfig?.auto_continue_enabled ?? false)
              setRecoverTimeouts((props.goldConfig?.recovery?.max_attempts ?? 0) > 0)
              setResumeAfterRestart(props.goldConfig?.resume_after_restart ?? false)
              setSaveError("")
              setEditing(true)
            }}
            class="text-xs text-primary hover:underline"
          >
            {goal() ? uiText("edit_05183656") : uiText("goal_set_action")}
          </button>
        ) : null}
      </div>
      <p class="mb-2 text-xs text-muted-foreground">{uiText("chat_commands_a9207e15")}<code>{uiText("goal_goal_text_4fe4dd06")}</code>{uiText("set_and_pursue_270d1beb")}<code>/goal off</code>{uiText("pause_bfaa6e86")}{supportsRestartRecovery() && <><code>/goal resume</code>{uiText("goal_resume_command_description")}</>}<code>/goal clear</code>{uiText("clear_531ffd78")}</p>
      {editing() ? (
        <>
          <textarea
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
            autofocus
            placeholder={uiText("describe_the_goal_for_this_session_668b351d")}
            class="min-h-16 w-full resize-y rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <label class="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={autoContinue()} onChange={(event) => setAutoContinue(event.currentTarget.checked)} />
            {uiText("continue_pursuing_the_goal_automatically_9a0d0cd4")}</label>
          <label class="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={recoverTimeouts()} disabled={!autoContinue()} onChange={(event) => setRecoverTimeouts(event.currentTarget.checked)} />
            {uiText("attempt_recovery_after_an_output_timeout_227c0054")}</label>
          {autoContinue() && recoverTimeouts() && <p class="mt-1 text-xs text-muted-foreground">{uiText("extra_attempts_per_goal_at_most_71934320")} {Math.min(recoveryPolicy().max_attempts, 10)} {uiText("attempts_recovery_window_123ea7f2")} {Math.min(recoveryPolicy().max_elapsed_seconds, 3600) / 60} {uiText("minutes_stopping_ends_the_wait_4accfbf3")}</p>}
          {supportsRestartRecovery() && <label class="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={resumeAfterRestart()} disabled={!autoContinue()} onChange={(event) => setResumeAfterRestart(event.currentTarget.checked)} />
            {uiText("goal_resume_after_restart")}</label>}
          {saveError() && <p role="alert" class="mt-1 text-xs text-destructive">{uiText("could_not_save_goal_please_try_again_46d0ad3b")}</p>}
          <div class="mt-1.5 flex justify-end gap-2">
            <Button size="sm" variant="secondary" disabled={saving()} onClick={() => setEditing(false)}>
              {uiText("cancel_2cd0f3be")}</Button>
            <Button size="sm" disabled={saving()} onClick={save}>
              {uiText("save_a3030bf8")}</Button>
          </div>
        </>
      ) : goal() ? (
        <>
          <p class="text-sm leading-relaxed">{goal()}</p>
          {visibleGoalState()?.status ? (
            <div class="mt-1.5 text-xs text-muted-foreground">{uiText("status_ed1eb79b")}{visibleGoalState()?.status}</div>
          ) : null}
          {stopReason() && <p class="mt-1 text-xs text-muted-foreground">{stopReason()}</p>}
        </>
      ) : (
        <p class="text-xs leading-relaxed text-muted-foreground">
          {uiText("no_goal_set_set_one_for_the_agent_to_pursue_and_check_f_221f6826")}</p>
      )}
    </section>
  )
}
