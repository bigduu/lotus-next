import { Monitor, Moon, Sun } from "@lucide/solid"
import { createMemo, createSignal, createUniqueId, For, onSettled } from "solid-js"
import { changeLocale } from "@shared/i18n/runtime"
import { isSupportedAppLocale } from "@shared/i18n/types"
import { themeStore } from "@shared/store/themeState"
import { experienceModeStore } from "@shared/store/experienceModeState"
import { getUserMessageColors, USER_MESSAGE_COLOR_PRESETS } from "@shared/theme/userMessageColors"
import { getGlobalAccentColors, GLOBAL_ACCENT_PRESETS } from "@shared/theme/globalAccentColors"
import {
  getDraftCompletionEnabled, setDraftCompletionEnabled, subscribeDraftCompletionEnabled,
} from "@shared/store/draftCompletionPreferenceState"
import { metricsService, type MetricsSummary } from "@services/metrics"
import { createUiLocale, createUiText } from "../shell/uiText"
import { createStoreSelector } from "../state/createStoreSelector"
import { Button } from "../ui/button"
import { Switch } from "../ui/switch"

function Stat(props: { label: string; value: number | undefined }) {
  return <div class="settings-stat">
    <div class="settings-stat-value">{props.value ?? 0}</div>
    <div class="mt-1 text-xs text-muted-foreground">{props.label}</div>
  </div>
}

export function SettingsGeneral() {
  const uiText = createUiText()
  const locale = createUiLocale()
  const [languageError, setLanguageError] = createSignal(false)
  const [metrics, setMetrics] = createSignal<MetricsSummary | null>(null)
  const [draftCompletionEnabled, setCompletion] = createSignal(getDraftCompletionEnabled())
  const theme = createStoreSelector(themeStore, (state) => state)
  const experienceMode = createStoreSelector(experienceModeStore, (state) => state.mode)
  const setExperienceMode = experienceModeStore.getState().setMode
  const appearanceId = createUniqueId()
  const accentColorsId = createUniqueId()
  const accentDescriptionId = createUniqueId()
  const customAccentColorId = createUniqueId()
  const experienceId = createUniqueId()
  const experienceDescriptionId = createUniqueId()
  const bubbleColorsId = createUniqueId()
  const bubbleDescriptionId = createUniqueId()
  const customBubbleColorId = createUniqueId()
  const draftCompletionId = createUniqueId()
  const draftCompletionDescriptionId = createUniqueId()
  const bubbleColors = createMemo(() => getUserMessageColors(
    theme().themeMode, theme().userMessageColorPreset, theme().customUserMessageColor,
  ))
  const accentColors = createMemo(() => getGlobalAccentColors(
    theme().themeMode, theme().globalAccentPreset, theme().customGlobalAccentColor,
  ))

  onSettled(() => subscribeDraftCompletionEnabled(() => setCompletion(getDraftCompletionEnabled())))
  onSettled(() => {
    const controller = new AbortController()
    void metricsService.getSummary().then((value) => {
      if (!controller.signal.aborted) setMetrics(value)
    }).catch(() => {})
    return () => controller.abort()
  })

  return (
    <div class="settings-general">
      <div class="settings-preferences">
        <section class="settings-row settings-row-responsive">
          <label for="app-language" class="text-sm font-medium">
            {uiText("language_label")}
          </label>
          <div class="settings-language">
            <select
              id="app-language"
              value={locale()}
              class="settings-select"
              onChange={(event) => {
                const next = event.currentTarget.value
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
            {languageError() && <p role="alert" class="mt-2 text-xs text-destructive">{uiText("language_load_failed")}</p>}
          </div>
        </section>
        <section class="settings-row settings-row-responsive">
          <div>
            <label for={draftCompletionId} class="text-sm font-medium">{uiText("chat_draft_completion")}</label>
            <p id={draftCompletionDescriptionId} class="settings-description">{uiText("chat_draft_completion_hint")}</p>
          </div>
          <Switch id={draftCompletionId} aria-describedby={draftCompletionDescriptionId}
            checked={draftCompletionEnabled()} onCheckedChange={setDraftCompletionEnabled} />
        </section>
        <section class="settings-row settings-row-responsive">
          <h3 id={appearanceId} class="text-sm font-medium">{uiText("appearance_86a63f23")}</h3>
          <div role="group" aria-labelledby={appearanceId} class="settings-choice-group">
            <For each={["light", "dark", "system"] as const}>{(m) => {
              const Icon = m === "light" ? Sun : m === "dark" ? Moon : Monitor
              return (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={theme().themePreference === m ? "true" : "false"}
                  class="settings-choice"
                  onClick={() => themeStore.getState().setThemePreference(m)}
                >
                  <Icon aria-hidden="true" class="size-4" />
                  {m === "light" ? uiText("light_aa0819df") : m === "dark" ? uiText("dark_a6b75d06") : uiText("system_217cfe7d")}
                </Button>
              )
            }}</For>
          </div>
        </section>
        <section class="settings-row">
          <h3 id={accentColorsId} class="text-sm font-medium">{uiText("accent_color")}</h3>
          <p id={accentDescriptionId} class="settings-description">{uiText("accent_color_hint")}</p>
          <div role="group" aria-labelledby={accentColorsId} aria-describedby={accentDescriptionId} class="settings-accent-options">
            <For each={GLOBAL_ACCENT_PRESETS}>{(preset) => (
              <Button
                variant="outline"
                size="sm"
                class="settings-accent-option"
                aria-pressed={theme().globalAccentPreset === preset.id ? "true" : "false"}
                onClick={() => themeStore.getState().setGlobalAccentPreset(preset.id)}
              >
                <span class="settings-color-swatch" style={{ "background-color": preset[theme().themeMode].primary }} aria-hidden="true" />
                {uiText(`accent_${preset.id}`)}
              </Button>
            )}</For>
            <Button
              variant="outline"
              size="sm"
              class="settings-accent-option"
              aria-pressed={theme().globalAccentPreset === "custom" ? "true" : "false"}
              onClick={() => themeStore.getState().setGlobalAccentPreset("custom")}
            >
              <span class="settings-color-swatch" style={{ "background-color": theme().customGlobalAccentColor }} aria-hidden="true" />
              {uiText("accent_custom")}
            </Button>
          </div>
          <div class="settings-accent-custom">
            <label for={customAccentColorId}>{uiText("accent_custom_color")}</label>
            <input
              id={customAccentColorId}
              type="color"
              value={theme().customGlobalAccentColor}
              onInput={(event) => themeStore.getState().setCustomGlobalAccentColor(event.currentTarget.value)}
              onChange={(event) => themeStore.getState().setCustomGlobalAccentColor(event.currentTarget.value)}
            />
            <span>{theme().customGlobalAccentColor.toUpperCase()}</span>
          </div>
          <div class="settings-accent-preview">
            <div class="settings-accent-preview-sample">
              <Button size="sm" style={{ "background-color": accentColors().primary, color: accentColors().primaryForeground }}>
                {uiText("accent_preview")}
              </Button>
              <span
                class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                style={{ "background-color": accentColors().accent, color: accentColors().accentForeground }}
              >
                Active
              </span>
              <span
                class="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium"
                style={{ "border-color": accentColors().primary, color: accentColors().primary }}
              >
                Focus
              </span>
            </div>
            <span class="text-xs text-muted-foreground">{accentColors().primary.toUpperCase()}</span>
          </div>
        </section>
        <section class="settings-row">
          <h3 id={bubbleColorsId} class="text-sm font-medium">{uiText("bubble_colors")}</h3>
          <p id={bubbleDescriptionId} class="settings-description">{uiText("bubble_colors_hint")}</p>
          <div role="group" aria-labelledby={bubbleColorsId} aria-describedby={bubbleDescriptionId} class="settings-bubble-options">
            <For each={USER_MESSAGE_COLOR_PRESETS}>{(preset) => (
              <Button
                variant="outline"
                size="sm"
                class="settings-bubble-option"
                aria-pressed={theme().userMessageColorPreset === preset.id ? "true" : "false"}
                onClick={() => themeStore.getState().setUserMessageColorPreset(preset.id)}
              >
                <span class="settings-color-swatch" style={{ "background-color": preset[theme().themeMode] }} aria-hidden="true" />
                {uiText(`bubble_${preset.id}`)}
              </Button>
            )}</For>
            <Button
              variant="outline"
              size="sm"
              class="settings-bubble-option"
              aria-pressed={theme().userMessageColorPreset === "custom" ? "true" : "false"}
              onClick={() => themeStore.getState().setUserMessageColorPreset("custom")}
            >
              <span class="settings-color-swatch" style={{ "background-color": theme().customUserMessageColor }} aria-hidden="true" />
              {uiText("bubble_custom")}
            </Button>
          </div>
          <div class="settings-bubble-custom">
            <label for={customBubbleColorId}>{uiText("bubble_custom_color")}</label>
            <input
              id={customBubbleColorId}
              type="color"
              value={theme().customUserMessageColor}
              onInput={(event) => themeStore.getState().setCustomUserMessageColor(event.currentTarget.value)}
              onChange={(event) => themeStore.getState().setCustomUserMessageColor(event.currentTarget.value)}
            />
            <span>{theme().customUserMessageColor.toUpperCase()}</span>
          </div>
          <div class="settings-bubble-preview">
            <p style={{ "background-color": bubbleColors().background, color: bubbleColors().foreground }}>
              {uiText("bubble_preview")}
            </p>
          </div>
        </section>
        <section class="settings-row settings-row-responsive">
          <div>
            <h3 id={experienceId} class="text-sm font-medium">{uiText("experience_mode_94057abe")}</h3>
            <p id={experienceDescriptionId} class="settings-description">
              {uiText("simple_mode_hides_advanced_settings_such_as_skills_envi_23e359c3")}
            </p>
          </div>
          <div role="group" aria-labelledby={experienceId} aria-describedby={experienceDescriptionId} class="settings-choice-group">
            <For each={["simple", "advanced"] as const}>{(m) => (
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={experienceMode() === m ? "true" : "false"}
                class="settings-choice settings-choice-mode"
                onClick={() => setExperienceMode(m)}
              >
                {m === "simple" ? uiText("simple_aa55960e") : uiText("advanced_d6e61888")}
              </Button>
            )}</For>
          </div>
        </section>
        <section class="settings-row">
          <h3 class="text-sm font-medium">{uiText("default_model_1e2933c6")}</h3>
          <p class="settings-description settings-description-wide">
            {uiText("configure_defaults_under_providers_default_model_prefer_c7136d2f")}
          </p>
        </section>
      </div>

      <section>
        <h3 class="mb-3 text-sm font-medium">{uiText("usage_statistics_3ce933a3")}</h3>
        {metrics() ? (
          <div class="settings-stat-grid">
            <Stat label={uiText("total_sessions_ef3cbace")} value={metrics()?.total_sessions} />
            <Stat label={uiText("active_dc9591e5")} value={metrics()?.active_sessions} />
            <Stat label={uiText("completed_f28461bb")} value={metrics()?.completed_sessions} />
            <Stat label={uiText("tool_calls_a8ca3c13")} value={metrics()?.total_tool_calls} />
            <Stat label={uiText("errors_01ad2bc5")} value={metrics()?.error_sessions} />
            <Stat label={uiText("tokens_saved_2bc165cb")} value={metrics()?.total_tokens_saved} />
          </div>
        ) : (
          <p class="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
        )}
      </section>

      <section class="settings-about">
        <h3 class="text-muted-foreground">{uiText("about_52d25a9e")}</h3>
        <p class="font-medium">Bodhi · lotus-next</p>
      </section>
    </div>
  )
}
