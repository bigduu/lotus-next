import { BookOpen, Cpu, Gauge, Plug, Settings2, ShieldCheck, X } from "@lucide/solid"
import { createMemo, createUniqueId, For, lazy, Loading, Show } from "solid-js"
import { Dynamic, type JSX } from "@solidjs/web"
import { ADVANCED_ONLY_SETTINGS_TABS, experienceModeStore } from "@shared/store/experienceModeState"
import { createStoreSelector } from "../state/createStoreSelector"
import { createUiText } from "../shell/uiText"
import { Button } from "../ui/button"
import { SettingsGeneral } from "./SettingsGeneral"
import "../../components/chat/Settings.css"

const SettingsProviders = lazy(() => import("./SettingsProviders"), { export: "SettingsProviders" })
const SettingsSkills = lazy(() => import("./skills/SettingsSkills"), { export: "SettingsSkills" })
const SettingsMcp = lazy(() => import("./mcp/SettingsMcp"), { export: "SettingsMcp" })
const SettingsModelLimits = lazy(() => import("./model-limits/SettingsModelLimits"), { export: "SettingsModelLimits" })
const SettingsPermissions = lazy(() => import("./permissions/SettingsPermissions"), { export: "SettingsPermissions" })

const groups = [
  { label: "settings_group_appearance", tabs: [
    { id: "general", label: "general_835b700e", icon: Settings2, owner: false },
  ] },
  { label: "settings_group_connections", tabs: [
    { id: "providers", label: "provider_9e218722", icon: Cpu, owner: true },
    { id: "model-limits", label: "model_limits_05ff605e", icon: Gauge, owner: true },
    { id: "mcp", label: "MCP", icon: Plug, owner: true },
  ] },
  { label: "settings_group_capabilities", tabs: [
    { id: "skills", label: "skills_99aea2f9", icon: BookOpen, owner: true },
  ] },
  { label: "settings_group_safety", tabs: [
    { id: "permissions", label: "permission_978cbca6", icon: ShieldCheck, owner: true },
  ] },
] as const

type Tab = (typeof groups)[number]["tabs"][number]
export type SettingsTab = Tab["id"]

const renderTab: Record<SettingsTab, (owner: boolean) => JSX.Element> = {
  general: () => <SettingsGeneral />,
  providers: () => <SettingsProviders />,
  "model-limits": () => <SettingsModelLimits />,
  mcp: () => <SettingsMcp />,
  skills: () => <SettingsSkills />,
  permissions: (owner) => <SettingsPermissions ownerAccess={owner} />,
}

export function SettingsPage(props: {
  ownerAccess: boolean
  tab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  onClose: () => void
}) {
  const text = createUiText()
  const categoryId = createUniqueId()
  const headingId = createUniqueId()
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
    <div class="flex min-h-0 flex-1 flex-col" data-slot="settings-page">
      <header class="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
        <h1 class="text-sm font-semibold">{text("system_settings_68ea5dd4")}</h1>
        <Button size="icon" variant="ghost" aria-label={text("close_settings_77b17fc4")} onClick={props.onClose}><X class="size-4" /></Button>
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
          <Show when={current()} keyed>{(tab) => <div role="region" aria-labelledby={headingId} class={`settings-panel motion-content-enter${tab.id === "model-limits" ? " settings-panel-wide" : ""}`}>
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
    </div>
  )
}
