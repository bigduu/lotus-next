import { Download, ExternalLink, Play, RotateCw } from "@lucide/solid"
import type { NovaAppSetupReport } from "@services/plugin"
import { createMemo } from "solid-js"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { NOVA_PLUGIN } from "@/components/chat/settings/plugins/officialPlugins"

export type NovaSetupError = "loading" | "legacy" | "unknown" | null
const reasonKeys: Record<string, Parameters<ReturnType<typeof createUiText>>[0]> = {
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

export function NovaSetupPanel(props: {
  report: NovaAppSetupReport | null
  error: NovaSetupError
  disabled: boolean
  installing: boolean
  reconnecting: boolean
  reconnectSent: boolean
  starting: boolean
  startSent: boolean
  canReconnect: boolean
  onInstall: () => void
  onStart: () => void
  onReconnect: () => void
}) {
  const uiText = createUiText()
  const readiness = createMemo(() => {
    const report = props.report
    const app = report?.app
    const installed = app?.success && app.state === "installed"
    const localDevelopmentBuild = report?.install.available || (installed && app.signing === "ad_hoc" && app.development === true)
    const reason = report?.host.reason ?? report?.connector.reason ?? report?.capability.reason ?? report?.install.reason
    const status = props.error === "loading" ? "loading_4927a53b" : props.error === "legacy" ? "plugin_nova_app_legacy_backend" : props.error
      ? "plugin_nova_app_unknown" : installed ? app.connector_compatible ? "plugin_nova_app_installed" : "plugin_nova_app_version_mismatch"
        : report?.install.available ? "plugin_nova_app_missing" : reasonKeys[reason ?? ""] ?? "plugin_nova_app_unknown"
    return { app, installed, localDevelopmentBuild, status } as const
  })
  const mcpLabels: Record<string, Parameters<ReturnType<typeof createUiText>>[0]> = {
    ready: "plugin_connected", connecting: "connecting_a898478b", error: "error_0bc1fb72",
    degraded: "plugin_degraded", stopped: "stopped_f006455e", not_observed: "plugin_connection_unknown",
  }
  return <div class="space-y-3 rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
    <p class="font-medium text-foreground">{uiText("plugin_nova_setup_title")}</p>
    <p role="status">{uiText(readiness().status)}</p>
    {props.startSent ? <p role="status">{uiText("plugin_nova_app_start_sent")}</p> : null}
    {props.report?.observation ? <>
      <p>{uiText("plugin_nova_app_runtime_unverified")}</p>
      <p>{uiText("plugin_nova_app_mcp_observation", { state: uiText(mcpLabels[props.report.observation.mcp.state] ?? "plugin_connection_unknown") })}</p>
    </> : null}
    {props.reconnectSent ? <p role="status">{uiText("plugin_nova_app_reconnect_sent")}</p> : null}
    {props.report ? <p>{uiText("plugin_jiandu_host", { os: props.report.host.os, arch: props.report.host.arch })}
      {props.report.connector.version ? ` · v${props.report.connector.version}` : null}</p> : null}
    {readiness().installed ? <p class="break-all">{uiText("plugin_nova_app_location", { path: readiness().app?.path ?? "", version: readiness().app?.version ?? "" })}</p> : null}
    {!props.report ? <p>{uiText("plugin_nova_setup_macos")}</p> : null}
    {(!props.report || props.report.host.os === "macos") ? <>
      {readiness().localDevelopmentBuild ? <p>{uiText("plugin_nova_app_local_sign")}</p> : null}
      <p>{uiText("plugin_nova_setup_permissions")}</p>
      {readiness().installed && !props.canReconnect ? <p>{uiText("plugin_nova_app_reconnect_unavailable")}</p> : null}
      <div class="flex flex-wrap items-center justify-end gap-2">
        {readiness().installed && props.report?.start ? <Button size="sm" variant="secondary"
          disabled={props.disabled || props.error !== null || !props.report.start.available} onClick={props.onStart}>
          <Play class="size-4" />{props.starting ? uiText("plugin_nova_app_starting") : uiText("plugin_nova_app_start")}
        </Button> : null}
        {readiness().installed ? <Button size="sm" variant="secondary" disabled={props.disabled || !props.canReconnect} onClick={props.onReconnect}>
          <RotateCw class="size-4" />{props.reconnecting ? uiText("plugin_nova_app_reconnecting") : uiText("plugin_nova_app_reconnect")}
        </Button> : <Button size="sm" disabled={props.disabled || props.error !== null || !props.report?.install.available} onClick={props.onInstall}>
          <Download class="size-4" />{props.installing ? uiText("installing_19658d9f") : uiText("plugin_nova_app_install")}
        </Button>}
      </div>
    </> : null}
    <a class="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
      href={NOVA_PLUGIN.setupUrl} target="_blank" rel="noreferrer">
      {uiText("plugin_setup_guide")}<ExternalLink class="size-3" />
    </a>
  </div>
}
