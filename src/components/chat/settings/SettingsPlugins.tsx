import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useCallback, useEffect, useRef, useState } from "react"
import { Blocks, Plus, RefreshCw, RotateCw, Trash2 } from "lucide-react"
import {
  pluginService,
  type InstalledPluginView,
  type PluginSourceSpec,
  type PluginStatus,
  type RegisteredResources,
} from "@services/plugin"
import { getErrorMessage, isApiError } from "@services/api"
import { mcpService, type McpServer } from "@services/mcp"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { cn } from "@/lib/utils"
import { PluginFormDialog, type PluginFormMode } from "./plugins/PluginFormDialog"
import { NovaSetupNotice, OfficialPluginCards } from "./plugins/OfficialPluginCards"
import { PluginRuntime } from "./plugins/PluginRuntime"
import { NOVA_PLUGIN } from "./plugins/officialPlugins"

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
  const [tab, setTab] = useState("discover")
  const [confirmed, setConfirmed] = useState(false)
  const [servers, setServers] = useState<McpServer[]>([])
  const [serversConfirmed, setServersConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [operation, setOperation] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [deleting, setDeleting] = useState<InstalledPluginView | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const busyRef = useRef(false)
  const readGeneration = useRef(0)
  const readingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      readGeneration.current += 1
    }
  }, [])

  const reload = useCallback(async (silent = false) => {
    const generation = ++readGeneration.current
    readingRef.current = true
    if (!silent) setLoading(true)
    const [list, runtime] = await Promise.allSettled([
      pluginService.listPlugins(),
      mcpService.getServers(),
    ])
    if (!mountedRef.current || generation !== readGeneration.current) return
    if (list.status === "fulfilled") {
      setPlugins(list.value)
      setConfirmed(true)
      setError(null)
    } else {
      setConfirmed(false)
      setError(uiText("plugin_inventory_unconfirmed"))
    }
    setServersConfirmed(runtime.status === "fulfilled")
    if (runtime.status === "fulfilled") setServers(runtime.value)
    readingRef.current = false
    setLoading(false)
    return list.status === "fulfilled" ? list.value : null
  }, [])

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => {
      if (!busyRef.current && !readingRef.current) void reload(true)
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [reload])

  const beginOperation = (id: string) => {
    if (busyRef.current || !confirmed) return false
    busyRef.current = true
    readGeneration.current += 1
    setOperation(id)
    setActionError(null)
    return true
  }

  const finishOperation = async () => {
    // Reconcile even after a failed response: the backend may have applied it.
    // A late pre-mutation read must never restore the previous inventory.
    const list = await reload(true)
    busyRef.current = false
    if (mountedRef.current) setOperation(null)
    return list
  }

  const installNova = async () => {
    if (!beginOperation("nova-install")) return
    try {
      await pluginService.installPlugin(NOVA_PLUGIN.source)
    } catch {
      if (mountedRef.current) setActionError(uiText("plugin_install_failed"))
    } finally {
      const list = await finishOperation()
      if (mountedRef.current && list) setActionError(list.some((plugin) => plugin.id === NOVA_PLUGIN.id) ? null : uiText("plugin_install_failed"))
    }
  }

  const toggleServer = async (server: McpServer, enabled: boolean) => {
    if (!serversConfirmed || !beginOperation(`mcp:${server.id}`)) return
    try {
      await (enabled ? mcpService.connectServer(server.id) : mcpService.disconnectServer(server.id))
    } catch {
      if (mountedRef.current) setActionError(uiText("plugin_toggle_failed"))
    } finally {
      await finishOperation()
    }
  }

  const submitForm = async (source: PluginSourceSpec) => {
    if (!beginOperation("manual")) throw new Error(uiText("plugin_inventory_unconfirmed"))
    // Throws on failure — PluginFormDialog surfaces the error inline and keeps
    // the dialog open so the user can fix the source and retry.
    try {
      if (form?.mode === "update" && form.pluginId) {
        await pluginService.updatePlugin(form.pluginId, source)
      } else {
        await pluginService.installPlugin(source)
      }
      if (mountedRef.current) {
        setForm(null)
        setTab("installed")
      }
    } catch (e) {
      // 409 = already installed — steer the user toward Update instead of
      // just repeating the raw backend error.
      if (form?.mode === "install" && isApiError(e) && e.status === 409) {
        throw new Error(uiText("already_installed_use_update_a919ad86", { v0: getErrorMessage(e) }))
      }
      throw e
    } finally {
      await finishOperation()
    }
  }

  const confirmDelete = async () => {
    if (!deleting || !beginOperation("delete")) return
    const targetId = deleting.id
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await pluginService.removePlugin(targetId)
    } catch (e) {
      if (mountedRef.current) setDeleteError(getErrorMessage(e))
    } finally {
      const list = await finishOperation()
      if (mountedRef.current) {
        if (list && !list.some((plugin) => plugin.id === targetId)) {
          setDeleting(null)
          setDeleteError(null)
        }
        setDeleteBusy(false)
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{uiText("plugin_center_description")}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => void reload()} disabled={loading || operation !== null} aria-label={uiText("plugin_refresh")}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />{uiText("refresh_aee88743")}</Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setForm({ mode: "install" })}
            disabled={!confirmed || operation !== null}
          >
            <Plus className="size-4" />{uiText("plugin_manual_install")}</Button>
        </div>
      </div>

      {error ? (
        <div
          className="flex items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs break-all text-destructive"
          role="alert"
        >
          <span>{error}</span>
          <Button size="sm" variant="secondary" className="h-7 shrink-0 px-2" onClick={() => void reload()} disabled={loading || operation !== null}>
            {uiText("retry_b8784c8d")}</Button>
        </div>
      ) : null}

      {actionError ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive">{actionError}</p> : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={uiText("plugin_center_views")}>
          <TabsTrigger value="discover">{uiText("plugin_discover")}</TabsTrigger>
          <TabsTrigger value="installed">{uiText("plugin_installed_view")}{confirmed ? <span className="ml-1 text-xs text-muted-foreground">{plugins.length}</span> : null}</TabsTrigger>
        </TabsList>
        <TabsContent value="discover" className="pt-2">
          <OfficialPluginCards nova={plugins.find((plugin) => plugin.id === NOVA_PLUGIN.id)} installing={operation === "nova-install"}
            disabled={!confirmed || operation !== null} onInstallNova={() => void installNova()} onManageNova={() => setTab("installed")} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{uiText("plugin_install_location")}</p>
        </TabsContent>
        <TabsContent value="installed" className="pt-2">

          {loading && plugins.length === 0 ? (
            <p className="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
          ) : confirmed && plugins.length === 0 ? (
            <div className="rounded-xl border border-dashed px-5 py-8 text-center">
              <Blocks className="mx-auto mb-3 size-6 text-muted-foreground" />
              <p className="text-sm font-medium">{uiText("no_plugins_yet_c3e55896")}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{uiText("plugin_empty_hint")}</p>
              <Button size="sm" variant="secondary" className="mt-4" onClick={() => setTab("discover")}>{uiText("plugin_discover")}</Button>
            </div>
          ) : !confirmed && plugins.length === 0 ? null : (
            <>
              <p className="text-xs text-muted-foreground">{uiText("total_76e547a8")} {plugins.length} {uiText("plugins_07219a59")}</p>
              <ul className="space-y-2">
                {plugins.map((p) => {
                  const chips = registeredChips(p.registered)
                  return (
                    <li key={p.id} className="rounded-xl border bg-card p-4" aria-label={p.name || p.id}>
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 break-words text-sm font-medium">{p.name || p.id}</span>
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
                      <PluginRuntime ids={p.registered.mcp_server_ids ?? []} servers={servers} confirmed={serversConfirmed}
                        disabled={!confirmed || operation !== null || p.status === "installing"} onToggle={(server, enabled) => void toggleServer(server, enabled)} />
                      {p.id === NOVA_PLUGIN.id ? <div className="mt-3"><NovaSetupNotice /></div> : null}
                      <div className="mt-2 flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 px-2 text-xs"
                          disabled={!confirmed || operation !== null || p.status === "installing"}
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
                          disabled={!confirmed || operation !== null}
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
        </TabsContent>
      </Tabs>

      <PluginFormDialog
        open={form !== null}
        mode={form?.mode ?? "install"}
        pluginId={form?.pluginId}
        pluginName={form?.pluginName}
        initialSource={form?.initialSource}
        onCancel={() => { if (!busyRef.current) setForm(null) }}
        onSubmit={submitForm}
      />

      <ResponsiveDialog
        open={deleting !== null}
        onOpenChange={(v) => {
          if (!v && !busyRef.current) setDeleting(null)
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
            <Button size="sm" variant="destructive" onClick={() => void confirmDelete()} disabled={deleteBusy || !confirmed}>
              {deleteBusy ? uiText("deleting_5e8e7af5") : uiText("delete_2f9daa82")}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
