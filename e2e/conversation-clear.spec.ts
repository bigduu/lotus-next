import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { selectSettingsCategory, settingsSurface } from "./support/settingsNavigation.js"

const ordinary = "all-surface-session", supervisor = "bamboo-default-supervisor"
const stamp = "2026-10-22T00:00:00Z"
type Failure = "blocked" | "unknown" | "readback" | "running" | "pending" | null
async function fixture(page: Page, failure: Failure = null, setup?: () => Promise<void>, initialCount = 1,
  supervisorSnapshot = actorSnapshotFixture(supervisor, 0),
) {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    if (!localStorage.getItem("lotus_next_last_session")) localStorage.setItem("lotus_next_last_session", id)
  }, ordinary)
  const runtime = await installArtifactRuntime(page, standaloneScenario)
  const writes: { method: string; path: string }[] = []
  const cleared = new Set<string>()
  let failReadback = failure === "readback"
  let pendingEnabled = false
  let running = failure === "running"
  const newMessages: object[] = []
  const session = (id: string) => ({ id, kind: "root", title: id === supervisor ? "Supervisor" : "Clear fixture",
    title_version: 1, pinned: false, root_session_id: id, parent_session_id: null, spawn_depth: 0,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: stamp, updated_at: stamp, last_activity_at: stamp, message_count: cleared.has(id) ? newMessages.length : initialCount,
    has_attachments: false, is_running: running, has_pending_question: pendingEnabled,
    root_orchestration_only: id === supervisor, thinking_mode: id === supervisor ? "ultra" : "standard", root_mode_transition_epoch: 0,
    root_mode_birth_token: "a".repeat(64), permission_mode: "default", bypass_permissions: false,
    subagent_count: id === supervisor ? supervisorSnapshot.nodes.length - 1 : 0,
    running_child_count: 0, placement: { kind: "local", host: "synthetic" } })
  const children = supervisorSnapshot.nodes.slice(1).map((node) => ({
    ...session(node.actor_id), title: node.title, kind: node.role,
    root_session_id: supervisor, parent_session_id: node.parent_actor_id, spawn_depth: node.depth,
    created_at: "2026-10-22T00:00:01Z",
  }))
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method()
    if (method !== "GET") writes.push({ method, path })
    if (path === "/api/v1/sessions" && method === "GET") {
      const sessions = url.searchParams.get("kind") === "child"
        ? children.filter((child) => child.root_session_id === url.searchParams.get("root_session_id"))
        : [session(ordinary), session(supervisor)]
      return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
    }
    if (children.length > 0 && path === "/api/v1/supervisor/default" && method === "POST") {
      return route.fulfill({ json: { session_id: supervisor, incarnation_id: "550e8400-e29b-41d4-a716-446655440000", created: false } })
    }
    if (children.length > 0 && path === "/api/v1/supervisor/default/approvals" && method === "GET") {
      return route.fulfill({ json: { approvals: [] } })
    }
    if (children.length > 0 && path === "/api/v1/chat" && method === "POST") {
      const input = request.postDataJSON()
      expect(input.session_id).toBe(supervisor)
      expect(cleared.has(supervisor)).toBe(true)
      const messageId = "retained-next-turn"
      newMessages.push({ id: messageId, role: "user", content: input.message, created_at: "2026-10-22T00:00:02Z" })
      return route.fulfill({ status: 201, json: { session_id: supervisor, message_id: messageId, status: "success" } })
    }
    if (children.length > 0 && path === `/api/v1/execute/${supervisor}` && method === "POST") {
      return route.fulfill({ json: { session_id: supervisor, status: "started" } })
    }
    for (const id of [ordinary, supervisor]) {
      if (path === `/api/v1/sessions/${id}` && method === "GET") return route.fulfill({ json: { session: session(id) }, headers: { ETag: '"1"' } })
      if (path === `/api/v1/actors/${id}/snapshot`) {
        return route.fulfill({ json: id === supervisor ? supervisorSnapshot : actorSnapshotFixture(id, 0) })
      }
      if (path === `/api/v1/respond/${id}/pending`) return route.fulfill({ json: pendingEnabled
        ? { has_pending_question: true, interaction_kind: "clarification", question: "Synthetic pending question", options: ["A"], allow_custom: true, tool_call_id: "fixture-pending" }
        : { has_pending_question: false } })
      if (children.length > 0 && id === supervisor && path === `/api/v1/task/${id}` && method === "GET") {
        return route.fulfill({ json: { session_id: id, items: [] } })
      }
      if (path === `/api/v1/history/${id}`) {
        if (cleared.has(id) && failReadback) return route.fulfill({ status: 403, json: { error: "Synthetic readback unavailable" } })
        return route.fulfill({ json: { session_id: id, messages: cleared.has(id) ? newMessages : Array.from({ length: initialCount }, (_, n) => (
          { id: `old-${id}-${n}`, role: "user", content: n ? `Deleted old message ${n}` : `Synthetic history ${id}`, created_at: stamp }
        )) } })
      }
      if (path === `/api/v1/sessions/${id}/clear` && method === "POST") {
        expect(request.postData()).toBeNull()
        if (failure === "blocked") return route.fulfill({ status: 409, json: {
          error: { type: "api_error", code: "session_clear_authority_conflict", message: "Synthetic refusal" },
          session_id: id, status: "blocked", refresh_required: true, retryable: false,
        } })
        cleared.add(id)
        if (failure === "unknown") return route.fulfill({ status: 500, json: {
          error: { type: "api_error", code: "session_clear_outcome_unknown", message: "Synthetic unknown outcome" },
          session_id: id, status: "outcome_unknown", refresh_required: true, retryable: false,
        } })
        return route.fulfill({ json: { success: true, session_id: id } })
      }
    }
    return route.fallback()
  })
  await setup?.()
  await page.goto(standaloneScenario.entryUrl)
  return { runtime, writes, allowReadback() { failReadback = false }, enablePending() { pendingEnabled = true },
    clearFromOtherClient() { cleared.add(ordinary); running = false },
    appendAfterClear() { newMessages.push({ id: "new-conversation", role: "user", content: "Synthetic new conversation after clear", created_at: stamp }) } }
}

async function streamFixture(page: Page, failure: Failure = null, initialCount = 1) {
  let socket: WebSocketRoute | undefined
  const channels = new Set<string>()
  const f = await fixture(page, failure, async () => page.routeWebSocket(/.*/, (ws) => {
    socket = ws
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
      if (frame.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch) channels.add(frame.ch)
    })
  }), initialCount)
  await expect.poll(() => channels.has("feed")).toBe(true)
  return { ...f, channels,
    agent(event: object) { socket!.send(JSON.stringify({ ch: `agent.${ordinary}`, seq: 1, event })) },
    feed(type: string, seq: number) { socket!.send(JSON.stringify({ ch: "feed", seq, event: {
      seq, ts: stamp, session_id: ordinary, event: { type, session_id: ordinary },
    } })) },
  }
}
async function openHeader(page: Page) {
  await page.locator("header").getByRole("button", { name: "更多", exact: true }).click()
  await page.getByRole("menuitem", { name: "清除会话消息", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "清除这个会话的消息？", exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
async function openSupervisor(page: Page, phone: boolean) {
  if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
  const row = page.locator("aside").first().getByRole("button", { name: /^Supervisor/ }).locator("..")
  await row.getByRole("button", { name: "会话操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "清除会话消息", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "清除这个会话的消息？", exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
test("ordinary and Supervisor expose the same confirmation; cancelling preserves both synthetic histories", async ({ page }, info) => {
  const f = await fixture(page), first = await openHeader(page)
  await expect(first).toContainText(ordinary)
  await expect(first).toContainText("保留首条系统消息、会话身份、Project 范围、管理关系、独立会话和未完成任务")
  await first.getByRole("button", { name: "取消", exact: true }).click()
  await expect(first).toBeHidden()
  const dialog = await openSupervisor(page, info.project.name === "phone-chromium")
  await expect(dialog).toContainText(supervisor)
  await expect(dialog).toContainText("当前服务不确认原生/provider 上下文已完整重置")
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: info.outputPath("conversation-clear-confirm.png"), animations: "disabled" })
  await dialog.press("Escape"); await expect(dialog).toBeHidden()
  expect(f.writes).toEqual([])
  expect(f.runtime.pageErrors).toEqual([])
})
test("ordinary clear waits for exact receipt and readback, preserving the independent Supervisor", async ({ page }) => {
  const f = await fixture(page), dialog = await openHeader(page)
  await dialog.getByRole("button", { name: "清除会话消息", exact: true }).click()
  await expect(dialog.getByRole("status")).toContainText("服务已确认清理，并已读回核对")
  expect(f.writes).toEqual([{ method: "POST", path: `/api/v1/sessions/${ordinary}/clear` }])
  await dialog.getByRole("button", { name: "关闭", exact: true }).last().click()
  await expect(page.getByText(`Synthetic history ${ordinary}`, { exact: true })).toBeHidden()
  const transcript = page.locator("[data-message-list-content]")
  await expect(transcript.getByText("开始一段新对话", { exact: true })).toBeVisible()
  await expect(transcript.locator("[data-cleared-subagents]")).toHaveCount(0)
  expect(f.runtime.pageErrors).toEqual([])
})
test("Supervisor keeps retained children folded after sending and reloading", async ({ page }, info) => {
  const snapshot = actorSnapshotFixture(supervisor, 1)
  Object.assign(snapshot.nodes[1], { title: "Retained child", logical_state: null, placement_class: null, activation: null })
  const f = await fixture(page, null, undefined, 1, snapshot)
  if (info.project.name === "phone-chromium") await page.getByRole("button", { name: "菜单", exact: true }).click()
  await page.locator("aside").first().getByRole("button", { name: /^Supervisor/ }).click()
  const history = page.getByText(`Synthetic history ${supervisor}`, { exact: true })
  const child = page.locator('[data-subagent-id="actor-0"]')
  const fold = page.locator("[data-cleared-subagents-toggle]")
  const startPrompt = page.locator("[data-message-list-content]").getByText("开始一段新对话", { exact: true })
  await expect(history).toBeVisible()
  await expect(startPrompt).toHaveCount(0)
  await expect(child).toBeVisible()
  await expect(child).toHaveAttribute("data-subagent-status", "unknown")

  const dialog = await openHeader(page)
  await dialog.getByRole("button", { name: "清除会话消息", exact: true }).click()
  await expect(dialog.getByRole("status")).toContainText("服务已确认清理，并已读回核对")
  await dialog.getByRole("button", { name: "关闭", exact: true }).last().click()
  await expect(history).toHaveCount(0)
  await expect(startPrompt).toBeVisible()
  await expect(fold).toHaveAttribute("aria-expanded", "false")
  await expect(child).toHaveCount(0)

  const input = page.getByRole("textbox", { name: "消息", exact: true })
  await input.fill("New Supervisor conversation")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => f.writes.filter(({ path }) => path === "/api/v1/chat").length).toBe(1)
  const newMessage = page.locator("[data-message-list-content]").getByText("New Supervisor conversation", { exact: true })
  await expect(newMessage).toBeVisible()
  await expect(startPrompt).toHaveCount(0)
  await expect(fold).toHaveAttribute("aria-expanded", "false")
  await expect(child).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("supervisor-history-fold.png"), animations: "disabled" })

  // The saved Actor tree can still load when the independently fetched Child
  // summaries are unavailable. Missing birth times must keep this fold closed.
  await page.route((url) => url.pathname === "/api/v1/sessions" &&
    url.searchParams.get("kind") === "child" && url.searchParams.get("root_session_id") === supervisor,
    (route) => route.fulfill({ status: 503, json: { error: "Synthetic child index unavailable" } }))
  await page.reload()
  await expect(newMessage).toBeVisible()
  await expect(startPrompt).toHaveCount(0)
  await expect(fold).toHaveAttribute("aria-expanded", "false")
  await expect(child).toHaveCount(0)
  await fold.click()
  await expect(child).toHaveText(/Retained child/)
  expect(f.writes.filter(({ method }) => method === "DELETE")).toEqual([])
  expect(f.runtime.pageErrors).toEqual([])
})
test("expanding historical children keeps the scrolled Supervisor transcript visible", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Supervisor desktop transcript layout")
  const snapshot = actorSnapshotFixture(supervisor, 24)
  for (const node of snapshot.nodes.slice(1)) {
    node.parent_actor_id = supervisor
    node.depth = 1
  }
  await fixture(page, null, async () => {
    await page.route(`**/api/v1/history/${supervisor}*`, (route) => route.fulfill({
      json: { session_id: supervisor, messages: Array.from({ length: 70 }, (_, index) => ({
        id: `message-${index}`, role: "user", content: `Retained message ${index}`, created_at: "2026-10-22T00:00:02Z",
      })) },
    }))
  }, 70, snapshot)
  await page.locator("aside").first().getByRole("button", { name: /^Supervisor/ }).click()
  const scroll = page.locator("[data-message-list-content]").locator("..")
  const fold = page.locator("[data-cleared-subagents-toggle]")
  const childCards = page.locator("[data-subagent-id]")
  const scrollPastCards = async () => {
    await expect(scroll.locator("[data-virtual-history]")).toBeAttached()
    const prefix = await scroll.evaluate((element) => {
      const history = element.querySelector("[data-virtual-history]")!.getBoundingClientRect()
      const offset = history.top - element.getBoundingClientRect().top + element.scrollTop
      element.scrollTop = offset + 40
      return offset
    })
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeCloseTo(prefix + 40, 0)
    return prefix
  }
  const visibleGap = () => scroll.evaluate((element) => {
    const viewport = element.getBoundingClientRect()
    const rows = [...element.querySelectorAll("[data-history-entry-key]")].map((row) => row.getBoundingClientRect())
    const visible = rows.filter((row) => row.bottom > viewport.top && row.top < viewport.bottom)
    return Math.max(Math.min(...visible.map((row) => row.top)) - viewport.top,
      viewport.bottom - Math.max(...visible.map((row) => row.bottom)))
  })
  await expect(fold).toHaveText("24 个历史子会话")
  await fold.click()
  await expect(childCards).toHaveCount(24)
  await scroll.hover()
  await page.mouse.wheel(0, -80)
  expect(await scrollPastCards()).toBeGreaterThan(750)
  await expect.poll(visibleGap).toBeLessThan(50)
  await page.screenshot({ path: info.outputPath("supervisor-visible-after-child-cards.png"), animations: "disabled" })

  await fold.click()
  await expect(childCards).toHaveCount(0)
  expect(await scrollPastCards()).toBeLessThan(100)
  await expect.poll(visibleGap).toBeLessThan(50)
})
test("simple-mode settings exposes conversation clear while bulk cleanup stays advanced", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("lotus_experience_mode_v1", "simple"))
  const f = await fixture(page)
  if (info.project.name === "phone-chromium") await page.getByRole("button", { name: "菜单", exact: true }).click()
  await page.getByRole("button", { name: "系统设置", exact: true }).click()
  const settings = settingsSurface(page)
  await selectSettingsCategory(settings, "system", "系统")
  await expect(settings.getByRole("button", { name: "清除会话消息", exact: true })).toBeVisible()
  await expect(settings.getByRole("button", { name: "删除全部会话", exact: true })).toHaveCount(0)
  await expect(settings.getByRole("button", { name: "重置会话存储", exact: true })).toHaveCount(0)
  await settings.getByRole("button", { name: "清除会话消息", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "清除这个会话的消息？", exact: true })
  await expect(dialog).toContainText(ordinary)
  await dialog.getByRole("button", { name: "取消", exact: true }).click()
  expect(f.writes).toEqual([])
})
test("activated Supervisor refusal is explicit and does not clear the ordinary conversation", async ({ page }, info) => {
  const f = await fixture(page, "blocked"), dialog = await openSupervisor(page, info.project.name === "phone-chromium")
  await dialog.getByRole("button", { name: "清除会话消息", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("当前清理接口不支持已激活的 Supervisor")
  await expect(dialog.getByRole("status")).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("conversation-clear-blocked.png"), animations: "disabled" })
  expect(f.writes).toEqual([{ method: "POST", path: `/api/v1/sessions/${supervisor}/clear` }])
})
for (const reason of ["readback", "unknown"] as const) {
  test(`${reason} stays unconfirmed across reopen and refresh never repeats the POST`, async ({ page }) => {
    const f = await fixture(page, reason)
    let dialog = await openHeader(page)
    await dialog.getByRole("button", { name: "清除会话消息", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText(reason === "unknown" ? "清理请求的结果未知" : "无法核实存储结果")
    await expect(dialog.getByRole("button", { name: "清除会话消息", exact: true })).toHaveCount(0)
    await dialog.getByRole("button", { name: "关闭", exact: true }).last().click()
    dialog = await openHeader(page)
    await expect(dialog.getByRole("alert")).toBeVisible()
    f.allowReadback()
    await dialog.getByRole("button", { name: "刷新存储状态", exact: true }).click()
    await expect(dialog.getByRole("status")).toContainText(reason === "unknown" ? "此前请求的结果仍未知" : "服务已确认清理，并已读回核对")
    expect(f.writes).toEqual([{ method: "POST", path: `/api/v1/sessions/${ordinary}/clear` }])
  })
}
for (const reason of ["running", "pending"] as const) {
  test(`${reason} prevents clear without automatic stop, approval or retry`, async ({ page }) => {
    const f = await fixture(page, reason), dialog = await openHeader(page)
    if (reason === "pending") f.enablePending()
    await dialog.getByRole("button", { name: "清除会话消息", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText(reason === "running" ? "此会话正在运行" : "待回答的问题或审批")
    expect(f.writes).toEqual([])
  })
}

test("an observed clear fences a held refusal-refresh GET while busy and defers a fresh GET", async ({ page }) => {
  let socket: WebSocketRoute | undefined, subscribed = false
  const f = await fixture(page, "blocked", async () => page.routeWebSocket(/.*/, (ws) => {
    socket = ws
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
      if (frame.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch === "feed") subscribed = true
    })
  }))
  await expect.poll(() => subscribed).toBe(true)
  const dialog = await openHeader(page)
  await dialog.getByRole("button", { name: "清除会话消息", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("服务因本会话存在执行授权")
  let reads = 0, release!: () => void
  const gate = new Promise<void>((done) => { release = done })
  await page.route(`**/api/v1/history/${ordinary}`, async (route) => {
    reads += 1
    if (reads !== 1) return route.fallback()
    await gate
    return route.fulfill({ json: { session_id: ordinary, messages: [
      { id: "stale-held", role: "user", content: "STALE HELD RESPONSE MUST NOT RETURN", created_at: stamp },
    ] } })
  })
  await dialog.getByRole("button", { name: "刷新存储状态", exact: true }).click()
  await expect.poll(() => reads).toBe(1)
  f.clearFromOtherClient()
  socket!.send(JSON.stringify({ ch: "feed", seq: 1, event: {
    seq: 1, ts: stamp, session_id: ordinary, event: { type: "session_cleared", session_id: ordinary },
  } }))
  await expect.poll(() => page.evaluate(() => localStorage.getItem("lotus_account_feed_cursor_v1"))).toBe("1")
  release()
  await expect.poll(() => reads).toBeGreaterThanOrEqual(2)
  await expect(dialog.getByText("无法刷新存储状态，此前的结果未改变。未发送清理请求。", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "取消", exact: true }).click()
  await expect(page.getByText("STALE HELD RESPONSE MUST NOT RETURN", { exact: true })).toHaveCount(0)
  await expect(page.getByText(`Synthetic history ${ordinary}`, { exact: true })).toBeHidden()
  expect(f.writes).toEqual([{ method: "POST", path: `/api/v1/sessions/${ordinary}/clear` }])
  expect(f.runtime.pageErrors).toEqual([])
})

test("message-appended reconciliation inherits a pending replacement when the new history is shorter", async ({ page }) => {
  const f = await streamFixture(page, null, 5)
  await expect(page.getByText("Deleted old message 4", { exact: true })).toBeVisible()
  let reads = 0, release!: () => void
  const gate = new Promise<void>((done) => { release = done })
  await page.route(`**/api/v1/history/${ordinary}`, async (route) => {
    reads += 1
    if (reads !== 1) return route.fallback()
    await gate
    return route.fulfill({ json: { session_id: ordinary, messages: [
      { id: "discard-after-new-read", role: "user", content: "STALE SUPERSEDED CLEAR RESPONSE", created_at: stamp },
    ] } })
  })
  f.clearFromOtherClient(); f.feed("session_cleared", 1)
  await expect.poll(() => reads).toBe(1)
  f.appendAfterClear(); f.feed("message_appended", 2)
  await expect(page.getByText("Synthetic new conversation after clear", { exact: true })).toBeVisible()
  expect(reads).toBe(2)
  const staleResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/history/${ordinary}`)
  release(); await staleResponse
  await expect(page.getByText("STALE SUPERSEDED CLEAR RESPONSE", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Deleted old message 4", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Synthetic new conversation after clear", { exact: true })).toBeVisible()
  expect(f.writes).toEqual([])
})

test("remote clear removes live context and prefix-cache statistics after authoritative reconciliation", async ({ page }) => {
  const f = await streamFixture(page, "running")
  await expect.poll(() => f.channels.has(`agent.${ordinary}`)).toBe(true)
  f.agent({ type: "token_budget_updated", usage: {
    system_tokens: 1000, summary_tokens: 0, window_tokens: 5000, total_tokens: 6000,
    max_context_tokens: 10000, budget_limit: 10000, truncation_occurred: false, segments_removed: 0,
    provider_prompt_usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 5000 },
  } })
  const ring = page.getByRole("button", { name: /^上下文用量/ })
  await expect(ring).toHaveAccessibleName("上下文用量，Cache 83%")
  await expect(ring).toHaveAttribute("title", /6,000/)
  f.clearFromOtherClient(); f.feed("session_cleared", 1)
  await expect(ring).toHaveCount(0)
  await expect(page.getByText(`Synthetic history ${ordinary}`, { exact: true })).toBeHidden()
  expect(f.writes).toEqual([])
  expect(f.runtime.pageErrors).toEqual([])
})
