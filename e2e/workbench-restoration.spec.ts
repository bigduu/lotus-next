import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionA = "all-surface-session"
const sessionB = "workbench-session-b"
const storageKey = (id: string) => `lotus-next.workbench.v1:${encodeURIComponent(`${standaloneScenario.origin}/api/v1`)}:${encodeURIComponent(id)}`

async function installSessions(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    if (!localStorage.getItem("lotus_next_last_session")) {
      localStorage.setItem("lotus_next_last_session", "all-surface-session")
    }
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const sessions = [
    { id: sessionA, title: "Session A" },
    { id: sessionB, title: "Session B" },
  ].map(({ id, title }) => ({
    id, title, kind: "root", root_session_id: id, parent_session_id: null,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T00:00:00Z",
    permission_mode: "default", is_running: false,
  }))
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (request.method() !== "GET") return route.fallback()
    if (path === "/api/v1/sessions") {
      const listed = url.searchParams.get("kind") === "child" ? [] : sessions
      return route.fulfill({ json: { sessions: listed, total: listed.length, limit: 200, offset: 0 } })
    }
    for (const session of sessions) {
      if (path === `/api/v1/sessions/${session.id}`) {
        return route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
      }
      if (path === `/api/v1/history/${session.id}`) {
        return route.fulfill({ json: { session_id: session.id, messages: [] } })
      }
      if (path === `/api/v1/task/${session.id}`) {
        return route.fulfill({ json: { session_id: session.id, title: null, items: [] } })
      }
      if (path === `/api/v1/respond/${session.id}/pending`) {
        return route.fulfill({ json: { has_pending_question: false } })
      }
    }
    return route.fallback()
  })
  return observation
}

async function openTool(page: Page, label: string) {
  await page.locator("#right-workbench").getByRole("button", { name: "打开工作面板标签页" }).click()
  await page.getByRole("menuitem", { name: label, exact: true }).click()
}

test("workbench restores each session's tools, order, selected tab, side session, and collapsed state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop persistence acceptance")
  const observation = await installSessions(page)
  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  const panel = page.locator("#right-workbench")
  const order = () => panel.getByRole("tablist", { name: "工作面板标签页" }).getByRole("tab").allTextContents()
  await openTool(page, "检查器")
  await openTool(page, "Review")
  await openTool(page, "并排会话")
  await panel.getByRole("combobox").filter({ hasText: "选择会话并排" }).click()
  await page.getByRole("option", { name: "Session B", exact: true }).click()
  await panel.getByRole("button", { name: "调整Review标签页顺序" }).press("Alt+ArrowLeft")
  await panel.getByRole("tab", { name: "检查器", exact: true }).click()
  await expect.poll(order).toEqual(["Review", "检查器", "Session B"])

  await page.getByRole("button", { name: "Session B", exact: true }).click()
  await expect(panel).toHaveCount(0)
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  await expect(panel.getByText("还没有打开内容")).toBeVisible()
  await openTool(page, "Review")
  await panel.getByRole("button", { name: "收起工作面板" }).click()

  await page.getByRole("button", { name: "Session A", exact: true }).click()
  await expect.poll(order).toEqual(["Review", "检查器", "Session B"])
  await expect(panel.getByRole("tab", { name: "检查器", exact: true })).toHaveAttribute("aria-selected", "true")
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect.poll(order).toEqual(["Review", "检查器", "Session B"])
  await expect(panel.getByRole("tab", { name: "检查器", exact: true })).toHaveAttribute("aria-selected", "true")
  await panel.getByRole("tab", { name: "Session B", exact: true }).click()
  await expect(panel.getByRole("combobox").filter({ hasText: "Session B" })).toBeVisible()
  await expect(panel.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Session B", exact: true }).click()
  await expect(panel).toHaveCount(0)
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.getByRole("button", { name: "Session B", exact: true })).toBeVisible()
  await expect(panel).toHaveCount(0)
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  await expect.poll(order).toEqual(["Review"])
  await expect(panel.getByRole("tab", { name: "Review", exact: true })).toHaveAttribute("aria-selected", "true")
  expect(observation.pageErrors).toEqual([])
})

test("restored browser descriptors reconcile live tabs without recreating missing pages", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop browser restoration acceptance")
  const observation = await installSessions(page)
  let tabs = [
    { tab_id: "tab-a", url: "https://a.test/private-page", title: "Page A" },
    { tab_id: "tab-b", url: "https://b.test/", title: "Page B" },
  ]
  let activeId = "tab-b"
  let epoch = 1
  let viewport = { width: 640, height: 480 }
  const actions: string[] = []
  const state = () => ({
    page_epoch: epoch, frame_seq: epoch, active_tab_id: activeId,
    tabs: tabs.map((tab) => ({ ...tab, active: tab.tab_id === activeId })),
    url: tabs.find((tab) => tab.tab_id === activeId)?.url ?? "",
    title: tabs.find((tab) => tab.tab_id === activeId)?.title ?? "",
    viewport, can_go_back: false, can_go_forward: false,
  })
  const browserPath = `/api/v1/browser/sessions/${sessionA}`
  await page.route(`**${browserPath}**`, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === browserPath && ["GET", "PUT"].includes(request.method())) {
      return route.fulfill({ json: state() })
    }
    if (path === `${browserPath}/frame`) {
      await new Promise((resolve) => setTimeout(resolve, 80))
      return route.fulfill({ status: 204 })
    }
    if (request.method() === "POST") {
      actions.push(path)
      const body = request.postDataJSON() as Record<string, unknown>
      if (path === `${browserPath}/tabs/activate`) {
        expect(tabs.some((tab) => tab.tab_id === body.tab_id)).toBe(true)
        activeId = String(body.tab_id)
      } else if (path === `${browserPath}/viewport`) {
        viewport = { width: Number(body.width), height: Number(body.height) }
      } else {
        return route.fulfill({ status: 409, json: { error: "Restoration must not recreate or navigate pages" } })
      }
      epoch += 1
      return route.fulfill({ json: state() })
    }
    return route.fulfill({ status: 404 })
  })
  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  const panel = page.locator("#right-workbench")
  const order = () => panel.getByRole("tablist", { name: "工作面板标签页" }).getByRole("tab").allTextContents()
  await openTool(page, "浏览器")
  await expect(panel.getByRole("tab", { name: /浏览器标签页 \d+：Page A/ })).toBeVisible()
  await openTool(page, "检查器")
  await panel.getByRole("button", { name: "调整检查器标签页顺序" }).press("Alt+ArrowLeft")
  await panel.getByRole("tab", { name: /浏览器标签页 \d+：Page A/ }).click()
  await expect.poll(order).toEqual(["Page A", "检查器", "Page B"])
  await expect.poll(() => activeId).toBe("tab-a")
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.state.browserActiveId, storageKey(sessionA))).toBe("tab-a")

  // The backend may have selected a different surviving tab while the app was closed.
  activeId = "tab-b"
  epoch += 1
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect.poll(order).toEqual(["Page A", "检查器", "Page B"])
  await expect(panel.getByRole("tab", { name: /浏览器标签页 \d+：Page A/ })).toHaveAttribute("aria-selected", "true")
  await expect.poll(() => activeId).toBe("tab-a")
  const saved = await page.evaluate((key) => localStorage.getItem(key), storageKey(sessionA))
  expect(saved).not.toContain("https://")
  expect(saved).not.toContain("private-page")

  // A closed backend page must disappear from restored descriptors without a POST /tabs or /navigate.
  tabs = tabs.filter((tab) => tab.tab_id !== "tab-a")
  activeId = "tab-b"
  epoch += 1
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect.poll(order).toEqual(["检查器", "Page B"])
  await expect(panel.getByRole("tab", { name: /浏览器标签页 \d+：Page B/ })).toHaveAttribute("aria-selected", "true")
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.state.order, storageKey(sessionA)))
    .toEqual(["tool:inspector", "browser:tab-b"])

  tabs = []
  activeId = ""
  epoch += 1
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect.poll(order).toEqual(["检查器"])
  await expect(panel.getByRole("tab", { name: "检查器", exact: true })).toHaveAttribute("aria-selected", "true")
  expect(actions.filter((path) => path !== `${browserPath}/viewport` && path !== `${browserPath}/tabs/activate`)).toEqual([])
  expect(observation.pageErrors).toEqual([])
})

test("desktop workbench grows past 840px and 46vw while preserving chat space and its preferred width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop resize acceptance")
  await page.setViewportSize({ width: 2400, height: 1000 })
  const observation = await installSessions(page)
  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  const panel = page.locator("#right-workbench")
  const width = () => panel.evaluate((element) => element.getBoundingClientRect().width)
  const divider = panel.locator("xpath=preceding-sibling::*[1]")
  const box = await divider.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(1100, box!.y + box!.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(width).toBeGreaterThan(1200)
  const preferredWidth = await width()
  expect(preferredWidth).toBeGreaterThan(840)
  expect(preferredWidth).toBeGreaterThan(2400 * 0.46)
  await expect.poll(() => page.evaluate(() => Number(localStorage.getItem("lotus_next_inspector_w")))).toBeCloseTo(preferredWidth, 0)
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect.poll(width).toBeCloseTo(preferredWidth, 0)

  await page.setViewportSize({ width: 1280, height: 900 })
  await expect.poll(width).toBeLessThan(preferredWidth)
  await expect.poll(() => page.locator("[data-chat-layout]").first().evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(359)
  expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  expect(await page.evaluate(() => Number(localStorage.getItem("lotus_next_inspector_w")))).toBeCloseTo(preferredWidth, 0)
  await page.setViewportSize({ width: 2400, height: 1000 })
  await expect.poll(width).toBeCloseTo(preferredWidth, 0)
  expect(observation.pageErrors).toEqual([])
  await testInfo.attach("wide-restored-workbench", { body: await page.screenshot(), contentType: "image/png" })
})

test("sidebar drag opens sessions in the targeted chat pane without moving projects", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop native session drag acceptance")
  await installSessions(page)
  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  const rowA = page.locator(`[data-sidebar-session="${sessionA}"]`)
  const rowB = page.locator(`[data-sidebar-session="${sessionB}"]`)
  await rowB.dragTo(page.locator('[data-chat-body="true"][data-session-drop-target="main"]'))
  await expect(rowB.getByRole("button", { name: "Session B", exact: true })).toHaveAttribute("aria-current", "page")
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  await openTool(page, "并排会话")
  await rowA.dragTo(page.locator('#right-workbench [data-chat-body="true"][data-session-drop-target="secondary"]'))
  await expect(page.locator("#right-workbench").getByRole("combobox").filter({ hasText: "Session A" })).toBeVisible()
  await expect(rowB.getByRole("button", { name: "Session B", exact: true })).toHaveAttribute("aria-current", "page")
  await testInfo.attach("session-drop-main-and-secondary", { body: await page.screenshot(), contentType: "image/png" })
})
