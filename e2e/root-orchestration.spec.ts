import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "all-surface-session"
const childId = "root-mode-child"
const at = "2026-09-26T00:00:00.000Z"

const rootSession = {
  id: sessionId, title: "Root mode acceptance", title_version: 1, kind: "root", pinned: false,
  root_session_id: sessionId, parent_session_id: null, spawn_depth: 0,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: at, updated_at: at, last_activity_at: at, message_count: 0,
  has_attachments: false, is_running: false, last_run_status: "completed",
  permission_mode: "default", bypass_permissions: false, subagent_count: 0,
}

test("Root mode creation, disable, typed rejection, and reload use durable Bamboo state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet-chromium", "desktop and phone cover the responsive composer")
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let created = false
  let durable = false
  let rejectEnable = false
  const chatRequests: Array<Record<string, unknown>> = []
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({
    json: { sessions: created ? [rootSession] : [], total: created ? 1 : 0, limit: 200, offset: 0 },
  }))
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => route.fulfill({
    json: { session: { ...rootSession, root_orchestration_only: durable } },
    headers: { ETag: '"1"' },
  }))
  await page.route(`**/api/v1/task/${sessionId}`, (route) => route.fulfill({
    json: { session_id: sessionId, items: [] },
  }))
  await page.route("**/api/v1/chat", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    chatRequests.push(body)
    if (rejectEnable && body.root_orchestration_only === true) {
      rejectEnable = false
      return route.fulfill({ status: 409, json: { error: {
        code: "root_orchestration_incompatible_mode",
        message: "Exit legacy PlanMode before enabling Root orchestration-only mode",
      } } })
    }
    created = true
    if (typeof body.root_orchestration_only === "boolean") durable = body.root_orchestration_only
    return route.fulfill({ json: { session_id: sessionId, status: "success" } })
  })
  await page.route(`**/api/v1/execute/${sessionId}`, (route) => route.fulfill({
    json: { status: "started", session_id: sessionId },
  }))

  await page.goto(standaloneScenario.entryUrl)
  const mode = page.getByRole("checkbox", { name: "Root 仅编排模式" })
  await expect(mode).toBeVisible()
  await mode.focus()
  await page.keyboard.press("Space")
  await expect(mode).toBeChecked()
  await page.getByRole("button", { name: "查看 Root 仅编排说明" }).click()
  await expect(page.getByText(/Root 负责任务编排、子代理进度和纠偏/)).toBeVisible()
  await page.keyboard.press("Escape")

  const composer = page.getByRole("textbox", { name: "消息", exact: true })
  await composer.fill("delegate bounded work")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chatRequests.length).toBe(1)
  expect(chatRequests[0].root_orchestration_only).toBe(true)
  expect(chatRequests[0].session_id).toBeUndefined()
  await page.reload()
  await expect(mode).toBeChecked()
  await expect(page.getByRole("status").filter({ hasText: "服务器已启用" })).toBeVisible()

  await mode.focus()
  await page.keyboard.press("Space")
  await expect(mode).not.toBeChecked()
  await expect(page.getByRole("status").filter({ hasText: "待关闭 · 当前已启用" })).toBeVisible()
  await composer.fill("return to direct execution")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chatRequests.length).toBe(2)
  expect(chatRequests[1]).toMatchObject({ session_id: sessionId, root_orchestration_only: false })
  await page.reload()
  await expect(mode).not.toBeChecked()
  await expect(page.getByRole("status").filter({ hasText: "服务器已关闭" })).toBeVisible()

  rejectEnable = true
  await mode.focus()
  await page.keyboard.press("Space")
  await expect(mode).toBeChecked()
  await expect(page.getByRole("status").filter({ hasText: "待启用 · 当前已关闭" })).toBeVisible()
  await composer.fill("delegate while PlanMode is active")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chatRequests.length).toBe(3)
  expect(chatRequests[2]).toMatchObject({ session_id: sessionId, root_orchestration_only: true })
  await expect(page.getByText("Bamboo 已拒绝此模式切换，内容已保留")).toBeVisible()
  await expect(page.getByText("Exit legacy PlanMode before enabling Root orchestration-only mode")).toBeVisible()
  await expect(mode).not.toBeChecked()

  await mode.focus()
  await page.keyboard.press("Space")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chatRequests.length).toBe(4)
  expect(chatRequests[3]).toMatchObject({ session_id: sessionId, root_orchestration_only: true })
  await page.reload()
  await expect(mode).toBeChecked()
  await expect(page.getByRole("status").filter({ hasText: "服务器已启用" })).toBeVisible()

  const overflow = await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await testInfo.attach("root-mode-after-reload", { body: await page.screenshot(), contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
})

test("restored Child composer exposes a read-only Root mode control", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "session restore boundary")
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, childId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const parent = { ...rootSession, subagent_count: 1 }
  const child = {
    ...rootSession,
    id: childId, title: "Review child", kind: "child",
    root_session_id: sessionId, parent_session_id: sessionId, spawn_depth: 1,
  }
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === "GET" && url.pathname === "/api/v1/sessions") {
      const sessions = url.searchParams.get("kind") === "child" ? [child] : [parent]
      return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
    }
    if (route.request().method() === "GET" && url.pathname === `/api/v1/sessions/${sessionId}`) {
      return route.fulfill({ json: { session: parent }, headers: { ETag: '"1"' } })
    }
    if (route.request().method() === "GET" && url.pathname === `/api/v1/sessions/${childId}`) {
      return route.fulfill({ json: { session: child }, headers: { ETag: '"1"' } })
    }
    if (route.request().method() === "GET" && url.pathname === `/api/v1/history/${childId}`) {
      return route.fulfill({ json: { session_id: childId, messages: [] } })
    }
    if (route.request().method() === "GET" && url.pathname === `/api/v1/respond/${childId}/pending`) {
      return route.fulfill({ json: { has_pending_question: false } })
    }
    return route.fallback()
  })

  await page.goto(standaloneScenario.entryUrl)
  const mode = page.getByRole("checkbox", { name: "Root 仅编排模式" })
  await expect(mode).toBeVisible()
  await expect(mode).toBeDisabled()
  await expect(page.getByRole("status").filter({ hasText: "仅 Root 可设置" })).toBeVisible()
  expect(observation.pageErrors).toEqual([])
})

test("a timed-out mode switch stays fenced after stale detail and late server commit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet-chromium", "desktop and phone cover the responsive uncertainty state")
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, sessionId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let durable = true
  let chatPosts = 0
  let executePosts = 0
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({
    json: { sessions: [rootSession], total: 1, limit: 200, offset: 0 },
  }))
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => route.fulfill({
    json: { session: { ...rootSession, root_orchestration_only: durable } },
    headers: { ETag: '"1"' },
  }))
  await page.route(`**/api/v1/task/${sessionId}`, (route) => route.fulfill({
    json: { session_id: sessionId, items: [] },
  }))
  await page.route("**/api/v1/chat", async (route) => {
    chatPosts += 1
    const body = route.request().postDataJSON() as Record<string, unknown>
    expect(body).toMatchObject({ session_id: sessionId, root_orchestration_only: false })
    await route.abort("timedout")
    setTimeout(() => { durable = false }, 250)
  })
  await page.route(`**/api/v1/execute/${sessionId}`, (route) => {
    executePosts += 1
    return route.fulfill({ json: { status: "started", session_id: sessionId } })
  })

  await page.goto(standaloneScenario.entryUrl)
  const mode = page.getByRole("checkbox", { name: "Root 仅编排模式" })
  const composer = page.getByRole("textbox", { name: "消息", exact: true })
  await expect(mode).toBeChecked()
  await mode.uncheck()
  await composer.fill("switch to direct work")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chatPosts).toBe(1)
  await expect(page.getByRole("status").filter({ hasText: "权限结果未知" })).toBeVisible()
  await expect(mode).toBeDisabled()
  await expect(page.getByText("服务器已启用")).toHaveCount(0)
  await expect.poll(() => durable).toBe(false)

  await page.reload()
  await expect(page.getByRole("status").filter({ hasText: "权限结果未知" })).toBeVisible()
  await expect(mode).toBeDisabled()
  await composer.fill("resume without boolean")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect(composer).toHaveValue("resume without boolean")
  expect(chatPosts).toBe(1)
  expect(executePosts).toBe(0)
  const overflow = await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await testInfo.attach("root-mode-uncertain-after-reload", { body: await page.screenshot(), contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
})
