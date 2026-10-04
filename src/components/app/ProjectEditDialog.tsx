import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useMemo, useState } from "react"
import { Folder, FolderOpen, FolderPlus, Loader2, Trash2 } from "lucide-react"
import { useAppStore } from "@shared/store/appStore"
import { isApiError } from "@services/api"
import type { WorkspaceBinding } from "@services/project"
import { workspaceService } from "@services/workspace"
import { isTauriEnvironment } from "@/utils/environment"
import { FileOperationsService } from "@shared/services/FileOperationsService"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"

const normalizePath = (value: string): string => {
  const trimmed = value.trim()
  return trimmed === "/" ? trimmed : trimmed.replace(/\/+$/, "")
}

const projectErrorMessage = (error: unknown, fallback: string): string => {
  if (isApiError(error)) {
    if (error.status === 409 || error.status === 412) {
      return uiText("the_project_was_changed_by_another_operation_close_this_c06150ff")
    }
    if (error.status === 404) return uiText("the_project_does_not_exist_or_has_been_removed_6a68f3ee")
    return error.message || fallback
  }
  return error instanceof Error ? error.message : fallback
}

const pickNativeFolder = async (): Promise<string | null> => {
  if (!isTauriEnvironment()) return null
  const selected = await FileOperationsService.pickDirectory()
  return selected ? normalizePath(selected) : null
}

export function ProjectEditDialog({
  projectId,
  onClose,
}: {
  projectId: string | null
  onClose: () => void
}) {
  useUiLocale()
  const project = useAppStore((state) => (projectId ? state.projects[projectId] : undefined))
  const ensureProject = useAppStore((state) => state.ensureProject)
  const updateProject = useAppStore((state) => state.updateProject)
  const bindWorkspace = useAppStore((state) => state.bindWorkspace)
  const unbindWorkspace = useAppStore((state) => state.unbindWorkspace)
  const archiveProject = useAppStore((state) => state.archiveProject)
  const unarchiveProject = useAppStore((state) => state.unarchiveProject)

  const [name, setName] = useState("")
  const [primaryPath, setPrimaryPath] = useState("")
  const [bindings, setBindings] = useState<WorkspaceBinding[]>([])
  const [newPath, setNewPath] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setNewPath("")
    ensureProject(projectId)
      .then(() => {
        if (cancelled) return
        const fresh = useAppStore.getState().projects[projectId]
        if (!fresh) throw new Error(uiText("project_does_not_exist_b2667460"))
        setName(fresh.name)
        setPrimaryPath(fresh.project_path ?? "")
        setBindings(fresh.workspace_bindings)
      })
      .catch((reason) => {
        if (!cancelled) setError(projectErrorMessage(reason, uiText("could_not_load_project_10e9dd1f")))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ensureProject, projectId])

  const sourcePaths = useMemo(
    () => new Set([normalizePath(primaryPath), ...bindings.map((binding) => normalizePath(binding.path))]),
    [bindings, primaryPath],
  )

  if (!projectId || !project) return null

  const addPath = (rawPath = newPath) => {
    const path = normalizePath(rawPath)
    if (!path || sourcePaths.has(path)) return
    setBindings((current) => [...current, { path }])
    setNewPath("")
  }

  const choosePath = async (target: "primary" | "binding") => {
    try {
      const path = await pickNativeFolder()
      if (!path) return
      if (target === "primary") setPrimaryPath(path)
      else addPath(path)
    } catch (reason) {
      setError(projectErrorMessage(reason, uiText("could_not_open_the_folder_picker_645d74e6")))
    }
  }

  const save = async () => {
    const trimmedName = name.trim()
    const normalizedPrimary = normalizePath(primaryPath)
    const desiredBindings = bindings
      .map((binding) => ({ ...binding, path: normalizePath(binding.path) }))
      .filter((binding, index, list) =>
        !!binding.path &&
        binding.path !== normalizedPrimary &&
        list.findIndex((candidate) => candidate.path === binding.path) === index,
      )
    if (!trimmedName) {
      setError(uiText("enter_a_project_name_0fb3237e"))
      return
    }
    if (!normalizedPrimary) {
      setError(uiText("select_the_project_s_primary_directory_5c187cfd"))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const validationPaths = [normalizedPrimary, ...desiredBindings.map((binding) => binding.path)]
      const validations = await Promise.all(validationPaths.map((path) => workspaceService.validatePath(path)))
      const invalid = validations.find((result) => !result.is_valid)
      if (invalid) throw new Error(invalid.error_message || uiText("invalid_source_directory_80ab8f9e"))

      let current = useAppStore.getState().projects[projectId]
      if (!current) throw new Error(uiText("project_does_not_exist_b2667460"))
      const patch: { name?: string; project_path?: string } = {}
      if (trimmedName !== current.name) patch.name = trimmedName
      if (normalizedPrimary !== current.project_path) patch.project_path = normalizedPrimary
      if (Object.keys(patch).length > 0) {
        current = await updateProject(current.id, current.revision, patch)
      }

      const desiredPaths = new Set(desiredBindings.map((binding) => binding.path))
      for (const binding of [...current.workspace_bindings]) {
        if (!desiredPaths.has(binding.path)) {
          current = await unbindWorkspace(current.id, current.revision, binding.path)
        }
      }
      const existingPaths = new Set(current.workspace_bindings.map((binding) => binding.path))
      for (const binding of desiredBindings) {
        if (!existingPaths.has(binding.path)) {
          current = await bindWorkspace(current.id, current.revision, binding)
          existingPaths.add(binding.path)
        }
      }
      onClose()
    } catch (reason) {
      setError(projectErrorMessage(reason, uiText("could_not_save_project_a052bb9e")))
    } finally {
      setSaving(false)
    }
  }

  const removeOrRestore = async () => {
    setSaving(true)
    setError(null)
    try {
      const current = useAppStore.getState().projects[projectId]
      if (!current) throw new Error(uiText("project_does_not_exist_b2667460"))
      if (current.status === "archived") await unarchiveProject(current.id, current.revision)
      else await archiveProject(current.id, current.revision)
      setConfirmRemove(false)
      onClose()
    } catch (reason) {
      setError(projectErrorMessage(reason, project.status === "archived" ? uiText("could_not_restore_project_4f2a985d") : uiText("could_not_remove_project_1086e674")))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => {
        if (open || saving) return
        if (confirmRemove) setConfirmRemove(false)
        else onClose()
      }}
    >
      <ResponsiveDialogContent
        className={`gap-0 p-0 ${confirmRemove ? "sm:max-w-sm" : "sm:max-w-xl"}`}
        dismissable={!saving}
      >
        {confirmRemove ? (
          <>
            <div className="p-4 pb-2">
              <ResponsiveDialogTitle>{uiText("remove_bdb7b58b", { v0: project.name })}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="mt-2 leading-relaxed">
                {uiText("the_project_will_be_removed_from_new_session_choices_ex_d355c682")}</ResponsiveDialogDescription>
              {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
            </div>
            <div className="flex justify-end gap-2 p-4 pt-2">
              <Button variant="secondary" disabled={saving} onClick={() => setConfirmRemove(false)}>
                {uiText("cancel_2cd0f3be")}</Button>
              <Button variant="destructive" disabled={saving} onClick={() => void removeOrRestore()}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                {uiText("remove_project_84663136")}</Button>
            </div>
          </>
        ) : (
          <>
          <div className="border-b p-4">
            <ResponsiveDialogTitle>{uiText("edit_project_577feeef")}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="mt-1">
              {uiText("bamboo_persists_names_and_source_directories_in_its_pro_20919dcd")}</ResponsiveDialogDescription>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />{uiText("loading_project_6d8a4e84")}</div>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <label htmlFor="edit-project-name" className="text-sm font-medium">{uiText("project_name_867698fb")}</label>
                  <Input
                    id="edit-project-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoFocus
                  />
                </div>

                <div className="space-y-2">
                  <div>
                    <div className="text-sm font-medium">{uiText("source_directories_28af332c")}</div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {uiText("the_primary_directory_is_the_default_workspace_for_new__2518446f")}</p>
                  </div>

                  <div className="overflow-hidden rounded-lg border">
                    <div className="flex items-center gap-2 border-b px-3 py-2.5">
                      <Folder className="size-4 shrink-0 text-muted-foreground" />
                      <Input
                        aria-label={uiText("primary_project_directory_0852e851")}
                        className="h-8 min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
                        value={primaryPath}
                        onChange={(event) => setPrimaryPath(event.target.value)}
                        placeholder={uiText("absolute_path_to_primary_directory_ab8e5c38")}
                      />
                      <span className="shrink-0 text-[11px] text-muted-foreground">{uiText("primary_5ccd91f4")}</span>
                      {isTauriEnvironment() ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={uiText("select_primary_project_directory_30a25dc5")}
                          onClick={() => void choosePath("primary")}
                        >
                          <FolderOpen className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                    {bindings.map((binding) => (
                      <div key={binding.path} className="flex items-center gap-2 border-b px-3 py-2.5 last:border-0">
                        <Folder className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm" title={binding.path}>{binding.path}</span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          aria-label={uiText("remove_source_directory_c14882d9", { v0: binding.path })}
                          onClick={() => setBindings((current) => current.filter((item) => item.path !== binding.path))}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <FolderPlus className="size-4 shrink-0 text-muted-foreground" />
                      <Input
                        aria-label={uiText("add_source_directory_398c49c7")}
                        className="h-8 min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
                        value={newPath}
                        onChange={(event) => setNewPath(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault()
                            addPath()
                          }
                        }}
                        placeholder={uiText("add_an_absolute_folder_path_0a395954")}
                      />
                      {isTauriEnvironment() ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={uiText("select_source_directory_to_add_4b3ae33c")}
                          onClick={() => void choosePath("binding")}
                        >
                          <FolderOpen className="size-3.5" />
                        </Button>
                      ) : null}
                      <Button type="button" size="sm" variant="ghost" disabled={!newPath.trim()} onClick={() => addPath()}>
                        {uiText("add_7a8a11ea")}</Button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {error ? (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
            {project.status === "archived" ? (
              <Button variant="outline" disabled={saving || loading} onClick={() => void removeOrRestore()}>
                {uiText("restore_project_52a1d56b")}</Button>
            ) : (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={saving || loading}
                onClick={() => {
                  setError(null)
                  setConfirmRemove(true)
                }}
              >
                {uiText("remove_local_project_e951cbd0")}</Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" disabled={saving} onClick={onClose}>{uiText("cancel_2cd0f3be")}</Button>
              <Button disabled={saving || loading || !name.trim() || !primaryPath.trim()} onClick={() => void save()}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                {uiText("save_a3030bf8")}</Button>
            </div>
          </div>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
