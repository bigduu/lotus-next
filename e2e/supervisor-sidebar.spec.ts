import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

test("canonical Supervisor stays above ordinary session search and selects with the keyboard", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  await installArtifactRuntime(page, standaloneScenario)
  const ids = ["bamboo-default-supervisor", "all-surface-session"]
  const sessions = ids.map((id) => ({
    id, title: id === ids[0] ? "Supervisor" : "普通工作", title_version: 1,
    kind: "root", root_session_id: id, parent_session_id: null, spawn_depth: 0,
    pinned: true, model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z",
    last_activity_at: "2026-10-05T00:00:00Z", message_count: 0, is_running: false,
    last_run_status: "completed", has_pending_question: false, subagent_count: 0,
  }))
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === "GET" && path === "/api/v1/sessions") {
      await route.fulfill({ json: { sessions, total: 2, limit: 200, offset: 0 } })
    } else if (request.method() === "GET" && path === `/api/v1/sessions/${ids[0]}`) {
      await route.fulfill({ json: { session: sessions[0] }, headers: { ETag: '"1"' } })
    } else if (path === `/api/v1/history/${ids[0]}`) {
      await route.fulfill({ json: { session_id: ids[0], messages: [] } })
    } else if (path === `/api/v1/respond/${ids[0]}/pending`) {
      await route.fulfill({ json: { has_pending_question: false } })
    } else if (request.method() === "PATCH" && path === `/api/v1/sessions/${ids[0]}`) {
      await route.fulfill({ json: {} })
    } else await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  const phone = testInfo.project.name === "phone-chromium"
  if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
  const sidebar = page.locator("aside").first()
  const supervisor = sidebar.getByRole("button", { name: "Supervisor", exact: true })
  await expect(supervisor).toHaveCount(1)
  await expect(supervisor).toBeVisible()
  expect((await supervisor.boundingBox())!.y).toBeLessThan((await sidebar.getByRole("button", { name: "新建会话", exact: true }).boundingBox())!.y)
  await expect(sidebar.getByText("置顶", { exact: true })).toHaveCount(1)
  await sidebar.getByPlaceholder("搜索会话").fill("找不到")
  await expect(supervisor).toBeVisible()
  await expect(sidebar.getByRole("button", { name: "普通工作", exact: true })).toHaveCount(0)
  await supervisor.focus()
  await supervisor.press("Enter")
  if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await expect(supervisor).toHaveAttribute("aria-current", "page")
  await page.screenshot({ path: testInfo.outputPath("supervisor-top-entry.png") })
})
