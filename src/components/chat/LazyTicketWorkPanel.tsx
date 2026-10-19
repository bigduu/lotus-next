import { lazy, Suspense, useState, type ComponentProps } from "react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { ErrorBoundary } from "@/components/app/ErrorBoundary"
import type { TicketWorkPanel } from "./TicketWorkPanel"

type PanelModule = { TicketWorkPanel: typeof TicketWorkPanel }
type PanelLoader = () => Promise<PanelModule>
const loadWork: PanelLoader = () => import("./TicketWorkPanel")
const feature = (load: PanelLoader) => lazy(async () => ({ default: (await load()).TicketWorkPanel }))

/** Scope negotiation stays eager; only ready Work details load on demand. */
export function LazyTicketWorkPanel({ loadPanel = loadWork, ...props }: ComponentProps<typeof TicketWorkPanel> & {
  /** Test seam; production uses the canonical Work module. */
  loadPanel?: PanelLoader
}) {
  useUiLocale()
  const [Panel, setPanel] = useState(() => feature(loadPanel))
  return <ErrorBoundary name="Work" fallback={(_error, reset) => <div role="alert" className="p-4 text-sm">
    <p>{uiText("work_load_failed")}</p>
    <button type="button" className="mt-2 underline" onClick={() => { setPanel(feature(loadPanel)); reset() }}>{uiText("retry_b8784c8d")}</button>
  </div>}>
    <Suspense fallback={<div role="status" aria-live="polite" className="p-4 text-sm text-muted-foreground" data-testid="ticket-work-loading">{uiText("loading_4927a53b")}</div>}>
      <Panel {...props} />
    </Suspense>
  </ErrorBoundary>
}
