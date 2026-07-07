import type { SessionMetrics, SessionStatus } from "@services/metrics"
import { cn } from "@/lib/utils"
import { formatCompact, formatDateTime, formatDuration, formatExact } from "./format"

const STATUS_META: Record<SessionStatus, { label: string; dotClass: string }> = {
  running: { label: "进行中", dotClass: "bg-[#2a78d6] dark:bg-[#3987e5]" },
  awaiting_response: { label: "待回应", dotClass: "bg-amber-500" },
  completed: { label: "已完成", dotClass: "bg-emerald-600 dark:bg-emerald-500" },
  error: { label: "出错", dotClass: "bg-destructive" },
  cancelled: { label: "已取消", dotClass: "bg-muted-foreground" },
}

function StatusCell({ status }: { status: SessionStatus }) {
  const meta = STATUS_META[status] ?? { label: status, dotClass: "bg-muted-foreground" }
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className={cn("inline-block size-1.5 shrink-0 rounded-full", meta.dotClass)} />
      {meta.label}
    </span>
  )
}

export function SessionsTable({ sessions }: { sessions: SessionMetrics[] }) {
  if (sessions.length === 0) {
    return <p className="text-xs text-muted-foreground">暂无会话记录</p>
  }

  return (
    <div className="max-h-72 overflow-auto rounded-md border">
      <table className="w-full min-w-[620px] text-xs">
        <thead className="sticky top-0 z-10 bg-background text-muted-foreground">
          <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
            <th className="text-left">会话</th>
            <th className="text-left">模型</th>
            <th className="text-left">状态</th>
            <th className="text-right">轮次</th>
            <th className="text-right">Tokens</th>
            <th className="text-right">工具</th>
            <th className="text-right">时长</th>
            <th className="text-right">开始时间</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.session_id} className="border-t [&>td]:px-2 [&>td]:py-1.5">
              <td className="font-mono" title={s.session_id}>
                {s.session_id.slice(0, 8)}
              </td>
              <td className="max-w-40 truncate" title={s.model}>
                {s.model || "-"}
              </td>
              <td>
                <StatusCell status={s.status} />
              </td>
              <td className="text-right tabular-nums">{formatExact(s.total_rounds)}</td>
              <td
                className="text-right tabular-nums"
                title={formatExact(s.total_token_usage.total_tokens)}
              >
                {formatCompact(s.total_token_usage.total_tokens)}
              </td>
              <td className="text-right tabular-nums">{formatExact(s.tool_call_count)}</td>
              <td className="text-right tabular-nums">{formatDuration(s.duration_ms)}</td>
              <td className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                {formatDateTime(s.started_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
