import { expect, test, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

test("unread sessions retain their title name and expose a separate read-state description", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const sessions = ["all-surface-session", "unread-session"].map((id, index) => ({
    id, title: index ? "Unread session acceptance" : "Current session", title_version: 1,
    kind: "root", root_session_id: id, parent_session_id: null,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z",
    last_activity_at: "2026-09-07T00:00:00Z", message_count: index ? 1 : 0,
    is_running: false, last_run_status: "completed", has_pending_question: false,
    permission_mode: "default",
  }))
  await page.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === "/api/v1/sessions") {
      await route.fulfill({
        json: { sessions, total: sessions.length, limit: 200, offset: 0 },
      })
    }
    else if (/^\/api\/v1\/sessions\/[^/]+$/.test(pathname)) {
      const session = sessions.find(({ id }) => id === pathname.split("/").pop())
      if (session) await route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
      else await route.fallback()
    } else if (pathname.startsWith("/api/v1/history/")) {
      await route.fulfill({ json: { session_id: pathname.split("/").pop(), messages: [] } })
    } else if (/^\/api\/v1\/respond\/[^/]+\/pending$/.test(pathname)) {
      await route.fulfill({ json: { has_pending_question: false } })
    } else await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  const phone = testInfo.project.name === "phone-chromium"
  if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
  const session = page.locator("aside").getByRole("button", { name: "Unread session acceptance", exact: true })
  await expect(session).toBeVisible()
  await expect(session).toHaveAccessibleName("Unread session acceptance")
  await expect(session).toHaveAccessibleDescription("未读消息")
  await session.click()
  if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await expect(session).toBeVisible()
  await expect(session).toHaveAccessibleName("Unread session acceptance")
  await expect(session).toHaveAccessibleDescription("")
  await expect(session).not.toHaveAttribute("aria-describedby")
  // Move away again: the read marker must persist beyond the active-row override.
  await page.locator("aside").getByRole("button", { name: "Current session", exact: true }).click()
  if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await expect(session).toHaveAccessibleName("Unread session acceptance")
  await expect(session).toHaveAccessibleDescription("")
  expect(observation.pageErrors).toEqual([])
})

test("background feed updates remain unread while Settings hides the conversation", async ({ page }) => {
  const sessionId = "all-surface-session"
  const initialAt = "2026-10-06T00:00:00.000Z"
  const updatedAt = "2026-10-06T00:01:00.000Z"
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let socket: WebSocketRoute | undefined
  let feedSubscriptions = 0
  await page.routeWebSocket(/.*/, (webSocket) => {
    socket = webSocket
    webSocket.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
      if (frame.type === "hello") webSocket.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") webSocket.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch === "feed") feedSubscriptions += 1
    })
  })
  const session = {
    id: sessionId, title: "Read before Settings", title_version: 1,
    kind: "root", root_session_id: sessionId, parent_session_id: null,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: initialAt, updated_at: initialAt, last_activity_at: initialAt,
    message_count: 1, is_running: false, last_run_status: "completed",
    has_pending_question: false, permission_mode: "default",
  }
  const history = [{ id: "initial-user", role: "user", content: "Read before opening Settings.", created_at: initialAt }]
  await page.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === "/api/v1/sessions") {
      await route.fulfill({ json: { sessions: [session], total: 1, limit: 200, offset: 0 } })
    } else if (pathname === `/api/v1/sessions/${sessionId}`) {
      await route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
    } else if (pathname === `/api/v1/history/${sessionId}`) {
      await route.fulfill({ json: { session_id: sessionId, messages: history } })
    } else if (pathname === `/api/v1/respond/${sessionId}/pending`) {
      await route.fulfill({ json: { has_pending_question: false } })
    } else await route.fallback()
  })
  const readMarker = () => page.evaluate((id) => {
    const state = JSON.parse(localStorage.getItem("lotus-next.session-read.v1") ?? "{}")
    return state[id] as { at: number; count: number; readAt: number } | undefined
  }, sessionId)

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  const transcript = page.locator("[data-message-list-content]").first()
  await expect(transcript).toContainText("Read before opening Settings.")
  await expect.poll(readMarker).toMatchObject({ at: Date.parse(initialAt), count: 1 })
  await expect.poll(() => feedSubscriptions).toBe(1)
  const beforeSettings = await readMarker()
  await page.keyboard.press("Control+k")
  const search = page.getByPlaceholder("搜索会话或操作…")
  await search.fill("系统设置")
  await search.press("Enter")
  await expect(page.locator('[data-slot="settings-page"]')).toBeVisible()
  await expect(transcript).toBeHidden()

  session.title = "Updated behind Settings"
  session.title_version = 2
  session.updated_at = updatedAt
  session.last_activity_at = updatedAt
  session.message_count = 2
  history.push({ id: "background-answer", role: "assistant", content: "Arrived while Settings was open.", created_at: updatedAt })
  socket!.send(JSON.stringify({
    ch: "feed", seq: 1,
    event: { seq: 1, ts: updatedAt, session_id: sessionId, event: { type: "message_appended", session_id: sessionId, message_id: "background-answer" } },
  }))
  // Both history reconciliation and the debounced summary refresh must finish
  // before checking the marker; a disconnected feed cannot make this pass.
  await expect(transcript).toContainText("Arrived while Settings was open.")
  await expect(page.locator("aside")).toContainText("Updated behind Settings")
  await transcript.evaluate((element) => new Promise<void>((resolve) => {
    const browser = element.ownerDocument.defaultView!
    browser.requestAnimationFrame(() => browser.requestAnimationFrame(() => resolve()))
  }))
  expect(await readMarker()).toEqual(beforeSettings)
  expect(feedSubscriptions).toBe(1)

  await page.getByRole("button", { name: "返回聊天", exact: true }).click()
  await expect(transcript).toBeVisible()
  await expect(transcript).toContainText("Arrived while Settings was open.")
  await expect.poll(readMarker).toMatchObject({ at: Date.parse(updatedAt), count: 2 })
  expect(feedSubscriptions).toBe(1)
  expect(observation.pageErrors).toEqual([])
})
