import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { workbenchPanel } from "./support/workbench.js"

const a = "all-surface-session", b = "profile-chat-b"
type Mode = "shared" | "clean"
type Scope = { mode: Mode; generation: number; tabs: string[]; epoch: number; viewport: { width: number; height: number } }
async function fixture(page: Page, { legacy = false }: { legacy?: boolean } = {}) {
  await page.addInitScript(() => { localStorage.setItem("bodhi_onboarded_v1", "1"); localStorage.setItem("lotus_next_last_session", "all-surface-session") })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const scopes = new Map<string, Scope>()
  const writes: { id: string; method: string; body: unknown }[] = []
  let generation = 0, refuseClose: string | null = null, conflictOpen = false
  const create = (id: string, mode: Mode) => { const scope: Scope = { mode, generation: ++generation, tabs: [`${id}-${generation}`], epoch: 1, viewport: { width: 640, height: 480 } }; scopes.set(id, scope); return scope }
  const state = (scope: Scope) => ({ ...(legacy ? {} : { profile_mode: scope.mode, storage_shared: scope.mode === "shared" }), page_epoch: scope.epoch, frame_seq: 0,
    active_tab_id: scope.tabs[0] ?? null, tabs: scope.tabs.map((tab_id) => ({ tab_id, url: "about:blank", title: "Profile page", active: true })),
    url: scope.tabs.length ? "about:blank" : "", title: scope.tabs.length ? "Profile page" : "", viewport: scope.viewport, can_go_back: false, can_go_forward: false })
  const sessions = [a, b].map((id) => ({ id, title: id === a ? "Profile A" : "Profile B", kind: "root", root_session_id: id, parent_session_id: null,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" }, permission_mode: "default", is_running: false,
    created_at: "2026-10-22T00:00:00Z", updated_at: "2026-10-22T00:00:00Z" }))
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const match = /^\/api\/v1\/browser\/sessions\/([^/]+)(\/.*)?$/.exec(path)
    if (match) {
      const id = match[1]!, suffix = match[2] ?? ""
      let scope = scopes.get(id)
      const failure = (status: number, code: string) => route.fulfill({ status, json: { error: { message: code, type: "browser_error", code } } })
      if (!suffix && (method === "PUT" || method === "DELETE")) {
        const body = request.postData() ? request.postDataJSON() : undefined
        writes.push({ id, method, body })
        if (method === "DELETE") {
          if (refuseClose) { const code = refuseClose; refuseClose = null; return failure(503, code) }
          scopes.delete(id); return route.fulfill({ status: 204 })
        }
        expect(Object.keys(body ?? {})).toEqual(body?.profile_mode === undefined ? [] : ["profile_mode"])
        if (conflictOpen) { conflictOpen = false; scope = create(id, "clean"); return failure(409, "browser_profile_mode_conflict") }
        if (!legacy && scope && body?.profile_mode !== undefined && scope.mode !== body.profile_mode) return failure(409, "browser_profile_mode_conflict")
        scope ??= create(id, legacy ? "shared" : body?.profile_mode ?? "shared")
        return route.fulfill({ json: state(scope) })
      }
      if (!scope) return failure(404, "browser_not_open")
      if (!suffix && method === "GET") return route.fulfill({ json: state(scope) })
      if (suffix === "/frame") { await new Promise((resolve) => setTimeout(resolve, 100)); return route.fulfill({ status: 204 }) }
      if (suffix === "/viewport" && method === "POST") {
        const body = request.postDataJSON(); expect(body.expected_epoch).toBe(scope.epoch); scope.viewport = { width: body.width, height: body.height }; scope.epoch++
        return route.fulfill({ json: state(scope) })
      }
      if (suffix === "/tabs/close" && method === "POST") {
        const body = request.postDataJSON(); expect(body.expected_epoch).toBe(scope.epoch); scope.tabs = scope.tabs.filter((tab) => tab !== body.tab_id); scope.epoch++
        return route.fulfill({ json: state(scope) })
      }
      return failure(404, "unknown_fixture_route")
    }
    if (path === "/api/v1/sessions" && method === "GET") { const listed = new URL(request.url()).searchParams.get("kind") === "child" ? [] : sessions; return route.fulfill({ json: { sessions: listed, total: listed.length, limit: 200, offset: 0 } }) }
    const id = path.split("/").at(-1)
    if ((id === a || id === b) && method === "GET") {
      if (path.startsWith("/api/v1/sessions/")) return route.fulfill({ json: { session: sessions.find((s) => s.id === id) }, headers: { ETag: '"1"' } })
      if (path.startsWith("/api/v1/history/")) return route.fulfill({ json: { session_id: id, messages: [] } })
      if (path.startsWith("/api/v1/task/")) return route.fulfill({ json: { session_id: id, items: [] } })
    }
    if (path === `/api/v1/respond/${b}/pending`) return route.fulfill({ json: { has_pending_question: false } })
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  const panel = workbenchPanel(page)
  await panel.getByRole("button", { name: /浏览器.*输入网址后打开/ }).click()
  const browser = panel.getByRole("region", { name: "内置浏览器" })
  return { observation, panel, browser, writes, scopes, refuseClose: (code = "browser_runtime_unavailable") => { refuseClose = code }, conflictOpen: () => { conflictOpen = true } }
}

test("synthetic profiles: explicit choices, chat-owned close, zero-tab scope and fresh clean reopen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop profile flow; phone has no browser workbench")
  const f = await fixture(page)
  await expect(f.browser.getByText("当前聊天浏览器已关闭", { exact: true })).toBeVisible()
  const select = f.browser.getByRole("combobox", { name: "下次打开的模式" })
  await expect(select).toHaveCount(0)
  expect(f.writes).toEqual([])
  await f.browser.getByRole("button", { name: "按当前服务默认设置打开", exact: true }).click()
  expect(f.writes).toEqual([{ id: a, method: "PUT", body: {} }])
  await expect(f.browser.getByText("当前模式：共享账户")).toBeAttached()
  if ((await f.browser.locator("details").getAttribute("open")) === null) await f.browser.locator("summary").click()
  await expect(f.browser.getByText(/不构成安全隔离/)).toBeVisible()
  await select.selectOption("clean")
  expect(f.writes).toHaveLength(1)
  await f.browser.getByRole("button", { name: "关闭当前聊天浏览器" }).click()
  await expect(f.browser.getByText("当前聊天浏览器已关闭", { exact: true })).toBeVisible()
  // The choice survives the close/read transition, but no implicit reopen occurs.
  await expect(select).toHaveValue("clean")
  expect(f.writes).toHaveLength(2)
  await f.browser.getByRole("button", { name: "打开浏览器", exact: true }).click()
  await expect.poll(() => f.scopes.get(a)?.mode).toBe("clean")
  const firstClean = f.scopes.get(a)!.generation

  await page.getByRole("button", { name: "Profile B", exact: true }).click()
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  await f.panel.getByRole("button", { name: /浏览器.*输入网址后打开/ }).click()
  await expect(select).toHaveCount(0)
  await f.browser.getByRole("button", { name: "按当前服务默认设置打开", exact: true }).click()
  await expect.poll(() => f.scopes.get(b)?.mode).toBe("shared")
  const bBefore = structuredClone(f.scopes.get(b))
  await page.getByRole("button", { name: "Profile A", exact: true }).click()
  await expect(f.browser.getByText("当前模式：干净会话")).toBeAttached()
  // Closing the last page is not closing its scope or changing its profile.
  await f.panel.getByRole("button", { name: "关闭浏览器标签页 1：Profile page" }).click()
  await f.panel.getByRole("button", { name: /浏览器.*输入网址后打开/ }).click()
  await expect(f.browser.getByText("还没有打开网页", { exact: true })).toBeVisible()
  expect(f.scopes.get(a)?.mode).toBe("clean")
  expect(f.writes.filter((w) => w.method === "DELETE")).toHaveLength(1)
  if ((await f.browser.locator("details").getAttribute("open")) === null) await f.browser.locator("summary").click()
  await f.browser.getByRole("button", { name: "关闭当前聊天浏览器" }).click()
  await expect(f.browser.getByRole("button", { name: "打开浏览器", exact: true })).toBeVisible()
  await f.browser.getByRole("button", { name: "重新读取状态" }).click()
  await expect(f.browser.getByRole("button", { name: "打开浏览器", exact: true })).toBeVisible()
  expect(f.scopes.has(a)).toBe(false)
  expect(f.scopes.get(b)).toEqual(bBefore)
  await select.selectOption("clean")
  await f.browser.getByRole("button", { name: "打开浏览器", exact: true }).click()
  await expect.poll(() => f.scopes.get(a)?.generation).toBeGreaterThan(firstClean)
  await expect.poll(() => f.scopes.get(a)?.mode).toBe("clean")
  expect(f.observation.pageErrors).toEqual([])
  await testInfo.attach("synthetic-profile-requests", { body: JSON.stringify(f.writes, null, 2), contentType: "application/json" })
  await page.screenshot({ path: testInfo.outputPath("profiles-cross-chat.png") })
})

test("synthetic profile refusal: busy, unknown DELETE and mode conflict read canonical state without replay", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop profile flow; phone has no browser workbench")
  const f = await fixture(page)
  await expect(f.browser.getByRole("combobox")).toHaveCount(0)
  await f.browser.getByRole("button", { name: "按当前服务默认设置打开", exact: true }).click()
  await expect(f.browser.getByText("当前模式：共享账户")).toBeAttached()
  if ((await f.browser.locator("details").getAttribute("open")) === null) await f.browser.locator("summary").click()
  f.refuseClose("browser_busy")
  await f.browser.getByRole("button", { name: "关闭当前聊天浏览器" }).click()
  await expect(f.browser.getByText(/本次请求未执行/)).toBeVisible()
  await expect(f.browser.getByText("当前模式：共享账户")).toBeAttached()
  expect(f.writes.filter((w) => w.method === "DELETE")).toHaveLength(1)
  await f.browser.getByRole("button", { name: "重试", exact: true }).click()
  await expect(f.browser.getByText("当前模式：共享账户")).toBeAttached()
  expect(f.writes.filter((w) => w.method === "DELETE")).toHaveLength(1)
  if ((await f.browser.locator("details").getAttribute("open")) === null) await f.browser.locator("summary").click()
  f.refuseClose()
  await f.browser.getByRole("button", { name: "关闭当前聊天浏览器" }).click()
  await expect(f.browser.getByText(/上次浏览器操作的结果未确认/)).toBeVisible()
  expect(f.writes.filter((w) => w.method === "DELETE")).toHaveLength(2)
  await f.browser.getByRole("button", { name: "重试", exact: true }).click()
  await expect(f.browser.getByText("当前模式：共享账户")).toBeAttached()
  expect(f.writes.filter((w) => w.method === "DELETE")).toHaveLength(2)
  if ((await f.browser.locator("details").getAttribute("open")) === null) await f.browser.locator("summary").click()
  await f.browser.getByRole("button", { name: "关闭当前聊天浏览器" }).click()
  await expect(f.browser.getByRole("button", { name: "打开浏览器", exact: true })).toBeVisible()
  f.conflictOpen()
  await f.browser.getByRole("combobox").selectOption("shared")
  await f.browser.getByRole("button", { name: "打开浏览器", exact: true }).click()
  await expect(f.browser.getByText(/当前聊天浏览器已使用另一模式/)).toBeVisible()
  await expect(f.browser.getByText("当前模式：干净会话")).toBeAttached()
  expect(f.writes).toHaveLength(5)
  expect(f.observation.pageErrors).toEqual([])
  await testInfo.attach("synthetic-refusal-requests", { body: JSON.stringify(f.writes, null, 2), contentType: "application/json" })
})


test("synthetic legacy404: only an explicit default open, no unsupported modes or automatic reopen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop profile flow; phone has no browser workbench")
  const f = await fixture(page, { legacy: true })
  await expect(f.browser.getByText("当前聊天浏览器已关闭", { exact: true })).toBeVisible()
  await expect(f.browser.getByRole("combobox")).toHaveCount(0)
  expect(f.writes).toEqual([])
  await f.browser.getByRole("button", { name: "按当前服务默认设置打开", exact: true }).click()
  await expect(f.browser.getByText("当前服务尚未报告浏览器账户模式，暂不能选择。", { exact: true })).toBeAttached()
  await expect(f.browser.getByRole("combobox")).toHaveCount(0)
  await expect(f.browser.getByRole("button", { name: "关闭当前聊天浏览器" })).toHaveCount(0)
  await f.panel.getByRole("button", { name: "收起工作面板", exact: true }).click()
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  await expect(f.browser.getByText("当前服务尚未报告浏览器账户模式，暂不能选择。", { exact: true })).toBeAttached()
  expect(f.writes).toEqual([{ id: a, method: "PUT", body: {} }])
  // Simulate the old host closing an idle scope. Its existing typed404 is not a capability.
  f.scopes.delete(a)
  // The raw frame reader does not decode a JSON error body. Confirm closure
  // through a user-requested canonical GET instead of inferring it from JPEG failure.
  await expect(f.browser.getByText("当前 Bamboo 尚未提供内置浏览器。", { exact: true })).toBeVisible()
  await f.browser.getByRole("button", { name: "重试", exact: true }).click()
  await expect(f.browser.getByRole("button", { name: "按当前服务默认设置打开", exact: true })).toBeVisible()
  await f.browser.getByRole("button", { name: "重新读取状态", exact: true }).click()
  await expect(f.browser.getByRole("button", { name: "按当前服务默认设置打开", exact: true })).toBeVisible()
  expect(f.writes).toEqual([{ id: a, method: "PUT", body: {} }])
  await expect(f.browser.getByRole("combobox")).toHaveCount(0)
  expect(f.observation.pageErrors).toEqual([])
  await testInfo.attach("synthetic-legacy-default-requests", { body: JSON.stringify(f.writes, null, 2), contentType: "application/json" })
  await page.screenshot({ path: testInfo.outputPath("legacy-default-only.png") })
})
