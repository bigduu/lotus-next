import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useState } from "react"
import type { OverlapPolicy } from "@services/chat/AgentService"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  type IntervalUnit,
  type MisfirePolicyType,
  type ScheduleFormValues,
  type TriggerType,
  type WeeklyWeekday,
  MISFIRE_OPTIONS,
  OVERLAP_OPTIONS,
  TRIGGER_TYPE_OPTIONS,
  WEEKDAY_OPTIONS,
} from "./scheduleModel"

function FieldLabel({ children }: { children: React.ReactNode }) {
  useUiLocale()
  return <div className="mb-1 text-xs font-medium text-muted-foreground">{children}</div>
}

function HourMinuteFields({
  values,
  onChange,
}: {
  values: ScheduleFormValues
  onChange: (patch: Partial<ScheduleFormValues>) => void
}) {
  useUiLocale()
  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <FieldLabel>{uiText("hour_0_23_67d64c5b")}</FieldLabel>
        <Input
          type="number"
          min={0}
          max={23}
          value={values.hour}
          onChange={(e) => onChange({ hour: e.target.value })}
        />
      </div>
      <div className="flex-1">
        <FieldLabel>{uiText("minute_0_59_5162a1bb")}</FieldLabel>
        <Input
          type="number"
          min={0}
          max={59}
          value={values.minute}
          onChange={(e) => onChange({ minute: e.target.value })}
        />
      </div>
    </div>
  )
}

export function ScheduleForm({
  values,
  onChange,
  error,
  saving,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  values: ScheduleFormValues
  onChange: (patch: Partial<ScheduleFormValues>) => void
  error: string | null
  saving: boolean
  submitLabel: string
  onSubmit: () => void
  onCancel: () => void
}) {
  useUiLocale()
  const [showAdvanced, setShowAdvanced] = useState(false)

  const toggleWeekday = (day: WeeklyWeekday) => {
    const has = values.weekly_weekdays.includes(day)
    onChange({
      weekly_weekdays: has
        ? values.weekly_weekdays.filter((d) => d !== day)
        : [...values.weekly_weekdays, day],
    })
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <FieldLabel>{uiText("name_d44e9b3d")}</FieldLabel>
          <Input
            placeholder={uiText("scheduled_task_name_b1066de6")}
            value={values.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <label className="flex h-9 shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {uiText("enabled_f4f0ead1")} <Switch checked={values.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
        </label>
      </div>

      <section className="rounded-lg border bg-background/50 p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("trigger_250bf9d5")}</div>
        <div className="space-y-2.5">
          <div>
            <FieldLabel>{uiText("trigger_type_97577ce7")}</FieldLabel>
            <Select
              value={values.trigger_type}
              onValueChange={(v) => onChange({ trigger_type: v as TriggerType })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIGGER_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {values.trigger_type === "interval" ? (
            <div className="flex gap-2">
              <div className="flex-1">
                <FieldLabel>{uiText("every_100107ff")}</FieldLabel>
                <Input
                  type="number"
                  min={1}
                  value={values.interval_value}
                  onChange={(e) => onChange({ interval_value: e.target.value })}
                />
              </div>
              <div className="w-28 shrink-0">
                <FieldLabel>{uiText("unit_80b19d68")}</FieldLabel>
                <Select
                  value={values.interval_unit}
                  onValueChange={(v) => onChange({ interval_unit: v as IntervalUnit })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">{uiText("minute_bd957bc4")}</SelectItem>
                    <SelectItem value="hours">{uiText("hour_3b6fefc5")}</SelectItem>
                    <SelectItem value="seconds">{uiText("seconds_9dcdc2b2")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {values.trigger_type === "daily" ? (
            <HourMinuteFields values={values} onChange={onChange} />
          ) : null}

          {values.trigger_type === "weekly" ? (
            <>
              <div>
                <FieldLabel>{uiText("weekdays_c398134d")}</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAY_OPTIONS.map((o) => {
                    const active = values.weekly_weekdays.includes(o.value)
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => toggleWeekday(o.value)}
                        className={cn(
                          "size-8 rounded-md border text-xs transition-colors",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {o.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <HourMinuteFields values={values} onChange={onChange} />
            </>
          ) : null}

          {values.trigger_type === "monthly" ? (
            <>
              <div>
                <FieldLabel>{uiText("days_of_month_1_31_comma_separated_4ac9fe92")}</FieldLabel>
                <Input
                  placeholder={uiText("e_g_1_15_81eec894")}
                  value={values.monthly_days}
                  onChange={(e) => onChange({ monthly_days: e.target.value })}
                />
              </div>
              <HourMinuteFields values={values} onChange={onChange} />
            </>
          ) : null}

          {values.trigger_type === "cron" ? (
            <div>
              <FieldLabel>{uiText("cron_expression_b505ad2e")}</FieldLabel>
              <Input
                placeholder={uiText("e_g_0_9_0ab6b096")}
                value={values.cron_expr}
                onChange={(e) => onChange({ cron_expr: e.target.value })}
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-background/50 p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("execution_content_7007f0b1")}</div>
        <div className="space-y-2.5">
          <div>
            <FieldLabel>{uiText("task_content_2b7e32bf")}</FieldLabel>
            <Textarea
              className="min-h-16 resize-y"
              placeholder={uiText("task_content_required_for_automatic_execution_f5e84230")}
              value={values.task_message}
              onChange={(e) => onChange({ task_message: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{uiText("automatic_execution_run_the_task_when_triggered_b6df1e0d")}</span>
            <Switch
              checked={values.auto_execute}
              onCheckedChange={(v) => onChange({ auto_execute: v })}
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <FieldLabel>{uiText("model_optional_5a32d134")}</FieldLabel>
              <Input
                placeholder={uiText("default_model_1e2933c6")}
                value={values.model}
                onChange={(e) => onChange({ model: e.target.value })}
              />
            </div>
            <div className="flex-1">
              <FieldLabel>{uiText("working_directory_optional_3102ad46")}</FieldLabel>
              <Input
                placeholder={uiText("workspace_path_c311026e")}
                value={values.workspace_path}
                onChange={(e) => onChange({ workspace_path: e.target.value })}
              />
            </div>
          </div>
          <div>
            <FieldLabel>{uiText("system_prompt_optional_86495286")}</FieldLabel>
            <Textarea
              className="min-h-12 resize-y"
              placeholder={uiText("override_the_default_system_prompt_f1aced6d")}
              value={values.system_prompt}
              onChange={(e) => onChange({ system_prompt: e.target.value })}
            />
          </div>
        </div>
      </section>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {showAdvanced ? uiText("collapse_advanced_options_29272cf0") : uiText("advanced_options_policies_time_zone_effective_period_464f52f2")}
      </button>

      {showAdvanced ? (
        <section className="rounded-lg border bg-background/50 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("advanced_d6e61888")}</div>
          <div className="space-y-2.5">
            <div className="flex gap-2">
              <div className="flex-1">
                <FieldLabel>{uiText("misfire_policy_7c12f054")}</FieldLabel>
                <Select
                  value={values.misfire_policy}
                  onValueChange={(v) => onChange({ misfire_policy: v as MisfirePolicyType })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MISFIRE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <FieldLabel>{uiText("overlap_policy_5a3f749e")}</FieldLabel>
                <Select
                  value={values.overlap_policy}
                  onValueChange={(v) => onChange({ overlap_policy: v as OverlapPolicy })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OVERLAP_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {values.misfire_policy === "catch_up_window" ? (
              <div className="flex gap-2">
                <div className="flex-1">
                  <FieldLabel>{uiText("maximum_catch_up_runs_e6aa309b")}</FieldLabel>
                  <Input
                    type="number"
                    min={1}
                    value={values.catch_up_max_runs}
                    onChange={(e) => onChange({ catch_up_max_runs: e.target.value })}
                  />
                </div>
                <div className="flex-1">
                  <FieldLabel>{uiText("maximum_delay_seconds_f2bdfce4")}</FieldLabel>
                  <Input
                    type="number"
                    min={1}
                    value={values.catch_up_max_lateness_seconds}
                    onChange={(e) => onChange({ catch_up_max_lateness_seconds: e.target.value })}
                  />
                </div>
              </div>
            ) : null}

            <div>
              <FieldLabel>{uiText("time_zone_optional_7b17e06a")}</FieldLabel>
              <Input
                placeholder={uiText("e_g_asia_shanghai_790169bf")}
                value={values.timezone}
                onChange={(e) => onChange({ timezone: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <FieldLabel>{uiText("start_time_optional_d43c4ece")}</FieldLabel>
                <Input
                  placeholder="2026-01-01T00:00:00Z"
                  value={values.start_at}
                  onChange={(e) => onChange({ start_at: e.target.value })}
                />
              </div>
              <div className="flex-1">
                <FieldLabel>{uiText("end_time_optional_f5b079bd")}</FieldLabel>
                <Input
                  placeholder="2026-12-31T00:00:00Z"
                  value={values.end_at}
                  onChange={(e) => onChange({ end_at: e.target.value })}
                />
              </div>
            </div>
            {/* Backend PATCH can't distinguish "missing" from "clear" for these
                Option fields — an emptied value is simply not sent, so the
                stored value stays. Be honest about it instead of silently
                pretending the clear persisted. */}
            <p className="text-[11px] text-muted-foreground">
              {uiText("clearing_the_time_zone_start_or_end_fields_and_saving_d_60ffce38")}</p>
            <div>
              <FieldLabel>{uiText("enhancement_prompt_optional_439879c2")}</FieldLabel>
              <Textarea
                className="min-h-12 resize-y"
                placeholder={uiText("enhancement_text_appended_to_the_task_c98fca6e")}
                value={values.enhance_prompt}
                onChange={(e) => onChange({ enhance_prompt: e.target.value })}
              />
            </div>
          </div>
        </section>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
          {uiText("cancel_2cd0f3be")}</Button>
        <Button size="sm" onClick={onSubmit} disabled={saving || !values.name.trim()}>
          {saving ? uiText("saving_ff509c9b") : submitLabel}
        </Button>
      </div>
    </div>
  )
}
