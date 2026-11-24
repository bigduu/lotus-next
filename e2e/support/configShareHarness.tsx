/** Isolated development fixture: all backend requests are intercepted by the test. */
import { render } from "@solidjs/web"
import "../../src/solid/styles.css"
import { resolveDefaultBrowserRuntimeConfig } from "../../src/runtime/browserRuntime"
import { installRuntimeConfig } from "../../src/runtime/runtimeConfig"
import { changeLocale, i18nReady } from "../../src/shared/i18n/runtime"
import { uiText } from "../../src/shared/i18n/text"

installRuntimeConfig(resolveDefaultBrowserRuntimeConfig())
const { SettingsConfigShare } = await import("../../src/solid/settings/config-share/SettingsConfigShare")
await i18nReady
await changeLocale("en-US")
document.documentElement.classList.add("dark")
render(() => <main class="h-dvh space-y-3 overflow-y-auto p-4">
  <h2 class="text-lg font-semibold">{uiText("share_title")}</h2>
  <SettingsConfigShare />
</main>, document.getElementById("root")!)
