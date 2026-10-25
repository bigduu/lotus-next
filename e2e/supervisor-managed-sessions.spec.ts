import { expect, test, type Page } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const incarnation = "11111111-1111-4111-8111-111111111111"
async function fixture(page: Page, unconfirmed = false, managedTarget = false) {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const runtime = await installArtifactRuntime(page, standaloneScenario, [], { bootstrapRequestState: "local_bypass" })
  const sessions = ["bamboo-default-supervisor", "root-a", "root-b"].map((id) => ({ id, title: id === "bamboo-default-supervisor" ? "Supervisor" : `Target ${id}`,
    title_version: 1, kind: "root", root_session_id: id, parent_session_id: null, spawn_depth: 0, project_id: "p1", pinned: false,
    model: "target-owned-model", created_at: "2026-10-25T00:00:00Z", updated_at: "2026-10-25T00:00:00Z", last_activity_at: "2026-10-25T00:00:00Z",
    message_count: id === "root-a" ? 1 : 0, is_running: false, has_pending_question: false, has_attachments: false, subagent_count: 0,
    root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 0,
    root_mode_birth_token: "a".repeat(64), permission_mode: "default", bypass_permissions: false }))
  let revision = 4
  const links: Array<{ session_id: string; link_revision: number; enabled: boolean; authorized: boolean; target_created_at: string; target_project_id: string; target_metadata_version: number }> = []
  const writes: unknown[] = []
  const historyReads: string[] = [], sessionMutations: string[] = []
  if (managedTarget) links.push({ session_id: "root-a", link_revision: revision, enabled: true, authorized: true,
    target_created_at: "2026-10-25T00:00:00Z", target_project_id: "p1", target_metadata_version: 0 })
  const supervisor = { session_id: "bamboo-default-supervisor", incarnation_id: incarnation }
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== "GET" && /^\/api\/v1\/(sessions|history|chat|execute)(?:\/|$)/.test(path)) sessionMutations.push(path)
    if (path === "/api/v1/supervisor/default/sessions") return route.fulfill({ json: { capabilities: { managed_sessions_http_v1: true },
      scope: { supervisor, state_revision: revision, allowed_projects: ["p1"] }, sessions: links,
      owner_authorization: { available: true, required: true, kind: "existing_access", http_registration: false, code: null } } })
    if (path.startsWith("/api/v1/supervisor/default/sessions/") && request.method() === "PUT") {
      const body = request.postDataJSON(); writes.push(body)
      expect(Object.keys(body).sort()).toEqual(["enabled", "expected_state_revision", "incarnation_id"])
      expect(body.incarnation_id).toBe(incarnation); expect(body.expected_state_revision).toBe(revision)
      revision += 1
      links.push({ session_id: path.split("/").at(-1)!, link_revision: revision, enabled: body.enabled, authorized: body.enabled,
        target_created_at: "2026-10-25T00:00:00Z", target_project_id: "p1", target_metadata_version: 0 })
      return unconfirmed ? route.fulfill({ status: 503, json: { code: "managed_sessions_outcome_unconfirmed" } })
        : route.fulfill({ json: { receipt: { supervisor, state_revision: revision, changed: true, link_revision: revision } } })
    }
    if (path === "/api/v1/sessions" && request.method() === "GET") {
      const rows = new URL(request.url()).searchParams.get("kind") === "child" ? [] : sessions
      return route.fulfill({ json: { sessions: rows, total: rows.length, limit: 100, offset: 0 } })
    }
    const selected = sessions.find((session) => path === `/api/v1/sessions/${session.id}`)
    if (selected && request.method() === "GET") return route.fulfill({ json: { session: selected }, headers: { ETag: '"0"' } })
    if (path === "/api/v1/supervisor/default" && request.method() === "POST") return route.fulfill({ json: { ...supervisor, created: false } })
    if (sessions.some((session) => path === `/api/v1/history/${session.id}`)) {
      const id = path.split("/").at(-1)!
      historyReads.push(id)
      return route.fulfill({ json: { session_id: id, messages: id === "root-a" ? [{ id: "persisted-idle-answer", role: "assistant",
        content: "Persisted idle target result with original context", created_at: "2026-10-25T00:00:00Z" }] : [] } })
    }
    const actor = sessions.find((session) => path === `/api/v1/actors/${session.id}/snapshot`)
    if (actor) return route.fulfill({ json: actorSnapshotFixture(actor.id, 0) })
    const task = sessions.find((session) => path === `/api/v1/task/${session.id}`)
    if (task) return route.fulfill({ json: { session_id: task.id, items: [] } })
    if (sessions.some((session) => path === `/api/v1/respond/${session.id}/pending`)) return route.fulfill({ json: { has_pending_question: false } })
    return route.fallback()
  })
  return { runtime, writes, historyReads, sessionMutations }
}
async function open(page: Page, phone: boolean) {
  await page.goto(standaloneScenario.entryUrl)
  if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
  const row = page.locator("aside").first().getByRole("button", { name: "Supervisor", exact: true }).locator("..")
  const trigger = row.getByRole("button", { name: "会话操作", exact: true })
  await trigger.click(); await page.getByRole("menuitem", { name: "管理会话", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "受管会话", exact: true })
  await expect(dialog.locator('[data-managed-session="root-a"]')).toBeVisible()
  return { dialog, trigger }
}
test("explicitly adds an existing independent session and preserves target settings", async ({ page }, info) => {
  const f = await fixture(page), { dialog, trigger } = await open(page, info.project.name === "phone-chromium")
  await expect(dialog).toContainText("target-owned-model"); expect(f.writes).toEqual([])
  await dialog.locator('[data-managed-session="root-a"]').getByRole("button", { name: "加入管理", exact: true }).click()
  await expect(dialog.getByTestId("managed-session-review")).toContainText("Target root-a")
  expect(f.writes).toEqual([])
  await dialog.getByRole("button", { name: "确认更改", exact: true }).click()
  await expect(dialog).toContainText("管理关系已保存并核实")
  await expect(dialog.locator('[data-managed-session="root-a"]')).toContainText("已授权")
  expect(f.writes).toEqual([{ incarnation_id: incarnation, expected_state_revision: 4, enabled: true }])
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: info.outputPath("supervisor-managed-sessions-saved.png"), animations: "disabled" })
  await dialog.press("Escape"); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused()
  expect(f.runtime.pageErrors).toEqual([])
})
test("unconfirmed management write refreshes once without replay or false success", async ({ page }, info) => {
  const f = await fixture(page, true), { dialog } = await open(page, info.project.name === "phone-chromium")
  await dialog.locator('[data-managed-session="root-b"]').getByRole("button", { name: "加入管理", exact: true }).click()
  await dialog.getByRole("button", { name: "确认更改", exact: true }).click()
  await expect(dialog).toContainText("请求结果尚未确认")
  await expect(dialog).not.toContainText("管理关系已保存并核实")
  await expect(dialog.locator('[data-managed-session="root-b"]')).toContainText("已授权")
  await dialog.getByRole("button", { name: "重新读取", exact: true }).click()
  await expect(dialog).toContainText("请求结果尚未确认"); expect(f.writes).toHaveLength(1)
  expect(f.runtime.pageErrors).toEqual([])
})
test("Inspector opens a cold idle managed target with its persisted history in the main chat", async ({ page }, info) => {
  const f = await fixture(page, false, true)
  await page.goto(standaloneScenario.entryUrl)
  await page.getByRole("button", { name: "打开侧边面板", exact: true }).click()
  const workbench = page.locator("#right-workbench")
  await workbench.getByRole("button", { name: /检查器.*查看当前会话/ }).click()
  const target = workbench.getByTestId("supervisor-managed-panel").locator('[data-managed-session="root-a"]')
  await expect(target).toContainText("Target root-a")
  expect(f.historyReads).not.toContain("root-a")
  await target.getByRole("button", { name: "打开", exact: true }).click()
  await expect(page.getByRole("banner")).toContainText("Target root-a")
  const collapse = page.getByRole("button", { name: "收起工作面板", exact: true })
  if (await collapse.isVisible()) await collapse.click()
  await expect(page.getByText("Persisted idle target result with original context", { exact: true })).toBeVisible()
  expect(f.historyReads).toContain("root-a")
  expect(f.writes).toEqual([]); expect(f.sessionMutations).toEqual([])
  expect(f.runtime.pageErrors).toEqual([])
  await page.screenshot({ path: info.outputPath("supervisor-opens-cold-target-history.png"), animations: "disabled" })
})
