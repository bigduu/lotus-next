import { createMemo, createSignal, Errored, lazy, Loading, Show } from "solid-js"
import type { RunDiagnosticsSubject } from "@/lib/runDiagnosticId"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle,
} from "../../ui/responsive-dialog"

const loadDialog = () => import("./RunDiagnosticsDialogContent")
const makeDialog = () => lazy(loadDialog, { export: "RunDiagnosticsDialogContent" })

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
export function RunDiagnosticsEntry(props: { subject: RunDiagnosticsSubject }) {
  const text = createUiText()
  const [opened, setOpened] = createSignal<{ subject: RunDiagnosticsSubject; Content: ReturnType<typeof makeDialog> } | null>(null)
  const active = createMemo(() => {
    const value = opened()
    return value?.subject === props.subject ? value : null
  })
  const close = () => setOpened(null)
  return <>
    <Button type="button" size="sm" variant="outline" onClick={() => setOpened({ subject: props.subject, Content: makeDialog() })}>
      {text("run_diagnostics_open")}
    </Button>
    <Show when={active()} keyed>{(entry) => {
      const Content = entry.Content
      const isCurrent = () => active() === entry
      return <Errored fallback={() => <Pending failed onClose={close} />}>
        <Loading fallback={<Pending onClose={close} />}>
          <Content subject={entry.subject} isCurrent={isCurrent} onClose={close} />
        </Loading>
      </Errored>
    }}</Show>
  </>
}
