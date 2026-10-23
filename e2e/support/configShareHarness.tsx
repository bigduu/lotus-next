/** Isolated development fixture: all backend requests are intercepted by the test. */
import { createRoot } from "react-dom/client"
import "../../src/index.css"
import { resolveDefaultBrowserRuntimeConfig } from "../../src/runtime/browserRuntime"
import { installRuntimeConfig } from "../../src/runtime/runtimeConfig"

installRuntimeConfig(resolveDefaultBrowserRuntimeConfig())
const [{ SettingsContent }, { changeLocale, i18nReady }] = await Promise.all([
  import("../../src/components/chat/Settings"), import("../../src/shared/i18n"),
])
await i18nReady
await changeLocale("en-US")
document.documentElement.classList.add("dark")
createRoot(document.getElementById("root")!).render(<main style={{ height: "100dvh", padding: "1rem" }}>
  <SettingsContent tab="config-share" onTabChange={() => {}} />
</main>)
