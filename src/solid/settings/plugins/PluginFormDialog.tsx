import { createUiText } from "../../shell/uiText"
import { createEffect, createSignal, For, onCleanup } from "solid-js"
import type { JSX } from "@solidjs/web"
import { AlertTriangle } from "@lucide/solid"
import type { PluginSourceSpec } from "@services/plugin"
import { getErrorMessage } from "@services/api"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "../../ui/responsive-dialog"

export type PluginFormMode = "install" | "update"

const SOURCE_KINDS = [
  { value: "url", label: "URL" },
  { value: "local_dir", label: "local_directory_aeb65d05" },
  { value: "local_archive", label: "local_archive_b6a1a973" },
] as const

type SourceKind = (typeof SOURCE_KINDS)[number]["value"]

function Field(props: { label: string; children: JSX.Element }) {
  return (
    <label class="block">
      <span class="mb-1 block text-xs text-muted-foreground">{props.label}</span>
      {props.children}
    </label>
  )
}

/**
 * Shared source-entry dialog for both installing a new plugin and updating an
 * existing one — the request body shape (`{ source }`) is identical, only the
 * target endpoint differs, which the caller decides via `onSubmit`.
 */
export function PluginFormDialog(props: {
  open: boolean
  mode: PluginFormMode
  /** Target plugin id — only meaningful for mode="update". */
  pluginId?: string
  pluginName?: string
  /** Prefill for mode="update". */
  initialSource?: PluginSourceSpec | null
  onCancel: () => void
  /** Should throw on failure — the error is surfaced inline in the dialog. */
  onSubmit: (source: PluginSourceSpec) => Promise<void>
}) {
  const uiText = createUiText()
  const [kind, setKind] = createSignal<SourceKind>("url")
  const [url, setUrl] = createSignal("")
  const [sha256, setSha256] = createSignal("")
  const [path, setPath] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  let alive = true
  let submitting = false
  onCleanup(() => { alive = false })

  createEffect(() => props.open ? { source: props.initialSource ?? null } : null, (scope) => {
    if (!scope) return
    const src = scope.source
    setKind(src?.type ?? "url")
    setUrl(src?.type === "url" ? src.url : "")
    setSha256(src?.type === "url" ? (src.sha256 ?? "") : "")
    setPath(src && (src.type === "local_dir" || src.type === "local_archive") ? src.path : "")
    setError(null)
    setBusy(false)
  })

  const validate = (): string | null => {
    if (kind() === "url") {
      if (!url().trim()) return uiText("url_is_required_b0a85a80")
      try {
        new URL(url().trim())
      } catch {
        return uiText("invalid_url_format_aed7aaa6")
      }
    } else if (!path().trim()) {
      return uiText("path_is_required_72b2ecec")
    }
    return null
  }

  const buildSource = (): PluginSourceSpec => {
    if (kind() === "url") {
      return {
        type: "url",
        url: url().trim(),
        sha256: sha256().trim() ? sha256().trim() : undefined,
      }
    }
    if (kind() === "local_archive") {
      return { type: "local_archive", path: path().trim() }
    }
    return { type: "local_dir", path: path().trim() }
  }

  const save = async () => {
    if (!props.open || submitting) return
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    submitting = true
    setBusy(true)
    setError(null)
    try {
      await props.onSubmit(buildSource())
    } catch (e) {
      if (alive) setError(getErrorMessage(e))
    } finally {
      submitting = false
      if (alive) setBusy(false)
    }
  }

  return (
    <ResponsiveDialog
      open={props.open}
      onOpenChange={(v) => {
        if (!v) props.onCancel()
      }}
    >
      <ResponsiveDialogContent class="sm:max-w-lg" dismissable={!busy()}>
        <div class="border-b px-4 py-3.5">
          <ResponsiveDialogTitle>
            {props.mode === "update" ? uiText("update_plugin_ccd7d265", { v0: props.pluginName || props.pluginId }) : uiText("install_plugin_edc3f028")}
          </ResponsiveDialogTitle>
        </div>

        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div>
            <div class="mb-1 text-xs text-muted-foreground">{uiText("source_type_38e1e77b")}</div>
            <div class="flex gap-2">
              <For each={SOURCE_KINDS}>{(k) => (
                <Button
                  type="button"
                  size="sm"
                  variant={kind() === k.value ? "default" : "secondary"}
                  class="flex-1"
                  onClick={() => setKind(k.value)}
                >
                  {k.value === "url" ? k.label : uiText(k.label)}
                </Button>
              )}</For>
            </div>
          </div>

          {kind() === "url" ? (
            <>
              <Field label="URL">
                <Input
                  placeholder="https://example.com/plugin.zip"
                  value={url()}
                  autocomplete="off"
                  onInput={(event) => setUrl(event.currentTarget.value)}
                />
              </Field>
              <Field label={uiText("sha256_checksum_optional_a604f8f4")}>
                <Input
                  placeholder={uiText("verify_downloaded_content_integrity_ac604aa0")}
                  value={sha256()}
                  autocomplete="off"
                  class="font-mono text-xs"
                  onInput={(event) => setSha256(event.currentTarget.value)}
                />
              </Field>
            </>
          ) : (
            <Field label={kind() === "local_dir" ? uiText("local_directory_path_80cfccba") : uiText("local_archive_path_8a4bb71d")}>
              <Input
                placeholder={
                  kind() === "local_dir" ? "/Users/me/my-plugin" : "/Users/me/my-plugin.zip"
                }
                value={path()}
                autocomplete="off"
                onInput={(event) => setPath(event.currentTarget.value)}
              />
            </Field>
          )}

          <div class="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
            <AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
            <span>
              {props.mode === "update" ? uiText("update_3055a035") : uiText("install_e8f88f51")}
              {uiText("plugins_may_register_mcp_servers_or_run_bundled_executa_0c705da8")}</span>
          </div>
        </div>

        <div class="border-t p-3">
          {error() ? (
            <p class="mb-2 text-xs break-all text-destructive" role="alert">
              {error()}
            </p>
          ) : null}
          <div class="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={props.onCancel} disabled={busy()}>
              {uiText("cancel_2cd0f3be")}</Button>
            <Button size="sm" onClick={() => void save()} disabled={busy()}>
              {busy()
                ? props.mode === "update"
                  ? uiText("updating_a0bacec4")
                  : uiText("installing_19658d9f")
                : props.mode === "update"
                  ? uiText("update_3055a035")
                  : uiText("install_e8f88f51")}
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
