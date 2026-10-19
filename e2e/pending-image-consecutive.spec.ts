import { expect, test, type WebSocketRoute } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

test("#383 consecutive image ACKs remain separate through reconnect and out-of-order canonical arrival", async ({ page }, info) => {
  const id = "all-surface-session", at = "2026-10-19T00:00:00Z"
  const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
  await page.addInitScript((sid) => {
    localStorage.setItem("bodhi_onboarded_v1", "1"); localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", sid)
  }, id)
  const runtime = await installArtifactRuntime(page, standaloneScenario)
  const session = { id, title: "Consecutive pending images", kind: "root", title_version: 1, pinned: false,
    parent_session_id: null, root_session_id: id, spawn_depth: 0, model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" }, created_at: at, updated_at: at,
    last_activity_at: at, message_count: 0, is_running: false, last_run_status: "completed", has_pending_question: false,
    permission_mode: "default", bypass_permissions: false, thinking_mode: "standard", root_orchestration_only: false,
    root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64) }
  let chats = 0, executions = 0, connections = 0, navigations = 0, socket: WebSocketRoute | undefined
  const persisted = new Set<number>()
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
    if (path === "/api/v1/sessions") return route.fulfill({ json: { sessions: new URL(request.url()).searchParams.get("kind") === "child" ? [] : [session], total: 1, limit: 200, offset: 0 } })
    if (path === `/api/v1/sessions/${id}`) return route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
    if (path === "/api/v1/chat" && request.method() === "POST") {
      chats += 1
      return route.fulfill({ json: { session_id: id, message_id: `ack-${chats}`, status: "success" } })
    }
    if (path === `/api/v1/execute/${id}`) {
      executions += 1
      return route.fulfill({ status: 400, json: { error: "Synthetic execution refusal; no model was called" } })
    }
    if (path === `/api/v1/history/${id}`) return route.fulfill({ json: { session_id: id, messages: [1, 2].filter((n) => persisted.has(n)).map((n) => ({
      id: `ack-${n}`, role: "user", content: `caption ${n}`, created_at: at,
      content_parts: [{ type: "text", text: `caption ${n}` }, { type: "image_url", image_url: { url: `bamboo-attachment://${id}/image-${n}` } }],
    })) } })
    if (path.startsWith(`/api/v1/sessions/${id}/attachments/`)) return route.fulfill({ body: Buffer.from(pixel, "base64"), contentType: "image/png" })
    if (path === `/api/v1/actors/${id}/snapshot`) return route.fulfill({ json: actorSnapshotFixture(id, 0) })
    if (path === `/api/v1/task/${id}`) return route.fulfill({ json: { items: [] } })
    if (path === `/api/v1/respond/${id}/pending`) return route.fulfill({ json: { has_pending_question: false } })
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  const textbox = page.getByRole("textbox", { name: "Messages", exact: true }).first()
  for (const n of [1, 2]) {
    await page.locator('input[type="file"]').setInputFiles({ name: `image-${n}.png`, mimeType: "image/png", buffer: Buffer.from(pixel, "base64") })
    await textbox.fill(`caption ${n}`)
    await page.getByRole("button", { name: "Send message", exact: true }).click()
    await expect.poll(() => executions).toBe(n)
  }
  const pending = page.locator("[data-pending-user-message]")
  await expect(pending).toHaveCount(2)
  await expect(pending.nth(0)).toContainText("caption 1"); await expect(pending.nth(1)).toContainText("caption 2")
  await expect(pending.locator("img")).toHaveCount(2)
  await socket!.close({ code: 1012, reason: "synthetic reconnect before either ACK is canonical" })
  await expect.poll(() => connections).toBe(2)
  await expect(pending).toHaveCount(2)
  await page.screenshot({ path: info.outputPath("two-pending-images-after-reconnect.png"), animations: "disabled" })
  persisted.add(2)
  await socket!.close({ code: 1012, reason: "synthetic canonical ACK2 arrives first" })
  await expect.poll(() => connections).toBe(3)
  await expect(page.locator('[data-message-row="ack-2"] img')).toBeVisible()
  await expect(pending).toHaveCount(1); await expect(pending).toContainText("caption 1")
  await expect(pending.locator("img")).toBeVisible()
  persisted.add(1)
  await socket!.close({ code: 1012, reason: "synthetic canonical ACK1 arrives later" })
  await expect.poll(() => connections).toBe(4)
  await expect(page.locator('[data-message-row="ack-1"] img')).toBeVisible()
  await expect(pending).toHaveCount(0)
  expect(chats).toBe(2); expect(executions).toBe(2); expect(navigations).toBe(1)
  expect(runtime.pageErrors).toEqual([])
})
