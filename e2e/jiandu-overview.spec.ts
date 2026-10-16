import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { selectSettingsCategory, settingsSurface } from "./support/settingsNavigation.js"

const inventory = {
  total_memories: 12, project_count: 3,
  by_scope: { global: 5, project: 7 },
  by_type: { user: 3, feedback: 2, project: 5, reference: 2 },
  by_status: { active: 9, stale: 1, archived: 2 },
  last_reindex_at: "2026-10-15T03:00:00Z", last_dream_at: null,
}

async function openOverview(page: Page) {
  const settingsButton = page.getByRole("button", { name: "系统设置", exact: true })
  const bounds = await settingsButton.boundingBox()
  if (!bounds || bounds.x < 0 || bounds.x + bounds.width > (page.viewportSize()?.width ?? Infinity)) {
    await page.getByRole("button", { name: "菜单", exact: true }).click()
  }
  await settingsButton.click()
  const settings = settingsSurface(page)
  await selectSettingsCategory(settings, "jiandu", "Jiandu 记忆")
  await expect(settings.getByRole("heading", { name: "记忆总览", exact: true })).toBeVisible()
  return settings
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
    localStorage.setItem("copilot_ui_theme_v1", "dark")
  })
})

for (const hasSession of [false, true]) {
  test(`Jiandu opens aggregate inventory ${hasSession ? "with a projectless session" : "without any session"}`, async ({ page }, testInfo) => {
    const observation = await installArtifactRuntime(page, standaloneScenario)
    if (!hasSession) await page.route(/\/api\/v1\/sessions(?:\?.*)?$/, (route) => route.fulfill({
      json: { sessions: [], total: 0, limit: 200, offset: 0 },
    }))
    const overviewRequests: string[] = []
    await page.route("**/api/v1/metrics/memory/summary**", (route) => {
      overviewRequests.push(route.request().url())
      return route.fulfill({ json: inventory })
    })
    await page.goto(standaloneScenario.entryUrl)
    const settings = await openOverview(page)
    const inventorySection = settings.getByRole("region", { name: "持久记忆库存", exact: true })
    await expect(inventorySection).toBeVisible()
    const count = (label: string) => inventorySection.locator("dl > div").filter({
      has: page.locator("dt").getByText(label, { exact: true }),
    }).locator("dd")
    await expect(count("持久记忆总数")).toHaveText("12")
    await expect(count("全局记忆数")).toHaveText("5")
    await expect(count("项目记忆数")).toHaveText("7")
    await expect(count("有记忆数据的项目")).toHaveText("3")
    await expect(settings).toContainText("无项目会话也可使用")
    await expect(settings).toContainText("会话笔记单独存储，不计入这些数量")
    await expect(settings.getByRole("alert")).toHaveCount(0)
    await expect(settings.getByRole("button", { name: "新建记忆", exact: true })).toHaveCount(0)
    await expect(settings.getByRole("region", { name: "当前 Project 上下文", exact: true })).toHaveCount(0)
    await settings.getByRole("button", { name: "刷新总览", exact: true }).click()
    await expect(inventorySection).toBeVisible()
    expect(overviewRequests).toHaveLength(2)
    expect(overviewRequests.every((url) => new URL(url).search === "")).toBe(true)
    expect(observation.httpRequests.filter(({ url }) => url.includes("/tools/execute"))).toEqual([])
    await testInfo.attach(`jiandu-overview-${hasSession ? "unassigned" : "no-session"}-${testInfo.project.name}`, {
      body: await page.screenshot({ animations: "disabled" }), contentType: "image/png",
    })
    expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    expect(observation.pageErrors).toEqual([])
  })
}

test("Jiandu never renders an unavailable or invalid aggregate as zero inventory", async ({ page }) => {
  await installArtifactRuntime(page, standaloneScenario)
  let ready = false
  await page.route("**/api/v1/metrics/memory/summary**", (route) => route.fulfill({
    json: ready ? inventory : { ...inventory, by_scope: { global: 12 }, scope: "global" },
  }))
  await page.goto(standaloneScenario.entryUrl)
  const settings = await openOverview(page)
  await expect(settings.getByRole("alert")).toContainText("记忆统计数据无法验证")
  await expect(settings.getByRole("region", { name: "持久记忆库存", exact: true })).toHaveCount(0)
  ready = true
  await settings.getByRole("button", { name: "刷新总览", exact: true }).click()
  await expect(settings.getByRole("region", { name: "持久记忆库存", exact: true })).toBeVisible()
  await expect(settings.getByRole("alert")).toHaveCount(0)
})
