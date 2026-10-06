import { expect, test, type Locator, type Page, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

test.use({ video: "on" })

const sessionId = "all-surface-session"
const at = "2026-10-06T00:00:00.000Z"
const session = {
  id: sessionId, title: "Process activity acceptance", title_version: 1,
  kind: "root", root_session_id: sessionId, parent_session_id: null,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: at, updated_at: at, last_activity_at: at,
  message_count: 0, is_running: false, last_run_status: "stopped",
  permission_mode: "default", has_pending_question: false,
  spawn_depth: 0, pinned: false, bypass_permissions: false,
  root_orchestration_only: false, thinking_mode: "standard", reasoning_effort: "medium",
  root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
}

async function openProcessFixture(page: Page, messages: readonly unknown[] = [], completed = false) {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario, messages)
  const fixtureSession = { ...session, message_count: messages.length, last_run_status: completed ? "completed" : "stopped" }
  await page.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === "/api/v1/sessions") {
      const children = new URL(route.request().url()).searchParams.get("kind") === "child"
      return route.fulfill({ json: { sessions: children ? [] : [fixtureSession], total: children ? 0 : 1, limit: 200, offset: 0 } })
    }
    if (pathname === `/api/v1/sessions/${sessionId}`) return route.fulfill({ json: { session: fixtureSession }, headers: { ETag: '"1"' } })
    if (pathname === "/api/v1/chat") return route.fulfill({ json: { session_id: sessionId, status: "success" } })
    if (pathname === `/api/v1/execute/${sessionId}`) return route.fulfill({ json: { status: "started", session_id: sessionId } })
    if (pathname === `/api/v1/task/${sessionId}`) return route.fulfill({ json: { session_id: sessionId, items: [] } })
    await route.fallback()
  })
  return observation
}

async function expectFixtureSessionReady(page: Page) {
  // Restore the saved session before typing; a draft belongs to that session,
  // while the initial unsaved composer can already be mounted during boot.
  await expect(page.getByRole("banner")).toContainText("Process activity acceptance")
  await expect(page.getByRole("button", { name: "fixture-model", exact: true })).toBeVisible()
}

async function expandProcessDetails(process: Locator) {
  const toggle = process.locator("[data-process-toggle]")
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click()
  for (const selector of ["[data-reasoning-toggle]", "[data-tool-call-toggle]", "[data-tool-call-entry-toggle]"]) {
    const disclosures = process.locator(selector)
    for (let index = 0; index < await disclosures.count(); index += 1) {
      const disclosure = disclosures.nth(index)
      if (await disclosure.getAttribute("aria-expanded") === "false") await disclosure.click()
    }
  }
}

async function expectThinking(process: Locator, brief: string, reducedMotion: boolean) {
  await expect(process.locator("[data-process-toggle]")).toHaveAccessibleName("思考中…")
  await expect(process.locator("[data-process-brief]")).toHaveText(brief)
  const shimmer = process.locator("[data-process-shimmer]")
  await expect(shimmer).toHaveCount(1)
  await expect(shimmer).toBeVisible()
  if (reducedMotion) {
    const style = await shimmer.evaluate((element) => {
      const computed = element.ownerDocument.defaultView!.getComputedStyle(element)
      return { image: computed.backgroundImage, animation: computed.animationName, color: computed.color }
    })
    expect(style.image).toBe("none")
    expect(style.animation).toBe("none")
    expect(style.color).not.toBe("rgba(0, 0, 0, 0)")
  } else {
    const style = await shimmer.evaluate((element) => {
      const computed = element.ownerDocument.defaultView!.getComputedStyle(element)
      return { image: computed.backgroundImage, animation: computed.animationName, clip: computed.backgroundClip }
    })
    expect(style.image).toContain("linear-gradient")
    expect(style.animation).toBe("process-silver-sweep")
    expect(style.clip).toBe("text")
  }
}

async function expectBodiesOutsideProcesses(transcript: Locator, expected: string[]) {
  const bodies = transcript.locator('[data-message-role="assistant"]')
  await expect(bodies).toHaveCount(expected.length)
  for (let index = 0; index < expected.length; index += 1) {
    await expect(bodies.nth(index)).toBeVisible()
    await expect(bodies.nth(index)).toContainText(expected[index])
    expect(await bodies.nth(index).evaluate((element) => element.closest("[data-process-activity]") === null)).toBe(true)
  }
  const order = await transcript.evaluate((element) => Array.from<{ hasAttribute(name: string): boolean }>(
    element.querySelectorAll('[data-process-activity], [data-message-role="assistant"]'),
  ).map((item) => item.hasAttribute("data-process-activity") ? "process" : "body"))
  expect(order).toEqual(["process", "body", "process", "body"])
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((release) => { resolve = release })
  return { promise, resolve }
}

async function observeSubmittedUser(transcript: Locator, persistedMessageId: string) {
  await transcript.evaluate((element, messageId) => {
    const browser = element.ownerDocument.defaultView!
    const report = { armed: false, samples: 0, violations: [] as string[] }
    // Observe each committed DOM change, including the pending -> durable swap;
    // polling alone could miss a briefly missing or duplicated bubble.
    const sample = () => {
      const current = element.querySelectorAll(
        `[data-pending-user-message], [data-message-row="${messageId}"] [data-message-role="user"]`,
      )
      if (current.length === 1) report.armed = true
      if (report.armed) {
        report.samples += 1
        if (current.length !== 1) report.violations.push(`submitted user count: ${current.length}`)
      }
      for (const toggle of Array.from<{ getAttribute(name: string): string | null }>(element.querySelectorAll("[data-process-toggle]"))) {
        const content = element.ownerDocument.getElementById(toggle.getAttribute("aria-controls") ?? "")
        if (!content?.textContent?.trim()) report.violations.push("empty expandable process")
      }
      element.setAttribute("data-e2e-user-continuity", JSON.stringify(report))
    }
    new browser.MutationObserver(sample).observe(element, { childList: true, characterData: true, subtree: true })
    sample()
  }, persistedMessageId)
}

async function expectSubmittedUser(transcript: Locator, persistedMessageId: string, text: string) {
  const current = transcript.locator(
    `[data-pending-user-message], [data-message-row="${persistedMessageId}"] [data-message-role="user"]`,
  )
  await expect(current).toHaveCount(1)
  await expect(current).toBeVisible()
  await expect(current).toHaveText(text)
  await transcript.evaluate((element) => new Promise<void>((resolve) => {
    const browser = element.ownerDocument.defaultView!
    browser.requestAnimationFrame(() => browser.requestAnimationFrame(() => resolve()))
  }))
  const report = JSON.parse((await transcript.getAttribute("data-e2e-user-continuity"))!) as {
    armed: boolean; samples: number; violations: string[]
  }
  expect(report.armed).toBe(true)
  expect(report.samples).toBeGreaterThan(0)
  expect(report.violations).toEqual([])
}

async function expectStepArchived(process: Locator, reducedMotion: boolean) {
  const handoff = process.locator("[data-process-handoff]")
  if (!reducedMotion) {
    await expect(handoff).toHaveAttribute("aria-hidden", "true")
    await expect(handoff).toBeVisible()
    expect(await handoff.evaluate((element) => element.getAnimations().length)).toBeGreaterThan(0)
  } else {
    // Callers first observe the new step/status, so this is an immediate
    // post-commit assertion rather than a retry that could hide an animation.
    expect(await handoff.count()).toBe(0)
  }
  await expect(handoff).toHaveCount(0)
}

for (const receiptHasMessageId of [true, false]) {
  for (const firstTokenBeforeHistory of [false, true]) {
    test(`submitted user survives a stale history checkpoint ${firstTokenBeforeHistory ? "after" : "before"} the first token ${receiptHasMessageId ? "with a message receipt" : "without a message receipt"}`, async ({ page }) => {
      const prompt = "Repeat this exact request without hiding the new message."
      const admittedId = "newly-admitted-user"
      const admittedAt = "2026-10-06T00:01:00.000Z"
      const oldUser = { id: "older-identical-user", role: "user", content: prompt, created_at: at }
      const olderAnswer = {
        id: "stale-checkpoint-answer", role: "assistant",
        content: "An older completed answer arrives with the stale checkpoint.",
        created_at: "2026-10-06T00:00:01.000Z",
      }
      const staleHistory = [oldUser, olderAnswer]
      const freshHistory = [...staleHistory, { id: admittedId, role: "user", content: prompt, created_at: admittedAt }]
      const observation = await openProcessFixture(page, [oldUser])
      const submissionAck = deferred()
      const staleCheckpoint = deferred()
      let admitted = false
      let committed = false
      let delayedHistoryRequests = 0
      let submissions = 0
      let submission: { message: string; session_id: string } | undefined
      await page.route("**/api/v1/chat", async (route) => {
        submission = route.request().postDataJSON()
        submissions += 1
        await submissionAck.promise
        admitted = true
        await route.fulfill({ json: {
          session_id: sessionId, status: "success",
          ...(receiptHasMessageId ? { message_id: admittedId } : {}),
        } })
      })
      await page.route(`**/api/v1/history/${sessionId}*`, async (route) => {
        if (!admitted) return route.fulfill({ json: { session_id: sessionId, messages: [oldUser] } })
        if (committed) return route.fulfill({ json: { session_id: sessionId, messages: freshHistory } })
        delayedHistoryRequests += 1
        await staleCheckpoint.promise
        return route.fulfill({ json: { session_id: sessionId, messages: staleHistory } })
      })
      let socket: WebSocketRoute | undefined
      let subscriptions = 0
      let sequence = 0
      await page.routeWebSocket(/.*/, (webSocket) => {
        socket = webSocket
        webSocket.onMessage((raw) => {
          const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
          if (frame.type === "hello") webSocket.send(JSON.stringify({ type: "welcome" }))
          if (frame.type === "ping") webSocket.send(JSON.stringify({ type: "pong" }))
          if (frame.type === "subscribe" && frame.ch === `agent.${sessionId}`) subscriptions += 1
        })
      })
      const emit = (event: Record<string, unknown>) => socket!.send(JSON.stringify({ ch: `agent.${sessionId}`, seq: ++sequence, event }))

      await page.goto(standaloneScenario.entryUrl)
      const transcript = page.locator("[data-message-list-content]").first()
      await expect(transcript.locator('[data-message-row="older-identical-user"]')).toContainText(prompt)
      await observeSubmittedUser(transcript, admittedId)
      await page.getByRole("textbox", { name: "消息", exact: true }).fill(prompt)
      await page.getByRole("button", { name: "发送消息", exact: true }).click()
      await expect.poll(() => submissions).toBe(1)
      expect(submission).toMatchObject({ message: prompt, session_id: sessionId })
      submissionAck.resolve()
      await expect.poll(() => subscriptions).toBe(1)
      await expect.poll(() => delayedHistoryRequests).toBeGreaterThan(0)
      await expectSubmittedUser(transcript, admittedId, prompt)
      await expect(transcript.locator("[data-process-toggle], [data-process-content]")).toHaveCount(0)
      await expect(transcript.locator("[data-process-shimmer]")).toHaveText("思考中…")

      emit({ type: "execution_started", run_id: "fixture-admitted-run", started_at: admittedAt })
      emit({ type: "context_compression_status", phase: "before_execute", status: "started" })
      const status = transcript.locator("[data-process-status]")
      await expect(status).toHaveText("正在压缩上下文…")
      await expect(status).toHaveAttribute("role", "status")
      await expect(transcript.locator("[data-process-toggle], [data-process-content]")).toHaveCount(0)
      await expectSubmittedUser(transcript, admittedId, prompt)
      emit({ type: "context_compression_status", phase: "before_execute", status: "completed" })
      await expect(status).toHaveText("思考中…")
      await expect(transcript.locator("[data-process-toggle], [data-process-content]")).toHaveCount(0)

      const firstBody = "The live answer remains visible during user-message hydration."
      if (firstTokenBeforeHistory) {
        emit({ type: "token", content: firstBody })
        await expect(transcript.locator('[data-message-role="assistant"]')).toContainText(firstBody)
        await expectSubmittedUser(transcript, admittedId, prompt)
      }
      staleCheckpoint.resolve()
      // This extra older assistant row proves the stale response was applied;
      // an identical prompt already in history is not proof of this admission.
      await expect(transcript.locator('[data-message-row="stale-checkpoint-answer"]')).toContainText(olderAnswer.content)
      await expect(transcript.locator("[data-pending-user-message]")).toHaveCount(1)
      await expectSubmittedUser(transcript, admittedId, prompt)
      await expect(transcript.locator('[data-message-role="user"]').filter({ hasText: prompt })).toHaveCount(2)
      await expect(transcript.locator("[data-process-toggle], [data-process-content]")).toHaveCount(0)
      if (!firstTokenBeforeHistory) {
        emit({ type: "token", content: firstBody })
        await expect(transcript.locator('[data-message-role="assistant"]').last()).toContainText(firstBody)
        await expectSubmittedUser(transcript, admittedId, prompt)
      }

      committed = true
      emit({ type: "message_appended", session_id: sessionId, message_id: admittedId, role: "user", created_at: admittedAt })
      await expect(transcript.locator(`[data-message-row="${admittedId}"]`)).toContainText(prompt)
      await expect(transcript.locator("[data-pending-user-message]")).toHaveCount(0)
      await expectSubmittedUser(transcript, admittedId, prompt)
      await expect(transcript.locator('[data-message-role="user"]').filter({ hasText: prompt })).toHaveCount(2)
      await expect(transcript.locator('[data-message-role="assistant"]').last()).toContainText(firstBody)

      emit({ type: "reasoning_token", content: "A real reasoning detail makes the later activity inspectable." })
      const process = transcript.locator("[data-process-activity]")
      await expect(process).toHaveCount(1)
      await expect(process.locator("[data-process-toggle]")).toHaveCount(1)
      await expandProcessDetails(process)
      await expect(process.getByRole("region", { name: "思考过程", exact: true })).toContainText("A real reasoning detail")
      await expectSubmittedUser(transcript, admittedId, prompt)
      expect(submissions).toBe(1)
      expect(subscriptions).toBe(1)
      expect(observation.pageErrors).toEqual([])
      expect(observation.consoleErrors).toEqual([])
    })
  }
}

for (const reducedMotion of [false, true]) {
  test(`running tool previews settle into inspectable activity${reducedMotion ? " with reduced motion" : ""}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" })
    const observation = await openProcessFixture(page)
    let socket: WebSocketRoute | undefined
    let subscriptions = 0
    let sequence = 0
    await page.routeWebSocket(/.*/, (webSocket) => {
      socket = webSocket
      webSocket.onMessage((raw) => {
        const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
        if (frame.type === "hello") webSocket.send(JSON.stringify({ type: "welcome" }))
        if (frame.type === "ping") webSocket.send(JSON.stringify({ type: "pong" }))
        if (frame.type === "subscribe" && frame.ch === `agent.${sessionId}`) subscriptions += 1
      })
    })
    const emit = (event: Record<string, unknown>) => socket!.send(JSON.stringify({ ch: `agent.${sessionId}`, seq: ++sequence, event }))
    const startTool = (id: string, name: string, args: Record<string, unknown>) => emit({ type: "tool_start", tool_call_id: id, tool_name: name, arguments: args })
    const finishTool = (id: string, result: string) => emit({ type: "tool_complete", tool_call_id: id, result: { success: true, result } })

    await page.goto(standaloneScenario.entryUrl)
    await expectFixtureSessionReady(page)
    await page.getByRole("textbox", { name: "消息", exact: true }).fill("Read the file, then run and search while keeping the process simple.")
    await page.getByRole("button", { name: "发送消息", exact: true }).click()
    await expect.poll(() => subscriptions).toBe(1)
    const transcript = page.locator("[data-message-list-content]").first()
    const process = transcript.locator("[data-process-activity]")
    await expect(process).toHaveCount(1)
    await expect(process.locator("[data-process-status]")).toHaveAttribute("role", "status")
    await expect(process.locator("[data-process-shimmer]")).toHaveText("思考中…")
    await expect(process.locator("[data-process-toggle], [data-process-content]")).toHaveCount(0)

    startTool("progressive-read", "Read", { file_path: "/tmp/progressive-file.md" })
    const toggle = process.locator("[data-process-toggle]")
    const current = process.locator("[data-process-current]")
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(current.locator("[data-tool-call-preview]")).toBeVisible()
    await expect(current).toContainText("progressive-file.md")
    await expect(current.locator("button")).toHaveCount(0)
    await expect(process.locator("[data-process-shimmer]")).toHaveCount(0)
    const contentId = await toggle.getAttribute("aria-controls")
    if (!reducedMotion && testInfo.project.name === "desktop-chromium") {
      // Keep the foreground step readable in the requested demonstration video.
      await page.waitForTimeout(900)
      const screenshotPath = testInfo.outputPath("process-current-step.png")
      await page.screenshot({ path: screenshotPath })
      await testInfo.attach("Foreground file-reading preview (WebSocket fixture)", { path: screenshotPath, contentType: "image/png" })
    }
    finishTool("progressive-read", "The original file contents remain in the folded process.")
    await expect(toggle).toHaveAccessibleName("思考中…")
    await expectStepArchived(process, reducedMotion)
    await expect(current).toHaveCount(0)
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expectThinking(process, "思考中…", reducedMotion)
    await toggle.click()
    await expect(process.locator("[data-tool-call-toggle], [data-tool-call-entry-toggle]")).toHaveCount(0)
    await expect(process.locator("[data-tool-call-entry-detail]")).toBeVisible()
    await expect(process.locator("[data-tool-call-entry-detail]")).toContainText("The original file contents")
    await toggle.click()

    startTool("progressive-bash", "Bash", { command: "printf 'progressive-demo'" })
    await expect(current).toBeVisible()
    await expect(current).toContainText("progressive-demo")
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(process.locator("[data-process-shimmer]")).toHaveCount(0)
    // A newer tool becomes the foreground step even before the previous tool's
    // completion arrives. Its later result must remain in the same process.
    startTool("progressive-grep", "Grep", { pattern: "needle", path: "/tmp/progressive-file.md" })
    await expect(current).toContainText("needle")
    await expectStepArchived(process, reducedMotion)
    await expect(current).toContainText("needle")
    finishTool("progressive-bash", "The delayed command result remains inspectable.")
    await expect(current).toContainText("needle")
    await expect(process.locator("[data-process-shimmer]")).toHaveCount(0)
    emit({ type: "reasoning_token", content: "A real thought arrives while the final search is still running.\n" })
    await expect(current).toContainText("needle")
    await expect(process.locator("[data-process-shimmer]")).toHaveCount(0)
    finishTool("progressive-grep", "The search result remains inspectable after handoff.")
    await expect(toggle).toHaveAccessibleName("思考中…")
    if (!reducedMotion) {
      const completedPreview = process.locator("[data-process-handoff]")
      await expect(completedPreview).toContainText("needle")
      // The snapshot reflects completion, even when a reasoning part follows
      // the tools in the live history; it must not keep a stale running badge.
      expect(await completedPreview.innerText()).not.toContain("运行中…")
    }
    await expectStepArchived(process, reducedMotion)
    await expect(current).toHaveCount(0)
    await expect(toggle).toHaveAttribute("aria-controls", contentId!)
    const reasoning = "The latest real thought remains readable after every tool is folded."
    emit({ type: "reasoning_token", content: reasoning })
    await expectThinking(process, reasoning, reducedMotion)
    if (!reducedMotion && testInfo.project.name === "desktop-chromium") {
      const screenshotPath = testInfo.outputPath("process-thinking-after-handoff.png")
      await page.screenshot({ path: screenshotPath })
      await testInfo.attach("Thinking after tool handoff (WebSocket fixture)", { path: screenshotPath, contentType: "image/png" })
      await page.waitForTimeout(2400)
    }
    await expandProcessDetails(process)
    await expect(process.locator("[data-tool-call-toggle]")).toHaveCount(0)
    await expect(process.locator("[data-tool-call-entry-detail]")).toHaveCount(3)
    await expect(process.locator("[data-tool-call-entry-detail]").nth(0)).toContainText("The original file contents")
    await expect(process.locator("[data-tool-call-entry-detail]").nth(1)).toContainText("The delayed command result")
    await expect(process.locator("[data-tool-call-entry-detail]").nth(2)).toContainText("The search result")
    await expect(process.getByRole("region", { name: "思考过程", exact: true })).toContainText(reasoning)
    await toggle.click()
    emit({ type: "token", content: "The assistant answer stays visible after the progressive process." })
    await expect(transcript.locator('[data-message-role="assistant"]')).toContainText("The assistant answer stays visible")
    await expect(transcript.locator("[data-process-shimmer], [data-process-current], [data-process-handoff]")).toHaveCount(0)
    expect(subscriptions).toBe(1)
    expect(observation.pageErrors).toEqual([])
    expect(observation.consoleErrors).toEqual([])
  })
}

for (const reducedMotion of [false, true]) {
  test(`streamed tools and reasoning share stable activity boundaries${reducedMotion ? " with reduced motion" : ""}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" })
    const observation = await openProcessFixture(page)
    let socket: WebSocketRoute | undefined
    let subscriptions = 0
    let sequence = 0
    await page.routeWebSocket(/.*/, (webSocket) => {
      socket = webSocket
      webSocket.onMessage((raw) => {
        const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
        if (frame.type === "hello") webSocket.send(JSON.stringify({ type: "welcome" }))
        if (frame.type === "ping") webSocket.send(JSON.stringify({ type: "pong" }))
        if (frame.type === "subscribe" && frame.ch === `agent.${sessionId}`) subscriptions += 1
      })
    })
    const emit = (event: Record<string, unknown>) => {
      socket!.send(JSON.stringify({ ch: `agent.${sessionId}`, seq: ++sequence, event }))
    }
    const startTool = (id: string, name: string, args: Record<string, unknown>) => emit({ type: "tool_start", tool_call_id: id, tool_name: name, arguments: args })
    const finishTool = (id: string, result: string) => emit({ type: "tool_complete", tool_call_id: id, result: { success: true, result } })

    await page.goto(standaloneScenario.entryUrl)
    await expectFixtureSessionReady(page)
    const input = page.getByRole("textbox", { name: "消息", exact: true })
    await expect(input).toBeVisible()
    await input.fill("Inspect the two tool rounds and explain the result.")
    await page.getByRole("button", { name: "发送消息", exact: true }).click()
    await expect.poll(() => subscriptions).toBe(1)
    const transcript = page.locator("[data-message-list-content]").first()
    const processes = transcript.locator("[data-process-activity]")
    const first = processes.first()
    const firstToggle = first.locator("[data-process-toggle]")

    startTool("live-read", "Read", { file_path: "/tmp/process.md" })
    await expect(processes).toHaveCount(1)
    await expect(firstToggle).toHaveAttribute("aria-expanded", "false")
    await expect(firstToggle).toHaveAccessibleName("处理过程")
    await expect(first.locator("[data-process-brief]")).toHaveText("1 次工具调用")
    await expect(first.locator("[data-process-current]")).toContainText("process.md")
    await expect(first.locator("[data-process-shimmer]")).toHaveCount(0)
    const firstContentId = await firstToggle.getAttribute("aria-controls")
    finishTool("live-read", "First tool result is preserved.")
    const firstReasoning = "## Initial analysis\n**First** real reasoning checkpoint."
    emit({ type: "reasoning_token", content: firstReasoning })
    await expectThinking(first, "First real reasoning checkpoint.", reducedMotion)
    await expandProcessDetails(first)
    await expect(first.getByRole("region", { name: "思考过程", exact: true })).toHaveText(firstReasoning)
    await expect(first.locator("[data-tool-call-entry-detail]")).toContainText("First tool result is preserved.")

    startTool("live-grep", "Grep", { pattern: "process", path: "/tmp/process.md" })
    await expect(processes).toHaveCount(1)
    await expect(firstToggle).toHaveAccessibleName("处理过程")
    await expect(firstToggle).toHaveAttribute("aria-expanded", "true")
    await expect(firstToggle).toHaveAttribute("aria-controls", firstContentId!)
    await expect(first.locator("[data-process-shimmer]")).toHaveCount(0)
    await expect(first.locator("[data-process-brief]")).toHaveText("2 次工具调用")
    finishTool("live-grep", "Second tool result is preserved.")
    const secondReasoning = "## Latest check\n**Second** real reasoning checkpoint."
    emit({ type: "reasoning_token", content: secondReasoning })
    await expectThinking(first, "Second real reasoning checkpoint.", reducedMotion)
    await expect(processes).toHaveCount(1)
    await expandProcessDetails(first)
    await expect(first.locator("[data-reasoning-toggle]")).toHaveCount(2)
    await expect(first.getByRole("region", { name: "思考过程", exact: true }).nth(1)).toHaveText(secondReasoning)
    await expect(first.locator("[data-tool-call-entry-detail]").nth(1)).toContainText("Second tool result is preserved.")
    await expect(first.getByRole("region", { name: "思考过程", exact: true }).first()).toHaveText(firstReasoning)
    if (!reducedMotion && testInfo.project.name === "desktop-chromium") {
      // Deliberately record one full sweep, with the stable real reasoning
      // excerpt visible; this pause is visual evidence, not synchronization.
      await testInfo.attach("Active reasoning text shimmer (WebSocket fixture)", { body: await page.screenshot(), contentType: "image/png" })
      await page.waitForTimeout(2400)
    }

    const firstBody = "Visible assistant body before the next tool round."
    emit({ type: "token", content: `${firstBody}\n\n` })
    await expect(transcript.locator('[data-message-role="assistant"]')).toContainText(firstBody)
    await expect(processes).toHaveCount(1)
    await expect(first.locator("[data-process-shimmer]")).toHaveCount(0)
    await expect(firstToggle).toHaveAttribute("aria-expanded", "true")

    startTool("live-bash", "Bash", { command: "printf 'verification'" })
    await expect(processes).toHaveCount(2)
    const second = processes.nth(1)
    const secondToggle = second.locator("[data-process-toggle]")
    await expect(secondToggle).toHaveAttribute("aria-expanded", "false")
    await expect(second.locator("[data-process-shimmer]")).toHaveCount(0)
    finishTool("live-bash", "Third tool result is preserved.")
    const thirdReasoning = "## After the visible body\n**Third** real reasoning checkpoint."
    emit({ type: "reasoning_token", content: thirdReasoning })
    await expectThinking(second, "Third real reasoning checkpoint.", reducedMotion)
    await expect(first.locator("[data-process-shimmer]")).toHaveCount(0)
    await expandProcessDetails(second)
    await expect(second.getByRole("region", { name: "思考过程", exact: true })).toHaveText(thirdReasoning)
    await expect(second.locator("[data-tool-call-entry-detail]")).toContainText("Third tool result is preserved.")
    await firstToggle.click()
    await secondToggle.click()
    const secondContentId = await secondToggle.getAttribute("aria-controls")
    expect(secondContentId).not.toBe(firstContentId)
    const compactHeight = (await secondToggle.boundingBox())!.height
    // Several real tokens update the same summary without reopening or
    // remounting either activity; the newest complete sentence is visible.
    for (const content of ["\nEarlier streaming thought.", "\nLatest ", "streamed ", "checkpoint."]) {
      emit({ type: "reasoning_token", content })
    }
    await expectThinking(second, "Latest streamed checkpoint.", reducedMotion)
    await expect(processes).toHaveCount(2)
    await expect(firstToggle).toHaveAttribute("aria-expanded", "false")
    await expect(secondToggle).toHaveAttribute("aria-expanded", "false")
    await expect(firstToggle).toHaveAttribute("aria-controls", firstContentId!)
    await expect(secondToggle).toHaveAttribute("aria-controls", secondContentId!)
    expect((await secondToggle.boundingBox())!.height).toBe(compactHeight)
    // Hidden details remain mounted, retaining the user's previous inspection.
    await secondToggle.click()
    await expect(second.getByRole("region", { name: "思考过程", exact: true })).toContainText("Latest streamed checkpoint.")
    await expect(second.locator("[data-tool-call-entry-detail]")).toContainText("Third tool result is preserved.")
    await secondToggle.click()
    const secondBody = "Visible assistant body after the next tool round."
    emit({ type: "token", content: secondBody })
    await expect(transcript.locator('[data-message-role="assistant"]').nth(1)).toContainText(secondBody)
    await expect(transcript.locator("[data-process-shimmer]")).toHaveCount(0)
    await expectBodiesOutsideProcesses(transcript, [firstBody, secondBody])
    expect(subscriptions).toBe(1)
    expect(observation.pageErrors).toEqual([])
    expect(observation.consoleErrors).toEqual([])
    await testInfo.attach("Continuous activity with visible body boundaries", { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" })
  })
}

test("completed history merges tools and reasoning while preserving each assistant body", async ({ page }) => {
  const firstReasoning = "Saved initial reasoning remains complete."
  const secondReasoning = "Saved latest reasoning remains complete."
  const thirdReasoning = "Saved reasoning after the body remains complete."
  const firstBody = "Saved assistant body separates the two activities."
  const secondBody = "Saved final assistant body remains visible."
  const call = (id: string, name: string) => ({
    id: `${id}-message`, role: "assistant", content: "", created_at: at,
    tool_calls: [{ id, function: { name, arguments: JSON.stringify({ file_path: `/tmp/${id}.md` }) } }],
  })
  const result = (id: string, content: string) => ({ id: `${id}-result`, role: "tool", tool_call_id: id, content, created_at: at })
  const thought = (id: string, reasoning: string) => ({ id, role: "assistant", content: "", reasoning, metadata: { reasoning }, created_at: at })
  const history = [
    { id: "saved-user", role: "user", content: "Keep the process together until a visible answer.", created_at: at },
    call("saved-read", "Read"), result("saved-read", "Saved first tool result."), thought("saved-thought-one", firstReasoning),
    call("saved-grep", "Grep"), result("saved-grep", "Saved second tool result."), thought("saved-thought-two", secondReasoning),
    { id: "saved-body-one", role: "assistant", content: firstBody, created_at: at },
    call("saved-check", "Read"), result("saved-check", "Saved third tool result."), thought("saved-thought-three", thirdReasoning),
    { id: "saved-body-two", role: "assistant", content: secondBody, created_at: at },
  ]
  const observation = await openProcessFixture(page, history, true)
  await page.goto(standaloneScenario.entryUrl)
  const transcript = page.locator("[data-message-list-content]").first()
  const processes = transcript.locator("[data-process-activity]")
  await expect(processes).toHaveCount(2)
  for (let index = 0; index < 2; index += 1) {
    await expect(processes.nth(index).locator("[data-process-toggle]")).toHaveAccessibleName("处理过程")
    await expect(processes.nth(index).locator("[data-process-toggle]")).toHaveAttribute("aria-expanded", "false")
  }
  await expect(processes.first().locator("[data-process-brief]")).toHaveText(secondReasoning)
  await expect(processes.nth(1).locator("[data-process-brief]")).toHaveText(thirdReasoning)
  await expect(transcript.locator("[data-process-shimmer]")).toHaveCount(0)
  await expectBodiesOutsideProcesses(transcript, [firstBody, secondBody])
  await expandProcessDetails(processes.first())
  const firstThoughts = processes.first().getByRole("region", { name: "思考过程", exact: true })
  await expect(firstThoughts).toHaveCount(2)
  await expect(firstThoughts.nth(0)).toHaveText(firstReasoning)
  await expect(firstThoughts.nth(1)).toHaveText(secondReasoning)
  await expect(processes.first().locator("[data-tool-call-entry-detail]").nth(0)).toContainText("Saved first tool result.")
  await expect(processes.first().locator("[data-tool-call-entry-detail]").nth(1)).toContainText("Saved second tool result.")
  await expandProcessDetails(processes.nth(1))
  await expect(processes.nth(1).getByRole("region", { name: "思考过程", exact: true })).toHaveText(thirdReasoning)
  await expect(processes.nth(1).locator("[data-tool-call-entry-detail]")).toContainText("Saved third tool result.")
  await expectBodiesOutsideProcesses(transcript, [firstBody, secondBody])
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
})

test("a saved single-tool activity reveals its raw result with one disclosure", async ({ page }, testInfo) => {
  const result = "Original file contents are directly inspectable after opening the process."
  const answer = "The final assistant answer stays outside the single-tool activity."
  const history = [
    { id: "single-tool-user", role: "user", content: "Read the file and explain it.", created_at: at },
    {
      id: "single-tool-call", role: "assistant", content: "", created_at: at,
      tool_calls: [{ id: "single-read", function: { name: "Read", arguments: JSON.stringify({ file_path: "/tmp/single-read.md" }) } }],
    },
    { id: "single-tool-result", role: "tool", tool_call_id: "single-read", content: result, created_at: at },
    { id: "single-tool-answer", role: "assistant", content: answer, created_at: at },
  ]
  const observation = await openProcessFixture(page, history, true)
  await page.goto(standaloneScenario.entryUrl)
  const transcript = page.locator("[data-message-list-content]").first()
  const process = transcript.locator("[data-process-activity]")
  await expect(process).toHaveCount(1)
  const toggle = process.locator("[data-process-toggle]")
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await toggle.click()
  await expect(process.locator("[data-tool-call-toggle], [data-tool-call-entry-toggle]")).toHaveCount(0)
  await expect(process.locator("[data-tool-call-entry-detail]")).toBeVisible()
  await expect(process.locator("[data-tool-call-entry-detail]")).toContainText(result)
  await expect(transcript.locator('[data-message-role="assistant"]')).toBeVisible()
  await expect(transcript.locator('[data-message-role="assistant"]')).toContainText(answer)
  expect(await transcript.locator('[data-message-role="assistant"]').evaluate((element) => element.closest("[data-process-activity]") === null)).toBe(true)
  const screenshotPath = testInfo.outputPath("process-single-tool.png")
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach("Single-tool details after one disclosure", { path: screenshotPath, contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
})
