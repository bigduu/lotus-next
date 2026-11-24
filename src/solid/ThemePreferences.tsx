import { Monitor, Moon, Sun } from "@lucide/solid"
import { createSignal, onSettled } from "solid-js"
import i18n from "@shared/i18n/runtime"
import { uiText } from "@shared/i18n/text"
import { themeStore, type ThemeState } from "@shared/store/themeState"
import { Button } from "./ui/button"
import "@/shared/theme/settings.css"

const choices = [
  { mode: "light", label: "light_aa0819df", Icon: Sun },
  { mode: "dark", label: "dark_a6b75d06", Icon: Moon },
  { mode: "system", label: "system_217cfe7d", Icon: Monitor },
] as const

export function ThemePreferences(props: { preference: ThemeState["themePreference"] }) {
  const [locale, setLocale] = createSignal(i18n.language)
  const text = (key: Parameters<typeof uiText>[0]) => uiText(key, { lng: locale() })

  onSettled(() => {
    const updateLocale = (language: string) => { setLocale(language) }
    i18n.on("languageChanged", updateLocale)
    updateLocale(i18n.language)
    return () => { i18n.off("languageChanged", updateLocale) }
  })

  return (
    <div class="settings-general">
      <div class="settings-preferences">
        <section class="settings-row settings-row-responsive">
          <h2 id="solid-appearance" class="text-sm font-medium">{text("appearance_86a63f23")}</h2>
          <div role="group" aria-labelledby="solid-appearance" class="settings-choice-group">
            {choices.map(({ mode, label, Icon }) => (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={props.preference === mode ? "true" : "false"}
                class="settings-choice"
                onClick={() => themeStore.getState().setThemePreference(mode)}
              >
                <Icon aria-hidden="true" class="size-4" />
                {text(label)}
              </Button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
