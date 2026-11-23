import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js"
import { RefreshCw } from "@lucide/solid"
import type { ManagedSessionSelection, ManagedSessionsResponse } from "@services/supervisorScope/managedSessions"
import type { ScopeProblem } from "@services/supervisorScope/types"

import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog"
import { createSupervisorManagedSessions, type ManagedSessionsDependencies } from "./createSupervisorManagedSessions"
import { SupervisorProjectScopeDialog } from "./SupervisorProjectScopeDialog"

type Controller = ReturnType<typeof createSupervisorManagedSessions>
type Row = ReturnType<Controller["rows"]>[number]
type ConfirmedOpen = (row: Row, observation: ManagedSessionsResponse, current?: () => boolean) => void | Promise<void>

function createPagingFocus(controller: Controller) {
  let more: HTMLButtonElement | null = null
  let fallback: HTMLButtonElement | null = null
  let pending: HTMLButtonElement | null = null
  createEffect(() => [controller.view().loadingMore, controller.view().nextAfter ?? controller.view().nextOffset] as const,
    ([loading]) => {
      if (loading || !pending) return
      const previous = pending
      pending = null
      if (!previous.isConnected && document.activeElement === document.body) fallback?.focus()
    })
  return {
    more: (element: HTMLButtonElement) => { more = element },
    fallback: (element: HTMLButtonElement) => { fallback = element },
    restore: () => { fallback?.focus({ preventScroll: true }) },
    remember: () => { pending = document.activeElement === more ? more : null },
  }
}

const statusKeys = { current_user: "supervisor_sessions_current_user_status", authorized: "supervisor_sessions_authorized", reconfirm: "supervisor_sessions_reconfirm", detached: "supervisor_sessions_detached", available: "supervisor_sessions_available", unavailable: "supervisor_sessions_unverified" } as const
const problemKeys = { unsupported: "supervisor_sessions_unsupported", missing: "supervisor_sessions_missing", authentication: "supervisor_scope_access_required", forbidden: "supervisor_scope_forbidden",
  conflict: "supervisor_sessions_conflict", unavailable: "supervisor_sessions_unavailable", invalid: "supervisor_sessions_invalid", error: "supervisor_sessions_read_failed" } as const
const problemTextKey = (problem: ScopeProblem) => problem.kind === "error" && problem.code === "project_unavailable"
  ? "supervisor_sessions_project_unavailable" : problemKeys[problem.kind]
const noticeKeys = { saved: "supervisor_sessions_saved", unknown: "supervisor_sessions_unknown", conflict: "supervisor_sessions_conflict", rejected: "supervisor_sessions_rejected" } as const

function StateMessages(props: { controller: Controller }) {
  const text = createUiText()
  const view = () => props.controller.view()
  return <>
    <Show when={view().loading || !view().observation && !view().problem}><p role="status" class="text-xs text-muted-foreground">{text("supervisor_sessions_loading")}</p></Show>
    <Show when={view().problem}>{(problem) => <p role="alert" class="text-xs text-destructive">{text(problemTextKey(problem()))}</p>}</Show>
    <Show when={view().notice}>{(notice) => <p role={notice() === "saved" ? "status" : "alert"} class="text-xs text-muted-foreground">{text(noticeKeys[notice()])}</p>}</Show>
    <Show when={view().catalogError}><p role="alert" class="text-xs text-muted-foreground">{text("supervisor_sessions_catalog_failed")}</p></Show>
    <Show when={view().observation && !view().observation?.owner_authorization.available}><p role="status" class="text-xs text-muted-foreground">{text("supervisor_scope_access_required")}</p></Show>
    <Show when={props.controller.currentUser() && view().observation?.capabilities.current_user_bound_history_v1 !== true}>
      <p role="status" class="text-xs text-muted-foreground">{text("supervisor_sessions_bound_history_unsupported")}</p>
    </Show>
  </>
}

function SessionLabel(props: { row: Row }) {
  const text = createUiText()
  const progress = () => props.row.summary?.is_running ? text("supervisor_sessions_running") : props.row.summary?.last_run_status
  return <div class="min-w-0 flex-1 [overflow-wrap:anywhere]">
    <p class="text-sm font-medium">{props.row.summary?.title || props.row.session_id}</p>
    <p class="text-xs text-muted-foreground">{text(statusKeys[props.row.status])}{props.row.link?.kind ? ` · ${props.row.link.kind === "root" ? "Root" : "Child"}` : ""}
      {progress() ? ` · ${text("supervisor_sessions_progress", { progress: progress() })}` : ""}</p>
    <Show when={props.row.summary?.model}>{(model) => <p class="text-xs text-muted-foreground">{text("supervisor_sessions_model", { model: model() })}</p>}</Show>
  </div>
}

function canOpen(view: ReturnType<Controller["view"]>, currentUser: boolean) {
  return !view.loading && !view.loadingMore && !view.problem && Boolean(view.observation?.owner_authorization.available)
    && (!currentUser || view.observation?.capabilities.current_user_bound_history_v1 === true)
}

export function SupervisorManagedSessionsDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus?: () => void
  dependencies?: ManagedSessionsDependencies
  onOpenSession?: ConfirmedOpen
  opening?: boolean
  openFailed?: boolean
}) {
  const text = createUiText()
  const controller = createSupervisorManagedSessions(() => props.open, untrack(() => props.dependencies))
  const view = controller.view
  const paging = createPagingFocus(controller)
  const [scopeOpen, setScopeOpen] = createSignal(false)
  let scopeTrigger: HTMLButtonElement | undefined
  let closingTimer: ReturnType<typeof setTimeout> | undefined
  const restoreScopeTrigger = () => scopeTrigger?.focus({ preventScroll: true })
  onCleanup(() => { if (closingTimer !== undefined) clearTimeout(closingTimer) })
  const onScopeChange = (next: boolean) => {
    if (!next) closingTimer = setTimeout(() => { closingTimer = undefined }, 0)
    setScopeOpen(next)
    if (!next) void controller.refresh()
  }
  const reviewed = () => controller.rows().find((row) => row.session_id === view().review?.target_session_id)
  return <>
    <Dialog open={props.open} onOpenChange={(next) => { if (!view().submitting && !scopeOpen() && closingTimer === undefined) props.onOpenChange(next) }}>
      {/* The force-mounted Workbench can register above this portal in Kobalte's layer stack. */}
      <DialogContent class={`z-[60] max-h-[90dvh] overflow-y-auto ${scopeOpen() ? "pointer-events-none!" : "pointer-events-auto!"}`}
        dismissable={!view().submitting && !scopeOpen()}
        onEscapeKeyDown={(event: KeyboardEvent) => { if (closingTimer !== undefined) event.preventDefault() }}
        onCloseAutoFocus={(event: Event) => { if (props.returnFocus) { event.preventDefault(); props.returnFocus() } }}>
        <DialogHeader>
          <DialogTitle>{text("supervisor_sessions_title")}</DialogTitle>
          <DialogDescription>{text(controller.currentUser() ? "supervisor_sessions_current_user_description" : "supervisor_sessions_description")}</DialogDescription>
        </DialogHeader>
        <div class="space-y-3" data-testid="supervisor-managed-sessions">
          <StateMessages controller={controller} />
          <Show when={props.openFailed}><p role="alert" class="text-xs text-destructive">{text("supervisor_sessions_open_failed")}</p></Show>
          <Button ref={(element) => { scopeTrigger = element }} variant="outline" size="sm" disabled={view().submitting}
            onClick={() => { controller.cancelReview(); setScopeOpen(true) }}>
            {text(controller.currentUser() ? "supervisor_scope_current_user_title" : "supervisor_scope_title")}
          </Button>
          <Show when={controller.currentUser()} fallback={
            <Show when={view().observation?.scope.allowed_projects.length === 0}><p class="text-xs text-muted-foreground">{text("supervisor_sessions_no_scope")}</p></Show>
          }><p class="text-xs text-muted-foreground">{text("supervisor_sessions_legacy_links", { count: Object.keys(view().observation?.legacy_links ?? {}).length })}</p></Show>
          <Show when={view().review} fallback={<>
            <Show when={view().observation && !view().loading && !controller.rows().length}>
              <p class="text-sm text-muted-foreground">{text(controller.currentUser() ? "supervisor_sessions_current_user_empty" : "supervisor_sessions_empty")}</p>
            </Show>
            <ul class="space-y-2"><For each={controller.rows()} keyed={(row) => row.session_id}>{(row) => <li data-managed-session={row().session_id} class="flex items-center gap-3 rounded-lg border p-3">
              <SessionLabel row={row()} />
              <Show when={!controller.currentUser()} fallback={
                <Show when={props.onOpenSession}>
                  <Button size="sm" variant="ghost" disabled={props.opening || !canOpen(view(), true)} onClick={() => {
                    const observation = view().observation
                    if (observation) void props.onOpenSession?.(row(), observation, controller.navigationGuard())
                  }}>{text("supervisor_sessions_open")}</Button>
                </Show>
              }><div class="flex shrink-0 flex-col gap-1">
                <Show when={!row().link?.authorized}>
                  <Button size="sm" variant="outline" disabled={!controller.canManage() || !row().canEnable || view().catalogError}
                    onClick={() => controller.reviewTarget(row().session_id, true)}>{text(row().status === "reconfirm" ? "supervisor_sessions_reconfirm_action" : "supervisor_sessions_attach")}</Button>
                </Show>
                <Show when={row().link?.enabled}><Button size="sm" variant="ghost" disabled={!controller.canManage()}
                  onClick={() => controller.reviewTarget(row().session_id, false)}>{text("supervisor_sessions_detach")}</Button></Show>
              </div></Show>
            </li>}</For></ul>
            <Show when={view().nextOffset !== null || view().nextAfter !== null}>
              <Button ref={paging.more} size="sm" variant="outline" disabled={view().loadingMore || view().loading || view().submitting}
                onClick={() => { paging.remember(); void controller.loadMore() }}>{text("supervisor_sessions_more")}</Button>
            </Show>
          </>}>{(intent) => <section class="space-y-3 rounded-lg border p-3" data-testid="managed-session-review">
            <p class="text-sm">{text(intent().enabled ? "supervisor_sessions_review_attach" : "supervisor_sessions_review_detach", { title: reviewed()?.summary?.title || intent().target_session_id })}</p>
            <p class="text-xs text-muted-foreground">{text("supervisor_sessions_context_preserved")}</p>
            <div class="flex gap-2"><Button variant="outline" disabled={view().submitting} onClick={controller.cancelReview}>{text("cancel_2cd0f3be")}</Button>
              <Button disabled={!controller.canManage()} onClick={() => void controller.confirm()}>{text(view().submitting ? "supervisor_sessions_saving" : "supervisor_sessions_confirm")}</Button></div>
          </section>}</Show>
        </div>
        <DialogFooter>
          <Button ref={paging.fallback} variant="outline" disabled={view().loading || view().submitting} onClick={() => void controller.refresh()}>{text("supervisor_scope_refresh")}</Button>
          <Button variant="outline" disabled={view().submitting} onClick={() => props.onOpenChange(false)}>{text("supervisor_scope_close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Show when={scopeOpen()}><SupervisorProjectScopeDialog open onOpenChange={onScopeChange} returnFocus={restoreScopeTrigger} /></Show>
  </>
}

export function SupervisorManagedSessionsPanel(props: {
  active: boolean
  onSelectSession: (id: string, selection?: ManagedSessionSelection, current?: () => boolean) => void | Promise<boolean>
  dependencies?: ManagedSessionsDependencies
}) {
  const text = createUiText()
  const controller = createSupervisorManagedSessions(() => props.active, untrack(() => props.dependencies))
  const view = controller.view
  const paging = createPagingFocus(controller)
  const [managing, setManaging] = createSignal(false)
  const [opening, setOpening] = createSignal<string | null>(null)
  const [openFailed, setOpenFailed] = createSignal(false)
  let openingNow = false
  let alive = true
  onCleanup(() => { alive = false })
  const rows = createMemo(() => controller.rows().filter((row) => Boolean(row.link)))
  const open: ConfirmedOpen = async (row, observation, sourceCurrent) => {
    if (openingNow || !alive || !props.active) return
    const target = row.link?.current_user_target
    const panelCurrent = controller.navigationGuard(!sourceCurrent)
    const current = () => alive && props.active && panelCurrent() && (!sourceCurrent || sourceCurrent())
    if (!current() || observation.management_access && (!observation.owner_authorization.available || !target
      || observation.capabilities.current_user_bound_history_v1 !== true)) { setOpenFailed(true); return }
    openingNow = true
    setOpening(row.session_id)
    setOpenFailed(false)
    try {
      const result = target && observation.management_access
        ? await props.onSelectSession(row.session_id, { target, supervisor: observation.scope.supervisor }, current)
        : await props.onSelectSession(row.session_id)
      if (alive && result === false) setOpenFailed(true)
    } catch { if (alive) setOpenFailed(true) }
    finally { openingNow = false; if (alive) setOpening(null) }
  }
  return <section class="rounded-lg border p-3" data-testid="supervisor-managed-panel" aria-busy={view().loading ? "true" : "false"}>
    <div class="mb-2 flex items-center justify-between gap-2">
      <h3 class="text-sm font-medium">{text("supervisor_sessions_title")}</h3>
      <Button size="sm" variant="ghost" disabled={view().loading} aria-label={text("supervisor_sessions_refresh")} onClick={() => void controller.refresh()}><RefreshCw /></Button>
    </div>
    <p class="mb-3 text-xs text-muted-foreground">{text(controller.currentUser() ? "supervisor_sessions_current_user_description" : "supervisor_sessions_panel_description")}</p>
    <StateMessages controller={controller} />
    <Show when={openFailed()}><p role="alert" class="text-xs text-destructive">{text("supervisor_sessions_open_failed")}</p></Show>
    <Show when={view().observation && !view().loading && !rows().length}>
      <p class="mb-3 text-xs text-muted-foreground">{text(controller.currentUser() ? "supervisor_sessions_current_user_empty"
        : view().observation?.scope.allowed_projects.length ? "supervisor_sessions_none_attached" : "supervisor_sessions_no_scope")}</p>
    </Show>
    <ul class="max-h-64 space-y-3 overflow-y-auto"><For each={rows()} keyed={(row) => row.session_id}>{(row) => <li class="flex items-center gap-2" data-managed-session={row().session_id}>
      <SessionLabel row={row()} />
      <Button size="sm" variant="ghost" disabled={opening() !== null || !canOpen(view(), controller.currentUser())} onClick={() => {
        const observation = view().observation
        if (observation) void open(row(), observation)
      }}>{text("supervisor_sessions_open")}</Button>
    </li>}</For></ul>
    <Show when={controller.currentUser() && view().nextAfter !== null}>
      <Button ref={paging.more} size="sm" variant="outline" disabled={view().loadingMore || view().loading}
        onClick={() => { paging.remember(); void controller.loadMore() }}>{text("supervisor_sessions_more")}</Button>
    </Show>
    <Button ref={paging.fallback} variant="outline" size="sm" class="mt-3" onClick={() => setManaging(true)}>
      {text(controller.currentUser() ? "supervisor_sessions_browse" : "supervisor_sessions_manage")}
    </Button>
    <Show when={managing()}><SupervisorManagedSessionsDialog open dependencies={props.dependencies} onOpenSession={open}
      opening={opening() !== null} openFailed={openFailed()} onOpenChange={(next) => { setManaging(next); if (!next) void controller.refresh() }}
      returnFocus={paging.restore} /></Show>
  </section>
}
