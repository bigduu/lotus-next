import { createSignal, For, Match, Show, Switch as Cases } from "solid-js"
import { cn } from "@/lib/utils"
import {
  MISFIRE_OPTIONS, OVERLAP_OPTIONS, TRIGGER_TYPE_OPTIONS, WEEKDAY_OPTIONS,
  type IntervalUnit, type ScheduleFormValues, type WeeklyWeekday,
} from "@/lib/settings/scheduleModel"
import { createUiLocale, createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Select } from "../../ui/select"
import { Switch } from "../../ui/switch"
import { Textarea } from "../../ui/textarea"

interface FormProps {
  values: ScheduleFormValues
  onChange: (patch: Partial<ScheduleFormValues>) => void
  error: string | null
  saving: boolean
  submitLabel: string
  onSubmit: () => void
  onCancel: () => void
}

function Field(props: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  multiline?: boolean
  class?: string
  type?: "number" | "text"
  min?: number
  max?: number
}) {
  return <label class={cn("block min-w-0 space-y-1", props.class)}>
    <span class="block text-xs font-medium text-muted-foreground">{props.label}</span>
    <Show when={props.multiline} fallback={
      <Input type={props.type ?? "text"} min={props.min} max={props.max}
        value={props.value} placeholder={props.placeholder} onInput={(event) => props.onChange(event.currentTarget.value)} />
    }>
      <Textarea class="min-h-12 resize-y" value={props.value} placeholder={props.placeholder}
        onInput={(event) => props.onChange(event.currentTarget.value)} />
    </Show>
  </label>
}

function ScheduleSelect<T extends string>(props: {
  label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void
}) {
  const locale = createUiLocale()
  const options = () => {
    locale()
    return props.options.map((option) => ({ value: option.value, label: option.label }))
  }
  return <div class="min-w-0 flex-1 space-y-1">
    <span class="block text-xs font-medium text-muted-foreground">{props.label}</span>
    <Select label={props.label} class="w-full" options={options()} value={props.value}
      onValueChange={(value) => props.onChange(value as T)} />
  </div>
}

export function ScheduleForm(props: FormProps) {
  const text = createUiText()
  const locale = createUiLocale()
  const [advanced, setAdvanced] = createSignal(false)
  const values = () => props.values
  type TextField = { [K in keyof ScheduleFormValues]: ScheduleFormValues[K] extends string ? K : never }[keyof ScheduleFormValues]
  const change = (field: TextField) => (value: string) => props.onChange({ [field]: value })
  const intervalUnits = () => [
    { value: "minutes", label: text("minute_bd957bc4") },
    { value: "hours", label: text("hour_3b6fefc5") },
    { value: "seconds", label: text("seconds_9dcdc2b2") },
  ] satisfies Array<{ value: IntervalUnit; label: string }>
  const weekdayLabel = (option: (typeof WEEKDAY_OPTIONS)[number]) => { locale(); return option.label }
  function toggle(day: WeeklyWeekday) {
    const selected = values().weekly_weekdays
    props.onChange({ weekly_weekdays: selected.includes(day) ? selected.filter((value) => value !== day) : [...selected, day] })
  }

  return <form class="space-y-3 rounded-lg border bg-muted/30 p-3" onSubmit={(event) => {
    event.preventDefault()
    if (!props.saving) props.onSubmit()
  }} novalidate>
    <fieldset disabled={props.saving} class="min-w-0 space-y-3">
      <div class="flex items-end gap-2">
        <Field label={text("name_d44e9b3d")} class="flex-1" value={values().name} onChange={change("name")}
          placeholder={text("scheduled_task_name_b1066de6")} />
        <label class="flex h-9 shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {text("enabled_f4f0ead1")}
          <Switch checked={values().enabled} disabled={props.saving} aria-label={text("enabled_f4f0ead1")}
            onCheckedChange={(enabled) => props.onChange({ enabled })} />
        </label>
      </div>

      <section class="space-y-2.5 rounded-lg border bg-background/50 p-3">
        <h3 class="text-xs font-medium text-muted-foreground">{text("trigger_250bf9d5")}</h3>
        <ScheduleSelect label={text("trigger_type_97577ce7")} options={TRIGGER_TYPE_OPTIONS} value={values().trigger_type}
          onChange={(trigger_type) => props.onChange({ trigger_type })} />
        <Cases>
          <Match when={values().trigger_type === "interval"}>
            <div class="flex gap-2">
              <Field label={text("every_100107ff")} class="flex-1" value={values().interval_value} type="number" min={1} onChange={change("interval_value")} />
              <ScheduleSelect label={text("unit_80b19d68")} options={intervalUnits()} value={values().interval_unit}
                onChange={(interval_unit) => props.onChange({ interval_unit })} />
            </div>
          </Match>
          <Match when={values().trigger_type === "weekly"}>
            <div>
              <div class="mb-1 text-xs font-medium text-muted-foreground">{text("weekdays_c398134d")}</div>
              <div class="flex flex-wrap gap-1.5">
                <For each={WEEKDAY_OPTIONS}>{(option) => {
                  const selected = () => values().weekly_weekdays.includes(option.value)
                  return <button type="button" aria-pressed={selected() ? "true" : "false"} onClick={() => toggle(option.value)}
                    class={cn("size-8 rounded-md border text-xs transition-colors", selected()
                      ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground")}>
                    {weekdayLabel(option)}
                  </button>
                }}</For>
              </div>
            </div>
          </Match>
          <Match when={values().trigger_type === "monthly"}>
            <Field label={text("days_of_month_1_31_comma_separated_4ac9fe92")} value={values().monthly_days}
              onChange={change("monthly_days")} placeholder={text("e_g_1_15_81eec894")} />
          </Match>
          <Match when={values().trigger_type === "cron"}>
            <Field label={text("cron_expression_b505ad2e")} value={values().cron_expr}
              onChange={change("cron_expr")} placeholder={text("e_g_0_9_0ab6b096")} />
          </Match>
        </Cases>
        <Show when={values().trigger_type === "daily" || values().trigger_type === "weekly" || values().trigger_type === "monthly"}>
          <div class="flex gap-2">
            <Field label={text("hour_0_23_67d64c5b")} class="flex-1" value={values().hour} type="number" min={0} max={23} onChange={change("hour")} />
            <Field label={text("minute_0_59_5162a1bb")} class="flex-1" value={values().minute} type="number" min={0} max={59} onChange={change("minute")} />
          </div>
        </Show>
      </section>

      <section class="space-y-2.5 rounded-lg border bg-background/50 p-3">
        <h3 class="text-xs font-medium text-muted-foreground">{text("execution_content_7007f0b1")}</h3>
        <Field label={text("task_content_2b7e32bf")} value={values().task_message} multiline onChange={change("task_message")}
          placeholder={text("task_content_required_for_automatic_execution_f5e84230")} />
        <label class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          {text("automatic_execution_run_the_task_when_triggered_b6df1e0d")}
          <Switch checked={values().auto_execute} disabled={props.saving} aria-label={text("automatic_execution_ad0af2bd")}
            onCheckedChange={(auto_execute) => props.onChange({ auto_execute })} />
        </label>
        <div class="flex gap-2">
          <Field label={text("model_optional_5a32d134")} class="flex-1" value={values().model} onChange={change("model")}
            placeholder={text("default_model_1e2933c6")} />
          <Field label={text("working_directory_optional_3102ad46")} class="flex-1" value={values().workspace_path} onChange={change("workspace_path")}
            placeholder={text("workspace_path_c311026e")} />
        </div>
        <Field label={text("system_prompt_optional_86495286")} value={values().system_prompt} multiline onChange={change("system_prompt")}
          placeholder={text("override_the_default_system_prompt_f1aced6d")} />
      </section>

      <button type="button" aria-expanded={advanced() ? "true" : "false"} onClick={() => setAdvanced((value) => !value)}
        class="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        {text(advanced() ? "collapse_advanced_options_29272cf0" : "advanced_options_policies_time_zone_effective_period_464f52f2")}
      </button>
      <Show when={advanced()}>
        <section class="space-y-2.5 rounded-lg border bg-background/50 p-3">
          <h3 class="text-xs font-medium text-muted-foreground">{text("advanced_d6e61888")}</h3>
          <div class="flex gap-2">
            <ScheduleSelect label={text("misfire_policy_7c12f054")} options={MISFIRE_OPTIONS} value={values().misfire_policy}
              onChange={(misfire_policy) => props.onChange({ misfire_policy })} />
            <ScheduleSelect label={text("overlap_policy_5a3f749e")} options={OVERLAP_OPTIONS} value={values().overlap_policy}
              onChange={(overlap_policy) => props.onChange({ overlap_policy })} />
          </div>
          <Show when={values().misfire_policy === "catch_up_window"}>
            <div class="flex gap-2">
              <Field label={text("maximum_catch_up_runs_e6aa309b")} class="flex-1" value={values().catch_up_max_runs}
                type="number" min={1} onChange={change("catch_up_max_runs")} />
              <Field label={text("maximum_delay_seconds_f2bdfce4")} class="flex-1" value={values().catch_up_max_lateness_seconds}
                type="number" min={1} onChange={change("catch_up_max_lateness_seconds")} />
            </div>
          </Show>
          <Field label={text("time_zone_optional_7b17e06a")} value={values().timezone} onChange={change("timezone")}
            placeholder={text("e_g_asia_shanghai_790169bf")} />
          <div class="flex gap-2">
            <Field label={text("start_time_optional_d43c4ece")} class="flex-1" value={values().start_at} onChange={change("start_at")} placeholder="2026-01-01T00:00:00Z" />
            <Field label={text("end_time_optional_f5b079bd")} class="flex-1" value={values().end_at} onChange={change("end_at")} placeholder="2026-12-31T00:00:00Z" />
          </div>
          <p class="text-[11px] text-muted-foreground">{text("clearing_the_time_zone_start_or_end_fields_and_saving_d_60ffce38")}</p>
          <Field label={text("enhancement_prompt_optional_439879c2")} value={values().enhance_prompt} multiline
            onChange={change("enhance_prompt")} placeholder={text("enhancement_text_appended_to_the_task_c98fca6e")} />
        </section>
      </Show>
    </fieldset>
    <Show when={props.error}><p role="alert" class="text-xs text-destructive">{props.error}</p></Show>
    <div class="flex justify-end gap-2">
      <Button type="button" size="sm" variant="secondary" onClick={() => props.onCancel()} disabled={props.saving}>{text("cancel_2cd0f3be")}</Button>
      <Button type="submit" size="sm" disabled={props.saving || !values().name.trim()}>{props.saving ? text("saving_ff509c9b") : props.submitLabel}</Button>
    </div>
  </form>
}
