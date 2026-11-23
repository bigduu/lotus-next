import { createSignal } from "solid-js"
import { render } from "@solidjs/web"
import "../../src/solid/styles.css"
import { changeLocale } from "../../src/shared/i18n/runtime"
import { createRuntimeConfig, installRuntimeConfig } from "../../src/runtime/runtimeConfig"
import type { ProjectManifest } from "../../src/services/project"
import type { WorkCommandContext, WorkPlanningDraft, WorkRequestStatus } from "../../src/components/app/project-work/projectWorkControls"

const parameters = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", parameters.get("theme") === "dark")
installRuntimeConfig(createRuntimeConfig({ host: { kind: "browser", capabilities: { nativeFileSystem: false, nativeNotifications: false, externalShell: false, sidecarBackend: false } }, endpointSource: "page-origin", backendBaseUrl: location.origin, mode: "test", development: false }))
const { ProjectWorkBoard } = await import("../../src/solid/project-work/ProjectWorkBoard")
await changeLocale("zh-CN")
const project = { id: parameters.get("project") ?? "synthetic-project", name: "Controlled host fixture", revision: 1, resource_revision: 1, workspace_bindings: [] } as unknown as ProjectManifest
const command = (operationId: string): WorkCommandContext => ({ operationId, workId: "synthetic-work-1", generation: 3, recordRevision: 8,
  binding: { scope_id: "synthetic-scope", supervisor_session_id: "synthetic-owner", binding_revision: 2 }, expectedSeq: 19, expectedEpoch: 4 })
export function Fixture() {
  const [draft, setDraft] = createSignal<WorkPlanningDraft>({ priority: "high", expectedCompletionAt: "2026-10-19T09:15:00-07:00" })
  const [request, setRequest] = createSignal<WorkRequestStatus>({ phase: "idle" })
  const [log, setLog] = createSignal<unknown[]>([])
  return <main style={{ "max-width": "1100px", margin: "0 auto", padding: "12px" }}>
    <header style={{ padding: "16px" }}><h1 style={{ "font-size": "20px", "font-weight": "600" }}>Controlled Project Work board host</h1>
      <p style={{ "margin-top": "8px", "font-size": "13px" }}>Mock HTTP + synthetic controlled callbacks. No Bamboo mutation, runtime or provider execution.</p></header>
    <ProjectWorkBoard project={project} ownerAccess onOpenSession={async (sessionId, verifyAccess) => { if (!await verifyAccess()) return false; setLog((items) => [...items, { kind: "open_session", sessionId }]); return true }} controls={{
      planning: { work: { id: "synthetic-work-1", generation: 3, recordRevision: 8, state: "active" },
        current: { priority: "medium", expectedCompletionAt: "2026-10-18T00:00:00+08:00" }, draft: draft(),
        query: { order: "updated", priority: null, deadline: "any", asOf: "2026-10-17T17:00:00Z" },
        owner: true, editCapability: { available: true }, queryCapability: { available: false }, command: command("synthetic-plan-1"),
        request: request(), onDraftChange: setDraft, onQueryChange: () => {}, onReload: () => {},
        onSavePlanning: async (value, context) => { setLog((items) => [...items, { value, context }]); setRequest({ phase: "requested", operationId: context.operationId }); return { operationId: context.operationId } } },
      owner: { work: { id: "synthetic-work-1", generation: 3, recordRevision: 8, contractRevision: 5,
        currentSubmissionId: null, state: "active", paused: false }, owner: true,
        capabilities: { pause: { available: false }, resume: { available: false }, cancel: { available: false }, accept: { available: false } },
        commands: {}, request: { phase: "awaiting_ack", operationId: "synthetic-pause-1" }, acceptance: null,
        acceptanceConfirmation: null, acceptedByUser: false, onAcceptanceConfirmationChange: () => {},
        onRequestAction: async (_intent, context) => ({ operationId: context.operationId }), onReload: () => {} },
    }} />
    <details style={{ padding: "16px" }}><summary>Synthetic callback receipt</summary><output data-testid="host-callback-log" style={{ "overflow-wrap": "anywhere" }}>{JSON.stringify(log())}</output></details>
  </main>
}
render(() => <Fixture />, document.getElementById("root")!)
