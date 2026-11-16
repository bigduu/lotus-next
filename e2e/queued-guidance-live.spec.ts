import { expect, test, type WebSocketRoute } from "@playwright/test"

import {
  installArtifactRuntime,
  standaloneScenario,
} from "./support/artifactRuntime.js"

test("interjection replaces the checkpointed round without moving or duplicating replies", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "one desktop transport regression is sufficient")
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
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
    message_count: 1,
    has_attachments: false,
    is_running: true,
    last_run_status: "running",
    has_pending_question: false,
    running_child_count: 0,
    pinned: false,
    permission_mode: "default",
    root_orchestration_only: false,
    thinking_mode: "standard",
    root_mode_transition_epoch: 0,
    root_mode_birth_token: "a".repeat(64),
  }
  const previousReply = "I found a storage location."
  const guidanceText = "Use the corrected location."
  const nextReply = "I will use the corrected location."
  const previousTool = {
    id: "assistant-tool",
    role: "assistant",
    content: previousReply,
    created_at: "2026-09-21T00:00:01Z",
    tool_calls: [{ id: "lookup", type: "function", function: { name: "Read", arguments: "{}" } }],
  }
  let history: Array<Record<string, unknown>> = [
    {
      id: "initial-user",
      role: "user",
      content: "Start the task",
      created_at: "2026-09-21T00:00:00Z",
    },
  ]
  let queued: { id: string; text: string; mode: string } | undefined
  let admitted = false
  let historyRequested = false
  let releaseHistory!: () => void
  const checkpoint = new Promise<void>((resolve) => { releaseHistory = resolve })
  const emit = (event: Record<string, unknown>) => socket!.send(
    JSON.stringify({ ch: `agent.${session.id}`, seq: ++sequence, event }),
  )

  await page.route("**/api/v1/sessions?*", (route) =>
    route.fulfill({ json: { sessions: [session], total: 1, limit: 200, offset: 0 } }),
  )
  await page.route("**/api/v1/sessions/all-surface-session", (route) =>
    route.fulfill({ json: { session }, headers: { ETag: '"1"' } }),
  )
  await page.route("**/api/v1/history/all-surface-session", async (route) => {
    if (admitted) {
      historyRequested = true
      await checkpoint
    }
    await route.fulfill({ json: { session_id: session.id, messages: history } })
  })
  await page.route("**/api/v1/sessions/all-surface-session/guidance", async (route) => {
    if (route.request().method() === "POST") {
      const submission = route.request().postDataJSON() as NonNullable<typeof queued>
      queued = submission
      await route.fulfill({ status: 202, json: { id: submission.id, activation_pending: false } })
    } else {
      await route.fulfill({ json: { messages: !admitted && queued
        ? [{ ...queued, created_at: "2026-09-21T00:00:02Z", images: [] }] : [] } })
    }
  })
  await page.route("**/api/v1/task/all-surface-session", (route) =>
    route.fulfill({ json: { session_id: session.id, items: [] } }),
  )

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  const transcript = page.locator("[data-message-list-content]")
  const rows = transcript.locator("[data-message-role]")
  await expect(rows).toHaveText(["Start the task"])
  await expect.poll(() => agentSubscribed).toBe(true)
  emit({ type: "token", content: previousReply })
  emit({ type: "tool_start", tool_call_id: "lookup", tool_name: "Read", arguments: {} })
  await expect(transcript.locator("[data-process-toggle]")).toHaveCount(1)
  await expect(rows).toHaveText(["Start the task", previousReply])

  await page.getByRole("textbox", { name: "消息", exact: true }).fill(guidanceText)
  await page.getByRole("combobox", { name: "发送时机" }).selectOption("after_round")
  await page.getByRole("button", { name: "加入队列", exact: true }).click()
  await expect.poll(() => queued).toMatchObject({ text: guidanceText, mode: "after_round" })
  await expect(rows).toHaveText(["Start the task", previousReply])

  emit({ type: "tool_complete", tool_call_id: "lookup", result: { success: true, result: "Found it" } })
  const user = {
    id: queued!.id, role: "user", content: guidanceText,
    correlation_id: "session-guidance", created_at: "2026-09-21T00:00:02Z",
  }

  history = [
    ...history,
    previousTool,
    {
      id: "lookup-result", role: "tool", tool_call_id: "lookup",
      content: "Found it", created_at: "2026-09-21T00:00:03Z",
    },
    user,
  ]
  admitted = true
  const appended = { ...user, type: "message_appended", session_id: session.id, message_id: user.id }
  emit(appended)
  await expect.poll(() => historyRequested).toBe(true)
  const nextPrefix = "I will use"
  emit({ type: "token", content: nextPrefix })
  await expect(rows).toHaveText(["Start the task", previousReply, nextPrefix])
  emit(appended)
  emit({ type: "token", content: nextReply.slice(nextPrefix.length) })
  await expect(rows).toHaveText(["Start the task", previousReply, nextReply])

  releaseHistory()
  await expect(rows).toHaveText(["Start the task", previousReply, guidanceText, nextReply])
  await expect(transcript.locator("[data-process-toggle]")).toHaveCount(1)
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeVisible()

  history = [...history, {
    id: "canonical-final", role: "assistant", content: nextReply,
    phase: "final_answer", created_at: "2026-09-21T00:00:04Z",
  }]
  session.is_running = false
  session.last_run_status = "completed"
  emit({ type: "complete" })
  await expect(transcript.locator('[data-message-row="canonical-final"]')).toBeVisible()
  await expect(rows).toHaveText(["Start the task", previousReply, guidanceText, nextReply])
  await testInfo.attach("admitted-guidance-visible", {
    body: await page.screenshot(),
    contentType: "image/png",
  })
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
