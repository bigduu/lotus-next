import { createMemo, createSignal, Errored, lazy, Loading, onCleanup, Show } from "solid-js"
import type { RunDiagnosticsSubject } from "@/lib/runDiagnosticId"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle,
} from "../../ui/responsive-dialog"
import type { RunDiagnosticsDialogContent } from "./RunDiagnosticsDialogContent"

type DialogModule = { RunDiagnosticsDialogContent: typeof RunDiagnosticsDialogContent }
type LoadDialog = () => Promise<DialogModule>
const loadOriginal = () => import("./RunDiagnosticsDialogContent")
const loadAlternate = () => import("./RunDiagnosticsDialogContent.tsx?diagnostics-retry")
let loadDialog: LoadDialog = loadOriginal
const makeDialog = (load: LoadDialog) => lazy(load, { export: "RunDiagnosticsDialogContent" })

function Pending(props: { failed?: boolean; onClose: () => void }) {
  const text = createUiText()
  return <ResponsiveDialog open onOpenChange={(open) => { if (!open) props.onClose() }}>
    <ResponsiveDialogContent class="gap-3 p-4 sm:pb-4">
      <ResponsiveDialogTitle>{text("run_diagnostics_title")}</ResponsiveDialogTitle>
      <ResponsiveDialogDescription>{text(props.failed ? "run_diagnostics_load_failed" : "loading_4927a53b")}</ResponsiveDialogDescription>
      <Button type="button" size="sm" variant="secondary" onClick={props.onClose}>{text("cancel_2cd0f3be")}</Button>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}

/** Opening the optional diagnostic does not read a session until the user asks. */
export function RunDiagnosticsEntry(props: { subject: RunDiagnosticsSubject; loadDialog?: LoadDialog }) {
  const text = createUiText()
  const visit = createMemo(() => ({ subject: props.subject }))
  const [opened, setOpened] = createSignal<{ visit: ReturnType<typeof visit>; Content: ReturnType<typeof makeDialog> } | null>(null)
  let mounted = true
  onCleanup(() => { mounted = false })
  const active = createMemo(() => {
    const value = opened()
    return value?.visit === visit() ? value : null
  })
  const close = () => setOpened(null)
  const closeFailure = () => {
    // A failed import URL is cached by the browser for this document.
    if (!props.loadDialog) loadDialog = loadAlternate
    close()
  }
  return <>
    <Button type="button" size="sm" variant="outline" onClick={() => setOpened({ visit: visit(), Content: makeDialog(props.loadDialog ?? loadDialog) })}>
      {text("run_diagnostics_open")}
    </Button>
    <Show when={active()} keyed>{(entry) => {
      const Content = entry.Content
      const isCurrent = () => mounted && active() === entry
      return <Errored fallback={() => <Pending failed onClose={closeFailure} />}>
        <Loading fallback={<Pending onClose={close} />}>
          <Content subject={entry.visit.subject} isCurrent={isCurrent} onClose={close} />
        </Loading>
      </Errored>
    }}</Show>
  </>
}
