import { expect, test, type Page } from "@playwright/test"
import type { NovaAppSetupReport } from "../src/services/plugin/types.js"
import { NOVA_PLUGIN } from "../src/components/chat/settings/plugins/officialPlugins.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

// Built frontend and fixture HTTP responses only. This does not install a
// native app, sign an executable, restart MCP, or validate macOS permissions.
const setup = (installed = false): NovaAppSetupReport => ({
  plugin_id: "nova", host: { os: "macos", arch: "aarch64", supported: true, reason: null },
  connector: { state: "verified", version: "0.3.1", reason: null }, capability: { supported: true, reason: null },
  app: installed ? { success: true, state: "installed", message: "Fixture app found", next_action: "Open and grant permissions",
    path: "/Applications/Nova.app", version: "0.3.1", signing: "ad_hoc", development: true, connector_compatible: true }
    : { success: true, state: "missing", message: "Fixture app missing", next_action: "Explicit install" },
  install: { available: !installed, reason: installed ? "app_not_missing" : null },
  artifact: { artifact_id: "fixture-reviewed-app", version: "0.3.1", url: "https://fixture.invalid/app.zip", sha256: "a".repeat(64), signing: "ad_hoc", install_mode: "local_ad_hoc", development: true },
  manual_guidance: "Open Nova.app and grant permissions manually", desktop_server_id: "nova", desktop_readiness: "not_tested",
})
const plugin = { id: "nova", name: "Nova Desktop Automation", version: "0.3.1", status: "installed", source: NOVA_PLUGIN.source, registered: { mcp_server_ids: ["nova", "nova-chrome-devtools"] } }
const server = (id: string, enabled: boolean) => ({
  id, name: id === "nova" ? "Nova Desktop Automation" : "Chrome sidecar", enabled,
  config: { id, enabled, transport: { type: "stdio", command: "/fixture/nova", args: ["mcp"], env: {} } },
  runtime: { status: "stopped", tool_count: 0 },
})
async function openPlugins(page: Page) {
  const settings = page.getByRole("button", { name: "系统设置", exact: true })
  const bounds = await settings.boundingBox()
  if (!bounds || bounds.x < 0 || bounds.x + bounds.width > (page.viewportSize()?.width ?? Infinity)) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await settings.click()
  const categories = page.locator("#settings-category")
  await categories.waitFor({ state: "attached" })
  if (await categories.isVisible()) await categories.selectOption("plugins")
  else await page.getByRole("button", { name: "插件", exact: true }).click()
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
    localStorage.setItem("copilot_ui_theme_v1", "light")
  })
})

test("Nova explicitly installs the selected app, reconciles a lost response, and reconnects only its enabled desktop ID", async ({ page }, testInfo) => {
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let report = setup()
  let unavailable = false
  const posts: { path: string; body: unknown }[] = []
  await page.route("**/api/v1/plugins**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith("/nova/app")) return route.fulfill(unavailable ? { status: 503, json: { error: "Fixture status unavailable" } } : { json: report })
    if (path.endsWith("/jiandu/setup")) return route.fulfill({ status: 404, json: { error: "Not Found" } })
    if (route.request().method() === "GET") return route.fulfill({ json: { plugins: [plugin] } })
    posts.push({ path, body: route.request().postDataJSON() })
    report = setup(true); unavailable = true
    return route.fulfill({ status: 500, json: { error: "Fixture response lost after install" } })
  })
  await page.route("**/api/v1/mcp/servers**", async (route) => {
    if (route.request().method() === "POST") {
      posts.push({ path: new URL(route.request().url()).pathname, body: route.request().postData() })
      return route.fulfill({ json: { server_id: "nova", message: "Server connected" } })
    }
    return route.fulfill({ json: { servers: [server("nova", true), server("nova-chrome-devtools", false)] } })
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  await openPlugins(page)
  const card = page.getByRole("article", { name: "Nova", exact: true })
  await expect(card).toContainText("本机自签名（ad-hoc）")
  await expect(card).toContainText("更新后可能需要重新授权")
  await expect(card.getByRole("button", { name: "重连 Nova 桌面连接" })).toHaveCount(0)
  await testInfo.attach(`nova-discover-${testInfo.project.name}`, { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" })
  await card.getByRole("button", { name: "安装 Nova.app（本地 ad-hoc）" }).click()
  await expect(page.getByRole("alert")).toContainText("尚未确认 Nova.app 安装结果")
  await expect(card.getByRole("button", { name: "安装 Nova.app（本地 ad-hoc）" })).toBeDisabled()
  unavailable = false
  await page.getByRole("button", { name: "刷新插件与连接", exact: true }).click()
  await expect(page.getByRole("alert")).toHaveCount(0)
  await expect(card).toContainText("已检测到 Nova.app")
  await card.getByRole("button", { name: "管理已安装插件" }).click()
  const installed = page.getByRole("listitem", { name: "Nova Desktop Automation", exact: true })
  await installed.getByRole("button", { name: "重连 Nova 桌面连接" }).click()
  await expect(installed).toContainText("重连请求已发送，请查看实际连接状态")
  await expect(installed).toContainText("尚未验证桌面权限")
  await expect(installed).toContainText("已停止")
  await expect(installed.getByRole("switch", { name: "Chrome sidecar 连接" })).not.toBeChecked()
  expect(posts).toEqual([
    { path: "/api/v1/plugins/nova/app/install", body: { artifact_id: "fixture-reviewed-app" } },
    { path: "/api/v1/mcp/servers/nova/connect", body: null },
  ])
  await testInfo.attach(`nova-installed-${testInfo.project.name}`, { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" })
  expect(await page.evaluate(() => {
    const browser = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }
    return browser.document.documentElement.scrollWidth <= browser.innerWidth + 1
  })).toBe(true)
  expect(observation.pageErrors).toEqual([])
})

for (const state of ["legacy-backend", "legacy-cli", "unknown", "windows", "linux", "existing-app", "missing-artifact"]) {
  test(`Nova ${state} withholds app installation and keeps truthful guidance`, async ({ page }) => {
    await installArtifactRuntime(page, standaloneScenario)
    const report = setup(state === "existing-app")
    report.install = { available: false, reason: "artifact_unavailable" }
    if (state === "legacy-cli" || state === "unknown") {
      report.app = null
      const reason = state === "legacy-cli" ? "legacy_cli_unavailable" : "status_timeout"
      report.capability = { supported: false, reason }; report.install.reason = reason
    }
    if (state === "windows" || state === "linux") {
      const reason = state === "windows" ? "app_not_required" : "unsupported_host"
      report.host = { os: state, arch: "x86_64", supported: false, reason }
      report.app = null; report.capability = { supported: false, reason }; report.install.reason = reason
    }
    if (state === "existing-app") report.app = { ...report.app!, version: "0.2.1", connector_compatible: false }
    if (state === "missing-artifact") report.artifact = null
    const posts: string[] = []
    await page.route("**/api/v1/plugins**", async (route) => {
      if (route.request().method() !== "GET") posts.push(route.request().url())
      if (route.request().url().endsWith("/nova/app")) return route.fulfill(state === "legacy-backend" ? { status: 404, json: { error: "Not Found" } } : { json: report })
      if (route.request().url().endsWith("/jiandu/setup")) return route.fulfill({ status: 404, json: { error: "Not Found" } })
      return route.fulfill({ json: { plugins: [plugin] } })
    })
    await page.goto(standaloneScenario.entryUrl)
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
    await openPlugins(page)
    const card = page.getByRole("article", { name: "Nova", exact: true })
    const messages: Record<string, string> = { "legacy-backend": "尚不支持 Nova.app 设置", "legacy-cli": "当前连接器不支持应用设置", unknown: "无法确认 Nova.app 状态", windows: "无需单独安装 Nova.app", linux: "支持运行 macOS", "existing-app": "现有应用将保留", "missing-artifact": "尚无已接受的匹配应用安装包" }
    await expect(card).toContainText(messages[state])
    if (["windows", "linux", "existing-app"].includes(state)) await expect(card.getByRole("button", { name: "安装 Nova.app（本地 ad-hoc）" })).toHaveCount(0)
    else await expect(card.getByRole("button", { name: "安装 Nova.app（本地 ad-hoc）" })).toBeDisabled()
    if (state === "existing-app") {
      await expect(card).toContainText("v0.2.1")
      await expect(card.getByRole("button", { name: "重连 Nova 桌面连接" })).toBeDisabled()
    }
    expect(posts).toEqual([])
  })
}
