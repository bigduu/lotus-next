import { useEffect, useMemo, useRef, useState } from "react"
import { useUiText } from "@shared/i18n/ui"
import { Button } from "@/components/ui/button"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog"
import { getRuntimeConfig } from "@/runtime/runtimeConfig"
import { createRunDiagnostics, downloadRunDiagnostics, type DiagnosticEvidence, type RunDiagnosticsReport } from "@/lib/runDiagnostics"
import type { RunDiagnosticsSubject } from "@/lib/runDiagnosticId"
import { agentClient } from "@services/chat/AgentService"
import { inspectCanonicalDiagnostic } from "@services/chat/runDiagnostic"

const readCanonical = (sessionId: string): Promise<{ session: unknown }> => agentClient.getSession(sessionId)
const stageLabels = { send_headers:"run_diagnostics_phase_headers", error_body:"run_diagnostics_phase_body",
  response_status:"run_diagnostics_phase_status", backoff:"run_diagnostics_phase_backoff" } as const
const stopLabels = { attempts_exhausted:"run_diagnostics_stop_attempts", time_budget_exhausted:"run_diagnostics_stop_time",
  retry_delay_exceeds_budget:"run_diagnostics_stop_delay", non_retryable_transport:"run_diagnostics_stop_transport",
  unclassified_error_body:"run_diagnostics_stop_body", cancelled_or_dropped:"run_diagnostics_stop_cancelled" } as const

export function RunDiagnosticsDialogContent({ subject, isCurrent, onClose, download = downloadRunDiagnostics, readSession = readCanonical }: {
  subject: RunDiagnosticsSubject
  isCurrent: () => boolean
  onClose: () => void
  download?: (report: RunDiagnosticsReport) => void
  readSession?: (sessionId: string) => Promise<{ session: unknown }>
}) {
  const t = useUiText()
  const [collectedAt] = useState(() => new Date().toISOString())
  const [evidence, setEvidence] = useState<DiagnosticEvidence & { revision: number }>(() => ({
    diagnostic: subject.liveDiagnostic ?? null, source:"live_event", canonicalStatus:"not_checked", revision:0,
  }))
  const [outcome, setOutcome] = useState<"requested" | "failed" | null>(null)
  const currentGuard = useRef(isCurrent), requestEpoch = useRef(0), revision = useRef(0), reading = useRef(false)
  currentGuard.current = isCurrent
  useEffect(() => () => { requestEpoch.current++; revision.current++ }, [])
  const report = useMemo(() => createRunDiagnostics(subject, subject.sessionId, getRuntimeConfig(), collectedAt, evidence), [subject, collectedAt, evidence])
  const renderedRevision = evidence.revision
  const save = () => {
    if (!report || !currentGuard.current() || revision.current !== renderedRevision) return
    try { download(report); setOutcome("requested") }
    catch { setOutcome("failed") }
  }
  const refresh = async () => {
    if (reading.current || !currentGuard.current() || subject.sessionId === null || !subject.errorBinding) return
    reading.current = true
    const request = ++requestEpoch.current
    const replace = (next: DiagnosticEvidence) => setEvidence({ ...next, revision:++revision.current })
    // An explicit read withdraws the old receipt immediately. Missing/error never revives it.
    replace({ diagnostic:null, source:"canonical_read", canonicalStatus:"loading" })
    setOutcome(null)
    try {
      const response = await readSession(subject.sessionId)
      if (request !== requestEpoch.current || !currentGuard.current()) return
      const checked = inspectCanonicalDiagnostic(response.session, subject.sessionId, subject.errorBinding)
      replace({ diagnostic:checked.diagnostic, source:"canonical_read", canonicalStatus:checked.status })
    } catch {
      if (request === requestEpoch.current && currentGuard.current()) replace({ diagnostic:null, source:"canonical_read", canonicalStatus:"unavailable" })
    } finally {
      if (request === requestEpoch.current) reading.current = false
    }
  }
  const detail = report?.diagnostic
  const sourceText = evidence.canonicalStatus === "changed" ? "run_diagnostics_changed"
    : evidence.canonicalStatus === "unavailable" ? "run_diagnostics_read_failed"
    : evidence.canonicalStatus === "loading" ? "loading_4927a53b"
    : detail?.source === "canonical_read" ? "run_diagnostics_canonical"
    : detail?.source === "live_event" ? "run_diagnostics_live" : "run_diagnostics_legacy"
  return <ResponsiveDialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <ResponsiveDialogContent className="gap-3 overflow-y-auto p-4 sm:pb-4 sm:max-w-lg">
      <ResponsiveDialogTitle>{t("run_diagnostics_title")}</ResponsiveDialogTitle>
      <ResponsiveDialogDescription>{t("run_diagnostics_privacy")}</ResponsiveDialogDescription>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt>{t("run_diagnostics_id")}</dt><dd className="break-all font-mono text-xs">{detail?.diagnostic_id ?? t("run_diagnostics_not_provided")}</dd>
        <dt>{t("run_diagnostics_stage")}</dt><dd>{detail?.failure_stage ? t(stageLabels[detail.failure_stage]) : t("run_diagnostics_not_provided")}</dd>
        <dt>{t("run_diagnostics_attempts")}</dt><dd>{detail?.attempt !== null && detail?.attempt !== undefined ? String(detail.attempt) + " / " + detail.attempt_limit : t("run_diagnostics_not_provided")}</dd>
        <dt>{t("run_diagnostics_stop_reason")}</dt><dd>{detail?.retry_stop_reason ? t(stopLabels[detail.retry_stop_reason]) : t("run_diagnostics_not_provided")}</dd>
      </dl>
      <p role={evidence.canonicalStatus === "changed" ? "alert" : "status"} className="text-xs text-muted-foreground">{t(sourceText)}</p>
      <pre aria-label={t("run_diagnostics_preview")} className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs">{JSON.stringify(report, null, 2)}</pre>
      {outcome ? <p role={outcome === "failed" ? "alert" : "status"} className="text-sm">{t(outcome === "failed" ? "run_diagnostics_download_failed" : "run_diagnostics_download_requested")}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onClose}>{t("close_3fd47edc")}</Button>
        {subject.sessionId !== null && subject.errorBinding ? <Button size="sm" variant="outline" disabled={evidence.canonicalStatus === "loading"} onClick={() => void refresh()}>{t("run_diagnostics_read")}</Button> : null}
        <Button size="sm" disabled={!report} onClick={save}>{t("run_diagnostics_download")}</Button>
      </div>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}
