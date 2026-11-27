import { expect, test, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "all-surface-session"
const channel = `agent.${sessionId}`
const runId = "resumed-run"
const timestamp = "2026-11-19T00:00:00Z"
const title = "Interrupted conversation"
const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
const sessionPath = `/api/v1/sessions/${sessionId}`
const historyPath = `/api/v1/history/${sessionId}`
const executePath = `/api/v1/execute/${sessionId}`
const message = (id: string, role: "user" | "assistant", content: string) => ({
  id, role, content, created_at: timestamp,
})

test("resumes an interrupted conversation without adding a user message", async ({ page }, info) => {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
    localStorage.setItem("lotus_next_last_session", id)
  }, sessionId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const history = [
    message("previous-user", "user", "The first request in the conversation."),
    message("previous-answer", "assistant", "The completed first answer."),
    message("interrupted-user", "user", "The request whose answer was interrupted."),
    message("partial-answer", "assistant", "The persisted partial answer."),
  ]
  let status: "cancelled" | "running" | "completed" = "cancelled"
  const session = () => ({
    id: sessionId, title, title_version: 1, kind: "root", root_session_id: sessionId, parent_session_id: null,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: timestamp, updated_at: timestamp, last_activity_at: timestamp, message_count: history.length,
    is_running: status === "running", last_run_status: status, permission_mode: "default", has_pending_question: false,
    root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 0,
    root_mode_birth_token: "a".repeat(64),
  })
  let agentSocket: WebSocketRoute | undefined
  let feedSocket: WebSocketRoute | undefined
  await page.routeWebSocket(/\/v2\/stream(?:\?|$)/, (socket) => {
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") socket.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch === channel) agentSocket = socket
      if (frame.type === "subscribe" && frame.ch === "feed") feedSocket = socket
    })
  })
  const writes: Array<{ method: string; path: string; body: unknown }> = []
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    if (method === "GET") {
      if (path === "/api/v1/sessions") {
        const sessions = url.searchParams.get("kind") === "child" ? [] : [session()]
        return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
      }
      if (path === sessionPath) return route.fulfill({
        json: { session: { ...session(), resume_interrupted: status === "cancelled" } },
        headers: { ETag: status === "completed" ? '"3"' : status === "running" ? '"2"' : '"1"' },
      })
      if (path === historyPath) return route.fulfill({ json: { session_id: sessionId, messages: history } })
    } else if (/^\/api\/v1\/(chat|execute|sessions|history)(?:\/|$)/.test(path)) {
      writes.push({ method, path, body: request.postData() ? request.postDataJSON() : null })
      if (method === "POST" && path === executePath) {
        status = "running"
        return route.fulfill({ json: { status: "started", session_id: sessionId, run_id: runId } })
      }
    }
    return route.fallback()
  })

  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner")).toContainText(title)
  const play = page.getByRole("button", { name: "继续对话", exact: true })
  const send = page.getByRole("button", { name: "发送消息", exact: true })
  const stop = page.getByRole("button", { name: "停止生成", exact: true })
  const input = page.getByRole("textbox", { name: "消息", exact: true })
  await expect(play).toBeEnabled()
  await expect(stop).toHaveCount(0)
  await expect(page.locator('[data-message-row="interrupted-user"]')).toBeVisible()
  await expect(page.locator('[data-message-row="partial-answer"]')).toHaveText("The persisted partial answer.")
  await expect(page.getByRole("combobox", { name: "权限模式", exact: true })).toHaveText("Default")
  await info.attach("interrupted-composer-play", { body: await page.screenshot(), contentType: "image/png" })

  await input.fill("A new follow-up would be sent as a message.")
  await expect(send).toBeEnabled()
  await expect(play).toHaveCount(0)
  await input.fill("")
  await expect(play).toBeEnabled()
  await page.locator('input[type="file"]').setInputFiles({
    name: "resume-fixture.png", mimeType: "image/png", buffer: Buffer.from(image, "base64"),
  })
  await expect(send).toBeEnabled()
  await expect(play).toHaveCount(0)
  await page.getByRole("button", { name: "移除图片", exact: true }).click()
  await expect(play).toBeEnabled()
  expect(writes).toEqual([])

  await play.click()
  await expect.poll(() => writes).toEqual([
    { method: "POST", path: executePath, body: { resume_interrupted: true } },
  ])
  await expect(stop).toBeVisible()
  await expect(play).toHaveCount(0)
  await expect.poll(() => Boolean(agentSocket && feedSocket)).toBe(true)
  const finalAnswer = "The resumed answer is complete."
  agentSocket!.send(JSON.stringify({ ch: channel, seq: 1, event: { type: "token", content: finalAnswer } }))
  await expect(page.locator(".assistant-streamdown-streaming")).toContainText(finalAnswer)

  status = "completed"
  history.push(message("resumed-answer", "assistant", finalAnswer))
  const completed = { type: "complete", session_id: sessionId, run_id: runId }
  agentSocket!.send(JSON.stringify({ ch: channel, seq: 2, event: completed }))
  feedSocket!.send(JSON.stringify({
    ch: "feed", seq: 1, event: { seq: 1, ts: timestamp, session_id: sessionId, event: completed },
  }))
  await expect(page.locator('[data-message-row="resumed-answer"]')).toContainText(finalAnswer)
  await expect(stop).toHaveCount(0)
  await expect(play).toHaveCount(0)
  await expect(send).toBeDisabled()
  await expect(page.locator('[data-message-row="previous-answer"]')).toHaveText("The completed first answer.")
  await expect(page.locator('[data-message-role="user"]')).toHaveCount(2)
  expect(writes.map(({ path }) => path)).toEqual([executePath])
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
