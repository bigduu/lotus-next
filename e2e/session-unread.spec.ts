import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

test("unread sessions retain their title name and expose a separate read-state description", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const sessions = ["all-surface-session", "unread-session"].map((id, index) => ({
    id, title: index ? "Unread session acceptance" : "Current session", title_version: 1,
    kind: "root", root_session_id: id, parent_session_id: null,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z",
    last_activity_at: "2026-09-07T00:00:00Z", message_count: index ? 1 : 0,
    is_running: false, last_run_status: "completed", has_pending_question: false,
    permission_mode: "default",
  }))
  await page.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === "/api/v1/sessions") await route.fulfill({ json: { sessions } })
    else if (/^\/api\/v1\/sessions\/[^/]+$/.test(pathname)) {
      const session = sessions.find(({ id }) => id === pathname.split("/").pop())
      if (session) await route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
      else await route.fallback()
    } else if (pathname.startsWith("/api/v1/history/")) {
      await route.fulfill({ json: { session_id: pathname.split("/").pop(), messages: [] } })
    } else if (/^\/api\/v1\/respond\/[^/]+\/pending$/.test(pathname)) {
      await route.fulfill({ json: { has_pending_question: false } })
    } else await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  const phone = testInfo.project.name === "phone-chromium"
  if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
  const session = page.locator("aside").getByRole("button", { name: "Unread session acceptance", exact: true })
  await expect(session).toBeVisible()
  await expect(session).toHaveAccessibleName("Unread session acceptance")
  await expect(session).toHaveAccessibleDescription("未读消息")
  await session.click()
  if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await expect(session).toBeVisible()
  await expect(session).toHaveAccessibleName("Unread session acceptance")
  await expect(session).toHaveAccessibleDescription("")
  await expect(session).not.toHaveAttribute("aria-describedby")
  // Move away again: the read marker must persist beyond the active-row override.
  await page.locator("aside").getByRole("button", { name: "Current session", exact: true }).click()
  if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await expect(session).toHaveAccessibleName("Unread session acceptance")
  await expect(session).toHaveAccessibleDescription("")
  expect(observation.pageErrors).toEqual([])
})
