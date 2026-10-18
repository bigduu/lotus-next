import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

for (const colorScheme of ["light", "dark"] as const) {
  test(`home cards and empty feedback remain accessible in ${colorScheme} mode`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "no-preference" })
    await page.addInitScript(() => { localStorage.setItem("bodhi_onboarded_v1", "1") })
    const observation = await installArtifactRuntime(page, standaloneScenario)
    await page.route("**/api/v1/sessions?*", (route) => route.fulfill({ json: { sessions: [], total: 0, limit: 200, offset: 0 } }))
    await page.goto(standaloneScenario.entryUrl)
    const home = page.getByTestId("home-dashboard")
    await expect(home).toBeVisible()
    expect(await page.locator("html").evaluate((element) => element.classList.contains("dark"))).toBe(colorScheme === "dark")
    const card = home.getByRole("button", { name: /代码评审/ })
    const layout = () => card.evaluate((element) => ({ width: element.offsetWidth, height: element.offsetHeight, top: element.offsetTop }))
    const before = await layout()
    await card.hover()
    await card.focus()
    await expect(card).toBeFocused()
    expect(await layout()).toEqual(before)
    await info.attach(`home-cards-${colorScheme}`, { body: await page.screenshot(), contentType: "image/png" })
    await home.locator("input").fill("no-matching-template-xyz")
    const empty = home.getByRole("status")
    await expect(empty).toContainText("没有匹配的模板")
    await info.attach(`home-empty-${colorScheme}`, { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect(empty).toHaveCSS("animation-name", "none")
    await home.locator("input").fill("")
    await card.press("Enter")
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).not.toBeEmpty()
    expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    expect(observation.pageErrors).toEqual([])
  })
}
