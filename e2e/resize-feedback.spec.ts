import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { installResizeDiagnostics } from "./support/resizeDiagnostics.js"

test("virtualized history resizes without recursive notifications and retains reader controls", async ({ page }, testInfo) => {
  await installResizeDiagnostics(page)
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const messages = Array.from({ length: 160 }, (_, index) => ({
    id: `history-${index}`,
    role: index % 2 ? "assistant" : "user",
    content: `History ${index}.\n\n` + "Measured history paragraph with different wrapping. ".repeat(5 + index % 8),
    created_at: "2026-10-07T00:00:00Z",
  }))
  const observation = await installArtifactRuntime(page, standaloneScenario, messages)
  await page.goto(standaloneScenario.entryUrl)
  const content = page.locator("[data-message-list-content]").first()
  await expect(content).toBeVisible()
  const area = content.locator("..")
  for (const width of [1440, 900, 1200, 800, 1440, 1100, 1600]) {
    await page.setViewportSize({ width, height: 700 + width % 200 })
    await expect.poll(() => area.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(2)
    await area.hover()
    // Read far enough above the bottom that estimated row-size compensation
    // cannot turn this reader-control check into a near-bottom anchoring check.
    await page.mouse.wheel(0, -1200)
    const jump = page.getByRole("button", { name: "滚动到底部", exact: true })
    await expect(jump).toBeVisible()
    await jump.click()
    await expect.poll(() => area.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(2)
  }
  const diagnostics = await page.evaluate(() => (globalThis as unknown as { __resizeDiagnostics: { errors: unknown[] } }).__resizeDiagnostics)
  await testInfo.attach("resize-delivery-diagnostics", { body: JSON.stringify(diagnostics), contentType: "application/json" })
  expect(diagnostics.errors).toEqual([])
  await testInfo.attach("resized-virtualized-history", { body: await page.screenshot(), contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
})
