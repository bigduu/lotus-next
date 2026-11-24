import { For, Show } from "solid-js"
import { createUiText } from "../../shell/uiText"
import type { ForwardRequestMetrics, ForwardStatus } from "@services/metrics"
import { Badge } from "../../ui/badge"
import { cn } from "@/lib/utils"
import { formatDuration } from "@/lib/settings/metricsFormat"
import { createMetricFormatters, shortEndpoint } from "./format"

/* Dot colors come from the .lnx-metrics tokens (SettingsMetrics SERIES_CSS),
   which already flip for dark mode — retuning them there restyles this too. */
const STATUS_META: Record<ForwardStatus, { label: Parameters<ReturnType<typeof createUiText>>[0]; dotClass: string }> = {
  pending: { label: "active_dc9591e5", dotClass: "bg-[var(--mx-chat)]" },
  success: { label: "successful_053461ce", dotClass: "bg-[var(--mx-ok)]" },
  error: { label: "failed_28384d7a", dotClass: "bg-destructive" },
}

function StatusCell(props: { status?: ForwardStatus | null; statusCode?: number | null; text: ReturnType<typeof createUiText> }) {
  const meta = () => props.status ? STATUS_META[props.status] : undefined
  const label = () => {
    const current = meta()
    return current ? props.text(current.label) : props.status
  }
  return (
    <Show when={props.status} fallback={<span class="text-muted-foreground">-</span>}>
      <span class="flex items-center gap-1.5 whitespace-nowrap">
        <span class={cn("inline-block size-1.5 shrink-0 rounded-full", meta()?.dotClass ?? "bg-muted-foreground")} />
        {label()}
        <Show when={props.statusCode != null}>
          <span class="text-muted-foreground">({props.statusCode})</span>
        </Show>
      </span>
    </Show>
  )
}

export function ForwardRequestsTable(props: { requests: ForwardRequestMetrics[] }) {
  const uiText = createUiText()
  const { compact, exact, dateTime } = createMetricFormatters()
  return (
    <Show when={props.requests.length} fallback={<p class="text-xs text-muted-foreground">{uiText("no_forward_request_records_in_this_range_0ddae944")}</p>}>
      <div class="max-h-72 overflow-auto rounded-md border">
        <table class="w-full min-w-[720px] text-xs">
          <thead class="sticky top-0 z-10 bg-background text-muted-foreground">
            <tr class="[&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
              <th class="text-left">{uiText("requests_393e1241")}</th>
              <th class="text-left">{uiText("endpoint_52fff168")}</th>
              <th class="text-left">{uiText("model_c98e118e")}</th>
              <th class="text-left">{uiText("type_ba40014f")}</th>
              <th class="text-left">{uiText("status_6320b4a8")}</th>
              <th class="text-right">Tokens</th>
              <th class="text-right">{uiText("duration_e77e3d58")}</th>
              <th class="text-right">{uiText("started_6a9906c7")}</th>
              <th class="text-left">{uiText("error_0bc1fb72")}</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.requests}>{(r) => (
              <tr class="border-t [&>td]:px-2 [&>td]:py-1.5">
                <td class="font-mono" title={r.forward_id}>
                  {r.forward_id.slice(0, 8)}
                </td>
                <td title={r.endpoint}>
                  <Badge variant="outline" class="px-1.5 py-0 text-[10px] font-normal">
                    {shortEndpoint(r.endpoint)}
                  </Badge>
                </td>
                <td class="max-w-40 truncate" title={r.model}>
                  {r.model || "-"}
                </td>
                <td class="whitespace-nowrap">{r.is_stream ? uiText("stream_62ebdef8") : uiText("sync_dcfe516d")}</td>
                <td>
                  <StatusCell text={uiText} status={r.status} statusCode={r.status_code} />
                </td>
                <td
                  class="text-right tabular-nums"
                  title={r.token_usage ? exact(r.token_usage.total_tokens) : undefined}
                >
                  {r.token_usage ? compact(r.token_usage.total_tokens) : "-"}
                </td>
                <td class="text-right tabular-nums">{formatDuration(r.duration_ms)}</td>
                <td class="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                  {dateTime(r.started_at)}
                </td>
                <td class="max-w-48 truncate text-destructive" title={r.error ?? undefined}>
                  {r.error || <span class="text-muted-foreground">-</span>}
                </td>
              </tr>
            )}</For>
          </tbody>
        </table>
      </div>
    </Show>
  )
}
