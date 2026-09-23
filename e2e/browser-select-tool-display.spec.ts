import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "browser-select-display-session"
const privateValue = "private-option-value-153"
const privateSelector = "select[data-account='private-selector-153']"
const privateResource = "browser:17:select_option:private-fingerprint-153"
const selectedValues = [`${privateValue}-permission_request`, ...Array.from({ length: 15 }, () => "\u0001".repeat(512))]
const parameters = JSON.stringify({
  action: "select_option",
  selector: privateSelector,
  values: selectedValues,
  expected_epoch: 17,
})

test("desktop history keeps status for bounded large values without option data", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop tool display screenshot")
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const session = {
    id: sessionId,
    title: "Browser selection display",
    kind: "root",
    model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-24T00:00:00Z",
    updated_at: "2026-09-24T00:00:01Z",
    permission_mode: "default",
    is_running: false,
  }
  const history = [
    { id: "user-153", role: "user", content: "Check browser selection display", created_at: "2026-09-24T00:00:00Z" },
    {
      id: "assistant-153",
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "select-153-result", type: "function", function: { name: "browser", arguments: parameters } },
        { id: "select-153-approval", type: "function", function: { name: "default::browser", arguments: parameters } },
      ],
      created_at: "2026-09-24T00:00:01Z",
    },
    {
      id: "result-153",
      role: "tool",
      tool_call_id: "select-153-result",
      content: JSON.stringify({ ok: true, selected_values: selectedValues, selector: privateSelector }),
      created_at: "2026-09-24T00:00:02Z",
    },
    {
      id: "approval-153",
      role: "tool",
      tool_call_id: "select-153-approval",
      content: JSON.stringify({
        status: "awaiting_permission_approval",
        permission_request: { resource: privateResource, suggested_matchers: [{ value: privateValue }] },
      }),
      created_at: "2026-09-24T00:00:03Z",
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
  await page.route(`**/api/v1/respond/${sessionId}/pending`, (route) => route.fulfill({
    json: { has_pending_question: false },
  }))

  await page.goto(standaloneScenario.entryUrl)
  await page.getByRole("button", { name: "Browser selection display", exact: true }).click()
  const toggle = page.locator("[data-tool-call-toggle]")
  await expect(toggle).toContainText("选择网页选项")
  await toggle.click()
  const entries = page.locator("[data-tool-call-entry]")
  await expect(entries).toHaveCount(2)
  for (const summary of await entries.locator("details summary").all()) await summary.click()
  await expect(entries.locator("pre")).toHaveText(["网页选项已选择", "等待用户批准"])
  for (const privateText of [privateValue, privateSelector, privateResource, "select_option", "selected_values", "permission_request"]) {
    await expect(page.locator("body")).not.toContainText(privateText)
  }
  const screenshot = testInfo.outputPath("browser-select-display.png")
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach("Browser selection display", { path: screenshot, contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
