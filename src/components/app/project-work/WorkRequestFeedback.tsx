import type { WorkControlCopy, WorkRequestStatus } from "./projectWorkControls"

export function WorkRequestFeedback({ status, submitting, uncertain, copy, onReload, onReconcile }: {
  status: WorkRequestStatus; submitting: boolean; uncertain: boolean; copy: WorkControlCopy
  onReload: () => void; onReconcile?: (operationId: string) => void
}) {
  const label = status.phase === "idle" ? null : ({ requested: copy.requestSent, awaiting_ack: copy.awaitingAck,
    acknowledged: copy.acknowledged, conflict: copy.conflict, denied: copy.denied,
    outcome_unknown: copy.outcomeUnknown, failed: copy.failed })[status.phase]
  const reload = uncertain || ["conflict", "denied", "outcome_unknown", "failed"].includes(status.phase)
  return <div className="space-y-2 text-sm">
    {submitting ? <p role="status">{copy.submitting}</p> : null}
    {uncertain ? <p role="alert" className="break-words text-destructive">{copy.outcomeUnknown}</p> : null}
    {label ? <div role={reload ? "alert" : "status"} className="break-words">
      <p>{label}</p>{status.phase !== "idle" ? <><p className="text-xs text-muted-foreground">{copy.operation}: <span className="break-all">{status.operationId}</span></p>{status.detail ? <p>{status.detail}</p> : null}</> : null}
    </div> : null}
    {reload ? <div className="flex flex-wrap gap-2">
      <button type="button" className="rounded-md border px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onReload}>{copy.reload}</button>
      {status.phase !== "idle" && onReconcile ? <button type="button" className="rounded-md border px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onReconcile(status.operationId)}>{copy.reconcile}</button> : null}
    </div> : null}
  </div>
}
