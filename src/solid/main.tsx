import { createSignal, onSettled } from "solid-js"
import { render } from "@solidjs/web"
import i18n, { i18nReady } from "@shared/i18n/runtime"
import { themeStore, type ThemeState } from "@shared/store/themeState"
import "../index.css"
import { ConversationPreview } from "./ConversationPreview"
import { ThemePreferences } from "./ThemePreferences"
import { getUserMessageColors } from "@shared/theme/userMessageColors"

const container = document.getElementById("root")
if (!container) throw new Error("Lotus Next root element is missing.")

function applyTheme(state: ThemeState) {
  const root = document.documentElement
  root.classList.toggle("dark", state.themeMode === "dark")
  const colors = getUserMessageColors(state.themeMode, state.userMessageColorPreset, state.customUserMessageColor)
  root.style.setProperty("--user-message-background", colors.background)
  root.style.setProperty("--user-message-foreground", colors.foreground)
}

function Preview() {
  const [theme, setTheme] = createSignal(themeStore.getState())
  onSettled(() => {
    const update = (state: ThemeState) => {
      applyTheme(state)
      setTheme(state)
    }
    const unsubscribe = themeStore.subscribe(update)
    update(themeStore.getState())
    return unsubscribe
  })

  return (
    <main class="mx-auto grid w-full max-w-4xl gap-6 px-4 py-6 sm:px-8">
      <h1 class="text-xl font-semibold">{i18n.t("settings.page.title")}</h1>
      <ThemePreferences preference={theme().themePreference} />
      <ConversationPreview theme={theme().themeMode} />
    </main>
  )
}

applyTheme(themeStore.getState())

void i18nReady.then(() => {
  render(() => <Preview />, container)
}).catch((error: unknown) => {
  console.error("[lotus-solid] Failed to load application translations:", error)
  container.textContent = "Lotus Next could not start."
})
