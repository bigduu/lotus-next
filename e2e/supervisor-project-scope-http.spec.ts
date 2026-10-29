import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const incarnation = "11111111-1111-4111-8111-111111111111"
const observation = (ids = ["p1"], revision = 4) => ({
  code: ids.length ? "project_scope_configured" : "project_scope_uninitialized",
  scope: { supervisor: { session_id: "bamboo-default-supervisor", incarnation_id: incarnation }, state_revision: revision, allowed_projects: ids },
  capabilities: { project_scope_v1: true, supervised_root_create_v1: true, project_scope_http_write_v1: true },
  owner_authorization: { available: true, required: true, kind: "existing_access", http_registration: false, code: null },
})
async function fixture(page: Page) {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  // API fixture after existing access admission; no credentials or native bridge are created.
  const runtime = await installArtifactRuntime(page, standaloneScenario, [], { bootstrapRequestState: "local_bypass" })
  let scope = observation(), mode: "success" | "unconfirmed" | "access" = "success"
  const requests: { method: string; body: unknown; headers: Record<string, string> }[] = []
  let passwordVerifications = 0
  const projects = ["p1", "p2", "p3"].map((id) => ({ id, name: `Project ${id}`, status: "active", revision: 1, resource_revision: 1,
    project_path: null, project_path_status: "needs_selection", workspace_count: 0,
    created_at: "2026-10-19T00:00:00Z", updated_at: "2026-10-19T00:00:00Z" }))
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === "/api/v1/supervisor/default/scope") {
      const headers = await request.allHeaders()
      requests.push({ method: request.method(), body: request.method() === "PUT" ? request.postDataJSON() : null, headers })
      if (request.method() === "GET") return route.fulfill({ json: scope })
      if (request.method() !== "PUT") return route.fulfill({ status: 500, json: { error: "Unexpected scope action" } })
      const body = request.postDataJSON()
      expect(Object.keys(body).sort()).toEqual(["allowed_projects", "expected_state_revision", "incarnation_id"])
      if (mode === "access") return route.fulfill({ status: 401, json: { error: "fixture access refusal" } })
      scope = observation(body.allowed_projects, body.expected_state_revision + 1)
      if (mode === "unconfirmed") return route.fulfill({ status: 503, json: { code: "scope_outcome_unconfirmed", error: "fixture unconfirmed result" } })
      return route.fulfill({ json: { receipt: { supervisor: scope.scope.supervisor, state_revision: scope.scope.state_revision, changed: true, link_revision: null } } })
    }
    if (path === "/api/v1/projects") return route.fulfill({ json: { projects } })
    if (path === "/api/v1/bamboo/access/verify") {
      passwordVerifications += 1
      return route.fulfill({ status: 500, json: { error: "No scope login is expected" } })
    }
    return route.fallback()
  })
  return { runtime, requests, setMode(value: typeof mode) { mode = value }, writes() { return requests.filter((r) => r.method === "PUT") },
    get passwordVerifications() { return passwordVerifications } }
}
async function open(page: Page, phone: boolean, navigate = true) {
  if (navigate) await page.goto(standaloneScenario.entryUrl)
  if (phone && navigate) await page.getByRole("button", { name: "菜单", exact: true }).click()
  const row = page.locator("aside").first().getByRole("button", { name: "Supervisor", exact: true }).locator("..")
  await row.getByRole("button", { name: "会话操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "Supervisor Project 范围", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Supervisor Project 范围", exact: true })
  await expect(dialog.getByRole("checkbox", { name: /Project p1/ })).toBeVisible()
  return dialog
}
async function review(dialog: ReturnType<Page["getByRole"]>) {
  await dialog.getByRole("checkbox", { name: /Project p2/ }).check()
  await dialog.getByRole("button", { name: "预览完整集合", exact: true }).click()
  await expect(dialog.getByTestId("project-scope-review")).toContainText("p1")
  await expect(dialog.getByTestId("project-scope-review")).toContainText("p2")
}

test("HTTP existing access: plain browser confirms one exact set without a scope login", async ({ page }, info) => {
  const f = await fixture(page), dialog = await open(page, info.project.name === "phone-chromium")
  expect(await page.evaluate(() => typeof (globalThis as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)).toBe("undefined")
  await expect(dialog).toContainText("当前入口可更新 Project 范围")
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0)
  expect(f.passwordVerifications).toBe(0)
  await review(dialog); expect(f.writes()).toEqual([])
  await expect(dialog).toContainText(incarnation)
  await dialog.getByRole("button", { name: "确认更改 Project 范围", exact: true }).click()
  await expect(dialog).toContainText("回执与当前范围已确认所选集合")
  expect(f.requests.map((r) => r.method)).toEqual(["GET", "PUT", "GET"])
  expect(f.writes()[0]!.body).toEqual({ incarnation_id: incarnation, expected_state_revision: 4, allowed_projects: ["p1", "p2"] })
  expect(f.writes()[0]!.headers["content-type"]).toContain("application/json")
  expect(f.writes()[0]!.headers.origin).toBe(standaloneScenario.origin)
  expect(f.passwordVerifications).toBe(0)
  expect(f.runtime.pageErrors).toEqual([])
  await page.screenshot({ path: info.outputPath("web-existing-access-scope-saved.png"), animations: "disabled" })
})
test("HTTP existing access: close before submit discards the draft and never writes", async ({ page }, info) => {
  const f = await fixture(page), phone = info.project.name === "phone-chromium", dialog = await open(page, phone)
  await review(dialog); await dialog.getByRole("button", { name: "关闭", exact: true }).click()
  await expect(dialog).toBeHidden()
  const reopened = await open(page, phone, false)
  await expect(reopened.getByRole("checkbox", { name: /Project p2/ })).not.toBeChecked()
  expect(f.requests.map((r) => r.method)).toEqual(["GET", "GET"]); expect(f.writes()).toEqual([])
})
for (const [mode, text] of [["unconfirmed", "本次提交结果未确认"], ["access", "当前 Bamboo 服务的访问验证"]] as const) {
  test(`HTTP existing access: ${mode} is visible after one PUT without a login or replay`, async ({ page }, info) => {
    const f = await fixture(page), dialog = await open(page, info.project.name === "phone-chromium")
    f.setMode(mode); await review(dialog)
    await dialog.getByRole("button", { name: "确认更改 Project 范围", exact: true }).click()
    await expect(dialog).toContainText(text)
    await expect(dialog.getByTestId("project-scope-review")).toHaveCount(0)
    await expect(dialog.locator('input[type="password"]')).toHaveCount(0)
    expect(f.passwordVerifications).toBe(0)
    expect(f.writes()).toHaveLength(1)
    expect(f.requests.map((r) => r.method)).toEqual(["GET", "PUT", "GET"])
    await expect(dialog).not.toContainText("回执与当前范围已确认所选集合")
    await dialog.getByRole("button", { name: "重新读取", exact: true }).click()
    if (mode === "unconfirmed") await expect(dialog).toContainText("本次提交结果未确认")
    expect(f.writes()).toHaveLength(1)
    expect(f.runtime.pageErrors).toEqual([])
  })
}


for (const method of ["button", "icon", "escape"] as const) {
 test(`closing current-user scope via ${method} returns to the managed-session directory`, async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const runtime = await installArtifactRuntime(page, standaloneScenario, [], { bootstrapRequestState: "local_bypass" })
  const base = observation([], 0)
  const currentScope = { ...base, code: "current_user_scope_ready",
    capabilities: { ...base.capabilities, supervisor_current_user_scope_v1: true },
    management_access: { kind: "current_user", default_all_projects: true, default_all_sessions: true,
      requires_project_authorization: false, requires_session_attachment: false, orchestration_revision: 1 } }
  const directory = { scope: base.scope, capabilities: { managed_sessions_http_v1: true, supervisor_current_user_scope_v1: true },
    management_access: { kind: "current_user", requires_session_attachment: false }, sessions: [], next_after: null, legacy_links: {},
    owner_authorization: base.owner_authorization }
  const writes: string[] = []
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (["/api/v1/supervisor/default/scope", "/api/v1/supervisor/default/sessions"].includes(path)) {
      if (request.method() !== "GET") { writes.push(path); return route.abort() }
      return route.fulfill({ json: path.endsWith("/scope") ? currentScope : directory })
    }
    if (path === "/api/v1/projects") return route.fulfill({ json: { projects: [] } })
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  if (info.project.name === "phone-chromium") await page.getByRole("button", { name: "菜单", exact: true }).click()
  const row = page.locator("aside").first().getByRole("button", { name: "Supervisor", exact: true }).locator("..")
  await row.getByRole("button", { name: "会话操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "管理会话", exact: true }).click()
  const managed = page.getByRole("dialog", { name: "受管会话", exact: true })
  const trigger = managed.getByRole("button", { name: "Supervisor 管理", exact: true })
  await expect(trigger).toBeVisible()
  const viewport = page.viewportSize()!
  const managedBounds = (await managed.boundingBox())!
  expect(managedBounds.y).toBeGreaterThanOrEqual(0)
  expect(managedBounds.y + managedBounds.height).toBeLessThanOrEqual(viewport.height)
  expect(await managed.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto")
  await trigger.click()
  const scope = page.getByRole("dialog", { name: "Supervisor 管理", exact: true })
  await expect(scope.getByTestId("current-user-management")).toBeVisible()
  const scopeBounds = (await scope.boundingBox())!
  expect(scopeBounds.y).toBeGreaterThanOrEqual(0)
  expect(scopeBounds.y + scopeBounds.height).toBeLessThanOrEqual(viewport.height)
  expect(await scope.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto")
  if (method === "escape") await scope.press("Escape")
  else await scope.getByRole("button", { name: method === "button" ? "关闭" : "Close", exact: true }).first().click()
  await expect(scope).toBeHidden()
  await expect(managed).toBeVisible()
  await expect(trigger).toBeFocused()
  await managed.getByRole("button", { name: "关闭", exact: true }).first().click()
  await expect(managed).toBeHidden()
  expect(writes).toEqual([])
  expect(runtime.pageErrors).toEqual([])
 })
}
