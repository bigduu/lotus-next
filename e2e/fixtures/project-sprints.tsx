import { createSignal, Show } from "solid-js"
import { render } from "@solidjs/web"
import "../../src/solid/styles.css"
import { changeLocale } from "../../src/shared/i18n/runtime"
import { createRuntimeConfig, installRuntimeConfig } from "../../src/runtime/runtimeConfig"
import type { ProjectManifest } from "../../src/services/project"

const parameters = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", parameters.get("theme") === "dark")
installRuntimeConfig(createRuntimeConfig({
  host: { kind: "browser", capabilities: { nativeFileSystem: false, nativeNotifications: false, externalShell: false, sidecarBackend: false } },
  endpointSource: "page-origin", backendBaseUrl: location.origin, mode: "test", development: false,
}))
const { ProjectWorkBoard } = await import("../../src/solid/project-work/ProjectWorkBoard")
await changeLocale(parameters.get("locale") === "en-US" ? "en-US" : "zh-CN")
const project = {
  id: parameters.get("project") ?? "fa4c5a43-b6fb-479f-9cdf-c2391fe78889",
  name: "合成 Project · Sprint 规划与历史观察",
  revision: 1, resource_revision: 1, workspace_bindings: [], status: "active",
} as unknown as ProjectManifest

export function Fixture() {
  const [visible, setVisible] = createSignal(true)
  return <main style={{ width: "100%", "max-width": "1280px", "box-sizing": "border-box", margin: "0 auto", padding: "12px" }}>
    <header style={{ padding: "16px", "overflow-wrap": "anywhere" }}>
      <h1 style={{ "font-size": "20px", "font-weight": "600" }}>Sprint 看板浏览器验收</h1>
      <p style={{ "margin-top": "8px", "font-size": "13px" }}>MOCK HTTP · Real ProjectWorkBoard + ProjectSprintPanel + owner forms. Controlled variations of the frozen #2052 capture. No live Bamboo, model, worker, or provider execution.</p>
      <p data-testid="fixture-source" style={{ "margin-top": "8px", "font-size": "12px" }}>Source: {parameters.get("source") ?? "working tree"} · {parameters.get("theme") ?? "light"} theme</p>
      <button type="button" data-testid="fixture-toggle-board" onClick={() => setVisible((value) => !value)} style={{ "margin-top": "12px", border: "1px solid currentColor", "border-radius": "6px", padding: "6px 10px" }}>{visible() ? "关闭合成看板" : "重新打开合成看板"}</button>
    </header>
    <Show when={visible()}><ProjectWorkBoard project={project} ownerAccess={parameters.get("owner") !== "denied"} /></Show>
  </main>
}
render(() => <Fixture />, document.getElementById("root")!)
