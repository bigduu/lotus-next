import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { expect, test, type Locator, type Page, type TestInfo, type WebSocketRoute } from "@playwright/test"
import { uiEnUs } from "../src/shared/i18n/resources/ui-en-US.js"
import { uiZhCn } from "../src/shared/i18n/resources/ui-zh-CN.js"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const primary = "all-surface-session"
const background = "compression-background-a"
const comparison = "compression-comparison-b"
const at = "2026-10-21T00:00:00Z"
const privateDetail = "synthetic-private-diagnostic-never-render"
type CopyKey = keyof typeof uiEnUs

function session(id: string, title: string, running: boolean) {
  return {
    id, title, title_version: 1, kind: "root", root_session_id: id, parent_session_id: null,
    spawn_depth: 0, pinned: false, created_at: at, updated_at: at, last_activity_at: at,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    message_count: 1, subagent_count: 0, is_running: running,
    last_run_status: running ? "running" : "completed", has_pending_question: false,
    permission_mode: "default", bypass_permissions: false, root_orchestration_only: false,
    thinking_mode: "standard", root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
  }
}

async function prepare(page: Page, info: TestInfo, split = false) {
  const phone = info.project.name === "phone-chromium"
  const locale = phone ? "zh-CN" : "en-US"
  const theme = phone ? "dark" : "light"
  await page.emulateMedia({ colorScheme: theme })
  await page.addInitScript(({ locale, theme }) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", locale)
    localStorage.setItem("copilot_ui_theme_v1", theme)
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  }, { locale, theme })
  const observation = await installArtifactRuntime(page, standaloneScenario, [], { bootstrapRequestState: "local_bypass" })
  const sessions = split ? [
    session(primary, "Compression main", false),
    session(background, "Background compression A", true),
    session(comparison, "Idle comparison B", false),
  ] : [session(primary, "Synthetic context feedback", true)]
  const requests: { method: string; path: string }[] = []
  const clientFrames: Record<string, unknown>[] = []
  const events: { sessionId: string; event: object }[] = []
  const protocolErrors: string[] = []
  const channels = new Set<string>()
  const sequence = new Map<string, number>()
  let feedSequence = 0
  let socket: WebSocketRoute | undefined
  await page.routeWebSocket(/.*/, (ws) => {
    socket = ws
    let welcomed = false
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>
      clientFrames.push(frame)
      if (frame.type === "hello") {
        expect(frame).toEqual({ type: "hello" })
        welcomed = true
        ws.send(JSON.stringify({ type: "welcome" }))
      }
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && typeof frame.ch === "string") {
        if (!welcomed) protocolErrors.push("subscribe before welcome")
        channels.add(frame.ch)
      }
      if (frame.type === "unsubscribe" && typeof frame.ch === "string") channels.delete(frame.ch)
      if (frame.type === "stop") {
        const stopped = sessions.find(({ id }) => id === frame.session_id)
        if (stopped) { stopped.is_running = false; stopped.last_run_status = "completed" }
        // Transport dispatch only: no synthetic summary-cancellation receipt.
      }
    })
  })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    requests.push({ method: request.method(), path })
    if (request.method() !== "GET") {
      await route.fulfill({ status: 501, json: { error: "Unexpected write in synthetic compression fixture" } })
      return
    }
    if (path === "/api/v1/sessions") {
      const selected = url.searchParams.get("kind") === "child" ? [] : sessions
      return route.fulfill({ json: { sessions: selected, total: selected.length, limit: 200, offset: 0 } })
    }
    const selected = sessions.find(({ id }) => path === `/api/v1/sessions/${id}`)
    if (selected) return route.fulfill({ json: { session: selected }, headers: { ETag: '"1"' } })
    const id = sessions.find(({ id }) => [
      `/api/v1/history/${id}`, `/api/v1/task/${id}`, `/api/v1/respond/${id}/pending`, `/api/v1/actors/${id}/snapshot`,
    ].includes(path))?.id
    if (id && path === `/api/v1/history/${id}`) return route.fulfill({ json: { session_id: id, messages: [
      { id: `fixture-history-${id}`, role: "user", content: "Synthetic context feedback acceptance", created_at: at },
    ] } })
    if (id && path === `/api/v1/task/${id}`) return route.fulfill({ json: { session_id: id, items: [] } })
    if (id && path === `/api/v1/respond/${id}/pending`) return route.fulfill({ json: { has_pending_question: false } })
    if (id && path === `/api/v1/actors/${id}/snapshot`) return route.fulfill({ json: actorSnapshotFixture(id, 0) })
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("textbox", { name: phone ? "消息" : "Messages", exact: true }).first()).toBeVisible()
  if (theme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/)
  else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/)
  if (!split) await expect.poll(() => channels.has(`agent.${primary}`)).toBe(true)
  const copy = (key: CopyKey) => phone ? uiZhCn[key] : uiEnUs[key]
  const emit = (event: object, sessionId = primary) => {
    events.push({ sessionId, event })
    const ch = `agent.${sessionId}`, seq = (sequence.get(ch) ?? 0) + 1
    sequence.set(ch, seq)
    socket!.send(JSON.stringify({ ch, seq, event }))
    return seq
  }
  const status = (value: string, sessionId = primary) => emit({ type: "context_compression_status", phase: "preflight", status: value }, sessionId)
  const budget = (percent: number, sessionId = primary) => emit({ type: "token_budget_updated", usage: {
    system_tokens: 10_000, summary_tokens: 0, window_tokens: percent * 10_000 - 10_000,
    total_tokens: percent * 10_000, max_context_tokens: 1_000_000, budget_limit: 950_000,
    truncation_occurred: false, segments_removed: 0,
  } }, sessionId)
  const summary = (sessionId = primary) => emit({
    type: "context_summarized", summary: privateDetail, messages_summarized: 12, tokens_saved: 500_000,
    usage_before_percent: 90, usage_after_percent: 40, trigger_type: "synthetic-only",
  }, sessionId)
  const barrier = async () => {
    await expect.poll(() => channels.has("feed")).toBe(true)
    const seq = ++feedSequence
    socket!.send(JSON.stringify({ ch: "feed", seq, event: {
      seq, ts: at, session_id: primary, event: { type: "task_list_updated", session_id: primary },
    } }))
    // A real consumer cursor proves this later frame was applied, so all prior
    // agent frames on the ordered socket have reached the application's parser.
    await expect.poll(() => page.locator("html").evaluate((element) =>
      element.ownerDocument.defaultView!.localStorage.getItem("lotus_account_feed_cursor_v1"),
    )).toBe(String(seq))
  }
  return { page, info, phone, theme, locale, observation, requests, clientFrames, events, protocolErrors, channels, barrier,
    copy, emit, status, budget, summary,
    notice: page.getByTestId("context-compression-notice"),
  }
}

type Fixture = Awaited<ReturnType<typeof prepare>>
async function expectUsage(f: Fixture, percent: number, within: Page | Locator = f.page) {
  const usage = within.getByRole("button", { name: f.phone ? "上下文用量" : "Context usage", exact: true })
  await expect(usage).toHaveAttribute("title", new RegExp(`\\(${percent}%\\)`))
  return usage
}
async function capture(f: Fixture, name: string) {
  await expect(f.page.locator("body")).not.toContainText(privateDetail)
  await expect.poll(() => f.page.evaluate(() => {
    const viewport = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }
    return viewport.document.documentElement.scrollWidth <= viewport.innerWidth
  })).toBe(true)
  const screenshot = f.info.outputPath(`${name}.png`)
  const bytes = await f.page.screenshot({ path: screenshot, animations: "disabled" })
  await f.info.attach(name, { path: screenshot, contentType: "image/png" })
  await f.info.attach(`${name}-metadata`, { contentType: "application/json", body: JSON.stringify({
    name, fixture: "Built production app; fully intercepted synthetic HTTP and WebSocket events",
    source: JSON.parse(await readFile("dist/lotus-next-manifest.json", "utf8")),
    viewport: f.page.viewportSize(), theme: f.theme, locale: f.locale, mock: true, real_provider_execution: false,
    screenshot_sha256: createHash("sha256").update(bytes).digest("hex"),
  }) })
}
async function verifyIsolation(f: Fixture) {
  expect(f.requests.filter(({ method }) => method !== "GET")).toEqual([])
  expect(f.clientFrames.filter(({ type }) => type === "execute" || type === "chat")).toEqual([])
  expect(f.protocolErrors).toEqual([])
  expect(f.observation.pageErrors).toEqual([])
  expect(f.observation.consoleErrors).toEqual([])
  expect(f.observation.failedRequests).toEqual([])
  expect(f.observation.errorResponses).toEqual([])
  await f.info.attach("synthetic-events-and-network", { contentType: "application/json", body: JSON.stringify({
    requests: f.requests, staticRequests: f.observation.staticUrls, clientFrames: f.clientFrames, events: f.events,
    pageErrors: f.observation.pageErrors, consoleErrors: f.observation.consoleErrors, protocolErrors: f.protocolErrors,
    transport_cross_run_attribution: "unsupported: producer events have no required run/attempt identity",
  }, null, 2) })
}

test("pre-start failure and deferral remain visible without a summary animation", async ({ page }, info) => {
  const f = await prepare(page, info)
  f.budget(94)
  await expectUsage(f, 94)
  await expect(f.notice).toHaveCount(0)
  f.status(`failed_candidate_plan:${privateDetail}`)
  await expect(f.notice).toHaveText(f.copy("context_compression_notice_failed_candidate"))
  await expect(f.notice.locator("svg")).toHaveCount(0)
  f.emit({ type: "token", content: "Synthetic answer continues." })
  await expect(f.notice).toHaveText(f.copy("context_compression_notice_failed_candidate"))
  f.status("deferred_tool_protocol")
  await expect(f.notice).toHaveText(f.copy("context_compression_notice_deferred_tool"))
  f.budget(83)
  await expectUsage(f, 83)
  await expect(f.notice.locator("svg")).toHaveCount(0)
  await capture(f, "pre-start-deferred-with-real-budget")
  await verifyIsolation(f)
})

test("started progress and completion wait for actual whole-prompt budget", async ({ page }, info) => {
  const f = await prepare(page, info)
  f.budget(90)
  f.status("started")
  await expect(f.notice).toHaveText(f.copy("context_compression_notice_running"))
  const spinner = f.notice.locator("svg")
  await expect(spinner).toHaveCSS("animation-name", "spin")
  f.status(`map:1/3 ${privateDetail}`)
  f.emit({ type: "token", content: "Ordinary text does not finish compression." })
  await expect(f.notice).toHaveText(f.copy("context_compression_notice_running"))
  await capture(f, "started-progress")
  f.status("completed")
  f.summary()
  await expect(f.notice).toHaveText(f.copy("context_compression_notice_completed_waiting"))
  await expectUsage(f, 90)
  await expect(f.notice.locator("svg")).toHaveCount(0)
  await capture(f, "completed-waiting-for-prompt-budget")
  f.budget(80)
  await expectUsage(f, 80)
  await expect(f.notice).toHaveText(f.copy("context_compression_notice_completed"))
  f.summary()
  f.status("completed")
  await expect(f.notice).toHaveText(f.copy("context_compression_notice_completed"))
  await expectUsage(f, 80)
  await capture(f, "completed-with-actual-budget")
  await verifyIsolation(f)
})

test("producer cancellation is distinct from a successful summary", async ({ page }, info) => {
  const f = await prepare(page, info)
  f.budget(90)
  f.status("started")
  await expect(f.notice.locator("svg")).toHaveCount(1)
  f.status("cancelled")
  f.summary()
  await expect(f.notice).toHaveText(f.copy("context_compression_notice_cancelled"))
  await expect(f.notice.locator("svg")).toHaveCount(0)
  await expectUsage(f, 90)
  await capture(f, "producer-confirmed-cancellation")
  await verifyIsolation(f)
})

test("local Stop remains unconfirmed and detached late frames cannot overwrite usage", async ({ page }, info) => {
  const f = await prepare(page, info)
  f.budget(90)
  f.status("started")
  await expect(f.notice).toHaveText(f.copy("context_compression_notice_running"))
  await page.getByRole("button", { name: f.phone ? "停止生成" : "Stop generation", exact: true }).click()
  await expect.poll(() => f.clientFrames.some(({ type, session_id }) => type === "stop" && session_id === primary)).toBe(true)
  await expect(f.notice).toHaveText(f.copy("context_compression_notice_unconfirmed"))
  await expect.poll(() => f.channels.has(`agent.${primary}`)).toBe(false)
  f.status("completed")
  f.summary()
  f.budget(40)
  // Confirm delivery through the actual browser socket before checking that a
  // detached subscription ignored it. A new subscription still needs run IDs.
  await f.barrier()
  await expect(f.notice).toHaveText(f.copy("context_compression_notice_unconfirmed"))
  await expectUsage(f, 90)
  await capture(f, "local-stop-ignores-detached-frames")
  await verifyIsolation(f)
})

test("background bound Session continues updating while comparison Session stays isolated", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Bound side-by-side rebind is a desktop acceptance path")
  const f = await prepare(page, info, true)
  await page.getByRole("button", { name: "Open side panel", exact: true }).click()
  const workbench = page.locator("#right-workbench")
  await workbench.getByRole("button", { name: "Side-by-side session Open another session", exact: true }).click()
  await workbench.getByRole("tab", { name: "Side-by-side session", exact: true }).click()
  const picker = workbench.getByRole("combobox").filter({ hasText: /Select a session to compare|Background compression A|Idle comparison B/ })
  await picker.click()
  await page.getByRole("option", { name: "Background compression A", exact: true }).click()
  await expect.poll(() => f.channels.has(`agent.${background}`)).toBe(true)
  f.budget(90, background)
  f.status("started", background)
  await expect(workbench.getByTestId("context-compression-notice")).toHaveText(f.copy("context_compression_notice_running"))
  await expectUsage(f, 90, workbench)
  await picker.click()
  await page.getByRole("option", { name: "Idle comparison B", exact: true }).click()
  await expect(workbench.getByTestId("context-compression-notice")).toHaveCount(0)
  await expect(workbench.getByRole("button", { name: "Context usage", exact: true })).toHaveCount(0)
  expect(f.channels.has(`agent.${background}`)).toBe(true)
  f.status("completed", background)
  f.summary(background)
  f.budget(80, background)
  await f.barrier()
  await expect(workbench.getByTestId("context-compression-notice")).toHaveCount(0)
  await capture(f, "comparison-session-hides-background-feedback")
  await picker.click()
  await page.getByRole("option", { name: "Background compression A", exact: true }).click()
  await expectUsage(f, 80, workbench)
  await expect(workbench.getByTestId("context-compression-notice")).toHaveText(f.copy("context_compression_notice_completed"))
  await capture(f, "background-session-retains-new-budget")
  await verifyIsolation(f)
})
