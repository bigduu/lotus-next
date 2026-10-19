import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const incarnation = "11111111-1111-4111-8111-111111111111"
type AuthCode = "owner_authentication_required" | "owner_authentication_unconfigured" | "owner_authentication_unavailable"
const observation = (code: AuthCode | null = null, ids = ["p1"], revision = 4) => ({
  code: ids.length ? "project_scope_configured" : "project_scope_uninitialized",
  scope: { supervisor: { session_id: "bamboo-default-supervisor", incarnation_id: incarnation }, state_revision: revision, allowed_projects: ids },
  capabilities: { project_scope_v1: true, supervised_root_create_v1: true, project_scope_http_write_v1: true },
  owner_authorization: { available: code === null, required: true, kind: "authenticated_owner", http_registration: false, code },
})
async function fixture(page: Page, code: AuthCode | null = null) {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  // Framework-supplied HTTP owner, not a credential provisioned in a real Bamboo instance.
  const runtime = await installArtifactRuntime(page, standaloneScenario, { bootstrapRequestState: "local_bypass" })
  let scope = observation(code), mode: "success" | "conflict" | "lost" | "unavailable" | "origin" = "success"
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
      if (mode === "conflict") {
        scope = observation(null, ["p3"], 9)
        return route.fulfill({ status: 409, json: { code: "scope_revision_conflict", error: "fixture conflict" } })
      }
      if (mode === "unavailable") {
        scope = observation("owner_authentication_unavailable")
        return route.fulfill({ status: 503, json: { code: "owner_authentication_unavailable", error: "fixture unavailable" } })
      }
      if (mode === "origin") return route.fulfill({ status: 403, json: { code: "owner_request_origin_invalid", error: "fixture refusal" } })
      scope = observation(null, body.allowed_projects, body.expected_state_revision + 1)
      if (mode === "lost") return route.abort("failed")
      return route.fulfill({ json: { receipt: { supervisor: scope.scope.supervisor, state_revision: scope.scope.state_revision, changed: true, link_revision: null } } })
    }
    if (path === "/api/v1/projects") return route.fulfill({ json: { projects } })
    if (path === "/api/v1/bamboo/access/verify") {
      expect(request.method()).toBe("POST"); expect(request.postDataJSON()).toEqual({ password: "fixture-password-not-real" })
      passwordVerifications += 1
      scope = observation()
      return route.fulfill({ json: { success: true }, headers: { "set-cookie": "bamboo_access_verified=fixture-session-only; HttpOnly; SameSite=Lax; Path=/" } })
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

test("HTTP fixture: plain browser explicitly confirms one exact set with receipt and fresh GET", async ({ page }, info) => {
  const f = await fixture(page), dialog = await open(page, info.project.name === "phone-chromium")
  expect(await page.evaluate(() => typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)).toBe("undefined")
  await review(dialog); expect(f.writes()).toEqual([])
  await expect(dialog).toContainText(incarnation)
  await dialog.getByRole("button", { name: "确认更改 Project 范围", exact: true }).click()
  await expect(dialog).toContainText("回执与当前范围已确认所选集合")
  expect(f.requests.map((r) => r.method)).toEqual(["GET", "PUT", "GET"])
  expect(f.writes()[0]!.body).toEqual({ incarnation_id: incarnation, expected_state_revision: 4, allowed_projects: ["p1", "p2"] })
  expect(f.writes()[0]!.headers["content-type"]).toContain("application/json")
  expect(f.writes()[0]!.headers.origin).toBe(standaloneScenario.origin)
  expect(f.runtime.pageErrors).toEqual([])
  await page.screenshot({ path: info.outputPath("web-owner-scope-saved.png"), animations: "disabled" })
})
test("HTTP fixture: close before submit discards the draft and never writes", async ({ page }, info) => {
  const f = await fixture(page), phone = info.project.name === "phone-chromium", dialog = await open(page, phone)
  await review(dialog); await dialog.getByRole("button", { name: "关闭", exact: true }).click()
  await expect(dialog).toBeHidden()
  const reopened = await open(page, phone, false)
  await expect(reopened.getByRole("checkbox", { name: /Project p2/ })).not.toBeChecked()
  expect(f.requests.map((r) => r.method)).toEqual(["GET", "GET"]); expect(f.writes()).toEqual([])
})
for (const [code, text] of [["owner_authentication_required", "需要所有者认证"], ["owner_authentication_unconfigured", "尚未配置所有者认证"], ["owner_authentication_unavailable", "所有者认证暂不可用"]] as const) {
  test(`HTTP fixture: ${code} stays blocked despite local bootstrap admission`, async ({ page }, info) => {
    const f = await fixture(page, code), dialog = await open(page, info.project.name === "phone-chromium")
    await expect(dialog).toContainText(text); await review(dialog)
    await expect(dialog.getByRole("button", { name: "确认更改 Project 范围", exact: true })).toBeDisabled()
    expect(f.writes()).toEqual([])
    await page.screenshot({ path: info.outputPath(`${code}.png`), animations: "disabled" })
  })
}
test("HTTP fixture: existing-password login rereads eligibility and requires a separate review", async ({ page }, info) => {
  const f = await fixture(page, "owner_authentication_required"), dialog = await open(page, info.project.name === "phone-chromium")
  await dialog.getByRole("button", { name: "验证已有访问密码", exact: true }).click()
  await dialog.getByLabel("访问密码", { exact: true }).fill("fixture-password-not-real")
  await dialog.getByRole("button", { name: "验证并继续", exact: true }).click()
  await expect(dialog).toContainText("服务允许当前认证身份更新范围")
  expect(f.passwordVerifications).toBe(1); expect(f.writes()).toEqual([])
  await expect(dialog.getByTestId("project-scope-review")).toHaveCount(0)
  await review(dialog); await dialog.getByRole("button", { name: "确认更改 Project 范围", exact: true }).click()
  await expect(dialog).toContainText("回执与当前范围已确认所选集合")
  expect(f.writes()).toHaveLength(1); expect(f.writes()[0]!.headers.cookie).toContain("bamboo_access_verified=fixture-session-only")
})
for (const [mode, text] of [["conflict", "范围已变化"], ["lost", "本次提交结果未确认"], ["unavailable", "所有者认证暂不可用"], ["origin", "Bamboo 拒绝了此网页的请求来源"]] as const) {
  test(`HTTP fixture: ${mode} is visible after one PUT and never replayed`, async ({ page }, info) => {
    const f = await fixture(page), dialog = await open(page, info.project.name === "phone-chromium")
    f.setMode(mode); await review(dialog)
    await dialog.getByRole("button", { name: "确认更改 Project 范围", exact: true }).click()
    await expect(dialog).toContainText(text); await expect(dialog.getByTestId("project-scope-review")).toHaveCount(0)
    expect(f.writes()).toHaveLength(1); expect(f.requests.map((r) => r.method)).toEqual(["GET", "PUT", "GET"])
    await expect(dialog).not.toContainText("回执与当前范围已确认所选集合")
    if (mode === "conflict") {
      await expect(dialog).toContainText("9")
      await expect(dialog.getByRole("checkbox", { name: /Project p2/ })).toBeChecked()
      await expect(dialog.getByRole("checkbox", { name: /Project p3/ })).not.toBeChecked()
    }
    expect(f.runtime.pageErrors).toEqual([])
  })
}
