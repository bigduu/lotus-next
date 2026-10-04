import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import type { PluginSourceSpec } from "@services/plugin"
import { getErrorMessage } from "@services/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"

export type PluginFormMode = "install" | "update"

const SOURCE_KINDS = [
  { value: "url", label: "URL" },
  { value: "local_dir", get label() { return uiText("local_directory_aeb65d05") } },
  { value: "local_archive", get label() { return uiText("local_archive_b6a1a973") } },
] as const

type SourceKind = (typeof SOURCE_KINDS)[number]["value"]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  useUiLocale()
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

/**
 * Shared source-entry dialog for both installing a new plugin and updating an
 * existing one — the request body shape (`{ source }`) is identical, only the
 * target endpoint differs, which the caller decides via `onSubmit`.
 */
export function PluginFormDialog({
  open,
  mode,
  pluginId,
  pluginName,
  initialSource,
  onCancel,
  onSubmit,
}: {
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
  useUiLocale()
  const [kind, setKind] = useState<SourceKind>("url")
  const [url, setUrl] = useState("")
  const [sha256, setSha256] = useState("")
  const [path, setPath] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const src = initialSource ?? null
    setKind(src?.type ?? "url")
    setUrl(src?.type === "url" ? src.url : "")
    setSha256(src?.type === "url" ? (src.sha256 ?? "") : "")
    setPath(src && (src.type === "local_dir" || src.type === "local_archive") ? src.path : "")
    setError(null)
    setBusy(false)
  }, [open, initialSource])

  const validate = (): string | null => {
    if (kind === "url") {
      if (!url.trim()) return uiText("url_is_required_b0a85a80")
      try {
        new URL(url.trim())
      } catch {
        return uiText("invalid_url_format_aed7aaa6")
      }
    } else if (!path.trim()) {
      return uiText("path_is_required_72b2ecec")
    }
    return null
  }

  const buildSource = (): PluginSourceSpec => {
    if (kind === "url") {
      return {
        type: "url",
        url: url.trim(),
        sha256: sha256.trim() ? sha256.trim() : undefined,
      }
    }
    if (kind === "local_archive") {
      return { type: "local_archive", path: path.trim() }
    }
    return { type: "local_dir", path: path.trim() }
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
      await onSubmit(buildSource())
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
            {mode === "update" ? uiText("update_plugin_ccd7d265", { v0: pluginName || pluginId }) : uiText("install_plugin_edc3f028")}
          </ResponsiveDialogTitle>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">{uiText("source_type_38e1e77b")}</div>
            <div className="flex gap-2">
              {SOURCE_KINDS.map((k) => (
                <Button
                  key={k.value}
                  type="button"
                  size="sm"
                  variant={kind === k.value ? "default" : "secondary"}
                  className="flex-1"
                  onClick={() => setKind(k.value)}
                >
                  {k.label}
                </Button>
              ))}
            </div>
          </div>

          {kind === "url" ? (
            <>
              <Field label="URL">
                <Input
                  placeholder="https://example.com/plugin.zip"
                  value={url}
                  autoComplete="off"
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <Field label={uiText("sha256_checksum_optional_a604f8f4")}>
                <Input
                  placeholder={uiText("verify_downloaded_content_integrity_ac604aa0")}
                  value={sha256}
                  autoComplete="off"
                  className="font-mono text-xs"
                  onChange={(e) => setSha256(e.target.value)}
                />
              </Field>
            </>
          ) : (
            <Field label={kind === "local_dir" ? uiText("local_directory_path_80cfccba") : uiText("local_archive_path_8a4bb71d")}>
              <Input
                placeholder={
                  kind === "local_dir" ? "/Users/me/my-plugin" : "/Users/me/my-plugin.zip"
                }
                value={path}
                autoComplete="off"
                onChange={(e) => setPath(e.target.value)}
              />
            </Field>
          )}

          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {mode === "update" ? uiText("update_3055a035") : uiText("install_e8f88f51")}
              {uiText("plugins_may_register_mcp_servers_or_run_bundled_executa_0c705da8")}</span>
          </div>
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
            <Button size="sm" onClick={() => void save()} disabled={busy}>
              {busy
                ? mode === "update"
                  ? uiText("updating_a0bacec4")
                  : uiText("installing_19658d9f")
                : mode === "update"
                  ? uiText("update_3055a035")
                  : uiText("install_e8f88f51")}
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
