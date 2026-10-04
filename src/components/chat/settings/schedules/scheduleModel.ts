import { uiText, uiLanguage, uiList } from "@shared/i18n/ui"
import type {
  MisfirePolicy,
  OverlapPolicy,
  ScheduleEntry,
  ScheduleRunConfig,
  ScheduleTrigger,
} from "@services/chat/AgentService"

export type TriggerType = ScheduleTrigger["type"]
export type WeeklyWeekday = Extract<ScheduleTrigger, { type: "weekly" }>["weekdays"][number]
export type MisfirePolicyType = MisfirePolicy["type"]
export type IntervalUnit = "seconds" | "minutes" | "hours"

export const WEEKDAY_OPTIONS: Array<{ value: WeeklyWeekday; label: string }> = [
  { value: "mon", get label() { return uiText("mon_51a75f46") } },
  { value: "tue", get label() { return uiText("tue_084b42f6") } },
  { value: "wed", get label() { return uiText("wed_a4c3313d") } },
  { value: "thu", get label() { return uiText("thu_754a9d58") } },
  { value: "fri", get label() { return uiText("fri_c9b87f51") } },
  { value: "sat", get label() { return uiText("sat_de07b538") } },
  { value: "sun", get label() { return uiText("sun_85217f7a") } },
]

export const TRIGGER_TYPE_OPTIONS: Array<{ value: TriggerType; label: string }> = [
  { value: "interval", get label() { return uiText("interval_4f5df723") } },
  { value: "daily", get label() { return uiText("daily_eea1694c") } },
  { value: "weekly", get label() { return uiText("weekly_92845d3b") } },
  { value: "monthly", get label() { return uiText("monthly_68b21af9") } },
  { value: "cron", label: "Cron" },
]

export const MISFIRE_OPTIONS: Array<{ value: MisfirePolicyType; label: string }> = [
  { value: "run_once", get label() { return uiText("catch_up_once_c2096e4c") } },
  { value: "skip", get label() { return uiText("skip_fc50a99c") } },
  { value: "catch_up_all", get label() { return uiText("catch_up_all_06529cda") } },
  { value: "catch_up_window", get label() { return uiText("catch_up_within_window_28b614d7") } },
]

export const OVERLAP_OPTIONS: Array<{ value: OverlapPolicy; label: string }> = [
  { value: "queue_one", get label() { return uiText("queue_one_1d2609b4") } },
  { value: "skip", get label() { return uiText("skip_fc50a99c") } },
  { value: "allow", get label() { return uiText("allow_parallel_runs_33ce425a") } },
]

export interface ScheduleFormValues {
  name: string
  enabled: boolean
  trigger_type: TriggerType
  interval_value: string
  interval_unit: IntervalUnit
  hour: string
  minute: string
  weekly_weekdays: WeeklyWeekday[]
  monthly_days: string
  cron_expr: string
  timezone: string
  start_at: string
  end_at: string
  misfire_policy: MisfirePolicyType
  catch_up_max_runs: string
  catch_up_max_lateness_seconds: string
  overlap_policy: OverlapPolicy
  task_message: string
  system_prompt: string
  model: string
  workspace_path: string
  enhance_prompt: string
  auto_execute: boolean
}

export const DEFAULT_FORM_VALUES: ScheduleFormValues = {
  name: "",
  enabled: false,
  trigger_type: "interval",
  interval_value: "60",
  interval_unit: "minutes",
  hour: "9",
  minute: "0",
  weekly_weekdays: ["mon"],
  monthly_days: "1",
  cron_expr: "0 9 * * *",
  timezone: "",
  start_at: "",
  end_at: "",
  misfire_policy: "run_once",
  catch_up_max_runs: "1",
  catch_up_max_lateness_seconds: "60",
  overlap_policy: "queue_one",
  task_message: "",
  system_prompt: "",
  model: "",
  workspace_path: "",
  enhance_prompt: "",
  auto_execute: true,
}

export function normalizedString(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

const UNIT_SECONDS: Record<IntervalUnit, number> = { seconds: 1, minutes: 60, hours: 3600 }

/** Pick the largest unit that divides the stored seconds evenly, for round-trip editing. */
export function splitIntervalSeconds(seconds: number): { value: string; unit: IntervalUnit } {
  if (seconds > 0 && seconds % 3600 === 0) return { value: String(seconds / 3600), unit: "hours" }
  if (seconds > 0 && seconds % 60 === 0) return { value: String(seconds / 60), unit: "minutes" }
  return { value: String(seconds), unit: "seconds" }
}

export function parseMonthlyDays(raw: string): { days: number[]; invalid: boolean } {
  const value = raw.trim()
  if (!value) return { days: [], invalid: false }
  const chunks = value.split(/[\s,，]+/).filter(Boolean)
  const numbers = chunks.map((part) => Number(part))
  const invalid = numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 31)
  const days = Array.from(new Set(numbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= 31))).sort(
    (a, b) => a - b,
  )
  return { days, invalid }
}

function parseHourMinute(values: ScheduleFormValues): { hour: number; minute: number } | null {
  const hour = Number(values.hour)
  const minute = Number(values.minute)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null
  return { hour, minute }
}

export function buildTriggerFromValues(values: ScheduleFormValues): {
  trigger?: ScheduleTrigger
  error?: string
} {
  switch (values.trigger_type) {
    case "interval": {
      const raw = Number(values.interval_value)
      if (!Number.isFinite(raw) || raw <= 0) return { error: uiText("enter_an_interval_greater_than_0_da8d5def") }
      const seconds = Math.round(raw * UNIT_SECONDS[values.interval_unit])
      if (seconds <= 0) return { error: uiText("enter_an_interval_greater_than_0_da8d5def") }
      return { trigger: { type: "interval", every_seconds: seconds } }
    }
    case "daily": {
      const hm = parseHourMinute(values)
      if (!hm) return { error: uiText("enter_a_valid_time_hour_0_23_minute_0_59_f44f4f37") }
      return { trigger: { type: "daily", ...hm, second: 0 } }
    }
    case "weekly": {
      if (values.weekly_weekdays.length === 0) return { error: uiText("select_at_least_one_weekday_1084b61e") }
      const hm = parseHourMinute(values)
      if (!hm) return { error: uiText("enter_a_valid_time_hour_0_23_minute_0_59_f44f4f37") }
      return { trigger: { type: "weekly", weekdays: values.weekly_weekdays, ...hm, second: 0 } }
    }
    case "monthly": {
      const { days, invalid } = parseMonthlyDays(values.monthly_days)
      if (invalid) return { error: uiText("days_of_month_must_be_integers_from_1_to_31_separated_b_e907e493") }
      if (days.length === 0) return { error: uiText("enter_days_of_month_e_g_1_15_7a903115") }
      const hm = parseHourMinute(values)
      if (!hm) return { error: uiText("enter_a_valid_time_hour_0_23_minute_0_59_f44f4f37") }
      return { trigger: { type: "monthly", days, ...hm, second: 0 } }
    }
    case "cron": {
      const expr = normalizedString(values.cron_expr)
      if (!expr) return { error: uiText("enter_a_cron_expression_443c70c5") }
      return { trigger: { type: "cron", expr } }
    }
    default:
      return { error: uiText("select_a_trigger_type_7b90f017") }
  }
}

export function buildMisfirePolicy(values: ScheduleFormValues): MisfirePolicy {
  switch (values.misfire_policy) {
    case "skip":
      return { type: "skip" }
    case "catch_up_all":
      return { type: "catch_up_all" }
    case "catch_up_window":
      return {
        type: "catch_up_window",
        max_catch_up_runs: Math.max(1, Number(values.catch_up_max_runs) || 1),
        max_lateness_seconds: Math.max(1, Number(values.catch_up_max_lateness_seconds) || 60),
      }
    case "run_once":
    default:
      return { type: "run_once" }
  }
}

export function buildRunConfig(
  values: ScheduleFormValues,
  original?: ScheduleRunConfig | null,
): ScheduleRunConfig {
  return {
    // The backend PATCH replaces run_config WHOLESALE (no field merge), so
    // carry over fields this form doesn't edit — e.g. reasoning_effort set
    // via the scheduler tool — or editing a schedule silently drops them.
    ...(original ?? {}),
    system_prompt: normalizedString(values.system_prompt),
    task_message: normalizedString(values.task_message),
    model: normalizedString(values.model),
    workspace_path: normalizedString(values.workspace_path),
    enhance_prompt: normalizedString(values.enhance_prompt),
    auto_execute: values.auto_execute,
  }
}

export function scheduleToFormValues(schedule: ScheduleEntry): ScheduleFormValues {
  const values: ScheduleFormValues = {
    ...DEFAULT_FORM_VALUES,
    name: schedule.name,
    enabled: schedule.enabled,
    trigger_type: schedule.trigger.type,
    timezone: schedule.timezone ?? "",
    start_at: schedule.start_at ?? "",
    end_at: schedule.end_at ?? "",
    misfire_policy: schedule.misfire_policy?.type ?? "run_once",
    overlap_policy: schedule.overlap_policy ?? "queue_one",
    task_message: schedule.run_config?.task_message ?? "",
    system_prompt: schedule.run_config?.system_prompt ?? "",
    model: schedule.run_config?.model ?? "",
    workspace_path: schedule.run_config?.workspace_path ?? "",
    enhance_prompt: schedule.run_config?.enhance_prompt ?? "",
    auto_execute: Boolean(schedule.run_config?.auto_execute),
  }

  if (schedule.misfire_policy?.type === "catch_up_window") {
    values.catch_up_max_runs = String(schedule.misfire_policy.max_catch_up_runs)
    values.catch_up_max_lateness_seconds = String(schedule.misfire_policy.max_lateness_seconds)
  }

  switch (schedule.trigger.type) {
    case "interval": {
      const { value, unit } = splitIntervalSeconds(schedule.trigger.every_seconds)
      values.interval_value = value
      values.interval_unit = unit
      break
    }
    case "daily":
      values.hour = String(schedule.trigger.hour)
      values.minute = String(schedule.trigger.minute)
      break
    case "weekly":
      values.weekly_weekdays = schedule.trigger.weekdays
      values.hour = String(schedule.trigger.hour)
      values.minute = String(schedule.trigger.minute)
      break
    case "monthly":
      values.monthly_days = schedule.trigger.days.join(", ")
      values.hour = String(schedule.trigger.hour)
      values.minute = String(schedule.trigger.minute)
      break
    case "cron":
      values.cron_expr = schedule.trigger.expr
      break
  }

  return values
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

export function triggerSummary(t: ScheduleTrigger): string {
  switch (t.type) {
    case "interval": {
      const s = t.every_seconds ?? 0
      if (s > 0 && s % 3600 === 0) return uiText("every_hours_347737e7", { v0: s / 3600 , count: s / 3600 })
      if (s > 0 && s % 60 === 0) return uiText("every_minutes_895d33b7", { v0: s / 60 , count: s / 60 })
      return uiText("every_seconds_3b49d477", { v0: s , count: s })
    }
    case "daily":
      return uiText("daily_at_0b14f6d6", { v0: pad2(t.hour), v1: pad2(t.minute) })
    case "weekly": {
      const labels = uiList(t.weekdays
        .map((d) => WEEKDAY_OPTIONS.find((o) => o.value === d)?.label ?? String(d)))
      return uiText("weekly_on_at_73d5220a", { v0: labels, v1: pad2(t.hour), v2: pad2(t.minute) })
    }
    case "monthly":
      return uiText("monthly_on_day_at_42b0e4e2", { v0: t.days.join(", "), v1: pad2(t.hour), v2: pad2(t.minute) })
    case "cron":
      return `cron: ${t.expr}`
    default:
      return (t as { type: string }).type
  }
}

export function misfireSummary(policy: MisfirePolicy | undefined): string {
  switch (policy?.type) {
    case "skip":
      return uiText("skip_missed_runs_d8ac050b")
    case "catch_up_all":
      return uiText("catch_up_all_missed_runs_1409bcf8")
    case "catch_up_window":
      return uiText("catch_up_missed_runs_within_window_7559803d")
    case "run_once":
    default:
      return uiText("catch_up_one_missed_run_c6ba80f9")
  }
}

export function overlapSummary(policy: OverlapPolicy | undefined): string {
  switch (policy) {
    case "allow":
      return uiText("allow_parallel_runs_33ce425a")
    case "skip":
      return uiText("skip_overlapping_runs_15eb649d")
    case "queue_one":
    default:
      return uiText("queue_one_overlapping_run_e88647a4")
  }
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(uiLanguage(), { hour12: false })
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
