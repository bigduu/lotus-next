import { Download, ExternalLink, RotateCw } from "lucide-react"
import type { NovaAppSetupReport } from "@services/plugin"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { Button } from "@/components/ui/button"
import { NOVA_PLUGIN } from "./officialPlugins"

export type NovaSetupError = "loading" | "legacy" | "unknown" | null
const reasonKeys: Record<string, Parameters<typeof uiText>[0]> = {
  app_not_required: "plugin_nova_app_not_required",
  unsupported_host: "plugin_nova_app_unsupported",
  connector_missing: "plugin_nova_app_connector_required",
  incomplete_install: "plugin_nova_app_connector_unverified",
  unverified_install: "plugin_nova_app_connector_unverified",
  publisher_not_trusted: "plugin_nova_app_connector_unverified",
  source_not_trusted: "plugin_nova_app_connector_unverified",
  legacy_cli_unavailable: "plugin_nova_app_legacy_cli",
  artifact_unavailable: "plugin_nova_app_artifact_unavailable",
  connector_version_mismatch: "plugin_nova_app_version_mismatch",
}

export function NovaSetupPanel({ report, error, disabled, installing, reconnecting, reconnectSent, canReconnect, onInstall, onReconnect }: {
  report: NovaAppSetupReport | null
  error: NovaSetupError
  disabled: boolean
  installing: boolean
  reconnecting: boolean
  reconnectSent: boolean
  canReconnect: boolean
  onInstall: () => void
  onReconnect: () => void
}) {
  useUiLocale()
  const app = report?.app
  const installed = app?.success && app.state === "installed"
  const reason = report?.host.reason ?? report?.connector.reason ?? report?.capability.reason ?? report?.install.reason
  const status = error === "loading" ? "loading_4927a53b" : error === "legacy" ? "plugin_nova_app_legacy_backend" : error
    ? "plugin_nova_app_unknown" : installed ? app.connector_compatible ? "plugin_nova_app_installed" : "plugin_nova_app_version_mismatch"
      : report?.install.available ? "plugin_nova_app_missing" : reasonKeys[reason ?? ""] ?? "plugin_nova_app_unknown"
  return <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
    <p className="font-medium text-foreground">{uiText("plugin_nova_setup_title")}</p>
    <p role="status">{uiText(status)}</p>
    {reconnectSent ? <p role="status">{uiText("plugin_nova_app_reconnect_sent")}</p> : null}
    {report ? <p>{uiText("plugin_jiandu_host", { os: report.host.os, arch: report.host.arch })}
      {report.connector.version ? ` · v${report.connector.version}` : null}</p> : null}
    {installed ? <p className="break-all">{uiText("plugin_nova_app_location", { path: app.path ?? "", version: app.version ?? "" })}</p> : null}
    {!report ? <p>{uiText("plugin_nova_setup_macos")}</p> : null}
    {(!report || report.host.os === "macos") ? <>
      <p>{uiText("plugin_nova_app_local_sign")}</p>
      <p>{uiText("plugin_nova_setup_permissions")}</p>
      {installed && !canReconnect ? <p>{uiText("plugin_nova_app_reconnect_unavailable")}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {installed ? <Button size="sm" variant="secondary" disabled={disabled || !canReconnect} onClick={onReconnect}>
          <RotateCw className="size-4" />{reconnecting ? uiText("plugin_nova_app_reconnecting") : uiText("plugin_nova_app_reconnect")}
        </Button> : <Button size="sm" disabled={disabled || error !== null || !report?.install.available} onClick={onInstall}>
          <Download className="size-4" />{installing ? uiText("installing_19658d9f") : uiText("plugin_nova_app_install")}
        </Button>}
      </div>
    </> : null}
    <a className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
      href={NOVA_PLUGIN.setupUrl} target="_blank" rel="noreferrer">
      {uiText("plugin_setup_guide")}<ExternalLink className="size-3" />
    </a>
  </div>
}
