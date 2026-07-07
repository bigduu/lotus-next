import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronRight, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import {
  mcpService,
  ServerStatus,
  type McpServer,
  type McpServerConfig,
  type TransportConfig,
} from "@services/mcp"
import { getErrorMessage } from "@services/api"
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

const POLL_MS = 10_000

function transportSummary(t: TransportConfig): string {
  if (t.type === "stdio") {
    return `stdio · ${[t.command, ...t.args].filter(Boolean).join(" ")}`
  }
  return `sse · ${t.url}`
}

/** Live runtime status — deliberately separate from the config.enabled switch. */
function StatusBadge({ server }: { server: McpServer }) {
  const rt = server.runtime
  const status = rt?.status ?? ServerStatus.Stopped
  switch (status) {
    case ServerStatus.Ready:
      return <Badge variant="success">已连接 · {rt?.tool_count ?? 0} 工具</Badge>
    case ServerStatus.Connecting:
      return <Badge variant="warning">连接中</Badge>
    case ServerStatus.Degraded:
      return <Badge variant="warning">降级 · {rt?.tool_count ?? 0} 工具</Badge>
    case ServerStatus.Error:
      return <Badge variant="destructive">错误</Badge>
    case ServerStatus.Stopped:
    default:
      return <Badge variant="outline">已停止</Badge>
  }
}

export function SettingsMcp() {
  const [servers, setServers] = useState<McpServer[]>([])
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
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const reload = useCallback(async (silent = false) => {
    try {
      const list = await mcpService.getServers()
      if (!mountedRef.current) return
      setServers(list)
      setError(null)
    } catch (e) {
      if (!mountedRef.current) return
      // Keep last-known list on silent poll failures; still surface the error.
      if (!silent) setError(getErrorMessage(e))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => void reload(true), POLL_MS)
    return () => window.clearInterval(timer)
  }, [reload])

  const setBusy = (id: string, busy: boolean) =>
    setRowBusy((prev) => ({ ...prev, [id]: busy }))

  const toggleEnabled = async (server: McpServer, enabled: boolean) => {
    setBusy(server.id, true)
    try {
      // connect/disconnect persist config.enabled AND start/stop the runtime.
      await (enabled ? mcpService.connectServer(server.id) : mcpService.disconnectServer(server.id))
      setError(null)
    } catch (e) {
      setError(`${server.name || server.id}: ${getErrorMessage(e)}`)
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
    } catch (e) {
      setError(`${server.name || server.id}: ${getErrorMessage(e)}`)
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
    } catch (e) {
      setDeleteError(getErrorMessage(e))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">连接 MCP 工具服务器(stdio 或 SSE)。</p>
        <Button size="sm" variant="secondary" onClick={() => setForm({ mode: "create", initial: null })}>
          <Plus className="size-4" /> 新增
        </Button>
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
        <p className="text-xs text-muted-foreground">加载中…</p>
      ) : servers.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无 MCP 服务器</p>
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
                    aria-label={isOpen ? "收起工具列表" : "展开工具列表"}
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
                    aria-label={s.enabled ? "停用" : "启用"}
                  />
                  <button
                    onClick={() => void refreshServer(s)}
                    disabled={busy || !s.enabled}
                    aria-label="刷新工具"
                    title={s.enabled ? "刷新工具列表" : "先启用服务器"}
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
                    aria-label="编辑"
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setDeleteError(null)
                      setDeleting(s)
                    }}
                    aria-label="删除"
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                {showLastError ? (
                  <p className="mt-1.5 text-xs break-all text-destructive">{lastError}</p>
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
          <ResponsiveDialogTitle>删除 MCP 服务器</ResponsiveDialogTitle>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            确定删除「{deleting?.name || deleting?.id}」?已连接的会话将无法再使用其工具,该操作不可撤销。
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
