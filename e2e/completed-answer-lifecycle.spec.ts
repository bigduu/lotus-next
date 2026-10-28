import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const primary = "all-surface-session"
const other = "synthetic-other-session"
const at = "2026-10-28T00:00:00.000Z"
const prompts = ["Synthetic first question", "Synthetic first follow-up", "Synthetic second follow-up"]
const answers = ["Synthetic completed answer one.", "Synthetic completed answer two.", "Synthetic completed answer three."]
const otherAnswer = "Synthetic other session answer."

type FixtureMessage = {
  id: string; role: "user" | "assistant" | "tool"; content: string; created_at: string
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  tool_call_id?: string; tool_success?: boolean
}
const item = (id: string, role: FixtureMessage["role"], content: string): FixtureMessage => ({ id, role, content, created_at: at })
const otherHistory = [item("other-user", "user", "Other session question"), item("other-answer", "assistant", otherAnswer)]
const toolHistory = (index: number): FixtureMessage[] => [
  { ...item(`tool-call-${index}`, "assistant", ""), tool_calls: [{ id: `tool-${index}`, type: "function",
    function: { name: "Read", arguments: JSON.stringify({ file_path: "/synthetic/example.txt" }) } }] },
  { ...item(`tool-result-${index}`, "tool", "Synthetic tool result"), tool_call_id: `tool-${index}`, tool_success: true },
]
const gate = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

async function prepare(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
    localStorage.setItem("copilot_ui_theme_v1", "light")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const histories: Record<string, FixtureMessage[]> = { [primary]: [], [other]: otherHistory }
  let running = false, socket: WebSocketRoute | undefined, seq = 0, feedSeq = 0, subscriptions = 0
  let holdNextHistory = false, delayedHistoryRequests = 0, releasedHistoryResponses = 0
  let heldSnapshot: FixtureMessage[] = []
  const held = gate(), writes: { path: string; body: unknown }[] = [], executions: string[] = []
  const channels = new Set<string>()
  const makeSession = (id: string, title: string) => ({
    id, title, title_version: 1, kind: "root", root_session_id: id, parent_session_id: null,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: at, updated_at: at, last_activity_at: at, message_count: histories[id].length,
    is_running: id === primary && running, last_run_status: id === primary && running ? "running" : "completed",
    permission_mode: "default", has_pending_question: false, spawn_depth: 0, pinned: false,
    bypass_permissions: false, root_orchestration_only: false, thinking_mode: "standard", reasoning_effort: "medium",
    root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
  })
  const sessions = () => [makeSession(primary, "Synthetic lifecycle A"), makeSession(other, "Synthetic lifecycle B")]
  await page.routeWebSocket(/.*/, (ws) => {
    socket = ws
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
      if (frame.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch) {
        channels.add(frame.ch)
        if (frame.ch === `agent.${primary}`) subscriptions += 1
      }
      if (frame.type === "unsubscribe" && frame.ch) channels.delete(frame.ch)
    })
  })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    const method = request.method()
    if (method !== "GET") writes.push({ path, body: request.postData() ? request.postDataJSON() : null })
    if (method === "GET" && path === "/api/v1/sessions") {
      const selected = url.searchParams.get("kind") === "child" ? [] : sessions()
      return route.fulfill({ json: { sessions: selected, total: selected.length, limit: 200, offset: 0 } })
    }
    const selected = sessions().find(({ id }) => path === `/api/v1/sessions/${id}`)
    if (method === "GET" && selected) return route.fulfill({ json: { session: selected }, headers: { ETag: '"1"' } })
    for (const id of [primary, other]) {
      if (method === "GET" && path === `/api/v1/history/${id}`) {
        const snapshot = [...histories[id]]
        if (id === primary && holdNextHistory) {
          holdNextHistory = false
          heldSnapshot = snapshot
          delayedHistoryRequests += 1
          await held.promise
          await route.fulfill({ json: { session_id: id, messages: snapshot } })
          releasedHistoryResponses += 1
          return
        }
        return route.fulfill({ json: { session_id: id, messages: snapshot } })
      }
      if (method === "GET" && path === `/api/v1/task/${id}`) return route.fulfill({ json: { session_id: id, items: [] } })
      if (method === "GET" && path === `/api/v1/respond/${id}/pending`) return route.fulfill({ json: { has_pending_question: false } })
      if (method === "GET" && path === `/api/v1/actors/${id}/snapshot`) return route.fulfill({ json: actorSnapshotFixture(id, 0) })
    }
    if (method === "POST" && path === "/api/v1/chat") {
      const body = request.postDataJSON() as { message: string; session_id: string }
      const index = histories[primary].filter(({ role }) => role === "user").length
      expect(body).toMatchObject({ session_id: primary, message: prompts[index] })
      const messageId = `user-${index + 1}`
      histories[primary].push(item(messageId, "user", prompts[index]))
      return route.fulfill({ json: { session_id: primary, status: "success", message_id: messageId } })
    }
    if (method === "POST" && path === `/api/v1/execute/${primary}`) {
      running = true
      const runId = `synthetic-run-${executions.length + 1}`
      executions.push(runId)
      return route.fulfill({ json: { status: "started", session_id: primary, run_id: runId } })
    }
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner")).toContainText("Synthetic lifecycle A")
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  const emit = (event: object) => socket!.send(JSON.stringify({ ch: `agent.${primary}`, seq: ++seq, event }))
  return { observation, writes, executions, channels, emit,
    get subscriptions() { return subscriptions },
    get delayedHistoryRequests() { return delayedHistoryRequests },
    get releasedHistoryResponses() { return releasedHistoryResponses },
    get heldSnapshot() { return heldSnapshot },
    holdNextHistory() { holdNextHistory = true },
    releaseHistory() { held.release() },
    complete() {
      running = false
      emit({ type: "complete" })
      socket!.send(JSON.stringify({ ch: `agent.${primary}`, seq: ++seq, control: { type: "terminal" } }))
    },
    publishCanonical() {
      histories[primary] = prompts.flatMap((prompt, index) => [
        item(`user-${index + 1}`, "user", prompt), item(`answer-${index + 1}`, "assistant", answers[index]),
      ])
    },
    persistTool(index: number) { histories[primary].push(...toolHistory(index)) },
    publishCanonicalWithTools() {
      histories[primary] = prompts.slice(0, 2).flatMap((prompt, index) => [
        item(`user-${index + 1}`, "user", prompt), ...toolHistory(index + 1),
        item(`answer-${index + 1}`, "assistant", answers[index]),
      ])
    },
    notifyCanonical(messageId = "answer-3") {
      const event = { type: "message_appended", session_id: primary, message_id: messageId }
      socket!.send(JSON.stringify({ ch: "feed", seq: ++feedSeq, event: { seq: feedSeq, ts: at, session_id: primary, event } }))
    },
  }
}

async function revealSidebar(page: Page) {
  const entry = page.getByRole("button", { name: "新建会话", exact: true })
  const bounds = await entry.boundingBox()
  if (!bounds || bounds.x < 0 || bounds.x + bounds.width > (page.viewportSize()?.width ?? Infinity)) {
    await page.getByRole("button", { name: "菜单", exact: true }).click()
  }
}

async function expectAnswers(page: Page, expected: readonly string[]) {
  const transcript = page.locator("[data-message-list-content]").first()
  for (const answer of expected) {
    const body = transcript.locator('[data-message-role="assistant"]').filter({ hasText: answer })
    await expect(body).toHaveCount(1)
    await expect(body).toBeVisible()
    expect(await body.evaluate((element) => element.closest("[data-process-activity]") === null)).toBe(true)
  }
  for (const answer of answers.filter((value) => !expected.includes(value))) {
    await expect(transcript.getByText(answer, { exact: true })).toHaveCount(0)
  }
}

test("completed answers survive compression, stale history, follow-ups, session switch and canonical reload", async ({ page }, info) => {
  test.setTimeout(100_000)
  const f = await prepare(page)
  const transcript = page.locator("[data-message-list-content]").first()
  const send = async (index: number) => {
    const composer = page.getByRole("textbox", { name: "消息", exact: true })
    await composer.fill(prompts[index])
    await page.getByRole("button", { name: "发送消息", exact: true }).click()
    await expect.poll(() => f.executions.length).toBe(index + 1)
    await expect.poll(() => f.subscriptions).toBeGreaterThanOrEqual(index + 1)
    f.emit({ type: "execution_started", run_id: f.executions[index], started_at: at })
  }
  const finish = async (index: number) => {
    f.emit({ type: "token", content: answers[index] })
    await expectAnswers(page, answers.slice(0, index + 1))
    f.complete()
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeVisible({ timeout: 15_000 })
    await expectAnswers(page, answers.slice(0, index + 1))
  }

  await send(0)
  await finish(0)
  await send(1)
  f.emit({ type: "context_compression_status", phase: "before_execute", status: "started" })
  await expect(transcript.locator("[data-process-status]")).toHaveText("正在压缩上下文…")
  f.emit({ type: "context_compression_status", phase: "before_execute", status: "completed" })
  f.emit({ type: "context_summarized", summary: "Synthetic model-only summary", messages_summarized: 2, tokens_saved: 1000,
    usage_before_percent: 90, usage_after_percent: 40, trigger_type: "synthetic-only" })
  await expectAnswers(page, answers.slice(0, 1))
  f.holdNextHistory()
  f.emit({ type: "session_history_committed", session_id: primary })
  await expect.poll(() => f.delayedHistoryRequests).toBe(1)
  await finish(1)
  await send(2)
  await finish(2)
  expect(f.heldSnapshot.map(({ id }) => id)).toEqual(["user-1", "user-2"])
  f.releaseHistory()
  await expect.poll(() => f.releasedHistoryResponses).toBe(1)
  // Give the delivered old response and the resulting render an opportunity
  // to run before checking that the newer transcript still wins.
  await transcript.evaluate((element) => new Promise<void>((resolve) => {
    const browser = element.ownerDocument.defaultView!
    browser.requestAnimationFrame(() => browser.requestAnimationFrame(() => resolve()))
  }))
  await expectAnswers(page, answers)
  await page.screenshot({ path: info.outputPath("before-session-switch.png"), animations: "disabled" })

  await revealSidebar(page)
  await page.getByRole("button", { name: "Synthetic lifecycle B", exact: true }).click()
  await expect(page.getByRole("banner")).toContainText("Synthetic lifecycle B")
  await expect(page.getByText(otherAnswer, { exact: true })).toHaveCount(1)
  await expectAnswers(page, [])
  await revealSidebar(page)
  await page.getByRole("button", { name: "Synthetic lifecycle A", exact: true }).click()
  await expect(page.getByRole("banner")).toContainText("Synthetic lifecycle A")
  await expectAnswers(page, answers)
  await expect(page.getByText(otherAnswer, { exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("after-session-switch.png"), animations: "disabled" })

  f.publishCanonical()
  await expect.poll(() => f.channels.has("feed")).toBe(true)
  f.notifyCanonical()
  for (let index = 0; index < answers.length; index++) {
    await expect(transcript.locator(`[data-message-row="answer-${index + 1}"]`)).toContainText(answers[index])
  }
  await expectAnswers(page, answers)
  await expect(transcript.locator('[data-message-row^="completed-answer-handoff-"]')).toHaveCount(0)
  const beforeReload = await transcript.locator('[data-message-role="assistant"]').allTextContents()
  await page.screenshot({ path: info.outputPath("canonical-before-reload.png"), animations: "disabled" })
  await page.reload()
  await expect(page.getByRole("banner")).toContainText("Synthetic lifecycle A")
  await expectAnswers(page, answers)
  await expect.poll(() => transcript.locator('[data-message-role="assistant"]').allTextContents()).toEqual(beforeReload)
  await expect(transcript.locator('[data-message-row^="completed-answer-handoff-"]')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("canonical-after-reload.png"), animations: "disabled" })

  expect(f.executions).toEqual(["synthetic-run-1", "synthetic-run-2", "synthetic-run-3"])
  expect(f.writes.filter(({ path }) => path === "/api/v1/chat")).toHaveLength(3)
  expect(f.writes.filter(({ path }) => path === `/api/v1/execute/${primary}`)).toHaveLength(3)
  expect(f.writes.filter(({ path }) => path !== "/api/v1/chat" && path !== `/api/v1/execute/${primary}`)).toEqual([])
  expect(f.observation.pageErrors).toEqual([])
  expect(f.observation.consoleErrors).toEqual([])
  expect(f.observation.failedRequests).toEqual([])
  expect(f.observation.errorResponses).toEqual([])
})


test("completed answers remain outside folded tool activity after compression and follow-up", async ({ page }, info) => {
  test.setTimeout(70_000)
  const f = await prepare(page)
  const transcript = page.locator("[data-message-list-content]").first()
  const process = transcript.locator("[data-process-activity]")
  for (let index = 0; index < 2; index++) {
    await page.getByRole("textbox", { name: "消息", exact: true }).fill(prompts[index])
    await page.getByRole("button", { name: "发送消息", exact: true }).click()
    await expect.poll(() => f.executions.length).toBe(index + 1)
    await expect.poll(() => f.subscriptions).toBeGreaterThanOrEqual(index + 1)
    if (index === 1) {
      f.emit({ type: "context_compression_status", phase: "before_execute", status: "started" })
      await expect(transcript.locator("[data-process-status]").last()).toHaveText("正在压缩上下文…")
      f.emit({ type: "context_compression_status", phase: "before_execute", status: "completed" })
      f.emit({ type: "context_summarized", summary: "Synthetic model-only summary", messages_summarized: 2,
        tokens_saved: 1000, usage_before_percent: 90, usage_after_percent: 40, trigger_type: "synthetic-only" })
      await expectAnswers(page, answers.slice(0, 1))
    }
    f.emit({ type: "tool_start", tool_call_id: `tool-${index + 1}`, tool_name: "Read",
      arguments: { file_path: "/synthetic/example.txt" } })
    await expect(process).toHaveCount(index + 1)
    await expect(process.last().locator("[data-process-toggle]")).toHaveAttribute("aria-expanded", "false")
    f.emit({ type: "tool_complete", tool_call_id: `tool-${index + 1}`, result: { success: true, result: "Synthetic tool result" } })
    f.emit({ type: "token", content: answers[index] })
    await expectAnswers(page, answers.slice(0, index + 1))
    f.persistTool(index + 1)
    f.complete()
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(process).toHaveCount(index + 1)
    await expectAnswers(page, answers.slice(0, index + 1))
    for (const toggle of await process.locator("[data-process-toggle]").all()) await expect(toggle).toHaveAttribute("aria-expanded", "false")
  }
  await page.screenshot({ path: info.outputPath("folded-activity-before-canonical.png"), animations: "disabled" })
  f.publishCanonicalWithTools()
  await expect.poll(() => f.channels.has("feed")).toBe(true)
  f.notifyCanonical("answer-2")
  await expect(transcript.locator('[data-message-row="answer-1"]')).toContainText(answers[0])
  await expect(transcript.locator('[data-message-row="answer-2"]')).toContainText(answers[1])
  await expect(process).toHaveCount(2)
  await expectAnswers(page, answers.slice(0, 2))
  await expect(transcript.locator('[data-message-row^="completed-answer-handoff-"]')).toHaveCount(0)
  for (const toggle of await process.locator("[data-process-toggle]").all()) await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await page.screenshot({ path: info.outputPath("folded-activity-after-canonical.png"), animations: "disabled" })
  expect(f.writes.filter(({ path }) => path === "/api/v1/chat")).toHaveLength(2)
  expect(f.writes.filter(({ path }) => path === `/api/v1/execute/${primary}`)).toHaveLength(2)
  expect(f.writes.filter(({ path }) => path !== "/api/v1/chat" && path !== `/api/v1/execute/${primary}`)).toEqual([])
  expect(f.observation.pageErrors).toEqual([])
  expect(f.observation.consoleErrors).toEqual([])
  expect(f.observation.failedRequests).toEqual([])
  expect(f.observation.errorResponses).toEqual([])
})
