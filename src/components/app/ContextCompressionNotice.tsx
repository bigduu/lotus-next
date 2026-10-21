import { LoaderCircle } from "lucide-react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import type { ContextCompressionFeedback } from "@/lib/contextCompression"

function compressionMessage(feedback?: ContextCompressionFeedback | null): string | null {
  switch (feedback?.status) {
    case "running": return uiText("context_compression_notice_running")
    case "completed":
      if (feedback.awaitingUsage === true) return uiText("context_compression_notice_completed_waiting")
      if (feedback.awaitingUsage === false) return uiText("context_compression_notice_completed")
      return null
    case "failed":
      switch (feedback.reason) {
        case "candidate_plan": return uiText("context_compression_notice_failed_candidate")
        case "postcondition": return uiText("context_compression_notice_failed_postcondition")
        case "other": return uiText("context_compression_notice_failed")
        default: return null
      }
    case "deferred":
      switch (feedback.reason) {
        case "tool_protocol": return uiText("context_compression_notice_deferred_tool")
        case "other": return uiText("context_compression_notice_deferred")
        default: return null
      }
    case "skipped":
      switch (feedback.reason) {
        case "no_model": return uiText("context_compression_notice_skipped_no_model")
        case "other": return uiText("context_compression_notice_skipped")
        default: return null
      }
    case "cancelled": return uiText("context_compression_notice_cancelled")
    case "unconfirmed": return uiText("context_compression_notice_unconfirmed")
    default: return null
  }
}

/** Controlled outcome copy only; usage estimates and backend diagnostics stay outside. */
export function ContextCompressionNotice({ feedback }: { feedback?: ContextCompressionFeedback | null }) {
  useUiLocale()
  const message = compressionMessage(feedback)
  if (!message) return null
  return <div role="status" aria-live="polite" aria-atomic="true"
    className="flex min-w-0 items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
    data-testid="context-compression-notice">
    {feedback?.status === "running" ? <LoaderCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 motion-safe:animate-spin" /> : null}
    <span className="min-w-0 break-words">{message}</span>
  </div>
}
