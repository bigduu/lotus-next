import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useMemo } from "react"
import { BarList, type BarListItem } from "./BarList"

/**
 * Known execute-sync mismatch reasons. The server emits the `*_mismatch`-suffixed
 * keys (bamboo-engine session_app/types.rs, stored verbatim); the un-suffixed
 * forms are kept as aliases because legacy's REASON_LABEL_FALLBACKS used them.
 */
const REASON_LABELS: Record<string, string> = {
  get message_count_mismatch() { return uiText("message_count_e78985bc") },
  get last_message_id_mismatch() { return uiText("last_message_208b7165") },
  get pending_question_mismatch() { return uiText("questions_awaiting_response_61c1d336") },
  get message_count() { return uiText("message_count_e78985bc") },
  get last_message_id() { return uiText("last_message_208b7165") },
  get pending_question() { return uiText("questions_awaiting_response_61c1d336") },
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
  useUiLocale()
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
      emptyText={uiText("no_sync_mismatch_records_in_this_range_c3dd8efd")}
    />
  )
}
