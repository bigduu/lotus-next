import { expect, test } from "@playwright/test"
import { installArtifactRuntime, secureRemoteScenario, standaloneScenario } from "./support/artifactRuntime.js"

for (const requestState of ["unauthenticated", "local_bypass", "authenticated"] as const) {
  test(`ticket negotiation respects admitted ${requestState} access on the built artifact`, async ({ page }) => {
    const scenario = requestState === "local_bypass" ? standaloneScenario : secureRemoteScenario
    await page.addInitScript(() => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      localStorage.setItem("lotus_next_last_session", "all-surface-session")
    })
    const observation = await installArtifactRuntime(page, scenario, [], { bootstrapRequestState: requestState })
    await page.goto(scenario.entryUrl, { waitUntil: "domcontentloaded" })
    const composer = page.getByRole("textbox", { name: "消息", exact: true })
    await expect(composer).toBeVisible()
    await expect(page.locator("header").getByText("All-surface acceptance", { exact: true })).toBeVisible()
    await composer.fill("ordinary chat remains available")
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled()
    if (requestState !== "unauthenticated") {
      await expect.poll(() => observation.httpRequests.filter((request) =>
        new URL(request.url).pathname === "/api/v1/tickets/scope").length).toBeGreaterThan(0)
    }
    // Observe a full existing ticket polling interval, including focus/online.
    await page.evaluate(() => {
      const events = globalThis as unknown as { dispatchEvent(event: Event): boolean }
      events.dispatchEvent(new Event("focus"))
      events.dispatchEvent(new Event("online"))
    })
    await page.waitForTimeout(2_800)
    if (requestState === "unauthenticated") {
      expect(observation.httpRequests.filter((request) =>
        new URL(request.url).pathname.startsWith("/api/v1/tickets/"))).toEqual([])
    }
    expect(observation.bootstrapDocuments).toHaveLength(1)
    expect(observation.errorResponses).toEqual([])
    expect(observation.failedRequests).toEqual([])
    expect(observation.pageErrors).toEqual([])
    expect(observation.consoleErrors).toEqual([])
  })
}
