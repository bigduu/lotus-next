import { useState } from "react"
import { useUiText } from "@shared/i18n/ui"
import { Button } from "@/components/ui/button"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog"
import { getRuntimeConfig } from "@/runtime/runtimeConfig"
import { createRunDiagnostics, downloadRunDiagnostics, type RunDiagnosticsReport } from "@/lib/runDiagnostics"
import type { RunDiagnosticsSubject } from "@/lib/runDiagnosticId"

export function RunDiagnosticsDialogContent({ subject, isCurrent, onClose, download = downloadRunDiagnostics }: {
  subject: RunDiagnosticsSubject
  isCurrent: () => boolean
  onClose: () => void
  /** Local download seam; production never uploads or calls a backend/tool. */
  download?: (report: RunDiagnosticsReport) => void
}) {
  const t = useUiText()
  const [report] = useState(() => createRunDiagnostics(subject, subject.sessionId, getRuntimeConfig()))
  const [outcome, setOutcome] = useState<"requested" | "failed" | null>(null)
  const save = () => {
    if (!report || !isCurrent()) return
    try { download(report); setOutcome("requested") }
    catch { setOutcome("failed") }
  }
  return <ResponsiveDialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <ResponsiveDialogContent className="gap-3 overflow-y-auto p-4 sm:pb-4 sm:max-w-lg">
      <ResponsiveDialogTitle>{t("run_diagnostics_title")}</ResponsiveDialogTitle>
      <ResponsiveDialogDescription>{t("run_diagnostics_privacy")}</ResponsiveDialogDescription>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt>{t("run_diagnostics_id")}</dt><dd className="break-all font-mono text-xs">{report?.diagnostic.diagnostic_id ?? t("run_diagnostics_not_provided")}</dd>
        <dt>{t("run_diagnostics_stage")}</dt><dd>{t("run_diagnostics_not_provided")}</dd>
        <dt>{t("run_diagnostics_attempts")}</dt><dd>{t("run_diagnostics_not_provided")}</dd>
        <dt>{t("run_diagnostics_stop_reason")}</dt><dd>{t("run_diagnostics_not_provided")}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">{t("run_diagnostics_legacy")}</p>
      <pre aria-label={t("run_diagnostics_preview")} className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs">{JSON.stringify(report, null, 2)}</pre>
      {outcome ? <p role={outcome === "failed" ? "alert" : "status"} className="text-sm">{t(outcome === "failed" ? "run_diagnostics_download_failed" : "run_diagnostics_download_requested")}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onClose}>{t("close_3fd47edc")}</Button>
        <Button size="sm" disabled={!report} onClick={save}>{t("run_diagnostics_download")}</Button>
      </div>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}
