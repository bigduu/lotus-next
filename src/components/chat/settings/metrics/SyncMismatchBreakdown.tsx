import { useMemo } from "react"
import { BarList, type BarListItem } from "./BarList"

/**
 * Known execute-sync mismatch reasons. The server emits the `*_mismatch`-suffixed
 * keys (bamboo-engine session_app/types.rs, stored verbatim); the un-suffixed
 * forms are kept as aliases because legacy's REASON_LABEL_FALLBACKS used them.
 */
const REASON_LABELS: Record<string, string> = {
  message_count_mismatch: "消息数量",
  last_message_id_mismatch: "最后消息",
  pending_question_mismatch: "待回应问题",
  message_count: "消息数量",
  last_message_id: "最后消息",
  pending_question: "待回应问题",
}

/** Unknown reasons fall back to Title Case of the snake_case key. */
function formatReasonLabel(reason: string): string {
  if (REASON_LABELS[reason]) return REASON_LABELS[reason]
  return reason
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

/**
 * Usage-sync mismatch counts grouped by reason. Ported from legacy
 * SyncMismatchBreakdownCard (horizontal bar chart) into next's BarList idiom;
 * mismatches indicate divergence, so the bars use the destructive color.
 */
export function SyncMismatchBreakdown({
  breakdown,
}: {
  breakdown?: Record<string, number> | null
}) {
  const items = useMemo<BarListItem[]>(
    () =>
      Object.entries(breakdown ?? {})
        .map(([reason, count]) => ({
          key: reason,
          label: formatReasonLabel(reason),
          value: count,
        }))
        .sort((a, b) => b.value - a.value),
    [breakdown],
  )

  return (
    <BarList
      items={items}
      color="var(--destructive)"
      emptyText="此范围内暂无同步不一致记录"
    />
  )
}
