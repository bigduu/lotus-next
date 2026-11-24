import { createMemo } from "solid-js"
import { createUiText } from "../../shell/uiText"
import { BarList } from "./BarList"

const REASON_LABELS: Partial<Record<string, Parameters<ReturnType<typeof createUiText>>[0]>> = {
  message_count_mismatch: "message_count_e78985bc",
  last_message_id_mismatch: "last_message_208b7165",
  pending_question_mismatch: "questions_awaiting_response_61c1d336",
  message_count: "message_count_e78985bc",
  last_message_id: "last_message_208b7165",
  pending_question: "questions_awaiting_response_61c1d336",
}

export function SyncMismatchBreakdown(props: { breakdown?: Record<string, number> | null }) {
  const uiText = createUiText()
  const items = createMemo(() =>
    Object.entries(props.breakdown ?? {})
      .map(([reason, count]) => {
        const key = Object.hasOwn(REASON_LABELS, reason) ? REASON_LABELS[reason] : undefined
        return {
          label: key ? uiText(key) : reason.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
          value: count,
        }
      })
      .sort((a, b) => b.value - a.value),
  )

  return (
    <BarList
      items={items()}
      color="var(--destructive)"
      emptyText={uiText("no_sync_mismatch_records_in_this_range_c3dd8efd")}
    />
  )
}
