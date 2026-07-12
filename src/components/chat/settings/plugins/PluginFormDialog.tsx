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
  { value: "local_dir", label: "本地目录" },
  { value: "local_archive", label: "本地压缩包" },
] as const

type SourceKind = (typeof SOURCE_KINDS)[number]["value"]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
      if (!url.trim()) return "URL 不能为空"
      try {
        new URL(url.trim())
      } catch {
        return "URL 格式无效"
      }
    } else if (!path.trim()) {
      return "路径不能为空"
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
            {mode === "update" ? `更新插件「${pluginName || pluginId}」` : "安装插件"}
          </ResponsiveDialogTitle>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">来源类型</div>
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
              <Field label="sha256 校验和(可选)">
                <Input
                  placeholder="用于校验下载内容完整性"
                  value={sha256}
                  autoComplete="off"
                  className="font-mono text-xs"
                  onChange={(e) => setSha256(e.target.value)}
                />
              </Field>
            </>
          ) : (
            <Field label={kind === "local_dir" ? "本地目录路径" : "本地压缩包路径"}>
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
              {mode === "update" ? "更新" : "安装"}
              插件可能会注册新的 MCP 服务器,或运行插件自带的可执行程序。请确认来源可信后再继续。
            </span>
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
              取消
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={busy}>
              {busy
                ? mode === "update"
                  ? "更新中…"
                  : "安装中…"
                : mode === "update"
                  ? "更新"
                  : "安装"}
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
