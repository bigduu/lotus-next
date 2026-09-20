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
      return "项目刚被其他操作修改，请关闭后重试"
    }
    if (error.status === 404) return "项目不存在或已被移除"
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
        if (!fresh) throw new Error("项目不存在")
        setName(fresh.name)
        setPrimaryPath(fresh.project_path ?? "")
        setBindings(fresh.workspace_bindings)
      })
      .catch((reason) => {
        if (!cancelled) setError(projectErrorMessage(reason, "加载项目失败"))
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
      setError(projectErrorMessage(reason, "无法打开目录选择器"))
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
      setError("请输入项目名称")
      return
    }
    if (!normalizedPrimary) {
      setError("请选择项目主目录")
      return
    }

    setSaving(true)
    setError(null)
    try {
      const validationPaths = [normalizedPrimary, ...desiredBindings.map((binding) => binding.path)]
      const validations = await Promise.all(validationPaths.map((path) => workspaceService.validatePath(path)))
      const invalid = validations.find((result) => !result.is_valid)
      if (invalid) throw new Error(invalid.error_message || "源目录无效")

      let current = useAppStore.getState().projects[projectId]
      if (!current) throw new Error("项目不存在")
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
      setError(projectErrorMessage(reason, "保存项目失败"))
    } finally {
      setSaving(false)
    }
  }

  const removeOrRestore = async () => {
    setSaving(true)
    setError(null)
    try {
      const current = useAppStore.getState().projects[projectId]
      if (!current) throw new Error("项目不存在")
      if (current.status === "archived") await unarchiveProject(current.id, current.revision)
      else await archiveProject(current.id, current.revision)
      setConfirmRemove(false)
      onClose()
    } catch (reason) {
      setError(projectErrorMessage(reason, project.status === "archived" ? "恢复项目失败" : "移除项目失败"))
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
              <ResponsiveDialogTitle>{`移除“${project.name}”？`}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="mt-2 leading-relaxed">
                项目会从新建会话入口移除，但现有会话和项目数据不会删除；之后可以在“管理项目”中恢复。
              </ResponsiveDialogDescription>
              {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
            </div>
            <div className="flex justify-end gap-2 p-4 pt-2">
              <Button variant="secondary" disabled={saving} onClick={() => setConfirmRemove(false)}>
                取消
              </Button>
              <Button variant="destructive" disabled={saving} onClick={() => void removeOrRestore()}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                移除项目
              </Button>
            </div>
          </>
        ) : (
          <>
          <div className="border-b p-4">
            <ResponsiveDialogTitle>编辑项目</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="mt-1">
              名称和源目录由 Bamboo 项目清单持久化，所有窗口会使用同一份配置。
            </ResponsiveDialogDescription>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> 正在读取项目…
              </div>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <label htmlFor="edit-project-name" className="text-sm font-medium">项目名称</label>
                  <Input
                    id="edit-project-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoFocus
                  />
                </div>

                <div className="space-y-2">
                  <div>
                    <div className="text-sm font-medium">源目录</div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      主目录是新会话的默认工作区；可以继续绑定其他仓库或 worktree。
                    </p>
                  </div>

                  <div className="overflow-hidden rounded-lg border">
                    <div className="flex items-center gap-2 border-b px-3 py-2.5">
                      <Folder className="size-4 shrink-0 text-muted-foreground" />
                      <Input
                        aria-label="项目主目录"
                        className="h-8 min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
                        value={primaryPath}
                        onChange={(event) => setPrimaryPath(event.target.value)}
                        placeholder="主目录绝对路径"
                      />
                      <span className="shrink-0 text-[11px] text-muted-foreground">主要</span>
                      {isTauriEnvironment() ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label="选择项目主目录"
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
                          aria-label={`移除源目录 ${binding.path}`}
                          onClick={() => setBindings((current) => current.filter((item) => item.path !== binding.path))}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <FolderPlus className="size-4 shrink-0 text-muted-foreground" />
                      <Input
                        aria-label="新增源目录"
                        className="h-8 min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
                        value={newPath}
                        onChange={(event) => setNewPath(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault()
                            addPath()
                          }
                        }}
                        placeholder="添加文件夹绝对路径"
                      />
                      {isTauriEnvironment() ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label="选择新增源目录"
                          onClick={() => void choosePath("binding")}
                        >
                          <FolderOpen className="size-3.5" />
                        </Button>
                      ) : null}
                      <Button type="button" size="sm" variant="ghost" disabled={!newPath.trim()} onClick={() => addPath()}>
                        添加
                      </Button>
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
                恢复项目
              </Button>
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
                移除本地项目
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" disabled={saving} onClick={onClose}>取消</Button>
              <Button disabled={saving || loading || !name.trim() || !primaryPath.trim()} onClick={() => void save()}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                保存
              </Button>
            </div>
          </div>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
