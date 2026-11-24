import { createSignal, Errored, lazy, Loading, omit, Show } from "solid-js"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import type { BrowserPaneView, BrowserPaneViewProps } from "./BrowserPane"

type PaneModule = { BrowserPaneView: typeof BrowserPaneView }
const loadOriginalPane = () => import("./BrowserPane")
// A rejected browser module fetch is cached by its URL for the life of the document.
const loadRetryPane = () => import("./BrowserPane.tsx?browser-retry")
let loadPane: () => Promise<PaneModule> = loadOriginalPane

export function LazyBrowserPaneView(props: BrowserPaneViewProps & { loadView?: () => Promise<PaneModule> }) {
  const text = createUiText()
  const [attempt, setAttempt] = createSignal(1)
  const retry = () => {
    if (!props.loadView) loadPane = loadRetryPane
    setAttempt((current) => current + 1)
  }
  return (
    <Show when={attempt()} keyed>{(_attempt) => {
      const Pane = lazy(props.loadView ?? loadPane, { export: "BrowserPaneView" })
      return (
        <Errored fallback={() => <div role="alert" class="space-y-3 p-3 text-sm">
          <p>{text("browser_view_load_failed")}</p>
          <Button variant="outline" onClick={retry}>
            {text("retry_b8784c8d")}
          </Button>
        </div>}>
          <Loading fallback={<p role="status" class="p-3 text-sm">{text("loading_4927a53b")}</p>}>
            <Pane {...omit(props, "loadView")} />
          </Loading>
        </Errored>
      )
    }}</Show>
  )
}
