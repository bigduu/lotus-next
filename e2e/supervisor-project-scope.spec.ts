import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const incarnation = "11111111-1111-4111-8111-111111111111"
const observation = (available: boolean, allowed = ["p1"], revision = 4) => ({
  code: allowed.length ? "project_scope_configured" : "project_scope_uninitialized",
  scope: { supervisor: { session_id: "bamboo-default-supervisor", incarnation_id: incarnation }, state_revision: revision, allowed_projects: allowed },
  capabilities: { project_scope_v1: true, supervised_root_create_v1: true },
  owner_authorization: { available, required: true, kind: "trusted_host_intent", http_registration: false },
})
async function fixture(page: Page, available: boolean) {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const runtime = await installArtifactRuntime(page, standaloneScenario)
  const requests: { method: string; path: string }[] = []
  page.on("request", (request) => requests.push({ method: request.method(), path: new URL(request.url()).pathname }))
  let scope = observation(available), failure: { status: number; json: unknown } | null = null
  const projects = ["p1", "p2", "p3"].map((id) => ({ id, name: `Project ${id}`, status: "active", revision: 1, resource_revision: 1,
    project_path: null, project_path_status: "needs_selection", workspace_count: 0,
    created_at: "2026-10-19T00:00:00Z", updated_at: "2026-10-19T00:00:00Z" }))
  await page.route("**/api/v1/**", (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === "/api/v1/supervisor/default/scope") {
      if (request.method() !== "GET") return route.fulfill({ status: 500, json: { error: "Unexpected scope mutation" } })
      return failure ? route.fulfill(failure) : route.fulfill({ json: scope })
    }
    if (path === "/api/v1/projects") return route.fulfill({ json: { projects } })
    return route.fallback()
  })
  return { runtime, requests, setScope(value: typeof scope) { scope = value }, setFailure(value: typeof failure) { failure = value } }
}
async function open(page: Page, phone: boolean) {
  await page.goto(standaloneScenario.entryUrl)
  if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
  const row = page.locator("aside").first().getByRole("button", { name: "Supervisor", exact: true }).locator("..")
  const trigger = row.getByRole("button", { name: "会话操作", exact: true })
  await trigger.click()
  await page.getByRole("menuitem", { name: "Supervisor Project 范围", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Supervisor Project 范围", exact: true })
  await expect(dialog).toBeVisible()
  return { dialog, trigger }
}
for (const available of [false, true]) {
  test(`Project scope verifier=${available} remains blocked and offers only complete-set review`, async ({ page }, info) => {
    const f = await fixture(page, available), { dialog, trigger } = await open(page, info.project.name === "phone-chromium")
    await expect(dialog).toContainText(available ? "当前前端尚未接入原生所有者确认通道" : "可信原生所有者通道不可用")
    await expect(dialog.getByRole("checkbox", { name: /Project p1/ })).toBeChecked()
    await dialog.getByRole("checkbox", { name: /Project p2/ }).check()
    await dialog.getByRole("button", { name: "预览完整集合", exact: true }).click()
    const review = dialog.getByTestId("project-scope-review")
    await expect(review).toContainText("p1"); await expect(review).toContainText("p2")
    await expect(review).toContainText("此预览不构成所有者同意")
    await expect(dialog.getByRole("button", { name: "在 Bodhi 原生窗口中确认", exact: true })).toBeDisabled()
    await expect(dialog).toContainText(incarnation)
    const bounds = await dialog.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    await page.screenshot({ path: info.outputPath(`project-scope-blocked-${available}.png`), animations: "disabled" })
    await dialog.press("Escape"); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused()
    expect(f.requests.filter((r) => r.path === "/api/v1/supervisor/default/scope").map((r) => r.method)).toEqual(["GET"])
    expect(f.runtime.pageErrors).toEqual([])
  })
}
test("canonical refresh preserves the explicit draft and withdraws the previous review", async ({ page }, info) => {
  const f = await fixture(page, true), { dialog } = await open(page, info.project.name === "phone-chromium")
  await expect(dialog.getByRole("checkbox", { name: /Project p1/ })).toBeChecked()
  await dialog.getByRole("checkbox", { name: /Project p2/ }).check()
  await dialog.getByRole("button", { name: "预览完整集合", exact: true }).click()
  f.setScope(observation(true, ["p1", "p3"], 7))
  await dialog.getByRole("button", { name: "重新读取", exact: true }).click()
  await expect(dialog.getByTestId("project-scope-review")).toHaveCount(0)
  await expect(dialog.getByRole("checkbox", { name: /Project p2/ })).toBeChecked()
  await expect(dialog.getByRole("checkbox", { name: /Project p3/ })).not.toBeChecked()
  await expect(dialog.getByTestId("project-scope-current")).toContainText("2")
  expect(f.requests.filter((r) => r.path === "/api/v1/supervisor/default/scope").map((r) => r.method)).toEqual(["GET", "GET"])
  expect(f.runtime.pageErrors).toEqual([])
})
for (const [status, code, message] of [[404, "supervisor_missing", "可信 Supervisor 身份尚不存在"], [503, "scope_authority_invalid", "存储的授权状态无效"]] as const) {
  test(`Project scope ${code} stays visible without bootstrap or repair`, async ({ page }, info) => {
    const f = await fixture(page, false); f.setFailure({ status, json: { code, error: { message: "fixture refusal" } } })
    const { dialog } = await open(page, info.project.name === "phone-chromium")
    await expect(dialog).toContainText(message)
    await expect(dialog.getByRole("button", { name: "在 Bodhi 原生窗口中确认", exact: true })).toHaveCount(0)
    // Existing transport may retry a safe 503 read within its bounded budget.
    const reads = f.requests.filter((r) => r.path === "/api/v1/supervisor/default/scope")
    expect(reads.length).toBeGreaterThan(0); expect(reads.length).toBeLessThanOrEqual(3)
    expect(reads.every((r) => r.method === "GET")).toBe(true)
    expect(f.requests.filter((r) => r.method !== "GET" && /supervisor|tickets\/initialize/.test(r.path))).toEqual([])
  })
}
