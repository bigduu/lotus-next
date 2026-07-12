import { useCallback, useEffect, useRef, useState } from "react"
import { Plus, RefreshCw, RotateCw, Trash2 } from "lucide-react"
import {
  pluginService,
  type InstalledPluginView,
  type PluginSourceSpec,
  type PluginStatus,
  type RegisteredResources,
} from "@services/plugin"
import { getErrorMessage, isApiError } from "@services/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { cn } from "@/lib/utils"
import { PluginFormDialog, type PluginFormMode } from "./plugins/PluginFormDialog"

function StatusBadge({ status }: { status: PluginStatus }) {
  if (status === "installing") {
    return <Badge variant="warning">安装中(可能为异常残留)</Badge>
  }
  return <Badge variant="secondary">已安装</Badge>
}

function sourceSummary(source: PluginSourceSpec): string {
  switch (source.type) {
    case "local_dir":
      return `本地目录 · ${source.path}`
    case "local_archive":
      return `本地压缩包 · ${source.path}`
    case "url":
      return `URL · ${source.url}`
    default:
      return ""
  }
}

function registeredChips(registered: RegisteredResources): { key: string; label: string }[] {
  const chips: { key: string; label: string }[] = []
  if (registered.mcp_server_ids?.length) {
    chips.push({ key: "mcp", label: `${registered.mcp_server_ids.length} 个 MCP 服务器` })
  }
  if (registered.skill_dirs?.length) {
    chips.push({ key: "skills", label: `${registered.skill_dirs.length} 个技能` })
  }
  if (registered.preset_ids?.length) {
    chips.push({ key: "prompts", label: `${registered.preset_ids.length} 个提示词` })
  }
  if (registered.workflow_filenames?.length) {
    chips.push({ key: "workflows", label: `${registered.workflow_filenames.length} 个工作流` })
  }
  return chips
}

interface FormState {
  mode: PluginFormMode
  pluginId?: string
  pluginName?: string
  initialSource?: PluginSourceSpec | null
}

export function SettingsPlugins() {
  const [plugins, setPlugins] = useState<InstalledPluginView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [deleting, setDeleting] = useState<InstalledPluginView | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const list = await pluginService.listPlugins()
      if (!mountedRef.current) return
      setPlugins(list)
      setError(null)
    } catch (e) {
      if (!mountedRef.current) return
      setError(getErrorMessage(e))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const submitForm = async (source: PluginSourceSpec) => {
    // Throws on failure — PluginFormDialog surfaces the error inline and keeps
    // the dialog open so the user can fix the source and retry.
    try {
      if (form?.mode === "update" && form.pluginId) {
        await pluginService.updatePlugin(form.pluginId, source)
      } else {
        await pluginService.installPlugin(source)
      }
    } catch (e) {
      // 409 = already installed — steer the user toward Update instead of
      // just repeating the raw backend error.
      if (form?.mode === "install" && isApiError(e) && e.status === 409) {
        throw new Error(`${getErrorMessage(e)}(该插件已安装,请改用「更新」)`)
      }
      throw e
    }
    setForm(null)
    await reload(true)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await pluginService.removePlugin(deleting.id)
      setDeleting(null)
      await reload(true)
    } catch (e) {
      setDeleteError(getErrorMessage(e))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs leading-relaxed text-muted-foreground">
          安装 / 更新 / 卸载扩展插件。插件可能会注册 MCP 服务器、技能、提示词或工作流。
        </p>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} /> 刷新
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setForm({ mode: "install" })}
          >
            <Plus className="size-4" /> 安装插件
          </Button>
        </div>
      </div>

      {error ? (
        <div
          className="flex items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs break-all text-destructive"
          role="alert"
        >
          <span>{error}</span>
          <Button size="sm" variant="secondary" className="h-7 shrink-0 px-2" onClick={() => void reload()}>
            重试
          </Button>
        </div>
      ) : null}

      {loading && plugins.length === 0 ? (
        <p className="text-xs text-muted-foreground">加载中…</p>
      ) : plugins.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无插件</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">共 {plugins.length} 个插件</p>
          <ul className="space-y-2">
            {plugins.map((p) => {
              const chips = registeredChips(p.registered)
              return (
                <li key={p.id} className="rounded-lg border p-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{p.name || p.id}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">v{p.version}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  {p.name ? (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{p.id}</div>
                  ) : null}
                  <div
                    className="mt-1 truncate text-xs text-muted-foreground"
                    title={sourceSummary(p.source)}
                  >
                    {sourceSummary(p.source)}
                  </div>
                  {chips.length > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {chips.map((chip) => (
                        <Badge
                          key={chip.key}
                          variant="outline"
                          className="text-[10px] font-normal text-muted-foreground"
                        >
                          {chip.label}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        setForm({
                          mode: "update",
                          pluginId: p.id,
                          pluginName: p.name,
                          initialSource: p.source,
                        })
                      }
                    >
                      <RotateCw className="size-3.5" /> 更新
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={() => {
                        setDeleteError(null)
                        setDeleting(p)
                      }}
                    >
                      <Trash2 className="size-3.5" /> 删除
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <PluginFormDialog
        open={form !== null}
        mode={form?.mode ?? "install"}
        pluginId={form?.pluginId}
        pluginName={form?.pluginName}
        initialSource={form?.initialSource}
        onCancel={() => setForm(null)}
        onSubmit={submitForm}
      />

      <ResponsiveDialog
        open={deleting !== null}
        onOpenChange={(v) => {
          if (!v) setDeleting(null)
        }}
      >
        <ResponsiveDialogContent showCloseButton={false} className="p-5">
          <ResponsiveDialogTitle>删除插件</ResponsiveDialogTitle>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            确定删除「{deleting?.name || deleting?.id}」?其注册的 MCP 服务器、技能、提示词或工作流将一并移除,该操作不可撤销。
          </p>
          {deleteError ? (
            <p className="mt-2 text-xs break-all text-destructive" role="alert">
              {deleteError}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              取消
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void confirmDelete()} disabled={deleteBusy}>
              {deleteBusy ? "删除中…" : "删除"}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
