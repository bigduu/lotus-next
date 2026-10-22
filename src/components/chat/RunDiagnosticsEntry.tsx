import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps } from "react"
import { useUiText } from "@shared/i18n/ui"
import { ErrorBoundary } from "@/components/app/ErrorBoundary"
import { Button } from "@/components/ui/button"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog"
import type { RunDiagnosticsSubject } from "@/lib/runDiagnosticId"
import type { RunDiagnosticsDialogContent } from "./RunDiagnosticsDialogContent"

type Module = { RunDiagnosticsDialogContent: typeof RunDiagnosticsDialogContent }
type OpenedDiagnostics = Readonly<{ subject: RunDiagnosticsSubject }>
const load = () => import("./RunDiagnosticsDialogContent")

function Pending({ onClose, failed = false }: { onClose: () => void; failed?: boolean }) {
  const t = useUiText()
  return <ResponsiveDialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <ResponsiveDialogContent className="gap-3 p-4 sm:pb-4">
      <ResponsiveDialogTitle>{t("run_diagnostics_title")}</ResponsiveDialogTitle>
      <ResponsiveDialogDescription>{t(failed ? "run_diagnostics_load_failed" : "loading_4927a53b")}</ResponsiveDialogDescription>
      <Button size="sm" variant="secondary" onClick={onClose}>{t("cancel_2cd0f3be")}</Button>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}

/** Optional read-only diagnostics; a new session/failure invalidates even a pending lazy load. */
export function RunDiagnosticsEntry({ subject, loadDialog = load }: {
  subject: RunDiagnosticsSubject
  loadDialog?: () => Promise<Module>
}) {
  const t = useUiText()
  const current = useRef(subject), mounted = useRef(true)
  const active = useRef<OpenedDiagnostics | null>(null)
  current.current = subject
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current = null } }, [])
  const createContent = () => lazy(async () => ({ default: (await loadDialog()).RunDiagnosticsDialogContent }))
  const [Content, setContent] = useState(createContent)
  const [opened, setOpened] = useState<OpenedDiagnostics | null>(null)
  const close = () => { active.current = null; setOpened(null) }
  const open = () => {
    const next = { subject }
    active.current = next
    setContent(createContent)
    setOpened(next)
  }
  const isCurrent = () => mounted.current && opened !== null && active.current === opened && current.current === opened.subject
  return <>
    <Button size="sm" variant="outline" onClick={open}>{t("run_diagnostics_open")}</Button>
    {opened && opened.subject === subject ? <ErrorBoundary name="Run diagnostics" fallback={() => <Pending failed onClose={close} />}>
      <Suspense fallback={<Pending onClose={close} />}>
        <Content subject={opened.subject} isCurrent={isCurrent} onClose={close} />
      </Suspense>
    </ErrorBoundary> : null}
  </>
}

export type RunDiagnosticsContentProps = ComponentProps<typeof RunDiagnosticsDialogContent>
