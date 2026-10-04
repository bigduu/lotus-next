import { uiText, useUiLocale } from "@shared/i18n/ui"
import type { ForwardRequestMetrics, ForwardStatus } from "@services/metrics"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatCompact, formatDateTime, formatDuration, formatExact } from "./format"

/* Dot colors come from the .lnx-metrics tokens (SettingsMetrics SERIES_CSS),
   which already flip for dark mode — retuning them there restyles this too. */
const STATUS_META: Record<ForwardStatus, { label: string; dotClass: string }> = {
  pending: { get label() { return uiText("active_dc9591e5") }, dotClass: "bg-[var(--mx-chat)]" },
  success: { get label() { return uiText("successful_053461ce") }, dotClass: "bg-[var(--mx-ok)]" },
  error: { get label() { return uiText("failed_28384d7a") }, dotClass: "bg-destructive" },
}

function StatusCell({
  status,
  statusCode,
}: {
  status?: ForwardStatus | null
  statusCode?: number | null
}) {
  useUiLocale()
  if (!status) {
    return <span className="text-muted-foreground">-</span>
  }
  const meta = STATUS_META[status] ?? { label: status, dotClass: "bg-muted-foreground" }
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className={cn("inline-block size-1.5 shrink-0 rounded-full", meta.dotClass)} />
      {meta.label}
      {statusCode != null ? <span className="text-muted-foreground">({statusCode})</span> : null}
    </span>
  )
}

/** "chat.completions" → "completions" (mirrors legacy's endpoint shortening). */
function shortEndpoint(endpoint: string): string {
  return endpoint.split(".").pop() || endpoint
}

/**
 * Recent forward (API proxy) requests. Ported from legacy ForwardRequestTable
 * (antd Table) into next's SessionsTable idiom: sticky header, scroll container.
 */
export function ForwardRequestsTable({ requests }: { requests: ForwardRequestMetrics[] }) {
  useUiLocale()
  if (requests.length === 0) {
    return <p className="text-xs text-muted-foreground">{uiText("no_forward_request_records_in_this_range_0ddae944")}</p>
  }

  return (
    <div className="max-h-72 overflow-auto rounded-md border">
      <table className="w-full min-w-[720px] text-xs">
        <thead className="sticky top-0 z-10 bg-background text-muted-foreground">
          <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
            <th className="text-left">{uiText("requests_393e1241")}</th>
            <th className="text-left">{uiText("endpoint_52fff168")}</th>
            <th className="text-left">{uiText("model_c98e118e")}</th>
            <th className="text-left">{uiText("type_ba40014f")}</th>
            <th className="text-left">{uiText("status_6320b4a8")}</th>
            <th className="text-right">Tokens</th>
            <th className="text-right">{uiText("duration_e77e3d58")}</th>
            <th className="text-right">{uiText("started_6a9906c7")}</th>
            <th className="text-left">{uiText("error_0bc1fb72")}</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.forward_id} className="border-t [&>td]:px-2 [&>td]:py-1.5">
              <td className="font-mono" title={r.forward_id}>
                {r.forward_id.slice(0, 8)}
              </td>
              <td title={r.endpoint}>
                <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                  {shortEndpoint(r.endpoint)}
                </Badge>
              </td>
              <td className="max-w-40 truncate" title={r.model}>
                {r.model || "-"}
              </td>
              <td className="whitespace-nowrap">{r.is_stream ? uiText("stream_62ebdef8") : uiText("sync_dcfe516d")}</td>
              <td>
                <StatusCell status={r.status} statusCode={r.status_code} />
              </td>
              <td
                className="text-right tabular-nums"
                title={r.token_usage ? formatExact(r.token_usage.total_tokens) : undefined}
              >
                {r.token_usage ? formatCompact(r.token_usage.total_tokens) : "-"}
              </td>
              <td className="text-right tabular-nums">{formatDuration(r.duration_ms)}</td>
              <td className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                {formatDateTime(r.started_at)}
              </td>
              <td className="max-w-48 truncate text-destructive" title={r.error ?? undefined}>
                {r.error || <span className="text-muted-foreground">-</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
