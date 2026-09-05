import { expect, test, type FrameLocator, type Page } from "@playwright/test"
import {
  embeddedScenario,
  installArtifactRuntime,
  secureRemoteScenario,
  standaloneScenario,
} from "./support/artifactRuntime.js"

const sessions = [
  ["all-surface-session", "最近任务 1", "2026-09-05"],
  ["recent-2", "最近任务 2", "2026-09-04"],
  ["recent-3", "最近任务 3", "2026-09-03"],
  ["recent-4", "最近任务 4", "2026-09-02"],
  ["recent-5", "最近任务 5", "2026-09-01"],
  ["older-support", "Support 旧调查", "2026-08-30"],
  ["older-development", "更早的开发", "2026-08-20"],
  ["pinned-session", "长期置顶", "2020-01-01"],
  ["child-session", "不应出现在侧栏的子任务", "2026-09-05"],
].map(([id, title, day]) => ({
  id,
  title,
  title_version: 1,
  kind: id === "child-session" ? "child" : "root",
  pinned: id === "pinned-session",
  parent_session_id: id === "child-session" ? "all-surface-session" : null,
  root_session_id: id === "child-session" ? "all-surface-session" : id,
  spawn_depth: id === "child-session" ? 1 : 0,
  model: "fixture-model",
  model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: `${day}T02:00:00.000Z`,
  updated_at: `${day}T02:00:00.000Z`,
  last_activity_at: `${day}T02:00:00.000Z`,
  message_count: 0,
  has_attachments: false,
  is_running: false,
  last_run_status: "completed",
  has_pending_question: false,
  running_child_count: 0,
  placement: { kind: "local", host: "fixture" },
}))

type Surface = Page | FrameLocator

async function openSidebar(surface: Surface, phone: boolean) {
  if (phone) await surface.getByRole("button", { name: "菜单", exact: true }).click()
  return surface.locator("aside")
}

test.use({ timezoneId: "Asia/Shanghai" })

for (const scenario of [standaloneScenario, embeddedScenario, secureRemoteScenario]) {
  test(`${scenario.name}: five dates, older disclosure, keyboard folding and old search results`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date("2026-09-05T04:00:00Z"))
    await page.addInitScript(() => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
    })
    const observation = await installArtifactRuntime(page, scenario)
    // Keep this slice's extra sessions local to its spec: the shared migration
    // fixture and its single-session acceptance behavior stay independent.
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      if (request.method() === "GET" && pathname === "/api/v1/sessions") {
        await route.fulfill({ json: { sessions } })
      } else if (request.method() === "GET" && pathname.startsWith("/api/v1/history/")) {
        await route.fulfill({ json: { session_id: pathname.split("/").pop(), messages: [] } })
      } else if (request.method() === "GET" && /^\/api\/v1\/respond\/[^/]+\/pending$/.test(pathname)) {
        await route.fulfill({ json: { has_pending_question: false } })
      } else if (request.method() === "PATCH" && pathname === "/api/v1/sessions/older-support") {
        // Opening another session performs the existing model synchronization.
        await route.fulfill({ json: {} })
      } else {
        await route.fallback()
      }
    })

    await page.goto(scenario.entryUrl, { waitUntil: "domcontentloaded" })
    const surface = scenario.embedded
      ? page.frameLocator('iframe[title="Lotus Next embedded surface"]')
      : page
    await expect(surface.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
    const phone = testInfo.project.name === "phone-chromium"
    const sidebar = await openSidebar(surface, phone)
    const older = sidebar.getByRole("button", { name: /^更早\s*\d+\s*天/ })
    await expect(older).toHaveAttribute("aria-expanded", "false")
    await expect(sidebar.getByRole("button", { name: "长期置顶", exact: true })).toBeVisible()
    for (let day = 1; day <= 5; day += 1) {
      await expect(sidebar.getByRole("button", { name: `最近任务 ${day}`, exact: true })).toBeVisible()
    }
    await expect(sidebar.getByRole("button", { name: "Support 旧调查", exact: true })).toHaveCount(0)
    await expect(sidebar.getByRole("button", { name: "不应出现在侧栏的子任务", exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath("sidebar-five-dates.png") })
    await testInfo.attach("Five populated dates and collapsed older dates", {
      path: testInfo.outputPath("sidebar-five-dates.png"), contentType: "image/png",
    })

    await older.focus()
    await older.press("Enter")
    await expect(older).toHaveAttribute("aria-expanded", "true")
    const oldTask = sidebar.getByRole("button", { name: "Support 旧调查", exact: true })
    await expect(oldTask).toBeVisible()
    const oldDay = sidebar.getByRole("button", { name: /8月30日/ })
    await oldDay.focus()
    await oldDay.press("Space")
    await expect(oldDay).toHaveAttribute("aria-expanded", "false")
    await expect(oldTask).toHaveCount(0)
    await oldDay.press("Enter")
    await expect(oldTask).toBeVisible()
    await older.click()
    await expect(oldTask).toHaveCount(0)

    const search = sidebar.getByPlaceholder("搜索会话")
    await search.fill("Support")
    await expect(oldTask).toBeVisible()
    await search.fill("")
    await expect(older).toHaveAttribute("aria-expanded", "false")
    await expect(oldTask).toHaveCount(0)

    await search.fill("Support")
    await oldTask.click()
    if (phone) await openSidebar(surface, true)
    await search.fill("")
    await expect(oldTask).toBeVisible()
    await expect(surface.locator("header").getByText("Support 旧调查", { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("sidebar-active-older-task.png") })
    await testInfo.attach("Older task remains discoverable after selection", {
      path: testInfo.outputPath("sidebar-active-older-task.png"), contentType: "image/png",
    })

    await page.waitForLoadState("networkidle")
    expect(observation.pageErrors).toEqual([])
    expect(observation.consoleErrors).toEqual([])
    expect(observation.errorResponses).toEqual([])
    expect(observation.protocolErrors).toEqual([])
  })
}
