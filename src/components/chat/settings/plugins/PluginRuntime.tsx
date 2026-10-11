import { uiText, useUiLocale } from "@shared/i18n/ui"
import { ServerStatus, type McpServer } from "@services/mcp"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"

export function PluginRuntime({ ids, servers, confirmed, disabled, onToggle }: {
  ids: string[]
  servers: McpServer[]
  confirmed: boolean
  disabled: boolean
  onToggle: (server: McpServer, enabled: boolean) => void
}) {
  useUiLocale()
  if (!ids.length) return null
  return (
    <div className="mt-3 space-y-2 rounded-lg bg-muted/30 p-3">
      <p className="text-xs font-medium">{uiText("plugin_connections")}</p>
      {!confirmed ? <p className="text-xs text-muted-foreground">{uiText("plugin_connections_unknown")}</p> : null}
      {ids.map((id) => {
        const server = confirmed ? servers.find((item) => item.id === id) : undefined
        const status = server?.runtime?.status
        const label = !server ? uiText("plugin_connection_unknown")
          : !server.enabled ? uiText("disabled_bc5a87a7")
          : status === ServerStatus.Ready ? uiText("plugin_connected")
          : status === ServerStatus.Connecting ? uiText("connecting_a898478b")
          : status === ServerStatus.Error ? uiText("error_0bc1fb72")
          : status === ServerStatus.Degraded ? uiText("plugin_degraded")
          : uiText("stopped_f006455e")
        return (
          <div key={id} className="flex flex-wrap items-center gap-3 text-xs">
            <span className="min-w-0 flex-1 break-all text-muted-foreground">{server?.name || id}</span>
            <Badge variant={status === ServerStatus.Error ? "destructive" : "outline"}>{label}</Badge>
            {server ? <Switch checked={server.enabled} disabled={disabled} aria-label={uiText("plugin_toggle_connection", { name: server.name || id })}
              onCheckedChange={(enabled) => onToggle(server, enabled)} /> : null}
          </div>
        )
      })}
      <p className="text-xs leading-relaxed text-muted-foreground">{uiText("plugin_connection_scope")}</p>
    </div>
  )
}
