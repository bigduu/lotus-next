import { useState } from "react"
import { createRoot } from "react-dom/client"
import "../../src/index.css"
import { ProjectWorkPlanningControls } from "../../src/components/app/project-work/ProjectWorkPlanningControls"
import { ProjectWorkOwnerControls } from "../../src/components/app/project-work/ProjectWorkOwnerControls"
import type { WorkCommandContext, WorkControlCopy, WorkPlanningDraft, WorkPlanningQuery, WorkPlanningValue, WorkRequestStatus } from "../../src/components/app/project-work/projectWorkControls"

const parameters = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", parameters.get("theme") === "dark")
const copy = await fetch("./project-work-controls-copy.json").then((response) => response.json()) as WorkControlCopy
const pending = parameters.get("scenario") !== "editable"
const context = (operationId: string): WorkCommandContext => ({ operationId, workId: "synthetic-work-1", generation: 3, recordRevision: 8,
  binding: { scope_id: "synthetic-scope", supervisor_session_id: "synthetic-owner", binding_revision: 2 }, expectedSeq: 19, expectedEpoch: 4 })
export function Fixture() {
  const [draft, setDraft] = useState<WorkPlanningDraft>({ priority: "high", expectedCompletionAt: "2026-10-19T09:15:00-07:00" })
  const [query, setQuery] = useState<WorkPlanningQuery>({ order: "priority", priority: null, deadline: "any", asOf: "2026-10-17T17:00:00Z" })
  const [planRequest, setPlanRequest] = useState<WorkRequestStatus>({ phase: "idle" })
  const [ownerRequest, setOwnerRequest] = useState<WorkRequestStatus>(pending ? { phase: "awaiting_ack", operationId: "synthetic-pause-1" } : { phase: "idle" })
  const [paused, setPaused] = useState(false)
  const [log, setLog] = useState<unknown[]>([])
  const current: WorkPlanningValue = { priority: "medium", expectedCompletionAt: "2026-10-18T00:00:00+08:00" }
  const note = (value: unknown) => setLog((previous) => [...previous, value])
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: 20, display: "grid", gap: 16 }}>
    <header><h1 style={{ fontSize: 24, fontWeight: 600 }}>Project Work · planning and owner controls</h1>
      <p style={{ marginTop: 8, color: "var(--muted-foreground)", fontSize: 13 }}>Component fixture with synthetic capabilities. No live Bamboo API, runtime or provider execution. Desired deadline is separate from ETA.</p></header>
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 430px), 1fr))", alignItems: "start" }}>
      <ProjectWorkPlanningControls work={{ id: "synthetic-work-1", generation: 3, recordRevision: 8, state: "active" }}
        current={current} draft={draft} query={query} owner editCapability={{ available: true }} queryCapability={{ available: true }}
        command={context("synthetic-plan-1")} request={planRequest} copy={copy} onDraftChange={setDraft}
        onQueryChange={(value) => { setQuery(value); note({ kind: "server_query", query: value }) }}
        onSavePlanning={async (value, command) => { note({ kind: "save_planning", value, command }); setPlanRequest({ phase: "requested", operationId: command.operationId }); return { operationId: command.operationId } }}
        onReload={() => note({ kind: "reload_planning" })} onReconcile={(operationId) => note({ kind: "reconcile", operationId })} />
      <ProjectWorkOwnerControls work={{ id: "synthetic-work-1", generation: 3, recordRevision: 8, contractRevision: 5,
        currentSubmissionId: "synthetic-submission-1", state: "active", paused }} owner
        capabilities={{ pause: { available: true }, resume: { available: false }, cancel: { available: true }, accept: { available: false, reason: "Backend stop guard has not been delivered; User acceptance is unavailable." } }}
        commands={{ pause: context("synthetic-pause-1"), cancel: context("synthetic-cancel-1") }} request={ownerRequest}
        acceptance={{ submissionId: "synthetic-submission-1", generation: 3, contractRevision: 5, stale: false, stopGuardEnforced: false,
          processStopped: null, evidence: ["Source review is recorded."], unverifiedItems: ["Runtime safe stop has not been confirmed.", "Live backend and automated test results have not been verified by this fixture."] }}
        acceptanceConfirmation={null} acceptedByUser={false} copy={copy} onAcceptanceConfirmationChange={() => {}}
        onRequestAction={async (intent, command) => { note({ intent, command }); setOwnerRequest({ phase: "requested", operationId: command.operationId }); return { operationId: command.operationId } }}
        onReload={() => note({ kind: "reload_owner" })} onReconcile={(operationId) => note({ kind: "reconcile", operationId })} />
    </div>
    <aside aria-label="Fixture controls" style={{ fontSize: 12, display: "grid", gap: 8 }}>
      <p>Fixture controls below change props only. They are not product commands.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <button type="button" style={{ border: "1px solid var(--border)", padding: 8, borderRadius: 6 }} onClick={() => setOwnerRequest({ phase: "acknowledged", operationId: "synthetic-pause-1" })}>Simulate runtime ACK</button>
        <button type="button" style={{ border: "1px solid var(--border)", padding: 8, borderRadius: 6 }} onClick={() => setPaused(true)}>Apply authoritative paused prop</button>
        <button type="button" style={{ border: "1px solid var(--border)", padding: 8, borderRadius: 6 }} onClick={() => setOwnerRequest({ phase: "conflict", operationId: "synthetic-pause-1" })}>Simulate CAS conflict</button>
      </div>
      <output data-testid="fixture-callback-log" style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{JSON.stringify(log, null, 2)}</output>
    </aside>
  </main>
}
createRoot(document.getElementById("root")!).render(<Fixture />)
