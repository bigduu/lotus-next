import { useEffect, useMemo, useState } from "react"
import { Archive, ArchiveRestore, Check, FolderPlus, Loader2, Plus, X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useAppStore } from "@shared/store/appStore"
import { isApiError } from "@services/api"
import type { ProjectManifest } from "@services/project"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { cn } from "@/lib/utils"
import { workspaceService } from "@services/workspace"

const errorMessage = (error: unknown, fallback: string): string => {
  if (isApiError(error)) {
    if (error.status === 409) return "冲突：项目刚被修改，请重试"
    if (error.status === 404) return "项目不存在或已被删除"
    return error.message || fallback
  }
  return error instanceof Error ? error.message : fallback
}

/** Create-project inline form. The primary path is a real existing folder. */
function CreateProjectForm({ onCreated }: { onCreated: (project: ProjectManifest) => void }) {
  const createProject = useAppStore((state) => state.createProject)
  const [name, setName] = useState("")
  const [path, setPath] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const trimmedName = name.trim()
    const trimmedPath = path.trim().replace(/\/+$/, "")
    if (!trimmedName || !trimmedPath || busy) return
    setBusy(true)
    setError(null)
    try {
      const ws = await workspaceService.validatePath(trimmedPath)
      if (!ws.is_valid) {
        setError(ws.error_message || "路径无效")
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
      setError(errorMessage(err, "创建失败"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="text-xs font-medium text-muted-foreground">新建项目</div>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label htmlFor="project-name" className="text-xs">名称</Label>
          <Input
            id="project-name"
            className="h-8"
            placeholder="如 Zenith"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="project-path" className="text-xs">主目录（绝对路径）</Label>
          <Input
            id="project-path"
            className="h-8"
            placeholder="/Users/you/project"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit()
            }}
          />
        </div>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button size="sm" className="w-full" onClick={submit} disabled={!name.trim() || !path.trim() || busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} 创建
      </Button>
    </div>
  )
}

export function ProjectManagerModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const {
    projects,
    projectsLoading,
    projectsError,
    activeProjectId,
    setActiveProjectId,
    archiveProject,
    unarchiveProject,
    bindWorkspace,
    loadProjects,
  } = useAppStore(
    useShallow((state) => ({
      projects: state.projects,
      projectsLoading: state.projectsLoading,
      projectsError: state.projectsError,
      activeProjectId: state.activeProjectId,
      setActiveProjectId: state.setActiveProjectId,
      archiveProject: state.archiveProject,
      unarchiveProject: state.unarchiveProject,
      bindWorkspace: state.bindWorkspace,
      loadProjects: state.loadProjects,
    })),
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [bindingFor, setBindingFor] = useState<string | null>(null)
  const [bindingPath, setBindingPath] = useState("")

  useEffect(() => {
    if (!open) return
    setActionError(null)
    useAppStore.getState().loadProjects().catch(() => {
      // The slice records projectsError; availability stays unknown on 5xx.
    })
  }, [open, loadProjects])

  const sorted = useMemo(
    () =>
      Object.values(projects).sort((a, b) => {
        if (a.status !== b.status) return a.status === "active" ? -1 : 1
        return b.updated_at.localeCompare(a.updated_at)
      }),
    [projects],
  )

  if (!open) return null

  const runAction = async (id: string, action: () => Promise<unknown>) => {
    if (busyId) return
    setBusyId(id)
    setActionError(null)
    try {
      await action()
    } catch (err) {
      setActionError(errorMessage(err, "操作失败"))
    } finally {
      setBusyId(null)
    }
  }

  const submitBinding = async (project: ProjectManifest) => {
    const trimmed = bindingPath.trim().replace(/\/+$/, "")
    if (!trimmed || busyId) return
    await runAction(project.id, async () => {
      const ws = await workspaceService.validatePath(trimmed)
      if (!ws.is_valid) throw new Error(ws.error_message || "路径无效")
      await bindWorkspace(project.id, project.revision, { path: trimmed })
      setBindingFor(null)
      setBindingPath("")
    })
  }

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <ResponsiveDialogContent showCloseButton={false} className="p-0 sm:max-w-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <ResponsiveDialogTitle>管理项目</ResponsiveDialogTitle>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {projectsError ? (
            <p className="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
              {projectsError}
            </p>
          ) : null}
          {actionError ? (
            <p className="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
              {actionError}
            </p>
          ) : null}

          <CreateProjectForm onCreated={() => setActionError(null)} />

          {projectsLoading && sorted.length === 0 ? (
            <p className="text-xs text-muted-foreground">加载中…</p>
          ) : sorted.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无项目</p>
          ) : (
            <ul className="space-y-2">
              {sorted.map((project) => {
                const archived = project.status === "archived"
                const isActive = activeProjectId === project.id
                return (
                  <li key={project.id} className={cn("rounded-md border p-3", archived && "opacity-60")}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{project.name}</span>
                          {archived ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">已归档</span>
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground" title={project.project_path ?? undefined}>
                          {project.project_path || "未配置主目录"}
                        </div>
                        {project.workspace_bindings.length > 0 ? (
                          <div className="mt-1 space-y-0.5">
                            {project.workspace_bindings.map((binding) => (
                              <div key={binding.path} className="truncate text-[11px] text-muted-foreground">
                                + {binding.path}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      {busyId === project.id ? (
                        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : isActive ? (
                        <Check className="size-4 shrink-0 text-primary" />
                      ) : null}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {!archived ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={isActive || !!busyId}
                          onClick={() => setActiveProjectId(project.id)}
                        >
                          {isActive ? "当前默认" : "设为默认"}
                        </Button>
                      ) : null}
                      {!archived ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          disabled={!!busyId}
                          onClick={() => {
                            setBindingFor(bindingFor === project.id ? null : project.id)
                            setBindingPath("")
                          }}
                        >
                          <FolderPlus className="size-3.5" /> 绑定目录
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={!!busyId}
                        onClick={() =>
                          runAction(project.id, () =>
                            archived
                              ? unarchiveProject(project.id, project.revision)
                              : archiveProject(project.id, project.revision),
                          )
                        }
                      >
                        {archived ? (
                          <>
                            <ArchiveRestore className="size-3.5" /> 恢复
                          </>
                        ) : (
                          <>
                            <Archive className="size-3.5" /> 归档
                          </>
                        )}
                      </Button>
                    </div>

                    {bindingFor === project.id ? (
                      <div className="mt-2 flex gap-2">
                        <Input
                          className="h-8 flex-1"
                          placeholder="工作目录绝对路径"
                          value={bindingPath}
                          autoFocus
                          onChange={(e) => setBindingPath(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void submitBinding(project)
                          }}
                        />
                        <Button size="sm" className="h-8" onClick={() => void submitBinding(project)} disabled={!bindingPath.trim() || !!busyId}>
                          绑定
                        </Button>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
