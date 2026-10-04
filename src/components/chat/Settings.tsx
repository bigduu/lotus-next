import { changeLocale } from "@shared/i18n"
import { isSupportedAppLocale } from "@shared/i18n/types"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useState } from "react"
import { useThemeStore } from "@shared/store/themeStore"
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

function Stat({ label, value }: { label: string; value: number | undefined }) {
  useUiLocale()
  return (
    <div className="rounded-lg border p-2.5 text-center">
      <div className="text-lg font-semibold">{value ?? 0}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function GeneralTab() {
  const locale = useUiLocale()
  const [languageError, setLanguageError] = useState(false)
  const themePreference = useThemeStore((s) => s.themePreference)
  const setThemePreference = useThemeStore((s) => s.setThemePreference)
  const experienceMode = useExperienceModeStore((s) => s.mode)
  const setExperienceMode = useExperienceModeStore((s) => s.setMode)
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null)

  useEffect(() => {
    metricsService
      .getSummary()
      .then(setMetrics)
      .catch(() => setMetrics(null))
  }, [])

  return (
    <div className="space-y-4">
      <section className="rounded-lg border p-3">
        <label htmlFor="app-language" className="mb-2 block text-xs font-medium text-muted-foreground">
          {uiText("language_label")}
        </label>
        <select id="app-language" value={locale} className="w-full rounded-md border bg-background p-2 text-sm"
          onChange={(event) => {
            const next = event.target.value
            if (!isSupportedAppLocale(next)) return
            setLanguageError(false)
            void changeLocale(next, { persist: true }).catch(() => setLanguageError(true))
          }}>
          <option value="en-US">English</option>
          <option value="zh-CN">简体中文</option>
          <option value="zh-TW">繁體中文</option>
          <option value="fr-FR">Français</option>
          <option value="ja-JP">日本語</option>
          <option value="hi-IN">हिन्दी</option>
        </select>
        {languageError && <p role="alert" className="mt-2 text-xs text-destructive">{uiText("language_load_failed")}</p>}
      </section>
      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("appearance_86a63f23")}</div>
        <div className="flex gap-2">
          {(["light", "dark", "system"] as const).map((m) => (
            <Button
              key={m}
              variant={themePreference === m ? "default" : "secondary"}
              className="flex-1"
              onClick={() => setThemePreference(m)}
            >
              {m === "light" ? uiText("light_aa0819df") : m === "dark" ? uiText("dark_a6b75d06") : uiText("system_217cfe7d")}
            </Button>
          ))}
        </div>
      </section>

      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("experience_mode_94057abe")}</div>
        <div className="flex gap-2">
          {(["simple", "advanced"] as const).map((m) => (
            <Button
              key={m}
              variant={experienceMode === m ? "default" : "secondary"}
              className="flex-1"
              onClick={() => setExperienceMode(m)}
            >
              {m === "simple" ? uiText("simple_aa55960e") : uiText("advanced_d6e61888")}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {uiText("simple_mode_hides_advanced_settings_such_as_skills_envi_23e359c3")}</p>
      </section>

      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("default_model_1e2933c6")}</div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {uiText("configure_defaults_under_providers_default_model_prefer_c7136d2f")}</p>
      </section>

      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("usage_statistics_3ce933a3")}</div>
        {metrics ? (
          <div className="grid grid-cols-3 gap-2">
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

      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("about_52d25a9e")}</div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{uiText("apply_63c73c47")}</span>
          <span className="font-medium">Bodhi · lotus-next</span>
        </div>
      </section>
    </div>
  )
}

const TABS = [
  { id: "general", get label() { return uiText("general_835b700e") }, render: () => <GeneralTab /> },
  { id: "providers", get label() { return uiText("provider_9e218722") }, render: () => <SettingsProviders /> },
  { id: "model-limits", get label() { return uiText("model_limits_05ff605e") }, render: () => <SettingsModelLimits /> },
  { id: "mcp", label: "MCP", render: () => <SettingsMcp /> },
  { id: "plugins", get label() { return uiText("plugins_e806fbbe") }, render: () => <SettingsPlugins /> },
  { id: "skills", get label() { return uiText("skills_99aea2f9") }, render: () => <SettingsSkills /> },
  { id: "permissions", get label() { return uiText("permission_978cbca6") }, render: () => <SettingsPermissions /> },
  { id: "env", get label() { return uiText("environment_variables_ae27b474") }, render: () => <SettingsEnv /> },
  { id: "schedules", get label() { return uiText("scheduled_tasks_3c39e9bd") }, render: () => <SettingsSchedules /> },
  { id: "notifications", get label() { return uiText("notifications_4b6ded8a") }, render: () => <SettingsNotifications /> },
  { id: "masking", get label() { return uiText("keyword_masking_62e701d9") }, render: () => <SettingsMasking /> },
  { id: "prompts", get label() { return uiText("prompts_4b47dbae") }, render: () => <SettingsPrompts /> },
  { id: "workflows", get label() { return uiText("workflow_c71d0bca") }, render: () => <SettingsWorkflows /> },
  { id: "clusters", get label() { return uiText("clusters_5318ca46") }, render: () => <SettingsClusters /> },
  { id: "metrics", get label() { return uiText("metrics_b87e67c7") }, render: () => <SettingsMetrics /> },
  { id: "jiandu", get label() { return uiText("jiandu_memory_6567932c") }, render: () => <SettingsJiandu /> },
  { id: "system", get label() { return uiText("system_5b50d7c4") }, render: () => <SettingsSystem /> },
] as const

export type SettingsTabId = (typeof TABS)[number]["id"]

export function SettingsContent({
  tab,
  onTabChange,
}: {
  tab: SettingsTabId
  onTabChange: (tab: SettingsTabId) => void
}) {
  useUiLocale()
  const isAdvanced = useExperienceModeStore((s) => s.isAdvanced)
  // 简洁 mode hides advanced-only tabs (classification ported from legacy lotus).
  const visibleTabs = isAdvanced
    ? TABS
    : TABS.filter((t) => !ADVANCED_ONLY_SETTINGS_TABS.has(t.id))
  // Switching to 简洁 while an advanced tab is open falls back to 通用 (always
  // visible, hosts the mode toggle itself).
  const current = visibleTabs.find((t) => t.id === tab) ?? TABS[0]

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:w-40 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors md:w-full",
              current.id === t.id
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent/60",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{current.render()}</div>
    </div>
  )
}
