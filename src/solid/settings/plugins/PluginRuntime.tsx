import { createMemo, For, Show } from "solid-js"
import { createUiText } from "../../shell/uiText"
import { ServerStatus, type McpServer } from "@services/mcp"
import { Badge } from "../../ui/badge"
import { Switch } from "../../ui/switch"

export function PluginRuntime(props: {
  ids: string[]
  servers: McpServer[]
  confirmed: boolean
  disabled: boolean
  onToggle: (server: McpServer, enabled: boolean) => void
}) {
  const uiText = createUiText()
  return (
    <Show when={props.ids.length}><div class="mt-3 space-y-2 rounded-lg bg-muted/30 p-3">
      <p class="text-xs font-medium">{uiText("plugin_connections")}</p>
      {!props.confirmed ? <p class="text-xs text-muted-foreground">{uiText("plugin_connections_unknown")}</p> : null}
      <For each={props.ids}>{(id) => {
        const server = createMemo(() => props.confirmed ? props.servers.find((item) => item.id === id) : undefined)
        const status = () => server()?.runtime?.status
        const label = () => !server() ? uiText("plugin_connection_unknown")
          : !server()?.enabled ? uiText("disabled_bc5a87a7")
          : status() === ServerStatus.Ready ? uiText("plugin_connected")
          : status() === ServerStatus.Connecting ? uiText("connecting_a898478b")
          : status() === ServerStatus.Error ? uiText("error_0bc1fb72")
          : status() === ServerStatus.Degraded ? uiText("plugin_degraded")
          : uiText("stopped_f006455e")
        return (
          <div class="flex flex-wrap items-center gap-3 text-xs">
            <span class="min-w-0 flex-1 break-all text-muted-foreground">{server()?.name || id}</span>
            <Badge variant={status() === ServerStatus.Error ? "destructive" : "outline"}>{label()}</Badge>
            <Show when={server()}>{(current) => <Switch checked={current().enabled} disabled={props.disabled}
              aria-label={uiText("plugin_toggle_connection", { name: current().name || id })}
              onCheckedChange={(enabled) => props.onToggle(current(), enabled)} />}</Show>
          </div>
        )
      }}</For>
      <p class="text-xs leading-relaxed text-muted-foreground">{uiText("plugin_connection_scope")}</p>
    </div></Show>
  )
}
