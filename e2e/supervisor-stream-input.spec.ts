import { expect, test, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { expectComposerText } from "./support/composer.js"

type Probe = { enable(): void; reset(): void; read(): Record<string, number> }

test("draft edits and live text reuse the long Supervisor transcript", async ({ page }) => {
  const sessionId = "bamboo-default-supervisor"
  const createdAt = "2026-11-15T12:00:00Z"
  const messages = Array.from({ length: 400 }, (_, index) => {
    const tail = index % 2 === 1
    return { id: `history-${index}`, role: tail ? "assistant" : "user", content: `History message ${index}`, created_at: createdAt }
  })
  const session = {
    id: sessionId, title: "Long Supervisor conversation", session_version: 2,
    kind: "root", root_session_id: sessionId, spawn_depth: 0, created_at: createdAt, updated_at: createdAt,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
    is_running: true, last_run_status: "running", message_count: messages.length,
  }
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, sessionId)
  await installArtifactRuntime(page, standaloneScenario, messages, { sessionId })
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({ json: {
    sessions: new URL(route.request().url()).searchParams.get("kind") === "child" ? [] : [session],
    total: 1, limit: 200, offset: 0,
  } }))
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => route.fulfill({ json: { session } }))
  await page.route("**/api/v1/runs/active", (route) => route.fulfill({ json: {
    sessions: [{ session_id: sessionId, is_running: true, status: "running" }],
  } }))
  const channel = `agent.${sessionId}`
  let subscribed: WebSocketRoute | undefined
  let sequence = 0
  await page.routeWebSocket(/.*/, (socket) => {
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw))
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") socket.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch === channel) subscribed = socket
    })
  })
  const emit = (content: string) => subscribed!.send(JSON.stringify({
    ch: channel, seq: ++sequence, event: { type: "token", content },
  }))

  await page.goto(standaloneScenario.entryUrl)
  const composer = page.getByRole("textbox", { name: "消息", exact: true })
  await expect(composer).toBeEditable()
  await expect.poll(() => Boolean(subscribed)).toBe(true)
  emit("Beginning the live report. ")
  const live = page.locator(".assistant-streamdown").filter({ hasText: "Beginning the live report." })
  await expect(live).toBeVisible()
  await page.evaluate(() => {
    const probe = (globalThis as unknown as { __renderProbe: Probe }).__renderProbe
    probe.enable()
    probe.reset()
  })
  const counts = () => page.evaluate(() =>
    (globalThis as unknown as { __renderProbe: Probe }).__renderProbe.read())

  await composer.pressSequentially("typing during run")
  await expectComposerText(composer, "typing during run")
  const typing = await counts()
  expect(typing["app.MessageList"] ?? 0).toBe(0)

  for (const text of ["First fragment. ", "Second fragment. ", "Final fragment."]) {
    emit(text)
    await expect(live).toContainText(text.trim())
  }
  await expectComposerText(composer, "typing during run")
  const streaming = await counts()
  expect(streaming["app.MessageList"]).toBeGreaterThan(0)
  expect(streaming["subagent.origins.history"] ?? 0).toBe(0)
})
