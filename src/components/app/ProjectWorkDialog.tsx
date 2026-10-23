import { lazy, Suspense, useState, type ComponentProps } from "react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { Button } from "@/components/ui/button"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog"
import { ErrorBoundary } from "./ErrorBoundary"
import type { ProjectWorkBoard } from "./ProjectWorkBoard"

type BoardProps = ComponentProps<typeof ProjectWorkBoard>
type BoardModule = { ProjectWorkBoard: typeof ProjectWorkBoard }
type BoardLoader = () => Promise<BoardModule>
const loadWork: BoardLoader = () => import("./ProjectWorkBoard")
const feature = (load: BoardLoader) => lazy(async () => ({ default: (await load()).ProjectWorkBoard }))

/** Keep modal focus/close available while optional Project Work code loads. */
export function ProjectWorkDialog({ project, onClose, metadataError, controls, loadBoard = loadWork }: {
  project: BoardProps["project"] | null
  onClose: () => void
  metadataError?: string | null
  controls?: BoardProps["controls"]
  /** Test seam; production uses the canonical Project Work module. */
  loadBoard?: BoardLoader
}) {
  useUiLocale()
  const [Board, setBoard] = useState(() => feature(loadBoard))
  return <ResponsiveDialog open={!!project} onOpenChange={(open) => { if (!open) onClose() }}><ResponsiveDialogContent style={{ maxWidth: "64rem" }} aria-describedby={undefined}>
    <div className="border-b p-4 pr-12"><ResponsiveDialogTitle>{uiText("project_work_title")}{project ? ` · ${project.name}` : ""}</ResponsiveDialogTitle><ResponsiveDialogDescription className="sr-only">{uiText("project_work_readonly")}</ResponsiveDialogDescription></div>
    {metadataError ? <p role="alert" className="px-4 pt-3 text-sm text-destructive">{metadataError}</p> : null}
    {project ? <ErrorBoundary key={project.id} name="ProjectWorkBoard" fallback={(_error, reset) => <div role="alert" className="p-4 text-sm">
      <p>{uiText("work_load_failed")}</p>
      <Button className="mt-2" variant="outline" onClick={() => { setBoard(feature(loadBoard)); reset() }}>{uiText("retry_b8784c8d")}</Button>
    </div>}>
      <Suspense fallback={<p role="status" aria-live="polite" className="p-4 text-sm text-muted-foreground" data-testid="project-work-loading">{uiText("project_work_loading")}</p>}>
        <Board key={project.id} project={project} controls={controls} />
      </Suspense>
    </ErrorBoundary> : null}
  </ResponsiveDialogContent></ResponsiveDialog>
}
