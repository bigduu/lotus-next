import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { selectSettingsCategory, settingsSurface } from "./support/settingsNavigation.js"

const ordinary = "all-surface-session", supervisor = "bamboo-default-supervisor"
const stamp = "2026-10-22T00:00:00Z"
type Failure = "blocked" | "unknown" | "readback" | "running" | "pending" | null
async function fixture(page: Page, failure: Failure = null) {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, ordinary)
  const runtime = await installArtifactRuntime(page, standaloneScenario)
  const writes: { method: string; path: string }[] = []
  const cleared = new Set<string>()
  let failReadback = failure === "readback"
  let pendingEnabled = false
  const session = (id: string) => ({ id, kind: "root", title: id === supervisor ? "Supervisor" : "Clear fixture",
    title_version: 1, pinned: false, root_session_id: id, parent_session_id: null, spawn_depth: 0,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: stamp, updated_at: stamp, last_activity_at: stamp, message_count: cleared.has(id) ? 0 : 1,
    token_usage: null, has_attachments: false, is_running: failure === "running", has_pending_question: pendingEnabled,
    root_orchestration_only: id === supervisor, thinking_mode: "standard", root_mode_transition_epoch: 0,
    root_mode_birth_token: "a".repeat(64), permission_mode: "default", bypass_permissions: false,
    subagent_count: 0, running_child_count: 0, placement: { kind: "local", host: "synthetic" } })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method()
    if (method !== "GET") writes.push({ method, path })
    if (path === "/api/v1/sessions" && method === "GET") {
      const sessions = url.searchParams.get("kind") === "child" ? [] : [session(ordinary), session(supervisor)]
      return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
    }
    for (const id of [ordinary, supervisor]) {
      if (path === `/api/v1/sessions/${id}` && method === "GET") return route.fulfill({ json: { session: session(id) }, headers: { ETag: '"1"' } })
      if (path === `/api/v1/actors/${id}/snapshot`) return route.fulfill({ json: actorSnapshotFixture(id, 0) })
      if (path === `/api/v1/respond/${id}/pending`) return route.fulfill({ json: pendingEnabled
        ? { has_pending_question: true, interaction_kind: "clarification", question: "Synthetic pending question", options: ["A"], allow_custom: true, tool_call_id: "fixture-pending" }
        : { has_pending_question: false } })
      if (path === `/api/v1/history/${id}`) {
        if (cleared.has(id) && failReadback) return route.fulfill({ status: 403, json: { error: "Synthetic readback unavailable" } })
        return route.fulfill({ json: { session_id: id, messages: cleared.has(id) ? [] : [
          { id: `old-${id}`, role: "user", content: `Synthetic history ${id}`, created_at: stamp },
        ] } })
      }
      if (path === `/api/v1/sessions/${id}/clear` && method === "POST") {
        expect(request.postData()).toBeNull()
        if (failure === "blocked") return route.fulfill({ status: 409, json: {
          error: { type: "api_error", code: "session_clear_authority_conflict", message: "Synthetic refusal" },
          session_id: id, status: "blocked", refresh_required: true, retryable: false,
        } })
        cleared.add(id)
        if (failure === "unknown") return route.fulfill({ status: 500, json: {
          error: { type: "api_error", code: "session_clear_outcome_unknown", message: "Synthetic unknown outcome" },
          session_id: id, status: "outcome_unknown", refresh_required: true, retryable: false,
        } })
        return route.fulfill({ json: { success: true, session_id: id } })
      }
    }
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  return { runtime, writes, allowReadback() { failReadback = false }, enablePending() { pendingEnabled = true } }
}
async function openHeader(page: Page) {
  await page.locator("header").getByRole("button", { name: "更多", exact: true }).click()
  await page.getByRole("menuitem", { name: "清除会话消息", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "清除这个会话的消息？", exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
async function openSupervisor(page: Page, phone: boolean) {
  if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
  const row = page.locator("aside").first().getByRole("button", { name: /^Supervisor/ }).locator("..")
  await row.getByRole("button", { name: "会话操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "清除会话消息", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "清除这个会话的消息？", exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
test("ordinary and Supervisor expose the same confirmation; cancelling preserves both synthetic histories", async ({ page }, info) => {
  const f = await fixture(page), first = await openHeader(page)
  await expect(first).toContainText(ordinary)
  await expect(first).toContainText("保留首条系统消息、会话身份、Project 范围、管理关系、独立会话和未完成任务")
  await first.getByRole("button", { name: "取消", exact: true }).click()
  await expect(first).toBeHidden()
  const dialog = await openSupervisor(page, info.project.name === "phone-chromium")
  await expect(dialog).toContainText(supervisor)
  await expect(dialog).toContainText("当前服务不确认原生/provider 上下文已完整重置")
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: info.outputPath("conversation-clear-confirm.png"), animations: "disabled" })
  await dialog.press("Escape"); await expect(dialog).toBeHidden()
  expect(f.writes).toEqual([])
  expect(f.runtime.pageErrors).toEqual([])
})
test("ordinary clear waits for exact receipt and readback, preserving the independent Supervisor", async ({ page }) => {
  const f = await fixture(page), dialog = await openHeader(page)
  await dialog.getByRole("button", { name: "清除会话消息", exact: true }).click()
  await expect(dialog.getByRole("status")).toContainText("服务已确认清理，并已读回核对")
  expect(f.writes).toEqual([{ method: "POST", path: `/api/v1/sessions/${ordinary}/clear` }])
  await dialog.getByRole("button", { name: "关闭", exact: true }).last().click()
  await expect(page.getByText(`Synthetic history ${ordinary}`, { exact: true })).toBeHidden()
  expect(f.runtime.pageErrors).toEqual([])
})
test("simple-mode settings exposes conversation clear while bulk cleanup stays advanced", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("lotus_experience_mode_v1", "simple"))
  const f = await fixture(page)
  if (info.project.name === "phone-chromium") await page.getByRole("button", { name: "菜单", exact: true }).click()
  await page.getByRole("button", { name: "系统设置", exact: true }).click()
  const settings = settingsSurface(page)
  await selectSettingsCategory(settings, "system", "系统")
  await expect(settings.getByRole("button", { name: "清除会话消息", exact: true })).toBeVisible()
  await expect(settings.getByRole("button", { name: "删除全部会话", exact: true })).toHaveCount(0)
  await expect(settings.getByRole("button", { name: "重置会话存储", exact: true })).toHaveCount(0)
  await settings.getByRole("button", { name: "清除会话消息", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "清除这个会话的消息？", exact: true })
  await expect(dialog).toContainText(ordinary)
  await dialog.getByRole("button", { name: "取消", exact: true }).click()
  expect(f.writes).toEqual([])
})
test("activated Supervisor refusal is explicit and does not clear the ordinary conversation", async ({ page }, info) => {
  const f = await fixture(page, "blocked"), dialog = await openSupervisor(page, info.project.name === "phone-chromium")
  await dialog.getByRole("button", { name: "清除会话消息", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("当前清理接口不支持已激活的 Supervisor")
  await expect(dialog.getByRole("status")).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("conversation-clear-blocked.png"), animations: "disabled" })
  expect(f.writes).toEqual([{ method: "POST", path: `/api/v1/sessions/${supervisor}/clear` }])
})
for (const reason of ["readback", "unknown"] as const) {
  test(`${reason} stays unconfirmed across reopen and refresh never repeats the POST`, async ({ page }) => {
    const f = await fixture(page, reason)
    let dialog = await openHeader(page)
    await dialog.getByRole("button", { name: "清除会话消息", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText(reason === "unknown" ? "清理请求的结果未知" : "无法核实存储结果")
    await expect(dialog.getByRole("button", { name: "清除会话消息", exact: true })).toHaveCount(0)
    await dialog.getByRole("button", { name: "关闭", exact: true }).last().click()
    dialog = await openHeader(page)
    await expect(dialog.getByRole("alert")).toBeVisible()
    f.allowReadback()
    await dialog.getByRole("button", { name: "刷新存储状态", exact: true }).click()
    await expect(dialog.getByRole("status")).toContainText(reason === "unknown" ? "此前请求的结果仍未知" : "服务已确认清理，并已读回核对")
    expect(f.writes).toEqual([{ method: "POST", path: `/api/v1/sessions/${ordinary}/clear` }])
  })
}
for (const reason of ["running", "pending"] as const) {
  test(`${reason} prevents clear without automatic stop, approval or retry`, async ({ page }) => {
    const f = await fixture(page, reason), dialog = await openHeader(page)
    if (reason === "pending") f.enablePending()
    await dialog.getByRole("button", { name: "清除会话消息", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText(reason === "running" ? "此会话正在运行" : "待回答的问题或审批")
    expect(f.writes).toEqual([])
  })
}
