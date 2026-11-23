import { createSignal, For, Match, onSettled, Show, Switch as Conditions } from "solid-js"
import { ChevronRight, Pencil, Plus, RefreshCw, Trash2, Upload } from "@lucide/solid"
import { mcpService, ServerStatus, type McpActionResponse, type McpServer, type McpServerConfig, type TransportConfig } from "@services/mcp"
import { isMcpImportReflected, McpImportFailure, mcpIdsKey, previewMcpImport } from "@services/mcp/importConfig"
import type { McpImportRequest } from "@services/mcp/types"
import { cn } from "@/lib/utils"
import { createUiText } from "../../shell/uiText"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import { Switch } from "../../ui/switch"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogTitle } from "../../ui/responsive-dialog"
import { McpImportDialog, type McpImportCompletion } from "./McpImportDialog"
import { McpServerFormDialog, type McpFormMode } from "./McpServerFormDialog"
import { McpToolList } from "./McpToolList"

const POLL_MS = 10_000
type Inventory = { servers: McpServer[]; confirmed: boolean; revision: number }
type Form = { mode: McpFormMode; initial: McpServerConfig | null }
let mutationInFlight = false

function transportSummary(transport: TransportConfig): string {
  if (transport.type === "stdio") return `stdio · ${[transport.command, ...transport.args].filter(Boolean).join(" ")}`
  try {
    const url = new URL(transport.url)
    return `Streamable HTTP · ${url.origin}${url.pathname}`
  } catch {
    return "Streamable HTTP"
  }
}

function StatusBadge(props: { server: McpServer }) {
  const text = createUiText()
  const status = () => props.server.runtime?.status ?? ServerStatus.Stopped
  const toolCount = () => text("count_tools", { count: props.server.runtime?.tool_count ?? 0 })
  return (
    <Conditions fallback={<Badge variant="outline">{text("stopped_f006455e")}</Badge>}>
      <Match when={status() === ServerStatus.Ready}>
        <Badge variant="success">{text("connected_13bc0e73")} {toolCount()}</Badge>
      </Match>
      <Match when={status() === ServerStatus.Connecting}>
        <Badge variant="warning">{text("connecting_a898478b")}</Badge>
      </Match>
      <Match when={status() === ServerStatus.Degraded}>
        <Badge variant="warning">{text("degraded_ab342d36")} {toolCount()}</Badge>
      </Match>
      <Match when={status() === ServerStatus.Error}>
        <Badge variant="destructive">{text("error_0bc1fb72")}</Badge>
      </Match>
    </Conditions>
  )
}

function confirmedMutation(id: string, result: McpActionResponse) {
  if (result?.server_id !== id || result.error) throw new Error("Unconfirmed MCP server mutation")
}

export function SettingsMcp() {
  const text = createUiText()
  const [inventory, setInventory] = createSignal<Inventory>({ servers: [], confirmed: false, revision: 0 })
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [form, setForm] = createSignal<Form | null>(null)
  const [deleting, setDeleting] = createSignal<McpServer | null>(null)
  const [deleteBusy, setDeleteBusy] = createSignal(false)
  const [deleteError, setDeleteError] = createSignal<string | null>(null)
  const [rowBusy, setRowBusy] = createSignal<string | null>(null)
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})
  const [toolsVersion, setToolsVersion] = createSignal<Record<string, number>>({})
  const [importOpen, setImportOpen] = createSignal(false)
  const [writing, setWriting] = createSignal(false)
  let importTrigger: HTMLButtonElement | undefined
  let readGeneration = 0
  let readInFlight: number | null = null
  let mounted = true

  const ids = () => inventory().servers.map((server) => server.id)
  const reload = async (silent = false): Promise<McpServer[] | null> => {
    const generation = ++readGeneration
    readInFlight = generation
    try {
      const list = await mcpService.getServers()
      if (!mounted || generation !== readGeneration) return null
      setInventory((previous) => ({
        servers: list,
        confirmed: true,
        revision: previous.revision + Number(!previous.confirmed ||
          mcpIdsKey(previous.servers.map((server) => server.id)) !== mcpIdsKey(list.map((server) => server.id))),
      }))
      setError(null)
      return list
    } catch {
      if (!mounted || generation !== readGeneration) return null
      setInventory((previous) => ({ ...previous, confirmed: false, revision: previous.revision + 1 }))
      if (!silent) setError(text("the_mcp_server_list_could_not_be_confirmed_refresh_and__b682cec6"))
      return null
    } finally {
      if (generation === readInFlight) readInFlight = null
      if (mounted && generation === readGeneration) setLoading(false)
    }
  }

  onSettled(() => {
    void reload()
    const timer = window.setInterval(() => {
      if (!mutationInFlight && readInFlight === null) void reload(true)
    }, POLL_MS)
    return () => {
      mounted = false
      ++readGeneration
      window.clearInterval(timer)
    }
  })

  const takeMutation = () => {
    if (mutationInFlight || !mounted) return false
    mutationInFlight = true
    ++readGeneration
    setWriting(true)
    return true
  }
  const finishMutation = () => {
    mutationInFlight = false
    if (mounted) setWriting(false)
  }
  const refreshToolVersions = (serverIds: string[]) => {
    if (!mounted) return
    setToolsVersion((previous) => {
      const next = { ...previous }
      for (const id of serverIds) next[id] = (next[id] ?? 0) + 1
      return next
    })
  }

  const submitImport = async (request: McpImportRequest, expectedIds: string[]): Promise<McpImportCompletion> => {
    if (!takeMutation()) throw new McpImportFailure("busy")
    try {
      if (request.mode === "replace") {
        const current = await reload(true)
        if (!current) throw new McpImportFailure("list_unavailable")
        if (mcpIdsKey(current.map((server) => server.id)) !== mcpIdsKey(expectedIds)) throw new McpImportFailure("list_changed")
      }
      if (!mounted) throw new McpImportFailure("list_unavailable")
      const result = await mcpService.importServers(request)
      const list = await reload(true)
      refreshToolVersions(result.server_ids)
      return { result, refreshed: list !== null }
    } catch (failure) {
      throw failure instanceof McpImportFailure ? failure : new McpImportFailure("uncertain")
    } finally {
      finishMutation()
    }
  }

  const reconcileImport = async (request: McpImportRequest, expectedIds: string[]): Promise<McpImportCompletion> => {
    if (!takeMutation()) throw new McpImportFailure("busy")
    try {
      const current = await reload(true)
      if (!current) throw new McpImportFailure("uncertain")
      if (!isMcpImportReflected(request, current)) throw new McpImportFailure("not_applied")
      const serverIds = Object.keys(request.mcpServers).sort()
      const preview = previewMcpImport(serverIds, expectedIds, request.mode)
      refreshToolVersions(serverIds)
      return {
        result: { mode: request.mode, added: preview.added.length, updated: preview.updated.length, removed: preview.removed.length, server_ids: serverIds },
        refreshed: true, reconciled: true,
      }
    } finally {
      finishMutation()
    }
  }

  const rowMutation = async (server: McpServer, action: "enable" | "disable" | "refresh") => {
    if (importOpen() || form() || deleting() || !takeMutation()) return
    const id = server.id
    setRowBusy(id)
    let failed = false
    try {
      if (action === "refresh") {
        confirmedMutation(id, await mcpService.refreshTools(id))
        refreshToolVersions([id])
      } else {
        confirmedMutation(id, await (action === "enable" ? mcpService.connectServer(id) : mcpService.disconnectServer(id)))
      }
    } catch {
      failed = true
    } finally {
      if (mounted) {
        await reload(true)
        if (mounted) {
          setRowBusy(null)
          if (failed) setError(text(action === "refresh" ? "could_not_refresh_server_tools_check_the_server_state_e_9f6d5c48"
            : "could_not_change_the_server_s_enabled_state_check_the_a_e8ee44ca"))
        }
      }
      finishMutation()
    }
  }

  const submitForm = async (config: McpServerConfig) => {
    const target = form()
    if (!target || !takeMutation()) throw new Error("MCP server settings are busy")
    try {
      const current = await reload(true)
      if (!current || !mounted) throw new Error("Unconfirmed MCP server list")
      const existing = current.some((server) => server.id === config.id)
      if (target.mode === "edit") {
        if (!existing || target.initial?.id !== config.id) throw new Error("MCP server changed")
        confirmedMutation(config.id, await mcpService.updateServer(config.id, config))
      } else {
        if (existing) throw new Error("MCP server already exists")
        confirmedMutation(config.id, await mcpService.addServer(config))
      }
      if (!mounted) return
      setForm(null)
      refreshToolVersions([config.id])
      await reload(true)
    } finally {
      finishMutation()
    }
  }

  const confirmDelete = async () => {
    const target = deleting()
    if (!target || !takeMutation()) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      confirmedMutation(target.id, await mcpService.deleteServer(target.id))
      if (!mounted) return
      setDeleting(null)
      await reload(true)
    } catch {
      if (mounted) setDeleteError(text("the_delete_result_could_not_be_confirmed_refresh_the_ac_3af86680"))
    } finally {
      if (mounted) setDeleteBusy(false)
      finishMutation()
    }
  }
  const closeDelete = () => { if (!mutationInFlight) setDeleting(null) }

  return (
    <div class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-muted-foreground">{text("connect_mcp_tool_servers_using_stdio_sse_or_streamable__1a4a9aec")}</p>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" aria-label={text("refresh_mcp_list_7e60055b")}
            onClick={() => { if (!mutationInFlight) void reload() }}><RefreshCw class="size-4" /></Button>
          <Button ref={(element) => { importTrigger = element }} size="sm" variant="secondary"
            disabled={!inventory().confirmed || loading() || writing()} onClick={() => setImportOpen(true)}>
            <Upload class="size-4" />{text("import_json_8f6e8682")}
          </Button>
          <Button size="sm" variant="secondary" disabled={!inventory().confirmed || writing()}
            onClick={() => setForm({ mode: "create", initial: null })}><Plus class="size-4" />{text("add_0006d696")}</Button>
        </div>
      </div>
      <Show when={error()}>
        <div class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs break-all text-destructive" role="alert">{error()}</div>
      </Show>
      <Conditions>
        <Match when={loading()}><p role="status" class="text-xs text-muted-foreground">{text("loading_4927a53b")}</p></Match>
        <Match when={inventory().servers.length === 0}>
          <p class="text-xs text-muted-foreground">{text(inventory().confirmed ? "no_mcp_servers_yet_48ef8b92" : "server_list_unconfirmed_please_refresh_07249978")}</p>
        </Match>
        <Match when={true}>
          <ul class="space-y-2">
            <For each={inventory().servers} keyed={(server: McpServer) => server.id}>
              {(server) => {
                const isOpen = () => Boolean(expanded()[server().id])
                const title = () => transportSummary(server().config.transport)
                const showLastError = () => {
                  const runtime = server().runtime
                  return runtime?.last_error && (runtime.status === ServerStatus.Error || runtime.status === ServerStatus.Degraded)
                }
                const controlsLocked = () => writing() || !inventory().confirmed || importOpen() || Boolean(form() || deleting())
                return (
                  <li class="rounded-lg border p-3">
                    <div class="flex items-center gap-2">
                      <button type="button" onClick={() => {
                        const id = server().id
                        setExpanded((previous) => ({ ...previous, [id]: !previous[id] }))
                      }}
                        aria-label={text(isOpen() ? "collapse_tool_list_6bba8d4b" : "expand_tool_list_cc4cd445")}
                        aria-expanded={isOpen() ? "true" : "false"}
                        class="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground">
                        <ChevronRight class={cn("size-4 transition-transform", isOpen() && "rotate-90")} />
                      </button>
                      <div class="min-w-0 flex-1">
                        <div class="flex min-w-0 items-center gap-2">
                          <span class="truncate text-sm font-medium">{server().name || server().id}</span>
                          <StatusBadge server={server()} />
                        </div>
                        <div class="truncate text-xs text-muted-foreground" title={title()}>{title()}</div>
                      </div>
                      <Switch checked={server().enabled} disabled={controlsLocked()}
                        aria-label={text(server().enabled ? "disable_4e6fd0e2" : "enable_action")}
                        onCheckedChange={(enabled) => { void rowMutation(server(), enabled ? "enable" : "disable") }} />
                      <button type="button" onClick={() => void rowMutation(server(), "refresh")}
                        disabled={controlsLocked() || !server().enabled} aria-label={text("refresh_tools_6fd87b32")}
                        title={text(server().enabled ? "reload_tools_551274c1" : "enable_the_server_first_d7458d83")}
                        class="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40">
                        <RefreshCw class={cn("size-3.5", rowBusy() === server().id && "animate-spin")} />
                      </button>
                      <button type="button" disabled={controlsLocked()}
                        onClick={() => {
                          const current = server()
                          setForm({ mode: "edit", initial: { ...current.config, name: current.config.name ?? current.name, enabled: current.enabled } })
                        }}
                        aria-label={text("edit_05183656")} class="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40">
                        <Pencil class="size-3.5" />
                      </button>
                      <button type="button" disabled={controlsLocked()}
                        onClick={() => { setDeleteError(null); setDeleting(server()) }}
                        aria-label={text("delete_2f9daa82")} class="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-40">
                        <Trash2 class="size-3.5" />
                      </button>
                    </div>
                    <Show when={showLastError()}>
                      <p class="mt-1.5 text-xs text-destructive">{text("the_server_is_unhealthy_error_details_are_hidden_to_pro_efc23f19")}</p>
                    </Show>
                    <Show when={isOpen()}>
                      <div class="mt-2 border-t pt-2"><McpToolList serverId={server().id} version={toolsVersion()[server().id] ?? 0} /></div>
                    </Show>
                  </li>
                )
              }}
            </For>
          </ul>
        </Match>
      </Conditions>

      <Show when={importOpen()}>
        <McpImportDialog existingIds={ids()} listConfirmed={inventory().confirmed} listRevision={inventory().revision}
          onClose={() => setImportOpen(false)} onReturnFocus={() => importTrigger?.focus()}
          onImport={submitImport} onReconcile={reconcileImport} onReload={async () => (await reload()) !== null} />
      </Show>
      <Show when={form()} keyed>
        {(target) => <McpServerFormDialog mode={target.mode} initial={target.initial} existingIds={ids()}
          onCancel={() => setForm(null)} onSubmit={submitForm} />}
      </Show>
      <Show when={deleting()} keyed>
        {(target) => <ResponsiveDialog open onOpenChange={(open) => { if (!open) closeDelete() }}>
          <ResponsiveDialogContent showCloseButton={false} dismissable={!deleteBusy()} class="p-5">
            <ResponsiveDialogTitle>{text("delete_mcp_server_16db2934")}</ResponsiveDialogTitle>
            <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
              {text("delete_72f49a52")}{target.name || target.id}{text("connected_sessions_will_lose_access_to_its_tools_this_c_cab6e03c")}
            </p>
            <Show when={deleteError()}><p class="mt-2 text-xs break-all text-destructive" role="alert">{deleteError()}</p></Show>
            <div class="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={closeDelete} disabled={deleteBusy()}>{text("cancel_2cd0f3be")}</Button>
              <Button size="sm" variant="destructive" onClick={() => void confirmDelete()} disabled={deleteBusy()}>
                {text(deleteBusy() ? "deleting_5e8e7af5" : "delete_2f9daa82")}
              </Button>
            </div>
          </ResponsiveDialogContent>
        </ResponsiveDialog>}
      </Show>
    </div>
  )
}
