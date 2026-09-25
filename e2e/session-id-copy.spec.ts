import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const activeSessionId = "all-surface-session"
const otherSessionId = "copy-target-9e3f"

test("copies the chosen sidebar session ID and shows the active ID in advanced info", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop sidebar and inspector acceptance")
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: standaloneScenario.origin })
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const session = (id: string, title: string) => ({
    id, title, kind: "root", model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z",
    permission_mode: "default", is_running: false,
  })
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({
    json: {
      sessions: [session(activeSessionId, "All-surface acceptance"), session(otherSessionId, "Copy target")],
      total: 2, limit: 200, offset: 0,
    },
  }))
  await page.route(`**/api/v1/task/${activeSessionId}`, (route) => route.fulfill({
    json: { session_id: activeSessionId, items: [] },
  }))

  await page.goto(standaloneScenario.entryUrl)
  await page.getByRole("button", { name: "All-surface acceptance", exact: true }).click()
  await expect(page.locator("header").getByText("All-surface acceptance", { exact: true })).toBeVisible()

  const otherRow = page.getByRole("button", { name: "Copy target", exact: true }).locator("..")
  const otherMenu = otherRow.getByRole("button", { name: "会话操作" })
  await otherMenu.focus()
  await expect(otherMenu).toHaveCSS("opacity", "1")
  await otherMenu.click()
  await page.getByRole("menuitem", { name: "复制会话 ID" }).click()
  await expect.poll(() => page.evaluate("navigator.clipboard.readText()")).toBe(otherSessionId)
  await expect(page.getByRole("status").filter({ hasText: "会话 ID 已复制" })).toBeVisible()
  await expect(page.locator("header").getByText("All-surface acceptance", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "打开侧边面板" }).click()
  const inspector = page.locator("#right-workbench")
  await inspector.getByRole("button", { name: /检查器.*查看当前会话/ }).click()
  await inspector.getByText("高级信息", { exact: true }).click()
  const advanced = inspector.locator("details")
  await expect(advanced.getByText(activeSessionId, { exact: true })).toBeVisible()
  await advanced.getByRole("button", { name: "复制会话 ID" }).click()
  await expect.poll(() => page.evaluate("navigator.clipboard.readText()")).toBe(activeSessionId)

  await otherRow.getByRole("button", { name: "会话操作" }).click()
  await page.screenshot({ path: testInfo.outputPath("session-id-copy-and-advanced-info.png"), animations: "disabled" })
  await testInfo.attach("Session ID menu and advanced info", {
    path: testInfo.outputPath("session-id-copy-and-advanced-info.png"),
    contentType: "image/png",
  })
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
