import { ArrowLeft, Bell, Blocks, BookOpen, CalendarClock, ChartNoAxesCombined, Cpu, Database, FileText, Gauge, Globe, Monitor, Network, Plug, RotateCw, Settings2, Share2, ShieldCheck } from "@lucide/solid"
import { createMemo, createUniqueId, For, lazy, Loading, onSettled, Show } from "solid-js"
import { Dynamic, type JSX } from "@solidjs/web"
import { ADVANCED_ONLY_SETTINGS_TABS, experienceModeStore } from "@shared/store/experienceModeState"
import { isCommandComposing } from "@/lib/commandComposition"
import { createStoreSelector } from "../state/createStoreSelector"
import { createUiText } from "../shell/uiText"
import { Button } from "../ui/button"
import { SettingsGeneral } from "./SettingsGeneral"
import "@/shared/theme/settings.css"

const SettingsProviders = lazy(() => import("./SettingsProviders"), { export: "SettingsProviders" })
const SettingsRetry = lazy(() => import("./retry/SettingsRetry"), { export: "SettingsRetry" })
const SettingsSkills = lazy(() => import("./skills/SettingsSkills"), { export: "SettingsSkills" })
const SettingsMcp = lazy(() => import("./mcp/SettingsMcp"), { export: "SettingsMcp" })
const SettingsModelLimits = lazy(() => import("./model-limits/SettingsModelLimits"), { export: "SettingsModelLimits" })
const SettingsPermissions = lazy(() => import("./permissions/SettingsPermissions"), { export: "SettingsPermissions" })
const SettingsEnv = lazy(() => import("./env/SettingsEnv"), { export: "SettingsEnv" })
const SettingsMasking = lazy(() => import("./masking/SettingsMasking"), { export: "SettingsMasking" })
const SettingsSchedules = lazy(() => import("./schedules/SettingsSchedules"), { export: "SettingsSchedules" })
const SettingsPrompts = lazy(() => import("./prompts/SettingsPrompts"), { export: "SettingsPrompts" })
const SettingsNotifications = lazy(() => import("./notifications/SettingsNotifications"), { export: "SettingsNotifications" })
const SettingsJiandu = lazy(() => import("./jiandu/SettingsJiandu"), { export: "SettingsJiandu" })
const SettingsConfigShare = lazy(() => import("./config-share/SettingsConfigShare"), { export: "SettingsConfigShare" })
const SettingsSystem = lazy(() => import("./system/SettingsSystem"), { export: "SettingsSystem" })
const SettingsPlugins = lazy(() => import("./plugins/SettingsPlugins"), { export: "SettingsPlugins" })
const SettingsMetrics = lazy(() => import("./metrics/SettingsMetrics"), { export: "SettingsMetrics" })
const SettingsClusters = lazy(() => import("./clusters/SettingsClusters"), { export: "SettingsClusters" })

const groups = [
  { label: "settings_group_appearance", tabs: [
    { id: "general", label: "general_835b700e", icon: Settings2, owner: false },
    { id: "notifications", label: "notifications_4b6ded8a", icon: Bell, owner: true },
  ] },
  { label: "settings_group_connections", tabs: [
    { id: "providers", label: "provider_9e218722", icon: Cpu, owner: true },
    { id: "config-share", label: "share_title", icon: Share2, owner: true },
    { id: "model-limits", label: "model_limits_05ff605e", icon: Gauge, owner: true },
    { id: "retry", label: "retry_settings_1a7c4e91", icon: RotateCw, owner: true },
    { id: "mcp", label: "MCP", icon: Plug, owner: true },
    { id: "clusters", label: "clusters_5318ca46", icon: Network, owner: true },
  ] },
  { label: "settings_group_capabilities", tabs: [
    { id: "plugins", label: "plugins_e806fbbe", icon: Blocks, owner: true },
    { id: "skills", label: "skills_99aea2f9", icon: BookOpen, owner: true },
    { id: "prompts", label: "prompts_4b47dbae", icon: FileText, owner: true },
    { id: "schedules", label: "scheduled_tasks_3c39e9bd", icon: CalendarClock, owner: true },
    { id: "jiandu", label: "jiandu_memory_6567932c", icon: Database, owner: true },
  ] },
  { label: "settings_group_safety", tabs: [
    { id: "permissions", label: "permission_978cbca6", icon: ShieldCheck, owner: true },
    { id: "masking", label: "keyword_masking_62e701d9", icon: ShieldCheck, owner: true },
    { id: "env", label: "environment_variables_ae27b474", icon: Globe, owner: true },
    { id: "metrics", label: "metrics_b87e67c7", icon: ChartNoAxesCombined, owner: true },
    { id: "system", label: "system_5b50d7c4", icon: Monitor, owner: true },
  ] },
] as const

type Tab = (typeof groups)[number]["tabs"][number]
export type SettingsTab = Tab["id"]

const renderTab: Record<SettingsTab, (owner: boolean) => JSX.Element> = {
  general: () => <SettingsGeneral />,
  providers: () => <SettingsProviders />,
  "model-limits": () => <SettingsModelLimits />,
  retry: () => <SettingsRetry />,
  mcp: () => <SettingsMcp />,
  skills: () => <SettingsSkills />,
  permissions: (owner) => <SettingsPermissions ownerAccess={owner} />,
  env: () => <SettingsEnv />,
  masking: () => <SettingsMasking />,
  schedules: () => <SettingsSchedules />,
  prompts: () => <SettingsPrompts />,
  notifications: () => <SettingsNotifications />,
  jiandu: () => <SettingsJiandu />,
  "config-share": () => <SettingsConfigShare />,
  system: (owner) => <SettingsSystem ownerAccess={owner} />,
  plugins: () => <SettingsPlugins />,
  metrics: () => <SettingsMetrics />,
  clusters: () => <SettingsClusters />,
}

export function SettingsPage(props: {
  ownerAccess: boolean
  tab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  onClose: () => void
}) {
  const text = createUiText()
  const categoryId = "settings-category"
  const titleId = createUniqueId()
  const headingId = createUniqueId()
  let heading: HTMLHeadingElement | undefined
  onSettled(() => { heading?.focus({ preventScroll: true }) })
  const advanced = createStoreSelector(experienceModeStore, (state) => state.isAdvanced)
  const label = (tab: Tab) => tab.label === "MCP" ? tab.label : text(tab.label)
  const visible = createMemo(() => groups.map((group) => ({
    label: group.label,
    tabs: Array.from<Tab>(group.tabs).filter((tab) =>
      (!tab.owner || props.ownerAccess) && (advanced() || !ADVANCED_ONLY_SETTINGS_TABS.has(tab.id)),
    ),
  })).filter((group) => group.tabs.length > 0))
  const tabs = createMemo(() => visible().flatMap((group) => group.tabs))
  const current = () => tabs().find((entry) => entry.id === props.tab) ?? groups[0].tabs[0]
  const choose = (value: string) => {
    const next = tabs().find((tab) => tab.id === value)
    if (next) props.onTabChange(next.id)
  }

  return (
    <main class="motion-page-enter flex h-full min-h-0 w-full flex-1 flex-col bg-background" data-slot="settings-page" aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || isCommandComposing(event)) return
        if (event.target.closest('[role="dialog"], [role="alertdialog"], [role="combobox"], [role="listbox"], [role="menu"], select')) return
        event.preventDefault()
        props.onClose()
      }}>
      <header class="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
        <h1 id={titleId} ref={(element) => { heading = element }} tabindex={-1} class="text-sm font-semibold outline-none">{text("system_settings_68ea5dd4")}</h1>
        <Button size="sm" variant="ghost" onClick={props.onClose}><ArrowLeft class="size-4" />{text("back_to_chat_5b8ac6b1")}</Button>
      </header>
      <div class="settings-layout">
        <div class="settings-mobile-nav">
          <label for={categoryId} class="sr-only">{text("system_settings_68ea5dd4")}</label>
          <select id={categoryId} value={current().id} onChange={(event) => choose(event.currentTarget.value)} class="settings-select">
            <For each={visible()}>{(group) => <optgroup label={text(group.label)}>
              <For each={group.tabs}>{(tab) => <option value={tab.id}>{label(tab)}</option>}</For>
            </optgroup>}</For>
          </select>
        </div>
        <nav aria-label={text("system_settings_68ea5dd4")} class="settings-nav">
          <For each={visible()}>{(group) => <div class="settings-nav-group">
            <h3 class="settings-nav-heading">{text(group.label)}</h3>
            <div class="settings-nav-links">
              <For each={group.tabs}>{(tab) => (
                <button type="button" aria-current={current().id === tab.id ? "page" : undefined} class="settings-nav-item" onClick={() => choose(tab.id)}>
                  <Dynamic component={tab.icon} class="size-4 shrink-0" aria-hidden="true" />{label(tab)}
                </button>
              )}</For>
            </div>
          </div>}</For>
        </nav>
        <div class="settings-scroll">
          <Show when={current()} keyed>{(tab) => <div role="region" aria-labelledby={headingId} class={`settings-panel motion-content-enter${tab.id === "model-limits" || tab.id === "metrics" ? " settings-panel-wide" : ""}`}>
            <div class="settings-panel-heading">
              <h2 id={headingId} class="settings-title">{label(tab)}</h2>
              <p class="settings-panel-hint">{text(`settings_hint_${tab.id}`)}</p>
            </div>
            <Loading fallback={<p role="status">{text("loading_4927a53b")}</p>}>
              {renderTab[tab.id](props.ownerAccess)}
            </Loading>
          </div>}</Show>
        </div>
      </div>
    </main>
  )
}
