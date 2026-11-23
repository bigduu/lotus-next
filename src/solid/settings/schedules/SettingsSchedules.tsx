import { createSignal, For, onSettled, Show } from "solid-js"
import { History, Pencil, Play, Plus, Trash2 } from "@lucide/solid"
import { agentClient, type ScheduleEntry } from "@services/chat/AgentService"
import {
  DEFAULT_FORM_VALUES, buildMisfirePolicy, buildRunConfig, buildTriggerFromValues,
  errorMessage, formatTime, misfireSummary, normalizedString, overlapSummary,
  scheduleToFormValues, triggerSummary, type ScheduleFormValues,
} from "@/components/chat/settings/schedules/scheduleModel"
import { cn } from "@/lib/utils"
import { createUiLocale, createUiText } from "../../shell/uiText"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import { Switch } from "../../ui/switch"
import { ScheduleForm } from "./ScheduleForm"
import { ScheduleRuns } from "./ScheduleRuns"

function statusBadge(item: ScheduleEntry, text: ReturnType<typeof createUiText>) {
  const state = item.state
  if (state?.running_run_count > 0) return { variant: "default", label: text("running_2fe78a4f", { v0: state.running_run_count }) } as const
  if (state?.queued_run_count > 0) return { variant: "warning", label: text("queued_26a1886e", { v0: state.queued_run_count }) } as const
  if (state?.consecutive_failures > 0) return { variant: "destructive", label: text("consecutive_failures_246d1740", { v0: state.consecutive_failures }) } as const
  if (!item.enabled) return { variant: "secondary", label: text("disabled_a8c3698b") } as const
  if (state?.last_success_at) return { variant: "success", label: text("healthy_296de0e3") } as const
  return { variant: "secondary", label: text("idle_dae661d1") } as const
}

export function SettingsSchedules() {
  const text = createUiText()
  const locale = createUiLocale()
  const [items, setItems] = createSignal<ScheduleEntry[]>([])
  const [loading, setLoading] = createSignal(true)
  const [loadError, setLoadError] = createSignal<string | null>(null)
  const [formTarget, setFormTarget] = createSignal<{ id: string | null } | null>(null)
  const [form, setForm] = createSignal<ScheduleFormValues>(DEFAULT_FORM_VALUES)
  const [formError, setFormError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [actionError, setActionError] = createSignal<string | null>(null)
  const [actionNotice, setActionNotice] = createSignal<string | null>(null)
  const [expanded, setExpanded] = createSignal<string | null>(null)
  const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null)
  const [runHistoryRevision, setRunHistoryRevision] = createSignal(0)
  let active = true
  let readVersion = 0
  let mutating = false

  async function reload() {
    if (!active) return
    const version = ++readVersion
    setLoadError(null)
    try {
      const result = await agentClient.listSchedules()
      if (active && version === readVersion) setItems(result.schedules ?? [])
    } catch (failure) {
      if (active && version === readVersion) setLoadError(errorMessage(failure))
    } finally {
      if (active && version === readVersion) setLoading(false)
    }
  }

  onSettled(() => {
    void reload()
    return () => { active = false }
  })

  function openForm(item?: ScheduleEntry) {
    if (mutating) return
    setForm(item ? scheduleToFormValues(item) : DEFAULT_FORM_VALUES)
    setFormError(null)
    setFormTarget({ id: item?.id ?? null })
  }

  function closeForm() {
    setFormTarget(null)
    setFormError(null)
  }

  async function save() {
    const target = formTarget()
    if (!active || mutating || !target) return
    const values = form()
    if (!values.name.trim()) { setFormError(text("enter_a_name_fbc79033")); return }
    const validation = buildTriggerFromValues(values)
    if (!validation.trigger) {
      setFormError(validation.error ?? text("complete_the_trigger_configuration_52bf2a1f"))
      return
    }
    const original = target.id ? items().find((item) => item.id === target.id)?.run_config : null
    const runConfig = buildRunConfig(values, original)
    if (values.auto_execute && !runConfig.task_message) {
      setFormError(text("task_content_is_required_for_automatic_execution_81c44cf1"))
      return
    }
    const patch = {
      name: values.name.trim(), enabled: values.enabled, trigger: validation.trigger,
      timezone: normalizedString(values.timezone), start_at: normalizedString(values.start_at), end_at: normalizedString(values.end_at),
      misfire_policy: buildMisfirePolicy(values), overlap_policy: values.overlap_policy, run_config: runConfig,
    }
    mutating = true
    setBusy(true)
    setFormError(null)
    try {
      if (target.id) await agentClient.patchSchedule(target.id, patch)
      else await agentClient.createSchedule(patch)
      if (active && formTarget() === target) closeForm()
    } catch (failure) {
      if (active) setFormError(text("could_not_save_c4b7c511", { v0: errorMessage(failure) }))
    } finally {
      if (active) { await reload(); setBusy(false) }
      mutating = false
    }
  }

  async function runAction(request: () => Promise<unknown>, notice?: string, refreshRuns = false) {
    if (!active || mutating) return
    mutating = true
    setBusy(true)
    setActionError(null)
    setActionNotice(null)
    try {
      await request()
      if (active && notice) setActionNotice(notice)
    } catch (failure) {
      if (active) setActionError(errorMessage(failure))
    } finally {
      if (active) {
        await reload()
        if (refreshRuns) setRunHistoryRevision((value) => value + 1)
        setBusy(false)
      }
      mutating = false
    }
  }

  const editor = (adding: boolean) => <ScheduleForm values={form()} error={formError()} saving={busy()}
    onChange={(patch) => { if (!mutating) setForm((current) => ({ ...current, ...patch })) }}
    submitLabel={text(adding ? "add_7a8a11ea" : "save_a3030bf8")} onSubmit={() => void save()} onCancel={closeForm} />
  const time = (value: string | null | undefined) => { locale(); return formatTime(value) }
  const trigger = (value: ScheduleEntry["trigger"]) => { locale(); return triggerSummary(value) }
  const misfire = (value: ScheduleEntry["misfire_policy"]) => { locale(); return misfireSummary(value) }
  const overlap = (value: ScheduleEntry["overlap_policy"]) => { locale(); return overlapSummary(value) }

  return <div class="space-y-3" data-settings-schedules="">
    <div class="flex items-center justify-between gap-2">
      <p class="text-xs text-muted-foreground">{text("tasks_triggered_automatically_on_a_schedule_3d3799a3")}</p>
      <Show when={!formTarget()}>
        <Button type="button" size="sm" variant="secondary" disabled={busy() || loading()} onClick={() => openForm()}>
          <Plus class="size-4" aria-hidden="true" />{text("add_0006d696")}
        </Button>
      </Show>
    </div>
    <Show when={formTarget()?.id === null}>{editor(true)}</Show>
    <Show when={loadError()}>
      <div class="flex items-center justify-between gap-2">
        <p role="alert" class="text-xs text-destructive">{text("could_not_load_scheduled_tasks_563b447d", { v0: loadError() })}</p>
        <Button type="button" size="sm" variant="secondary" disabled={busy()} onClick={() => void reload()}>{text("retry_b8784c8d")}</Button>
      </div>
    </Show>
    <Show when={actionError()}><p role="alert" class="text-xs text-destructive">{text("operation_failed_db63436a")}{actionError()}</p></Show>
    <Show when={actionNotice()}><p role="status" class="text-xs text-primary">{actionNotice()}</p></Show>
    <Show when={!loading()} fallback={<p role="status" class="text-xs text-muted-foreground">{text("loading_4927a53b")}</p>}>
      <Show when={items().length > 0} fallback={
        <Show when={!formTarget() && !loadError()}><p class="text-xs text-muted-foreground">{text("no_scheduled_tasks_yet_d55f6399")}</p></Show>
      }>
        <ul class="space-y-2">
          <For each={items()} keyed={(item) => item.id}>{(item) => {
            const status = () => statusBadge(item(), text)
            const state = () => item().state
            const editing = () => formTarget()?.id === item().id
            const showingRuns = () => expanded() === item().id
            return <li class="rounded-lg border" data-schedule={item().id}>
              <div class="space-y-1.5 p-3">
                <div class="flex items-center gap-2">
                  <div class="min-w-0 flex-1 truncate text-sm font-medium">{item().name}</div>
                  <Badge variant={status().variant}>{status().label}</Badge>
                  <Switch checked={item().enabled} disabled={busy()}
                    aria-label={text(item().enabled ? "disable_4e6fd0e2" : "enable_action")}
                    onCheckedChange={(enabled) => void runAction(() => agentClient.patchSchedule(item().id, { enabled }))} />
                </div>
                <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{trigger(item().trigger)}</span>
                  <Show when={item().timezone}><span>· {item().timezone}</span></Show>
                  <span>· {misfire(item().misfire_policy)}</span><span>· {overlap(item().overlap_policy)}</span>
                  <Show when={item().run_config?.auto_execute}><span>{text("automatic_execution_ad0af2bd")}</span></Show>
                  <Show when={item().run_config?.model}><span>· {item().run_config?.model}</span></Show>
                </div>
                <div class="text-xs text-muted-foreground">
                  {text("next_6f7517d2")} {time(state()?.next_fire_at)} {text("last_a3c43f9e")} {time(state()?.last_success_at ?? state()?.last_finished_at)}
                </div>
                <div class="text-xs text-muted-foreground">
                  {text("successful_053461ce")} {state()?.total_success_count ?? 0} {text("failed_89661a55")} {state()?.total_failure_count ?? 0} {text("missed_e550d27f")} {state()?.total_missed_count ?? 0} {text("total_c8b28178")} {text("count_runs", { count: state()?.total_run_count ?? 0 })}
                </div>
                <div class="flex items-center gap-1 pt-1">
                  <Button type="button" size="icon" variant="ghost" class="size-7 text-muted-foreground" disabled={busy()}
                    aria-label={text("run_now_04eb5397")} title={text("run_now_04eb5397")}
                    onClick={() => void runAction(() => agentClient.runScheduleNow(item().id), text("was_queued_for_execution_dea579f0", { v0: item().name }), true)}>
                    <Play class="size-4" aria-hidden="true" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" class={cn("size-7", showingRuns() ? "text-primary" : "text-muted-foreground")}
                    aria-label={text("runs_6e55e0f2")} title={text("runs_6e55e0f2")} aria-expanded={showingRuns() ? "true" : "false"}
                    onClick={() => setExpanded(showingRuns() ? null : item().id)}>
                    <History class="size-4" aria-hidden="true" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" class={cn("size-7", editing() ? "text-primary" : "text-muted-foreground")}
                    disabled={busy()} aria-label={text("edit_05183656")} title={text("edit_05183656")}
                    onClick={() => editing() ? closeForm() : openForm(item())}>
                    <Pencil class="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" class="size-7 text-muted-foreground hover:text-destructive"
                    disabled={busy()} aria-label={text("delete_2f9daa82")} title={text("delete_2f9daa82")}
                    onClick={() => setConfirmDelete((id) => id === item().id ? null : item().id)}>
                    <Trash2 class="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
                <Show when={confirmDelete() === item().id}>
                  <div class="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5">
                    <span class="text-xs text-destructive">{text("delete_schedule_confirmation", { name: item().name })}</span>
                    <div class="flex shrink-0 gap-1.5">
                      <Button type="button" size="sm" variant="secondary" disabled={busy()} onClick={() => setConfirmDelete(null)}>{text("cancel_2cd0f3be")}</Button>
                      <Button type="button" size="sm" variant="destructive" disabled={busy()} onClick={() => {
                        const id = item().id
                        setConfirmDelete(null)
                        void runAction(async () => {
                          await agentClient.deleteSchedule(id)
                          if (active && formTarget()?.id === id) closeForm()
                        }, text("deleted_2c8bfdf9", { v0: item().name }))
                      }}>{text("delete_2f9daa82")}</Button>
                    </div>
                  </div>
                </Show>
              </div>
              <Show when={editing()}><div class="border-t p-2">{editor(false)}</div></Show>
              <Show when={showingRuns()}><div class="border-t px-2 py-1">
                <ScheduleRuns scheduleId={item().id} revision={runHistoryRevision()} />
              </div></Show>
            </li>
          }}</For>
        </ul>
      </Show>
    </Show>
  </div>
}
