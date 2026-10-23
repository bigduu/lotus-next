import { lazy, Suspense, useState, type ComponentProps } from "react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { Button } from "@/components/ui/button"
import { ErrorBoundary } from "./ErrorBoundary"
import type { BrowserPaneView } from "./BrowserPane"

type Module = { BrowserPaneView: typeof BrowserPaneView }
type Props = ComponentProps<typeof BrowserPaneView>
const load = () => import("./BrowserPane")
const view = (loader: () => Promise<Module>) => lazy(async () => ({ default: (await loader()).BrowserPaneView }))

/** Defer optional view code while App retains the canonical browser state owner. */
export function LazyBrowserPaneView({ loadView = load, ...props }: Props & {
  /** Synthetic loader seam; production imports the canonical view. */
  loadView?: () => Promise<Module>
}) {
  useUiLocale()
  const [View, setView] = useState(() => view(loadView))
  const [attempt, setAttempt] = useState(0)
  return <ErrorBoundary key={attempt} name="Browser view" fallback={() => <div role="alert" className="space-y-3 p-3 text-sm">
    <p>{uiText("browser_view_load_failed")}</p>
    <Button variant="outline" onClick={() => {
      setView(() => view(loadView))
      setAttempt((value) => value + 1)
    }}>{uiText("retry_b8784c8d")}</Button>
  </div>}>
    <Suspense fallback={<p role="status" className="p-3 text-sm">{uiText("loading_4927a53b")}</p>}><View {...props} /></Suspense>
  </ErrorBoundary>
}
