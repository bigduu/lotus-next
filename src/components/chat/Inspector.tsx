import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useMemo, useState } from "react"
import { ArrowRight, Copy, X, FolderGit2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import {
  useAppStore,
  selectCurrentChat,
  selectSessionById,
} from "@shared/store/appStore"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import { agentClient, type GoldConfig, type GoalState } from "@services/chat/AgentService"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  collectSessionFileChanges,
  groupSessionFileChanges,
  summarizeSessionFileChangeGroups,
} from "@/lib/sessionFileChanges"
import {
  formatTokenCount,
  getPrefixCachePercentage,
  getPrefixCacheTotalInputTokens,
  type TokenUsage,
} from "@shared/types/tokenBudget"
import { FileChangeList } from "./FileChangeList"
import { ActorSnapshotPanel } from "./ActorSnapshotPanel"

function GoalSection({
  sessionId,
  goldConfig,
  goalState,
}: {
  sessionId: string
  goldConfig?: GoldConfig | null
  goalState?: GoalState | null
}) {
  useUiLocale()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [autoContinue, setAutoContinue] = useState(false)
  const [recoverTimeouts, setRecoverTimeouts] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const goal = goldConfig?.goal
  const recoveryPolicy = (goldConfig?.recovery?.max_attempts ?? 0) > 0
    ? goldConfig!.recovery!
    : { max_attempts: 3, max_elapsed_seconds: 900 }

  const save = async () => {
    if (saving) return
    const g = draft.trim()
    setSaving(true); setSaveError("")
    try {
      await agentClient.patchSession(sessionId, {
        gold_config: {
          ...(goldConfig ?? { enabled: true }), enabled: true, goal: g || null,
          auto_continue_enabled: autoContinue,
          recovery: recoverTimeouts && autoContinue
            ? recoveryPolicy
            : { max_attempts: 0, max_elapsed_seconds: 0 },
        },
      })
      setEditing(false)
      await useAppStore.getState().loadChatHistory(sessionId)
    } catch { setSaveError(uiText("could_not_save_goal_please_try_again_46d0ad3b")) }
    finally { setSaving(false) }
  }

  return (
    <section className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{uiText("target_57060c88")}</span>
        {!editing ? (
          <button
            onClick={() => {
              setDraft(goal ?? "")
              setAutoContinue(goldConfig?.auto_continue_enabled ?? false)
              setRecoverTimeouts((goldConfig?.recovery?.max_attempts ?? 0) > 0)
              setSaveError("")
              setEditing(true)
            }}
            className="text-xs text-primary hover:underline"
          >
            {goal ? uiText("edit_05183656") : uiText("settings_df3d58c7")}
          </button>
        ) : null}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{uiText("chat_commands_a9207e15")}<code>{uiText("goal_goal_text_4fe4dd06")}</code>{uiText("set_and_pursue_270d1beb")}<code>/goal off</code>{uiText("pause_bfaa6e86")}<code>/goal clear</code>{uiText("clear_531ffd78")}</p>
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            placeholder={uiText("describe_the_goal_for_this_session_668b351d")}
            className="min-h-16 w-full resize-y rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={autoContinue} onChange={(event) => setAutoContinue(event.target.checked)} />
            {uiText("continue_pursuing_the_goal_automatically_9a0d0cd4")}</label>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={recoverTimeouts} disabled={!autoContinue} onChange={(event) => setRecoverTimeouts(event.target.checked)} />
            {uiText("attempt_recovery_after_an_output_timeout_227c0054")}</label>
          {autoContinue && recoverTimeouts && <p className="mt-1 text-xs text-muted-foreground">{uiText("extra_attempts_per_goal_at_most_71934320")} {Math.min(recoveryPolicy.max_attempts, 10)} {uiText("attempts_recovery_window_123ea7f2")} {Math.min(recoveryPolicy.max_elapsed_seconds, 3600) / 60} {uiText("minutes_stopping_ends_the_wait_4accfbf3")}</p>}
          {saveError && <p role="alert" className="mt-1 text-xs text-destructive">{saveError}</p>}
          <div className="mt-1.5 flex justify-end gap-2">
            <Button size="sm" variant="secondary" disabled={saving} onClick={() => setEditing(false)}>
              {uiText("cancel_2cd0f3be")}</Button>
            <Button size="sm" disabled={saving} onClick={save}>
              {uiText("save_a3030bf8")}</Button>
          </div>
        </>
      ) : goal ? (
        <>
          <p className="text-sm leading-relaxed">{goal}</p>
          {goalState?.status ? (
            <div className="mt-1.5 text-xs text-muted-foreground">{uiText("status_ed1eb79b")}{goalState.status}</div>
          ) : null}
        </>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {uiText("no_goal_set_set_one_for_the_agent_to_pursue_and_check_f_221f6826")}</p>
      )}
    </section>
  )
}

const STATUS: Record<string, { icon: string; cls: string }> = {
  pending: { icon: "○", cls: "text-muted-foreground" },
  in_progress: { icon: "◐", cls: "text-primary" },
  completed: { icon: "✓", cls: "text-emerald-500" },
  skipped: { icon: "–", cls: "text-muted-foreground" },
  failed: { icon: "✗", cls: "text-destructive" },
}

function Row({ label, value }: { label: string; value: string }) {
  useUiLocale()
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  )
}

const formatTokenValue = (count: number): string => `${formatTokenCount(count)} tokens`

export function PrefixCacheDetails({ usage }: { usage?: TokenUsage }) {
  useUiLocale()
  const prefixCache = usage?.prefixCache
  const prefixCachePercentage = prefixCache
    ? getPrefixCachePercentage(prefixCache)
    : undefined
  const prefixCacheRateLabel =
    typeof prefixCachePercentage === "number"
      ? `${prefixCachePercentage.toFixed(1).replace(/\.0$/, "")}%`
      : null
  const cacheReadTokens = prefixCache?.cacheReadInputTokens ?? usage?.cacheReadInputTokens
  const cacheValueRetained = Boolean(
    prefixCache?.retainedFromPreviousRound || usage?.cacheReadInputTokensRetained,
  )

  return (
    <div data-prefix-cache-details>
      <div className="mb-1 text-xs text-muted-foreground">Prefix Cache</div>
      {prefixCache && prefixCacheRateLabel ? (
        <>
          <Row label={uiText("hit_rate_da9e37af")} value={prefixCacheRateLabel} />
          <Row
            label={uiText("cache_reads_1ded6559")}
            value={formatTokenValue(prefixCache.cacheReadInputTokens)}
          />
          <Row
            label={uiText("new_input_56164cf0")}
            value={formatTokenValue(prefixCache.inputTokens)}
          />
          <Row
            label={uiText("cache_creation_92797c69")}
            value={formatTokenValue(prefixCache.cacheCreationInputTokens)}
          />
          <Row
            label={uiText("provider_input_cbf1d1f1")}
            value={formatTokenValue(getPrefixCacheTotalInputTokens(prefixCache))}
          />
          <Row
            label={uiText("data_status_bbd51f73")}
            value={cacheValueRetained ? uiText("previous_completed_round_836ba413") : uiText("latest_completed_round_fe872c8f")}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {uiText("hit_rate_cache_reads_new_input_cache_creation_cache_rea_ae5ec6f5")}</p>
        </>
      ) : typeof cacheReadTokens === "number" && cacheReadTokens > 0 ? (
        <>
          <Row label={uiText("cache_reads_1ded6559")} value={formatTokenValue(cacheReadTokens)} />
          <Row label={uiText("provider_input_cbf1d1f1")} value={uiText("waiting_for_complete_data_a333ea86")} />
          <Row label={uiText("hit_rate_da9e37af")} value={uiText("waiting_for_exact_data_42730723")} />
          <Row
            label={uiText("data_status_bbd51f73")}
            value={cacheValueRetained ? uiText("previous_valid_value_84e70723") : uiText("latest_compatible_data_a6b924c0")}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {uiText("hit_rate_requires_provider_input_from_the_same_round_th_3f9518c8")}</p>
        </>
      ) : (
        <>
          <Row label={uiText("hit_rate_da9e37af")} value={uiText("no_data_yet_497c8569")} />
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {uiText("shown_after_a_model_call_reports_provider_usage_709de1e3")}</p>
        </>
      )}
    </div>
  )
}

export function ContextUsageDetails({ usage }: { usage: TokenUsage }) {
  useUiLocale()
  return (
    <div data-context-usage-details>
      <div className="mb-1 text-xs text-muted-foreground">{uiText("context_estimate_11f23d14")}</div>
      <Row label={uiText("estimated_total_58f48562")} value={formatTokenValue(usage.totalTokens)} />
      <Row label={uiText("system_prompt_0894b78b")} value={formatTokenValue(usage.systemTokens)} />
      <Row label={uiText("session_window_7b78e572")} value={formatTokenValue(usage.windowTokens)} />
      {usage.summaryTokens > 0 ? (
        <Row label={uiText("summary_21c04b2e")} value={formatTokenValue(usage.summaryTokens)} />
      ) : null}
      {(usage.thinkingTokens ?? 0) > 0 ? (
        <Row label={uiText("reasoning_132411ba")} value={formatTokenValue(usage.thinkingTokens!)} />
      ) : null}
      {usage.maxContextTokens ? (
        <>
          <Row label={uiText("context_window_bb074b86")} value={formatTokenValue(usage.maxContextTokens)} />
          <Row
            label={uiText("context_occupancy_ba08613d")}
            value={`${Math.min(100, (usage.totalTokens / usage.maxContextTokens) * 100).toFixed(1).replace(/\.0$/, "")}%`}
          />
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${Math.min(100, Math.round((usage.totalTokens / usage.maxContextTokens) * 100))}%`,
              }}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

export function Inspector({
  sessionId,
  open,
  onClose,
  workspace,
  onEditWorkspace,
  onOpenReview,
  onCopySessionId,
  onSelectActor = () => {},
  selectedActorId,
  docked = false,
  width,
  embedded = false,
}: {
  sessionId: string | null
  open: boolean
  onClose: () => void
  workspace?: string | null
  onEditWorkspace?: () => void
  onOpenReview?: (filePath?: string) => void
  onCopySessionId: (sessionId: string) => void
  onSelectActor?: (actorId: string) => void
  selectedActorId?: string | null
  /** Render as an in-flow right column (wide desktop) instead of an overlay sheet. */
  docked?: boolean
  /** Docked column width in px (resizable). */
  width?: number
  /** Render only the Inspector content inside a parent workbench shell. */
  embedded?: boolean
}) {
  useUiLocale()
  const chat = useAppStore((s) =>
    sessionId ? selectSessionById(sessionId)(s) : selectCurrentChat(s),
  )
  const rootDescendantCount = useAppStore((s) => {
    const selected = sessionId ? selectSessionById(sessionId)(s) : selectCurrentChat(s)
    const selectedRootId = selected?.kind === "root" ? selected.id : selected?.rootSessionId
    return selectedRootId ? selectSessionById(selectedRootId)(s)?.subagentCount ?? null : null
  })
  const liveTokenUsage = useAppStore((s) =>
    sessionId ? s.tokenUsages[sessionId] : undefined,
  )
  const taskList = useAppStore((s) => (sessionId ? s.taskLists[sessionId] : undefined))
  const evaluation = useAppStore((s) => (sessionId ? s.evaluationStates[sessionId] : undefined))
  const loadTaskList = useAppStore((s) => s.loadTaskList)
  // Inspector shows a deduplicated index; Review owns the full diff surface.
  const sessionMessages = useAppStore(
    useShallow((s) => (sessionId ? (selectSessionById(sessionId)(s)?.messages ?? []) : [])),
  )
  const fileChanges = useMemo(() => collectSessionFileChanges(sessionMessages), [sessionMessages])
  const fileChangeGroups = useMemo(
    () => groupSessionFileChanges(fileChanges, workspace ?? undefined),
    [fileChanges, workspace],
  )
  const fileChangeSummary = useMemo(
    () => summarizeSessionFileChangeGroups(fileChangeGroups),
    [fileChangeGroups],
  )
  const getProviderLabel = useProviderStore((s) => s.getProviderDisplayLabel)

  useEffect(() => {
    if (open && sessionId) void loadTaskList(sessionId)
  }, [open, sessionId, loadTaskList])

  if (!open) return null

  const cfg = chat?.config
  const model = cfg?.model_ref?.model || cfg?.model || "—"
  const providerId = cfg?.model_ref?.provider
  const provider = providerId ? getProviderLabel(providerId) : null
  const goal = cfg?.goalState
  const usage = liveTokenUsage ?? cfg?.tokenUsage
  const rootId = chat?.kind === "root" ? chat.id : chat?.rootSessionId ?? null

  const body = (
    <>
        {!embedded ? <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">{uiText("inspector_fc48a7f2")}</span>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X />
          </Button>
        </div> : null}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <ActorSnapshotPanel rootId={rootId} active={open} selectedActorId={selectedActorId ?? sessionId}
            descendantCountHint={rootDescendantCount}
            onSelectActor={onSelectActor} />
          <section className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{uiText("working_directory_3db7b06b")}</span>
              {onEditWorkspace ? (
                <button onClick={onEditWorkspace} className="text-xs text-primary hover:underline">
                  {sessionId ? uiText("change_6b01fce4") : uiText("select_c11330b8")}
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={workspace || undefined}>
                {workspace || uiText("default_directory_4ff28651")}
              </span>
            </div>
            {sessionId ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {uiText("set_when_the_session_is_created_changes_apply_to_new_se_33699fd8")}</p>
            ) : null}
          </section>

          {sessionId ? (
            <GoalSection
              key={sessionId}
              sessionId={sessionId}
              goldConfig={(cfg as { goldConfig?: GoldConfig | null })?.goldConfig}
              goalState={goal}
            />
          ) : null}

          <section className="rounded-lg border p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("task_list_a4ea7d95")}</div>
            {evaluation?.isEvaluating ? (
              <p className="mb-2 flex items-center gap-1.5 text-xs text-primary">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                {uiText("evaluating_task_progress_602a2eb0")}</p>
            ) : evaluation?.reasoning ? (
              <p className="mb-2 rounded bg-muted/60 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {evaluation.reasoning}
              </p>
            ) : null}
            {!taskList || taskList.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">{uiText("no_tasks_yet_da968898")}</p>
            ) : (
              <ul className="space-y-1.5">
                {taskList.items.map((it) => {
                  const s = STATUS[it.status] ?? STATUS.pending
                  return (
                    <li key={it.id} className="flex gap-2 text-sm">
                      <span className={cn("mt-0.5 shrink-0", s.cls)}>{s.icon}</span>
                      <span
                        className={cn(
                          "leading-relaxed",
                          it.status === "completed" && "text-muted-foreground line-through",
                        )}
                      >
                        {it.description}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {fileChangeGroups.length > 0 ? (
            <section className="rounded-lg border p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{uiText("file_changes_4d016b2f")}</span>
                {onOpenReview ? (
                  <button
                    type="button"
                    onClick={() => onOpenReview()}
                    className="flex items-center gap-0.5 text-xs text-primary hover:underline"
                  >
                    Review
                    <ArrowRight className="size-3" />
                  </button>
                ) : null}
              </div>
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  {uiText("count_files", { count: fileChangeSummary.fileCount })} · {uiText("count_changes", { count: fileChangeSummary.editCount })}</span>
                <span className="shrink-0">
                  <span className="text-green-600 dark:text-green-400">
                    +{fileChangeSummary.addedLines}
                  </span>{" "}
                  <span className="text-red-600 dark:text-red-400">
                    −{fileChangeSummary.removedLines}
                  </span>
                </span>
              </div>
              <FileChangeList
                groups={fileChangeGroups}
                workspace={workspace ?? undefined}
                pathMode="basename"
                density="compact"
                variant="summary"
                onSelect={(group) => onOpenReview?.(group.filePath)}
              />
            </section>
          ) : null}


          {/* Developer telemetry — folded away by default for a clean surface. */}
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">
              {uiText("advanced_details_d305be8b")}</summary>
            <div className="mt-3 space-y-3">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">{uiText("config_148d195e")}</div>
                {sessionId ? (
                  <div className="flex items-start justify-between gap-3 py-0.5 text-sm">
                    <span className="shrink-0 text-muted-foreground">{uiText("session_id_a76bd2d8")}</span>
                    <div className="flex min-w-0 items-start gap-1">
                      <code className="break-all text-right font-mono text-xs" style={{ userSelect: "text" }} title={sessionId}>
                        {sessionId}
                      </code>
                      <button
                        type="button"
                        aria-label={uiText("copy_session_id_7df96a6b")}
                        title={uiText("copy_session_id_7df96a6b")}
                        onClick={() => onCopySessionId(sessionId)}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Copy className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ) : null}
                <Row label={uiText("model_c98e118e")} value={model} />
                {provider ? <Row label={uiText("provider_9e218722")} value={provider} /> : null}
                {cfg?.reasoningEffort ? (
                  <Row label={uiText("reasoning_level_c8c14507")} value={cfg.reasoningEffort} />
                ) : null}
              </div>
              {usage ? <ContextUsageDetails usage={usage} /> : null}
              <PrefixCacheDetails usage={usage} />
            </div>
          </details>
        </div>
    </>
  )

  if (embedded) {
    return <div className="flex min-h-0 flex-1 flex-col">{body}</div>
  }

  // Wide desktop: dock as an in-flow right column alongside the chat (no
  // backdrop, both visible at once). Narrow/mobile: overlay bottom-sheet / rail.
  if (docked) {
    return (
      <aside
        className="flex shrink-0 flex-col border-l bg-card"
        // Dynamic cap: never wider than ~38% of the viewport, so the chat column
        // always stays larger than the inspector regardless of drag / window size.
        style={{ width: width ?? 384, maxWidth: "38vw" }}
      >
        {body}
      </aside>
    )
  }

  return (
    <>
      <button
        className="fixed inset-0 z-40 bg-black/50"
        aria-label={uiText("close_inspector_ac416b66")}
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed z-50 flex flex-col bg-card",
          // mobile: bottom sheet
          "inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t",
          // desktop (narrow): right rail overlay
          "md:inset-y-0 md:right-0 md:left-auto md:w-96 md:max-h-none md:rounded-none md:border-l md:border-t-0",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {body}
      </aside>
    </>
  )
}
