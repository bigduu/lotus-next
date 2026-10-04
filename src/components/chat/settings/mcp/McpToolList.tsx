import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useState } from "react"
import { mcpService, type McpToolInfo } from "@services/mcp"
import { getErrorMessage } from "@services/api"

/**
 * Expandable per-server tool list: name + description, with an optional
 * plain <pre> schema block per tool. Reloads whenever `version` bumps
 * (parent increments it after a tools refresh).
 */
export function McpToolList({ serverId, version }: { serverId: string; version: number }) {
  useUiLocale()
  const [tools, setTools] = useState<McpToolInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    mcpService
      .getTools(serverId)
      .then((t) => {
        if (!cancelled) setTools(t)
      })
      .catch((e) => {
        if (!cancelled) {
          setTools([])
          setError(getErrorMessage(e))
        }
      })
    return () => {
      cancelled = true
    }
  }, [serverId, version])

  if (error) {
    return (
      <p className="text-xs break-all text-destructive" role="alert">
        {uiText("could_not_load_tools_7cf37d72")}{error}
      </p>
    )
  }
  if (tools === null) {
    return <p className="text-xs text-muted-foreground">{uiText("loading_tools_3ab9b8bc")}</p>
  }
  if (tools.length === 0) {
    return <p className="text-xs text-muted-foreground">{uiText("this_server_exposes_no_tools_ca0d2452")}</p>
  }

  return (
    <ul className="space-y-1.5">
      {tools.map((t) => (
        <li key={t.alias} className="rounded-md border bg-muted/30 p-2">
          <div className="font-mono text-xs font-medium break-all">{t.original_name}</div>
          {t.description ? (
            <div className="mt-0.5 text-xs whitespace-pre-wrap text-muted-foreground">
              {t.description}
            </div>
          ) : null}
          {t.parameters != null ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-muted-foreground select-none">
                {uiText("argument_schema_50a739a9")}</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-[11px] leading-relaxed">
                {JSON.stringify(t.parameters, null, 2)}
              </pre>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
