import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

async function pluginFixture(page: Page, baseURL: string | undefined) {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  await page.route("**/api/v1/metrics/summary", (route) => route.fulfill({ json: { total_sessions: 0 } }))
  return { entryUrl, observation }
}

async function openPlugins(page: Page, entryUrl: string, isMobile: boolean) {
  await page.goto(entryUrl)
  if (isMobile) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await page.getByRole("button", { name: "系统设置", exact: true }).click()
  const settings = page.locator('[data-slot="settings-page"]')
  if (isMobile) await settings.getByRole("combobox", { name: "系统设置" }).selectOption("plugins")
  else await settings.getByRole("button", { name: "插件", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "插件", exact: true })).toBeVisible()
  return settings
}

const source = { type: "url", url: "https://fixture.invalid/plugin.zip" }
const fixturePlugin = { id: "fixture-plugin", name: "Fixture runtime", version: "1.0", status: "installed", source,
  registered: { mcp_server_ids: ["fixture-runtime"], skill_dirs: ["fixture-skill"] },
}
const runtime = (enabled: boolean) => ({
  id: "fixture-runtime", name: "Fixture runtime", enabled,
  config: { id: "fixture-runtime", enabled, transport: { type: "stdio", command: "/fixture/runtime", args: [], env: {} } },
  runtime: { status: enabled ? "ready" : "stopped", tool_count: 0 },
})

test("Solid plugins use confirmed inventory for install, runtime changes, update and deletion", async ({ page, baseURL, isMobile }) => {
  const { entryUrl, observation } = await pluginFixture(page, baseURL)
  let installed = false, enabled = false, available = true
  const actions: { path: string; body: unknown }[] = []
  await page.route("**/api/v1/plugins**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === "/api/v1/plugins" && request.method() === "GET") {
      return route.fulfill(available ? { json: { plugins: installed ? [fixturePlugin] : [] } } : { status: 503, json: {} })
    }
    if (path === "/api/v1/plugins/install") installed = true
    else if (path === `/api/v1/plugins/${fixturePlugin.id}` && request.method() === "DELETE") installed = false
    else if (path !== `/api/v1/plugins/${fixturePlugin.id}/update`) return route.fulfill({ status: 404, json: {} })
    actions.push({ path, body: request.postDataJSON() })
    return route.fulfill({ json: fixturePlugin })
  })
  await page.route("**/api/v1/mcp/servers**", (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith("/connect")) {
      actions.push({ path, body: route.request().postDataJSON() })
      enabled = true
      return route.fulfill({ status: 503, json: { error: "fixture lost the applied response" } })
    }
    return route.fulfill({ json: { servers: installed ? [runtime(enabled)] : [] } })
  })

  const settings = await openPlugins(page, entryUrl, isMobile)
  const install = settings.getByRole("button", { name: "高级安装", exact: true })
  await expect(install).toBeEnabled()
  expect(actions).toEqual([])
  await install.click()
  const create = page.getByRole("dialog", { name: "安装插件", exact: true })
  await create.getByRole("textbox", { name: "URL", exact: true }).fill(source.url)
  await create.getByRole("button", { name: "安装", exact: true }).click()
  await expect(create).toBeHidden()
  const card = settings.getByRole("listitem", { name: "Fixture runtime", exact: true })
  await expect(card).toBeVisible()
  const toggle = card.getByRole("switch", { name: "Fixture runtime 连接", exact: true })
  await expect(toggle).not.toBeChecked()
  await toggle.press("Space")
  await expect(toggle).toBeChecked()
  await expect(card.getByText("已连接", { exact: true })).toBeVisible()
  await expect(settings.getByText("无法确认连接变更结果", { exact: false })).toBeHidden()

  const update = card.getByRole("button", { name: "更新", exact: true })
  available = false
  await settings.getByRole("button", { name: "刷新插件与连接", exact: true }).click()
  await expect(update).toBeDisabled()
  await expect(install).toBeDisabled()
  await expect(toggle).toBeDisabled()
  available = true
  await settings.getByRole("button", { name: "刷新插件与连接", exact: true }).click()
  await update.click()
  const edit = page.getByRole("dialog", { name: "更新插件「Fixture runtime」", exact: true })
  await expect(edit.getByRole("textbox", { name: "URL", exact: true })).toHaveValue(source.url)
  await edit.getByRole("button", { name: "本地目录", exact: true }).click()
  await edit.getByRole("textbox", { name: "本地目录路径", exact: true }).fill("/fixture/new-plugin")
  await edit.getByRole("button", { name: "更新", exact: true }).click()
  await expect(edit).toBeHidden()
  await card.getByRole("button", { name: "删除", exact: true }).click()
  const deletion = page.getByRole("dialog", { name: "删除插件", exact: true })
  await deletion.getByRole("button", { name: "删除", exact: true }).click()
  await expect(deletion).toBeHidden()
  await expect(card).toBeHidden()
  expect(actions).toEqual([
    { path: "/api/v1/plugins/install", body: { source } },
    { path: "/api/v1/mcp/servers/fixture-runtime/connect", body: null },
    { path: "/api/v1/plugins/fixture-plugin/update", body: { source: { type: "local_dir", path: "/fixture/new-plugin" } } },
    { path: "/api/v1/plugins/fixture-plugin", body: null },
  ])
  expect(observation.pageErrors).toEqual([])
})

test("Solid publisher confirmation pins the reviewed revision and catalog", async ({ page, baseURL, isMobile }) => {
  const { entryUrl, observation } = await pluginFixture(page, baseURL)
  const publisher = { id: "jiandu", key: { label: "Fixture publisher", algorithm: "ed25519", public_key: "ab".repeat(32) }, trusted: true, revoked: false }
  let revision = 7, mode = "follow_defaults"
  const changes: unknown[] = []
  await page.route("**/api/v1/plugins**", (route) => route.fulfill(new URL(route.request().url()).pathname === "/api/v1/plugins"
    ? { json: { plugins: [] } } : { status: 404, json: {} }))
  await page.route("**/api/v1/plugins/publishers", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { expected_revision: revision, publisher_mode: mode, enforcement: "strict", custom_key_count: 0, publishers: [publisher] } })
    }
    changes.push(route.request().postDataJSON())
    revision += 1
    if (revision === 8) return route.fulfill({ status: 409, json: {} })
    mode = "explicit"
    return route.fulfill({ status: 503, json: {} })
  })
  await page.route("**/api/v1/mcp/servers", (route) => route.fulfill({ json: { servers: [] } }))
  const settings = await openPlugins(page, entryUrl, isMobile)
  await settings.getByRole("button", { name: "发布者信任", exact: true }).click()
  const explicit = settings.getByRole("button", { name: "使用自定义信任列表", exact: true })
  const review = page.getByRole("dialog", { name: "确认发布者策略更改", exact: true })
  await explicit.click()
  await expect(review.getByText(publisher.key.public_key)).toBeVisible()
  await review.getByRole("button", { name: "取消", exact: true }).click()
  expect(changes).toEqual([])
  await explicit.click()
  await review.getByRole("button", { name: "确认策略更改", exact: true }).click()
  await expect(settings.getByText("策略在确认后已变化", { exact: false })).toBeVisible()
  await explicit.click()
  await review.getByRole("button", { name: "确认策略更改", exact: true }).click()
  await expect(settings.getByText("自定义信任列表", { exact: true })).toBeVisible()
  await expect(settings.getByText("尚无法确认更改结果", { exact: false })).toBeHidden()
  expect(changes).toEqual([7, 8].map((expected_revision) => ({ expected_revision,
    expected_publishers: { jiandu: `ed25519:${publisher.key.public_key}` },
    change: { type: "set_mode", publisher_mode: "explicit" },
  })))
  expect(observation.pageErrors).toEqual([])
})

test("Solid official plugin actions require reviewed host and freshly verified setup", async ({ page, baseURL, isMobile }) => {
  const { entryUrl, observation } = await pluginFixture(page, baseURL)
  const writes: { path: string; body: unknown }[] = []
  let trusted = false, installed = false, validInstallation = true
  const publicKey = "de".repeat(32)
  const otherClient = { command: "/fixture/jiandu", args: ["--data-dir", "/fixture/current-memory"] }
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (value: string) => localStorage.setItem("fixture-copied-jiandu", value),
  } }))
  await page.route("**/api/v1/plugins**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === "/api/v1/plugins") return route.fulfill({ json: { plugins: [] } })
    if (path === "/api/v1/plugins/jiandu/setup") {
      const ready = installed && validInstallation
      const publisherReason = trusted ? null : "publisher_not_trusted"
      return route.fulfill({ json: {
        plugin_id: "jiandu", host: { os: "linux", arch: "x86_64", libc: "2.35", supported: true, reason: null },
        release: { version: "1.0", manifest_url: "https://fixture.invalid/jiandu", sha256: "a".repeat(64) },
        trust: { trusted, reason: publisherReason }, install: { available: trusted && !installed, reason: publisherReason },
        installed: { state: ready ? "ready" : installed ? "unverified" : "missing", version: ready ? "1.0" : null, reason: null },
        trust_action: { available: !trusted, reason: trusted ? "publisher_already_trusted" : null, expected_revision: trusted ? 8 : 7,
          publisher: { label: "Fixture Jiandu", algorithm: "ed25519", public_key: publicKey } },
        external_client: ready ? otherClient : null,
      } })
    }
    if (path === "/api/v1/plugins/official/jiandu/trust") trusted = true
    else if (path === "/api/v1/plugins/official/jiandu/install") installed = true
    else return route.fulfill({ status: 404, json: {} })
    writes.push({ path, body: request.postDataJSON() })
    return route.fulfill({ status: 503, json: {} })
  })
  await page.route("**/api/v1/mcp/servers", (route) => route.fulfill({ json: { servers: [] } }))
  const settings = await openPlugins(page, entryUrl, isMobile)
  const jiandu = settings.getByRole("article", { name: "Jiandu" })
  const install = jiandu.getByRole("button", { name: "安装 Jiandu 连接器", exact: true })
  await expect(install).toBeDisabled()
  await jiandu.getByRole("button", { name: "信任 Jiandu 官方发布者", exact: true }).click()
  const review = page.getByRole("dialog", { name: "信任 Jiandu 官方发布者", exact: true })
  await expect(review.getByText("Bamboo 主机：linux / x86_64", { exact: true })).toBeVisible()
  await expect(review.getByText(publicKey, { exact: true })).toBeVisible()
  expect(writes).toEqual([])
  await review.getByRole("button", { name: "确认信任发布者", exact: true }).click()
  await expect(install).toBeEnabled()
  expect(writes).toEqual([{ path: "/api/v1/plugins/official/jiandu/trust", body: { expected_revision: 7, expected_public_key: publicKey } }])
  await install.click()
  const copy = jiandu.getByRole("button", { name: "复制 MCP 配置", exact: true })
  await expect(copy).toBeEnabled()
  validInstallation = false
  await copy.click()
  await expect(jiandu.getByRole("alert")).toContainText("连接器已无法通过验证，未复制配置")
  expect(await page.evaluate(() => localStorage.getItem("fixture-copied-jiandu"))).toBeNull()
  validInstallation = true
  await settings.getByRole("button", { name: "刷新插件与连接", exact: true }).click()
  await expect(copy).toBeEnabled()
  otherClient.args[1] = "/fixture/fresh-memory"
  await copy.click()
  await expect(jiandu.getByText("已复制配置", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("fixture-copied-jiandu")!))).toEqual({ mcpServers: { jiandu: otherClient } })
  expect(writes).toHaveLength(2)
  expect(writes[1]).toEqual({ path: "/api/v1/plugins/official/jiandu/install", body: {} })
  expect(observation.pageErrors).toEqual([])
})

test("Solid Nova uses the reviewed artifact and rechecks before start or reconnect", async ({ page, baseURL, isMobile }) => {
  const { entryUrl, observation } = await pluginFixture(page, baseURL)
  const writes: { path: string; body: unknown }[] = []
  let installed = false, enabled = true
  let observedAt = "2026-11-09T00:00:00Z"
  const artifactId = "fixture-reviewed-archive"
  const setup = () => ({
    plugin_id: "nova", host: { os: "macos", arch: "aarch64", supported: true, reason: null },
    connector: { state: "verified", version: "1.0", reason: null }, capability: { supported: true, reason: null },
    app: { success: true, state: installed ? "installed" : "missing", message: "Fixture", next_action: "Fixture",
      ...(installed ? { path: "/Applications/Nova.app", version: "1.0", signing: "ad_hoc", development: true, connector_compatible: true } : {}) },
    install: { available: !installed, reason: installed ? "app_not_missing" : null },
    artifact: { artifact_id: artifactId, version: "1.0", url: "https://fixture.invalid/nova.zip", sha256: "b".repeat(64),
      signing: "ad_hoc", install_mode: "local_ad_hoc", development: true },
    start: { available: installed, reason: installed ? null : "app_missing" }, desktop_readiness: "not_tested",
    desktop_server_id: "fixture-runtime", manual_guidance: "Grant permissions manually",
    observation: { schema_version: 1, observed_at: observedAt, app_runtime: "not_verified", permissions: "not_verified",
      mcp: { server_id: "fixture-runtime", state: "ready", tool_count: 1, configuration_applied: "not_verified" } },
  })
  await page.route("**/api/v1/plugins**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === "/api/v1/plugins") return route.fulfill({ json: { plugins: [] } })
    if (path === "/api/v1/plugins/nova/app") return route.fulfill({ json: setup() })
    if (path.includes("/nova/app/")) writes.push({ path, body: request.postDataJSON() })
    if (path.endsWith("/install")) return route.fulfill({ status: 409, json: { error: { reason: "archive_checksum_mismatch" } } })
    if (path.endsWith("/start")) return route.fulfill({ json: { action: "start_requested", setup: setup() } })
    return route.fulfill({ status: 404, json: {} })
  })
  await page.route("**/api/v1/mcp/servers**", (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== "GET") writes.push({ path, body: route.request().postDataJSON() })
    return route.fulfill({ json: { servers: [runtime(enabled)] } })
  })
  const settings = await openPlugins(page, entryUrl, isMobile)
  const nova = settings.getByRole("article", { name: "Nova" })
  await nova.getByRole("button", { name: "安装 Nova.app（本地 ad-hoc）", exact: true }).click()
  await expect(settings.getByRole("alert")).toContainText("归档与服务端接受的校验和不一致")
  installed = true
  await settings.getByRole("button", { name: "刷新插件与连接", exact: true }).click()
  const start = nova.getByRole("button", { name: "启动 Nova.app", exact: true })
  await expect(start).toBeEnabled()
  observedAt = "2026-11-09T00:01:00Z"
  await start.click()
  await expect(nova.getByText("启动请求已发送。", { exact: false })).toBeVisible()
  const reconnect = nova.getByRole("button", { name: "重连 Nova 桌面连接", exact: true })
  await expect(reconnect).toBeEnabled()
  enabled = false
  await reconnect.click()
  await expect(reconnect).toBeDisabled()
  await expect(settings.getByRole("alert")).toContainText("无法确认桌面重连结果")
  expect(writes).toEqual([
    { path: "/api/v1/plugins/nova/app/install", body: { artifact_id: artifactId } },
    { path: "/api/v1/plugins/nova/app/start", body: { observed_at: observedAt, app_version: "1.0" } },
  ])
  expect(observation.pageErrors).toEqual([])
})
