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
  { value: "mon", label: "一" },
  { value: "tue", label: "二" },
  { value: "wed", label: "三" },
  { value: "thu", label: "四" },
  { value: "fri", label: "五" },
  { value: "sat", label: "六" },
  { value: "sun", label: "日" },
]

export const TRIGGER_TYPE_OPTIONS: Array<{ value: TriggerType; label: string }> = [
  { value: "interval", label: "间隔" },
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "cron", label: "Cron" },
]

export const MISFIRE_OPTIONS: Array<{ value: MisfirePolicyType; label: string }> = [
  { value: "run_once", label: "补跑一次" },
  { value: "skip", label: "跳过" },
  { value: "catch_up_all", label: "全部补跑" },
  { value: "catch_up_window", label: "窗口内补跑" },
]

export const OVERLAP_OPTIONS: Array<{ value: OverlapPolicy; label: string }> = [
  { value: "queue_one", label: "排队一个" },
  { value: "skip", label: "跳过" },
  { value: "allow", label: "允许并行" },
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
      if (!Number.isFinite(raw) || raw <= 0) return { error: "请填写大于 0 的间隔" }
      const seconds = Math.round(raw * UNIT_SECONDS[values.interval_unit])
      if (seconds <= 0) return { error: "请填写大于 0 的间隔" }
      return { trigger: { type: "interval", every_seconds: seconds } }
    }
    case "daily": {
      const hm = parseHourMinute(values)
      if (!hm) return { error: "请填写有效的时间(时 0-23,分 0-59)" }
      return { trigger: { type: "daily", ...hm, second: 0 } }
    }
    case "weekly": {
      if (values.weekly_weekdays.length === 0) return { error: "请至少选择一个星期几" }
      const hm = parseHourMinute(values)
      if (!hm) return { error: "请填写有效的时间(时 0-23,分 0-59)" }
      return { trigger: { type: "weekly", weekdays: values.weekly_weekdays, ...hm, second: 0 } }
    }
    case "monthly": {
      const { days, invalid } = parseMonthlyDays(values.monthly_days)
      if (invalid) return { error: "每月日期必须是 1-31 的整数(逗号分隔)" }
      if (days.length === 0) return { error: "请填写每月执行的日期(如 1, 15)" }
      const hm = parseHourMinute(values)
      if (!hm) return { error: "请填写有效的时间(时 0-23,分 0-59)" }
      return { trigger: { type: "monthly", days, ...hm, second: 0 } }
    }
    case "cron": {
      const expr = normalizedString(values.cron_expr)
      if (!expr) return { error: "请填写 cron 表达式" }
      return { trigger: { type: "cron", expr } }
    }
    default:
      return { error: "请选择触发类型" }
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

export function buildRunConfig(values: ScheduleFormValues): ScheduleRunConfig {
  return {
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
      if (s > 0 && s % 3600 === 0) return `每 ${s / 3600} 小时`
      if (s > 0 && s % 60 === 0) return `每 ${s / 60} 分钟`
      return `每 ${s} 秒`
    }
    case "daily":
      return `每天 ${pad2(t.hour)}:${pad2(t.minute)}`
    case "weekly": {
      const labels = t.weekdays
        .map((d) => WEEKDAY_OPTIONS.find((o) => o.value === d)?.label ?? d)
        .join("、")
      return `每周${labels} ${pad2(t.hour)}:${pad2(t.minute)}`
    }
    case "monthly":
      return `每月 ${t.days.join(", ")} 日 ${pad2(t.hour)}:${pad2(t.minute)}`
    case "cron":
      return `cron: ${t.expr}`
    default:
      return (t as { type: string }).type
  }
}

export function misfireSummary(policy: MisfirePolicy | undefined): string {
  switch (policy?.type) {
    case "skip":
      return "错过跳过"
    case "catch_up_all":
      return "错过全部补跑"
    case "catch_up_window":
      return "错过窗口补跑"
    case "run_once":
    default:
      return "错过补跑一次"
  }
}

export function overlapSummary(policy: OverlapPolicy | undefined): string {
  switch (policy) {
    case "allow":
      return "允许并行"
    case "skip":
      return "重叠跳过"
    case "queue_one":
    default:
      return "重叠排队一个"
  }
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString("zh-CN", { hour12: false })
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
