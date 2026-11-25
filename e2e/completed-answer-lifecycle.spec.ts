import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { installResizeDiagnostics } from "./support/resizeDiagnostics.js"
import { closeSettings, settingsSurface } from "./support/settingsNavigation.js"

const primary = "all-surface-session"
const other = "synthetic-other-session"
const at = "2026-10-28T00:00:00.000Z"
const prompts = ["Synthetic first question", "Synthetic first follow-up", "Synthetic second follow-up"]
const answers = ["Synthetic completed answer one.", "Synthetic completed answer two.", "Synthetic completed answer three."]
const otherAnswer = "Synthetic other session answer."
const monitoredHandle = "e9511561-7f99-4389-a7de-0c9e7a39ffe7"

type FixtureMessage = {
  id: string; role: "user" | "assistant" | "tool"; content: string; created_at: string
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  tool_call_id?: string; tool_success?: boolean
  metadata?: Record<string, unknown>
}
const item = (id: string, role: FixtureMessage["role"], content: string): FixtureMessage => ({ id, role, content, created_at: at })
const backgroundShell = (id: string) => {
  const args = { command: `fixture ${id}`, run_in_background: true }
  const result = JSON.stringify({ bash_id: id, status: "running", command: args.command })
  const history = [
    { ...item(`call-${id}`, "assistant", ""), tool_calls: [{ id, type: "function",
      function: { name: "Bash", arguments: JSON.stringify(args) } }] },
    { ...item(`result-${id}`, "tool", result), tool_call_id: id, tool_success: true },
  ]
  return { id, args, result, history }
}
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

async function prepare(page: Page, options: { waitingForCommand?: boolean; commandStop?: "cancelled" | "unavailable" } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
    localStorage.setItem("copilot_ui_theme_v1", "light")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let waitingForCommand = Boolean(options.waitingForCommand || options.commandStop)
  const histories: Record<string, FixtureMessage[]> = {
    [primary]: waitingForCommand ? [item("wait-user", "user", prompts[0]), ...toolHistory(1)] : [],
    [other]: otherHistory,
  }
  if (options.commandStop) {
    histories[primary].push({
      ...item("command-wait", "assistant", "A command was transferred to background monitoring."),
      metadata: { runtime_kind: "background_exec_wait", source: "runtime", exec_session_id: monitoredHandle },
    })
  }
  let running = false, socket: WebSocketRoute | undefined, seq = 0, feedSeq = 0, subscriptions = 0
  let holdNextHistory = false, delayedHistoryRequests = 0, releasedHistoryResponses = 0
  let heldSnapshot: FixtureMessage[] = []
  const held = gate(), commandStop = gate(), writes: { path: string; body: unknown }[] = [], executions: string[] = []
  const generationStops: string[] = []
  const channels = new Set<string>()
  const makeSession = (id: string, title: string) => ({
    id, title, title_version: 1, kind: "root", root_session_id: id, parent_session_id: null,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: at, updated_at: at, last_activity_at: at, message_count: histories[id].length,
    is_running: id === primary && running,
    ...(id === primary && waitingForCommand
      ? { last_run_status: "suspended", activity: "waiting_bash" }
      : { last_run_status: id === primary
        ? running ? "running" : options.commandStop === "cancelled" ? "cancelled" : "completed"
        : "completed" }),
    permission_mode: "default", has_pending_question: false, spawn_depth: 0, pinned: false,
    bypass_permissions: false, root_orchestration_only: false, thinking_mode: "standard", reasoning_effort: "medium",
    root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
  })
  const sessions = () => [makeSession(primary, "Synthetic lifecycle A"), makeSession(other, "Synthetic lifecycle B")]
  await page.routeWebSocket(/.*/, (ws) => {
    socket = ws
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string; ch?: string; session_id?: string }
      if (frame.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "stop" && frame.session_id) generationStops.push(frame.session_id)
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
    if (options.commandStop && method === "POST" && path === `/api/v1/sessions/${primary}/background-command-wait/cancel`) {
      await commandStop.promise
      if (options.commandStop === "unavailable") return route.fulfill({ status: 404 })
      waitingForCommand = false
      return route.fulfill({ json: { status: "cancelled", exec_session_id: monitoredHandle } })
    }
    if (options.commandStop && method === "GET" && path === `/api/v1/sessions/${primary}/guidance`) {
      return route.fulfill({ json: { messages: [{
        id: "pending-guidance", text: "Queued independently", created_at: at, mode: "after_run",
      }] } })
    }
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
  return { observation, writes, executions, channels, emit, generationStops, releaseCommandStop: commandStop.release,
    get subscriptions() { return subscriptions },
    get delayedHistoryRequests() { return delayedHistoryRequests },
    get releasedHistoryResponses() { return releasedHistoryResponses },
    get heldSnapshot() { return heldSnapshot },
    holdNextHistory() { holdNextHistory = true },
    releaseHistory() { held.release() },
    complete(closeChannel = true) {
      running = false
      emit({ type: "complete" })
      if (closeChannel) socket!.send(JSON.stringify({ ch: `agent.${primary}`, seq: ++seq, control: { type: "terminal" } }))
    },
    persistResponse(...messages: FixtureMessage[]) {
      histories[primary] = [...histories[primary].filter(({ role }) => role === "user"), ...messages]
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

async function recordParagraphReveals(page: Page) {
  await page.locator("[data-message-list-content]").evaluate((list) => {
    const batches: string[][] = []
    Object.assign(globalThis, { testParagraphReveals: batches })
    const browser = list.ownerDocument.defaultView!
    new browser.MutationObserver(() => {
      const batch = [...list.querySelectorAll(".assistant-streamdown-streaming p")]
        .filter((paragraph) => paragraph.getAnimations().length > 0)
        .map((paragraph) => paragraph.textContent ?? "")
      if (batch.length) batches.push(batch)
    }).observe(list, { childList: true, subtree: true, characterData: true })
  })
  return () => page.evaluate(() =>
    (globalThis as typeof globalThis & { testParagraphReveals: string[][] }).testParagraphReveals,
  )
}

test("settings pauses live prose and accumulated paragraphs reveal together without moving the reader", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  const f = await prepare(page)
  const input = page.getByRole("textbox", { name: "消息", exact: true })
  await input.fill(prompts[0])
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => f.channels.has(`agent.${primary}`)).toBe(true)
  f.notifyCanonical("user-1")
  await expect(page.locator('[data-message-row="user-1"]')).toBeVisible()
  const settings = settingsSurface(page)
  const openSettings = async () => {
    await revealSidebar(page)
    await page.getByRole("button", { name: "系统设置", exact: true }).click()
    await expect(settings).toBeVisible()
  }
  const paragraphs = page.locator(".assistant-streamdown-streaming p")
  const scroll = page.locator("[data-message-list-content]").locator("..")
  const revealBatches = await recordParagraphReveals(page)
  const initial = Array.from({ length: 36 }, (_, index) =>
    `第 ${index + 1} 段。A complete paragraph from the first live batch.`)

  await openSettings()
  f.emit({ type: "token", content: initial.join("\n\n") })
  // Cover an entire steady-state text publication interval.
  await new Promise((resolve) => setTimeout(resolve, 160))
  await expect(paragraphs).toHaveCount(0)
  await closeSettings(settings)
  await expect(paragraphs).toHaveText(initial)
  await expect.poll(revealBatches).toContainEqual(initial.slice(-12))
  await expect.poll(() => scroll.evaluate((element) =>
    element.scrollHeight - element.clientHeight - element.scrollTop,
  )).toBeLessThanOrEqual(2)

  await scroll.evaluate((element) => {
    const browser = element.ownerDocument.defaultView!
    element.dispatchEvent(new browser.WheelEvent("wheel", { deltaY: -300 }))
    element.scrollTop -= 300
  })
  const jump = page.getByRole("button", { name: "滚动到底部", exact: true })
  await expect(jump).toBeVisible()
  const readingAnchor = () => scroll.evaluate((element) => {
    const top = element.getBoundingClientRect().top
    const paragraph = [...element.querySelectorAll(".assistant-streamdown-streaming p")]
      .find((candidate) => candidate.getBoundingClientRect().bottom > top)
    return paragraph && { text: paragraph.textContent, offset: Math.round(paragraph.getBoundingClientRect().top - top) }
  })
  const readingPosition = await readingAnchor()
  expect(readingPosition?.text).toBeTruthy()

  await openSettings()
  const tail = ["后来第一段。", "后来第二段。", "后来第三段。"]
  for (const paragraph of tail) f.emit({ type: "token", content: `\n\n${paragraph}` })
  await new Promise((resolve) => setTimeout(resolve, 160))
  await expect(paragraphs).toHaveText(initial)
  expect(f.channels.has(`agent.${primary}`)).toBe(true)
  await closeSettings(settings)
  await expect(paragraphs).toHaveText([...initial, ...tail])
  await expect.poll(revealBatches).toContainEqual(tail)
  await expect(jump).toBeVisible()
  await expect.poll(readingAnchor).toEqual(readingPosition)
  expect(f.observation.pageErrors).toEqual([])
})

test("a completion alongside settings close settles the accumulated answer once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await installResizeDiagnostics(page)
  const f = await prepare(page)
  const input = page.getByRole("textbox", { name: "消息", exact: true })
  await input.fill(prompts[0])
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => f.channels.has(`agent.${primary}`)).toBe(true)
  const prefix = Array.from({ length: 24 }, (_, index) => `可见段落 ${index + 1}。`)
  const revealBatches = await recordParagraphReveals(page)
  f.emit({ type: "token", content: prefix.join("\n\n") })
  await expect(page.locator(".assistant-streamdown-streaming p")).toHaveText(prefix)
  expect(await revealBatches()).toEqual([])
  // WebKit can report a resize loop when the initial send changes the
  // composer and history layout. Check for errors from this transition.
  const errorsBeforeSettings = [...f.observation.pageErrors]

  await revealSidebar(page)
  await page.getByRole("button", { name: "系统设置", exact: true }).click()
  const settings = settingsSurface(page)
  await expect(settings).toBeVisible()
  const ending = "恢复时收到的最后一段。"
  const suffix = `\n\n${ending}`
  f.emit({ type: "token", content: suffix })
  f.persistResponse(item("settings-final-answer", "assistant", prefix.join("\n\n") + suffix))
  await settings.getByRole("button", { name: "返回聊天", exact: true }).evaluate((button) => (button as HTMLElement).click())
  f.complete()

  const settled = page.locator(".assistant-streamdown").filter({ hasText: ending })
  await expect(settled).toHaveCount(1)
  await expect(settled.locator("p")).toHaveText([...prefix, ending])
  await expect(settled).toBeVisible()
  await expect(page.locator(".assistant-streamdown-streaming")).toHaveCount(0)
  await expect.poll(() => f.channels.has(`agent.${primary}`)).toBe(false)
  if (f.observation.pageErrors.length > errorsBeforeSettings.length) {
    const diagnostics = await page.evaluate(() =>
      (globalThis as typeof globalThis & { __resizeDiagnostics: { errors: unknown[] } }).__resizeDiagnostics.errors,
    )
    await test.info().attach("resize-deliveries", { body: JSON.stringify(diagnostics, null, 2), contentType: "application/json" })
  }
  expect(f.observation.pageErrors).toEqual(errorsBeforeSettings)
})

async function captureShellNotifications(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("lotus_notify_enabled_v1", "1")
    const messages: Array<{ title: string; body?: string }> = []
    Object.defineProperty(globalThis, "testShellNotifications", { value: messages })
    Object.defineProperty(globalThis, "Notification", { value: class {
      static permission = "granted"
      constructor(title: string, options?: { body?: string }) {
        messages.push({ title, body: options?.body })
      }
    } })
  })
  return () => page.evaluate(() => (globalThis as typeof globalThis & {
    testShellNotifications: Array<{ title: string; body?: string }>
  }).testShellNotifications)
}

test("server-projected command wait keeps observation active and shows the right status", async ({ page }, info) => {
  await page.clock.install()
  const f = await prepare(page, { waitingForCommand: true })
  await expect(page.getByText("正在等待后台命令完成…", { exact: true })).toBeVisible()
  await expect(page.getByText("等待子会话完成", { exact: true })).toHaveCount(0)
  await expect(page.getByText("思考中…", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /^停止(?:生成|后台命令)$/ })).toHaveCount(0)
  await expect.poll(() => f.channels.has(`agent.${primary}`)).toBe(true)
  await page.clock.fastForward(2_100)
  await expect.poll(() => f.channels.has(`agent.${primary}`)).toBe(true)
  expect(f.executions).toEqual([])
  await page.screenshot({ path: info.outputPath("waiting-for-command.png") })
})

for (const outcome of ["cancelled", "unavailable"] as const) {
  test(`stopping a monitored command handles a service response of ${outcome}`, async ({ page }, info) => {
    const f = await prepare(page, { commandStop: outcome })
    const wait = page.getByText("正在等待后台命令完成…", { exact: true })
    const stop = page.getByRole("button", { name: "停止后台命令", exact: true })
    const queue = page.getByText("队列中 1", { exact: true })

    await expect(wait).toBeVisible()
    await expect(queue).toBeVisible()
    await stop.click()
    await expect(stop).toBeDisabled()
    await expect(page.getByText("正在停止后台命令…", { exact: true })).toBeVisible()
    await expect(wait).toBeVisible()
    await page.screenshot({ path: info.outputPath("stopping-background-command.png"), animations: "disabled" })
    f.releaseCommandStop()

    if (outcome === "cancelled") {
      await expect(wait).toHaveCount(0)
      await expect(stop).toHaveCount(0)
    } else {
      await expect(page.getByRole("alert").filter({ hasText: "未能确认后台命令已停止。请刷新会话后重试。" })).toBeVisible()
      await expect(wait).toBeVisible()
      await expect(stop).toBeEnabled()
    }
    await expect(queue).toBeVisible()
    await page.screenshot({ path: info.outputPath(`background-command-stop-${outcome}.png`), animations: "disabled" })
    expect(f.writes.filter(({ path }) => path.includes("/cancel") || path.includes("/stop/") || path.includes("/guidance"))).toEqual([{
      path: `/api/v1/sessions/${primary}/background-command-wait/cancel`, body: { exec_session_id: monitoredHandle },
    }])
    expect(f.generationStops).toEqual([])
    expect(f.executions).toEqual([])
  })
}

test("the final background shell delivers its backend notification after the answer settles", async ({ page }) => {
  const messages = await captureShellNotifications(page)
  const f = await prepare(page)
  const channel = `agent.${primary}`
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(prompts[0])
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => f.channels.has(channel)).toBe(true)

  const shell = backgroundShell("final-shell")
  f.emit({ type: "tool_start", tool_call_id: shell.id, tool_name: "Bash", arguments: shell.args })
  f.emit({ type: "tool_complete", tool_call_id: shell.id, result: { success: true, result: shell.result } })
  const answer = item("answer-1", "assistant", answers[0])
  f.emit({ type: "token", content: answers[0] })
  f.persistResponse(...shell.history, answer)
  f.complete(false)
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0)
  await expectAnswers(page, [answers[0]])
  await expect(page.getByRole("banner")).toContainText("Synthetic lifecycle A")

  f.emit({ type: "bash_completed", bash_id: shell.id, status: "completed", exit_code: 0 })
  expect(f.channels.has(channel)).toBe(true)
  expect(await messages()).toEqual([])
  const notice = { title: "Background command finished", body: "fixture final-shell — completed, exit 0" }
  f.emit({
    type: "notification", session_id: primary, id: "final-shell-notification", dedup_key: `bash:${shell.id}`,
    category: "background_task_completed", priority: "normal", created_at: at, ...notice,
  })
  await expect.poll(messages).toEqual([notice])
  await expect.poll(() => f.channels.has(channel)).toBe(false)
})

test("background shell outcomes still reach their cards after the answer completes", async ({ page }, info) => {
  const messages = await captureShellNotifications(page)
  const f = await prepare(page)
  const channel = `agent.${primary}`
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(prompts[0])
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => f.channels.has(channel)).toBe(true)

  const launched = [backgroundShell("shell-ok"), backgroundShell("shell-failed")]
  for (const { id, args, result } of launched) {
    f.emit({ type: "tool_start", tool_call_id: id, tool_name: "Bash", arguments: args })
    f.emit({ type: "tool_complete", tool_call_id: id, result: { success: true, result } })
  }
  const history = launched.flatMap(({ history }) => history)
  const answer = item("answer-1", "assistant", answers[0])
  f.emit({ type: "token", content: answers[0] })
  f.persistResponse(...history, answer)
  f.complete(false)
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0)
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeEditable()
  await expectAnswers(page, [answers[0]])

  const running = page.getByText("后台运行中…", { exact: true })
  const succeeded = page.getByText("已完成 · exit 0", { exact: true })
  const failed = page.getByText("失败 · exit 7", { exact: true })
  const discoveredLate = page.getByText("失败 · exit 3", { exact: true })
  const openActivity = async (shellCount: number) => {
    await expect(page.locator('[data-message-row="answer-1"]')).toContainText(answers[0])
    const turn = page.locator("[data-turn-toggle]").first()
    await expect(turn).toHaveAccessibleName(new RegExp(`${shellCount} 次工具调用$`))
    if (await turn.getAttribute("aria-expanded") === "false") await turn.click()
    const toggle = page.locator("[data-process-toggle]").first()
    if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click()
  }
  const selectSession = async (name: "A" | "B") => {
    const title = `Synthetic lifecycle ${name}`
    const id = name === "A" ? primary : other
    await revealSidebar(page)
    await page.locator(`[data-sidebar-session="${id}"]`).getByRole("button", { name: title, exact: true }).click()
    await expect(page.getByRole("banner")).toContainText(title)
  }

  await openActivity(2)
  await expect(running).toHaveCount(2)
  expect(f.channels.has(channel)).toBe(true)
  const success = { type: "bash_completed", bash_id: "shell-ok", status: "completed", exit_code: 0 }
  const failure = { type: "bash_completed", bash_id: "shell-failed", status: "error", exit_code: 7 }
  f.emit(success)
  const successNotice = { title: "Background command finished", body: "fixture shell-ok — completed, exit 0" }
  f.emit({ type: "notification", session_id: primary, dedup_key: "bash:shell-ok", ...successNotice })
  await expect(succeeded).toBeVisible()
  await expect(running).toHaveCount(1)

  await selectSession("B")
  expect(f.channels.has(channel)).toBe(true)
  // This completion reaches the shared subscription before the pane discovers
  // the launch in canonical history. The other shell keeps the wire open.
  const lateShell = backgroundShell("shell-late")
  const lateOutcome = { type: "bash_completed", bash_id: lateShell.id, status: "error", exit_code: 3 }
  f.emit(lateOutcome)
  const lateNotice = { title: "Background command failed", body: "fixture shell-late — failed, exit 3" }
  f.emit({ type: "notification", session_id: primary, dedup_key: `bash:${lateShell.id}`, ...lateNotice })
  await expect.poll(messages).toEqual([successNotice, lateNotice])
  f.persistResponse(...history, ...lateShell.history, answer)
  await selectSession("A")
  f.notifyCanonical(`result-${lateShell.id}`)
  await openActivity(3)
  await expect(discoveredLate).toBeVisible()
  await expect(running).toHaveCount(1)
  expect(f.subscriptions).toBe(1)

  await selectSession("B")
  expect(f.channels.has(channel)).toBe(true)
  f.emit(failure)
  const failureNotice = { title: "Background command failed", body: "fixture shell-failed — failed, exit 7" }
  f.emit({ type: "notification", session_id: primary, dedup_key: "bash:shell-failed", ...failureNotice })
  await expect.poll(messages).toEqual([successNotice, lateNotice, failureNotice])
  await expect.poll(() => f.channels.has(channel)).toBe(false)
  await selectSession("A")
  await expectAnswers(page, [answers[0]])
  await openActivity(3)
  await expect(succeeded).toBeVisible()
  await expect(failed).toBeVisible()
  expect(f.subscriptions).toBe(1)

  // Reload opens one observation for unresolved canonical launches. The
  // backend replays the terminal outcomes on the agent channel.
  await page.reload()
  await expect.poll(() => f.subscriptions).toBe(2)
  f.emit(success)
  f.emit(failure)
  f.emit(lateOutcome)
  await expect.poll(() => f.channels.has(channel)).toBe(false)
  await expectAnswers(page, [answers[0]])
  await openActivity(3)
  await expect(succeeded).toBeVisible()
  await expect(failed).toBeVisible()
  await expect(discoveredLate).toBeVisible()
  await expect(running).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("background-shell-outcomes.png"), animations: "disabled" })
  expect(f.executions).toEqual(["synthetic-run-1"])
  expect(f.observation.pageErrors).toEqual([])
})

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
  await page.locator(`[data-sidebar-session="${other}"]`).getByRole("button", { name: "Synthetic lifecycle B", exact: true }).click()
  await expect(page.getByRole("banner")).toContainText("Synthetic lifecycle B")
  await expect(page.getByText(otherAnswer, { exact: true })).toHaveCount(1)
  await expectAnswers(page, [])
  await revealSidebar(page)
  await page.locator(`[data-sidebar-session="${primary}"]`).getByRole("button", { name: "Synthetic lifecycle A", exact: true }).click()
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
