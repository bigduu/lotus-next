import { createSignal, Errored, lazy, Loading, omit, Show } from "solid-js"
import type { ComponentProps } from "@solidjs/web"
import { createUiText } from "../../shell/uiText"
import type { SupervisorManagedSessionsPanel } from "./SupervisorManagedSessions"

type PanelModule = { SupervisorManagedSessionsPanel: typeof SupervisorManagedSessionsPanel }
const loadOriginal = () => import("./SupervisorManagedSessions")
// A failed browser module URL stays cached for this document.
const loadAlternate = () => import("./SupervisorManagedSessions.tsx?supervisor-sessions-retry")
let loadSessions: () => Promise<PanelModule> = loadOriginal

export function LazySupervisorManagedSessionsPanel(props: ComponentProps<typeof SupervisorManagedSessionsPanel> & {
  loadPanel?: () => Promise<PanelModule>
}) {
  const text = createUiText()
  const [attempt, setAttempt] = createSignal(1)
  const retry = () => {
    if (!props.loadPanel) loadSessions = loadAlternate
    setAttempt((value) => value + 1)
  }
  return <Show when={attempt()} keyed>{(_attempt) => {
    const Panel = lazy(props.loadPanel ?? loadSessions, { export: "SupervisorManagedSessionsPanel" })
    return <Errored fallback={() => <div role="alert" class="text-sm">
      <p>{text("supervisor_sessions_render_failed")}</p>
      <button type="button" class="mt-2 underline" onClick={retry}>{text("retry_b8784c8d")}</button>
    </div>}><Loading fallback={<p role="status" class="text-xs text-muted-foreground">{text("supervisor_sessions_loading")}</p>}>
      <Panel {...omit(props, "loadPanel")} />
    </Loading></Errored>
  }}</Show>
}
