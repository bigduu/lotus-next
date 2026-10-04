import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useMemo } from "react"
import { BarList, type BarListItem } from "./BarList"

/**
 * Known execute-sync mismatch reasons. The server emits the `*_mismatch`-suffixed
 * keys (bamboo-engine session_app/types.rs, stored verbatim); the un-suffixed
 * forms are kept as aliases because legacy's REASON_LABEL_FALLBACKS used them.
 */
const REASON_LABELS: Record<string, Parameters<typeof uiText>[0]> = {
  message_count_mismatch: "message_count_e78985bc",
  last_message_id_mismatch: "last_message_208b7165",
  pending_question_mismatch: "questions_awaiting_response_61c1d336",
  message_count: "message_count_e78985bc",
  last_message_id: "last_message_208b7165",
  pending_question: "questions_awaiting_response_61c1d336",
}

/** Unknown reasons fall back to Title Case of the snake_case key. */
function formatReasonLabel(reason: string, locale: string): string {
  if (REASON_LABELS[reason]) return uiText(REASON_LABELS[reason], { lng: locale })
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
  const locale = useUiLocale()
  const items = useMemo<BarListItem[]>(
    () =>
      Object.entries(breakdown ?? {})
        .map(([reason, count]) => ({
          key: reason,
          label: formatReasonLabel(reason, locale),
          value: count,
        }))
        .sort((a, b) => b.value - a.value),
    [breakdown, locale],
  )

  return (
    <BarList
      items={items}
      color="var(--destructive)"
      emptyText={uiText("no_sync_mismatch_records_in_this_range_c3dd8efd")}
    />
  )
}
