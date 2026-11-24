import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { expectComposerText } from "./support/composer.js"

const sessionId = "all-surface-session"
const otherSessionId = "workflow-other-session"
const primaryTitle = "All-surface acceptance"
const otherTitle = "Other workflow session"
const definition = {
  id: "inspect-files", name: "Inspect files", description: "Read the project files",
  kind: "orchestration", source: "user", revision: 7, status: "valid", winner: true,
  invocation_policy: { explicit: true }, argument_schema: { type: "object" },
}
const legacy = {
  ...definition, id: "legacy", name: "Legacy instructions",
  kind: "instruction", description: "Old Markdown workflow",
}
const at = "2026-09-26T00:00:00.000Z"
const run = {
  run_id: "inspect-run", session_id: sessionId, workflow_id: definition.id, workflow_revision: definition.revision,
  status: "succeeded", can_cancel: false, last_sequence: 1,
  plan: { type: "step", step: "read" },
  steps: { read: { id: "read", status: "succeeded", attempts: 1 } },
  budget: { max_steps: 2, max_retries: 0, max_agents: 0, wall_time_ms: 1000 },
  usage: { steps: 1, retries: 0, agents: 0, tokens: 0, cost_micros: null },
  child_agent_count: 0, created_at: at, updated_at: at,
}

test("chat offers executable Workflow Runs while preserving the user's draft", async ({ page }, testInfo) => {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
  }, sessionId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const catalogQueries: URLSearchParams[] = []
  const legacyRequests: string[] = []
  const chatWrites: string[] = []
  const starts: unknown[] = []
  if (testInfo.project.name === "desktop-chromium") {
    const primary = {
      id: sessionId, title: primaryTitle, root_session_id: sessionId, kind: "root",
      model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
      created_at: at, updated_at: at, last_activity_at: at, message_count: 0,
      is_running: false, last_run_status: "completed", permission_mode: "default",
    }
    const other = { ...primary, id: otherSessionId, root_session_id: otherSessionId, title: otherTitle }
    await page.route("**/api/v1/sessions?*", (route) => route.fulfill({
      json: { sessions: [primary, other], total: 2, limit: 200, offset: 0 },
    }))
    await page.route("**/api/v1/sessions/" + otherSessionId, (route) => route.fulfill({ json: { session: other } }))
    await page.route("**/api/v1/history/" + otherSessionId, (route) => route.fulfill({ json: { session_id: otherSessionId, messages: [] } }))
    await page.route("**/api/v1/respond/" + otherSessionId + "/pending", (route) => route.fulfill({ json: { has_pending_question: false } }))
    await page.route("**/api/v1/task/" + otherSessionId, (route) => route.fulfill({ json: { session_id: otherSessionId, items: [] } }))
  }
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (/^\/api\/v1\/(?:commands|bamboo\/workflows)(?:\/|$)/.test(path)) legacyRequests.push(path)
    if (request.method() === "POST" && /^\/api\/v1\/(?:chat|sessions\/[^/]+\/(?:guidance|messages))(?:\/|$)/.test(path)) {
      chatWrites.push(path)
    }
  })
  await page.route("**/api/v1/bamboo/workflow-catalog?*", (route) => {
    const query = new URL(route.request().url()).searchParams
    catalogQueries.push(query)
    const visible = query.get("session_id") === otherSessionId
      ? { ...definition, id: "inspect-other", name: "Inspect other files" }
      : definition
    // Older Hosts can still return both kinds in the same response.
    return route.fulfill({ json: { revision: 100, entries: [legacy, visible] } })
  })
  await page.route("**/api/v1/sessions/*/workflow-runs", (route) => {
    const routeSession = new URL(route.request().url()).pathname.split("/").at(-2)
    if (route.request().method() === "POST") {
      expect(routeSession).toBe(sessionId)
      starts.push(route.request().postDataJSON())
      return route.fulfill({ status: 202, json: run })
    }
    return route.fulfill({ json: routeSession === sessionId && starts.length ? [run] : [] })
  })
  await page.route("**/api/v1/sessions/*/workflow-runs/inspect-run", (route) => route.fulfill({ json: run }))
  await page.route("**/api/v1/sessions/*/workflow-runs/inspect-run/events?*", (route) => route.fulfill({ json: [] }))

  await page.goto(standaloneScenario.entryUrl)
  await expect(page.locator('[data-variant="composer"][aria-label="会话权限"]')).toBeVisible()
  const composer = page.getByRole("textbox", { name: "消息", exact: true })
  await composer.fill("/legacy")
  await expect(page.getByRole("option", { name: /^\/legacy(?:\s|$)/ })).toHaveCount(0)
  await composer.fill("/workflow")
  expect(catalogQueries).toHaveLength(0)
  const command = page.getByRole("option", { name: /^\/workflow(?:\s|$)/ })
  await command.click()
  const dialog = page.getByRole("dialog", { name: "编排运行" })
  await expect(dialog).toBeVisible()
  const choices = dialog.getByLabel("选择编排")
  await expect(choices.locator("option").filter({ hasText: "Inspect files" })).toHaveCount(1)
  await expect(choices.locator("option").filter({ hasText: "Legacy instructions" })).toHaveCount(0)
  expect(catalogQueries[0]?.get("orchestration_only")).toBe("true")
  expect(catalogQueries[0]?.get("session_id")).toBe(sessionId)
  await choices.selectOption("user:inspect-files:7")
  await dialog.getByRole("button", { name: "启动运行", exact: true }).click()
  await expect.poll(() => starts).toEqual([{ workflow_id: "inspect-files", revision: 7, args: {} }])
  await expect(dialog.getByText(run.run_id, { exact: true })).toBeVisible()
  await testInfo.attach("session-workflow-run", {
    body: await dialog.screenshot(),
    contentType: "image/png",
  })
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expectComposerText(composer, "/workflow")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expectComposerText(composer, "/workflow")
  if (testInfo.project.name === "desktop-chromium") {
    await page.getByRole("button", { name: otherTitle, exact: true }).click()
    await expectComposerText(composer, "")
    await composer.fill("/workflow")
    await command.click()
    await expect(dialog.getByRole("option", { name: /Inspect other files/ })).toHaveCount(1)
    await expect(dialog.getByRole("option", { name: /Inspect files/ })).toHaveCount(0)
    expect(catalogQueries.at(-1)?.get("session_id")).toBe(otherSessionId)
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await page.getByRole("button", { name: primaryTitle, exact: true }).click()
    await expectComposerText(composer, "/workflow")
  }
  expect(chatWrites).toEqual([])
  expect(legacyRequests).toEqual([])
  expect(observation.pageErrors).toEqual([])
})
