import { createSignal } from "solid-js"
import { render } from "@solidjs/web"
import "../../src/solid/styles.css"
import { ProjectWorkOwnerControls, ProjectWorkPlanningControls } from "../../src/solid/project-work/ProjectWorkControls"
import type { WorkCommandContext, WorkControlCopy, WorkPlanningDraft, WorkPlanningQuery, WorkPlanningValue, WorkRequestStatus } from "../../src/components/app/project-work/projectWorkControls"

const parameters = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", parameters.get("theme") === "dark")
const copy = await fetch("./project-work-controls-copy.json").then((response) => response.json()) as WorkControlCopy
const pending = parameters.get("scenario") !== "editable"
const context = (operationId: string): WorkCommandContext => ({ operationId, workId: "synthetic-work-1", generation: 3, recordRevision: 8,
  binding: { scope_id: "synthetic-scope", supervisor_session_id: "synthetic-owner", binding_revision: 2 }, expectedSeq: 19, expectedEpoch: 4 })
export function Fixture() {
  const [draft, setDraft] = createSignal<WorkPlanningDraft>({ priority: "high", expectedCompletionAt: "2026-10-19T09:15:00-07:00" })
  const [query, setQuery] = createSignal<WorkPlanningQuery>({ order: "priority", priority: null, deadline: "any", asOf: "2026-10-17T17:00:00Z" })
  const [planRequest, setPlanRequest] = createSignal<WorkRequestStatus>({ phase: "idle" })
  const [ownerRequest, setOwnerRequest] = createSignal<WorkRequestStatus>(pending ? { phase: "awaiting_ack", operationId: "synthetic-pause-1" } : { phase: "idle" })
  const [paused, setPaused] = createSignal(false)
  const [log, setLog] = createSignal<unknown[]>([])
  const current: WorkPlanningValue = { priority: "medium", expectedCompletionAt: "2026-10-18T00:00:00+08:00" }
  const note = (value: unknown) => setLog((previous) => [...previous, value])
  return <main style={{ "max-width": "1120px", margin: "0 auto", padding: "20px", display: "grid", gap: "16px" }}>
    <header><h1 style={{ "font-size": "24px", "font-weight": "600" }}>Project Work · planning and owner controls</h1>
      <p style={{ "margin-top": "8px", color: "var(--muted-foreground)", "font-size": "13px" }}>Component fixture with synthetic capabilities. No live Bamboo API, runtime or provider execution. Desired deadline is separate from ETA.</p></header>
    <div style={{ display: "grid", gap: "16px", "grid-template-columns": "repeat(auto-fit, minmax(min(100%, 430px), 1fr))", "align-items": "start" }}>
      <ProjectWorkPlanningControls work={{ id: "synthetic-work-1", generation: 3, recordRevision: 8, state: "active" }}
        current={current} draft={draft()} query={query()} owner editCapability={{ available: true }} queryCapability={{ available: true }}
        command={context("synthetic-plan-1")} request={planRequest()} copy={copy} onDraftChange={setDraft}
        onQueryChange={(value) => { setQuery(value); note({ kind: "server_query", query: value }) }}
        onSavePlanning={async (value, command) => { note({ kind: "save_planning", value, command }); setPlanRequest({ phase: "requested", operationId: command.operationId }); return { operationId: command.operationId } }}
        onReload={() => note({ kind: "reload_planning" })} onReconcile={(operationId) => note({ kind: "reconcile", operationId })} />
      <ProjectWorkOwnerControls work={{ id: "synthetic-work-1", generation: 3, recordRevision: 8, contractRevision: 5,
        currentSubmissionId: "synthetic-submission-1", state: "active", paused: paused() }} owner
        capabilities={{ pause: { available: true }, resume: { available: false }, cancel: { available: true }, accept: { available: false, reason: "Backend stop guard has not been delivered; User acceptance is unavailable." } }}
        commands={{ pause: context("synthetic-pause-1"), cancel: context("synthetic-cancel-1") }} request={ownerRequest()}
        acceptance={{ submissionId: "synthetic-submission-1", generation: 3, contractRevision: 5, stale: false, stopGuardEnforced: false,
          processStopped: null, evidence: ["Source review is recorded."], unverifiedItems: ["Runtime safe stop has not been confirmed.", "Live backend and automated test results have not been verified by this fixture."] }}
        acceptanceConfirmation={null} acceptedByUser={false} copy={copy} onAcceptanceConfirmationChange={() => {}}
        onRequestAction={async (intent, command) => { note({ intent, command }); setOwnerRequest({ phase: "requested", operationId: command.operationId }); return { operationId: command.operationId } }}
        onReload={() => note({ kind: "reload_owner" })} onReconcile={(operationId) => note({ kind: "reconcile", operationId })} />
    </div>
    <aside aria-label="Fixture controls" style={{ "font-size": "12px", display: "grid", gap: "8px" }}>
      <p>Fixture controls below change props only. They are not product commands.</p>
      <div style={{ display: "flex", "flex-wrap": "wrap", gap: "12px" }}>
        <button type="button" style={{ border: "1px solid var(--border)", padding: "8px", "border-radius": "6px" }} onClick={() => setOwnerRequest({ phase: "acknowledged", operationId: "synthetic-pause-1" })}>Simulate runtime ACK</button>
        <button type="button" style={{ border: "1px solid var(--border)", padding: "8px", "border-radius": "6px" }} onClick={() => setPaused(true)}>Apply authoritative paused prop</button>
        <button type="button" style={{ border: "1px solid var(--border)", padding: "8px", "border-radius": "6px" }} onClick={() => setOwnerRequest({ phase: "conflict", operationId: "synthetic-pause-1" })}>Simulate CAS conflict</button>
      </div>
      <output data-testid="fixture-callback-log" style={{ "overflow-wrap": "anywhere", "white-space": "pre-wrap" }}>{JSON.stringify(log(), null, 2)}</output>
    </aside>
  </main>
}
render(() => <Fixture />, document.getElementById("root")!)
