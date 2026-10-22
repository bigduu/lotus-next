import { expect, test, type Locator, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const oldId = "all-surface-session"
const freshId = "fresh-source-session"
const detail = "Tool error: Execution failed: Native canonical Session Source scope changed"
const receipt = "SYNTHETIC_UPDATE_PUBLISHED"
const at = "2026-10-22T00:00:00Z"
const oldHistory = [
  { id: "old-request", role: "user", content: "Publish the approved synthetic update once.", created_at: at },
  { id: "old-call", role: "assistant", content: "", created_at: at,
    tool_calls: [{ id: "published-once", function: { name: "exec_command", arguments: JSON.stringify({ cmd: "publish synthetic update" }) } }] },
  { id: "old-result", role: "tool", tool_call_id: "published-once", created_at: at,
    content: JSON.stringify({ status: "completed", output: receipt, exit_code: 0 }) },
]
const baseSession = {
  kind: "root", root_orchestration_only: false, thinking_mode: "standard", reasoning_effort: "max",
  root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
  title_version: 1, pinned: false, parent_session_id: null, spawn_depth: 0,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: at, updated_at: at, last_activity_at: at, has_attachments: false,
  is_running: false, has_pending_question: false, running_child_count: 0,
  permission_mode: "default", bypass_permissions: false,
}
const oldSession = { ...baseSession, id: oldId, root_session_id: oldId, title: "Older source fixture",
  created_at: "2026-09-03T00:00:00Z", message_count: oldHistory.length,
  last_run_status: "error", last_run_error: detail, workspace_path: "/synthetic/original" }
const freshSession = { ...baseSession, id: freshId, root_session_id: freshId, title: "Fresh source fixture",
  message_count: 1, last_run_status: "completed", workspace_path: "/synthetic/fresh" }

async function chooseSession(page: Page, title: string) {
  const button = page.getByRole("button", { name: title, exact: true })
  const bounds = await button.boundingBox()
  if (!bounds || bounds.x + bounds.width <= 0) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await button.click()
  await expect(page.getByRole("banner")).toContainText(title)
}

async function inspectCompletedTool(transcript: Locator) {
  for (const selector of ["[data-process-toggle]", "[data-tool-call-toggle]", "[data-tool-call-entry-toggle]"]) {
    const toggles = transcript.locator(selector)
    for (let index = 0; index < await toggles.count(); index += 1) {
      const toggle = toggles.nth(index)
      if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click()
    }
  }
  await expect(transcript.locator("[data-tool-call-entry]")).toHaveCount(1)
  await expect(transcript.locator("[data-tool-call-entry-detail]")).toContainText(receipt)
  await expect(transcript.locator("[data-tool-call-entry-detail]")).toContainText('"exit_code": 0')
}

for (const theme of ["light", "dark"] as const) {
  test(`older source error keeps completed tools and drafts beside a fresh session in ${theme}`, async ({ page }, info) => {
    test.skip(info.project.name === "tablet-chromium", "desktop and phone cover the saved-session comparison")
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
    await page.addInitScript((mode) => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      localStorage.setItem("lotus_next_last_session", "all-surface-session")
      localStorage.setItem("copilot_ui_theme_v1", mode)
    }, theme)
    const observation = await installArtifactRuntime(page, standaloneScenario, oldHistory)
    const writes: string[] = []
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() !== "GET" && (url.pathname === "/api/v1/chat"
        || /^\/api\/v1\/(execute|sessions)\//.test(url.pathname))) writes.push(`${request.method()} ${url.pathname}`)
      if (url.pathname === "/api/v1/sessions") {
        const sessions = url.searchParams.get("kind") === "child" ? [] : [freshSession, oldSession]
        return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
      }
      if (url.pathname === `/api/v1/sessions/${oldId}`) return route.fulfill({ json: { session: oldSession }, headers: { ETag: '"1"' } })
      if (url.pathname === `/api/v1/sessions/${freshId}`) return route.fulfill({ json: { session: freshSession }, headers: { ETag: '"1"' } })
      if (url.pathname === `/api/v1/history/${freshId}`) return route.fulfill({ json: { session_id: freshId,
        messages: [{ id: "fresh-answer", role: "assistant", content: "Fresh session completed normally.", created_at: at }] } })
      if (url.pathname === `/api/v1/respond/${freshId}/pending`) return route.fulfill({ json: { has_pending_question: false } })
      await route.fallback()
    })
    await page.goto(standaloneScenario.entryUrl)
    await expect(page.getByRole("banner")).toContainText(oldSession.title)
    const alert = page.getByRole("alert").filter({ hasText: "会话来源校验未通过" })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("请先核对会话来源和已完成的操作")
    await alert.locator("summary").click()
    await expect(alert).toContainText(detail)
    const transcript = page.locator("[data-message-list-content]").first()
    await inspectCompletedTool(transcript)
    const draft = "Keep this unsent draft 原文."
    await page.getByRole("textbox", { name: "消息", exact: true }).fill(draft)
    await info.attach(`older-source-${theme}`, { body: await page.screenshot({ fullPage: true, caret: "initial" }), contentType: "image/png" })

    await chooseSession(page, freshSession.title)
    await expect(page.locator(".assistant-streamdown")).toContainText("Fresh session completed normally.")
    await expect(alert).toHaveCount(0)
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeEmpty()
    await chooseSession(page, oldSession.title)
    await expect(alert).toBeVisible()
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveText(draft)
    await inspectCompletedTool(transcript)
    expect(writes).toEqual([])
    expect(observation.pageErrors).toEqual([])
    expect(observation.errorResponses).toEqual([])
  })
}
