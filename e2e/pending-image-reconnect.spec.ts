import { expect, test, type WebSocketRoute } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

for (const ackWhileAway of [false, true]) test(`#383 pending images survive another session's send and reconnect (ACK while away=${ackWhileAway})`, async ({ page }, info) => {
  const a = "all-surface-session", b = "second-image-session", at = "2026-10-19T00:00:00Z"
  const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", id)
  }, a)
  const runtime = await installArtifactRuntime(page, standaloneScenario)
  let socket: WebSocketRoute | undefined, connections = 0, navigations = 0
  let releaseAck!: () => void
  const delayedAck = new Promise<void>((resolve) => { releaseAck = resolve })
  const reads = new Map<string, number>(), persisted = new Set<string>()
  const chats: Array<{ session_id: string; message: string }> = [], executions: string[] = []
  const sessions = [a, b].map((id, index) => ({ id, title: `Pending image ${index ? "B" : "A"}`, kind: "root", title_version: 1,
    root_session_id: id, parent_session_id: null, spawn_depth: 0, pinned: false,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: at, updated_at: at, last_activity_at: at, message_count: 0,
    workspace_path: "/workspace/lotus-next", permission_mode: "default", bypass_permissions: false,
    is_running: false, last_run_status: "completed", subagent_count: 0, has_pending_question: false,
    root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 0,
    root_mode_birth_token: "a".repeat(64) }))
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations += 1 })
  await page.routeWebSocket(/.*/, (ws) => {
    socket = ws; connections += 1
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string }
      if (frame.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
    })
  })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === "/api/v1/sessions") return route.fulfill({ json: { sessions: new URL(request.url()).searchParams.get("kind") === "child" ? [] : sessions, total: 2, limit: 200, offset: 0 } })
    if (path === "/api/v1/chat" && request.method() === "POST") {
      const body = request.postDataJSON(); chats.push(body)
      if (ackWhileAway && body.session_id === a && chats.length === 1) await delayedAck
      return route.fulfill({ json: { session_id: body.session_id, message_id: `ack-${body.session_id}`, status: "success" } })
    }
    for (const session of sessions) {
      const id = session.id
      if (path === `/api/v1/sessions/${id}`) return route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
      if (path === `/api/v1/history/${id}`) {
        reads.set(id, (reads.get(id) ?? 0) + 1)
        return route.fulfill({ json: { session_id: id, messages: persisted.has(id) ? [
          { id: `ack-${id}`, role: "user", content: id === a ? "A caption" : "B caption", content_parts: [
            { type: "text", text: id === a ? "A caption" : "B caption" },
            ...(id === a ? [{ type: "image_url", image_url: { url: `bamboo-attachment://${a}/image-1` } }] : []),
          ], created_at: at },
        ] : [] } })
      }
      if (path === `/api/v1/actors/${id}/snapshot`) return route.fulfill({ json: actorSnapshotFixture(id, 0) })
      if (path === `/api/v1/task/${id}`) return route.fulfill({ json: { session_id: id, items: [] } })
      if (path === `/api/v1/respond/${id}/pending`) return route.fulfill({ json: { has_pending_question: false } })
      if (path === `/api/v1/execute/${id}`) {
        executions.push(id)
        return route.fulfill({ status: 400, json: { error: "Synthetic execution refusal; no model was called" } })
      }
    }
    if (path === `/api/v1/sessions/${a}/attachments/image-1`) return route.fulfill({ body: Buffer.from(pixel, "base64"), contentType: "image/png" })
    return route.fallback()
  })
  const select = async (title: string) => {
    if ((page.viewportSize()?.width ?? 1440) < 768) await page.getByRole("button", { name: "Menu", exact: true }).click()
    const sidebar = page.locator("aside").filter({ has: page.getByPlaceholder("Search sessions", { exact: true }) })
    await sidebar.getByPlaceholder("Search sessions", { exact: true }).fill(title)
    await sidebar.getByRole("button", { name: title, exact: true }).click()
    await expect(page.locator("header").getByText(title, { exact: true })).toBeVisible()
  }
  await page.goto(standaloneScenario.entryUrl)
  const input = page.getByRole("textbox", { name: "Messages", exact: true }).first()
  await expect(input).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles({ name: "A.png", mimeType: "image/png", buffer: Buffer.from(pixel, "base64") })
  await input.fill("A caption")
  await page.getByRole("button", { name: "Send message", exact: true }).click()
  if (ackWhileAway) {
    await expect.poll(() => chats.length).toBe(1)
    await select("Pending image B")
    releaseAck()
    await expect.poll(() => executions.length).toBe(1)
    await expect(page.locator("[data-pending-user-message]")).toHaveCount(0)
    await select("Pending image A")
  }
  await expect.poll(() => executions.length).toBe(1)
  const pending = page.locator("[data-pending-user-message]")
  await expect(pending.locator("img")).toBeVisible()
  await select("Pending image B")
  await input.fill("B caption")
  await page.getByRole("button", { name: "Send message", exact: true }).click()
  await expect.poll(() => executions.length).toBe(2)
  await expect(pending).toContainText("B caption")
  await expect(pending.locator("img")).toHaveCount(0)
  await select("Pending image A")
  await expect(pending.locator("img")).toBeVisible()
  await expect(pending).toContainText("A caption")
  const before = reads.get(a) ?? 0
  await socket!.close({ code: 1012, reason: "synthetic reconnect before image ACK is persisted" })
  await expect.poll(() => connections).toBe(2)
  await expect.poll(() => reads.get(a) ?? 0).toBeGreaterThan(before)
  await expect(pending.locator("img")).toBeVisible()
  expect(chats).toHaveLength(2); expect(executions).toEqual([a, b])
  await page.screenshot({ path: info.outputPath("cross-session-image-after-reconnect.png"), animations: "disabled" })
  persisted.add(a)
  await socket!.close({ code: 1012, reason: "synthetic reconnect after A canonical ACK arrives" })
  await expect.poll(() => connections).toBe(3)
  await expect(page.locator(`[data-message-row="ack-${a}"] img`)).toBeVisible()
  await expect(pending).toHaveCount(0)
  await select("Pending image B")
  await expect(pending).toContainText("B caption")
  persisted.add(b)
  await socket!.close({ code: 1012, reason: "synthetic reconnect after B canonical ACK arrives" })
  await expect.poll(() => connections).toBe(4)
  await expect(page.locator(`[data-message-row="ack-${b}"]`)).toContainText("B caption")
  await expect(pending).toHaveCount(0)
  expect(chats).toHaveLength(2); expect(executions).toEqual([a, b])
  expect(navigations).toBe(1); expect(runtime.pageErrors).toEqual([])
})

test("shows every acknowledged message in one session and retires each only when its canonical row arrives", async ({ page }) => {
  const id = "all-surface-session"
  const first = "First acknowledged message"
  const second = "Second acknowledged message"
  const at = "2026-10-20T00:00:00Z"
  await page.addInitScript((sessionId) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", sessionId)
  }, id)
  const runtime = await installArtifactRuntime(page, standaloneScenario)
  let socket: WebSocketRoute | undefined
  let connections = 0
  await page.routeWebSocket(/.*/, (ws) => {
    socket = ws
    connections += 1
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw))
      if (frame.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
    })
  })
  const posts: Array<{ session_id: string; message: string }> = []
  let executions = 0
  const persisted: Array<{ id: string; role: string; content: string; created_at: string }> = []
  await page.route("**/api/v1/chat", (route) => {
    posts.push(route.request().postDataJSON())
    return route.fulfill({ json: { session_id: id, message_id: `ack-${posts.length}`, status: "success" } })
  })
  await page.route(`**/api/v1/execute/${id}`, (route) => {
    executions += 1
    return route.fulfill({ status: 400, json: { error: "Fixture execution refusal" } })
  })
  await page.route(`**/api/v1/history/${id}**`, (route) => route.fulfill({
    json: { session_id: id, messages: persisted },
  }))
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner")).toContainText("All-surface acceptance")
  const editor = page.getByRole("textbox", { name: "Messages", exact: true })
  const send = page.getByRole("button", { name: "Send message", exact: true })
  const pending = page.locator("[data-pending-user-message]")
  await editor.fill(first)
  await send.click()
  await expect(pending).toHaveText([first])
  await expect(editor).toHaveAttribute("aria-busy", "false")

  await editor.fill(second)
  await send.click()
  await expect(pending).toHaveText([first, second])
  await expect.poll(() => executions).toBe(2)
  await expect(editor).toHaveAttribute("aria-busy", "false")
  await expect.poll(() => connections).toBeGreaterThan(0)
  const reconnect = async () => {
    const before = connections
    await socket!.close({ code: 1012, reason: "Refresh canonical message projection" })
    await expect.poll(() => connections).toBeGreaterThan(before)
  }

  // An independently hydrated second ACK must not retire the first caption.
  persisted.push({ id: "ack-2", role: "user", content: second, created_at: at })
  await reconnect()
  await expect(page.locator('[data-message-row="ack-2"]')).toHaveText(second)
  await expect(pending).toHaveText([first])
  persisted.unshift({ id: "ack-1", role: "user", content: first, created_at: at })
  await reconnect()
  await expect(page.locator('[data-message-row="ack-1"]')).toHaveText(first)
  await expect(pending).toHaveCount(0)
  expect(posts).toEqual([
    expect.objectContaining({ session_id: id, message: first }),
    expect.objectContaining({ session_id: id, message: second }),
  ])
  expect(executions).toBe(2)
  expect(runtime.pageErrors).toEqual([])
})
