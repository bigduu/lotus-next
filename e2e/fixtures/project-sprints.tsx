import { useState } from "react"
import { createRoot } from "react-dom/client"
import "../../src/index.css"
import { changeLocale } from "../../src/shared/i18n"
import { OwnerAccessContext } from "../../src/hooks/ownerAccessContext"
import { createRuntimeConfig, installRuntimeConfig } from "../../src/runtime/runtimeConfig"
import type { ProjectManifest } from "../../src/services/project"

const parameters = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", parameters.get("theme") === "dark")
installRuntimeConfig(createRuntimeConfig({
  host: { kind: "browser", capabilities: { nativeFileSystem: false, nativeNotifications: false, externalShell: false, sidecarBackend: false } },
  endpointSource: "page-origin", backendBaseUrl: location.origin, mode: "test", development: false,
}))
const { ProjectWorkBoard } = await import("../../src/components/app/ProjectWorkBoard")
await changeLocale(parameters.get("locale") === "en-US" ? "en-US" : "zh-CN")
const project = {
  id: parameters.get("project") ?? "fa4c5a43-b6fb-479f-9cdf-c2391fe78889",
  name: "合成 Project · Sprint 规划与历史观察",
  revision: 1, resource_revision: 1, workspace_bindings: [], status: "active",
} as unknown as ProjectManifest

export function Fixture() {
  const [visible, setVisible] = useState(true)
  return <main style={{ width: "100%", maxWidth: 1280, boxSizing: "border-box", margin: "0 auto", padding: 12 }}>
    <header style={{ padding: 16, overflowWrap: "anywhere" }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Sprint 看板浏览器验收</h1>
      <p style={{ marginTop: 8, fontSize: 13 }}>MOCK HTTP · Real ProjectWorkBoard + ProjectSprintPanel + owner forms. Controlled variations of the frozen #2052 capture. No live Bamboo, model, worker, or provider execution.</p>
      <p data-testid="fixture-source" style={{ marginTop: 8, fontSize: 12 }}>Source: {parameters.get("source") ?? "working tree"} · {parameters.get("theme") ?? "light"} theme</p>
      <button type="button" data-testid="fixture-toggle-board" onClick={() => setVisible((value) => !value)} style={{ marginTop: 12, border: "1px solid currentColor", borderRadius: 6, padding: "6px 10px" }}>{visible ? "关闭合成看板" : "重新打开合成看板"}</button>
    </header>
    <OwnerAccessContext.Provider value={parameters.get("owner") !== "denied"}>
      {visible ? <ProjectWorkBoard key={project.id} project={project} /> : null}
    </OwnerAccessContext.Provider>
  </main>
}
createRoot(document.getElementById("root")!).render(<Fixture />)
