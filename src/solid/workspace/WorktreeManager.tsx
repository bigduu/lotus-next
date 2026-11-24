import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { GitBranch, RefreshCw } from "@lucide/solid"

import { appStore } from "@shared/store/appStore/state"
import { getErrorMessage } from "@services/api/errors"
import { projectService } from "@services/project"
import { worktreeService, type GitWorktree, type ProjectWorktrees, type WorktreePreferences } from "@services/workspace/WorktreeService"

import { createUiText } from "../shell/uiText"
import { createStoreSelector } from "../state/createStoreSelector"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../ui/responsive-dialog"
import { Switch } from "../ui/switch"

export interface WorktreeManagerProps {
  open: boolean
  onClose: () => void
  onOpen: (projectId: string, path: string) => void
  onSession: (id: string) => void
}

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm"
const canOpen = (entry: GitWorktree) => !entry.prunable && entry.path_encoding !== "escaped" && entry.openable !== false

export function WorktreeManager(props: WorktreeManagerProps) {
  const text = createUiText()
  const projects = createStoreSelector(appStore, (state) => state.projects)
  const [projectId, setProjectId] = createSignal("")
  const [preferences, setPreferences] = createSignal<WorktreePreferences | null>(null)
  const [listing, setListing] = createSignal<ProjectWorktrees | null>(null)
  const [globalRoot, setGlobalRoot] = createSignal("")
  const [projectRoot, setProjectRoot] = createSignal("")
  const [repository, setRepository] = createSignal("")
  const [root, setRoot] = createSignal("")
  const [name, setName] = createSignal("")
  const [branch, setBranch] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [createdPath, setCreatedPath] = createSignal<string | null>(null)
  const activeProjects = createMemo(() => Object.values(projects()).filter((project) => project.status === "active"))
  const selectedProjectId = createMemo(() =>
    activeProjects().some((project) => project.id === projectId()) ? projectId() : activeProjects()[0]?.id ?? "",
  )
  const selectedProject = createMemo(() => projects()[selectedProjectId()])
  const preferenceDisabled = () => loading() || busy() || !preferences()
  let contextVersion = 0
  let actionInFlight = false
  let dialogElement: HTMLDivElement | undefined
  let opener: HTMLElement | undefined

  const restoreOpener = () => {
    const previous = opener
    opener = undefined
    if (!previous?.isConnected) return
    requestAnimationFrame(() => {
      if (props.open && dialogElement?.isConnected) return
      if (document.activeElement === document.body || dialogElement?.contains(document.activeElement)) {
        previous.focus({ preventScroll: true })
      }
    })
  }
  onCleanup(() => { contextVersion += 1; restoreOpener() })
  const inContext = (version: number, id: string) =>
    props.open && contextVersion === version && selectedProjectId() === id

  createEffect(() => [props.open, selectedProjectId()] as const, ([open, id]) => {
    const version = ++contextVersion
    if (!open) { restoreOpener(); return }
    const isCurrent = () => inContext(version, id)
    setLoading(true)
    setError(null)
    setCreatedPath(null)
    setListing(null)
    setPreferences(null)
    void Promise.all([
      worktreeService.preferences(),
      id ? worktreeService.list(id) : Promise.resolve(null),
    ]).then(([prefs, next]) => {
      if (!isCurrent()) return
      setPreferences(prefs)
      setGlobalRoot(prefs.default_root ?? "")
      setProjectRoot(prefs.project_roots?.[id] ?? "")
      setListing(next)
      setRepository(next?.repositories.find((repo) => !repo.error)?.path ?? "")
      setRoot(next?.default_root ?? "")
    }).catch((failure) => { if (isCurrent()) setError(getErrorMessage(failure)) })
      .finally(() => { if (isCurrent()) setLoading(false) })
  })

  const run = async (action: (id: string, isCurrent: () => boolean) => Promise<void>) => {
    if (actionInFlight || !props.open || loading()) return
    const version = contextVersion
    const id = selectedProjectId()
    const isCurrent = () => inContext(version, id)
    const focused = document.activeElement
    actionInFlight = true
    // Keep focus in the dialog when the initiating field or button is disabled.
    if (dialogElement?.contains(focused)) dialogElement.focus({ preventScroll: true })
    setBusy(true)
    setError(null)
    try { await action(id, isCurrent) }
    catch (failure) { if (isCurrent()) setError(getErrorMessage(failure)) }
    finally {
      actionInFlight = false
      setBusy(false)
      requestAnimationFrame(() => {
        if (!isCurrent() || !dialogElement
          || (document.activeElement !== document.body && document.activeElement !== dialogElement)) return
        if (focused instanceof HTMLElement && dialogElement.contains(focused) && !focused.matches(":disabled")) {
          focused.focus({ preventScroll: true })
        } else {
          dialogElement.focus({ preventScroll: true })
        }
      })
    }
  }

  const refresh = async (id: string, isCurrent: () => boolean) => {
    if (!id || !isCurrent()) return
    const next = await worktreeService.list(id)
    if (!isCurrent()) return
    setListing(next)
    setRepository((current) => next.repositories.some((repo) => !repo.error && repo.path === current)
      ? current : next.repositories.find((repo) => !repo.error)?.path ?? "")
  }

  const saveRoot = (projectScope: boolean) => run(async (id, isCurrent) => {
    if (projectScope && !id) return
    const value = projectScope ? projectRoot() : globalRoot()
    const next = await worktreeService.saveRoot(value.trim() ? value : null, projectScope ? id : undefined)
    if (!isCurrent()) return
    setPreferences(next)
    setGlobalRoot(next.default_root ?? "")
    setProjectRoot(next.project_roots?.[id] ?? "")
    setRoot(next.project_roots?.[id] ?? next.default_root ?? "")
    await refresh(id, isCurrent)
  })

  const saveNewChatDefault = (enabled: boolean) => run(async (id, isCurrent) => {
    if (!id) return
    const project = await projectService.getProject(id)
    if (!isCurrent()) return
    const saved = await appStore.getState().updateProject(project.id, project.revision, { new_chat_worktree: enabled })
    if (saved.new_chat_worktree !== enabled) throw new Error(text("could_not_save_project_a052bb9e"))
  })

  const openWorktree = (entry: GitWorktree) => run(async (id, isCurrent) => {
    if (!id || !canOpen(entry)) return
    // Discovery comes from Git. Existing owned descendants can use the Project's
    // source workspace directly, and session creation revalidates that authority.
    if (entry.project_owned !== true) {
      const project = await projectService.getProject(id)
      if (!isCurrent()) return
      if (project.project_path !== entry.path && !(project.workspace_bindings ?? []).some((binding) => binding.path === entry.path)) {
        await appStore.getState().bindWorkspace(project.id, project.revision, { path: entry.path })
      }
    }
    if (isCurrent()) props.onOpen(id, entry.path)
  })

  const canCreate = () => !!(selectedProjectId() && repository() && root().trim() && name().trim() && branch().trim())
  const createWorktree = () => run(async (id, isCurrent) => {
    if (!canCreate()) return
    const result = await worktreeService.create(id, { repository: repository(), root: root(), name: name().trim(), branch: branch().trim() })
    if (!isCurrent()) return
    setCreatedPath(result.path)
    setName("")
    setBranch("")
    await refresh(id, isCurrent)
  })

  return (
    <ResponsiveDialog open={props.open} onOpenChange={(next) => { if (!next && !actionInFlight) props.onClose() }}>
      <ResponsiveDialogContent
        ref={(element: HTMLDivElement) => {
          const focused = document.activeElement
          if (focused instanceof HTMLElement && focused !== document.body && !element.contains(focused)) opener = focused
          dialogElement = element
        }}
        class="gap-3 p-4" style={{ "max-width": "56rem" }} dismissable={!busy()}>
        <ResponsiveDialogTitle class="flex items-center gap-2"><GitBranch class="size-5" />{text("worktrees_title")}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription id="worktrees-description">{text("worktrees_description")}</ResponsiveDialogDescription>
        <Show when={error()}>
          <p role="alert" class="break-words text-sm text-destructive">{error()}</p>
        </Show>
        <Show when={createdPath()}>{(path) => (
          <p role="status" class="break-all text-sm">{text("worktrees_created", { path: path() })}</p>
        )}</Show>
        <div class="min-h-0 space-y-4 overflow-y-auto pr-1" style={{ "max-height": "70dvh" }}>
          <section class="space-y-2 rounded-md border p-3">
            <label for="worktree-global-root" class="text-sm font-medium">{text("worktrees_global_root")}</label>
            <div class="flex gap-2">
              <Input id="worktree-global-root" value={globalRoot()} disabled={preferenceDisabled()}
                onInput={(event) => setGlobalRoot(event.currentTarget.value)} placeholder="/Volumes/External/worktree" />
              <Button variant="outline" disabled={preferenceDisabled()} onClick={() => void saveRoot(false)}>{text("save_a3030bf8")}</Button>
            </div>
            <p class="text-xs text-muted-foreground">{text("worktrees_root_hint")}</p>
          </section>
          <section class="space-y-3">
            <label for="worktree-project" class="text-sm font-medium">{text("worktrees_project")}</label>
            <select id="worktree-project" class={selectClass} value={selectedProjectId()} disabled={loading() || busy()}
              onChange={(event) => { setCreatedPath(null); setProjectId(event.currentTarget.value) }}>
              <For each={activeProjects()} keyed={(project) => project.id} fallback={<option value="">{text("worktrees_no_projects")}</option>}>
                {(project) => <option value={project().id} selected={project().id === selectedProjectId()}>{project().name}</option>}
              </For>
            </select>
            <Show when={selectedProjectId()}>
              <label for="worktree-project-root" class="text-sm">{text("worktrees_project_root")}</label>
              <div class="flex gap-2">
                <Input id="worktree-project-root" value={projectRoot()} disabled={preferenceDisabled()}
                  onInput={(event) => setProjectRoot(event.currentTarget.value)} placeholder={text("worktrees_use_global")} />
                <Button variant="outline" disabled={preferenceDisabled()} onClick={() => void saveRoot(true)}>{text("save_a3030bf8")}</Button>
              </div>
            </Show>
            <Show when={typeof selectedProject()?.new_chat_worktree === "boolean"}>
              <div class="flex items-start justify-between gap-3">
                <div class="space-y-1">
                  <label for="worktree-new-chat-default" class="text-sm font-medium">{text("worktrees_new_chat_default")}</label>
                  <p id="worktree-new-chat-default-hint" class="text-xs text-muted-foreground">{text("worktrees_new_chat_default_hint")}</p>
                </div>
                <Switch id="worktree-new-chat-default" aria-describedby="worktree-new-chat-default-hint"
                  checked={selectedProject()?.new_chat_worktree === true} disabled={loading() || busy()}
                  onCheckedChange={(checked) => void saveNewChatDefault(checked)} />
              </div>
            </Show>
          </section>
          <Show when={loading()}><p role="status">{text("loading_4927a53b")}</p></Show>
          <Show when={listing()}>{(current) => (
            <>
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-medium">{text("worktrees_repositories")}</h3>
                <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void run(refresh)}>
                  <RefreshCw class="size-4" />{text("worktrees_refresh")}
                </Button>
              </div>
              <For each={current().repositories} keyed={(repo) => repo.path} fallback={
                <p class="text-sm text-muted-foreground">{text("worktrees_no_repositories")}</p>
              }>{(repo) => (
                <section class="space-y-2 rounded-md border p-3">
                  <h4 class="break-all text-xs text-muted-foreground">{repo().path}</h4>
                  <Show when={repo().error}><p role="alert" class="break-words text-sm text-destructive">{repo().error}</p></Show>
                  <For each={repo().warnings ?? []}>{(warning) => (
                    <p role="status" class="break-words text-sm text-muted-foreground">{warning}</p>
                  )}</For>
                  <For each={repo().worktrees} keyed={(entry) => entry.path}>{(entry) => (
                    <article aria-label={entry().path} class="space-y-2 border-t pt-2 text-sm">
                      <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                          <div class="font-medium">{entry().branch ?? text("worktrees_detached")}</div>
                          <div class="break-all text-xs text-muted-foreground">{entry().path}</div>
                        </div>
                        <Button size="sm" variant="outline" disabled={busy() || !canOpen(entry())} onClick={() => void openWorktree(entry())}>
                          {text("worktrees_open")}
                        </Button>
                      </div>
                      <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{entry().dirty === null ? text("worktrees_unknown") : entry().dirty ? text("worktrees_dirty") : text("worktrees_clean")}</span>
                        <span>{entry().occupied ? text("worktrees_occupied") : text("worktrees_idle")}</span>
                        <Show when={entry().locked}><span>{text("worktrees_locked")}</span></Show>
                        <Show when={entry().prunable}><span>{text("worktrees_unavailable")}</span></Show>
                      </div>
                      <Show when={entry().error}><p role="alert" class="break-words text-xs text-destructive">{entry().error}</p></Show>
                      <div class="flex flex-wrap gap-1">
                        <For each={entry().sessions} keyed={(session) => session.id} fallback={
                          <span class="text-xs text-muted-foreground">{text("worktrees_no_sessions")}</span>
                        }>{(session) => (
                          <Button variant="ghost" size="sm" disabled={busy()} onClick={() => props.onSession(session().id)}>
                            {session().title || session().id}{session().active ? ` · ${text("worktrees_active_session")}` : ""}
                          </Button>
                        )}</For>
                      </div>
                    </article>
                  )}</For>
                </section>
              )}</For>
              <form class="space-y-3 rounded-md border p-3" onSubmit={(event) => { event.preventDefault(); void createWorktree() }}>
                <h3 class="text-sm font-medium">{text("worktrees_create")}</h3>
                <label for="worktree-repository" class="text-xs">{text("worktrees_repository")}</label>
                <select id="worktree-repository" class={selectClass} value={repository()} disabled={busy()}
                  onChange={(event) => setRepository(event.currentTarget.value)}>
                  <For each={current().repositories.filter((repo) => !repo.error)} keyed={(repo) => repo.path}>{(repo) => (
                    <option value={repo().path} selected={repo().path === repository()}>{repo().path}</option>
                  )}</For>
                </select>
                <label for="worktree-root" class="text-xs">{text("worktrees_create_root")}</label>
                <Input id="worktree-root" required value={root()} disabled={busy()} onInput={(event) => setRoot(event.currentTarget.value)} />
                <div class="grid gap-3 sm:grid-cols-2">
                  <div class="space-y-1">
                    <label for="worktree-name" class="text-xs">{text("worktrees_folder")}</label>
                    <Input id="worktree-name" required pattern="[A-Za-z0-9_\-]{1,80}" value={name()} disabled={busy()}
                      onInput={(event) => setName(event.currentTarget.value)} />
                  </div>
                  <div class="space-y-1">
                    <label for="worktree-branch" class="text-xs">{text("worktrees_branch")}</label>
                    <Input id="worktree-branch" required value={branch()} disabled={busy()} onInput={(event) => setBranch(event.currentTarget.value)} />
                  </div>
                </div>
                <p class="text-xs text-muted-foreground">{text("worktrees_target", { path: `${root().replace(/\/$/, "")}/${name()}` })}</p>
                <Button type="submit" disabled={busy() || !canCreate()}>{text("worktrees_create")}</Button>
              </form>
            </>
          )}</Show>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
