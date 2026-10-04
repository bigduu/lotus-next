import { uiText, useUiLocale } from "@shared/i18n/ui"
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
  useUiLocale()
  if (status === "installing") {
    return <Badge variant="warning">{uiText("installing_possibly_an_incomplete_installation_ce4290b2")}</Badge>
  }
  return <Badge variant="secondary">{uiText("installed_a8b6c39d")}</Badge>
}

function sourceSummary(source: PluginSourceSpec): string {
  switch (source.type) {
    case "local_dir":
      return uiText("local_directory_9a7b72f1", { v0: source.path })
    case "local_archive":
      return uiText("local_archive_7e17d5f1", { v0: source.path })
    case "url":
      return `URL · ${source.url}`
    default:
      return ""
  }
}

function registeredChips(registered: RegisteredResources): { key: string; label: string }[] {
  const chips: { key: string; label: string }[] = []
  if (registered.mcp_server_ids?.length) {
    chips.push({ key: "mcp", label: uiText("mcp_servers_bf3157a8", { v0: registered.mcp_server_ids.length , count: registered.mcp_server_ids.length }) })
  }
  if (registered.skill_dirs?.length) {
    chips.push({ key: "skills", label: uiText("skills_c576d453", { v0: registered.skill_dirs.length , count: registered.skill_dirs.length }) })
  }
  if (registered.preset_ids?.length) {
    chips.push({ key: "prompts", label: uiText("prompts_b7b44efd", { v0: registered.preset_ids.length , count: registered.preset_ids.length }) })
  }
  if (registered.workflow_filenames?.length) {
    chips.push({ key: "workflows", label: uiText("workflows_a9684d0d", { v0: registered.workflow_filenames.length , count: registered.workflow_filenames.length }) })
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
  useUiLocale()
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
        throw new Error(uiText("already_installed_use_update_a919ad86", { v0: getErrorMessage(e) }))
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
          {uiText("install_update_or_uninstall_plugins_plugins_may_registe_e706479a")}</p>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />{uiText("refresh_aee88743")}</Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setForm({ mode: "install" })}
          >
            <Plus className="size-4" />{uiText("install_plugin_edc3f028")}</Button>
        </div>
      </div>

      {error ? (
        <div
          className="flex items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs break-all text-destructive"
          role="alert"
        >
          <span>{error}</span>
          <Button size="sm" variant="secondary" className="h-7 shrink-0 px-2" onClick={() => void reload()}>
            {uiText("retry_b8784c8d")}</Button>
        </div>
      ) : null}

      {loading && plugins.length === 0 ? (
        <p className="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
      ) : plugins.length === 0 ? (
        <p className="text-xs text-muted-foreground">{uiText("no_plugins_yet_c3e55896")}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{uiText("total_76e547a8")} {plugins.length} {uiText("plugins_07219a59")}</p>
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
                      <RotateCw className="size-3.5" />{uiText("update_3055a035")}</Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={() => {
                        setDeleteError(null)
                        setDeleting(p)
                      }}
                    >
                      <Trash2 className="size-3.5" />{uiText("delete_2f9daa82")}</Button>
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
          <ResponsiveDialogTitle>{uiText("delete_plugin_a0c9ae7e")}</ResponsiveDialogTitle>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {uiText("delete_72f49a52")}{deleting?.name || deleting?.id}{uiText("its_mcp_servers_skills_prompts_and_workflows_will_also__539475bd")}</p>
          {deleteError ? (
            <p className="mt-2 text-xs break-all text-destructive" role="alert">
              {deleteError}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              {uiText("cancel_2cd0f3be")}</Button>
            <Button size="sm" variant="destructive" onClick={() => void confirmDelete()} disabled={deleteBusy}>
              {deleteBusy ? uiText("deleting_5e8e7af5") : uiText("delete_2f9daa82")}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
