import { LoaderCircle } from "lucide-react"
import { useEffect, useState, useSyncExternalStore } from "react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { backendSupports, onBackendFeatures } from "@/lib/backendFeatures"
import type { ContextCompressionFeedback } from "@/lib/contextCompression"
import { agentClient, type ActiveCompaction, type CompactionStrategy, type SessionCompactionStatus } from "@services/chat/AgentService"

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
        case "empty_summary": return uiText("context_compression_notice_empty_summary")
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

const supportsCompactionStatus = () => backendSupports("session_compaction_status")

const strategyLabels = {
  summary: "context_full_summary_label",
  message_summary: "context_message_summary_label",
  retrieval_window: "context_retrieval_window_label",
} satisfies Record<CompactionStrategy, Parameters<typeof uiText>[0]>

function progressMessage(active: ActiveCompaction) {
  switch (active.phase) {
    case "preparing": return uiText("compact_status_preparing")
    case "summarizing": return uiText("compact_status_summarizing", { part: active.part, total: active.total })
    case "merging": return uiText("compact_status_merging", { part: active.part, total: active.total })
    case "validating": return uiText("compact_status_validating")
    case "saving": return uiText("compact_status_saving")
  }
}

export function ContextCompressionNotice({ feedback, sessionId, manualPending = false, runActive = false }: {
  feedback?: ContextCompressionFeedback | null
  sessionId?: string | null
  manualPending?: boolean
  runActive?: boolean
}) {
  const locale = useUiLocale()
  const supported = useSyncExternalStore(onBackendFeatures, supportsCompactionStatus)
  const [observation, setObservation] = useState<SessionCompactionStatus | null>(null)
  const [uncertainSession, setUncertainSession] = useState<string | null>(null)
  const status = supported && observation?.session_id === sessionId ? observation : null
  const streamRunning = feedback?.status === "running"

  useEffect(() => {
    if (!supported || !sessionId) return
    const observedSession = sessionId
    const controller = new AbortController()
    let timer: number | undefined
    let reading = false
    // An automatic attempt can be replaced while the same chat turn is active.
    const awaitingAttempt = manualPending || (runActive && streamRunning)
    let shouldPoll = awaitingAttempt

    async function refresh() {
      if (reading || controller.signal.aborted) return
      window.clearTimeout(timer)
      reading = true
      try {
        const value = await agentClient.getSessionCompactionStatus(observedSession, controller.signal)
        if (controller.signal.aborted) return
        shouldPoll = awaitingAttempt || value.active !== null
        setObservation(value)
        setUncertainSession(null)
      } catch {
        if (!controller.signal.aborted) setUncertainSession(observedSession)
      } finally {
        reading = false
        if (!controller.signal.aborted && shouldPoll) {
          timer = window.setTimeout(refresh, 2_000)
        }
      }
    }

    void refresh()
    window.addEventListener("focus", refresh)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
      window.removeEventListener("focus", refresh)
    }
  }, [sessionId, supported, manualPending, streamRunning, feedback, runActive])

  const uncertain = supported && !!sessionId && uncertainSession === sessionId
    && (manualPending || streamRunning || !!status?.active || feedback?.status === "completed")
  const active = uncertain ? null : status?.active
  const historical = status?.applied
  // On a supported backend progress readback supersedes a stale stream
  // event. Only a durable receipt can confirm successful application.
  const observedFeedback = supported && sessionId && (
    feedback?.status === "completed" || (streamRunning && status)
  ) ? null : feedback
  const spinning = !uncertain && (active || manualPending || observedFeedback?.status === "running")
  const message = uncertain
    ? uiText("context_compression_notice_unconfirmed")
    : active
      ? progressMessage(active)
      : manualPending
        ? uiText(supported && sessionId ? "compact_status_preparing" : "compact_in_progress")
        : compressionMessage(observedFeedback)
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const applied = historical && uiText("compact_status_applied", {
    strategy: uiText(strategyLabels[historical.strategy]),
  })
  const attemptStrategy = active?.strategy
  const knownStrategy = attemptStrategy ?? historical?.strategy
  const pending = status && knownStrategy && status.configured_strategy !== knownStrategy
    && uiText("compact_status_pending_strategy", { strategy: uiText(strategyLabels[status.configured_strategy]) })
  if (!message && !applied) return null
  return <div role="status" aria-live="polite" aria-atomic="true"
    className="flex min-w-0 items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
    data-testid="context-compression-notice">
    {message && spinning ? <LoaderCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 motion-safe:animate-spin" /> : null}
    <div className="min-w-0 break-words">
      {message ? <div>{message}{active ? <span aria-hidden="true"> · {uiText("compact_status_elapsed", {
        seconds: number.format(Math.floor(active.elapsed_ms / 1_000)),
      })}</span> : null}</div> : null}
      {attemptStrategy ? <div>{uiText("compact_status_attempt_strategy", {
        strategy: uiText(strategyLabels[attemptStrategy]),
      })}</div> : null}
      {applied ? <div>{applied}</div> : null}
      {pending ? <div>{pending}</div> : null}
    </div>
  </div>
}
