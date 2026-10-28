import { expect, test, type Locator, type Page, type WebSocketRoute } from "@playwright/test"
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

test("a failed source run keeps its completed live tool until canonical history arrives without replay", async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const session = { ...oldSession, title: "Live source fixture", message_count: 0, last_run_status: "completed", last_run_error: "" }
  let history: unknown[] = []
  let failHistory = false
  let failedHistoryReads = 0
  let sequence = 0
  let subscriptions = 0
  let socket: WebSocketRoute | undefined
  const writes: string[] = []
  await page.routeWebSocket(/.*/, (webSocket) => {
    socket = webSocket
    webSocket.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
      if (frame.type === "hello") webSocket.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") webSocket.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch === `agent.${oldId}`) subscriptions += 1
    })
  })
  const emit = (event: Record<string, unknown>) => socket!.send(JSON.stringify({ ch: `agent.${oldId}`, seq: ++sequence, event }))
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() !== "GET" && (path === "/api/v1/chat" || /^\/api\/v1\/(execute|sessions)\//.test(path))) writes.push(`${request.method()} ${path}`)
    if (path === "/api/v1/sessions") {
      const sessions = url.searchParams.get("kind") === "child" ? [] : [session]
      return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
    }
    if (path === `/api/v1/sessions/${oldId}`) return route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
    if (path === `/api/v1/history/${oldId}`) {
      if (failHistory) {
        failedHistoryReads += 1
        return route.fulfill({ status: 503, json: { error: { message: "Synthetic history read unavailable" } } })
      }
      return route.fulfill({ json: { session_id: oldId, messages: history } })
    }
    if (path === "/api/v1/chat") {
      session.is_running = true
      history = [{ id: "current-user", role: "user", content: "Perform the synthetic action once.", created_at: at }]
      return route.fulfill({ json: { session_id: oldId, message_id: "current-user", status: "success" } })
    }
    if (path === `/api/v1/execute/${oldId}`) return route.fulfill({ json: { session_id: oldId, status: "started", run_id: "current-run" } })
    await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner")).toContainText(session.title)
  const input = page.getByRole("textbox", { name: "消息", exact: true })
  await expect(page.getByRole("combobox", { name: "权限模式", exact: true })).toBeEnabled()
  await input.fill("Perform the synthetic action once.")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => subscriptions).toBe(1)
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeVisible()
  const start = { type: "tool_start", tool_call_id: "current-action", tool_name: "exec_command", arguments: { cmd: "synthetic update" } }
  const result = JSON.stringify({ status: "completed", output: receipt, exit_code: 0 })
  emit(start)
  emit(start)
  emit({ type: "tool_complete", tool_call_id: "current-action", result: { success: true, result } })
  emit({ type: "tool_token", tool_call_id: "current-action", content: "LATE_OUTPUT_MUST_NOT_APPEND" })
  emit({ type: "tool_complete", tool_call_id: "current-action", result: { success: false, result: "DUPLICATE_RESULT_MUST_NOT_REPLACE" } })
  failHistory = true
  session.is_running = false
  session.last_run_status = "error"
  session.last_run_error = detail
  emit({ type: "error", message: detail })
  await expect.poll(() => failedHistoryReads).toBeGreaterThan(0)
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeHidden()
  await expect(page.getByRole("alert").filter({ hasText: "会话来源校验未通过" })).toBeVisible()
  const transcript = page.locator("[data-message-list-content]").first()
  await inspectCompletedTool(transcript)
  await expect(transcript).not.toContainText("LATE_OUTPUT_MUST_NOT_APPEND")
  await expect(transcript).not.toContainText("DUPLICATE_RESULT_MUST_NOT_REPLACE")
  await input.fill("Keep this new unsent draft.")
  await info.attach("live-source-history-unavailable", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" })

  history = [...history,
    { id: "current-call", role: "assistant", content: "", created_at: at, tool_calls: [{ id: "current-action", function: { name: "exec_command", arguments: JSON.stringify(start.arguments) } }] },
    { id: "current-result", role: "tool", tool_call_id: "current-action", content: result, created_at: at },
    { id: "checkpoint", role: "assistant", content: "Canonical checkpoint confirmed.", created_at: at },
  ]
  session.message_count = history.length
  failHistory = false
  socket!.send(JSON.stringify({ ch: "feed", seq: 1, event: { seq: 1, ts: at, session_id: oldId,
    event: { type: "message_appended", session_id: oldId, message_id: "checkpoint" } } }))
  await expect(transcript).toContainText("Canonical checkpoint confirmed.")
  await inspectCompletedTool(transcript)
  await expect(input).toHaveText("Keep this new unsent draft.")
  expect(writes).toEqual(["POST /api/v1/chat", `POST /api/v1/execute/${oldId}`])
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses.filter((error) => error !== `503 ${standaloneScenario.origin}/api/v1/history/${oldId}`)).toEqual([])
})

test("a candidate typed Source rejection preserves the unsent draft and the original saved source", async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario, oldHistory)
  const session = { ...oldSession, title: "Source admission fixture", last_run_status: "completed", last_run_error: "" }
  const submissions: Record<string, unknown>[] = [], otherWrites: string[] = []
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (path === "/api/v1/sessions") {
      const sessions = url.searchParams.get("kind") === "child" ? [] : [session]
      return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
    }
    if (path === `/api/v1/sessions/${oldId}` && request.method() === "GET") return route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
    if (request.method() === "POST" && path === "/api/v1/chat") {
      submissions.push(request.postDataJSON())
      return route.fulfill({ status: 409, json: { error: { type: "api_error", code: "session_project_running_conflict",
        message: "A running or starting session cannot change Project or Workspace" }, session_id: oldId } })
    }
    if (request.method() !== "GET" && /^\/api\/v1\/(execute|sessions)\//.test(path)) otherWrites.push(`${request.method()} ${path}`)
    await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner")).toContainText(session.title)
  const input = page.getByRole("textbox", { name: "消息", exact: true })
  await expect(page.getByRole("combobox", { name: "权限模式", exact: true })).toBeEnabled()
  const draft = "Do not lose this rejected draft 原文."
  await input.fill(draft)
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  const alert = page.getByRole("alert").filter({ hasText: "Bamboo 已拒绝此请求，内容已保留" })
  await expect(alert).toContainText("请等待当前运行结束后核对来源")
  await expect(alert).not.toContainText("消息已发送")
  await expect(alert.getByRole("button", { name: "继续编辑", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "重试生成", exact: true })).toHaveCount(0)
  await expect(input).toHaveText(draft)
  await inspectCompletedTool(page.locator("[data-message-list-content]").first())
  await info.attach("candidate-source-admission-rejected", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" })
  expect(submissions).toHaveLength(1)
  expect(submissions[0]).toMatchObject({ message: draft, session_id: oldId })
  expect(submissions[0]).not.toHaveProperty("workspace_path")
  expect(submissions[0]).not.toHaveProperty("project_id")
  expect(otherWrites).toEqual([])
  expect(session.workspace_path).toBe("/synthetic/original")
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([`409 ${standaloneScenario.origin}/api/v1/chat`])
})
