import { useId } from "react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useSupervisorProjectScope, type ProjectScopeDependencies } from "@/hooks/useSupervisorProjectScope"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { ScopeErrorCode } from "@services/supervisorScope/types"

const noticeKeys = {
  authentication: "supervisor_scope_access_required", saved: "supervisor_scope_saved", conflict: "supervisor_scope_conflict",
  rejected: "supervisor_scope_forbidden", unavailable: "supervisor_scope_unavailable", unknown: "supervisor_scope_unknown",
} as const
const problemKeys = { unsupported: "supervisor_scope_unsupported", missing: "supervisor_scope_missing", authentication: "supervisor_scope_access_required", forbidden: "supervisor_scope_forbidden",
  conflict: "supervisor_scope_conflict", unavailable: "supervisor_scope_storage", invalid: "supervisor_scope_invalid", error: "supervisor_scope_error" } as const
const codeKeys: Record<ScopeErrorCode, Parameters<typeof uiText>[0]> = {
  scope_revision_conflict: "supervisor_scope_conflict", project_scope_invalid: "supervisor_scope_invalid",
  host_owner_authorization_unavailable: "supervisor_scope_unavailable", host_owner_authorization_required: "supervisor_scope_rejected",
  scope_authority_invalid: "supervisor_scope_authority_invalid", supervisor_identity_mismatch: "supervisor_scope_identity",
  supervisor_missing: "supervisor_scope_missing", project_unavailable: "supervisor_scope_project_unavailable", project_archived: "supervisor_scope_project_unavailable",
  project_store_unavailable: "supervisor_scope_storage", scope_unavailable: "supervisor_scope_storage",
}

export function SupervisorProjectScopeDialog({ open, onOpenChange, dependencies, returnFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void
  dependencies?: ProjectScopeDependencies; returnFocus?: () => void
}) {
  useUiLocale()
  const state = useSupervisorProjectScope(open, dependencies)
  const prefix = useId(), scope = state.observation?.scope
  const currentUser = state.observation?.management_access?.kind === "current_user"
  const authorization = state.observation?.owner_authorization
  const projects = new Map(state.projects.map((project) => [project.id, project]))
  const ids = [...new Set([...projects.keys(), ...(scope?.allowed_projects ?? []), ...(state.draft ?? [])])].sort()
  const added = state.draft?.filter((id) => !scope?.allowed_projects.includes(id)) ?? []
  const removed = scope?.allowed_projects.filter((id) => !state.draft?.includes(id)) ?? []
  const notice = state.notice && uiText(state.notice.code && codeKeys[state.notice.code] || noticeKeys[state.notice.kind])
  const problem = state.problem && uiText(state.problem.code && codeKeys[state.problem.code] || problemKeys[state.problem.kind])
  return <Dialog open={open} onOpenChange={(value) => { if (!state.submitting) onOpenChange(value) }}>
    <DialogContent showCloseButton={!state.submitting} className="max-h-[90dvh] overflow-y-auto"
      onEscapeKeyDown={(event) => { if (state.submitting) event.preventDefault() }}
      onInteractOutside={(event) => { if (state.submitting) event.preventDefault() }}
      onCloseAutoFocus={returnFocus ? (event) => { event.preventDefault(); returnFocus() } : undefined}>
      <DialogHeader>
        <DialogTitle>{uiText(currentUser ? "supervisor_scope_current_user_title" : "supervisor_scope_title")}</DialogTitle>
        <DialogDescription>{uiText(currentUser ? "supervisor_scope_current_user_description" : "supervisor_scope_description")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-sm" data-testid="supervisor-project-scope">
        {state.reading ? <p role="status">{uiText("supervisor_scope_loading")}</p> : null}
        {problem ? <p role="alert">{problem}</p> : null}
        {notice ? <p role={state.notice?.kind === "saved" ? "status" : "alert"}>{notice}</p> : null}
        {scope ? <>
          <p data-testid="project-scope-current">{uiText(currentUser ? "supervisor_scope_current_user_ready" : scope.allowed_projects.length ? "supervisor_scope_configured" : "supervisor_scope_empty", { count: scope.allowed_projects.length })}</p>
          <dl className="space-y-1 text-xs [overflow-wrap:anywhere]">
            <dt>{uiText("supervisor_scope_identity_label")}</dt><dd>{scope.supervisor.session_id} · {scope.supervisor.incarnation_id}</dd>
            <dt>{uiText("supervisor_scope_revision")}</dt><dd>{scope.state_revision}</dd>
          </dl>
          {currentUser ? <section className="space-y-2" data-testid="current-user-management">
            <p className="text-muted-foreground">{uiText("supervisor_scope_current_user_boundaries")}</p>
            <p>{uiText("supervisor_scope_current_user_legacy", { count: scope.allowed_projects.length })}</p>
            {scope.allowed_projects.length ? <ul className="space-y-1 [overflow-wrap:anywhere]">{scope.allowed_projects.map((id) => <li key={id}>{projects.get(id)?.name || id} <code>{id}</code></li>)}</ul> : null}
            <p className="text-muted-foreground">{uiText("supervisor_scope_current_user_legacy_note")}</p>
          </section> : <>
          {!state.reading ? <p role="status">{uiText(authorization?.kind !== "existing_access" ? "supervisor_scope_http_unsupported"
            : state.writeAvailable ? "supervisor_scope_http_ready" : "supervisor_scope_unavailable")}</p> : null}
          <p className="text-muted-foreground">{uiText("supervisor_scope_boundaries")}</p>
          {state.catalogError ? <p role="alert">{uiText("supervisor_scope_catalog_error")}</p> : null}
          {state.review ? <section data-testid="project-scope-review" className="space-y-2 [overflow-wrap:anywhere]">
            <strong>{uiText("supervisor_scope_complete_set", { count: state.review.mutation.allowed_projects.length })}</strong>
            {state.review.mutation.allowed_projects.length ? <ul className="space-y-1 [overflow-wrap:anywhere]">{state.review.mutation.allowed_projects.map((id) => <li key={id}>{projects.get(id)?.name || id} <code>{id}</code></li>)}</ul>
              : <p>{uiText("supervisor_scope_target_empty")}</p>}
            <p>{uiText("supervisor_scope_added")}: {added.join(", ") || uiText("supervisor_scope_none")}</p>
            <p>{uiText("supervisor_scope_removed")}: {removed.join(", ") || uiText("supervisor_scope_none")}</p>
            <p>{uiText("supervisor_scope_removal_effect")}</p>
            <p>{uiText("supervisor_scope_http_review")}</p>
          </section> : <fieldset disabled={!state.canEdit} className="space-y-2">
            <legend className="mb-2 font-medium">{uiText("supervisor_scope_choose")}</legend>
            {!ids.length ? <p>{uiText("supervisor_scope_no_projects")}</p> : null}
            {ids.map((id, index) => {
              const project = projects.get(id), selected = state.draft?.includes(id) ?? false
              return <label key={id} htmlFor={`${prefix}-${index}`} className="flex items-start gap-2 [overflow-wrap:anywhere]">
                <input id={`${prefix}-${index}`} type="checkbox" checked={selected}
                  disabled={!selected && (project?.status !== "active" || (state.draft?.length ?? 0) >= 64)}
                  onChange={(event) => state.edit(id, event.target.checked)} />
                <span>{project?.name || id} <code>{id}</code>{project?.status !== "active" ? ` · ${uiText("supervisor_scope_project_unavailable")}` : ""}</span>
              </label>
            })}
          </fieldset>}
          {state.invalidSelection && !state.catalogError ? <p role="alert">{uiText("supervisor_scope_invalid_selection")}</p> : null}
          {state.review ? <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={state.submitting || state.reading} onClick={state.backToEdit}>{uiText("supervisor_scope_edit")}</Button>
            <Button disabled={!state.canConfirm} onClick={() => void state.confirm()}>{uiText(state.submitting ? "supervisor_scope_http_confirming" : "supervisor_scope_http_confirm")}</Button>
          </div> : <Button variant="outline" disabled={!state.canEdit} onClick={state.reviewDraft}>{uiText("supervisor_scope_preview")}</Button>}
          </>}
        </> : null}
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={state.reading || state.submitting} onClick={() => void state.refresh()}>{uiText("supervisor_scope_refresh")}</Button>
        <Button variant="outline" disabled={state.submitting} onClick={() => onOpenChange(false)}>{uiText("supervisor_scope_close")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
