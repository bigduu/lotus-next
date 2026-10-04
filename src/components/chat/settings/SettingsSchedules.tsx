import { uiText, useUiLocale } from "@shared/i18n/ui"
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
    return { variant: "default", label: uiText("running_2fe78a4f", { v0: s.state.running_run_count }) }
  if ((s.state?.queued_run_count ?? 0) > 0)
    return { variant: "warning", label: uiText("queued_26a1886e", { v0: s.state.queued_run_count }) }
  if ((s.state?.consecutive_failures ?? 0) > 0)
    return { variant: "destructive", label: uiText("consecutive_failures_246d1740", { v0: s.state.consecutive_failures }) }
  if (!s.enabled) return { variant: "secondary", label: uiText("disabled_a8c3698b") }
  if (s.state?.last_success_at) return { variant: "success", label: uiText("healthy_296de0e3") }
  return { variant: "secondary", label: uiText("idle_dae661d1") }
}

function lastRunTime(s: ScheduleEntry): string {
  return formatTime(s.state?.last_success_at ?? s.state?.last_finished_at)
}

export function SettingsSchedules() {
  useUiLocale()
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
      .catch((e) => setLoadError(uiText("could_not_load_scheduled_tasks_563b447d", { v0: errorMessage(e) })))
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
      setFormError(uiText("enter_a_name_fbc79033"))
      return
    }
    const { trigger, error } = buildTriggerFromValues(form)
    if (!trigger) {
      setFormError(error ?? uiText("complete_the_trigger_configuration_52bf2a1f"))
      return
    }
    // Editing round-trips the original run_config so fields this form doesn't
    // edit (e.g. reasoning_effort) survive the backend's wholesale replace.
    const original = editId ? items.find((s) => s.id === editId)?.run_config : null
    const runConfig = buildRunConfig(form, original)
    if (form.auto_execute && !runConfig.task_message) {
      setFormError(uiText("task_content_is_required_for_automatic_execution_81c44cf1"))
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
      setFormError(uiText("could_not_save_c4b7c511", { v0: errorMessage(e) }))
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
        <p className="text-xs text-muted-foreground">{uiText("tasks_triggered_automatically_on_a_schedule_3d3799a3")}</p>
        {!adding && !editId ? (
          <Button size="sm" variant="secondary" onClick={openAdd}>
            <Plus className="size-4" />{uiText("add_0006d696")}</Button>
        ) : null}
      </div>

      {adding ? (
        <ScheduleForm
          values={form}
          onChange={patchForm}
          error={formError}
          saving={saving}
          submitLabel={uiText("add_7a8a11ea")}
          onSubmit={save}
          onCancel={closeForm}
        />
      ) : null}

      {loadError ? <p className="text-xs text-destructive">{loadError}</p> : null}
      {actionError ? <p className="text-xs text-destructive">{uiText("operation_failed_db63436a")}{actionError}</p> : null}
      {actionNotice ? <p className="text-xs text-primary">{actionNotice}</p> : null}

      {loading ? (
        <p className="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
      ) : items.length === 0 ? (
        !adding && <p className="text-xs text-muted-foreground">{uiText("no_scheduled_tasks_yet_d55f6399")}</p>
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
                      aria-label={s.enabled ? uiText("disable_4e6fd0e2") : uiText("enabled_f4f0ead1")}
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
                    {s.run_config?.auto_execute ? <span>{uiText("automatic_execution_ad0af2bd")}</span> : null}
                    {s.run_config?.model ? <span>· {s.run_config.model}</span> : null}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {uiText("next_6f7517d2")} {formatTime(s.state?.next_fire_at)} {uiText("last_a3c43f9e")} {lastRunTime(s)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {uiText("successful_053461ce")} {s.state?.total_success_count ?? 0} {uiText("failed_89661a55")} {s.state?.total_failure_count ?? 0} {uiText("missed_e550d27f")}{" "}
                    {s.state?.total_missed_count ?? 0} {uiText("total_c8b28178")} {uiText("count_runs", { count: s.state?.total_run_count ?? 0 })}</div>

                  <div className="flex items-center gap-1 pt-1">
                    <button
                      onClick={() =>
                        runAction(async () => {
                          await agentClient.runScheduleNow(s.id)
                        }, uiText("was_queued_for_execution_dea579f0", { v0: s.name }))
                      }
                      aria-label={uiText("run_now_04eb5397")}
                      title={uiText("run_now_04eb5397")}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      <Play className="size-4" />
                    </button>
                    <button
                      onClick={() => setExpandedRunsId((id) => (id === s.id ? null : s.id))}
                      aria-label={uiText("runs_6e55e0f2")}
                      title={uiText("runs_6e55e0f2")}
                      className={cn(
                        "rounded p-1 hover:text-foreground",
                        expandedRunsId === s.id ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      <History className="size-4" />
                    </button>
                    <button
                      onClick={() => (isEditing ? closeForm() : openEdit(s))}
                      aria-label={uiText("edit_05183656")}
                      title={uiText("edit_05183656")}
                      className={cn(
                        "rounded p-1 hover:text-foreground",
                        isEditing ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId((id) => (id === s.id ? null : s.id))}
                      aria-label={uiText("delete_2f9daa82")}
                      title={uiText("delete_2f9daa82")}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>

                  {deleteConfirmId === s.id ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5">
                      <span className="text-xs text-destructive">{uiText("delete_schedule_confirmation", { name: s.name })}</span>
                      <div className="flex shrink-0 gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setDeleteConfirmId(null)}>
                          {uiText("cancel_2cd0f3be")}</Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setDeleteConfirmId(null)
                            void runAction(async () => {
                              await agentClient.deleteSchedule(s.id)
                            }, uiText("deleted_2c8bfdf9", { v0: s.name }))
                          }}
                        >
                          {uiText("delete_2f9daa82")}</Button>
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
                      submitLabel={uiText("save_a3030bf8")}
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
