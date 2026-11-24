import { Archive, ArchiveRestore, Check, FolderPlus, Loader2, Plus, X } from "@lucide/solid"
import { createMemo, createSignal, For, onSettled } from "solid-js"
import { uiText } from "@shared/i18n/text"
import { appStore } from "@shared/store/appStore/state"
import { isApiError } from "@services/api"
import type { ProjectManifest } from "@services/project"
import { workspaceService } from "@services/workspace"
import { cn } from "@/lib/utils"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogTitle } from "../ui/responsive-dialog"
import { createStoreSelector } from "../state/createStoreSelector"
import { createUiText } from "./uiText"

const errorMessage = (error: unknown, fallback: string): string => {
  if (isApiError(error)) {
    if (error.status === 409) return uiText("conflict_the_project_was_just_changed_please_try_again_39427e75")
    if (error.status === 404) return uiText("the_project_does_not_exist_or_has_been_deleted_e99cf9dc")
    return error.message || fallback
  }
  return error instanceof Error ? error.message : fallback
}

/** Create-project inline form. The primary path is a real existing folder. */
function CreateProjectForm({ onCreated }: { onCreated: (project: ProjectManifest) => void }) {
  const text = createUiText()
  const createProject = appStore.getState().createProject
  const [name, setName] = createSignal("")
  const [path, setPath] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const submit = async () => {
    const trimmedName = name().trim()
    const trimmedPath = path().trim().replace(/\/+$/, "")
    if (!trimmedName || !trimmedPath || busy()) return
    setBusy(true)
    setError(null)
    try {
      const ws = await workspaceService.validatePath(trimmedPath)
      if (!ws.is_valid) {
        setError(ws.error_message || text("invalid_path_1f83ecf9"))
        return
      }
      const manifest = await createProject({
        name: trimmedName,
        project_path: trimmedPath,
      })
      onCreated(manifest)
      setName("")
      setPath("")
    } catch (err) {
      setError(errorMessage(err, text("could_not_create_7e6a71ef")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="space-y-2 rounded-md border p-3">
      <div class="text-xs font-medium text-muted-foreground">{text("new_project_0e1a7040")}</div>
      <div class="grid gap-2">
        <div class="grid gap-1">
          <label for="project-name" class="text-xs">{text("name_d44e9b3d")}</label>
          <Input
            id="project-name"
            class="h-8"
            placeholder={text("e_g_zenith_60cf008b")}
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </div>
        <div class="grid gap-1">
          <label for="project-path" class="text-xs">{text("primary_directory_absolute_path_35a7dd77")}</label>
          <Input
            id="project-path"
            class="h-8"
            placeholder="/Users/you/project"
            value={path()}
            onInput={(e) => setPath(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit()
            }}
          />
        </div>
      </div>
      {error() ? <p class="text-xs text-destructive">{error()}</p> : null}
      <Button size="sm" class="w-full" onClick={submit} disabled={!name().trim() || !path().trim() || busy()}>
        {busy() ? <Loader2 class="size-4 animate-spin" /> : <Plus class="size-4" />} {text("create_cde2cd07")}</Button>
    </div>
  )
}

export function ProjectManagerModal(props: { onClose: () => void }) {
  const text = createUiText()
  const projects = createStoreSelector(appStore, (state) => state.projects)
  const projectsLoading = createStoreSelector(appStore, (state) => state.projectsLoading)
  const projectsError = createStoreSelector(appStore, (state) => state.projectsError)
  const activeProjectId = createStoreSelector(appStore, (state) => state.activeProjectId)
  const [busyId, setBusyId] = createSignal<string | null>(null)
  const [actionError, setActionError] = createSignal<string | null>(null)
  const [bindingFor, setBindingFor] = createSignal<string | null>(null)
  const [bindingPath, setBindingPath] = createSignal("")

  onSettled(() => { void appStore.getState().loadProjects().catch(() => {}) })

  const sorted = createMemo(() =>
    Object.values(projects()).sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1
      return b.updated_at.localeCompare(a.updated_at)
    }),
  )

  const runAction = async (id: string, action: () => Promise<unknown>) => {
    if (busyId()) return
    setBusyId(id)
    setActionError(null)
    try {
      await action()
    } catch (err) {
      setActionError(errorMessage(err, text("operation_failed_0c3b4cf7")))
    } finally {
      setBusyId(null)
    }
  }

  const submitBinding = async (project: ProjectManifest) => {
    const trimmed = bindingPath().trim().replace(/\/+$/, "")
    if (!trimmed || busyId()) return
    await runAction(project.id, async () => {
      const ws = await workspaceService.validatePath(trimmed)
      if (!ws.is_valid) throw new Error(ws.error_message || text("invalid_path_1f83ecf9"))
      await appStore.getState().bindWorkspace(project.id, project.revision, { path: trimmed })
      setBindingFor(null)
      setBindingPath("")
    })
  }

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => {
        if (!o) props.onClose()
      }}
    >
      <ResponsiveDialogContent showCloseButton={false} class="p-0 sm:max-w-2xl">
        <div class="flex items-center justify-between border-b px-4 py-3">
          <ResponsiveDialogTitle>{text("manage_projects_302f96cf")}</ResponsiveDialogTitle>
          <Button size="icon" variant="ghost" onClick={props.onClose}>
            <X />
          </Button>
        </div>

        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {projectsError() ? (
            <p class="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
              {projectsError()}
            </p>
          ) : null}
          {actionError() ? (
            <p class="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
              {actionError()}
            </p>
          ) : null}

          <CreateProjectForm onCreated={() => setActionError(null)} />

          {projectsLoading() && sorted().length === 0 ? (
            <p class="text-xs text-muted-foreground">{text("loading_4927a53b")}</p>
          ) : sorted().length === 0 ? (
            <p class="text-xs text-muted-foreground">{text("no_projects_yet_4550442e")}</p>
          ) : (
            <ul class="space-y-2">
              <For each={sorted()} keyed={(project) => project.id}>{(entry) => {
                const project = entry
                const archived = () => project().status === "archived"
                const isActive = () => activeProjectId() === project().id
                return (
                  <li class={cn("rounded-md border p-3", archived() && "opacity-60")}>
                    <div class="flex items-start gap-2">
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <span class="truncate text-sm font-medium">{project().name}</span>
                          {archived() ? (
                            <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{text("archived_82395d42")}</span>
                          ) : null}
                        </div>
                        <div class="truncate text-xs text-muted-foreground" title={project().project_path ?? undefined}>
                          {project().project_path || text("no_primary_directory_configured_095fa19f")}
                        </div>
                        {project().workspace_bindings.length > 0 ? (
                          <div class="mt-1 space-y-0.5">
                            {project().workspace_bindings.map((binding) => (
                              <div class="truncate text-[11px] text-muted-foreground">
                                + {binding.path}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      {busyId() === project().id ? (
                        <Loader2 class="size-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : isActive() ? (
                        <Check class="size-4 shrink-0 text-primary" />
                      ) : null}
                    </div>

                    <div class="mt-2 flex flex-wrap items-center gap-1.5">
                      {!archived() ? (
                        <Button
                          size="sm"
                          variant="outline"
                          class="h-7 px-2 text-xs"
                          disabled={isActive() || !!busyId()}
                          onClick={() => appStore.getState().setActiveProjectId(project().id)}
                        >
                          {isActive() ? text("current_default_f50585ee") : text("set_as_default_35721109")}
                        </Button>
                      ) : null}
                      {!archived() ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          class="h-7 px-2 text-xs"
                          disabled={!!busyId()}
                          onClick={() => {
                            setBindingFor(bindingFor() === project().id ? null : project().id)
                            setBindingPath("")
                          }}
                        >
                          <FolderPlus class="size-3.5" />{text("attach_directory_66c84cb7")}</Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-7 px-2 text-xs"
                        disabled={!!busyId()}
                        onClick={() =>
                          runAction(project().id, () =>
                            archived()
                              ? appStore.getState().unarchiveProject(project().id, project().revision)
                              : appStore.getState().archiveProject(project().id, project().revision),
                          )
                        }
                      >
                        {archived() ? (
                          <>
                            <ArchiveRestore class="size-3.5" />{text("restore_e0534b8a")}</>
                        ) : (
                          <>
                            <Archive class="size-3.5" />{text("archive_5292ab1a")}</>
                        )}
                      </Button>
                    </div>

                    {bindingFor() === project().id ? (
                      <div class="mt-2 flex gap-2">
                        <Input
                          class="h-8 flex-1"
                          placeholder={text("absolute_working_directory_path_b1c49808")}
                          value={bindingPath()}
                          ref={(element) => queueMicrotask(() => element.isConnected && element.focus())}
                          onInput={(e) => setBindingPath(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void submitBinding(project())
                          }}
                        />
                        <Button size="sm" class="h-8" onClick={() => void submitBinding(project())} disabled={!bindingPath().trim() || !!busyId()}>
                          {text("attach_3dd97f4d")}</Button>
                      </div>
                    ) : null}
                  </li>
                )
              }}</For>
            </ul>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
