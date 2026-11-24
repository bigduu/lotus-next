import { createMemo, createSignal, onCleanup, onSettled } from "solid-js"

import { isApiError } from "@services/api"
import type { ProjectManifest, WorkspaceBinding } from "@services/project"
import { workspaceService } from "@services/workspace"
import { FileOperationsService } from "@shared/services/FileOperationsService"
import { appStore } from "@shared/store/appStore/state"
import { confirmedProjectRevision } from "@shared/store/appStore/slices/projectSlice"
import { isTauriEnvironment } from "@/utils/environment"

import { createUiText } from "../../shell/uiText"

const normalizePath = (value: string): string => {
  const trimmed = value.trim()
  if (/^\/+$/u.test(trimmed)) return "/"
  if (/^[a-z]:\/+$/iu.test(trimmed)) return trimmed.slice(0, 3)
  return trimmed.replace(/\/+$/, "")
}

export function createProjectEdit(projectId: string, onClose: () => void) {
  const text = createUiText()
  const [project, setProject] = createSignal<ProjectManifest | null>(null)
  const [name, setName] = createSignal("")
  const [primaryPath, setPrimaryPath] = createSignal("")
  const [bindings, setBindings] = createSignal<WorkspaceBinding[]>([])
  const [newPath, setNewPath] = createSignal("")
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [confirmRemove, setConfirmRemove] = createSignal(false)
  const [picking, setPicking] = createSignal(false)
  let alive = true
  let actionRunning = false
  let pickerRunning = false
  onCleanup(() => { alive = false })

  const conflictMessage = () => text("the_project_was_changed_by_another_operation_close_this_c06150ff")
  const fail = (reason: unknown, fallback: string) => {
    if (!alive) return
    if (isApiError(reason)) {
      if (reason.status === 409 || reason.status === 412) { setError(conflictMessage()); return }
      if (reason.status === 404) { setError(text("the_project_does_not_exist_or_has_been_removed_6a68f3ee")); return }
    }
    setError(reason instanceof Error && reason.message ? reason.message : fallback)
  }
  const missing = () => new Error(text("project_does_not_exist_b2667460"))
  onSettled(() => {
    void appStore.getState().ensureProject(projectId, { force: true }).then(() => {
      if (!alive) return
      const fresh = appStore.getState().projects[projectId]
      if (!fresh) throw missing()
      if (confirmedProjectRevision(fresh) !== fresh.revision) throw new Error(conflictMessage())
      setProject(fresh)
      setName(fresh.name)
      setPrimaryPath(fresh.project_path ?? "")
      setBindings(fresh.workspace_bindings)
    }).catch((reason) => fail(reason, text("could_not_load_project_10e9dd1f")))
      .finally(() => { if (alive) setLoading(false) })
  })

  const sourcePaths = createMemo(() => new Set([
    normalizePath(primaryPath()), ...bindings().map((binding) => normalizePath(binding.path)),
  ]))
  const addPath = (value = newPath()) => {
    const path = normalizePath(value)
    if (!path || sourcePaths().has(path) || actionRunning) return
    setBindings((current) => [...current, { path }])
    setNewPath("")
  }
  const removePath = (path: string) => setBindings((current) => current.filter((item) => item.path !== path))
  const canPick = () => isTauriEnvironment()
  const choosePath = async (target: "primary" | "binding") => {
    if (!canPick() || pickerRunning || actionRunning) return
    pickerRunning = true
    setPicking(true)
    try {
      const selected = await FileOperationsService.pickDirectory()
      if (!alive || !selected) return
      const path = normalizePath(selected)
      if (target === "primary") setPrimaryPath(path)
      else addPath(path)
    } catch (reason) {
      fail(reason, text("could_not_open_the_folder_picker_645d74e6"))
    } finally {
      pickerRunning = false
      if (alive) setPicking(false)
    }
  }

  // A draft belongs to the revisions it was populated from. Advance that
  // fence only with this dialog's authoritative mutation responses.
  const requireUnchanged = (expected: ProjectManifest) => {
    const current = appStore.getState().projects[projectId]
    if (!current) throw missing()
    if (current.revision !== expected.revision || confirmedProjectRevision(current) !== expected.revision
      || current.resource_revision !== expected.resource_revision
      || current.status !== expected.status) throw new Error(conflictMessage())
  }
  const run = async (action: (current: ProjectManifest) => Promise<void>, fallback: string) => {
    const current = project()
    if (!alive || !current || loading() || actionRunning || pickerRunning) return
    actionRunning = true
    setSaving(true)
    setError(null)
    try {
      requireUnchanged(current)
      await action(current)
    } catch (reason) {
      fail(reason, fallback)
    } finally {
      actionRunning = false
      if (alive) setSaving(false)
    }
  }

  const save = () => run(async (base) => {
    const trimmedName = name().trim()
    const normalizedPrimary = normalizePath(primaryPath())
    if (!trimmedName) throw new Error(text("enter_a_project_name_0fb3237e"))
    if (!normalizedPrimary) throw new Error(text("select_the_project_s_primary_directory_5c187cfd"))
    const desired = new Map<string, WorkspaceBinding>()
    for (const binding of bindings()) {
      const path = normalizePath(binding.path)
      if (path && path !== normalizedPrimary && !desired.has(path)) desired.set(path, { ...binding, path })
    }
    const validations = await Promise.all([normalizedPrimary, ...desired.keys()].map((path) => workspaceService.validatePath(path)))
    if (!alive) return
    const invalid = validations.find((result) => !result.is_valid)
    if (invalid) throw new Error(invalid.error_message || text("invalid_source_directory_80ab8f9e"))

    let current = base
    const { updateProject, unbindWorkspace, bindWorkspace } = appStore.getState()
    const apply = async (mutate: (revision: number) => Promise<ProjectManifest>) => {
      requireUnchanged(current)
      current = await mutate(current.revision)
      if (alive) setProject(current)
    }
    const patch: { name?: string; project_path?: string } = {}
    if (trimmedName !== current.name) patch.name = trimmedName
    if (normalizedPrimary !== current.project_path) patch.project_path = normalizedPrimary
    if (Object.keys(patch).length > 0) await apply((revision) => updateProject(projectId, revision, patch))
    for (const binding of current.workspace_bindings) {
      if (!alive) return
      if (!desired.has(binding.path)) await apply((revision) => unbindWorkspace(projectId, revision, binding.path))
    }
    const existing = new Set(current.workspace_bindings.map((binding) => binding.path))
    for (const binding of desired.values()) {
      if (!alive) return
      if (!existing.has(binding.path)) await apply((revision) => bindWorkspace(projectId, revision, binding))
    }
    if (alive) onClose()
  }, text("could_not_save_project_a052bb9e"))

  const removeOrRestore = () => run(async (current) => {
    const { archiveProject, unarchiveProject } = appStore.getState()
    if (current.status === "archived") await unarchiveProject(projectId, current.revision)
    else await archiveProject(projectId, current.revision)
    if (alive) onClose()
  }, text(project()?.status === "archived" ? "could_not_restore_project_4f2a985d" : "could_not_remove_project_1086e674"))

  const changeConfirmation = (confirm: boolean) => {
    setError(null)
    setConfirmRemove(confirm)
  }
  const close = () => {
    if (actionRunning || pickerRunning) return
    if (confirmRemove()) changeConfirmation(false)
    else onClose()
  }
  return {
    project, name, setName, primaryPath, setPrimaryPath, bindings, newPath, setNewPath, loading, saving, error,
    confirmRemove, changeConfirmation, canPick, picking, addPath, removePath, choosePath, save, removeOrRestore, close,
  }
}
