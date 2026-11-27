import { expect, test, type WebSocketRoute } from "@playwright/test"

import {
  installArtifactRuntime,
  standaloneScenario,
} from "./support/artifactRuntime.js"
import { expectComposerText } from "./support/composer.js"

test("queued guidance appears immediately and the live transcript hands off each message once", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "one desktop transport regression is sufficient")
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
    localStorage.setItem("zenith_render_probe", "1")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)

  let socket: WebSocketRoute | undefined
  let agentSubscribed = false
  let feedSubscribed = false
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
      if (frame.type === "subscribe" && frame.ch === "feed") feedSubscribed = true
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
    message_count: 3,
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
  const initialRows = [guidanceText, nextReply, "Start the task"]
  const previousTool = {
    id: "assistant-tool",
    role: "assistant",
    content: previousReply,
    created_at: "2026-09-21T00:00:01Z",
    tool_calls: [{ id: "lookup", type: "function", function: { name: "Read", arguments: "{}" } }],
  }
  let history: Array<Record<string, unknown>> = [
    {
      id: "earlier-user",
      role: "user",
      content: guidanceText,
      created_at: "2026-09-20T23:59:58Z",
    },
    {
      id: "earlier-assistant",
      role: "assistant",
      content: nextReply,
      phase: "final_answer",
      created_at: "2026-09-20T23:59:59Z",
    },
    {
      id: "initial-user",
      role: "user",
      content: "Start the task",
      created_at: "2026-09-21T00:00:00Z",
    },
  ]
  let queued: { id: string; text: string; mode: string } | undefined
  let withdrawnId: string | undefined
  let admitted = false
  let historyRequested = false
  let releaseHistory!: () => void
  const checkpoint = new Promise<void>((resolve) => { releaseHistory = resolve })
  let queueRefreshRequested = false
  let queueDrained = false
  let releaseQueueRefresh!: () => void
  const queueRefresh = new Promise<void>((resolve) => { releaseQueueRefresh = resolve })
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
      if (queued?.mode === "after_round") {
        queueRefreshRequested = true
        await queueRefresh
      }
      await route.fulfill({ json: { messages: !admitted && queued
        ? [{ ...queued, created_at: "2026-09-21T00:00:02Z", images: [] }] : [] } })
      if (admitted) queueDrained = true
    }
  })
  await page.route("**/api/v1/sessions/all-surface-session/guidance/*", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback()
    withdrawnId = new URL(route.request().url()).pathname.split("/").at(-1)
    if (queued?.id === withdrawnId) queued = undefined
    await route.fulfill({ status: 204 })
  })
  await page.route("**/api/v1/task/all-surface-session", (route) =>
    route.fulfill({ json: { session_id: session.id, items: [] } }),
  )

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  const transcript = page.locator("[data-message-list-content]")
  const rows = transcript.locator("[data-message-role]")
  const observeMessageCount = async (role: "user" | "assistant", content: string) => {
    const observer = await transcript.evaluateHandle((element, expected) => {
      const counts = new Set<number>()
      const collect = () => counts.add(
        Array.from(element.querySelectorAll(`[data-message-role="${expected.role}"]`))
          .filter((row) => row.textContent?.trim() === expected.content).length,
      )
      collect()
      let frame = requestAnimationFrame(function sample() {
        collect()
        frame = requestAnimationFrame(sample)
      })
      return { stop: () => {
        cancelAnimationFrame(frame)
        collect()
        return [...counts]
      } }
    }, { role, content })
    return async () => {
      const counts = await observer.evaluate((handle) => handle.stop())
      await observer.dispose()
      return counts
    }
  }
  await expect(rows).toHaveText(initialRows)
  await expect.poll(() => agentSubscribed).toBe(true)
  await expect.poll(() => feedSubscribed).toBe(true)
  const storedRows = await transcript.locator("[data-virtual-history] [data-message-row]").elementHandles()
  expect(storedRows).toHaveLength(initialRows.length)
  const renders = () => page.evaluate(() =>
    (window as unknown as { __renderProbe: { read(): Record<string, number> } }).__renderProbe.read())
  const previousPrefix = "I found a"
  emit({ type: "token", content: previousPrefix })
  await expect(rows).toHaveText([...initialRows, previousPrefix])
  const beforeToken = await renders()
  expect(beforeToken["app.MessageList.history"]).toBeGreaterThan(0)
  emit({ type: "token", content: previousReply.slice(previousPrefix.length) })
  await expect(rows).toHaveText([...initialRows, previousReply])
  const afterToken = await renders()
  expect(afterToken["app.MessageList"]).toBeGreaterThan(beforeToken["app.MessageList"])
  expect(afterToken["app.MessageList.history"]).toBe(beforeToken["app.MessageList.history"])
  expect(await Promise.all(storedRows.map((row) => row.evaluate((element) => element.isConnected))))
    .toEqual(initialRows.map(() => true))

  emit({ type: "tool_start", tool_call_id: "lookup", tool_name: "Read", arguments: {} })
  await expect(transcript.locator("[data-process-toggle]")).toHaveCount(1)
  await expect(rows).toHaveText([...initialRows, previousReply])

  const composer = page.getByRole("textbox", { name: "消息", exact: true })
  const timing = page.getByRole("combobox", { name: "发送时机" })
  const enqueue = page.getByRole("button", { name: "加入队列", exact: true })
  const queue = page.locator('details[aria-label="待发送队列"]')
  const sendGuidance = async (mode: "after_run" | "after_round") => {
    await composer.fill(guidanceText)
    await timing.selectOption(mode)
    await enqueue.click()
    await expect.poll(() => queued).toMatchObject({ text: guidanceText, mode })
  }

  await sendGuidance("after_run")
  const withdrawn = queued!.id
  const withdrawnRow = transcript.locator(`[data-queued-guidance="${withdrawn}"]`)
  await expect(withdrawnRow).toContainText("队列中 · 本次运行结束后发送")
  await expect(rows).toHaveText([...initialRows, previousReply, guidanceText])
  await queue.locator("summary").click()
  await queue.getByRole("button", { name: "撤回", exact: true }).click()
  await expect.poll(() => withdrawnId).toBe(withdrawn)
  await expect(withdrawnRow).toHaveCount(0)
  await expect(rows).toHaveText([...initialRows, previousReply])

  await sendGuidance("after_round")
  await expect.poll(() => queueRefreshRequested).toBe(true)
  const queuedRow = transcript.locator(`[data-queued-guidance="${queued!.id}"]`)
  const withdrawInterjection = queuedRow.getByRole("button", { name: "撤回", exact: true })
  await expect(queuedRow).toContainText("插话 · 队列中，下一次模型回复前发送")
  await expect(rows).toHaveText([...initialRows, previousReply, guidanceText])
  await expectComposerText(composer, "")
  await expect(queue).toHaveCount(0)
  await expect(withdrawInterjection).toHaveCount(0)
  const userCounts = await observeMessageCount("user", guidanceText)
  releaseQueueRefresh()
  await expect(withdrawInterjection).toBeEnabled()
  await expect(queue).toHaveCount(0)

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
  // The server may remove the queue entry before the live event or the history
  // request reaches the browser. The acknowledged row should stay visible.
  await expect.poll(() => queueDrained).toBe(true)
  await expect(withdrawInterjection).toHaveCount(0)
  await expect(queue).toHaveCount(0)
  await expect(rows).toHaveText([...initialRows, previousReply, guidanceText])
  const appended = { ...user, type: "message_appended", session_id: session.id, message_id: user.id }
  emit(appended)
  await expect.poll(() => historyRequested).toBe(true)
  const userRow = transcript.locator(`[data-message-row="${user.id}"]`)
  await expect(userRow).toBeVisible()
  await expect(queuedRow).toHaveCount(0)
  const nextPrefix = "I will use"
  emit({ type: "token", content: nextPrefix })
  await expect(rows).toHaveText([...initialRows, previousReply, guidanceText, nextPrefix])
  emit(appended)
  emit({ type: "token", content: nextReply.slice(nextPrefix.length) })
  const settledRows = [...initialRows, previousReply, guidanceText, nextReply]
  await expect(rows).toHaveText(settledRows)

  releaseHistory()
  await expect(transcript.locator(`[data-virtual-history] [data-message-row="${user.id}"]`)).toBeVisible()
  await expect(rows).toHaveText(settledRows)
  expect(await userCounts()).toEqual([2])
  await expect(transcript.locator("[data-process-toggle]")).toHaveCount(1)
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeVisible()

  history = [...history, {
    id: "canonical-final", role: "assistant", content: nextReply,
    phase: "final_answer", created_at: "2026-09-21T00:00:04Z",
  }]
  // The history notification can arrive while the run still has a live tail.
  // Keep the earlier identical answer and render the current one exactly once.
  const assistantCounts = await observeMessageCount("assistant", nextReply)
  emit({ type: "session_history_committed", session_id: session.id })
  await expect(transcript.locator('[data-message-row="canonical-final"]')).toBeVisible()
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeVisible()
  await expect(rows).toHaveText(settledRows)
  session.is_running = false
  session.last_run_status = "completed"
  emit({ type: "complete" })
  socket!.send(JSON.stringify({ ch: "feed", seq: 1, event: {
    seq: 1, ts: session.updated_at, session_id: session.id, event: { type: "complete" },
  } }))
  await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeVisible()
  await expect(rows).toHaveText(settledRows)
  expect(await assistantCounts()).toEqual([2])
  await testInfo.attach("admitted-guidance-visible", {
    body: await page.screenshot(),
    contentType: "image/png",
  })
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
