import { lazy, Suspense } from "react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { ErrorBoundary } from "@/components/app/ErrorBoundary"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog"

const Content = lazy(() => import("./LocalTracesContent").then((module) => ({ default: module.LocalTracesContent })))

export function LocalTracesDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  useUiLocale()
  return <ResponsiveDialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <ResponsiveDialogContent style={{ maxWidth: "64rem" }}>
      <div className="shrink-0 border-b px-5 py-4 pr-12">
        <ResponsiveDialogTitle>{uiText("local_trace_title")}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="mt-2">{uiText("local_trace_session_scope")}</ResponsiveDialogDescription>
      </div>
      <ErrorBoundary key={sessionId} name="LocalTraces" fallback={<p role="alert" className="px-5 py-4 text-sm text-destructive">{uiText("local_trace_error")}</p>}>
        <Suspense fallback={<p role="status" className="px-5 py-4 text-sm text-muted-foreground">{uiText("local_trace_loading")}</p>}>
          <Content sessionId={sessionId} />
        </Suspense>
      </ErrorBoundary>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}
