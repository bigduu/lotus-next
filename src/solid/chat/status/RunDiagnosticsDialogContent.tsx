import { createMemo, createSignal, onSettled, Show, untrack } from "solid-js"
import { getRuntimeConfig } from "@/runtime/runtimeConfig"
import { createRunDiagnostics, downloadRunDiagnostics, type DiagnosticEvidence } from "@/lib/runDiagnostics"
import type { RunDiagnosticsSubject } from "@/lib/runDiagnosticId"
import { agentClient } from "@services/chat/AgentService"
import { inspectCanonicalDiagnostic } from "@services/chat/runDiagnostic"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle,
} from "../../ui/responsive-dialog"

const stageLabels = {
  send_headers: "run_diagnostics_phase_headers",
  error_body: "run_diagnostics_phase_body",
  response_status: "run_diagnostics_phase_status",
  backoff: "run_diagnostics_phase_backoff",
  bootstrap: "run_diagnostics_phase_bootstrap",
  transport_idle: "run_diagnostics_phase_transport_idle",
  first_semantic: "run_diagnostics_phase_first_semantic",
  semantic_idle: "run_diagnostics_phase_semantic_idle",
} as const

const stopLabels = {
  attempts_exhausted: "run_diagnostics_stop_attempts",
  time_budget_exhausted: "run_diagnostics_stop_time",
  retry_delay_exceeds_budget: "run_diagnostics_stop_delay",
  non_retryable_transport: "run_diagnostics_stop_transport",
  retry_delay_too_large: "run_diagnostics_stop_delay_too_large",
  unclassified_error_body: "run_diagnostics_stop_body",
  cancelled_or_dropped: "run_diagnostics_stop_cancelled",
} as const

export function RunDiagnosticsDialogContent(props: {
  subject: RunDiagnosticsSubject
  isCurrent: () => boolean
  onClose: () => void
}) {
  const text = createUiText()
  const subject = untrack(() => props.subject)
  const collectedAt = new Date().toISOString()
  const [evidence, setEvidence] = createSignal<DiagnosticEvidence & { revision: number }>({
    diagnostic: subject.liveDiagnostic ?? null, source: "live_event", canonicalStatus: "not_checked", revision: 0,
  })
  const [outcome, setOutcome] = createSignal<"requested" | "failed" | null>(null)
  let revision = 0
  let reading = false
  let active = true
  onSettled(() => () => { active = false })

  const isCurrent = () => active && props.isCurrent()
  const report = createMemo(() => createRunDiagnostics(subject, subject.sessionId, getRuntimeConfig(), collectedAt, evidence()))
  const detail = () => report()?.diagnostic
  const notProvided = () => text("run_diagnostics_not_provided")
  const sourceLabel = () => {
    const status = evidence().canonicalStatus
    if (status === "changed") return "run_diagnostics_changed"
    if (status === "unavailable") return "run_diagnostics_read_failed"
    if (status === "loading") return "loading_4927a53b"
    if (detail()?.source === "canonical_read") return "run_diagnostics_canonical"
    return detail()?.source === "live_event" ? "run_diagnostics_live" : "run_diagnostics_legacy"
  }
  const stage = () => {
    const value = detail()?.failure_stage
    return value ? text(stageLabels[value]) : notProvided()
  }
  const attempts = () => {
    const value = detail()
    if (value?.attempt == null) return notProvided()
    return value.retry_mode === "until_cancelled" ? text("run_diagnostics_continuous_attempts", { count: value.attempt })
      : `${value.attempt} / ${value.attempt_limit}`
  }
  const stopReason = () => {
    const value = detail()?.retry_stop_reason
    return value ? text(stopLabels[value]) : notProvided()
  }

  const save = () => {
    const value = report()
    if (!value || !isCurrent() || evidence().revision !== revision) return
    try { downloadRunDiagnostics(value); setOutcome("requested") }
    catch { setOutcome("failed") }
  }

  async function refresh() {
    const { sessionId, errorBinding } = subject
    if (!sessionId || !errorBinding || reading || !isCurrent()) return
    reading = true
    const replace = (next: Pick<DiagnosticEvidence, "diagnostic" | "canonicalStatus">) => {
      setEvidence({ ...next, source: "canonical_read", revision: ++revision })
    }
    replace({ diagnostic: null, canonicalStatus: "loading" })
    setOutcome(null)
    try {
      const response = await agentClient.getSession(sessionId)
      if (!isCurrent()) return
      const confirmed = inspectCanonicalDiagnostic(response.session, sessionId, errorBinding)
      replace({ diagnostic: confirmed.diagnostic, canonicalStatus: confirmed.status })
    } catch {
      if (isCurrent()) replace({ diagnostic: null, canonicalStatus: "unavailable" })
    } finally {
      reading = false
    }
  }

  return <ResponsiveDialog open onOpenChange={(open) => { if (!open) props.onClose() }}>
    <ResponsiveDialogContent class="gap-3 overflow-y-auto p-4 sm:max-w-lg sm:pb-4">
      <ResponsiveDialogTitle>{text("run_diagnostics_title")}</ResponsiveDialogTitle>
      <ResponsiveDialogDescription>{text("run_diagnostics_privacy")}</ResponsiveDialogDescription>
      <dl class="grid grid-cols-2 gap-2 text-sm">
        <dt>{text("run_diagnostics_id")}</dt><dd class="break-all font-mono text-xs">{detail()?.diagnostic_id ?? notProvided()}</dd>
        <dt>{text("run_diagnostics_stage")}</dt><dd>{stage()}</dd>
        <Show when={detail()?.kind === "stream_timeout"} fallback={<>
          <dt>{text("run_diagnostics_attempts")}</dt><dd>{attempts()}</dd>
          <dt>{text("run_diagnostics_stop_reason")}</dt><dd>{stopReason()}</dd>
        </>}>
          <dt>{text("run_diagnostics_deadline")}</dt><dd>{detail()?.deadline_ms} ms</dd>
          <dt>{text("run_diagnostics_transport_gap")}</dt><dd>{detail()?.last_transport_ms_ago} ms</dd>
          <dt>{text("run_diagnostics_semantic_gap")}</dt>
          <dd>{detail()?.semantic_output_started ? `${detail()?.last_semantic_ms_ago} ms` : text("run_diagnostics_output_not_started")}</dd>
          <dt>{text("run_diagnostics_retry_safety")}</dt>
          <dd>{text(detail()?.retry_safe ? "run_diagnostics_retry_safe" : "run_diagnostics_retry_unsafe")}</dd>
        </Show>
      </dl>
      <p role={evidence().canonicalStatus === "changed" ? "alert" : "status"} class="text-xs text-muted-foreground">
        {text(sourceLabel())}
      </p>
      <pre aria-label={text("run_diagnostics_preview")} class="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs">
        {JSON.stringify(report(), null, 2)}
      </pre>
      <Show when={outcome()}>
        <p role={outcome() === "failed" ? "alert" : "status"} class="text-sm">
          {text(outcome() === "failed" ? "run_diagnostics_download_failed" : "run_diagnostics_download_requested")}
        </p>
      </Show>
      <div class="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={props.onClose}>{text("close_3fd47edc")}</Button>
        <Show when={subject.sessionId !== null && subject.errorBinding}>
          <Button type="button" size="sm" variant="outline" disabled={evidence().canonicalStatus === "loading"} onClick={() => void refresh()}>
            {text("run_diagnostics_read")}
          </Button>
        </Show>
        <Button type="button" size="sm" disabled={!report()} onClick={save}>{text("run_diagnostics_download")}</Button>
      </div>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}
