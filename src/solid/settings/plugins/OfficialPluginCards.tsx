import { Database, Download, ExternalLink, Monitor, PackageCheck } from "@lucide/solid"
import { createUiText } from "../../shell/uiText"
import type { InstalledPluginView } from "@services/plugin"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import { NOVA_PLUGIN } from "@/components/chat/settings/plugins/officialPlugins"
import type { JSX } from "@solidjs/web"

export function OfficialPluginCards(props: {
  nova?: InstalledPluginView
  installing: boolean
  disabled: boolean
  onInstallNova: () => void
  onManageNova: () => void
  novaSetup: JSX.Element
  jianduSetup: JSX.Element
}) {
  const uiText = createUiText()
  return (
    <div class="grid gap-3 sm:grid-cols-2">
      <article aria-label="Nova" class="flex min-w-0 flex-col rounded-xl border bg-card p-4">
        <div class="flex items-start gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Monitor class="size-5" /></div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2"><h3 class="text-sm font-semibold">Nova</h3><Badge variant="outline">{uiText("plugin_official")}</Badge></div>
            <p class="mt-1 text-xs text-muted-foreground">{uiText("plugin_nova_subtitle")}</p>
          </div>
        </div>
        <p class="my-4 text-sm leading-relaxed text-muted-foreground">{uiText("plugin_nova_description")}</p>
        <div class="mb-3 flex flex-wrap gap-1.5"><Badge variant="secondary">macOS</Badge><Badge variant="secondary">Windows</Badge><Badge variant="outline">v{NOVA_PLUGIN.version}</Badge></div>
        {props.novaSetup}
        <div class="mt-auto flex flex-wrap items-center justify-between gap-3 pt-3">
          <a class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            href={NOVA_PLUGIN.releaseUrl} target="_blank" rel="noreferrer">{uiText("plugin_release_details")}<ExternalLink class="size-3" /></a>
          <Button size="sm" onClick={props.nova ? props.onManageNova : props.onInstallNova} disabled={props.disabled || props.nova?.status === "installing"}>
            {props.nova ? <PackageCheck class="size-4" /> : <Download class="size-4" />}
            {props.installing || props.nova?.status === "installing" ? uiText("installing_19658d9f") : props.nova ? uiText("plugin_manage_installed") : uiText("plugin_install_nova")}
          </Button>
        </div>
      </article>

      <article aria-label="Jiandu" class="flex min-w-0 flex-col rounded-xl border bg-card p-4">
        <div class="flex items-start gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Database class="size-5" /></div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2"><h3 class="text-sm font-semibold">Jiandu</h3><Badge variant="outline">{uiText("plugin_official")}</Badge></div>
            <p class="mt-1 text-xs text-muted-foreground">{uiText("plugin_jiandu_subtitle")}</p>
          </div>
        </div>
        <p class="my-4 text-sm leading-relaxed text-muted-foreground">{uiText("plugin_jiandu_description")}</p>
        <div class="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed">
          <p class="font-medium text-primary">{uiText("plugin_jiandu_builtin")}</p>
          <p class="mt-1 text-muted-foreground">{uiText("plugin_jiandu_builtin_detail")}</p>
        </div>
        <div class="mt-auto pt-3">{props.jianduSetup}</div>
      </article>
    </div>
  )
}
