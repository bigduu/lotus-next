import { useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { useUiText } from "@shared/i18n/ui"
import { useSupervisorManagedSessions, type ManagedSessionsDependencies } from "@/hooks/useSupervisorManagedSessions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SupervisorProjectScopeDialog } from "./SupervisorProjectScopeDialog"

type Controller = ReturnType<typeof useSupervisorManagedSessions>
type Row = Controller["rows"][number]
const statusKeys = { current_user: "supervisor_sessions_current_user_status", authorized: "supervisor_sessions_authorized", reconfirm: "supervisor_sessions_reconfirm", detached: "supervisor_sessions_detached", available: "supervisor_sessions_available", unavailable: "supervisor_sessions_unverified" } as const
const problemKeys = { unsupported: "supervisor_sessions_unsupported", missing: "supervisor_sessions_missing", authentication: "supervisor_scope_access_required", forbidden: "supervisor_scope_forbidden",
  conflict: "supervisor_sessions_conflict", unavailable: "supervisor_sessions_unavailable", invalid: "supervisor_sessions_invalid", error: "supervisor_sessions_unavailable" } as const
const noticeKeys = { saved: "supervisor_sessions_saved", unknown: "supervisor_sessions_unknown", conflict: "supervisor_sessions_conflict", rejected: "supervisor_sessions_rejected" } as const

function StateMessages({ controller }: { controller: Controller }) {
  const t = useUiText()
  return <>
    {controller.loading || !controller.observation && !controller.problem ? <p role="status" className="text-xs text-muted-foreground">{t("supervisor_sessions_loading")}</p> : null}
    {controller.problem ? <p role="alert" className="text-xs text-destructive">{t(problemKeys[controller.problem.kind])}</p> : null}
    {controller.notice ? <p role={controller.notice === "saved" ? "status" : "alert"} className="text-xs text-muted-foreground">{t(noticeKeys[controller.notice])}</p> : null}
    {controller.catalogError ? <p role="alert" className="text-xs text-muted-foreground">{t("supervisor_sessions_catalog_failed")}</p> : null}
    {controller.observation && !controller.observation.owner_authorization.available ? <p role="status" className="text-xs text-muted-foreground">{t("supervisor_scope_access_required")}</p> : null}
  </>
}
function SessionLabel({ row }: { row: Row }) {
  const t = useUiText()
  const progress = row.summary?.is_running ? t("supervisor_sessions_running") : row.summary?.last_run_status
  return <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
    <p className="text-sm font-medium">{row.summary?.title || row.session_id}</p>
    <p className="text-xs text-muted-foreground">{t(statusKeys[row.status])}{row.link?.kind ? ` · ${row.link.kind === "root" ? "Root" : "Child"}` : ""}{progress ? ` · ${t("supervisor_sessions_progress", { progress })}` : ""}</p>
    {row.summary?.model ? <p className="text-xs text-muted-foreground">{t("supervisor_sessions_model", { model: row.summary.model })}</p> : null}
  </div>
}
export function SupervisorManagedSessionsDialog({ open, onOpenChange, returnFocus, dependencies }: {
  open: boolean; onOpenChange: (open: boolean) => void; returnFocus?: () => void; dependencies?: ManagedSessionsDependencies
}) {
  const t = useUiText(), controller = useSupervisorManagedSessions(open, dependencies)
  const [scopeOpen, setScopeOpen] = useState(false)
  const scopeTrigger = useRef<HTMLButtonElement>(null)
  const reviewed = controller.rows.find((row) => row.session_id === controller.review?.target_session_id)
  return <>
    <Dialog open={open} onOpenChange={(next) => { if (!controller.submitting && !scopeOpen) onOpenChange(next) }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto" showCloseButton={!controller.submitting}
        onEscapeKeyDown={(event) => { if (controller.submitting || scopeOpen) event.preventDefault() }}
        onInteractOutside={(event) => { if (controller.submitting || scopeOpen) event.preventDefault() }}
        onCloseAutoFocus={returnFocus ? (event) => { event.preventDefault(); returnFocus() } : undefined}>
        <DialogHeader><DialogTitle>{t("supervisor_sessions_title")}</DialogTitle><DialogDescription>{t(controller.currentUser ? "supervisor_sessions_current_user_description" : "supervisor_sessions_description")}</DialogDescription></DialogHeader>
        <div className="space-y-3" data-testid="supervisor-managed-sessions">
          <StateMessages controller={controller} />
          <Button ref={scopeTrigger} variant="outline" size="sm" disabled={controller.submitting} onClick={() => { controller.cancelReview(); setScopeOpen(true) }}>{t(controller.currentUser ? "supervisor_scope_current_user_title" : "supervisor_scope_title")}</Button>
          {controller.currentUser ? <p className="text-xs text-muted-foreground">{t("supervisor_sessions_legacy_links", { count: Object.keys(controller.observation?.legacy_links ?? {}).length })}</p>
            : controller.observation?.scope.allowed_projects.length === 0 ? <p className="text-xs text-muted-foreground">{t("supervisor_sessions_no_scope")}</p> : null}
          {controller.review ? <section className="space-y-3 rounded-lg border p-3" data-testid="managed-session-review">
            <p className="text-sm">{t(controller.review.enabled ? "supervisor_sessions_review_attach" : "supervisor_sessions_review_detach", { title: reviewed?.summary?.title || controller.review.target_session_id })}</p>
            <p className="text-xs text-muted-foreground">{t("supervisor_sessions_context_preserved")}</p>
            <div className="flex gap-2"><Button variant="outline" disabled={controller.submitting} onClick={controller.cancelReview}>{t("cancel_2cd0f3be")}</Button>
              <Button disabled={!controller.canManage} onClick={() => void controller.confirm()}>{t(controller.submitting ? "supervisor_sessions_saving" : "supervisor_sessions_confirm")}</Button></div>
          </section> : <>
            {controller.observation && !controller.loading && !controller.rows.length ? <p className="text-sm text-muted-foreground">{t(controller.currentUser ? "supervisor_sessions_current_user_empty" : "supervisor_sessions_empty")}</p> : null}
            <ul className="space-y-2">
              {controller.rows.map((row) => <li key={row.session_id} data-managed-session={row.session_id} className="flex items-center gap-3 rounded-lg border p-3">
                <SessionLabel row={row} />
                {!controller.currentUser ? <div className="flex shrink-0 flex-col gap-1">
                  {!row.link?.authorized ? <Button size="sm" variant="outline" disabled={!controller.canManage || !row.canEnable || controller.catalogError}
                    onClick={() => controller.reviewTarget(row.session_id, true)}>{t(row.status === "reconfirm" ? "supervisor_sessions_reconfirm_action" : "supervisor_sessions_attach")}</Button> : null}
                  {row.link?.enabled ? <Button size="sm" variant="ghost" disabled={!controller.canManage} onClick={() => controller.reviewTarget(row.session_id, false)}>{t("supervisor_sessions_detach")}</Button> : null}
                </div> : null}
              </li>)}
            </ul>
            {controller.nextOffset !== null || controller.nextAfter !== null ? <Button size="sm" variant="outline" disabled={controller.loadingMore || controller.loading || controller.submitting} onClick={() => void controller.loadMore()}>{t("supervisor_sessions_more")}</Button> : null}
          </>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={controller.loading || controller.submitting} onClick={() => void controller.refresh()}>{t("supervisor_scope_refresh")}</Button>
          <Button variant="outline" disabled={controller.submitting} onClick={() => onOpenChange(false)}>{t("supervisor_scope_close")}</Button>
        </DialogFooter>
      </DialogContent>
      {scopeOpen ? <SupervisorProjectScopeDialog open onOpenChange={(next) => { setScopeOpen(next); if (!next) void controller.refresh() }} returnFocus={() => scopeTrigger.current?.focus()} /> : null}
    </Dialog>
  </>
}
export function SupervisorManagedSessionsPanel({ active, onSelectSession, dependencies }: {
  active: boolean; onSelectSession: (id: string) => void | Promise<boolean>; dependencies?: ManagedSessionsDependencies
}) {
  const t = useUiText(), controller = useSupervisorManagedSessions(active, dependencies)
  const [managing, setManaging] = useState(false)
  const [opening, setOpening] = useState<string | null>(null), [openFailed, setOpenFailed] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const rows = controller.rows.filter((row) => !!row.link)
  const openSession = async (id: string) => {
    if (opening) return
    setOpening(id); setOpenFailed(false)
    try { if (await onSelectSession(id) === false) setOpenFailed(true) }
    catch { setOpenFailed(true) }
    finally { setOpening(null) }
  }
  return <section className="rounded-lg border p-3" data-testid="supervisor-managed-panel" aria-busy={controller.loading}>
    <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-sm font-medium">{t("supervisor_sessions_title")}</h3>
      <Button size="sm" variant="ghost" disabled={controller.loading} aria-label={t("supervisor_sessions_refresh")} onClick={() => void controller.refresh()}><RefreshCw /></Button></div>
    <p className="mb-3 text-xs text-muted-foreground">{t(controller.currentUser ? "supervisor_sessions_current_user_description" : "supervisor_sessions_panel_description")}</p>
    <StateMessages controller={controller} />
    {openFailed ? <p role="alert" className="text-xs text-destructive">{t("supervisor_sessions_open_failed")}</p> : null}
    {controller.observation && !controller.loading && !rows.length ? <p className="mb-3 text-xs text-muted-foreground">{t(controller.currentUser ? "supervisor_sessions_current_user_empty" : controller.observation.scope.allowed_projects.length ? "supervisor_sessions_none_attached" : "supervisor_sessions_no_scope")}</p> : null}
    <ul className="max-h-64 space-y-3 overflow-y-auto">{rows.map((row) => <li key={row.session_id} className="flex items-center gap-2" data-managed-session={row.session_id}>
      <SessionLabel row={row} />
      <Button size="sm" variant="ghost" disabled={opening !== null} onClick={() => void openSession(row.session_id)}>{t("supervisor_sessions_open")}</Button>
    </li>)}</ul>
    {controller.currentUser && controller.nextAfter !== null ? <Button size="sm" variant="outline" disabled={controller.loadingMore || controller.loading} onClick={() => void controller.loadMore()}>{t("supervisor_sessions_more")}</Button> : null}
    <Button ref={trigger} variant="outline" size="sm" className="mt-3" onClick={() => setManaging(true)}>{t(controller.currentUser ? "supervisor_sessions_browse" : "supervisor_sessions_manage")}</Button>
    {managing ? <SupervisorManagedSessionsDialog open dependencies={dependencies} onOpenChange={(next) => { setManaging(next); if (!next) void controller.refresh() }} returnFocus={() => trigger.current?.focus()} /> : null}
  </section>
}
