import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useAppStore, selectCurrentChat, selectChildren } from "@shared/store/appStore"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import { agentClient, type GoldConfig, type GoalState } from "@services/chat/AgentService"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
  const goal = goldConfig?.goal

  const save = async () => {
    const g = draft.trim()
    setEditing(false)
    await agentClient
      .patchSession(sessionId, {
        gold_config: { ...(goldConfig ?? { enabled: true }), enabled: true, goal: g || null },
      })
      .catch(() => {})
    await useAppStore.getState().loadChatHistory(sessionId)
  }

  return (
    <section className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">目标</span>
        {!editing ? (
          <button
            onClick={() => {
              setDraft(goal ?? "")
              setEditing(true)
            }}
            className="text-xs text-primary hover:underline"
          >
            {goal ? "编辑" : "设置"}
          </button>
        ) : null}
      </div>
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            placeholder="描述这段会话要达成的目标…"
            className="min-h-16 w-full resize-y rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button size="sm" onClick={save}>
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

export function Inspector({
  sessionId,
  open,
  onClose,
}: {
  sessionId: string | null
  open: boolean
  onClose: () => void
}) {
  const chat = useAppStore(selectCurrentChat)
  const taskList = useAppStore((s) => (sessionId ? s.taskLists[sessionId] : undefined))
  const loadTaskList = useAppStore((s) => s.loadTaskList)
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
  const usage = cfg?.tokenUsage
  const childList = Object.entries(children ?? {})

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
          // desktop: right rail
          "md:inset-y-0 md:right-0 md:left-auto md:w-96 md:max-h-none md:rounded-none md:border-l md:border-t-0",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">检查器</span>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {sessionId ? (
            <GoalSection
              sessionId={sessionId}
              goldConfig={(cfg as { goldConfig?: GoldConfig | null })?.goldConfig}
              goalState={goal}
            />
          ) : null}

          <section className="rounded-lg border p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">任务清单</div>
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
              {usage ? (
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">上下文用量</div>
                  <Row label="总 tokens" value={usage.totalTokens.toLocaleString()} />
                  {usage.maxContextTokens ? (
                    <>
                      <Row label="上下文窗口" value={usage.maxContextTokens.toLocaleString()} />
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
              ) : null}
            </div>
          </details>
        </div>
      </aside>
    </>
  )
}
