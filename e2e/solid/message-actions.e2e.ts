import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

const id = "all-surface-session"
const other = "another-session"
const branched = "forked-session"
const input = "main-question"
const answer = "main-answer"
const time = "2026-09-03T00:00:00.000Z"
const raw = "**保留 Markdown**\n\n另一行"
const summary = (sessionId: string, title: string) => ({
  id: sessionId, title, kind: "root", title_version: 1, created_at: time, updated_at: time, last_activity_at: time,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  permission_mode: "default", root_orchestration_only: false, thinking_mode: "standard", root_mode_birth_token: "a".repeat(64),
  root_mode_transition_epoch: 1, session_version: 2, is_running: false, last_run_status: "completed",
  execution_compatibility: { status: "compatible", session_version: 2, current_session_version: 2, execution_allowed: true, history_readable: true, conflicts: [] },
})
const original = summary(id, "Main conversation")
const nextSession = summary(other, "Another conversation")
const forkSession = summary(branched, "Forked conversation")
async function prepare(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin
  const entryUrl = origin + "/"
  const requests: Array<{ path: string; body?: unknown }> = []
  const sessions = [original, nextSession]
  const messages = [
    { id: input, role: "user", content: "原始问题", created_at: time },
    { id: answer, role: "assistant", content: raw, phase: "final_answer", created_at: time },
  ]
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, id)
  const observation = await installArtifactRuntime(page, { ...standaloneScenario, origin, entryUrl }, messages, {
    serveStaticFromLocalServer: true, sessionFeatures: ["session_side_chat"],
  })
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0,
    features: ["session_side_chat"] } }))
  await page.route(new RegExp("/api/v1/sessions/(" + [id, other, branched].join("|") + ")$"), (route) => {
    const requested = new URL(route.request().url()).pathname.split("/").at(-1)
    return route.fulfill({ json: { session: sessions.find((session) => session.id === requested) }, headers: { ETag: '"1"' } })
  })
  await page.route("**/api/v1/history/*", (route) => {
    const requested = new URL(route.request().url()).pathname.split("/").at(-1)
    return route.fulfill({ json: { session_id: requested, messages: requested === id ? messages : [] } })
  })
  await page.route(`**/api/v1/execute/${id}`, (route) => {
    requests.push({ path: "execute" })
    return route.fulfill({ json: { session_id: id, status: "started", run_id: "solid-message-actions-run" } })
  })
  await page.goto(entryUrl)
  await expect(page.getByRole("heading", { name: original.title, exact: true })).toBeVisible()
  await expect(page.locator(`[data-message-row="${answer}"]`)).toContainText("保留 Markdown")
  return { requests, sessions, messages, observation }
}

const actions = (page: Page, id: string) => page.locator(`[data-message-actions="${id}"]`)
const openMenu = async (page: Page, id: string) => {
  await actions(page, id).getByRole("button", { name: "更多消息操作", exact: true }).click()
  return page.getByRole("menu")
}

test("copies the exact Markdown and keeps the Side Chat option in the same menu", async ({ page, baseURL, context, isMobile }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const fixture = await prepare(page, baseURL!)
  if (isMobile) await (await openMenu(page, answer)).getByRole("menuitem", { name: "复制", exact: true }).click()
  else await actions(page, answer).getByRole("button", { name: "复制", exact: true }).click()
  await expect(page.getByRole("menu")).not.toBeVisible()
  await expect(actions(page, answer)).toHaveAttribute("data-copy-state", "copied")
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(raw)
  await expect((await openMenu(page, answer)).getByRole("menuitem", { name: "在侧聊中提问" })).toBeVisible()
  expect(fixture.requests).toEqual([])
  expect(fixture.observation.pageErrors).toEqual([])
})

test("restores row focus after cancelling an edit, then patches, restores and executes in that order", async ({ page, baseURL, isMobile }) => {
  const fixture = await prepare(page, baseURL!)
  await page.route(`**/api/v1/sessions/${id}/messages/${input}`, async (route) => {
    fixture.requests.push({ path: "patch", body: route.request().postDataJSON() })
    fixture.messages[0].content = "已编辑的问题"
    return route.fulfill({ status: 204 })
  })
  await page.route(`**/api/v1/sessions/${id}/restore`, (route) => {
    fixture.requests.push({ path: "restore", body: route.request().postDataJSON() })
    return route.fulfill({ json: { session_id: id, target_message_id: input, success: true } })
  })
  await (await openMenu(page, input)).getByRole("menuitem", { name: "编辑并重发" }).click()
  const editor = page.getByRole("textbox", { name: "编辑并重发" })
  await expect(editor).toHaveValue("原始问题")
  await expect(editor).toBeFocused()
  await editor.press("Escape")
  await expect(actions(page, input).getByRole("button", { name: "更多消息操作" })).toBeFocused()
  await (await openMenu(page, input)).getByRole("menuitem", { name: "编辑并重发" }).click()
  await editor.fill("已编辑的问题")
  if (isMobile) await page.getByRole("button", { name: "保存并重发" }).click()
  else await editor.press("Control+Enter")
  await expect.poll(() => fixture.requests.map((request) => request.path)).toEqual(["patch", "restore", "execute"])
  expect(fixture.requests[0].body).toEqual({ content: "已编辑的问题" })
  expect(fixture.requests[1].body).toEqual({ target_message_id: input, restore_files: false })
  expect(fixture.observation.pageErrors).toEqual([])
})

test("preserves a refused edit without restoring or running", async ({ page, baseURL }) => {
  const fixture = await prepare(page, baseURL!)
  await page.route(`**/api/v1/sessions/${id}/messages/${input}`, (route) => {
    fixture.requests.push({ path: "patch" })
    return route.fulfill({ status: 400, json: { error: { code: "invalid_message", message: "Refused" } } })
  })
  await page.route(`**/api/v1/sessions/${id}/restore`, (route) => {
    fixture.requests.push({ path: "restore" })
    return route.fulfill({ json: { session_id: id, target_message_id: input, success: true } })
  })
  await (await openMenu(page, input)).getByRole("menuitem", { name: "编辑并重发" }).click()
  const editor = page.getByRole("textbox", { name: "编辑并重发" })
  await editor.fill("保留我的修改")
  await page.getByRole("button", { name: "保存并重发" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "操作失败" })).toBeVisible()
  await expect(editor).toHaveValue("保留我的修改")
  expect(fixture.requests.map((request) => request.path)).toEqual(["patch"])
})

test("regenerates only the latest reply after a truncate receipt for the exact session", async ({ page, baseURL }) => {
  const fixture = await prepare(page, baseURL!)
  let acknowledgedSession = other
  await page.route(`**/api/v1/sessions/${id}/messages/truncate`, (route) => {
    fixture.requests.push({ path: "truncate", body: route.request().postDataJSON() })
    return route.fulfill({ json: { session_id: acknowledgedSession, success: true } })
  })
  await expect((await openMenu(page, input)).getByRole("menuitem", { name: "重新生成" })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await (await openMenu(page, answer)).getByRole("menuitem", { name: "重新生成" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "操作失败" })).toBeVisible()
  expect(fixture.requests).toEqual([{ path: "truncate", body: { mode: "after_last_user" } }])

  acknowledgedSession = id
  await (await openMenu(page, answer)).getByRole("menuitem", { name: "重新生成" }).click()
  await expect.poll(() => fixture.requests).toEqual([
    { path: "truncate", body: { mode: "after_last_user" } },
    { path: "truncate", body: { mode: "after_last_user" } },
    { path: "execute" },
  ])
  expect(fixture.observation.pageErrors).toEqual([])
})

test("deletes exactly the selected message and reloads the resulting history", async ({ page, baseURL }) => {
  const fixture = await prepare(page, baseURL!)
  await page.route(`**/api/v1/sessions/${id}/messages/${answer}`, (route) => {
    fixture.requests.push({ path: route.request().method() })
    fixture.messages.splice(1, 1)
    return route.fulfill({ status: 204 })
  })
  await (await openMenu(page, answer)).getByRole("menuitem", { name: "删除", exact: true }).click()
  await expect(page.locator(`[data-message-row="${answer}"]`)).toHaveCount(0)
  expect(fixture.requests).toEqual([{ path: "DELETE" }])
  expect(fixture.observation.pageErrors).toEqual([])
})

test("late fork acknowledgement keeps the newly selected current session", async ({ page, baseURL, isMobile }) => {
  const fixture = await prepare(page, baseURL!)
  let resolveFork!: () => void
  const waiting = new Promise<void>((resolve) => { resolveFork = resolve })
  await page.route(`**/api/v1/sessions/${id}/fork`, async (route) => {
    fixture.requests.push({ path: "fork", body: route.request().postDataJSON() })
    await waiting
    fixture.sessions.push(forkSession)
    return route.fulfill({ json: { session: { id: branched } } })
  })
  if (isMobile) await (await openMenu(page, answer)).getByRole("menuitem", { name: "从这里分叉", exact: true }).click()
  else await actions(page, answer).getByRole("button", { name: "从这里分叉", exact: true }).click()
  await expect.poll(() => fixture.requests).toEqual([{ path: "fork", body: { up_to_message_id: answer } }])
  const progress = page.getByRole("status").filter({ hasText: "分叉中…" })
  await expect(progress).toBeVisible()
  if (isMobile) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await page.getByText(nextSession.title, { exact: true }).click()
  await expect(progress).toBeHidden()
  await expect(page.getByRole("heading", { name: nextSession.title, exact: true })).toBeVisible()
  const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/sessions" && response.ok())
  resolveFork()
  await refreshed
  if (!isMobile) await expect(page.getByText(forkSession.title, { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: nextSession.title, exact: true })).toBeVisible()
  expect(fixture.observation.pageErrors).toEqual([])
})
