/** Safe UI projection; backend status suffixes and summary text never enter it. */
export type ContextCompressionFeedback =
  | { status: "running" }
  | { status: "completed"; awaitingUsage: boolean }
  | { status: "failed"; reason: "candidate_plan" | "postcondition" | "other" }
  | { status: "deferred"; reason: "tool_protocol" | "other" }
  | { status: "skipped"; reason: "no_model" | "other" }
  | { status: "cancelled" }
  | { status: "unconfirmed" }

const tagged = (value: string, tag: string) => value === tag || value.startsWith(`${tag}:`)

export function summaryFeedback(previous: ContextCompressionFeedback | null): ContextCompressionFeedback {
  if (previous?.status === "running") return { status: "completed", awaitingUsage: true }
  // A duplicate receipt must not put an already-refreshed meter back into waiting.
  // An unpaired receipt cannot turn a failed/cancelled attempt into success.
  return previous ?? { status: "unconfirmed" }
}

export function compressionFeedbackFromStatus(
  previous: ContextCompressionFeedback | null,
  status: string,
): ContextCompressionFeedback | null {
  if (typeof status !== "string") return previous
  if (status === "started") return { status: "running" }
  if (status === "completed") return summaryFeedback(previous)
  if (tagged(status, "cancelled") || tagged(status, "canceled")) return { status: "cancelled" }
  if (tagged(status, "failed_candidate_plan")) return { status: "failed", reason: "candidate_plan" }
  if (tagged(status, "failed_postcondition")) return { status: "failed", reason: "postcondition" }
  if (tagged(status, "failed") || status.startsWith("failed_")) return { status: "failed", reason: "other" }
  if (tagged(status, "deferred_tool_protocol")) return { status: "deferred", reason: "tool_protocol" }
  if (tagged(status, "deferred") || status.startsWith("deferred_")) return { status: "deferred", reason: "other" }
  if (tagged(status, "skipped_no_background_model")) return { status: "skipped", reason: "no_model" }
  if (tagged(status, "skipped") || status.startsWith("skipped_")) return { status: "skipped", reason: "other" }
  // Progress/unknown strings can retain a confirmed started state, but cannot
  // start an animation, erase a useful outcome or be rendered as raw diagnostics.
  return previous
}

export function compressionBudgetReceived(previous: ContextCompressionFeedback | null): ContextCompressionFeedback | null {
  return previous?.status === "completed" && previous.awaitingUsage
    ? { status: "completed", awaitingUsage: false }
    : previous
}

export function compressionRunEnded(previous: ContextCompressionFeedback | null, cancelled = false): ContextCompressionFeedback | null {
  return previous?.status === "running"
    ? { status: cancelled ? "cancelled" : "unconfirmed" }
    : previous
}
