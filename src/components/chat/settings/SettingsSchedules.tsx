import { useCallback, useEffect, useState } from "react"
import { History, Pencil, Play, Plus, Trash2 } from "lucide-react"
import { agentClient } from "@services/chat/AgentService"
import type { ScheduleEntry } from "@services/chat/AgentService"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { ScheduleForm } from "./schedules/ScheduleForm"
import { ScheduleRuns } from "./schedules/ScheduleRuns"
import {
  type ScheduleFormValues,
  DEFAULT_FORM_VALUES,
  buildMisfirePolicy,
  buildRunConfig,
  buildTriggerFromValues,
  errorMessage,
  formatTime,
  misfireSummary,
  normalizedString,
  overlapSummary,
  scheduleToFormValues,
  triggerSummary,
} from "./schedules/scheduleModel"

function statusBadge(s: ScheduleEntry): {
  variant: "default" | "secondary" | "destructive" | "warning" | "success"
  label: string
} {
  if ((s.state?.running_run_count ?? 0) > 0)
    return { variant: "default", label: `运行中 ×${s.state.running_run_count}` }
  if ((s.state?.queued_run_count ?? 0) > 0)
    return { variant: "warning", label: `排队 ×${s.state.queued_run_count}` }
  if ((s.state?.consecutive_failures ?? 0) > 0)
    return { variant: "destructive", label: `连续失败 ×${s.state.consecutive_failures}` }
  if (!s.enabled) return { variant: "secondary", label: "已停用" }
  if (s.state?.last_success_at) return { variant: "success", label: "正常" }
  return { variant: "secondary", label: "空闲" }
}

function lastRunTime(s: ScheduleEntry): string {
  return formatTime(s.state?.last_success_at ?? s.state?.last_finished_at)
}

export function SettingsSchedules() {
  const [items, setItems] = useState<ScheduleEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // one shared inline form: adding XOR editing a specific schedule
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<ScheduleFormValues>(DEFAULT_FORM_VALUES)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // per-list action feedback (toggle / run-now / delete)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)

  const [expandedRunsId, setExpandedRunsId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const reload = useCallback(() => {
    agentClient
      .listSchedules()
      .then((r) => {
        setItems(r.schedules ?? [])
        setLoadError(null)
      })
      .catch((e) => setLoadError(`加载定时任务失败:${errorMessage(e)}`))
      .finally(() => setLoading(false))
  }, [])
  useEffect(reload, [reload])

  const patchForm = (patch: Partial<ScheduleFormValues>) => setForm((f) => ({ ...f, ...patch }))

  const openAdd = () => {
    setEditId(null)
    setForm(DEFAULT_FORM_VALUES)
    setFormError(null)
    setAdding(true)
  }

  const openEdit = (s: ScheduleEntry) => {
    setAdding(false)
    setEditId(s.id)
    setForm(scheduleToFormValues(s))
    setFormError(null)
  }

  const closeForm = () => {
    setAdding(false)
    setEditId(null)
    setForm(DEFAULT_FORM_VALUES)
    setFormError(null)
  }

  const save = async () => {
    if (!form.name.trim()) {
      setFormError("请填写名称")
      return
    }
    const { trigger, error } = buildTriggerFromValues(form)
    if (!trigger) {
      setFormError(error ?? "请完善触发配置")
      return
    }
    const runConfig = buildRunConfig(form)
    if (form.auto_execute && !runConfig.task_message) {
      setFormError("启用自动执行时必须填写任务内容")
      return
    }

    setSaving(true)
    setFormError(null)
    try {
      if (editId) {
        await agentClient.patchSchedule(editId, {
          name: form.name.trim(),
          enabled: form.enabled,
          trigger,
          timezone: normalizedString(form.timezone),
          start_at: normalizedString(form.start_at),
          end_at: normalizedString(form.end_at),
          misfire_policy: buildMisfirePolicy(form),
          overlap_policy: form.overlap_policy,
          run_config: runConfig,
        })
      } else {
        await agentClient.createSchedule({
          name: form.name.trim(),
          enabled: form.enabled,
          trigger,
          timezone: normalizedString(form.timezone),
          start_at: normalizedString(form.start_at),
          end_at: normalizedString(form.end_at),
          misfire_policy: buildMisfirePolicy(form),
          overlap_policy: form.overlap_policy,
          run_config: runConfig,
        })
      }
      closeForm()
      reload()
    } catch (e) {
      setFormError(`保存失败:${errorMessage(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const runAction = async (fn: () => Promise<void>, notice?: string) => {
    setActionError(null)
    setActionNotice(null)
    try {
      await fn()
      if (notice) setActionNotice(notice)
      reload()
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">按计划自动触发的任务。</p>
        {!adding && !editId ? (
          <Button size="sm" variant="secondary" onClick={openAdd}>
            <Plus className="size-4" /> 新增
          </Button>
        ) : null}
      </div>

      {adding ? (
        <ScheduleForm
          values={form}
          onChange={patchForm}
          error={formError}
          saving={saving}
          submitLabel="添加"
          onSubmit={save}
          onCancel={closeForm}
        />
      ) : null}

      {loadError ? <p className="text-xs text-destructive">{loadError}</p> : null}
      {actionError ? <p className="text-xs text-destructive">操作失败:{actionError}</p> : null}
      {actionNotice ? <p className="text-xs text-primary">{actionNotice}</p> : null}

      {loading ? (
        <p className="text-xs text-muted-foreground">加载中…</p>
      ) : items.length === 0 ? (
        !adding && <p className="text-xs text-muted-foreground">暂无定时任务</p>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => {
            const status = statusBadge(s)
            const isEditing = editId === s.id
            return (
              <li key={s.id} className="rounded-lg border">
                <div className="space-y-1.5 p-3">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</div>
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <Switch
                      checked={s.enabled}
                      aria-label={s.enabled ? "停用" : "启用"}
                      onCheckedChange={(checked) =>
                        runAction(async () => {
                          await agentClient.patchSchedule(s.id, { enabled: checked })
                        })
                      }
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{triggerSummary(s.trigger)}</span>
                    {s.timezone ? <span>· {s.timezone}</span> : null}
                    <span>· {misfireSummary(s.misfire_policy)}</span>
                    <span>· {overlapSummary(s.overlap_policy)}</span>
                    {s.run_config?.auto_execute ? <span>· 自动执行</span> : null}
                    {s.run_config?.model ? <span>· {s.run_config.model}</span> : null}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    下次 {formatTime(s.state?.next_fire_at)} · 上次 {lastRunTime(s)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    成功 {s.state?.total_success_count ?? 0} · 失败 {s.state?.total_failure_count ?? 0} · 错过{" "}
                    {s.state?.total_missed_count ?? 0} · 共 {s.state?.total_run_count ?? 0} 次
                  </div>

                  <div className="flex items-center gap-1 pt-1">
                    <button
                      onClick={() =>
                        runAction(async () => {
                          await agentClient.runScheduleNow(s.id)
                        }, `「${s.name}」已加入执行队列`)
                      }
                      aria-label="立即运行"
                      title="立即运行"
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      <Play className="size-4" />
                    </button>
                    <button
                      onClick={() => setExpandedRunsId((id) => (id === s.id ? null : s.id))}
                      aria-label="运行记录"
                      title="运行记录"
                      className={cn(
                        "rounded p-1 hover:text-foreground",
                        expandedRunsId === s.id ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      <History className="size-4" />
                    </button>
                    <button
                      onClick={() => (isEditing ? closeForm() : openEdit(s))}
                      aria-label="编辑"
                      title="编辑"
                      className={cn(
                        "rounded p-1 hover:text-foreground",
                        isEditing ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId((id) => (id === s.id ? null : s.id))}
                      aria-label="删除"
                      title="删除"
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>

                  {deleteConfirmId === s.id ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5">
                      <span className="text-xs text-destructive">确定删除「{s.name}」?</span>
                      <div className="flex shrink-0 gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setDeleteConfirmId(null)}>
                          取消
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setDeleteConfirmId(null)
                            void runAction(async () => {
                              await agentClient.deleteSchedule(s.id)
                            }, `已删除「${s.name}」`)
                          }}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>

                {isEditing ? (
                  <div className="border-t p-2">
                    <ScheduleForm
                      values={form}
                      onChange={patchForm}
                      error={formError}
                      saving={saving}
                      submitLabel="保存"
                      onSubmit={save}
                      onCancel={closeForm}
                    />
                  </div>
                ) : null}

                {expandedRunsId === s.id ? (
                  <div className="border-t px-2 py-1">
                    <ScheduleRuns scheduleId={s.id} />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
