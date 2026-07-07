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
  return <div className="mb-1 text-xs font-medium text-muted-foreground">{children}</div>
}

function HourMinuteFields({
  values,
  onChange,
}: {
  values: ScheduleFormValues
  onChange: (patch: Partial<ScheduleFormValues>) => void
}) {
  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <FieldLabel>时(0-23)</FieldLabel>
        <Input
          type="number"
          min={0}
          max={23}
          value={values.hour}
          onChange={(e) => onChange({ hour: e.target.value })}
        />
      </div>
      <div className="flex-1">
        <FieldLabel>分(0-59)</FieldLabel>
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
          <FieldLabel>名称</FieldLabel>
          <Input
            placeholder="定时任务名称"
            value={values.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <label className="flex h-9 shrink-0 items-center gap-2 text-xs text-muted-foreground">
          启用
          <Switch checked={values.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
        </label>
      </div>

      <section className="rounded-lg border bg-background/50 p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">触发</div>
        <div className="space-y-2.5">
          <div>
            <FieldLabel>触发类型</FieldLabel>
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
                <FieldLabel>每隔</FieldLabel>
                <Input
                  type="number"
                  min={1}
                  value={values.interval_value}
                  onChange={(e) => onChange({ interval_value: e.target.value })}
                />
              </div>
              <div className="w-28 shrink-0">
                <FieldLabel>单位</FieldLabel>
                <Select
                  value={values.interval_unit}
                  onValueChange={(v) => onChange({ interval_unit: v as IntervalUnit })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">分钟</SelectItem>
                    <SelectItem value="hours">小时</SelectItem>
                    <SelectItem value="seconds">秒</SelectItem>
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
                <FieldLabel>星期</FieldLabel>
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
                <FieldLabel>每月日期(1-31,逗号分隔)</FieldLabel>
                <Input
                  placeholder="如 1, 15"
                  value={values.monthly_days}
                  onChange={(e) => onChange({ monthly_days: e.target.value })}
                />
              </div>
              <HourMinuteFields values={values} onChange={onChange} />
            </>
          ) : null}

          {values.trigger_type === "cron" ? (
            <div>
              <FieldLabel>cron 表达式</FieldLabel>
              <Input
                placeholder="如 0 9 * * *"
                value={values.cron_expr}
                onChange={(e) => onChange({ cron_expr: e.target.value })}
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-background/50 p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">执行内容</div>
        <div className="space-y-2.5">
          <div>
            <FieldLabel>任务内容</FieldLabel>
            <Textarea
              className="min-h-16 resize-y"
              placeholder="任务内容(自动执行时必填)"
              value={values.task_message}
              onChange={(e) => onChange({ task_message: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">自动执行(触发后直接运行任务)</span>
            <Switch
              checked={values.auto_execute}
              onCheckedChange={(v) => onChange({ auto_execute: v })}
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <FieldLabel>模型(可选)</FieldLabel>
              <Input
                placeholder="默认模型"
                value={values.model}
                onChange={(e) => onChange({ model: e.target.value })}
              />
            </div>
            <div className="flex-1">
              <FieldLabel>工作目录(可选)</FieldLabel>
              <Input
                placeholder="workspace 路径"
                value={values.workspace_path}
                onChange={(e) => onChange({ workspace_path: e.target.value })}
              />
            </div>
          </div>
          <div>
            <FieldLabel>系统提示词(可选)</FieldLabel>
            <Textarea
              className="min-h-12 resize-y"
              placeholder="覆盖默认系统提示词"
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
        {showAdvanced ? "收起高级选项" : "高级选项(策略 / 时区 / 生效时间)"}
      </button>

      {showAdvanced ? (
        <section className="rounded-lg border bg-background/50 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">高级</div>
          <div className="space-y-2.5">
            <div className="flex gap-2">
              <div className="flex-1">
                <FieldLabel>错过策略</FieldLabel>
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
                <FieldLabel>重叠策略</FieldLabel>
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
                  <FieldLabel>最多补跑次数</FieldLabel>
                  <Input
                    type="number"
                    min={1}
                    value={values.catch_up_max_runs}
                    onChange={(e) => onChange({ catch_up_max_runs: e.target.value })}
                  />
                </div>
                <div className="flex-1">
                  <FieldLabel>最大延迟(秒)</FieldLabel>
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
              <FieldLabel>时区(可选)</FieldLabel>
              <Input
                placeholder="如 Asia/Shanghai"
                value={values.timezone}
                onChange={(e) => onChange({ timezone: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <FieldLabel>开始时间(可选)</FieldLabel>
                <Input
                  placeholder="2026-01-01T00:00:00Z"
                  value={values.start_at}
                  onChange={(e) => onChange({ start_at: e.target.value })}
                />
              </div>
              <div className="flex-1">
                <FieldLabel>结束时间(可选)</FieldLabel>
                <Input
                  placeholder="2026-12-31T00:00:00Z"
                  value={values.end_at}
                  onChange={(e) => onChange({ end_at: e.target.value })}
                />
              </div>
            </div>
            <div>
              <FieldLabel>增强提示词(可选)</FieldLabel>
              <Textarea
                className="min-h-12 resize-y"
                placeholder="附加到任务的增强提示"
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
          取消
        </Button>
        <Button size="sm" onClick={onSubmit} disabled={saving || !values.name.trim()}>
          {saving ? "保存中…" : submitLabel}
        </Button>
      </div>
    </div>
  )
}
