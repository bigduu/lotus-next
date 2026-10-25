import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

for (const locale of ["en-US", "zh-CN"]) {
  test(`composer omits the standalone mode introduction and retains status announcements (${locale})`, async ({ page }, testInfo) => {
    await page.addInitScript((locale) => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      localStorage.setItem("lotus_ui_locale_v1", locale)
      localStorage.setItem("lotus_next_last_session", "all-surface-session")
    }, locale)
    const observation = await installArtifactRuntime(page, standaloneScenario)
    await page.goto(standaloneScenario.entryUrl)
    await expect(page.getByRole("banner")).toContainText("All-surface acceptance")
    const english = locale === "en-US"
    const permission = page.getByRole("combobox", { name: english ? "Permission mode" : "权限模式", exact: true })
    await expect(permission).toBeEnabled()
    await expect(permission).toHaveText("Default")
    await expect(permission).toHaveAttribute("data-slot", "select-trigger")
    await permission.focus()
    await page.keyboard.press("ArrowDown")
    const options = page.getByRole("listbox")
    await expect(options).toBeVisible()
    await expect(options).toHaveClass(/bg-popover/)
    await expect(options.getByRole("option")).toHaveText(["Default", "Bypass", "Auto"])
    await testInfo.attach(`permission-options-${locale}`, { body: await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`permission-options-${locale}.png`) }), contentType: "image/png" })
    await page.keyboard.press("Escape")
    await expect(options).toHaveCount(0)
    await expect(permission).toBeFocused()
    await expect(permission).toHaveText("Default")
    const icon = page.getByRole("button", { name: english ? "About Ultra orchestration" : "查看 Ultra 编排说明", exact: true })
    await expect(icon).toHaveCount(0)
    await expect(page.getByRole("status").filter({ hasText: english ? "Server confirmed standard mode" : "服务器已确认普通模式" })).toHaveCount(1)
    await testInfo.attach(`compact-${locale}`, { body: await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`compact-${locale}.png`) }), contentType: "image/png" })
    await expect(page.getByRole("tooltip")).toHaveCount(0)
    expect(await page.evaluate(() => {
      const browser = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }
      return browser.document.documentElement.scrollWidth <= browser.innerWidth + 1
    })).toBe(true)
    expect(observation.pageErrors).toEqual([])
  })
}
