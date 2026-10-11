import { Copy, Download } from "lucide-react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import type { JianduSetupReport } from "@services/plugin"
import { Button } from "@/components/ui/button"

export type JianduSetupError = "loading" | "legacy" | "unknown" | null

const reasonKeys: Record<string, Parameters<typeof uiText>[0]> = {
  unsupported_host: "plugin_jiandu_unsupported",
  glibc_2_35_required: "plugin_jiandu_glibc",
  publisher_not_trusted: "plugin_jiandu_untrusted",
  source_not_trusted: "plugin_jiandu_untrusted",
  artifact_unavailable: "plugin_jiandu_unavailable_detail",
  incomplete_install: "plugin_jiandu_incomplete",
  already_installed: "plugin_jiandu_unverified",
  unverified_install: "plugin_jiandu_unverified",
  memory_root_unavailable: "plugin_jiandu_unverified",
  invalid_managed_files: "plugin_jiandu_unverified",
}

export function JianduSetupPanel({ report, error, disabled, installing, copying, copiedConfiguration, copyError, onInstall, onCopy }: {
  report: JianduSetupReport | null
  error: JianduSetupError
  disabled: boolean
  installing: boolean
  copying: boolean
  copiedConfiguration: string | null
  copyError: string | null
  onInstall: () => void
  onCopy: () => void
}) {
  useUiLocale()
  const ready = report?.installed.state === "ready"
  const configuration = ready && report.external_client
    ? JSON.stringify({ mcpServers: { jiandu: report.external_client } }, null, 2) : null
  const reason = report?.host.reason ?? report?.trust.reason ?? report?.installed.reason ?? report?.install.reason
  const status = error === "loading" ? "loading_4927a53b" : error === "legacy" ? "plugin_jiandu_legacy" : error
    ? "plugin_jiandu_unknown" : ready ? "plugin_jiandu_ready" : report?.installed.state === "installing"
      ? "plugin_jiandu_incomplete" : report?.installed.state === "unverified" ? "plugin_jiandu_unverified"
        : report?.install.available ? "plugin_jiandu_optional" : reasonKeys[reason ?? ""] ?? "plugin_jiandu_unknown"
  return <div className="space-y-3">
    <p className="text-xs leading-relaxed text-muted-foreground" role="status">{uiText(status)}</p>
    {report ? <p className="text-xs text-muted-foreground">
      {uiText("plugin_jiandu_host", { os: report.host.os, arch: report.host.arch })}
      {report.release ? ` · v${report.release.version}` : null}
    </p> : null}
    {ready ? <>
      <p className="text-xs leading-relaxed text-muted-foreground">{uiText("plugin_jiandu_same_host")}</p>
      <pre aria-label={uiText("plugin_jiandu_config")} className="whitespace-pre-wrap break-all rounded-lg border bg-muted/30 p-3 text-xs">{configuration}</pre>
    </> : null}
    {copyError ? <p role="alert" className="text-xs text-destructive">{copyError}</p> : null}
    <div className="flex flex-wrap items-center justify-end gap-2">
      {configuration && copiedConfiguration === configuration ? <span role="status" className="text-xs text-primary">{uiText("plugin_jiandu_copied")}</span> : null}
      <Button size="sm" variant={ready ? "secondary" : "default"} onClick={ready ? onCopy : onInstall}
        disabled={disabled || error !== null || (!ready && !report?.install.available)}>
        {ready ? <Copy className="size-4" /> : <Download className="size-4" />}
        {installing ? uiText("installing_19658d9f") : copying ? uiText("plugin_jiandu_copying") : ready ? uiText("plugin_jiandu_copy") : uiText("plugin_jiandu_install")}
      </Button>
    </div>
  </div>
}
