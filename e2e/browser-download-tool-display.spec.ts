import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "browser-download-display-session"
const privateBytes = "cHJpdmF0ZS1kb3dubG9hZC0xNTY="
const privateName = "private-download-156.bin"
const privateSelector = "a[data-secret='private-selector-156']"
const privateResource = "browser:17:download:private-fingerprint-156"
const privateUrl = "https://example.test/private-download-156"
const privateSha = "a".repeat(64)
const parameters = JSON.stringify({ action: "download", selector: privateSelector, expected_epoch: 17 })

test("desktop history shows only fixed browser download status", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop tool display screenshot")
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const session = {
    id: sessionId,
    title: "Browser download display",
    kind: "root",
    model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-24T00:00:00Z",
    updated_at: "2026-09-24T00:00:01Z",
    permission_mode: "default",
    is_running: false,
  }
  const history = [
    { id: "user-156", role: "user", content: "Check browser download display", created_at: "2026-09-24T00:00:00Z" },
    {
      id: "assistant-156", role: "assistant", content: "",
      tool_calls: [
        { id: "download-156-result", type: "function", function: { name: "browser", arguments: parameters } },
        { id: "download-156-approval", type: "function", function: { name: "default::browser", arguments: parameters } },
      ],
      created_at: "2026-09-24T00:00:01Z",
    },
    {
      id: "result-156", role: "tool", tool_call_id: "download-156-result",
      content: JSON.stringify({ page_epoch: 17, active_tab_id: "private-tab-156", url: privateUrl, filename: privateName, byte_count: 20, sha256: privateSha, data_base64: privateBytes }),
      created_at: "2026-09-24T00:00:02Z",
    },
    {
      id: "approval-156", role: "tool", tool_call_id: "download-156-approval",
      content: JSON.stringify({ status: "awaiting_permission_approval", permission_request: { resource: privateResource, suggested_matchers: [{ value: privateName }] } }),
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
  await page.getByRole("button", { name: "Browser download display", exact: true }).click()
  const toggle = page.locator("[data-tool-call-toggle]")
  await expect(toggle).toContainText("下载网页文件")
  await toggle.click()
  const entries = page.locator("[data-tool-call-entry]")
  await expect(entries).toHaveCount(2)
  for (const summary of await entries.locator("details summary").all()) await summary.click()
  await expect(entries.locator("pre")).toHaveText(["网页下载已完成", "等待用户批准"])
  for (const privateText of [privateBytes, privateName, privateSelector, privateResource, privateUrl, privateSha, "data_base64", "permission_request"]) {
    await expect(page.locator("body")).not.toContainText(privateText)
  }
  const screenshot = testInfo.outputPath("browser-download-display.png")
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach("Browser download display", { path: screenshot, contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
