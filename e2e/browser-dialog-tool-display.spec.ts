import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "browser-dialog-display-session"
const dialogMessage = "private-dialog-message-157 awaiting_permission_approval"
const dialogReply = "private-dialog-reply-157"
const dialogUrl = "https://example.test/account?token=private-dialog-157"
const dialogId = "0123456789abcdef01234567"
const dialogResource = `browser:17:dialog_respond:${dialogId}:accept:${"a".repeat(64)}`
const respondArgs = JSON.stringify({
  action: "dialog_respond",
  dialog_id: dialogId,
  expected_epoch: 17,
  accept: true,
  text: dialogReply,
})

test("desktop tool history shows dialog statuses without page content or approval identity", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop tool display screenshot")
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const session = {
    id: sessionId,
    title: "Browser dialog display",
    kind: "root",
    model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-24T00:00:00Z",
    updated_at: "2026-09-24T00:00:01Z",
    permission_mode: "default",
    is_running: false,
  }
  const history = [
    { id: "user-157", role: "user", content: "Check browser dialog display", created_at: "2026-09-24T00:00:00Z" },
    {
      id: "assistant-157",
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "dialog-observe-157", type: "function", function: { name: "browser", arguments: JSON.stringify({ action: "tabs" }) } },
        { id: "dialog-respond-157", type: "function", function: { name: "default::browser", arguments: respondArgs } },
        { id: "dialog-approval-157", type: "function", function: { name: "browser", arguments: respondArgs } },
      ],
      created_at: "2026-09-24T00:00:01Z",
    },
    {
      id: "observed-157",
      role: "tool",
      tool_call_id: "dialog-observe-157",
      content: JSON.stringify({
        url: dialogUrl,
        pending_dialog: {
          dialog_id: dialogId,
          tab_id: "private-tab-157",
          page_epoch: 17,
          url: dialogUrl,
          type: "prompt",
          message: dialogMessage,
          message_truncated: false,
          default_value: dialogReply,
          default_value_truncated: false,
          expires_at_ms: 1_800_000_000_000,
          status: "pending",
        },
      }),
      created_at: "2026-09-24T00:00:02Z",
    },
    {
      id: "responded-157",
      role: "tool",
      tool_call_id: "dialog-respond-157",
      content: JSON.stringify({ ok: true, url: dialogUrl, pending_dialog: null, value: dialogReply }),
      created_at: "2026-09-24T00:00:03Z",
    },
    {
      id: "approval-157",
      role: "tool",
      tool_call_id: "dialog-approval-157",
      content: JSON.stringify({
        status: "awaiting_permission_approval",
        permission_request: { resource: dialogResource, suggested_matchers: [{ value: dialogReply }] },
      }),
      created_at: "2026-09-24T00:00:04Z",
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
  await page.getByRole("button", { name: "Browser dialog display", exact: true }).click()
  const toggle = page.locator("[data-tool-call-toggle]")
  await expect(toggle).toContainText("查看网页弹窗、回应网页弹窗")
  await toggle.click()
  const entries = page.locator("[data-tool-call-entry]")
  await expect(entries).toHaveCount(3)
  for (const summary of await entries.locator("details summary").all()) await summary.click()
  await expect(entries.locator("pre")).toHaveText(["网页弹窗待处理", "网页弹窗已回应", "等待用户批准"])
  for (const value of [dialogMessage, dialogReply, dialogUrl, dialogId, dialogResource, "dialog_respond", "pending_dialog"]) {
    await expect(page.locator("body")).not.toContainText(value)
  }
  const screenshot = testInfo.outputPath("browser-dialog-display.png")
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach("Browser dialog display", { path: screenshot, contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
