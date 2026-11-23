import { createSignal, For, Show, untrack } from "solid-js"
import type { JSX } from "@solidjs/web"
import { Plus, X } from "@lucide/solid"
import {
  createDefaultMcpServerConfig, DEFAULT_HTTP_CONNECT_TIMEOUT_MS, DEFAULT_STDIO_STARTUP_TIMEOUT_MS,
  type McpServerConfig, type TransportConfig,
} from "@services/mcp"
import { MCP_SERVER_ID_PATTERN } from "@services/mcp/types"
import { isMaskedSecret } from "@/lib/secrets"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Textarea } from "../../ui/textarea"
import { Switch } from "../../ui/switch"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogTitle } from "../../ui/responsive-dialog"

export type McpFormMode = "create" | "edit"
type Entry = { key: string; value: string; saved?: { key: string; mask: string } }
const transports = ["stdio", "streamable_http"] as const

function entry(key: string, value: string): Entry {
  return isMaskedSecret(value) ? { key, value: "", saved: { key, mask: value } } : { key, value }
}

function retainsSecret(row: Entry) {
  return row.saved?.key === row.key.trim()
}

function credentialValue(row: Entry): string {
  // The legacy MCP PUT resolves a masked value by existing server, transport
  // and key. An empty or missing row instead deletes that credential.
  return row.value || (retainsSecret(row) ? row.saved?.mask ?? "" : "")
}

function Field(props: { label: string; children: JSX.Element }) {
  return <label class="block">
    <span class="mb-1 block text-xs text-muted-foreground">{props.label}</span>
    {props.children}
  </label>
}

function KeyValueEditor(props: {
  title: string
  keyPlaceholder: string
  valuePlaceholder: string
  entries: Entry[]
  onChange: (entries: Entry[]) => void
}) {
  const text = createUiText()
  const edit = (index: number, patch: Partial<Entry>) =>
    props.onChange(props.entries.map((row, i) => i === index ? { ...row, ...patch } : row))
  return <div>
    <div class="mb-1.5 flex items-center justify-between">
      <span class="text-xs font-medium text-muted-foreground">{props.title}</span>
      <Button type="button" size="sm" variant="secondary" class="h-7 px-2 text-xs"
        onClick={() => props.onChange([...props.entries, { key: "", value: "" }])}>
        <Plus class="size-3.5" /> {text("add_7a8a11ea")}
      </Button>
    </div>
    <Show when={props.entries.length > 0} fallback={<p class="text-xs text-muted-foreground/70">{text("none_484d5561")}</p>}>
      <div class="space-y-1.5">
        <For each={props.entries} keyed={false}>
          {(row, index) => <div class="flex items-center gap-1.5">
            <Input class="h-8 flex-1 font-mono text-xs" placeholder={props.keyPlaceholder} value={row().key}
              onInput={(event) => edit(index, { key: event.currentTarget.value })} />
            <Input class="h-8 flex-1 font-mono text-xs" type="password" autocomplete="off"
              placeholder={retainsSecret(row()) ? text("configured_leave_blank_to_keep_f3805ede") : props.valuePlaceholder}
              value={row().value} onInput={(event) => edit(index, { value: event.currentTarget.value })} />
            <button type="button" onClick={() => props.onChange(props.entries.filter((_, i) => i !== index))}
              aria-label={text("remove_6135d415")} class="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive">
              <X class="size-3.5" />
            </button>
          </div>}
        </For>
      </div>
    </Show>
  </div>
}

export function McpServerFormDialog(props: {
  mode: McpFormMode
  initial?: McpServerConfig | null
  existingIds: string[]
  onCancel: () => void
  onSubmit: (config: McpServerConfig) => Promise<void>
}) {
  const text = createUiText()
  const initial = untrack(() => props.mode === "edit" ? props.initial : null)
  const transport = initial?.transport
  const [id, setId] = createSignal(initial?.id ?? "")
  const [name, setName] = createSignal(initial?.name ?? "")
  const [enabled, setEnabled] = createSignal(initial?.enabled ?? true)
  const [kind, setKind] = createSignal<TransportConfig["type"]>(transport?.type ?? "stdio")
  const [command, setCommand] = createSignal(transport?.type === "stdio" ? transport.command : "")
  const [argsText, setArgsText] = createSignal(transport?.type === "stdio" ? transport.args.join("\n") : "")
  const [cwd, setCwd] = createSignal(transport?.type === "stdio" ? transport.cwd ?? "" : "")
  const [envEntries, setEnvEntries] = createSignal(transport?.type === "stdio"
    ? Object.entries(transport.env ?? {}).map(([key, value]) => entry(key, value)) : [])
  const [url, setUrl] = createSignal(transport?.type === "streamable_http" ? transport.url : "")
  const [headerEntries, setHeaderEntries] = createSignal(transport?.type === "streamable_http"
    ? transport.headers.map((header) => entry(header.name, header.value)) : [])
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  let saving = false

  const validate = (): string | null => {
    if (props.mode === "create") {
      if (!id().trim()) return text("server_id_is_required_ce4bc4a2")
      if (!MCP_SERVER_ID_PATTERN.test(id().trim())) return text("server_ids_may_contain_only_letters_digits_and_15c859fe")
      if (props.existingIds.includes(id().trim())) return text("this_server_id_already_exists_e06921d5")
    }
    if (kind() === "stdio") {
      if (!command().trim()) return text("command_is_required_eddb4f63")
    } else {
      if (!url().trim()) return text("url_is_required_b0a85a80")
      try { new URL(url().trim()) }
      catch { return text("invalid_url_format_aed7aaa6") }
    }
    const rows = kind() === "stdio" ? envEntries() : headerEntries()
    if (rows.some((row) => isMaskedSecret(row.value) || row.saved && !retainsSecret(row) && !row.value)) {
      return text("could_not_save_please_try_again_f42a1238")
    }
    return null
  }

  const buildConfig = (): McpServerConfig => {
    const serverId = initial?.id ?? id().trim()
    const base = initial ?? createDefaultMcpServerConfig(serverId)
    const nextTransport: TransportConfig = kind() === "stdio" ? {
      type: "stdio", command: command().trim(), args: argsText().split("\n").map((arg) => arg.trim()).filter(Boolean),
      cwd: cwd().trim() || undefined,
      env: Object.fromEntries(envEntries().filter((row) => row.key.trim())
        .map((row) => [row.key.trim(), credentialValue(row)])),
      startup_timeout_ms: transport?.type === "stdio" ? transport.startup_timeout_ms : DEFAULT_STDIO_STARTUP_TIMEOUT_MS,
    } : {
      type: "streamable_http", url: url().trim(),
      headers: headerEntries().filter((row) => row.key.trim()).map((row) => ({ name: row.key.trim(), value: credentialValue(row) })),
      connect_timeout_ms: transport?.type === "streamable_http" ? transport.connect_timeout_ms : DEFAULT_HTTP_CONNECT_TIMEOUT_MS,
    }
    return { ...base, id: serverId, name: name().trim() || undefined, enabled: enabled(), transport: nextTransport }
  }

  const save = async () => {
    if (saving) return
    const problem = validate()
    if (problem) { setError(problem); return }
    saving = true
    setBusy(true)
    setError(null)
    try { await props.onSubmit(buildConfig()) }
    catch { setError(text("could_not_save_please_try_again_f42a1238")) }
    finally { saving = false; setBusy(false) }
  }
  const cancel = () => { if (!saving) props.onCancel() }

  return (
    <ResponsiveDialog open onOpenChange={(open) => { if (!open) cancel() }}>
      <ResponsiveDialogContent class="sm:max-w-lg" dismissable={!busy()}>
        <div class="border-b px-4 py-3.5">
          <ResponsiveDialogTitle>{text(props.mode === "edit" ? "edit_mcp_server_d9bc88f2" : "add_mcp_server_f4b0e747")}</ResponsiveDialogTitle>
        </div>
        <fieldset disabled={busy()} class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <Field label={text("server_id_2964b36b")}>
            <Input placeholder="filesystem" value={id()} disabled={props.mode === "edit"}
              autocomplete="off" onInput={(event) => setId(event.currentTarget.value)} />
          </Field>
          <Field label={text("display_name_optional_1e3a880a")}>
            <Input placeholder="Filesystem MCP" value={name()} autocomplete="off"
              onInput={(event) => setName(event.currentTarget.value)} />
          </Field>
          <div class="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
            <div>
              <div class="text-sm">{text("enabled_f4f0ead1")}</div>
              <div class="text-xs text-muted-foreground">{text("connect_to_this_server_after_saving_0e2112fa")}</div>
            </div>
            <Switch checked={enabled()} aria-label={text("enabled_f4f0ead1")} onCheckedChange={setEnabled} />
          </div>
          <div>
            <div class="mb-1 text-xs text-muted-foreground">{text("transport_84dada05")}</div>
            <div class="flex flex-wrap gap-2">
              <For each={transports}>{(value) => <Button type="button" size="sm" class="flex-1"
                variant={kind() === value ? "default" : "secondary"} aria-pressed={kind() === value ? "true" : "false"}
                onClick={() => setKind(value)}>
                {text(value === "stdio" ? "stdio_local_process_e3d7ac94" : "streamable_http_remote_7ac7cbb2")}
              </Button>}</For>
            </div>
          </div>
          <Show when={kind() === "stdio"} fallback={
            <>
              <Field label="URL">
                <Input placeholder="http://localhost:4000/mcp" value={url()} autocomplete="off"
                  onInput={(event) => setUrl(event.currentTarget.value)} />
              </Field>
              <KeyValueEditor title={text("request_headers_70378530")} keyPlaceholder="Authorization" valuePlaceholder="Bearer token"
                entries={headerEntries()} onChange={setHeaderEntries} />
            </>
          }>
            <Field label={text("command_928f87d4")}>
              <Input placeholder="npx" value={command()} autocomplete="off"
                onInput={(event) => setCommand(event.currentTarget.value)} />
            </Field>
            <Field label={text("arguments_one_per_line_243b43f4")}>
              <Textarea class="min-h-16 resize-y font-mono text-xs" placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/Users/me"}
                value={argsText()} onInput={(event) => setArgsText(event.currentTarget.value)} />
            </Field>
            <Field label={text("working_directory_cwd_optional_dd5ce4a1")}>
              <Input placeholder="/Users/me/project" value={cwd()} autocomplete="off"
                onInput={(event) => setCwd(event.currentTarget.value)} />
            </Field>
            <KeyValueEditor title={text("environment_variables_ae27b474")} keyPlaceholder="MCP_ROOT" valuePlaceholder="/Users/me/workspace"
              entries={envEntries()} onChange={setEnvEntries} />
          </Show>
        </fieldset>
        <div class="border-t p-3">
          <Show when={error()}><p class="mb-2 text-xs break-all text-destructive" role="alert">{error()}</p></Show>
          <div class="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={cancel} disabled={busy()}>{text("cancel_2cd0f3be")}</Button>
            <Button size="sm" onClick={() => void save()} disabled={busy()}>
              {text(busy() ? "saving_ff509c9b" : props.mode === "edit" ? "save_a3030bf8" : "add_7a8a11ea")}
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
