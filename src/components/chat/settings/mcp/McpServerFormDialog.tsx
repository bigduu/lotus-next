import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useState } from "react"
import { Plus, X } from "lucide-react"
import {
  createDefaultMcpServerConfig,
  DEFAULT_HTTP_CONNECT_TIMEOUT_MS,
  DEFAULT_STDIO_STARTUP_TIMEOUT_MS,
  type McpServerConfig,
  type TransportConfig,
} from "@services/mcp"
import { MCP_SERVER_ID_PATTERN } from "@services/mcp/types"
import { getErrorMessage } from "@services/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"

export type McpFormMode = "create" | "edit"

interface KvEntry {
  k: string
  v: string
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  useUiLocale()
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function KeyValueEditor({
  title,
  addLabel,
  keyPlaceholder,
  valuePlaceholder,
  entries,
  onChange,
}: {
  title: string
  addLabel: string
  keyPlaceholder: string
  valuePlaceholder: string
  entries: KvEntry[]
  onChange: (entries: KvEntry[]) => void
}) {
  useUiLocale()
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 px-2 text-xs"
          onClick={() => onChange([...entries, { k: "", v: "" }])}
        >
          <Plus className="size-3.5" /> {addLabel}
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">{uiText("none_484d5561")}</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                className="h-8 flex-1 font-mono text-xs"
                placeholder={keyPlaceholder}
                value={entry.k}
                onChange={(e) =>
                  onChange(entries.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))
                }
              />
              <Input
                className="h-8 flex-1 font-mono text-xs"
                placeholder={valuePlaceholder}
                value={entry.v}
                onChange={(e) =>
                  onChange(entries.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))
                }
              />
              <button
                type="button"
                onClick={() => onChange(entries.filter((_, j) => j !== i))}
                aria-label={uiText("remove_6135d415")}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function McpServerFormDialog({
  open,
  mode,
  initial,
  existingIds,
  onCancel,
  onSubmit,
}: {
  open: boolean
  mode: McpFormMode
  /** Config to edit (mode="edit"); ignored for create. */
  initial?: McpServerConfig | null
  /** Used to reject duplicate ids on create (backend silently overwrites). */
  existingIds: string[]
  onCancel: () => void
  /** Should throw on failure — the error is surfaced inline in the dialog. */
  onSubmit: (config: McpServerConfig) => Promise<void>
}) {
  useUiLocale()
  const [id, setId] = useState("")
  const [name, setName] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [kind, setKind] = useState<TransportConfig["type"]>("stdio")
  const [command, setCommand] = useState("")
  const [argsText, setArgsText] = useState("")
  const [cwd, setCwd] = useState("")
  const [envEntries, setEnvEntries] = useState<KvEntry[]>([])
  const [url, setUrl] = useState("")
  const [headerEntries, setHeaderEntries] = useState<KvEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const cfg = mode === "edit" && initial ? initial : null
    setId(cfg?.id ?? "")
    setName(cfg?.name ?? "")
    setEnabled(cfg?.enabled ?? true)
    const t = cfg?.transport
    setKind(t?.type ?? "stdio")
    setCommand(t?.type === "stdio" ? t.command : "")
    setArgsText(t?.type === "stdio" ? t.args.join("\n") : "")
    setCwd(t?.type === "stdio" ? (t.cwd ?? "") : "")
    setEnvEntries(
      t?.type === "stdio" ? Object.entries(t.env ?? {}).map(([k, v]) => ({ k, v })) : [],
    )
    setUrl(t && t.type !== "stdio" ? t.url : "")
    setHeaderEntries(
      t && t.type !== "stdio" ? t.headers.map((h) => ({ k: h.name, v: h.value })) : [],
    )
    setError(null)
    setBusy(false)
  }, [open, mode, initial])

  const validate = (): string | null => {
    if (mode === "create") {
      if (!id.trim()) return uiText("server_id_is_required_ce4bc4a2")
      if (!MCP_SERVER_ID_PATTERN.test(id.trim())) return uiText("server_ids_may_contain_only_letters_digits_and_15c859fe")
      if (existingIds.includes(id.trim())) return uiText("this_server_id_already_exists_e06921d5")
    }
    if (kind === "stdio") {
      if (!command.trim()) return uiText("command_is_required_eddb4f63")
    } else {
      if (!url.trim()) return uiText("url_is_required_b0a85a80")
      try {
        new URL(url.trim())
      } catch {
        return uiText("invalid_url_format_aed7aaa6")
      }
    }
    return null
  }

  const buildConfig = (): McpServerConfig => {
    const serverId = mode === "edit" && initial ? initial.id : id.trim()
    // Preserve fields the form doesn't expose (timeouts, tool allow/deny, reconnect).
    const base = mode === "edit" && initial ? initial : createDefaultMcpServerConfig(serverId)
    const transport: TransportConfig =
      kind === "stdio"
        ? {
            type: "stdio",
            command: command.trim(),
            args: argsText
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
            cwd: cwd.trim() ? cwd.trim() : undefined,
            env: envEntries.reduce<Record<string, string>>((acc, e) => {
              if (e.k.trim()) acc[e.k.trim()] = e.v
              return acc
            }, {}),
            startup_timeout_ms:
              initial?.transport.type === "stdio"
                ? (initial.transport.startup_timeout_ms ?? DEFAULT_STDIO_STARTUP_TIMEOUT_MS)
                : DEFAULT_STDIO_STARTUP_TIMEOUT_MS,
          }
        : {
            type: kind,
            url: url.trim(),
            headers: headerEntries
              .filter((e) => e.k.trim())
              .map((e) => ({ name: e.k.trim(), value: e.v })),
            connect_timeout_ms:
              initial && initial.transport.type !== "stdio"
                ? (initial.transport.connect_timeout_ms ?? DEFAULT_HTTP_CONNECT_TIMEOUT_MS)
                : DEFAULT_HTTP_CONNECT_TIMEOUT_MS,
          }
    return {
      ...base,
      id: serverId,
      name: name.trim() || undefined,
      enabled,
      transport,
    }
  }

  const save = async () => {
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(buildConfig())
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel()
      }}
    >
      <ResponsiveDialogContent className="sm:max-w-lg">
        <div className="border-b px-4 py-3.5">
          <ResponsiveDialogTitle>
            {mode === "edit" ? uiText("edit_mcp_server_d9bc88f2") : uiText("add_mcp_server_f4b0e747")}
          </ResponsiveDialogTitle>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <Field label={uiText("server_id_2964b36b")}>
            <Input
              placeholder="filesystem"
              value={id}
              disabled={mode === "edit"}
              autoComplete="off"
              onChange={(e) => setId(e.target.value)}
            />
          </Field>

          <Field label={uiText("display_name_optional_1e3a880a")}>
            <Input
              placeholder="Filesystem MCP"
              value={name}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
            <div>
              <div className="text-sm">{uiText("enabled_f4f0ead1")}</div>
              <div className="text-xs text-muted-foreground">{uiText("connect_to_this_server_after_saving_0e2112fa")}</div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div>
            <div className="mb-1 text-xs text-muted-foreground">{uiText("transport_84dada05")}</div>
            <div className="flex flex-wrap gap-2">
              {(["stdio", "streamable_http"] as const).map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  variant={kind === k ? "default" : "secondary"}
                  aria-pressed={kind === k}
                  className="flex-1"
                  onClick={() => setKind(k)}
                >
                  {k === "stdio" ? uiText("stdio_local_process_e3d7ac94") : uiText("streamable_http_remote_7ac7cbb2")}
                </Button>
              ))}
            </div>
          </div>

          {kind === "stdio" ? (
            <>
              <Field label={uiText("command_928f87d4")}>
                <Input
                  placeholder="npx"
                  value={command}
                  autoComplete="off"
                  onChange={(e) => setCommand(e.target.value)}
                />
              </Field>
              <Field label={uiText("arguments_one_per_line_243b43f4")}>
                <Textarea
                  className="min-h-16 resize-y font-mono text-xs"
                  placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/Users/me"}
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                />
              </Field>
              <Field label={uiText("working_directory_cwd_optional_dd5ce4a1")}>
                <Input
                  placeholder="/Users/me/project"
                  value={cwd}
                  autoComplete="off"
                  onChange={(e) => setCwd(e.target.value)}
                />
              </Field>
              <KeyValueEditor
                title={uiText("environment_variables_ae27b474")}
                addLabel={uiText("add_7a8a11ea")}
                keyPlaceholder="MCP_ROOT"
                valuePlaceholder="/Users/me/workspace"
                entries={envEntries}
                onChange={setEnvEntries}
              />
            </>
          ) : (
            <>
              <Field label="URL">
                <Input
                  placeholder="http://localhost:4000/mcp"
                  value={url}
                  autoComplete="off"
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <KeyValueEditor
                title={uiText("request_headers_70378530")}
                addLabel={uiText("add_7a8a11ea")}
                keyPlaceholder="Authorization"
                valuePlaceholder="Bearer token"
                entries={headerEntries}
                onChange={setHeaderEntries}
              />
            </>
          )}
        </div>

        <div className="border-t p-3">
          {error ? (
            <p className="mb-2 text-xs break-all text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
              {uiText("cancel_2cd0f3be")}</Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? uiText("saving_ff509c9b") : mode === "edit" ? uiText("save_a3030bf8") : uiText("add_7a8a11ea")}
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
