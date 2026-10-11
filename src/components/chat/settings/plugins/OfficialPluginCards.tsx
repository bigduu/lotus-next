import { Database, Download, ExternalLink, Monitor, PackageCheck } from "lucide-react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import type { InstalledPluginView } from "@services/plugin"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { NOVA_PLUGIN } from "./officialPlugins"
import type { ReactNode } from "react"

export function NovaSetupNotice() {
  useUiLocale()
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
      <p className="font-medium text-foreground">{uiText("plugin_nova_setup_title")}</p>
      <p className="mt-1">{uiText("plugin_nova_setup_macos")}</p>
      <p className="mt-1">{uiText("plugin_nova_setup_permissions")}</p>
      <a className="mt-2 inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
        href={NOVA_PLUGIN.setupUrl} target="_blank" rel="noreferrer">
        {uiText("plugin_setup_guide")}<ExternalLink className="size-3" />
      </a>
    </div>
  )
}

export function OfficialPluginCards({ nova, installing, disabled, onInstallNova, onManageNova, jianduSetup }: {
  nova?: InstalledPluginView
  installing: boolean
  disabled: boolean
  onInstallNova: () => void
  onManageNova: () => void
  jianduSetup: ReactNode
}) {
  useUiLocale()
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <article aria-label="Nova" className="flex min-w-0 flex-col rounded-xl border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Monitor className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">Nova</h3><Badge variant="outline">{uiText("plugin_official")}</Badge></div>
            <p className="mt-1 text-xs text-muted-foreground">{uiText("plugin_nova_subtitle")}</p>
          </div>
        </div>
        <p className="my-4 text-sm leading-relaxed text-muted-foreground">{uiText("plugin_nova_description")}</p>
        <div className="mb-3 flex flex-wrap gap-1.5"><Badge variant="secondary">macOS</Badge><Badge variant="secondary">Windows</Badge><Badge variant="outline">v{NOVA_PLUGIN.version}</Badge></div>
        <NovaSetupNotice />
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-3">
          <a className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            href={NOVA_PLUGIN.releaseUrl} target="_blank" rel="noreferrer">{uiText("plugin_release_details")}<ExternalLink className="size-3" /></a>
          <Button size="sm" onClick={nova ? onManageNova : onInstallNova} disabled={disabled || nova?.status === "installing"}>
            {nova ? <PackageCheck className="size-4" /> : <Download className="size-4" />}
            {installing || nova?.status === "installing" ? uiText("installing_19658d9f") : nova ? uiText("plugin_manage_installed") : uiText("plugin_install_nova")}
          </Button>
        </div>
      </article>

      <article aria-label="Jiandu" className="flex min-w-0 flex-col rounded-xl border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Database className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">Jiandu</h3><Badge variant="outline">{uiText("plugin_official")}</Badge></div>
            <p className="mt-1 text-xs text-muted-foreground">{uiText("plugin_jiandu_subtitle")}</p>
          </div>
        </div>
        <p className="my-4 text-sm leading-relaxed text-muted-foreground">{uiText("plugin_jiandu_description")}</p>
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed">
          <p className="font-medium text-primary">{uiText("plugin_jiandu_builtin")}</p>
          <p className="mt-1 text-muted-foreground">{uiText("plugin_jiandu_builtin_detail")}</p>
        </div>
        <div className="mt-3">{jianduSetup}</div>
      </article>
    </div>
  )
}
