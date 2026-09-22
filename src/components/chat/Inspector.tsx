import { useEffect, useMemo, useState } from "react"
import { X, FolderGit2, FileDiff } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import {
  useAppStore,
  selectCurrentChat,
  selectChildren,
  selectSessionById,
} from "@shared/store/appStore"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import { agentClient, type GoldConfig, type GoalState } from "@services/chat/AgentService"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { collectSessionFileChanges } from "@/lib/sessionFileChanges"
import {
  formatTokenCount,
  getPrefixCachePercentage,
  getPrefixCacheTotalInputTokens,
  type TokenUsage,
} from "@shared/types/tokenBudget"
import { FileChangeView } from "./FileChangeView"
import { getFileChangePayloadDiffStats } from "@shared/utils/resultFormatters"

function GoalSection({
  sessionId,
  goldConfig,
  goalState,
}: {
  sessionId: string
  goldConfig?: GoldConfig | null
  goalState?: GoalState | null
}) {
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
    } catch { setSaveError("保存目标失败，请重试。") }
    finally { setSaving(false) }
  }

  return (
    <section className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">目标</span>
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
            {goal ? "编辑" : "设置"}
          </button>
        ) : null}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">聊天指令：<code>/goal 目标内容</code> 设置并推进，<code>/goal off</code> 暂停，<code>/goal clear</code> 清除。</p>
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            placeholder="描述这段会话要达成的目标…"
            className="min-h-16 w-full resize-y rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={autoContinue} onChange={(event) => setAutoContinue(event.target.checked)} />
            自动继续推进目标
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={recoverTimeouts} disabled={!autoContinue} onChange={(event) => setRecoverTimeouts(event.target.checked)} />
            无输出超时后尝试恢复
          </label>
          {autoContinue && recoverTimeouts && <p className="mt-1 text-xs text-muted-foreground">每个目标额外尝试最多 {Math.min(recoveryPolicy.max_attempts, 10)} 次，恢复窗口 {Math.min(recoveryPolicy.max_elapsed_seconds, 3600) / 60} 分钟。停止操作会结束等待。</p>}
          {saveError && <p role="alert" className="mt-1 text-xs text-destructive">{saveError}</p>}
          <div className="mt-1.5 flex justify-end gap-2">
            <Button size="sm" variant="secondary" disabled={saving} onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button size="sm" disabled={saving} onClick={save}>
              保存
            </Button>
          </div>
        </>
      ) : goal ? (
        <>
          <p className="text-sm leading-relaxed">{goal}</p>
          {goalState?.status ? (
            <div className="mt-1.5 text-xs text-muted-foreground">状态:{goalState.status}</div>
          ) : null}
        </>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          未设置目标。设置后,agent 会朝目标推进并自检是否达成。
        </p>
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
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  )
}

const formatTokenValue = (count: number): string => `${formatTokenCount(count)} tokens`

export function PrefixCacheDetails({ usage }: { usage?: TokenUsage }) {
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
          <Row label="命中率" value={prefixCacheRateLabel} />
          <Row
            label="缓存读取"
            value={formatTokenValue(prefixCache.cacheReadInputTokens)}
          />
          <Row
            label="新输入"
            value={formatTokenValue(prefixCache.inputTokens)}
          />
          <Row
            label="缓存创建"
            value={formatTokenValue(prefixCache.cacheCreationInputTokens)}
          />
          <Row
            label="Provider 输入"
            value={formatTokenValue(getPrefixCacheTotalInputTokens(prefixCache))}
          />
          <Row
            label="数据状态"
            value={cacheValueRetained ? "上一次已完成轮次" : "最新已完成轮次"}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            命中率 = 缓存读取 ÷（新输入 + 缓存创建 + 缓存读取）。
          </p>
        </>
      ) : typeof cacheReadTokens === "number" && cacheReadTokens > 0 ? (
        <>
          <Row label="缓存读取" value={formatTokenValue(cacheReadTokens)} />
          <Row label="Provider 输入" value="等待完整数据" />
          <Row label="命中率" value="等待精确数据" />
          <Row
            label="数据状态"
            value={cacheValueRetained ? "上一次有效值" : "最新兼容数据"}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            命中率必须使用同一轮 Provider 输入计算；上方预估总量口径不同，不能作为分母。
          </p>
        </>
      ) : (
        <>
          <Row label="命中率" value="暂无数据" />
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            完成一次带 Provider usage 的模型调用后显示。
          </p>
        </>
      )}
    </div>
  )
}

export function ContextUsageDetails({ usage }: { usage: TokenUsage }) {
  return (
    <div data-context-usage-details>
      <div className="mb-1 text-xs text-muted-foreground">上下文估算</div>
      <Row label="预估总量" value={formatTokenValue(usage.totalTokens)} />
      <Row label="系统提示词" value={formatTokenValue(usage.systemTokens)} />
      <Row label="会话窗口" value={formatTokenValue(usage.windowTokens)} />
      {usage.summaryTokens > 0 ? (
        <Row label="摘要" value={formatTokenValue(usage.summaryTokens)} />
      ) : null}
      {(usage.thinkingTokens ?? 0) > 0 ? (
        <Row label="推理" value={formatTokenValue(usage.thinkingTokens!)} />
      ) : null}
      {usage.maxContextTokens ? (
        <>
          <Row label="上下文窗口" value={formatTokenValue(usage.maxContextTokens)} />
          <Row
            label="上下文占用"
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
  docked = false,
  width,
  embedded = false,
}: {
  sessionId: string | null
  open: boolean
  onClose: () => void
  workspace?: string | null
  onEditWorkspace?: () => void
  /** Render as an in-flow right column (wide desktop) instead of an overlay sheet. */
  docked?: boolean
  /** Docked column width in px (resizable). */
  width?: number
  /** Render only the Inspector content inside a parent workbench shell. */
  embedded?: boolean
}) {
  const chat = useAppStore((s) =>
    sessionId ? selectSessionById(sessionId)(s) : selectCurrentChat(s),
  )
  const liveTokenUsage = useAppStore((s) =>
    sessionId ? s.tokenUsages[sessionId] : undefined,
  )
  const taskList = useAppStore((s) => (sessionId ? s.taskLists[sessionId] : undefined))
  const evaluation = useAppStore((s) => (sessionId ? s.evaluationStates[sessionId] : undefined))
  const loadTaskList = useAppStore((s) => s.loadTaskList)
  // Session-level file-change aggregation ("Diffs" section): every
  // file-editing tool result in the loaded transcript, newest last.
  const sessionMessages = useAppStore(
    useShallow((s) => (sessionId ? (selectSessionById(sessionId)(s)?.messages ?? []) : [])),
  )
  const fileChanges = useMemo(() => collectSessionFileChanges(sessionMessages), [sessionMessages])
  const getProviderLabel = useProviderStore((s) => s.getProviderDisplayLabel)
  const children = useAppStore(
    useShallow((s) => (sessionId ? selectChildren(sessionId)(s) : {})),
  )

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
  const childList = Object.entries(children ?? {})

  const body = (
    <>
        {!embedded ? <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">检查器</span>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X />
          </Button>
        </div> : null}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <section className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">工作目录</span>
              {onEditWorkspace ? (
                <button onClick={onEditWorkspace} className="text-xs text-primary hover:underline">
                  {sessionId ? "更改" : "选择"}
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={workspace || undefined}>
                {workspace || "默认目录"}
              </span>
            </div>
            {sessionId ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                会话创建时设定;更改用于新建会话与 @ 文件引用。
              </p>
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
            <div className="mb-2 text-xs font-medium text-muted-foreground">任务清单</div>
            {evaluation?.isEvaluating ? (
              <p className="mb-2 flex items-center gap-1.5 text-xs text-primary">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                正在评估任务进度…
              </p>
            ) : evaluation?.reasoning ? (
              <p className="mb-2 rounded bg-muted/60 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {evaluation.reasoning}
              </p>
            ) : null}
            {!taskList || taskList.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无任务</p>
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

          {fileChanges.length > 0 ? (
            <section className="rounded-lg border p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                文件变更 ({fileChanges.length})
              </div>
              <div className="space-y-1.5">
                {fileChanges.map(({ id, payload }) => {
                  const stats = getFileChangePayloadDiffStats(payload)
                  return (
                    <details key={id}>
                      <summary className="flex cursor-pointer select-none items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-accent [&::-webkit-details-marker]:hidden">
                        <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-mono" title={payload.file_path}>
                          {payload.file_path?.split("/").filter(Boolean).pop() || payload.file_path}
                        </span>
                        <span className="shrink-0 text-[11px]">
                          <span className="text-green-600 dark:text-green-400">+{stats.added}</span>{" "}
                          <span className="text-red-600 dark:text-red-400">−{stats.removed}</span>
                        </span>
                      </summary>
                      <div className="mt-1">
                        <FileChangeView payload={payload} />
                      </div>
                    </details>
                  )
                })}
              </div>
            </section>
          ) : null}

          {childList.length > 0 ? (
            <section className="rounded-lg border p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                子代理 ({childList.length})
              </div>
              <ul className="space-y-2">
                {childList.map(([id, c]) => (
                  <li key={id} className="rounded-md bg-muted/50 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {c.title || id.slice(0, 8)}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {c.status ?? "—"}
                        {typeof c.roundCount === "number" ? ` · ${c.roundCount}轮` : ""}
                      </span>
                    </div>
                    {c.outputPreview ? (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {c.outputPreview}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Developer telemetry — folded away by default for a clean surface. */}
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">
              高级信息
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">配置</div>
                <Row label="模型" value={model} />
                {provider ? <Row label="提供方" value={provider} /> : null}
                {cfg?.reasoningEffort ? (
                  <Row label="推理强度" value={cfg.reasoningEffort} />
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
        aria-label="关闭检查器"
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
