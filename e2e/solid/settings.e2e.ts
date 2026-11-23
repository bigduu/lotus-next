import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

test("Solid Lotus keeps appearance and owner settings in the real application shell", async ({ page, baseURL, isMobile }) => {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  await page.route("**/api/v1/metrics/summary", (route) => route.fulfill({ json: { total_sessions: 3 } }))
  await page.goto(entryUrl)
  if (isMobile) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await page.getByRole("button", { name: "系统设置", exact: true }).click()
  const settings = page.locator('[data-slot="settings-page"]')
  await expect(settings.getByRole("heading", { name: "通用", exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "浅色", exact: true }).click()
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/)
  if (isMobile) await settings.locator("select.settings-select").first().selectOption("providers")
  else await settings.getByRole("button", { name: "提供方", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "提供方", exact: true })).toBeVisible()
  await expect(settings.getByText("Fixture provider", { exact: true }).first()).toBeVisible()
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/)
  expect(observation.pageErrors).toEqual([])
})
