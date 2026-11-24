import { createEffect, createMemo, createSignal, Errored, Show, untrack } from "solid-js"
import { Dynamic } from "@solidjs/web"

import { createUiText } from "../shell/uiText"
import { Button } from "../ui/button"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../ui/responsive-dialog"
import type { ProjectWorkBoard, ProjectWorkBoardProps } from "./ProjectWorkBoard"

type BoardLoader = () => Promise<{ ProjectWorkBoard: typeof ProjectWorkBoard }>
const loadOriginal: BoardLoader = () => import("./ProjectWorkBoard")
// An explicit retry uses a different URL because browsers keep rejected module loads.
const loadRetry: BoardLoader = () => import("./ProjectWorkBoard.tsx?project-work-retry")

export type { OpenWorkSession, ProjectWorkBoardControls } from "./ProjectWorkBoard"
export interface ProjectWorkDialogProps extends Omit<ProjectWorkBoardProps, "project"> {
  project: ProjectWorkBoardProps["project"] | null
  onClose: () => void
  metadataError?: string | null
  loadBoard?: BoardLoader
}

/** Keep synchronous modal focus and dismissal even when the board is loading. */
export function ProjectWorkDialog(props: ProjectWorkDialogProps) {
  const text = createUiText()
  let opener: HTMLElement | null = null
  let panel: HTMLDivElement | null = null
  const [loadAttempt, setLoadAttempt] = createSignal(1)
  const [board, setBoard] = createSignal<typeof ProjectWorkBoard>()
  const [loadFailed, setLoadFailed] = createSignal(false)
  const requestedLoad = createMemo(() => props.project?.id && !board() ? loadAttempt() : 0)

  // Keep the dialog and its focus scope live while the board is downloaded.
  createEffect(requestedLoad, (attempt) => {
    if (!attempt) return
    let current = true
    setLoadFailed(false)
    const load = untrack(() => props.loadBoard) ?? (attempt === 1 ? loadOriginal : loadRetry)
    void load().then((loaded) => {
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
          <Show when={props.project?.id} keyed>{(_projectId) => (
            <Show when={loadAttempt()} keyed>{(_attempt) => (
              <Errored fallback={loadError}>
                <Dynamic component={Board()} project={props.project!} ownerAccess={props.ownerAccess}
                  controls={props.controls} onOpenSession={props.onOpenSession} />
              </Errored>
            )}</Show>
          )}</Show>
        )}</Show>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
