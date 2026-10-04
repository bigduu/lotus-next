import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronRight, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react"
import {
  mcpService,
  ServerStatus,
  type McpServer,
  type McpServerConfig,
  type TransportConfig,
} from "@services/mcp"
import {
  isMcpImportReflected,
  McpImportFailure,
  mcpIdsKey,
  previewMcpImport,
} from "@services/mcp/importConfig"
import type { McpImportRequest } from "@services/mcp/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { cn } from "@/lib/utils"
import { McpServerFormDialog, type McpFormMode } from "./mcp/McpServerFormDialog"
import { McpToolList } from "./mcp/McpToolList"
import { McpImportDialog, type McpImportCompletion } from "./mcp/McpImportDialog"

const POLL_MS = 10_000

function transportSummary(t: TransportConfig): string {
  if (t.type === "stdio") {
    return `stdio · ${[t.command, ...t.args].filter(Boolean).join(" ")}`
  }
  return `${t.type === "sse" ? "sse" : "Streamable HTTP"} · ${t.url}`
}

/** Live runtime status — deliberately separate from the config.enabled switch. */
function StatusBadge({ server }: { server: McpServer }) {
  useUiLocale()
  const rt = server.runtime
  const status = rt?.status ?? ServerStatus.Stopped
  switch (status) {
    case ServerStatus.Ready:
      return <Badge variant="success">{uiText("connected_13bc0e73")} {uiText("count_tools", { count: rt?.tool_count ?? 0 })}</Badge>
    case ServerStatus.Connecting:
      return <Badge variant="warning">{uiText("connecting_a898478b")}</Badge>
    case ServerStatus.Degraded:
      return <Badge variant="warning">{uiText("degraded_ab342d36")} {uiText("count_tools", { count: rt?.tool_count ?? 0 })}</Badge>
    case ServerStatus.Error:
      return <Badge variant="destructive">{uiText("error_0bc1fb72")}</Badge>
    case ServerStatus.Stopped:
    default:
      return <Badge variant="outline">{uiText("stopped_f006455e")}</Badge>
  }
}

export function SettingsMcp() {
  useUiLocale()
  const [inventory, setInventory] = useState<{ servers: McpServer[]; confirmed: boolean; revision: number }>({ servers: [], confirmed: false, revision: 0 })
  const { servers, confirmed: listConfirmed, revision: listRevision } = inventory
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<{ mode: McpFormMode; initial: McpServerConfig | null } | null>(
    null,
  )
  const [deleting, setDeleting] = useState<McpServer | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [toolsVersion, setToolsVersion] = useState<Record<string, number>>({})
  const [importOpen, setImportOpen] = useState(false)
  const importTrigger = useRef<HTMLButtonElement>(null)
  const importBusy = useRef(false)
  const readGeneration = useRef(0)
  const readInFlight = useRef<number | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      readGeneration.current += 1
    }
  }, [])

  const reload = useCallback(async (silent = false) => {
    const generation = ++readGeneration.current
    readInFlight.current = generation
    try {
      const list = await mcpService.getServers()
      if (!mountedRef.current || generation !== readGeneration.current) return null
      setInventory((previous) => ({ servers: list, confirmed: true, revision: previous.revision +
        (!previous.confirmed || mcpIdsKey(previous.servers.map((server) => server.id)) !== mcpIdsKey(list.map((server) => server.id)) ? 1 : 0) }))
      setError(null)
      return list
    } catch {
      if (!mountedRef.current || generation !== readGeneration.current) return null
      setInventory((previous) => ({ ...previous, confirmed: false, revision: previous.revision + 1 }))
      // Keep last-known list on silent poll failures; still surface the error.
      if (!silent) setError(uiText("the_mcp_server_list_could_not_be_confirmed_refresh_and__b682cec6"))
      return null
    } finally {
      if (readInFlight.current === generation) readInFlight.current = null
      if (mountedRef.current && generation === readGeneration.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    // Slow reads must finish; explicit/preflight refreshes can still supersede them.
    const timer = window.setInterval(() => { if (!importBusy.current && readInFlight.current === null) void reload(true) }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [reload])

  const markImportedTools = (serverIds: string[]) => {
    if (!mountedRef.current) return
    setToolsVersion((previous) => {
      const next = { ...previous }
      for (const id of serverIds) next[id] = (next[id] ?? 0) + 1
      return next
    })
  }

  const submitImport = async (request: McpImportRequest, expectedIds: string[]): Promise<McpImportCompletion> => {
    if (importBusy.current) throw new McpImportFailure("busy")
    importBusy.current = true
    // Invalidate polls started before this mutation; they cannot restore old rows.
    readGeneration.current += 1
    try {
      if (request.mode === "replace") {
        const current = await reload(true)
        if (!current) throw new McpImportFailure("list_unavailable")
        if (mcpIdsKey(current.map((server) => server.id)) !== mcpIdsKey(expectedIds)) throw new McpImportFailure("list_changed")
      }
      if (!mountedRef.current) throw new McpImportFailure("list_unavailable")
      const result = await mcpService.importServers(request)
      const list = await reload(true)
      markImportedTools(result.server_ids)
      return { result, refreshed: list !== null }
    } catch (failure) {
      const safe = failure instanceof McpImportFailure ? failure : new McpImportFailure("uncertain")
      throw safe
    } finally {
      importBusy.current = false
    }
  }

  const reconcileImport = async (request: McpImportRequest, expectedIds: string[]): Promise<McpImportCompletion> => {
    const current = await reload(true)
    if (!current) throw new McpImportFailure("uncertain")
    if (!isMcpImportReflected(request, current)) throw new McpImportFailure("not_applied")
    const serverIds = Object.keys(request.mcpServers).sort()
    const preview = previewMcpImport(serverIds, expectedIds, request.mode)
    markImportedTools(serverIds)
    return {
      result: {
        mode: request.mode,
        added: preview.added.length,
        updated: preview.updated.length,
        removed: preview.removed.length,
        server_ids: serverIds,
      },
      refreshed: true,
      reconciled: true,
    }
  }

  const setBusy = (id: string, busy: boolean) =>
    setRowBusy((prev) => ({ ...prev, [id]: busy }))

  const toggleEnabled = async (server: McpServer, enabled: boolean) => {
    setBusy(server.id, true)
    try {
      // connect/disconnect persist config.enabled AND start/stop the runtime.
      await (enabled ? mcpService.connectServer(server.id) : mcpService.disconnectServer(server.id))
      setError(null)
    } catch {
      setError(uiText("could_not_change_the_server_s_enabled_state_check_the_a_e8ee44ca"))
    } finally {
      setBusy(server.id, false)
      void reload(true)
    }
  }

  const refreshServer = async (server: McpServer) => {
    setBusy(server.id, true)
    try {
      await mcpService.refreshTools(server.id)
      setToolsVersion((prev) => ({ ...prev, [server.id]: (prev[server.id] ?? 0) + 1 }))
      setError(null)
    } catch {
      setError(uiText("could_not_refresh_server_tools_check_the_server_state_e_9f6d5c48"))
    } finally {
      setBusy(server.id, false)
      void reload(true)
    }
  }

  const submitForm = async (config: McpServerConfig) => {
    // Throws on failure — McpServerFormDialog surfaces the error inline.
    if (form?.mode === "edit") {
      await mcpService.updateServer(config.id, config)
    } else {
      await mcpService.addServer(config)
    }
    setForm(null)
    setToolsVersion((prev) => ({ ...prev, [config.id]: (prev[config.id] ?? 0) + 1 }))
    await reload(true)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await mcpService.deleteServer(deleting.id)
      setDeleting(null)
      await reload(true)
    } catch {
      setDeleteError(uiText("the_delete_result_could_not_be_confirmed_refresh_the_ac_3af86680"))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{uiText("connect_mcp_tool_servers_using_stdio_sse_or_streamable__1a4a9aec")}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" aria-label={uiText("refresh_mcp_list_7e60055b")} onClick={() => { if (!importBusy.current) void reload() }}><RefreshCw className="size-4" /></Button>
          <Button ref={importTrigger} size="sm" variant="secondary" disabled={!listConfirmed || loading} onClick={() => setImportOpen(true)}>
            <Upload className="size-4" />{uiText("import_json_8f6e8682")}</Button>
          <Button size="sm" variant="secondary" onClick={() => setForm({ mode: "create", initial: null })}>
            <Plus className="size-4" />{uiText("add_0006d696")}</Button>
        </div>
      </div>

      {error ? (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs break-all text-destructive"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
      ) : servers.length === 0 ? (
        <p className="text-xs text-muted-foreground">{listConfirmed ? uiText("no_mcp_servers_yet_48ef8b92") : uiText("server_list_unconfirmed_please_refresh_07249978")}</p>
      ) : (
        <ul className="space-y-2">
          {servers.map((s) => {
            const busy = Boolean(rowBusy[s.id])
            const isOpen = Boolean(expanded[s.id])
            const lastError = s.runtime?.last_error
            const showLastError =
              lastError &&
              (s.runtime?.status === ServerStatus.Error ||
                s.runtime?.status === ServerStatus.Degraded)
            return (
              <li key={s.id} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setExpanded((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
                    aria-label={isOpen ? uiText("collapse_tool_list_6bba8d4b") : uiText("expand_tool_list_cc4cd445")}
                    aria-expanded={isOpen}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <ChevronRight
                      className={cn("size-4 transition-transform", isOpen && "rotate-90")}
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{s.name || s.id}</span>
                      <StatusBadge server={s} />
                    </div>
                    <div className="truncate text-xs text-muted-foreground" title={transportSummary(s.config.transport)}>
                      {transportSummary(s.config.transport)}
                    </div>
                  </div>
                  <Switch
                    checked={s.enabled}
                    disabled={busy}
                    onCheckedChange={(checked) => void toggleEnabled(s, checked)}
                    aria-label={s.enabled ? uiText("disable_4e6fd0e2") : uiText("enabled_f4f0ead1")}
                  />
                  <button
                    onClick={() => void refreshServer(s)}
                    disabled={busy || !s.enabled}
                    aria-label={uiText("refresh_tools_6fd87b32")}
                    title={s.enabled ? uiText("reload_tools_551274c1") : uiText("enable_the_server_first_d7458d83")}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
                  </button>
                  <button
                    onClick={() =>
                      setForm({
                        mode: "edit",
                        initial: { ...s.config, name: s.config.name ?? s.name, enabled: s.enabled },
                      })
                    }
                    aria-label={uiText("edit_05183656")}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setDeleteError(null)
                      setDeleting(s)
                    }}
                    aria-label={uiText("delete_2f9daa82")}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                {showLastError ? (
                  <p className="mt-1.5 text-xs text-destructive">{uiText("the_server_is_unhealthy_error_details_are_hidden_to_pro_efc23f19")}</p>
                ) : null}

                {isOpen ? (
                  <div className="mt-2 border-t pt-2">
                    <McpToolList serverId={s.id} version={toolsVersion[s.id] ?? 0} />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {importOpen ? <McpImportDialog existingIds={servers.map((server) => server.id)} listConfirmed={listConfirmed} listRevision={listRevision}
        onClose={() => setImportOpen(false)} onReturnFocus={() => importTrigger.current?.focus()}
        onImport={submitImport} onReconcile={reconcileImport} onReload={async () => (await reload()) !== null} /> : null}

      <McpServerFormDialog
        open={form !== null}
        mode={form?.mode ?? "create"}
        initial={form?.initial}
        existingIds={servers.map((s) => s.id)}
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
          <ResponsiveDialogTitle>{uiText("delete_mcp_server_16db2934")}</ResponsiveDialogTitle>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {uiText("delete_72f49a52")}{deleting?.name || deleting?.id}{uiText("connected_sessions_will_lose_access_to_its_tools_this_c_cab6e03c")}</p>
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
