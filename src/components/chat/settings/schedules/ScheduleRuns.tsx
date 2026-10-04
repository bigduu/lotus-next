import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useState } from "react"
import { agentClient } from "@services/chat/AgentService"
import type { ScheduleRunRecord } from "@services/chat/AgentService"
import { Badge } from "@/components/ui/badge"
import { errorMessage, formatTime } from "./scheduleModel"

const STATUS_LABEL: Record<ScheduleRunRecord["status"], string> = {
  get queued() { return uiText("queued_d6f766f2") },
  get running() { return uiText("running_1f0eb99b") },
  get success() { return uiText("successful_053461ce") },
  get failed() { return uiText("failed_28384d7a") },
  get skipped() { return uiText("skipped_71e95b28") },
  get missed() { return uiText("missed_67330e9d") },
  get cancelled() { return uiText("cancelled_a37778f1") },
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
  useUiLocale()
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
        if (!cancelled) setError(uiText("could_not_load_run_history_1bebf89d", { v0: errorMessage(e) }))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scheduleId])

  if (loading) return <p className="px-1 py-2 text-xs text-muted-foreground">{uiText("loading_run_history_0ea0960f")}</p>
  if (error) return <p className="px-1 py-2 text-xs text-destructive">{error}</p>
  if (runs.length === 0) return <p className="px-1 py-2 text-xs text-muted-foreground">{uiText("no_runs_yet_6c3df58b")}</p>

  return (
    <ul className="divide-y">
      {runs.map((run) => {
        const duration = formatDuration(run.execution_duration_ms)
        return (
          <li key={run.run_id} className="space-y-1 px-1 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={statusVariant(run.status)}>{STATUS_LABEL[run.status] ?? run.status}</Badge>
              <span className="text-xs text-muted-foreground">{uiText("scheduled_0f6b1949")} {formatTime(run.scheduled_for)}</span>
              {run.was_catch_up ? <Badge variant="outline">{uiText("catch_up_1ce0743a")}</Badge> : null}
            </div>
            <div className="text-xs text-muted-foreground">
              {uiText("started_d2bb025a")} {formatTime(run.started_at)} {uiText("ended_66d5238f")} {formatTime(run.completed_at)}
              {duration ? uiText("duration_dd4a49ef", { v0: duration }) : ""}
            </div>
            {run.session_id ? (
              <div className="truncate text-xs text-muted-foreground">{uiText("session_a6328025")} {run.session_id}</div>
            ) : null}
            {run.outcome_reason ? (
              <div className="text-xs text-muted-foreground">{uiText("reason_0a38db58")}{run.outcome_reason}</div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
