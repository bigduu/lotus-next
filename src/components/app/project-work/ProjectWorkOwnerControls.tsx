import { useId } from "react"
import type { WorkState } from "@services/tickets/types"
import { Button } from "@/components/ui/button"
import { WorkRequestFeedback } from "./WorkRequestFeedback"
import { useWorkRequestGuard } from "./useWorkRequestGuard"
import { commandMatches, type ControlCapability, type WorkCommandContext, type WorkControlCopy,
  type WorkRequestReceipt, type WorkRequestStatus } from "./projectWorkControls"

export type WorkOwnerAction = "pause" | "resume" | "cancel" | "accept"
export interface WorkUserAcceptance {
  submissionId: string
  generation: number
  contractRevision: number
  stale: boolean
  stopGuardEnforced: boolean
  processStopped: boolean | null
  evidence: readonly string[]
  unverifiedItems: readonly string[]
}
export type WorkAcceptanceConfirmation = Pick<WorkUserAcceptance, "submissionId" | "generation" | "contractRevision">
export type WorkOwnerIntent = { kind: "pause" | "resume" | "cancel" }
  | { kind: "accept"; source: "user"; submissionId: string; generation: number; contractRevision: number; unverifiedItems: readonly string[] }
export interface ProjectWorkOwnerControlsProps {
  work: { id: string; generation: number; recordRevision: number; contractRevision: number; currentSubmissionId: string | null; state: WorkState; paused: boolean | null }
  owner: boolean
  capabilities: Record<WorkOwnerAction, ControlCapability>
  commands: Partial<Record<WorkOwnerAction, WorkCommandContext>>
  request: WorkRequestStatus
  acceptance: WorkUserAcceptance | null
  acceptanceConfirmation: WorkAcceptanceConfirmation | null
  acceptedByUser: boolean
  copy: WorkControlCopy
  onAcceptanceConfirmationChange: (confirmation: WorkAcceptanceConfirmation | null) => void
  onRequestAction: (intent: WorkOwnerIntent, context: WorkCommandContext) => Promise<WorkRequestReceipt>
  onReload: () => void
  onReconcile?: (operationId: string) => void
}
export function ProjectWorkOwnerControls(props: ProjectWorkOwnerControlsProps) {
  const { work, owner, capabilities, commands, request, acceptance, acceptanceConfirmation, acceptedByUser, copy,
    onAcceptanceConfirmationChange, onRequestAction, onReload, onReconcile } = props
  const id = useId()
  const guard = useWorkRequestGuard(Object.values(commands).map((command) => command.operationId))
  const busy = request.phase !== "idle" || guard.submitting || guard.uncertain || Object.values(commands).some((command) => guard.sent(command.operationId))
  const acceptanceSafe = !!acceptance && acceptance.stopGuardEnforced === true && acceptance.processStopped === true
    && !acceptance.stale && acceptance.generation === work.generation && !!acceptance.submissionId
    && acceptance.submissionId === work.currentSubmissionId && acceptance.contractRevision === work.contractRevision
    && Number.isSafeInteger(acceptance.contractRevision) && acceptance.contractRevision >= 1
  const confirmed = !!acceptance && acceptanceConfirmation?.submissionId === acceptance.submissionId
    && acceptanceConfirmation.generation === acceptance.generation && acceptanceConfirmation.contractRevision === acceptance.contractRevision
  const allowed = (action: WorkOwnerAction) => owner && capabilities[action].available && commandMatches(commands[action], work)
    && !busy && (action !== "accept" || (acceptanceSafe && confirmed))
  const requestAction = (action: WorkOwnerAction) => {
    const context = commands[action]
    if (!allowed(action) || !context) return
    const intent: WorkOwnerIntent = action === "accept" && acceptance ? { kind: "accept", source: "user",
      submissionId: acceptance.submissionId, generation: acceptance.generation,
      contractRevision: acceptance.contractRevision, unverifiedItems: [...acceptance.unverifiedItems] } : { kind: action as "pause" | "resume" | "cancel" }
    void guard.send(context.operationId, () => onRequestAction(intent, context))
  }
  return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-3 rounded-xl border bg-background p-4 text-sm" data-testid="project-work-owner-controls">
    <h3 id={`${id}-title`} className="font-semibold">{copy.ownerControls}</h3>
    <p>{copy.actualState}: <strong data-testid="work-authoritative-state">{copy.states[work.state]}</strong>{work.paused === true ? ` · ${copy.paused}` : work.paused === null ? ` · ${copy.pauseUnknown}` : ""}</p>
    <p className="text-xs text-muted-foreground">{copy.actualStateHelp}</p>
    {!owner ? <p role="status">{copy.ownerRequired}</p> : null}
    <div className="flex flex-wrap gap-2">{(["pause", "resume", "cancel"] as const).map((action) => <div key={action} className="min-w-0 max-w-full space-y-1">
      <Button type="button" size="sm" variant={action === "cancel" ? "destructive" : "outline"} disabled={!allowed(action)} onClick={() => requestAction(action)}>{copy[action]}</Button>
      {!capabilities[action].available ? <p className="max-w-xs break-words text-xs text-muted-foreground">{capabilities[action].reason || copy.unsupported}</p> : !commandMatches(commands[action], work) ? <p className="max-w-xs text-xs text-muted-foreground">{copy.unavailableContext}</p> : null}
    </div>)}</div>
    <div className="min-w-0 space-y-2 border-t pt-3">
      {acceptance ? <>
        <p className="break-all">{copy.submission}: {acceptance.submissionId}</p>
        <p className="font-medium">{copy.evidence}</p>
        {acceptance.evidence.length ? <ul className="list-inside list-disc break-words">{acceptance.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>{copy.evidenceNotRecorded}</p>}
        <p className="font-medium">{copy.unverified}</p>
        {acceptance.unverifiedItems.length ? <ul className="list-inside list-disc break-words">{acceptance.unverifiedItems.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="text-muted-foreground">{copy.noUnverifiedRecorded}</p>}
      </> : null}
      <p className="text-xs text-muted-foreground">{copy.userAcceptance}</p>
      {!acceptanceSafe ? <p role="status" className="text-xs text-muted-foreground">{copy.completionGuard}</p> : null}
      {!capabilities.accept.available ? <p role="status" className="text-xs text-muted-foreground">{capabilities.accept.reason || copy.unsupported}</p> : null}
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmed} disabled={!owner || !capabilities.accept.available || !acceptanceSafe || busy} onChange={(event) => onAcceptanceConfirmationChange(event.target.checked && acceptance ? { submissionId: acceptance.submissionId, generation: acceptance.generation, contractRevision: acceptance.contractRevision } : null)} /><span>{copy.acceptanceConfirmation}</span></label>
      <Button type="button" size="sm" disabled={!allowed("accept")} onClick={() => requestAction("accept")}>{copy.accept}</Button>
      {work.state === "accepted" && acceptedByUser ? <p className="font-medium">{copy.acceptedByUser}</p> : null}
    </div>
    <WorkRequestFeedback status={request.phase === "idle" && guard.uncertain ? { phase: "outcome_unknown", operationId: guard.operationId! } : request} submitting={guard.submitting} uncertain={false} copy={copy} onReload={onReload} onReconcile={onReconcile} />
  </section>
}
