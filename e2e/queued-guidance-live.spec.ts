import { expect, test, type WebSocketRoute } from "@playwright/test"

import {
  installArtifactRuntime,
  standaloneScenario,
} from "./support/artifactRuntime.js"

test("admitted queued guidance appears in the running conversation without a reload", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "one desktop transport regression is sufficient")
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)

  let socket: WebSocketRoute | undefined
  let agentSubscribed = false
  let sequence = 0
  await page.routeWebSocket(/.*/, (webSocket) => {
    socket = webSocket
    webSocket.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
      if (frame.type === "hello") webSocket.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") webSocket.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch === "agent.all-surface-session") {
        agentSubscribed = true
      }
    })
  })

  const session = {
    id: "all-surface-session",
    title: "Queued guidance live projection",
    title_version: 1,
    kind: "root",
    root_session_id: "all-surface-session",
    parent_session_id: null,
    spawn_depth: 0,
    model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-21T00:00:00Z",
    updated_at: "2026-09-21T00:00:02Z",
    last_activity_at: "2026-09-21T00:00:02Z",
    message_count: 2,
    has_attachments: false,
    is_running: true,
    last_run_status: "running",
    has_pending_question: false,
    running_child_count: 0,
    pinned: false,
    permission_mode: "default",
  }
  let history = [
    {
      id: "initial-user",
      role: "user",
      content: "Start the task",
      created_at: "2026-09-21T00:00:00Z",
    },
    {
      id: "assistant-tool",
      role: "assistant",
      content: "Working on it",
      created_at: "2026-09-21T00:00:01Z",
    },
  ]

  await page.route("**/api/v1/sessions?*", (route) =>
    route.fulfill({ json: { sessions: [session], total: 1, limit: 200, offset: 0 } }),
  )
  await page.route("**/api/v1/sessions/all-surface-session", (route) =>
    route.fulfill({ json: { session }, headers: { ETag: '"1"' } }),
  )
  await page.route("**/api/v1/history/all-surface-session", (route) =>
    route.fulfill({ json: { session_id: session.id, messages: history } }),
  )
  await page.route("**/api/v1/task/all-surface-session", (route) =>
    route.fulfill({ json: { session_id: session.id, items: [] } }),
  )

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await expect(page.getByText("Working on it", { exact: true })).toBeVisible()
  await expect.poll(() => agentSubscribed).toBe(true)
  await expect(page.getByText("Use the corrected constraint", { exact: true })).toHaveCount(0)

  history = [
    ...history,
    {
      id: "queued-user",
      role: "user",
      content: "Use the corrected constraint",
      created_at: "2026-09-21T00:00:02Z",
    },
  ]
  socket!.send(
    JSON.stringify({
      ch: `agent.${session.id}`,
      seq: ++sequence,
      event: {
        type: "message_appended",
        session_id: session.id,
        message_id: "queued-user",
        role: "user",
        content: "Use the corrected constraint",
        created_at: "2026-09-21T00:00:02Z",
      },
    }),
  )

  await expect(page.getByText("Use the corrected constraint", { exact: true })).toBeVisible()
  await testInfo.attach("admitted-guidance-visible", {
    body: await page.screenshot(),
    contentType: "image/png",
  })
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
