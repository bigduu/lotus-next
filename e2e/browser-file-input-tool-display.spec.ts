import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "browser-file-input-display-session"
const privateBytes = "cHJpdmF0ZS1maWxlLWJ5dGVzLTE1NQ=="
const privateName = "private-file-155.txt"
const privateMimeType = "application/x-private-155"
const privateSelector = "input[data-account='private-selector-155']"
const privateResource = "browser:17:set_file_input:private-fingerprint-155"
const parameters = JSON.stringify({
  action: "set_file_input",
  selector: privateSelector,
  filename: privateName,
  mime_type: privateMimeType,
  data_base64: privateBytes,
  expected_epoch: 17,
})

test("desktop history shows browser file input status without file data", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop tool display screenshot")
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const session = {
    id: sessionId,
    title: "Browser file input display",
    kind: "root",
    model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-24T00:00:00Z",
    updated_at: "2026-09-24T00:00:01Z",
    permission_mode: "default",
    is_running: false,
  }
  const history = [
    { id: "user-155", role: "user", content: "Check browser file input display", created_at: "2026-09-24T00:00:00Z" },
    {
      id: "assistant-155",
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "file-155-result", type: "function", function: { name: "browser", arguments: parameters } },
        { id: "file-155-approval", type: "function", function: { name: "default::browser", arguments: parameters } },
      ],
      created_at: "2026-09-24T00:00:01Z",
    },
    {
      id: "result-155",
      role: "tool",
      tool_call_id: "file-155-result",
      content: JSON.stringify({ ok: true, data_base64: privateBytes, filename: privateName, mime_type: privateMimeType }),
      created_at: "2026-09-24T00:00:02Z",
    },
    {
      id: "approval-155",
      role: "tool",
      tool_call_id: "file-155-approval",
      content: JSON.stringify({
        status: "awaiting_permission_approval",
        permission_request: { resource: privateResource, suggested_matchers: [{ value: privateName }] },
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
  await page.getByRole("button", { name: "Browser file input display", exact: true }).click()
  const toggle = page.locator("[data-tool-call-toggle]")
  await expect(toggle).toContainText("设置网页文件")
  await toggle.click()
  const entries = page.locator("[data-tool-call-entry]")
  await expect(entries).toHaveCount(2)
  for (const summary of await entries.locator("details summary").all()) await summary.click()
  await expect(entries.locator("pre")).toHaveText(["网页文件已设置", "等待用户批准"])
  for (const privateText of [privateBytes, privateName, privateMimeType, privateSelector, privateResource, "set_file_input", "data_base64", "permission_request"]) {
    await expect(page.locator("body")).not.toContainText(privateText)
  }
  const screenshot = testInfo.outputPath("browser-file-input-display.png")
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach("Browser file input display", { path: screenshot, contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
