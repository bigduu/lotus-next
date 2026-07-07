import { useEffect, useState } from "react"
import { agentClient } from "@services/chat/AgentService"
import type { ScheduleRunRecord } from "@services/chat/AgentService"
import { Badge } from "@/components/ui/badge"
import { errorMessage, formatTime } from "./scheduleModel"

const STATUS_LABEL: Record<ScheduleRunRecord["status"], string> = {
  queued: "排队中",
  running: "运行中",
  success: "成功",
  failed: "失败",
  skipped: "已跳过",
  missed: "已错过",
  cancelled: "已取消",
}

function statusVariant(
  status: ScheduleRunRecord["status"],
): "default" | "secondary" | "destructive" | "outline" | "warning" | "success" {
  switch (status) {
    case "success":
      return "success"
    case "failed":
    case "cancelled":
      return "destructive"
    case "running":
      return "default"
    case "queued":
      return "warning"
    case "missed":
    case "skipped":
    default:
      return "secondary"
  }
}

function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function ScheduleRuns({ scheduleId }: { scheduleId: string }) {
  const [runs, setRuns] = useState<ScheduleRunRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    agentClient
      .listScheduleRuns(scheduleId)
      .then((r) => {
        if (!cancelled) setRuns(r.runs ?? [])
      })
      .catch((e) => {
        if (!cancelled) setError(`加载运行记录失败:${errorMessage(e)}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scheduleId])

  if (loading) return <p className="px-1 py-2 text-xs text-muted-foreground">加载运行记录中…</p>
  if (error) return <p className="px-1 py-2 text-xs text-destructive">{error}</p>
  if (runs.length === 0) return <p className="px-1 py-2 text-xs text-muted-foreground">暂无运行记录</p>

  return (
    <ul className="divide-y">
      {runs.map((run) => {
        const duration = formatDuration(run.execution_duration_ms)
        return (
          <li key={run.run_id} className="space-y-1 px-1 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={statusVariant(run.status)}>{STATUS_LABEL[run.status] ?? run.status}</Badge>
              <span className="text-xs text-muted-foreground">计划 {formatTime(run.scheduled_for)}</span>
              {run.was_catch_up ? <Badge variant="outline">补跑</Badge> : null}
            </div>
            <div className="text-xs text-muted-foreground">
              开始 {formatTime(run.started_at)} · 结束 {formatTime(run.completed_at)}
              {duration ? ` · 耗时 ${duration}` : ""}
            </div>
            {run.session_id ? (
              <div className="truncate text-xs text-muted-foreground">会话 {run.session_id}</div>
            ) : null}
            {run.outcome_reason ? (
              <div className="text-xs text-muted-foreground">原因:{run.outcome_reason}</div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
