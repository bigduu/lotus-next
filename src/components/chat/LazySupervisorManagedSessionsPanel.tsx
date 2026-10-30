import { lazy, Suspense, useState, type ComponentProps } from "react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { ErrorBoundary } from "@/components/app/ErrorBoundary"
import type { SupervisorManagedSessionsPanel } from "./SupervisorManagedSessions"

type PanelModule = { SupervisorManagedSessionsPanel: typeof SupervisorManagedSessionsPanel }
type PanelLoader = () => Promise<PanelModule>
const loadSessions: PanelLoader = () => import("./SupervisorManagedSessions")
const feature = (load: PanelLoader) => lazy(async () => ({ default: (await load()).SupervisorManagedSessionsPanel }))

/** Ordinary chats do not load the Supervisor directory until it is opened. */
export function LazySupervisorManagedSessionsPanel({ loadPanel = loadSessions, ...props }: ComponentProps<typeof SupervisorManagedSessionsPanel> & {
  loadPanel?: PanelLoader
}) {
  useUiLocale()
  const [Panel, setPanel] = useState(() => feature(loadPanel))
  return <ErrorBoundary name="Supervisor sessions" fallback={(_error, reset) => <div role="alert" className="text-sm">
    <p>{uiText("supervisor_sessions_unavailable")}</p>
    <button type="button" className="mt-2 underline" onClick={() => { setPanel(feature(loadPanel)); reset() }}>{uiText("retry_b8784c8d")}</button>
  </div>}>
    <Suspense fallback={<p role="status" className="text-xs text-muted-foreground">{uiText("supervisor_sessions_loading")}</p>}>
      <Panel {...props} />
    </Suspense>
  </ErrorBoundary>
}
