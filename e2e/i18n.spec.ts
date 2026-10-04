import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

// Deterministic UI coverage only. Real-backend evidence is recorded separately.
const openSettings = async (page: Page, english: boolean) => {
  const button = page.getByRole("button", { name: english ? "System Settings" : "系统设置", exact: true })
  const bounds = await button.boundingBox()
  if (!bounds || bounds.x < 0 || bounds.x + bounds.width > (page.viewportSize()?.width ?? Infinity)) {
    await page.getByRole("button", { name: english ? "Menu" : "菜单", exact: true }).click()
  }
  await button.click()
  await page.getByRole("button", { name: english ? "General" : "通用", exact: true }).click()
}

for (const initial of ["zh-CN", "en-US"]) {
  test(`bilingual settings, refresh persistence and composer preserve IME (${initial})`, async ({ page }, testInfo) => {
    await page.addInitScript((locale) => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      if (!localStorage.getItem("lotus_ui_locale_v1")) localStorage.setItem("lotus_ui_locale_v1", locale)
    }, initial)
    const observation = await installArtifactRuntime(page, standaloneScenario)
    await page.goto(standaloneScenario.entryUrl)
    const english = initial === "en-US"
    const input = page.getByRole("textbox", { name: english ? "Messages" : "消息", exact: true })
    await expect(input).toBeVisible()
    await expect(page.getByRole("button", { name: "fixture-model", exact: true })).toBeVisible()
    await input.fill("中文 IME draft <code>const x = 1</code>")
    await input.dispatchEvent("compositionstart", { data: "中" })
    await input.dispatchEvent("keydown", { key: "Enter", keyCode: 229, isComposing: true, bubbles: true })
    await expect(input).toHaveValue("中文 IME draft <code>const x = 1</code>")
    const sends = observation.httpRequests.filter((request) => request.method === "POST" && /\/chat$/.test(request.url))
    expect(sends).toHaveLength(0)
    await input.dispatchEvent("compositionend", { data: "中" })
    await openSettings(page, english)
    const next = english ? "zh-CN" : "en-US"
    await page.locator("#app-language").selectOption(next)
    await expect(page.getByRole("heading", { name: english ? "系统设置" : "System Settings", exact: true })).toBeVisible()
    await expect(page.locator("html")).toHaveAttribute("lang", next)
    await expect.poll(() => page.evaluate(() => localStorage.getItem("lotus_ui_locale_v1"))).toBe(next)
    await page.getByRole("button", { name: english ? "关闭设置" : "Close settings", exact: true }).click()
    await expect(page.getByRole("textbox", { name: english ? "消息" : "Messages", exact: true })).toHaveValue("中文 IME draft <code>const x = 1</code>")
    await page.reload()
    await expect(page.getByRole("textbox", { name: english ? "消息" : "Messages", exact: true })).toBeVisible()
    await openSettings(page, !english)
    await expect(page.locator("#app-language")).toHaveValue(next)
    await page.getByRole("button", { name: english ? "高级" : "Advanced", exact: true }).click()
    if ((page.viewportSize()?.width ?? 0) >= 768) {
      const longLabel = page.getByRole("button", { name: english ? "环境变量" : "Environment Variables", exact: true })
      expect(await longLabel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    await page.getByRole("button", { name: english ? "提供方" : "Provider", exact: true }).click()
    await expect(page.getByText(english ? "默认模型偏好" : "Default model preferences", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: english ? "系统" : "System", exact: true }).click()
    await page.getByRole("button", { name: english ? "清除本地缓存" : "Clear local storage", exact: true }).click()
    await expect(page.getByRole("heading", { name: english ? "清除本地缓存?" : "Clear local storage?", exact: true })).toBeVisible()
    await page.getByRole("button", { name: english ? "取消" : "Cancel", exact: true }).last().click()
    const overflow = await page.evaluate(() => {
      const browser = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }
      return browser.document.documentElement.scrollWidth > browser.innerWidth + 1
    })
    expect(overflow, "document should fit the narrow viewport").toBe(false)
    await testInfo.attach(`settings-${next}-${testInfo.project.name}`, { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" })
    expect(observation.pageErrors).toEqual([])
  })
}

test("a failed preferred locale chunk mounts English and retries the saved preference after reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Startup resource transport is shared across viewport sizes")
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
  })
  await installArtifactRuntime(page, standaloneScenario)
  let failedLoads = 0
  await page.route("**/assets/zh-CN-*.js", async (route) => { failedLoads += 1; await route.abort("failed") })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("textbox", { name: "Messages", exact: true })).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US")
  expect(failedLoads).toBeGreaterThan(0)
  expect(await page.evaluate(() => localStorage.getItem("lotus_ui_locale_v1"))).toBe("zh-CN")
  await page.unroute("**/assets/zh-CN-*.js")
  await page.reload()
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN")
})
