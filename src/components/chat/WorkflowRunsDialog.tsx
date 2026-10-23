import { lazy, Suspense, useState, type ComponentType } from "react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { ErrorBoundary } from "@/components/app/ErrorBoundary"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog"

export type WorkflowRunsContentLoader = () => Promise<{ default: ComponentType<{ sessionId: string }> }>
const loadWorkflowRunsContent: WorkflowRunsContentLoader = () => import("./WorkflowRunsContent")

/** The synchronous dialog owns focus and dismissal while its session content loads. */
export function WorkflowRunsDialog({ sessionId, sessionTitle, onClose, loadContent = loadWorkflowRunsContent }: {
  sessionId: string; sessionTitle: string; onClose: () => void
  /** Test seam; production uses the canonical content module. */
  loadContent?: WorkflowRunsContentLoader
}) {
  useUiLocale()
  const [RunSession] = useState(() => lazy(loadContent))
  return <ResponsiveDialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <ResponsiveDialogContent className="sm:max-w-2xl">
      <div className="shrink-0 border-b px-5 py-4 pr-12">
        <ResponsiveDialogTitle>{uiText("workflow_run_title")}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="mt-2 break-words">{sessionTitle}</ResponsiveDialogDescription>
      </div>
      <ErrorBoundary key={sessionId} name="WorkflowRuns" fallback={
        <p role="alert" className="px-5 py-4 text-sm text-destructive">
          {uiText("this_section_could_not_render_try_again_or_reload_the_p_e644d5da")}
        </p>
      }>
        <Suspense fallback={<p role="status" aria-live="polite" className="px-5 py-4 text-sm text-muted-foreground">
          {uiText("workflow_run_loading")}
        </p>}>
          <RunSession sessionId={sessionId} />
        </Suspense>
      </ErrorBoundary>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}
