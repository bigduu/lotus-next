import { useEffect, useState } from "react"
import { Trash2, Plus, Plug, PlugZap } from "lucide-react"
import { mcpService, createDefaultMcpServerConfig, type McpServer } from "@services/mcp"
import { Button } from "@/components/ui/button"

const input =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

function runtimeStatus(s: McpServer): string {
  const r = s.runtime as { status?: string; tool_count?: number } | undefined
  return r?.status ?? (s.enabled ? "已启用" : "已停用")
}

export function SettingsMcp() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [kind, setKind] = useState<"stdio" | "sse">("stdio")
  const [command, setCommand] = useState("")
  const [args, setArgs] = useState("")
  const [url, setUrl] = useState("")

  const reload = () => {
    mcpService
      .getServers()
      .then(setServers)
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  const add = async () => {
    if (!name.trim()) return
    const id = crypto.randomUUID()
    const cfg = createDefaultMcpServerConfig(id)
    cfg.name = name.trim()
    cfg.transport =
      kind === "stdio"
        ? { type: "stdio", command: command.trim(), args: args.trim() ? args.trim().split(/\s+/) : [], env: {} }
        : { type: "sse", url: url.trim(), headers: [] }
    await mcpService.addServer(cfg).catch(() => {})
    setAdding(false)
    setName("")
    setCommand("")
    setArgs("")
    setUrl("")
    reload()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">连接 MCP 工具服务器(stdio 或 SSE)。</p>
        {!adding ? (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> 新增
          </Button>
        ) : null}
      </div>

      {adding ? (
        <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
          <input className={input} placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-2">
            {(["stdio", "sse"] as const).map((k) => (
              <Button key={k} size="sm" variant={kind === k ? "default" : "secondary"} className="flex-1" onClick={() => setKind(k)}>
                {k}
              </Button>
            ))}
          </div>
          {kind === "stdio" ? (
            <>
              <input className={input} placeholder="命令(如 npx)" value={command} onChange={(e) => setCommand(e.target.value)} />
              <input className={input} placeholder="参数(空格分隔)" value={args} onChange={(e) => setArgs(e.target.value)} />
            </>
          ) : (
            <input className={input} placeholder="SSE URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAdding(false)}>
              取消
            </Button>
            <Button size="sm" onClick={add} disabled={!name.trim()}>
              添加
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-xs text-muted-foreground">加载中…</p>
      ) : servers.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无 MCP 服务器</p>
      ) : (
        <ul className="space-y-2">
          {servers.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.name || s.id}</div>
                <div className="text-xs text-muted-foreground">{runtimeStatus(s)}</div>
              </div>
              <button
                onClick={async () => {
                  await (s.enabled ? mcpService.disconnectServer(s.id) : mcpService.connectServer(s.id)).catch(() => {})
                  reload()
                }}
                aria-label={s.enabled ? "停用" : "启用"}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                {s.enabled ? <PlugZap className="size-4 text-primary" /> : <Plug className="size-4" />}
              </button>
              <button
                onClick={async () => {
                  await mcpService.deleteServer(s.id).catch(() => {})
                  reload()
                }}
                aria-label="删除"
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
