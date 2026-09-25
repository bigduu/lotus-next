import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionA = "all-surface-session"
const sessionB = "browser-session-b"

test("selected browser follows a chat switch and remains live under other workbench tabs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop session-switch regression")

  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const sessions = [
    { id: sessionA, title: "Session A" },
    { id: sessionB, title: "Session B" },
  ].map(({ id, title }) => ({
    id, title, kind: "root", root_session_id: id, parent_session_id: null,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-25T00:00:00Z", updated_at: "2026-09-25T00:00:00Z",
    permission_mode: "default", is_running: false,
  }))
  const pages: Record<string, { url: string; title: string; epoch: number; viewport: { width: number; height: number } }> = {
    [sessionA]: { url: "https://a.test/", title: "Page A", epoch: 1, viewport: { width: 640, height: 480 } },
    [sessionB]: { url: "https://b.test/", title: "Page B", epoch: 1, viewport: { width: 640, height: 480 } },
  }
  const opened: string[] = []
  const navigated: string[] = []

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    const browserMatch = /^\/api\/v1\/browser\/sessions\/([^/]+)(\/.*)?$/.exec(path)
    if (browserMatch) {
      const id = browserMatch[1]!
      const suffix = browserMatch[2] ?? ""
      const browserPage = pages[id]
      if (!browserPage) return route.fulfill({ status: 404 })
      const state = () => ({
        page_epoch: browserPage.epoch,
        frame_seq: browserPage.epoch,
        active_tab_id: `tab-${id}`,
        tabs: [{ tab_id: `tab-${id}`, url: browserPage.url, title: browserPage.title, active: true }],
        url: browserPage.url,
        title: browserPage.title,
        viewport: browserPage.viewport,
        can_go_back: false,
        can_go_forward: false,
      })
      if (!suffix && method === "PUT") {
        opened.push(id)
        return route.fulfill({ json: state() })
      }
      if (!suffix && method === "GET") return route.fulfill({ json: state() })
      if (suffix === "/frame" && method === "GET") {
        await new Promise((resolve) => setTimeout(resolve, 80))
        return route.fulfill({ status: 204 })
      }
      if (suffix === "/dom" && method === "GET") {
        return route.fulfill({ json: {
          page_epoch: browserPage.epoch,
          active_tab_id: `tab-${id}`,
          url: browserPage.url,
          title: browserPage.title,
          snapshot: `- heading: ${id}`,
        } })
      }
      if (method === "POST" && (suffix === "/navigate" || suffix === "/viewport")) {
        const body = request.postDataJSON() as Record<string, unknown>
        expect(body.expected_epoch).toBe(browserPage.epoch)
        if (suffix === "/navigate") {
          navigated.push(id)
          browserPage.url = String(body.url)
        } else {
          browserPage.viewport = { width: Number(body.width), height: Number(body.height) }
        }
        browserPage.epoch += 1
        return route.fulfill({ json: state() })
      }
      return route.fulfill({ status: 404 })
    }

    if (path === "/api/v1/sessions" && method === "GET") {
      const childrenOnly = new URL(request.url()).searchParams.get("kind") === "child"
      const listed = childrenOnly ? [] : sessions
      return route.fulfill({ json: { sessions: listed, total: listed.length, limit: 200, offset: 0 } })
    }
    const id = path.split("/").at(-1)
    if (method === "GET" && path.startsWith("/api/v1/sessions/") && sessions.some((session) => session.id === id)) {
      return route.fulfill({ json: { session: sessions.find((session) => session.id === id) }, headers: { ETag: '"1"' } })
    }
    if (method === "GET" && path.startsWith("/api/v1/history/") && (id === sessionA || id === sessionB)) {
      return route.fulfill({ json: { session_id: id, messages: [] } })
    }
    if (method === "GET" && path.startsWith("/api/v1/task/") && (id === sessionA || id === sessionB)) {
      return route.fulfill({ json: { session_id: id, title: null, items: [] } })
    }
    if (method === "GET" && path === `/api/v1/respond/${sessionB}/pending`) {
      return route.fulfill({ json: { has_pending_question: false } })
    }
    return route.fallback()
  })

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  const panel = page.getByRole("complementary", { name: "工作面板" })
  await panel.getByRole("tab", { name: "浏览器" }).click()
  const browser = panel.getByRole("region", { name: "内置浏览器" })
  const address = browser.getByRole("textbox", { name: "网页地址" })
  await expect(address).toHaveValue("https://a.test/")
  expect(opened).toEqual([sessionA])

  await page.getByRole("button", { name: "Session B", exact: true }).click()
  await expect(address).toHaveValue("https://b.test/")
  await expect(panel.getByRole("tab", { name: "浏览器标签页 1：Page B" })).toHaveAttribute("aria-selected", "true")
  expect(opened).toEqual([sessionA, sessionB])

  await browser.getByRole("button", { name: "查看 DOM" }).click()
  await expect(browser.getByLabel("DOM 快照", { exact: true })).toContainText(sessionB)
  await browser.getByRole("button", { name: "关闭 DOM 快照" }).click()
  await address.fill("https://b.test/next")
  await browser.getByRole("button", { name: "访问网页" }).click()
  await expect(address).toHaveValue("https://b.test/next")
  expect(navigated).toEqual([sessionB])

  await panel.getByRole("tab", { name: "检查器" }).click()
  await panel.getByRole("tab", { name: "浏览器标签页 1：Page B" }).click()
  await expect(address).toHaveValue("https://b.test/next")
  expect(opened).toEqual([sessionA, sessionB])
  expect(observation.pageErrors).toEqual([])
})
