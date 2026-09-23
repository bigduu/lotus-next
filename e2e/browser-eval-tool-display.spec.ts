import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "all-surface-session"
const privateCode = "document.querySelector('#token').textContent"
const privateUrl = "https://example.test/account?token=private-query-151"
const privateValue = "private-page-value-151"
const privateResource = "browser_eval:17:private-fingerprint-151"

test("desktop history hides browser_eval source, URL, result, and approval receipt", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop tool display screenshot")
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const session = {
    id: sessionId,
    title: "Browser script display",
    kind: "root",
    model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:01Z",
    permission_mode: "default",
    is_running: false,
  }
  const toolCalls = [
    { id: "eval-151-result", type: "function", function: { name: "browser_eval", arguments: JSON.stringify({ code: privateCode, expected_url: privateUrl, expected_epoch: 17 }) } },
    { id: "eval-151-approval", type: "function", function: { name: "browser_eval", arguments: JSON.stringify({ code: privateCode, expected_url: privateUrl, expected_epoch: 17 }) } },
  ]
  const history = [
    { id: "user-151", role: "user", content: "Check the browser script display", created_at: "2026-09-23T00:00:00Z" },
    { id: "assistant-151", role: "assistant", content: "", tool_calls: toolCalls, created_at: "2026-09-23T00:00:01Z" },
    {
      id: "result-151",
      role: "tool",
      tool_call_id: "eval-151-result",
      content: JSON.stringify({ ok: true, value: privateValue, url: privateUrl }),
      created_at: "2026-09-23T00:00:02Z",
    },
    {
      id: "approval-151",
      role: "tool",
      tool_call_id: "eval-151-approval",
      content: JSON.stringify({
        status: "awaiting_permission_approval",
        permission_request: { resource: privateResource, suggested_matchers: [{ value: privateCode }] },
      }),
      created_at: "2026-09-23T00:00:03Z",
    },
  ]

  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({
    json: { sessions: [session], total: 1, limit: 200, offset: 0 },
  }))
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => route.fulfill({
    json: { session }, headers: { ETag: '"1"' },
  }))
  await page.route(`**/api/v1/history/${sessionId}`, (route) => route.fulfill({
    json: { session_id: sessionId, messages: history },
  }))
  await page.route(`**/api/v1/task/${sessionId}`, (route) => route.fulfill({
    json: { session_id: sessionId, items: [] },
  }))

  await page.goto(standaloneScenario.entryUrl)
  await page.getByRole("button", { name: "Browser script display", exact: true }).click()
  const toggle = page.locator("[data-tool-call-toggle]")
  await expect(toggle).toBeVisible()
  await toggle.click()
  const entries = page.locator("[data-tool-call-entry]")
  await expect(entries).toHaveCount(2)
  for (const summary of await entries.locator("details summary").all()) await summary.click()
  await expect(entries.locator("pre")).toHaveText(["网页脚本已执行", "等待用户批准"])
  for (const privateText of [privateCode, privateUrl, privateValue, privateResource, "permission_request"]) {
    await expect(page.locator("body")).not.toContainText(privateText)
  }
  const screenshot = testInfo.outputPath("browser-eval-display.png")
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach("Browser script display", { path: screenshot, contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
