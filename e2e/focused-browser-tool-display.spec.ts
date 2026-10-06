import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { openProcessActivities } from "./support/processActivity.js"

const sessionId = "all-surface-session"
const privateText = "private typed text 149"
const privateKey = "private-key-149"
const privateResource = "browser:17:type:private-fingerprint-149"

test("desktop history displays focused browser approvals without input or receipt details", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop approval display screenshot")
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const session = {
    id: sessionId,
    title: "Browser approval display",
    kind: "root",
    model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:01Z",
    permission_mode: "default",
    is_running: false,
  }
  const toolCalls = [
    { id: "type-149", type: "function", function: { name: "browser", arguments: JSON.stringify({ action: "type", text: privateText, expected_epoch: 17 }) } },
    { id: "key-149", type: "function", function: { name: "browser", arguments: JSON.stringify({ action: "key", key: privateKey, expected_epoch: 17 }) } },
    { id: "press-149", type: "function", function: { name: "browser", arguments: JSON.stringify({ action: "press", key: privateKey, expected_epoch: 17 }) } },
  ]
  const approval = (id: string) => JSON.stringify({
    status: "awaiting_permission_approval",
    question: "Approve focused browser input?",
    permission_request: {
      request_id: id,
      resource: privateResource,
      suggested_matchers: [{ value: privateText }],
    },
  })
  const history = [
    { id: "user-149", role: "user", content: "Check the browser approval display", created_at: "2026-09-23T00:00:00Z" },
    { id: "assistant-149", role: "assistant", content: "", tool_calls: toolCalls, created_at: "2026-09-23T00:00:01Z" },
    ...toolCalls.map((call, index) => ({
      id: `result-${index}`,
      role: "tool",
      tool_call_id: call.id,
      content: approval(call.id),
      created_at: "2026-09-23T00:00:02Z",
    })),
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
  await page.getByRole("button", { name: "Browser approval display", exact: true }).click()
  await openProcessActivities(page)
  await expect(page.locator("[data-tool-call-toggle]")).toHaveCount(0)
  const entries = page.locator("[data-tool-call-entry]")
  await expect(entries).toHaveCount(3)
  const rows = entries.locator("[data-tool-call-entry-toggle]")
  await expect(rows).toHaveCount(3)
  await expect(entries.locator("[data-tool-call-entry-detail]")).toHaveCount(0)
  for (const row of await rows.all()) {
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute("aria-expanded", "false")
    await row.click()
  }
  await expect(entries.locator("pre")).toHaveCount(3)
  for (const result of await entries.locator("pre").all()) {
    await expect(result).toHaveText("等待用户批准")
  }
  for (const privateValue of [privateText, privateKey, privateResource, "permission_request", "suggested_matchers"]) {
    await expect(page.locator("body")).not.toContainText(privateValue)
  }
  const screenshot = testInfo.outputPath("focused-browser-approval-display.png")
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach("Focused browser approval display", { path: screenshot, contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
