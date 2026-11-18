import { expectComposerText } from "./support/composer.js"
import { expect, test, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const runningSession = {
  id: "all-surface-session",
  title: "Immediate Stop acceptance",
  title_version: 1,
  kind: "root",
  root_session_id: "all-surface-session",
  parent_session_id: null,
  model: "fixture-model",
  model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: "2026-09-19T00:00:00Z",
  updated_at: "2026-09-19T00:00:00Z",
  last_activity_at: "2026-09-19T00:00:00Z",
  message_count: 0,
  is_running: true,
  last_run_status: "running",
  has_pending_question: false,
  permission_mode: "default",
}

test("Stop is a primary realtime control and never enters the message queue", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const session = runningSession

  await page.route("**/api/v1/bamboo/permission/default-session-mode", (route) =>
    route.fulfill({
      json: {
        mode: "default",
        revision: 1,
        loaded_at: "2026-09-19T00:00:00Z",
        status: "ready",
      },
    }),
  )
  await page.route("**/api/v1/sessions?*", (route) =>
    route.fulfill({ json: { sessions: [session], total: 1, limit: 200, offset: 0 } }),
  )
  await page.route("**/api/v1/sessions/all-surface-session", (route) =>
    route.fulfill({ json: { session }, headers: { ETag: '"1"' } }),
  )
  await page.route("**/api/v1/task/all-surface-session", (route) =>
    route.fulfill({ json: { session_id: "all-surface-session", items: [] } }),
  )

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  const stop = page.getByRole("button", { name: "停止生成", exact: true })
  await expect(stop).toBeVisible()

  const input = page.getByRole("textbox", { name: "消息", exact: true })
  await input.fill("这条消息只用于同时显示发送与停止控件")
  const queue = page.getByRole("button", { name: "加入队列", exact: true })
  await expect(queue).toBeVisible()

  const [stopBackground, queueBackground, stopForeground, squareFill] = await Promise.all([
    stop.evaluate(
      (element) => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor,
    ),
    queue.evaluate(
      (element) => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor,
    ),
    stop.evaluate(
      (element) => element.ownerDocument.defaultView!.getComputedStyle(element).color,
    ),
    stop
      .locator("svg")
      .evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).fill),
  ])
  expect(stopBackground).toBe(queueBackground)
  expect(squareFill).toBe(stopForeground)
  expect(squareFill).not.toBe(stopBackground)
  await testInfo.attach("solid-primary-stop", {
    body: await page.screenshot(),
    contentType: "image/png",
  })

  await stop.click()
  await expect(stop).toBeHidden()
  await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeVisible()
  await expectComposerText(input, "这条消息只用于同时显示发送与停止控件")
  await expect.poll(() => observation.clientFrames).toContainEqual({
    type: "stop",
    session_id: "all-surface-session",
  })
  expect(
    observation.httpRequests.some(
      ({ method, url }) => method === "POST" && new URL(url).pathname.includes("/api/v1/stop/"),
    ),
  ).toBe(false)
})

test("Stop uses the exact run already observed when reopening a running session", async ({ page }) => {
  const sessionId = runningSession.id
  const runId = "fixture-observed-run"
  const partialText = "The partial answer is saved after Stop."
  let cancelled = false
  let readsAfterStop = 0
  let subscribed: WebSocketRoute | undefined
  const receivedRunIds: string[] = []
  const realtimeStops: unknown[] = []
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  await page.routeWebSocket(/.*/, (socket) => {
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw))
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") socket.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch === `agent.${sessionId}`) subscribed = socket
      if (frame.type === "stop") realtimeStops.push(frame)
    })
  })
  const sessionSnapshot = () => (
    cancelled ? { ...runningSession, is_running: false, last_run_status: "cancelled" } : runningSession
  )
  await page.route("**/api/v1/execute/defaults", (route) => route.fulfill({
    json: { upstream_retry: { supported_modes: ["until_cancelled"] } },
  }))
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({
    json: { sessions: [sessionSnapshot()], total: 1, limit: 200, offset: 0 },
  }))
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => route.fulfill({
    json: { session: sessionSnapshot() }, headers: { ETag: cancelled ? '"2"' : '"1"' },
  }))
  await page.route("**/api/v1/runs/active", (route) => route.fulfill({
    json: { sessions: cancelled ? [] : [{
      session_id: sessionId, run_id: runId, started_at: runningSession.created_at,
      round_count: 0, last_critical_events: [], running_child_session_ids: [],
    }] },
  }))
  await page.route(`**/api/v1/history/${sessionId}`, (route) => {
    const messages = [{
      id: "observed-user", role: "user", content: "Continue the existing run",
      created_at: runningSession.created_at,
    }]
    if (cancelled && ++readsAfterStop > 1) messages.push({
      id: "cancelled-partial", role: "assistant", content: partialText,
      created_at: runningSession.created_at,
    })
    return route.fulfill({ json: { session_id: sessionId, messages } })
  })
  await page.route(`**/api/v1/stop/${sessionId}`, (route) => {
    receivedRunIds.push(route.request().headers()["bamboo-run-id"] ?? "")
    if (receivedRunIds.at(-1) !== runId) return route.fulfill({ status: 409, json: { error: "Wrong run" } })
    cancelled = true
    return route.fulfill({ json: { success: true, session_id: sessionId, run_id: runId } })
  })

  await page.goto(standaloneScenario.entryUrl)
  const stop = page.getByRole("button", { name: "停止生成", exact: true })
  await expect(stop).toBeVisible()
  await expect.poll(() => Boolean(subscribed)).toBe(true)
  subscribed!.send(JSON.stringify({
    ch: `agent.${sessionId}`, seq: 1, event: { type: "token", content: partialText },
  }))
  await expect(page.locator(".assistant-streamdown-streaming")).toContainText(partialText)
  await stop.click()
  await expect.poll(() => receivedRunIds).toEqual([runId])
  await expect(stop).toBeHidden()
  await expect(page.locator(".assistant-streamdown:not(.assistant-streamdown-streaming)"))
    .toContainText(partialText)
  expect(readsAfterStop).toBeGreaterThanOrEqual(2)
  expect(realtimeStops).toEqual([])
  expect(observation.httpRequests.some(({ method, url }) => method === "POST" && new URL(url).pathname.includes("/execute/"))).toBe(false)
})
