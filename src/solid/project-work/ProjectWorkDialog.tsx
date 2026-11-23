import { createEffect, createSignal, Errored, Show } from "solid-js"
import { Dynamic } from "@solidjs/web"

import { createUiText } from "../shell/uiText"
import { Button } from "../ui/button"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../ui/responsive-dialog"
import type { ProjectWorkBoardProps } from "./ProjectWorkBoard"

export type { OpenWorkSession, ProjectWorkBoardControls } from "./ProjectWorkBoard"
export interface ProjectWorkDialogProps extends Omit<ProjectWorkBoardProps, "project"> {
  project: ProjectWorkBoardProps["project"] | null
  onClose: () => void
  metadataError?: string | null
}

/** Keep synchronous modal focus and dismissal even when the board is loading. */
export function ProjectWorkDialog(props: ProjectWorkDialogProps) {
  const text = createUiText()
  let opener: HTMLElement | null = null
  let panel: HTMLDivElement | null = null
  const [loadAttempt, setLoadAttempt] = createSignal(1)
  const [board, setBoard] = createSignal<typeof import("./ProjectWorkBoard").ProjectWorkBoard>()
  const [loadFailed, setLoadFailed] = createSignal(false)

  // Keep the dialog and its focus scope live while the board is downloaded.
  createEffect(() => props.project?.id ? loadAttempt() : 0, (attempt) => {
    if (!attempt || board()) return
    let current = true
    setLoadFailed(false)
    void import("./ProjectWorkBoard").then((loaded) => {
      if (current) setBoard(() => loaded.ProjectWorkBoard)
    }).catch(() => {
      if (current) setLoadFailed(true)
    })
    return () => { current = false }
  })

  const captureOpener = (element: HTMLDivElement) => {
    panel = element
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body && !element.contains(active)) opener = active
  }
  const close = () => {
    const previous = opener
    const closingPanel = panel
    opener = null
    panel = null
    props.onClose()
    requestAnimationFrame(() => {
      if (previous?.isConnected && (document.activeElement === document.body
        || closingPanel?.contains(document.activeElement))) previous.focus({ preventScroll: true })
    })
  }
  const loadError = () => (
    <div role="alert" class="p-4 text-sm">
      <p>{text("work_load_failed")}</p>
      <Button class="mt-2" variant="outline" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{text("retry_b8784c8d")}</Button>
    </div>
  )

  return (
    <ResponsiveDialog open={Boolean(props.project)} onOpenChange={(open) => { if (!open) close() }}>
      <ResponsiveDialogContent ref={captureOpener} style={{ "max-width": "64rem" }}
        onOpenAutoFocus={(event: Event) => {
          if (!panel) return
          event.preventDefault()
          panel.focus({ preventScroll: true })
        }}>
        <div class="border-b p-4 pr-12">
          <ResponsiveDialogTitle>{text("project_work_title")}{props.project ? ` · ${props.project.name}` : ""}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription class="sr-only">{text("project_work_readonly")}</ResponsiveDialogDescription>
        </div>
        <Show when={props.metadataError}><p role="alert" class="px-4 pt-3 text-sm text-destructive">{props.metadataError}</p></Show>
        <Show when={board()} fallback={(
          <Show when={loadFailed()} fallback={(
            <p role="status" aria-live="polite" class="p-4 text-sm text-muted-foreground" data-testid="project-work-loading">{text("project_work_loading")}</p>
          )}>{loadError()}</Show>
        )}>{(Board) => (
          <Show when={loadAttempt()} keyed>{(_attempt) => (
            <Errored fallback={loadError}>
              <Dynamic component={Board()} project={props.project!} ownerAccess={props.ownerAccess}
                controls={props.controls} onOpenSession={props.onOpenSession} />
            </Errored>
          )}</Show>
        )}</Show>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
