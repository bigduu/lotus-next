import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import type { PublisherPolicy, PublisherPolicyChange } from "../src/services/plugin/types.js"

// Built UI with fixture APIs. Backend CAS/migration/signature authority is
// covered separately in Bamboo; this is not native installation evidence.
const initial = (): PublisherPolicy => ({ expected_revision: 7, publisher_mode: "follow_defaults", enforcement: "strict", custom_key_count: 1,
  publishers: [
    ["jiandu", "bba9d0e5553401125f939bc3d844e891706d579a611fea9215545771d5306676"],
    ["nova", "e3c429e1be50098b12c6f45737abf457189b668535875b5b3e2b4349be86ea59"],
    ["magpie", "47e971c39cd93adb18cff50e097cb387df49e9c4d33b0ed62f693eabbe7fc66e"],
  ].map(([id, key]) => ({ id: id!, key: { label: `${id} (bigduu official)`, algorithm: "ed25519", public_key: key! }, trusted: true, revoked: false })) })

async function openPlugins(page: Page) {
  const settings = page.getByRole("button", { name: "系统设置", exact: true })
  const bounds = await settings.boundingBox()
  if (!bounds || bounds.x < 0 || bounds.x + bounds.width > (page.viewportSize()?.width ?? 0)) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await settings.click()
  const categories = page.locator("#settings-category")
  await categories.waitFor({ state: "attached" })
  if (await categories.isVisible()) await categories.selectOption("plugins")
  else await page.getByRole("button", { name: "插件", exact: true }).click()
  await page.getByRole("button", { name: "发布者信任", exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
    localStorage.setItem("copilot_ui_theme_v1", "light")
  })
})

async function fixture(page: Page) {
  await installArtifactRuntime(page, standaloneScenario)
  const policy = initial()
  const posts: { path: string; body: { expected_revision: number; expected_publishers: Record<string, string>; change: PublisherPolicyChange } }[] = []
  const controls = { conflict: false, uncertain: false, unavailable: false }
  await page.route("**/api/v1/plugins**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith("/publishers")) {
      if (route.request().method() === "GET") return controls.unavailable ? route.fulfill({ status: 503, json: { error: "fixture offline" } }) : route.fulfill({ json: policy })
      const body = route.request().postDataJSON()
      posts.push({ path, body })
      if (controls.conflict) return route.fulfill({ status: 409, json: { error: "fixture changed" } })
      const change = body.change as PublisherPolicyChange
      policy.expected_revision += 1
      if (change.type === "set_mode") policy.publisher_mode = change.publisher_mode
      else {
        const publisher = policy.publishers.find(({ id }) => id === change.publisher_id)!
        publisher.trusted = change.type === "trust"
        publisher.revoked = change.type === "revoke"
      }
      if (controls.uncertain) { controls.unavailable = true; return route.fulfill({ status: 500, json: { error: "fixture lost response" } }) }
      return route.fulfill({ status: 204 })
    }
    if (path.endsWith("/jiandu/setup")) {
      const publisher = policy.publishers[0]!
      return route.fulfill({ json: {
        plugin_id: "jiandu", host: { os: "linux", arch: "x86_64", libc: "2.35", supported: true, reason: null },
        release: { version: "0.3.2", manifest_url: "https://fixture.invalid/jiandu.tar.gz", sha256: "a".repeat(64) },
        trust: { trusted: publisher.trusted, reason: publisher.trusted ? null : "publisher_not_trusted" },
        trust_action: { available: !publisher.trusted, reason: publisher.trusted ? "publisher_already_trusted" : null,
          expected_revision: policy.expected_revision, publisher: publisher.key },
        install: { available: publisher.trusted, reason: publisher.trusted ? null : "publisher_not_trusted" },
        installed: { state: "missing", version: null, reason: null }, external_client: null,
      } })
    }
    if (path.endsWith("/nova/app")) return route.fulfill({ status: 404 })
    return route.fulfill({ json: { plugins: [] } })
  })
  await page.route("**/api/v1/mcp/servers**", (route) => route.fulfill({ json: { servers: [] } }))
  await page.goto(standaloneScenario.entryUrl)
  await openPlugins(page)
  return { policy, posts, controls }
}

test("revocation survives reviewed mode changes and restoration refreshes Jiandu setup without installing", async ({ page }, testInfo) => {
  const { policy, posts } = await fixture(page)
  const panel = page.getByRole("region", { name: "发布者信任", exact: true })
  const install = page.getByRole("button", { name: "安装 Jiandu 连接器", exact: true })
  await expect(install).toBeEnabled()
  await panel.getByRole("button", { name: "撤销 jiandu 发布者信任" }).click()
  const dialog = page.getByRole("dialog", { name: "确认发布者策略更改" })
  await expect(dialog).toContainText(policy.publishers[0]!.key.public_key)
  await dialog.getByRole("button", { name: "取消", exact: true }).click()
  expect(posts).toEqual([])
  await panel.getByRole("button", { name: "撤销 jiandu 发布者信任" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "确认策略更改", exact: true }).click()
  await expect(panel).toContainText("已撤销")
  await expect(install).toBeDisabled()
  for (const mode of ["使用自定义信任列表", "跟随官方默认"]) {
    await panel.getByRole("button", { name: mode, exact: true }).click()
    if (mode === "跟随官方默认") await testInfo.attach(`publisher-policy-review-${testInfo.project.name}`, { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" })
    await page.getByRole("dialog").getByRole("button", { name: "确认策略更改", exact: true }).click()
    await expect(panel).toContainText("已撤销")
    await expect(install).toBeDisabled()
  }
  await expect(panel).toContainText("保留的自定义公钥：1")
  await panel.getByRole("button", { name: "信任 jiandu 发布者" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "确认策略更改", exact: true }).click()
  await expect(install).toBeEnabled()
  await expect(panel.getByText("已撤销", { exact: true })).toHaveCount(0)
  expect(posts.map(({ body }) => body.expected_revision)).toEqual([7, 8, 9, 10])
  expect(posts.every(({ path }) => path === "/api/v1/plugins/publishers")).toBe(true)
  expect(posts[0]!.body.expected_publishers.jiandu).toBe(`ed25519:${policy.publishers[0]!.key.public_key}`)
  expect(policy.enforcement).toBe("strict")
  expect(await page.evaluate(() => {
    const browser = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }
    return browser.document.documentElement.scrollWidth <= browser.innerWidth + 1
  })).toBe(true)
})

test("conflict keeps the reviewed revision and sends no automatic retry", async ({ page }) => {
  const { policy, posts, controls } = await fixture(page)
  await page.getByRole("button", { name: "撤销 jiandu 发布者信任" }).click()
  policy.expected_revision = 8
  controls.conflict = true
  await page.getByRole("dialog").getByRole("button", { name: "确认策略更改", exact: true }).click()
  await expect(page.getByRole("region", { name: "发布者信任" })).toContainText("策略在确认后已变化")
  await page.getByRole("button", { name: "刷新发布者策略" }).click()
  expect(posts).toHaveLength(1)
  expect(posts[0]!.body.expected_revision).toBe(7)
})

test("a fresh policy observation reconciles an uncertain response without another mutation", async ({ page }) => {
  const { posts, controls } = await fixture(page)
  controls.uncertain = true
  await page.getByRole("button", { name: "撤销 jiandu 发布者信任" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "确认策略更改", exact: true }).click()
  const panel = page.getByRole("region", { name: "发布者信任", exact: true })
  await expect(panel).toContainText("尚无法确认更改结果")
  controls.unavailable = false
  await page.getByRole("button", { name: "刷新发布者策略" }).click()
  await expect(panel).toContainText("已撤销")
  await expect(panel.getByRole("alert")).toHaveCount(0)
  expect(posts).toHaveLength(1)
})
