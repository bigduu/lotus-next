import { createMemo, createUniqueId, For, Show, untrack } from "solid-js"
import type { ScopeErrorCode } from "@services/supervisorScope/types"

import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog"
import { createSupervisorProjectScope, type ProjectScopeDependencies } from "./createSupervisorProjectScope"

const noticeKeys = {
  authentication: "supervisor_scope_access_required", saved: "supervisor_scope_saved", conflict: "supervisor_scope_conflict",
  rejected: "supervisor_scope_forbidden", unavailable: "supervisor_scope_unavailable", unknown: "supervisor_scope_unknown",
} as const
const problemKeys = { unsupported: "supervisor_scope_unsupported", missing: "supervisor_scope_missing", authentication: "supervisor_scope_access_required", forbidden: "supervisor_scope_forbidden",
  conflict: "supervisor_scope_conflict", unavailable: "supervisor_scope_storage", invalid: "supervisor_scope_invalid", error: "supervisor_scope_error" } as const
const codeKeys: Record<ScopeErrorCode, Parameters<ReturnType<typeof createUiText>>[0]> = {
  scope_revision_conflict: "supervisor_scope_conflict", project_scope_invalid: "supervisor_scope_invalid",
  host_owner_authorization_unavailable: "supervisor_scope_unavailable", host_owner_authorization_required: "supervisor_scope_rejected",
  scope_authority_invalid: "supervisor_scope_authority_invalid", supervisor_identity_mismatch: "supervisor_scope_identity",
  supervisor_missing: "supervisor_scope_missing", project_unavailable: "supervisor_scope_project_unavailable", project_archived: "supervisor_scope_project_unavailable",
  project_store_unavailable: "supervisor_scope_storage", scope_unavailable: "supervisor_scope_storage",
}

export function SupervisorProjectScopeDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  dependencies?: ProjectScopeDependencies
  returnFocus?: () => void
}) {
  const text = createUiText()
  const state = createSupervisorProjectScope(() => props.open, untrack(() => props.dependencies))
  const view = state.view
  const prefix = createUniqueId()
  const scope = () => view().observation?.scope
  const currentUser = () => view().observation?.management_access?.kind === "current_user"
  const projects = createMemo(() => new Map(view().projects.map((project) => [project.id, project])))
  const ids = createMemo(() => [...new Set([...projects().keys(), ...(scope()?.allowed_projects ?? []), ...(view().draft ?? [])])].sort())
  const added = () => view().draft?.filter((id) => !scope()?.allowed_projects.includes(id)) ?? []
  const removed = () => scope()?.allowed_projects.filter((id) => !view().draft?.includes(id)) ?? []
  const notice = () => { const item = view().notice; return item && text(item.code && codeKeys[item.code] || noticeKeys[item.kind]) }
  const problem = () => { const item = view().problem; return item && text(item.code && codeKeys[item.code] || problemKeys[item.kind]) }
  const ProjectList = (input: { ids: readonly string[] }) => <ul class="space-y-1 [overflow-wrap:anywhere]">
    <For each={input.ids}>{(id) => <li>{projects().get(id)?.name || id} <code>{id}</code></li>}</For>
  </ul>
  return <Dialog open={props.open} onOpenChange={(value) => { if (!view().submitting) props.onOpenChange(value) }}>
    <DialogContent dismissable={!view().submitting} class="pointer-events-auto! z-[70] max-h-[90dvh] overflow-y-auto"
      onCloseAutoFocus={(event: Event) => { if (props.returnFocus) { event.preventDefault(); props.returnFocus() } }}>
      <DialogHeader>
        <DialogTitle>{text(currentUser() ? "supervisor_scope_current_user_title" : "supervisor_scope_title")}</DialogTitle>
        <DialogDescription>{text(currentUser() ? "supervisor_scope_current_user_description" : "supervisor_scope_description")}</DialogDescription>
      </DialogHeader>
      <div class="space-y-3 text-sm" data-testid="supervisor-project-scope">
        <Show when={view().reading}><p role="status">{text("supervisor_scope_loading")}</p></Show>
        <Show when={problem()}><p role="alert">{problem()}</p></Show>
        <Show when={notice()}><p role={view().notice?.kind === "saved" ? "status" : "alert"}>{notice()}</p></Show>
        <Show when={scope()}>{(observed) => <>
          <p data-testid="project-scope-current">{text(currentUser() ? "supervisor_scope_current_user_ready"
            : observed().allowed_projects.length ? "supervisor_scope_configured" : "supervisor_scope_empty", { count: observed().allowed_projects.length })}</p>
          <dl class="space-y-1 text-xs [overflow-wrap:anywhere]">
            <dt>{text("supervisor_scope_identity_label")}</dt><dd>{observed().supervisor.session_id} · {observed().supervisor.incarnation_id}</dd>
            <dt>{text("supervisor_scope_revision")}</dt><dd>{observed().state_revision}</dd>
          </dl>
          <Show when={currentUser()} fallback={<>
            <Show when={!view().reading}><p role="status">{text(view().observation?.owner_authorization.kind !== "existing_access"
              ? "supervisor_scope_http_unsupported" : state.writeAvailable() ? "supervisor_scope_http_ready" : "supervisor_scope_unavailable")}</p></Show>
            <p class="text-muted-foreground">{text("supervisor_scope_boundaries")}</p>
            <Show when={view().catalogError}><p role="alert">{text("supervisor_scope_catalog_error")}</p></Show>
            <Show when={view().review} fallback={<fieldset disabled={!state.canEdit()} class="space-y-2">
              <legend class="mb-2 font-medium">{text("supervisor_scope_choose")}</legend>
              <Show when={!ids().length}><p>{text("supervisor_scope_no_projects")}</p></Show>
              <For each={ids()}>{(id, index) => {
                const candidate = () => projects().get(id)
                const selected = () => view().draft?.includes(id) ?? false
                return <label for={`${prefix}-${index()}`} class="flex items-start gap-2 [overflow-wrap:anywhere]">
                  <input id={`${prefix}-${index()}`} type="checkbox" checked={selected()}
                    disabled={!selected() && (candidate()?.status !== "active" || (view().draft?.length ?? 0) >= 64)}
                    onChange={(event) => state.edit(id, event.currentTarget.checked)} />
                  <span>{candidate()?.name || id} <code>{id}</code>{candidate()?.status !== "active" ? ` · ${text("supervisor_scope_project_unavailable")}` : ""}</span>
                </label>
              }}</For>
            </fieldset>}>{(review) => <section data-testid="project-scope-review" class="space-y-2 [overflow-wrap:anywhere]">
              <strong>{text("supervisor_scope_complete_set", { count: review().mutation.allowed_projects.length })}</strong>
              <Show when={review().mutation.allowed_projects.length} fallback={<p>{text("supervisor_scope_target_empty")}</p>}>
                <ProjectList ids={review().mutation.allowed_projects} />
              </Show>
              <p>{text("supervisor_scope_added")}: {added().join(", ") || text("supervisor_scope_none")}</p>
              <p>{text("supervisor_scope_removed")}: {removed().join(", ") || text("supervisor_scope_none")}</p>
              <p>{text("supervisor_scope_removal_effect")}</p><p>{text("supervisor_scope_http_review")}</p>
            </section>}</Show>
            <Show when={state.invalidSelection() && !view().catalogError}><p role="alert">{text("supervisor_scope_invalid_selection")}</p></Show>
            <Show when={view().review} fallback={<Button variant="outline" disabled={!state.canEdit()} onClick={state.reviewDraft}>{text("supervisor_scope_preview")}</Button>}>
              <div class="flex flex-wrap gap-2">
                <Button variant="outline" disabled={view().submitting || view().reading} onClick={state.backToEdit}>{text("supervisor_scope_edit")}</Button>
                <Button disabled={!state.canConfirm()} onClick={() => void state.confirm()}>{text(view().submitting ? "supervisor_scope_http_confirming" : "supervisor_scope_http_confirm")}</Button>
              </div>
            </Show>
          </>}>
            <section class="space-y-2" data-testid="current-user-management">
              <p class="text-muted-foreground">{text("supervisor_scope_current_user_boundaries")}</p>
              <p>{text("supervisor_scope_current_user_legacy", { count: observed().allowed_projects.length })}</p>
              <Show when={observed().allowed_projects.length}><ProjectList ids={observed().allowed_projects} /></Show>
              <p class="text-muted-foreground">{text("supervisor_scope_current_user_legacy_note")}</p>
            </section>
          </Show>
        </>}</Show>
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={view().reading || view().submitting} onClick={() => void state.refresh()}>{text("supervisor_scope_refresh")}</Button>
        <Button variant="outline" disabled={view().submitting} onClick={() => props.onOpenChange(false)}>{text("supervisor_scope_close")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
