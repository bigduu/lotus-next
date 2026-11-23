import { LoaderCircle } from "@lucide/solid"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { uiText } from "@shared/i18n/text"
import { backendSupports, onBackendFeatures } from "@/lib/backendFeatures"
import type { ContextCompressionFeedback } from "@/lib/contextCompression"
import { agentClient, type ActiveCompaction, type CompactionStrategy, type SessionCompactionStatus } from "@services/chat/AgentService"
import { createUiLocale } from "../../shell/uiText"
import { createExternalSnapshot } from "../snapshots"

const strategyLabels = {
  summary: "context_full_summary_label",
  message_summary: "context_message_summary_label",
  retrieval_window: "context_retrieval_window_label",
} satisfies Record<CompactionStrategy, Parameters<typeof uiText>[0]>

function compressionMessage(text: typeof uiText, feedback?: ContextCompressionFeedback | null): string | undefined {
  switch (feedback?.status) {
    case "running": return text("context_compression_notice_running")
    case "completed":
      if (feedback.awaitingUsage === true) return text("context_compression_notice_completed_waiting")
      if (feedback.awaitingUsage === false) return text("context_compression_notice_completed")
      return undefined
    case "failed":
      switch (feedback.reason) {
        case "candidate_plan": return text("context_compression_notice_failed_candidate")
        case "empty_summary": return text("context_compression_notice_empty_summary")
        case "postcondition": return text("context_compression_notice_failed_postcondition")
        case "other": return text("context_compression_notice_failed")
        default: return undefined
      }
    case "deferred":
      switch (feedback.reason) {
        case "tool_protocol": return text("context_compression_notice_deferred_tool")
        case "other": return text("context_compression_notice_deferred")
        default: return undefined
      }
    case "skipped":
      switch (feedback.reason) {
        case "no_model": return text("context_compression_notice_skipped_no_model")
        case "other": return text("context_compression_notice_skipped")
        default: return undefined
      }
    case "cancelled": return text("context_compression_notice_cancelled")
    case "unconfirmed": return text("context_compression_notice_unconfirmed")
    default: return undefined
  }
}

function progressMessage(text: typeof uiText, active: ActiveCompaction) {
  switch (active.phase) {
    case "preparing": return text("compact_status_preparing")
    case "summarizing": return text("compact_status_summarizing", { part: active.part, total: active.total })
    case "merging": return text("compact_status_merging", { part: active.part, total: active.total })
    case "validating": return text("compact_status_validating")
    case "saving": return text("compact_status_saving")
  }
}

export function ContextCompressionNotice(props: {
  feedback?: ContextCompressionFeedback | null
  sessionId?: string | null
  manualPending?: boolean
  runActive?: boolean
}) {
  const locale = createUiLocale()
  const text: typeof uiText = (key, values) => uiText(key, { ...values, lng: locale() })
  const supported = createExternalSnapshot(onBackendFeatures, () => backendSupports("session_compaction_status"))
  const visit = createMemo(() => ({ id: supported() ? props.sessionId : null }), {
    equals: (previous, next) => previous?.id === next.id,
  })
  const [observation, setObservation] = createSignal<{ visit: ReturnType<typeof visit>; status: SessionCompactionStatus }>()
  const [uncertainty, setUncertainty] = createSignal<ReturnType<typeof visit>>()
  const status = () => {
    const read = observation()
    return read?.visit === visit() ? read.status : undefined
  }
  const streamRunning = () => props.feedback?.status === "running"

  // An advertised endpoint is authoritative for operation progress and saved
  // strategies. Scope discovery, focus refresh and asynchronous polls to
  // this exact session visit, even if the user switches away and back.
  createEffect(() => [visit(), props.manualPending, props.runActive, props.feedback] as const,
    ([origin, manualPending, runActive, feedback]) => {
      if (!origin.id) return
      const sessionId = origin.id
      const controller = new AbortController()
      let timer: number | undefined
      let reading = false
      let consecutiveFailures = 0
      const awaitingAttempt = manualPending || (runActive && feedback?.status === "running")
      let shouldPoll = awaitingAttempt
      const current = () => !controller.signal.aborted && visit() === origin

      async function refresh() {
        if (reading || !current()) return
        window.clearTimeout(timer)
        reading = true
        try {
          const value = await agentClient.getSessionCompactionStatus(sessionId, controller.signal)
          if (!current()) return
          shouldPoll = awaitingAttempt || value.active !== null
          consecutiveFailures = 0
          setObservation({ visit: origin, status: value })
          setUncertainty(undefined)
        } catch {
          if (current()) {
            consecutiveFailures += 1
            setUncertainty(origin)
          }
        } finally {
          reading = false
          const retryDiscovery = consecutiveFailures > 0 && consecutiveFailures <= 2
          if (current() && (shouldPoll || retryDiscovery)) timer = window.setTimeout(refresh, 2_000)
        }
      }

      void refresh()
      window.addEventListener("focus", refresh)
      return () => {
        controller.abort()
        window.clearTimeout(timer)
        window.removeEventListener("focus", refresh)
      }
    })

  const uncertain = () => visit().id && uncertainty() === visit()
    && (props.manualPending || streamRunning() || status()?.active || props.feedback?.status === "completed")
  const active = () => uncertain() ? null : status()?.active
  const previous = () => status()?.applied
  const observedFeedback = () => visit().id && (props.feedback?.status === "completed" || (streamRunning() && status()))
    ? null : props.feedback
  const spinning = () => !uncertain() && (active() || props.manualPending || observedFeedback()?.status === "running")
  const message = () => {
    if (uncertain()) return text("context_compression_notice_unconfirmed")
    const current = active()
    if (current) return progressMessage(text, current)
    if (props.manualPending) return text(visit().id ? "compact_status_preparing" : "compact_in_progress")
    return compressionMessage(text, observedFeedback())
  }
  const pendingStrategy = () => {
    const known = active()?.strategy ?? previous()?.strategy
    const configured = status()?.configured_strategy
    return known && configured && configured !== known ? configured : undefined
  }
  const number = createMemo(() => new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }))

  return <Show when={message() || previous()}>
    <div role="status" aria-live="polite" aria-atomic="true"
      class="flex min-w-0 items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      data-testid="context-compression-notice">
      <Show when={message() && spinning()}>
        <LoaderCircle aria-hidden="true" class="mt-0.5 size-3.5 shrink-0 motion-safe:animate-spin" />
      </Show>
      <div class="min-w-0 break-words">
        <Show when={message()}>
          <div>{message()}<Show when={active()}>{(attempt) =>
            <span aria-hidden="true"> · {text("compact_status_elapsed", {
              seconds: number().format(Math.floor(attempt().elapsed_ms / 1_000)),
            })}</span>}
          </Show></div>
        </Show>
        <Show when={active()?.strategy}>{(strategy) => <div>{text("compact_status_attempt_strategy", { strategy: text(strategyLabels[strategy()]) })}</div>}</Show>
        <Show when={previous()}>{(applied) => <div>{text("compact_status_applied", { strategy: text(strategyLabels[applied().strategy]) })}</div>}</Show>
        <Show when={pendingStrategy()}>{(strategy) => <div>{text("compact_status_pending_strategy", { strategy: text(strategyLabels[strategy()]) })}</div>}</Show>
      </div>
    </div>
  </Show>
}
