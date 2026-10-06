import { changeLocale } from "@shared/i18n"
import { isSupportedAppLocale } from "@shared/i18n/types"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useId, useState } from "react"
import {
  Bell,
  Blocks,
  BookOpen,
  CalendarClock,
  ChartNoAxesCombined,
  Cpu,
  Database,
  FileText,
  Gauge,
  Globe,
  Monitor,
  Moon,
  Network,
  Plug,
  Settings2,
  ShieldCheck,
  Sun,
  Workflow,
} from "lucide-react"
import { useThemeStore } from "@shared/store/themeStore"
import { getUserMessageColors, USER_MESSAGE_COLOR_PRESETS } from "@shared/theme/userMessageColors"
import {
  useExperienceModeStore,
  ADVANCED_ONLY_SETTINGS_TABS,
} from "@shared/store/experienceModeStore"
import { metricsService } from "@services/metrics"
import type { MetricsSummary } from "@services/metrics/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { SettingsProviders } from "@/components/chat/settings/SettingsProviders"
import { SettingsMcp } from "@/components/chat/settings/SettingsMcp"
import { SettingsPlugins } from "@/components/chat/settings/SettingsPlugins"
import { SettingsSkills } from "@/components/chat/settings/SettingsSkills"
import { SettingsPermissions } from "@/components/chat/settings/SettingsPermissions"
import { SettingsEnv } from "@/components/chat/settings/SettingsEnv"
import { SettingsSchedules } from "@/components/chat/settings/SettingsSchedules"
import { SettingsNotifications } from "@/components/chat/settings/SettingsNotifications"
import { SettingsMasking } from "@/components/chat/settings/SettingsMasking"
import { SettingsPrompts } from "@/components/chat/settings/SettingsPrompts"
import { SettingsWorkflows } from "@/components/chat/settings/SettingsWorkflows"
import { SettingsClusters } from "@/components/chat/settings/SettingsClusters"
import { SettingsMetrics } from "@/components/chat/settings/SettingsMetrics"
import { SettingsSystem } from "@/components/chat/settings/SettingsSystem"
import { SettingsJiandu } from "@/components/chat/settings/SettingsJiandu"
import { SettingsModelLimits } from "@/components/chat/settings/SettingsModelLimits"
import "./Settings.css"

function Stat({ label, value }: { label: string; value: number | undefined }) {
  useUiLocale()
  return (
    <div className="settings-stat">
      <div className="settings-stat-value">{value ?? 0}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function GeneralTab() {
  const locale = useUiLocale()
  const [languageError, setLanguageError] = useState(false)
  const themePreference = useThemeStore((s) => s.themePreference)
  const themeMode = useThemeStore((s) => s.themeMode)
  const setThemePreference = useThemeStore((s) => s.setThemePreference)
  const userMessageColorPreset = useThemeStore((s) => s.userMessageColorPreset)
  const customUserMessageColor = useThemeStore((s) => s.customUserMessageColor)
  const setUserMessageColorPreset = useThemeStore((s) => s.setUserMessageColorPreset)
  const setCustomUserMessageColor = useThemeStore((s) => s.setCustomUserMessageColor)
  const experienceMode = useExperienceModeStore((s) => s.mode)
  const setExperienceMode = useExperienceModeStore((s) => s.setMode)
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null)
  const appearanceId = useId()
  const experienceId = useId()
  const experienceDescriptionId = useId()
  const bubbleColorsId = useId()
  const bubbleDescriptionId = useId()
  const customBubbleColorId = useId()
  const bubbleColors = getUserMessageColors(themeMode, userMessageColorPreset, customUserMessageColor)

  useEffect(() => {
    metricsService
      .getSummary()
      .then(setMetrics)
      .catch(() => setMetrics(null))
  }, [])

  return (
    <div className="settings-general">
      <div className="settings-preferences">
        <section className="settings-row settings-row-responsive">
          <label htmlFor="app-language" className="text-sm font-medium">
            {uiText("language_label")}
          </label>
          <div className="settings-language">
            <select
              id="app-language"
              value={locale}
              className="settings-select"
              onChange={(event) => {
                const next = event.target.value
                if (!isSupportedAppLocale(next)) return
                setLanguageError(false)
                void changeLocale(next, { persist: true }).catch(() => setLanguageError(true))
              }}
            >
              <option value="en-US">English</option>
              <option value="zh-CN">简体中文</option>
              <option value="zh-TW">繁體中文</option>
              <option value="fr-FR">Français</option>
              <option value="ja-JP">日本語</option>
              <option value="hi-IN">हिन्दी</option>
            </select>
            {languageError && <p role="alert" className="mt-2 text-xs text-destructive">{uiText("language_load_failed")}</p>}
          </div>
        </section>
        <section className="settings-row settings-row-responsive">
          <h3 id={appearanceId} className="text-sm font-medium">{uiText("appearance_86a63f23")}</h3>
          <div role="group" aria-labelledby={appearanceId} className="settings-choice-group">
            {(["light", "dark", "system"] as const).map((m) => {
              const Icon = m === "light" ? Sun : m === "dark" ? Moon : Monitor
              return (
                <Button
                  key={m}
                  variant="ghost"
                  size="sm"
                  aria-pressed={themePreference === m}
                  className="settings-choice"
                  onClick={() => setThemePreference(m)}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {m === "light" ? uiText("light_aa0819df") : m === "dark" ? uiText("dark_a6b75d06") : uiText("system_217cfe7d")}
                </Button>
              )
            })}
          </div>
        </section>
        <section className="settings-row">
          <h3 id={bubbleColorsId} className="text-sm font-medium">{uiText("bubble_colors")}</h3>
          <p id={bubbleDescriptionId} className="settings-description">{uiText("bubble_colors_hint")}</p>
          <div role="group" aria-labelledby={bubbleColorsId} aria-describedby={bubbleDescriptionId} className="settings-bubble-options">
            {USER_MESSAGE_COLOR_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                variant="outline"
                size="sm"
                className="settings-bubble-option"
                aria-pressed={userMessageColorPreset === preset.id}
                onClick={() => setUserMessageColorPreset(preset.id)}
              >
                <span className="settings-color-swatch" style={{ backgroundColor: preset[themeMode] }} aria-hidden="true" />
                {uiText(`bubble_${preset.id}`)}
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="settings-bubble-option"
              aria-pressed={userMessageColorPreset === "custom"}
              onClick={() => setUserMessageColorPreset("custom")}
            >
              <span className="settings-color-swatch" style={{ backgroundColor: customUserMessageColor }} aria-hidden="true" />
              {uiText("bubble_custom")}
            </Button>
          </div>
          <div className="settings-bubble-custom">
            <label htmlFor={customBubbleColorId}>{uiText("bubble_custom_color")}</label>
            <input
              id={customBubbleColorId}
              type="color"
              value={customUserMessageColor}
              onChange={(event) => setCustomUserMessageColor(event.target.value)}
            />
            <span>{customUserMessageColor.toUpperCase()}</span>
          </div>
          <div className="settings-bubble-preview">
            <p style={{ backgroundColor: bubbleColors.background, color: bubbleColors.foreground }}>
              {uiText("bubble_preview")}
            </p>
          </div>
        </section>
        <section className="settings-row settings-row-responsive">
          <div>
            <h3 id={experienceId} className="text-sm font-medium">{uiText("experience_mode_94057abe")}</h3>
            <p id={experienceDescriptionId} className="settings-description">
              {uiText("simple_mode_hides_advanced_settings_such_as_skills_envi_23e359c3")}
            </p>
          </div>
          <div role="group" aria-labelledby={experienceId} aria-describedby={experienceDescriptionId} className="settings-choice-group">
            {(["simple", "advanced"] as const).map((m) => (
              <Button
                key={m}
                variant="ghost"
                size="sm"
                aria-pressed={experienceMode === m}
                className="settings-choice settings-choice-mode"
                onClick={() => setExperienceMode(m)}
              >
                {m === "simple" ? uiText("simple_aa55960e") : uiText("advanced_d6e61888")}
              </Button>
            ))}
          </div>
        </section>
        <section className="settings-row">
          <h3 className="text-sm font-medium">{uiText("default_model_1e2933c6")}</h3>
          <p className="settings-description settings-description-wide">
            {uiText("configure_defaults_under_providers_default_model_prefer_c7136d2f")}
          </p>
        </section>
      </div>

      <section>
        <h3 className="mb-3 text-sm font-medium">{uiText("usage_statistics_3ce933a3")}</h3>
        {metrics ? (
          <div className="settings-stat-grid">
            <Stat label={uiText("total_sessions_ef3cbace")} value={metrics.total_sessions} />
            <Stat label={uiText("active_dc9591e5")} value={metrics.active_sessions} />
            <Stat label={uiText("completed_f28461bb")} value={metrics.completed_sessions} />
            <Stat label={uiText("tool_calls_a8ca3c13")} value={metrics.total_tool_calls} />
            <Stat label={uiText("errors_01ad2bc5")} value={metrics.error_sessions} />
            <Stat label={uiText("tokens_saved_2bc165cb")} value={metrics.total_tokens_saved} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
        )}
      </section>

      <section className="settings-about">
        <h3 className="text-muted-foreground">{uiText("about_52d25a9e")}</h3>
        <p className="font-medium">Bodhi · lotus-next</p>
      </section>
    </div>
  )
}

const TABS = [
  { id: "general", icon: Settings2, get label() { return uiText("general_835b700e") }, render: () => <GeneralTab /> },
  { id: "providers", icon: Cpu, get label() { return uiText("provider_9e218722") }, render: () => <SettingsProviders /> },
  { id: "model-limits", icon: Gauge, get label() { return uiText("model_limits_05ff605e") }, render: () => <SettingsModelLimits /> },
  { id: "mcp", icon: Plug, label: "MCP", render: () => <SettingsMcp /> },
  { id: "plugins", icon: Blocks, get label() { return uiText("plugins_e806fbbe") }, render: () => <SettingsPlugins /> },
  { id: "skills", icon: BookOpen, get label() { return uiText("skills_99aea2f9") }, render: () => <SettingsSkills /> },
  { id: "permissions", icon: ShieldCheck, get label() { return uiText("permission_978cbca6") }, render: () => <SettingsPermissions /> },
  { id: "env", icon: Globe, get label() { return uiText("environment_variables_ae27b474") }, render: () => <SettingsEnv /> },
  { id: "schedules", icon: CalendarClock, get label() { return uiText("scheduled_tasks_3c39e9bd") }, render: () => <SettingsSchedules /> },
  { id: "notifications", icon: Bell, get label() { return uiText("notifications_4b6ded8a") }, render: () => <SettingsNotifications /> },
  { id: "masking", icon: ShieldCheck, get label() { return uiText("keyword_masking_62e701d9") }, render: () => <SettingsMasking /> },
  { id: "prompts", icon: FileText, get label() { return uiText("prompts_4b47dbae") }, render: () => <SettingsPrompts /> },
  { id: "workflows", icon: Workflow, get label() { return uiText("workflow_c71d0bca") }, render: () => <SettingsWorkflows /> },
  { id: "clusters", icon: Network, get label() { return uiText("clusters_5318ca46") }, render: () => <SettingsClusters /> },
  { id: "metrics", icon: ChartNoAxesCombined, get label() { return uiText("metrics_b87e67c7") }, render: () => <SettingsMetrics /> },
  { id: "jiandu", icon: Database, get label() { return uiText("jiandu_memory_6567932c") }, render: () => <SettingsJiandu /> },
  { id: "system", icon: Monitor, get label() { return uiText("system_5b50d7c4") }, render: () => <SettingsSystem /> },
] as const

export type SettingsTabId = (typeof TABS)[number]["id"]

const TAB_GROUPS: { label: string; tabs: SettingsTabId[] }[] = [
  { get label() { return uiText("settings_group_appearance") }, tabs: ["general", "notifications"] },
  { get label() { return uiText("settings_group_connections") }, tabs: ["providers", "model-limits", "mcp", "clusters"] },
  { get label() { return uiText("settings_group_capabilities") }, tabs: ["plugins", "skills", "prompts", "workflows", "schedules", "jiandu"] },
  { get label() { return uiText("settings_group_safety") }, tabs: ["permissions", "masking", "env", "metrics", "system"] },
]

export function SettingsContent({
  tab,
  onTabChange,
}: {
  tab: SettingsTabId
  onTabChange: (tab: SettingsTabId) => void
}) {
  useUiLocale()
  const contentTitleId = useId()
  const isAdvanced = useExperienceModeStore((s) => s.isAdvanced)
  // 简洁 mode hides advanced-only tabs (classification ported from legacy lotus).
  const visibleTabs = isAdvanced
    ? TABS
    : TABS.filter((t) => !ADVANCED_ONLY_SETTINGS_TABS.has(t.id))
  // Switching to 简洁 while an advanced tab is open falls back to 通用 (always
  // visible, hosts the mode toggle itself).
  const current = visibleTabs.find((t) => t.id === tab) ?? TABS[0]
  const visibleGroups = TAB_GROUPS.map((group) => ({
    label: group.label,
    tabs: group.tabs.map((id) => visibleTabs.find((item) => item.id === id)).filter((item) => item !== undefined),
  })).filter((group) => group.tabs.length > 0)

  return (
    <div className="settings-layout">
      <div className="settings-mobile-nav">
        <label htmlFor="settings-category" className="sr-only">{uiText("system_settings_68ea5dd4")}</label>
        <select
          id="settings-category"
          value={current.id}
          onChange={(event) => {
            const selected = visibleTabs.find((item) => item.id === event.target.value)
            if (selected) onTabChange(selected.id)
          }}
          className="settings-select"
        >
          {visibleGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.tabs.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <nav aria-label={uiText("system_settings_68ea5dd4")} className="settings-nav">
        {visibleGroups.map((group) => (
          <div key={group.label} className="settings-nav-group">
            <h3 className="settings-nav-heading">{group.label}</h3>
            <div className="settings-nav-links">
              {group.tabs.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={current.id === item.id ? "page" : undefined}
                    onClick={() => onTabChange(item.id)}
                    className="settings-nav-item"
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    {item.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="settings-scroll">
        <div
          key={current.id}
          role="region"
          aria-labelledby={contentTitleId}
          className={cn("settings-panel motion-content-enter", (current.id === "model-limits" || current.id === "metrics") && "settings-panel-wide")}
        >
          <div className="settings-panel-heading">
            <h2 id={contentTitleId} className="settings-title">{current.label}</h2>
            <p className="settings-panel-hint">{uiText(`settings_hint_${current.id}`)}</p>
          </div>
          {current.render()}
        </div>
      </div>
    </div>
  )
}
