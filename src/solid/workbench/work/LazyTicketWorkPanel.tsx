import { createSignal, Errored, lazy, Loading, omit, Show } from "solid-js"
import type { ComponentProps } from "@solidjs/web"
import { createUiText } from "../../shell/uiText"
import type { TicketWorkPanel } from "./TicketWorkPanel"

type Module = { TicketWorkPanel: typeof TicketWorkPanel }
const loadOriginal = () => import("./TicketWorkPanel")
// Browsers retain a rejected module load by URL until the document is unloaded.
const loadRetry = () => import("./TicketWorkPanel.tsx?work-retry")
let loadWork: () => Promise<Module> = loadOriginal

export function LazyTicketWorkPanel(props: ComponentProps<typeof TicketWorkPanel> & {
  loadPanel?: () => Promise<Module>
}) {
  const text = createUiText()
  const [attempt, setAttempt] = createSignal(1)
  const retry = () => {
    if (!props.loadPanel) loadWork = loadRetry
    setAttempt((current) => current + 1)
  }
  return (
    <Show when={attempt()} keyed>{(_attempt) => {
      const Panel = lazy(props.loadPanel ?? loadWork, { export: "TicketWorkPanel" })
      return (
        <Errored fallback={() => <div role="alert" class="p-4 text-sm">
          <p>{text("work_load_failed")}</p>
          <button type="button" class="mt-2 underline" onClick={retry}>{text("retry_b8784c8d")}</button>
        </div>}>
          <Loading fallback={<div role="status" aria-live="polite" class="p-4 text-sm text-muted-foreground"
            data-testid="ticket-work-loading">{text("loading_4927a53b")}</div>}>
            <Panel {...omit(props, "loadPanel")} />
          </Loading>
        </Errored>
      )
    }}</Show>
  )
}
