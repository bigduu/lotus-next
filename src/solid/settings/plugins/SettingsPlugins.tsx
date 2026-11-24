import { createUiText } from "../../shell/uiText"
import { createEffect, createMemo, createSignal, For, onCleanup, onSettled } from "solid-js"
import { Blocks, Plus, RefreshCw, RotateCw, Trash2 } from "@lucide/solid"
import {
  novaInstallReason,
  pluginService,
  type InstalledPluginView,
  type JianduSetupReport,
  type NovaAppSetupReport,
  type PluginSourceSpec,
  type PluginStatus,
  type RegisteredResources,
} from "@services/plugin"
import { getErrorMessage, isApiError } from "@services/api"
import { mcpService, type McpServer } from "@services/mcp"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "../../ui/responsive-dialog"
import { cn } from "@/lib/utils"
import { PluginFormDialog, type PluginFormMode } from "./PluginFormDialog"
import { OfficialPluginCards } from "./OfficialPluginCards"
import { NovaSetupPanel, type NovaSetupError } from "./NovaSetupPanel"
import { PluginRuntime } from "./PluginRuntime"
import { NOVA_PLUGIN } from "@/lib/settings/officialPlugins"
import { JianduSetupPanel, type JianduSetupError } from "./JianduSetupPanel"
import { PublisherTrustPanel } from "./PublisherTrustPanel"
import { copyText } from "@shared/utils/clipboard"

function StatusBadge(props: { status: PluginStatus }) {
  const uiText = createUiText()
  return <Badge variant={props.status === "installing" ? "warning" : "secondary"}>{uiText(props.status === "installing"
    ? "installing_possibly_an_incomplete_installation_ce4290b2" : "installed_a8b6c39d")}</Badge>
}

function sourceSummary(source: PluginSourceSpec, text: ReturnType<typeof createUiText>): string {
  switch (source.type) {
    case "local_dir":
      return text("local_directory_9a7b72f1", { v0: source.path })
    case "local_archive":
      return text("local_archive_7e17d5f1", { v0: source.path })
    case "url":
      return `URL · ${source.url}`
    default:
      return ""
  }
}

function registeredChips(registered: RegisteredResources, text: ReturnType<typeof createUiText>): { key: string; label: string }[] {
  const chips: { key: string; label: string }[] = []
  if (registered.mcp_server_ids?.length) {
    chips.push({ key: "mcp", label: text("mcp_servers_bf3157a8", { v0: registered.mcp_server_ids.length , count: registered.mcp_server_ids.length }) })
  }
  if (registered.skill_dirs?.length) {
    chips.push({ key: "skills", label: text("skills_c576d453", { v0: registered.skill_dirs.length , count: registered.skill_dirs.length }) })
  }
  if (registered.preset_ids?.length) {
    chips.push({ key: "prompts", label: text("prompts_b7b44efd", { v0: registered.preset_ids.length , count: registered.preset_ids.length }) })
  }
  if (registered.workflow_filenames?.length) {
    chips.push({ key: "workflows", label: text("workflows_a9684d0d", { v0: registered.workflow_filenames.length , count: registered.workflow_filenames.length }) })
  }
  return chips
}

interface FormState {
  mode: PluginFormMode
  pluginId?: string
  pluginName?: string
  initialSource?: PluginSourceSpec | null
}

/** Render a rejected Nova.app install with the server's finite reason when known. */
function novaInstallMessage(reason: string | null, uiText: ReturnType<typeof createUiText>): string {
  // A moved release asset is not a transient network fault: retrying cannot
  // succeed, so name the cause instead of asking the user to refresh again.
  if (reason === "archive_checksum_mismatch") return uiText("plugin_nova_app_install_checksum")
  if (reason) return uiText("plugin_nova_app_install_reason", { reason })
  return uiText("plugin_nova_app_install_unconfirmed")
}

type ReconciliationIntent =
  | { type: "install"; id: string }
  | { type: "jiandu-install" }
  | { type: "jiandu-trust"; publicKey: string }
  | { type: "nova-app-install"; artifactId: string; version: string }
  | { type: "toggle"; id: string; enabled: boolean }

export function SettingsPlugins() {
  const uiText = createUiText()
  const [plugins, setPlugins] = createSignal<InstalledPluginView[]>([])
  const [tab, setTab] = createSignal("discover")
  const [confirmed, setConfirmed] = createSignal(false)
  const [servers, setServers] = createSignal<McpServer[]>([])
  const [serversConfirmed, setServersConfirmed] = createSignal(false)
  const [jiandu, setJiandu] = createSignal<JianduSetupReport | null>(null)
  const [jianduError, setJianduError] = createSignal<JianduSetupError>("loading")
  const [jianduTrustReview, setJianduTrustReview] = createSignal<JianduSetupReport | null>(null)
  const [novaSetup, setNovaSetup] = createSignal<NovaAppSetupReport | null>(null)
  const [novaSetupError, setNovaSetupError] = createSignal<NovaSetupError>("loading")
  const [novaReconnectSent, setNovaReconnectSent] = createSignal(false)
  const [novaStartSent, setNovaStartSent] = createSignal(false)
  const [copiedJianduConfig, setCopiedJianduConfig] = createSignal<string | null>(null)
  const [copyError, setCopyError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [actionError, setActionError] = createSignal<string | null>(null)
  const [operation, setOperation] = createSignal<string | null>(null)
  const [form, setForm] = createSignal<FormState | null>(null)
  const [deleting, setDeleting] = createSignal<InstalledPluginView | null>(null)
  const [deleteBusy, setDeleteBusy] = createSignal(false)
  const [deleteError, setDeleteError] = createSignal<string | null>(null)
  let mounted = true
  let operationLocked = false
  let readGeneration = 0
  let reading = false
  let reconciliationIntent: ReconciliationIntent | null = null
  onCleanup(() => {
    mounted = false
    readGeneration += 1
  })

  const reload = async (silent = false) => {
    if (!mounted) return null
    const generation = ++readGeneration
    reading = true
    if (!silent) setLoading(true)
    const [list, runtime, setup, novaApp] = await Promise.allSettled([
      pluginService.listPlugins(),
      mcpService.getServers(),
      pluginService.getJianduSetup(),
      pluginService.getNovaAppSetup(),
    ])
    if (!mounted || generation !== readGeneration) return
    if (list.status === "fulfilled") {
      setPlugins(list.value)
      setConfirmed(true)
      setError(null)
    } else {
      setConfirmed(false)
      setError(uiText("plugin_inventory_unconfirmed"))
    }
    setServersConfirmed(runtime.status === "fulfilled")
    if (runtime.status === "fulfilled") setServers(runtime.value)
    setJiandu(setup.status === "fulfilled" ? setup.value : null)
    setJianduError(setup.status === "fulfilled" ? null : isApiError(setup.reason) && setup.reason.status === 404 ? "legacy" : "unknown")
    setNovaSetup(novaApp.status === "fulfilled" ? novaApp.value : null)
    setNovaSetupError(novaApp.status === "fulfilled" ? null : isApiError(novaApp.reason) && novaApp.reason.status === 404 ? "legacy" : "unknown")
    const intent = reconciliationIntent
    if (
      (intent?.type === "install" && list.status === "fulfilled" && list.value.some((plugin) => plugin.id === intent.id && plugin.status === "installed")) ||
      (intent?.type === "jiandu-install" && setup.status === "fulfilled" && setup.value.installed.state === "ready") ||
      (intent?.type === "jiandu-trust" && setup.status === "fulfilled" && setup.value.trust.trusted &&
        setup.value.trust_action?.publisher.public_key.toLowerCase() === intent.publicKey.toLowerCase()) ||
      (intent?.type === "nova-app-install" && novaApp.status === "fulfilled" &&
        novaApp.value.artifact?.artifact_id === intent.artifactId && novaApp.value.app?.success &&
        novaApp.value.app.state === "installed" && novaApp.value.app.version === intent.version &&
        novaApp.value.app.connector_compatible === true && novaApp.value.app.signing === "ad_hoc" && novaApp.value.app.development === true) ||
      (intent?.type === "toggle" && runtime.status === "fulfilled" && runtime.value.some((server) => server.id === intent.id && server.enabled === intent.enabled))
    ) {
      reconciliationIntent = null
      setActionError(null)
    }
    reading = false
    setLoading(false)
    return list.status === "fulfilled" ? list.value : null
  }

  onSettled(() => {
    void reload()
    const timer = window.setInterval(() => {
      if (!operationLocked && !reading) void reload(true)
    }, 10_000)
    return () => window.clearInterval(timer)
  })

  createEffect(() => {
    const target = deleting()
    return confirmed() && target && !plugins().some((plugin) => plugin.id === target.id)
  }, (removed) => {
    if (removed) {
      setDeleting(null)
      setDeleteError(null)
    }
  })

  const beginOperation = (id: string, requireInventory = true) => {
    if (!mounted || operationLocked || (requireInventory && !confirmed())) return false
    operationLocked = true
    readGeneration += 1
    reconciliationIntent = null
    setOperation(id)
    setActionError(null)
    setNovaReconnectSent(false)
    setNovaStartSent(false)
    setCopyError(null)
    setCopiedJianduConfig(null)
    return true
  }

  const finishOperation = async () => {
    // Reconcile even after a failed response: the backend may have applied it.
    // A late pre-mutation read must never restore the previous inventory.
    const list = await reload(true)
    operationLocked = false
    if (mounted) setOperation(null)
    return list
  }

  const installNova = async () => {
    if (!beginOperation("nova-install")) return
    reconciliationIntent = { type: "install", id: NOVA_PLUGIN.id }
    try {
      await pluginService.installPlugin(NOVA_PLUGIN.source)
    } catch {
      if (mounted) setActionError(uiText("plugin_install_failed"))
    } finally {
      const list = await finishOperation()
      if (mounted && list) setActionError(list.some((plugin) => plugin.id === NOVA_PLUGIN.id && plugin.status === "installed") ? null : uiText("plugin_install_failed"))
    }
  }

  const trustJiandu = async () => {
    const review = jianduTrustReview()
    if (!review?.trust_action?.available || !beginOperation("jiandu-trust", false)) return
    setJianduTrustReview(null)
    reconciliationIntent = { type: "jiandu-trust", publicKey: review.trust_action.publisher.public_key }
    let message = uiText("plugin_jiandu_trust_unconfirmed")
    try {
      await pluginService.trustOfficialJiandu(review)
    } catch (error) {
      if (isApiError(error) && error.status === 409) message = uiText("plugin_jiandu_trust_changed")
      else if (isApiError(error) && error.status === 404) message = uiText("plugin_jiandu_trust_unsupported")
    } finally {
      if (mounted) setActionError(message)
      await finishOperation()
    }
  }

  const installJiandu = async () => {
    if (!jiandu()?.install.available || !beginOperation("jiandu-install", false)) return
    reconciliationIntent = { type: "jiandu-install" }
    try {
      await pluginService.installOfficialJiandu()
    } catch {
      // A lost response or 409 does not authorize another install or copying.
      // The same fresh setup read reconciles both successful and uncertain POSTs.
    } finally {
      if (mounted) setActionError(uiText("plugin_jiandu_install_unconfirmed"))
      await finishOperation()
    }
  }

  const installNovaApp = async () => {
    const setup = novaSetup()
    if (!setup?.install.available || !setup.artifact || !beginOperation("nova-app-install", false)) return
    const { artifact_id: artifactId, version } = setup.artifact
    reconciliationIntent = { type: "nova-app-install", artifactId, version }
    let failureReason: string | null = null
    try {
      await pluginService.installNovaApp(artifactId)
    } catch (error) {
      // No automatic POST retry. The owned backend operation may still finish.
      // Keep the server's finite reason: a rejection is never reconciled, and
      // the reason is the only actionable detail the user can act on.
      failureReason = novaInstallReason(error)
    } finally {
      if (mounted) setActionError(novaInstallMessage(failureReason, uiText))
      await finishOperation()
    }
  }

  const startNovaApp = async () => {
    const expectedVersion = novaSetup()?.app?.version
    if (!novaSetup()?.start?.available || !expectedVersion || !beginOperation("nova-app-start", false)) return
    try {
      // A stale screen never authorizes startup. The host independently checks
      // this fresh observation again while owning its serialized operation.
      const fresh = await pluginService.getNovaAppSetup()
      if (!mounted) return
      setNovaSetup(fresh)
      setNovaSetupError(null)
      if (!fresh.start?.available || !fresh.observation || fresh.app?.version !== expectedVersion) {
        setActionError(uiText("plugin_nova_app_start_unconfirmed"))
        return
      }
      await pluginService.startNovaApp(fresh)
      if (mounted) setNovaStartSent(true)
    } catch {
      // Do not retry a POST or infer success from the App still being installed.
      if (mounted) setActionError(uiText("plugin_nova_app_start_unconfirmed"))
    } finally {
      await finishOperation()
    }
  }

  const reconnectNova = async () => {
    const expectedId = novaSetup()?.desktop_server_id
    if (!expectedId || !beginOperation("nova-reconnect", false)) return
    try {
      // Revalidate ownership and enabled state at click time; connect itself
      // force-restarts and enables its target, so never call it for a disabled ID.
      const [fresh, runtime] = await Promise.all([pluginService.getNovaAppSetup(), mcpService.getServers()])
      if (!mounted) return
      setNovaSetup(fresh)
      setNovaSetupError(null)
      setServers(runtime)
      setServersConfirmed(true)
      if (fresh.desktop_server_id !== expectedId || !fresh.app?.success || fresh.app.state !== "installed" ||
        fresh.app.connector_compatible !== true || !runtime.some((server) => server.id === expectedId && server.enabled)) {
        setActionError(uiText("plugin_nova_app_reconnect_unconfirmed"))
        return
      }
      await mcpService.connectServer(expectedId)
      if (mounted) setNovaReconnectSent(true)
    } catch {
      // enabled=true alone cannot prove that a requested restart was applied.
      if (mounted) setActionError(uiText("plugin_nova_app_reconnect_unconfirmed"))
    } finally {
      await finishOperation()
    }
  }

  const copyJiandu = async () => {
    if (jiandu()?.installed.state !== "ready" || !beginOperation("jiandu-copy", false)) return
    try {
      // Revalidate the managed files and active data root at the time of copying.
      const fresh = await pluginService.getJianduSetup()
      if (!mounted) return
      setJiandu(fresh)
      setJianduError(null)
      if (fresh.installed.state !== "ready" || !fresh.external_client) {
        setCopyError(uiText("plugin_jiandu_copy_unconfirmed"))
        return
      }
      const configuration = JSON.stringify({ mcpServers: { jiandu: fresh.external_client } }, null, 2)
      await copyText(configuration)
      if (mounted) setCopiedJianduConfig(configuration)
    } catch {
      if (mounted) setCopyError(uiText("plugin_jiandu_copy_failed"))
    } finally {
      await finishOperation()
    }
  }

  const toggleServer = async (server: McpServer, enabled: boolean) => {
    if (!serversConfirmed() || !beginOperation(`mcp:${server.id}`)) return
    reconciliationIntent = { type: "toggle", id: server.id, enabled }
    try {
      await (enabled ? mcpService.connectServer(server.id) : mcpService.disconnectServer(server.id))
    } catch {
      if (mounted) setActionError(uiText("plugin_toggle_failed"))
    } finally {
      await finishOperation()
    }
  }

  const submitForm = async (source: PluginSourceSpec) => {
    const selectedForm = form()
    if (!selectedForm || !beginOperation("manual")) throw new Error(uiText("plugin_inventory_unconfirmed"))
    // Throws on failure — PluginFormDialog surfaces the error inline and keeps
    // the dialog open so the user can fix the source and retry.
    try {
      if (selectedForm.mode === "update" && selectedForm.pluginId) {
        await pluginService.updatePlugin(selectedForm.pluginId, source)
      } else {
        await pluginService.installPlugin(source)
      }
      if (mounted) {
        setForm(null)
        setTab("installed")
      }
    } catch (e) {
      // 409 = already installed — steer the user toward Update instead of
      // just repeating the raw backend error.
      if (selectedForm.mode === "install" && isApiError(e) && e.status === 409) {
        throw new Error(uiText("already_installed_use_update_a919ad86", { v0: getErrorMessage(e) }))
      }
      throw e
    } finally {
      await finishOperation()
    }
  }

  const confirmDelete = async () => {
    const targetId = deleting()?.id
    if (!targetId || !beginOperation("delete")) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await pluginService.removePlugin(targetId)
    } catch (e) {
      if (mounted) setDeleteError(getErrorMessage(e))
    } finally {
      await finishOperation()
      if (mounted) {
        setDeleteBusy(false)
      }
    }
  }

  const canReconnect = createMemo(() => {
    const setup = novaSetup()
    return Boolean(setup?.app?.success && setup.app.state === "installed" && setup.app.connector_compatible
      && setup.desktop_server_id && serversConfirmed() && servers().some((server) => server.id === setup.desktop_server_id && server.enabled))
  })
  const JianduPanel = () => <JianduSetupPanel report={jiandu()} error={jianduError()}
    disabled={operation() !== null || loading()} installing={operation() === "jiandu-install"}
    copying={operation() === "jiandu-copy"} copiedConfiguration={copiedJianduConfig()} copyError={copyError()}
    onInstall={() => void installJiandu()} onCopy={() => void copyJiandu()}
    onReviewTrust={() => {
      const review = jiandu()
      if (!operationLocked && review?.trust_action?.available) setJianduTrustReview(review)
    }} />
  const NovaPanel = () => <NovaSetupPanel report={novaSetup()} error={novaSetupError()}
    disabled={operation() !== null || loading()} installing={operation() === "nova-app-install"} reconnecting={operation() === "nova-reconnect"}
    reconnectSent={novaReconnectSent()} starting={operation() === "nova-app-start"} startSent={novaStartSent()}
    canReconnect={canReconnect()} onInstall={() => void installNovaApp()} onStart={() => void startNovaApp()} onReconnect={() => void reconnectNova()} />

  return (
    <div class="space-y-4">
      <PublisherTrustPanel disabled={loading() || operation() !== null} observedRevision={jiandu()?.trust_action?.expected_revision}
        onBegin={() => beginOperation("publisher-policy", false)} onEnd={finishOperation} />
      <div class="flex flex-wrap items-start justify-between gap-3">
        <p class="max-w-xl text-sm leading-relaxed text-muted-foreground">{uiText("plugin_center_description")}</p>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => void reload()} disabled={loading() || operation() !== null} aria-label={uiText("plugin_refresh")}>
            <RefreshCw class={cn("size-4", loading() && "animate-spin")} />{uiText("refresh_aee88743")}</Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setForm({ mode: "install" })}
            disabled={!confirmed() || operation() !== null}
          >
            <Plus class="size-4" />{uiText("plugin_manual_install")}</Button>
        </div>
      </div>

      {error() ? (
        <div
          class="flex items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs break-all text-destructive"
          role="alert"
        >
          <span>{error()}</span>
          <Button size="sm" variant="secondary" class="h-7 shrink-0 px-2" onClick={() => void reload()} disabled={loading() || operation() !== null}>
            {uiText("retry_b8784c8d")}</Button>
        </div>
      ) : null}

      {actionError() ? <p role="alert" class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive">{actionError()}</p> : null}

      <Tabs value={tab()} onValueChange={setTab}>
        <TabsList aria-label={uiText("plugin_center_views")}>
          <TabsTrigger value="discover">{uiText("plugin_discover")}</TabsTrigger>
          <TabsTrigger value="installed">{uiText("plugin_installed_view")}{confirmed() ? <span class="ml-1 text-xs text-muted-foreground">{plugins().length}</span> : null}</TabsTrigger>
        </TabsList>
        <TabsContent value="discover" class="pt-2">
          <OfficialPluginCards nova={plugins().find((plugin) => plugin.id === NOVA_PLUGIN.id)} installing={operation() === "nova-install"}
            disabled={!confirmed() || operation() !== null} onInstallNova={() => void installNova()} onManageNova={() => setTab("installed")} novaSetup={<NovaPanel />} jianduSetup={<JianduPanel />} />
          <p class="mt-3 text-xs leading-relaxed text-muted-foreground">{uiText("plugin_install_location")}</p>
        </TabsContent>
        <TabsContent value="installed" class="pt-2">

          {loading() && plugins().length === 0 ? (
            <p class="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
          ) : confirmed() && plugins().length === 0 ? (
            <div class="rounded-xl border border-dashed px-5 py-8 text-center">
              <Blocks class="mx-auto mb-3 size-6 text-muted-foreground" />
              <p class="text-sm font-medium">{uiText("no_plugins_yet_c3e55896")}</p>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{uiText("plugin_empty_hint")}</p>
              <Button size="sm" variant="secondary" class="mt-4" onClick={() => setTab("discover")}>{uiText("plugin_discover")}</Button>
            </div>
          ) : !confirmed() && plugins().length === 0 ? null : (
            <>
              <p class="text-xs text-muted-foreground">{uiText("total_76e547a8")} {plugins().length} {uiText("plugins_07219a59")}</p>
              <ul class="space-y-2">
                <For each={plugins()} keyed={(plugin) => plugin.id}>{(plugin) => {
                  const chips = createMemo(() => registeredChips(plugin().registered, uiText))
                  const source = createMemo(() => sourceSummary(plugin().source, uiText))
                  return (
                    <li class="rounded-xl border bg-card p-4" aria-label={plugin().name || plugin().id}>
                      <div class="flex min-w-0 flex-wrap items-center gap-2">
                        <span class="min-w-0 break-words text-sm font-medium">{plugin().name || plugin().id}</span>
                        <span class="shrink-0 text-xs text-muted-foreground">v{plugin().version}</span>
                        <StatusBadge status={plugin().status} />
                      </div>
                      {plugin().name ? (
                        <div class="mt-0.5 truncate text-xs text-muted-foreground">{plugin().id}</div>
                      ) : null}
                      <div
                        class="mt-1 truncate text-xs text-muted-foreground"
                        title={source()}
                      >
                        {source()}
                      </div>
                      {chips().length > 0 ? (
                        <div class="mt-2 flex flex-wrap items-center gap-1">
                          <For each={chips()} keyed={(chip) => chip.key}>{(chip) => (
                            <Badge
                              variant="outline"
                              class="text-[10px] font-normal text-muted-foreground"
                            >
                              {chip().label}
                            </Badge>
                          )}</For>
                        </div>
                      ) : null}
                      <PluginRuntime ids={plugin().registered.mcp_server_ids ?? []} servers={servers()} confirmed={serversConfirmed()}
                        disabled={!confirmed() || operation() !== null || plugin().status === "installing"} onToggle={(server, enabled) => void toggleServer(server, enabled)} />
                      {plugin().id === NOVA_PLUGIN.id ? <div class="mt-3"><NovaPanel /></div> : null}
                      {plugin().id === "jiandu" ? <div class="mt-3"><JianduPanel /></div> : null}
                      <div class="mt-2 flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          class="h-7 px-2 text-xs"
                          disabled={!confirmed() || operation() !== null || plugin().status === "installing"}
                          onClick={() =>
                            setForm({
                              mode: "update",
                              pluginId: plugin().id,
                              pluginName: plugin().name,
                              initialSource: plugin().source,
                            })
                          }
                        >
                          <RotateCw class="size-3.5" />{uiText("update_3055a035")}</Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          class="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          disabled={!confirmed() || operation() !== null}
                          onClick={() => {
                            setDeleteError(null)
                            setDeleting(plugin())
                          }}
                        >
                          <Trash2 class="size-3.5" />{uiText("delete_2f9daa82")}</Button>
                      </div>
                    </li>
                  )
                }}</For>
              </ul>
            </>
          )}
        </TabsContent>
      </Tabs>

      <ResponsiveDialog open={jianduTrustReview() !== null} onOpenChange={(open) => { if (!open) setJianduTrustReview(null) }}>
        <ResponsiveDialogContent class="gap-4 p-5 sm:max-w-lg">
          <ResponsiveDialogTitle>{uiText("plugin_jiandu_review_trust")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{uiText("plugin_jiandu_trust_description")}</ResponsiveDialogDescription>
          <p class="text-sm text-muted-foreground">{uiText("plugin_jiandu_host", {
            os: jianduTrustReview()?.host.os ?? "", arch: jianduTrustReview()?.host.arch ?? "",
          })}</p>
          <dl class="min-w-0 space-y-2 text-xs">
            <dt class="text-muted-foreground">{uiText("plugin_jiandu_trust_publisher")}</dt>
            <dd>{jianduTrustReview()?.trust_action?.publisher.label}</dd>
            <dt class="text-muted-foreground">{uiText("plugin_jiandu_trust_key")}</dt>
            <dd class="break-all font-mono">{jianduTrustReview()?.trust_action?.publisher.public_key}</dd>
            <dt class="text-muted-foreground">{uiText("plugin_jiandu_trust_source")}</dt>
            <dd class="break-all">{jianduTrustReview()?.release?.manifest_url}</dd>
          </dl>
          <div class="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setJianduTrustReview(null)}>{uiText("cancel_2cd0f3be")}</Button>
            <Button size="sm" disabled={operation() !== null} onClick={() => void trustJiandu()}>{uiText("plugin_jiandu_confirm_trust")}</Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <PluginFormDialog
        open={form() !== null}
        mode={form()?.mode ?? "install"}
        pluginId={form()?.pluginId}
        pluginName={form()?.pluginName}
        initialSource={form()?.initialSource}
        onCancel={() => { if (!operationLocked) setForm(null) }}
        onSubmit={submitForm}
      />

      <ResponsiveDialog
        open={deleting() !== null}
        onOpenChange={(v) => {
          if (!v && !operationLocked) setDeleting(null)
        }}
      >
        <ResponsiveDialogContent showCloseButton={false} dismissable={!deleteBusy()} class="p-5">
          <ResponsiveDialogTitle>{uiText("delete_plugin_a0c9ae7e")}</ResponsiveDialogTitle>
          <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
            {uiText("delete_72f49a52")}{deleting()?.name || deleting()?.id}{uiText("its_mcp_servers_skills_prompts_and_workflows_will_also__539475bd")}</p>
          {deleteError() ? (
            <p class="mt-2 text-xs break-all text-destructive" role="alert">
              {deleteError()}
            </p>
          ) : null}
          <div class="mt-5 flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDeleting(null)} disabled={deleteBusy()}>
              {uiText("cancel_2cd0f3be")}</Button>
            <Button size="sm" variant="destructive" onClick={() => void confirmDelete()} disabled={deleteBusy() || !confirmed()}>
              {deleteBusy() ? uiText("deleting_5e8e7af5") : uiText("delete_2f9daa82")}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
