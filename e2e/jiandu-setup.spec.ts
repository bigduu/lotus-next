import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

// Built frontend + fixture APIs and clipboard only. This does not certify a
// published download, native executable, OS clipboard, or an external MCP host.
const setup = (ready = false) => ({
  plugin_id: "jiandu", host: { os: "linux", arch: "x86_64", libc: "2.35", supported: true, reason: null as string | null },
  release: { version: "0.3.2", manifest_url: "https://fixture.invalid/jiandu.tar.gz", sha256: "a".repeat(64) },
  trust: { trusted: true, reason: null as string | null }, install: { available: !ready, reason: ready ? "already_installed" : null },
  installed: { state: ready ? "ready" : "missing", version: ready ? "0.3.2" : null, reason: null as string | null },
  external_client: ready ? { command: "/fixture/jiandu/bin/linux/jiandu", args: ["--data-dir", "/fixture/custom memory"] } : null,
})
const plugin = { id: "jiandu", name: "Jiandu Memory Connector", version: "0.3.2", status: "installed", source: { type: "url", url: "https://fixture.invalid/jiandu.tar.gz" }, registered: {} }
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
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value: string) => {
      (globalThis as unknown as { fixtureCopied: string }).fixtureCopied = value
    } } })
  })
})

test("Jiandu reconciles an uncertain installation and copies the fresh same-host configuration", async ({ page }, testInfo) => {
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let report = setup()
  let installed = false
  let failSetupOnce = false
  const posts: { path: string; body: unknown }[] = []
  await page.route("**/api/v1/plugins**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith("/jiandu/setup")) {
      if (failSetupOnce) { failSetupOnce = false; return route.fulfill({ status: 503, json: { error: "Fixture setup unavailable" } }) }
      return route.fulfill({ json: report })
    }
    if (route.request().method() === "GET") return route.fulfill({ json: { plugins: installed ? [plugin] : [] } })
    posts.push({ path, body: route.request().postDataJSON() })
    installed = true; report = setup(true); failSetupOnce = true
    return route.fulfill({ status: 500, json: { error: "Fixture response lost after install" } })
  })
  await page.route("**/api/v1/mcp/servers**", (route) => route.fulfill({ json: { servers: [] } }))
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  await openPlugins(page)
  const card = page.getByRole("article", { name: "Jiandu", exact: true })
  await expect(card).toContainText("基础记忆已内置")
  await expect(card).toContainText("不会向 Bamboo 添加第二个记忆连接")
  await expect(card.getByRole("button", { name: "安装 Jiandu 连接器" })).toBeEnabled()
  await testInfo.attach(`jiandu-discover-${testInfo.project.name}`, { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" })
  await card.getByRole("button", { name: "安装 Jiandu 连接器" }).click()
  await expect(page.getByRole("alert")).toContainText("尚未确认 Jiandu")
  await expect(card.getByRole("button", { name: "安装 Jiandu 连接器" })).toBeDisabled()
  await page.getByRole("button", { name: "刷新插件与连接", exact: true }).click()
  await expect(card.getByRole("button", { name: "复制 MCP 配置" })).toBeEnabled()
  await expect(page.getByRole("alert")).toHaveCount(0)
  await expect(card).toContainText("同一台电脑")
  report = { ...setup(true), external_client: { command: "/new/managed/jiandu", args: ["--data-dir", '/new/active memory/"shared"'] } }
  await card.getByRole("button", { name: "复制 MCP 配置" }).click()
  await expect(card).toContainText("已复制配置")
  expect(await page.evaluate(() => (globalThis as unknown as { fixtureCopied: string }).fixtureCopied)).toBe(JSON.stringify({ mcpServers: { jiandu: report.external_client } }, null, 2))
  expect(posts).toEqual([{ path: "/api/v1/plugins/official/jiandu/install", body: {} }])
  await testInfo.attach(`jiandu-config-${testInfo.project.name}`, { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" })
  expect(await page.evaluate(() => {
    const browser = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }
    return browser.document.documentElement.scrollWidth <= browser.innerWidth + 1
  })).toBe(true)
  expect(observation.pageErrors).toEqual([])
})

for (const state of ["legacy", "unsupported", "untrusted", "unverified", "installing"]) {
  test(`Jiandu ${state} setup withholds install and client configuration`, async ({ page }) => {
    await installArtifactRuntime(page, standaloneScenario)
    const report = setup()
    report.install.available = false
    if (state === "unsupported") report.host = { ...report.host, supported: false, reason: "unsupported_host" }
    if (state === "untrusted") report.trust = { trusted: false, reason: "publisher_not_trusted" }
    if (state === "unverified" || state === "installing") report.installed = { state, version: "0.3.2", reason: state === "installing" ? "incomplete_install" : "invalid_managed_files" }
    const posts: string[] = []
    await page.route("**/api/v1/plugins**", async (route) => {
      if (route.request().method() !== "GET") posts.push(route.request().url())
      if (route.request().url().endsWith("/jiandu/setup")) return route.fulfill(state === "legacy" ? { status: 404, json: { error: "Not Found" } } : { json: report })
      return route.fulfill({ json: { plugins: [] } })
    })
    await page.goto(standaloneScenario.entryUrl)
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
    await openPlugins(page)
    const card = page.getByRole("article", { name: "Jiandu", exact: true })
    await expect(card).toContainText("基础记忆已内置")
    const messages: Record<string, string> = { legacy: "请先更新服务", unsupported: "不支持此连接器版本", untrusted: "尚未信任", unverified: "尚未通过验证", installing: "安装尚未完成" }
    await expect(card).toContainText(messages[state])
    await expect(card.getByRole("button", { name: "安装 Jiandu 连接器" })).toBeDisabled()
    await expect(card.getByRole("button", { name: "复制 MCP 配置" })).toHaveCount(0)
    expect(posts).toEqual([])
  })
}
