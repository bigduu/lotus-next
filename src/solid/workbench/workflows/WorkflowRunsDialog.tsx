import { Errored, lazy, Loading, onCleanup, Show } from "solid-js"

import { createUiText } from "../../shell/uiText"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../../ui/responsive-dialog"
import type { WorkflowRunsContentProps } from "./WorkflowRunsContent"

export type WorkflowRunsContentLoader = () => Promise<typeof import("./WorkflowRunsContent")>

export interface WorkflowRunsDialogProps extends WorkflowRunsContentProps {
  sessionTitle: string
  onClose: () => void
  loadContent?: WorkflowRunsContentLoader
}

const WorkflowRunsContent = lazy(() => import("./WorkflowRunsContent"))

export function WorkflowRunsDialog(props: WorkflowRunsDialogProps) {
  const text = createUiText()
  const RunSession = props.loadContent ? lazy(props.loadContent) : WorkflowRunsContent
  const opener = document.activeElement
  let panel: HTMLDivElement | undefined
  onCleanup(() => {
    if (!(opener instanceof HTMLElement) || opener === document.body) return
    requestAnimationFrame(() => {
      if (document.activeElement === document.body && opener.isConnected) opener.focus({ preventScroll: true })
    })
  })
  return (
    <ResponsiveDialog open onOpenChange={(open) => { if (!open) props.onClose() }}>
      <ResponsiveDialogContent ref={(element: HTMLDivElement) => { panel = element }}
        tabIndex={-1} class="sm:max-w-2xl"
        onOpenAutoFocus={(event: Event) => {
          event.preventDefault()
          const target = panel?.querySelector<HTMLElement>('[data-slot="responsive-dialog-close"]') ?? panel
          target?.focus({ preventScroll: true })
        }}>
        <div class="shrink-0 border-b px-5 py-4 pr-12">
          <ResponsiveDialogTitle>{text("workflow_run_title")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription class="mt-2 break-words">{props.sessionTitle}</ResponsiveDialogDescription>
        </div>
        <Show when={props.sessionId} keyed>{(sessionId) => (
          <Errored fallback={
            <p role="alert" class="px-5 py-4 text-sm text-destructive">
              {text("this_section_could_not_render_try_again_or_reload_the_p_e644d5da")}
            </p>
          }>
            <Loading fallback={
              <p role="status" aria-live="polite" class="px-5 py-4 text-sm text-muted-foreground">{text("workflow_run_loading")}</p>
            }>
              <RunSession sessionId={sessionId} projectId={props.projectId} projectName={props.projectName} />
            </Loading>
          </Errored>
        )}</Show>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
