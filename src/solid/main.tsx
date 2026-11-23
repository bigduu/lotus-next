import { render } from "@solidjs/web"
import i18n, { i18nReady } from "@shared/i18n/runtime"
import { themeStore } from "@shared/store/themeState"
import "../index.css"
import { applyTheme, ThemePreferences } from "./ThemePreferences"

const container = document.getElementById("root")
if (!container) throw new Error("Lotus Next root element is missing.")

applyTheme(themeStore.getState())

void i18nReady.then(() => {
  render(() => (
    <main class="mx-auto grid w-full max-w-4xl gap-6 px-4 py-6 sm:px-8">
      <h1 class="text-xl font-semibold">{i18n.t("settings.page.title")}</h1>
      <ThemePreferences />
    </main>
  ), container)
}).catch((error: unknown) => {
  console.error("[lotus-solid] Failed to load application translations:", error)
  container.textContent = "Lotus Next could not start."
})
