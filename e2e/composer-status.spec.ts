import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

for (const locale of ["en-US", "zh-CN"]) {
  test(`composer keeps mode details behind a compact icon (${locale})`, async ({ page }, testInfo) => {
    await page.addInitScript((locale) => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      localStorage.setItem("lotus_ui_locale_v1", locale)
    }, locale)
    const observation = await installArtifactRuntime(page, standaloneScenario)
    await page.goto(standaloneScenario.entryUrl)
    const english = locale === "en-US"
    const permission = page.getByRole("combobox", { name: english ? "Permission mode" : "权限模式", exact: true })
    await expect(permission).toBeEnabled()
    await expect(permission).toHaveValue("default")
    const icon = page.getByRole("button", { name: english ? "About Ultra orchestration" : "查看 Ultra 编排说明", exact: true })
    await expect(icon).toBeVisible()
    const bounds = await icon.boundingBox()
    expect(bounds?.width).toBeLessThan(32)
    await testInfo.attach(`compact-${locale}`, { body: await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`compact-${locale}.png`) }), contentType: "image/png" })
    if (testInfo.project.name === "desktop-chromium") await icon.hover()
    else await icon.tap()
    await expect(page.getByRole("tooltip")).toContainText(english ? "Single-call reasoning" : "单次推理")
    if (testInfo.project.name !== "desktop-chromium") {
      await icon.tap()
      await expect(page.getByRole("tooltip")).toHaveCount(0)
      await icon.tap()
      await expect(page.getByRole("tooltip")).toBeVisible()
    }
    await testInfo.attach(`hover-${locale}`, { body: await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`hover-${locale}.png`) }), contentType: "image/png" })
    await page.keyboard.press("Escape")
    await expect(page.getByRole("tooltip")).toHaveCount(0)
    if (testInfo.project.name === "desktop-chromium") {
      await icon.focus()
      await expect(page.getByRole("tooltip")).toContainText(english ? "Single-call reasoning" : "单次推理")
    }
    expect(await page.evaluate(() => {
      const browser = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }
      return browser.document.documentElement.scrollWidth <= browser.innerWidth + 1
    })).toBe(true)
    expect(observation.pageErrors).toEqual([])
  })
}
