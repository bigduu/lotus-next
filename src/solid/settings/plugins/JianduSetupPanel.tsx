import { Copy, Download, ShieldCheck } from "@lucide/solid"
import { createMemo } from "solid-js"
import { createUiText } from "../../shell/uiText"
import type { JianduSetupReport } from "@services/plugin"
import { Button } from "../../ui/button"

export type JianduSetupError = "loading" | "legacy" | "unknown" | null

const reasonKeys: Record<string, Parameters<ReturnType<typeof createUiText>>[0]> = {
  unsupported_host: "plugin_jiandu_unsupported",
  glibc_2_35_required: "plugin_jiandu_glibc",
  publisher_not_trusted: "plugin_jiandu_untrusted",
  source_not_trusted: "plugin_jiandu_source_untrusted",
  artifact_unavailable: "plugin_jiandu_unavailable_detail",
  incomplete_install: "plugin_jiandu_incomplete",
  already_installed: "plugin_jiandu_unverified",
  unverified_install: "plugin_jiandu_unverified",
  memory_root_unavailable: "plugin_jiandu_root_unavailable",
  memory_root_overlaps_plugin: "plugin_jiandu_root_overlap",
  invalid_managed_files: "plugin_jiandu_unverified",
}

export function JianduSetupPanel(props: {
  report: JianduSetupReport | null
  error: JianduSetupError
  disabled: boolean
  installing: boolean
  copying: boolean
  copiedConfiguration: string | null
  copyError: string | null
  onInstall: () => void
  onCopy: () => void
  onReviewTrust: () => void
}) {
  const uiText = createUiText()
  const readiness = createMemo(() => {
    const report = props.report
    const ready = report?.installed.state === "ready"
    const configuration = ready && report.external_client
      ? JSON.stringify({ mcpServers: { jiandu: report.external_client } }, null, 2) : null
    const trustReason = report?.trust.trusted || report?.trust_action?.reason === "publisher_already_trusted"
      ? null : report?.trust_action?.reason
    const reason = report?.host.reason ?? trustReason ?? report?.trust.reason ?? report?.installed.reason ?? report?.install.reason
    const memoryRootStatus = reason === "memory_root_unavailable" || reason === "memory_root_overlaps_plugin" ? reasonKeys[reason] : null
    const status = props.error === "loading" ? "loading_4927a53b" : props.error === "legacy" ? "plugin_jiandu_legacy" : props.error
      ? "plugin_jiandu_unknown" : ready ? "plugin_jiandu_ready" : memoryRootStatus ?? (report?.installed.state === "installing"
        ? "plugin_jiandu_incomplete" : report?.installed.state === "unverified" ? "plugin_jiandu_unverified"
          : report?.install.available ? "plugin_jiandu_optional" : reasonKeys[reason ?? ""] ?? "plugin_jiandu_unknown")
    return { ready, configuration, status } as const
  })
  return <div class="space-y-3">
    <p class="text-xs leading-relaxed text-muted-foreground" role="status">{uiText(readiness().status)}</p>
    {props.report ? <p class="text-xs text-muted-foreground">
      {uiText("plugin_jiandu_host", { os: props.report.host.os, arch: props.report.host.arch })}
      {props.report.release ? ` · v${props.report.release.version}` : null}
    </p> : null}
    {props.report?.trust.reason === "publisher_not_trusted" && !props.report.trust_action ?
      <p class="text-xs text-muted-foreground">{uiText("plugin_jiandu_trust_unsupported")}</p> : null}
    {readiness().ready ? <>
      <p class="text-xs leading-relaxed text-muted-foreground">{uiText("plugin_jiandu_same_host")}</p>
      <pre aria-label={uiText("plugin_jiandu_config")} class="whitespace-pre-wrap break-all rounded-lg border bg-muted/30 p-3 text-xs">{readiness().configuration}</pre>
    </> : null}
    {props.copyError ? <p role="alert" class="text-xs text-destructive">{props.copyError}</p> : null}
    <div class="flex flex-wrap items-center justify-end gap-2">
      {props.report?.trust_action?.available ? <Button size="sm" variant="outline" disabled={props.disabled || props.error !== null} onClick={props.onReviewTrust}>
        <ShieldCheck class="size-4" />{uiText("plugin_jiandu_review_trust")}
      </Button> : null}
      {readiness().configuration && props.copiedConfiguration === readiness().configuration ? <span role="status" class="text-xs text-primary">{uiText("plugin_jiandu_copied")}</span> : null}
      <Button size="sm" variant={readiness().ready ? "secondary" : "default"} onClick={readiness().ready ? props.onCopy : props.onInstall}
        disabled={props.disabled || props.error !== null || (!readiness().ready && !props.report?.install.available)}>
        {readiness().ready ? <Copy class="size-4" /> : <Download class="size-4" />}
        {props.installing ? uiText("installing_19658d9f") : props.copying ? uiText("plugin_jiandu_copying") : readiness().ready ? uiText("plugin_jiandu_copy") : uiText("plugin_jiandu_install")}
      </Button>
    </div>
  </div>
}
