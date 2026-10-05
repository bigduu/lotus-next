import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const rootId = "all-surface-session"
const childId = "actor-64"
const at = "2026-09-26T00:00:00.000Z"
const snapshot = actorSnapshotFixture(rootId)
const sessions = snapshot.nodes.map((node) => ({
  id: node.actor_id, title: node.title, title_version: 1, kind: node.role, pinned: false,
  root_session_id: rootId, parent_session_id: node.parent_actor_id, spawn_depth: node.depth,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: at, updated_at: at, last_activity_at: at, message_count: 0,
  has_attachments: false, is_running: false, last_run_status: "completed",
  permission_mode: "default", bypass_permissions: false, subagent_count: node.role === "root" ? 128 : 0,
}))
const frame = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {}
async function prepare(page: Page) {
  await page.addInitScript((id) => { localStorage.setItem("bodhi_onboarded_v1", "1"); localStorage.setItem("lotus_next_last_session", id) }, rootId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const requests: string[] = []
  page.on("request", (request) => requests.push(request.url()))
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/api/v1/sessions") {
      const selected = sessions.filter((item) => !url.searchParams.get("kind") || item.kind === url.searchParams.get("kind"))
      return route.fulfill({ json: { sessions: selected, total: selected.length, limit: 200, offset: 0 } })
    }
    const item = sessions.find((session) => url.pathname === `/api/v1/sessions/${session.id}`)
    if (item) return route.fulfill({ json: { session: { ...item, ...(item.kind === "root" ? {
      root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
    } : {}) } } })
    if (url.pathname === `/api/v1/task/${rootId}`) return route.fulfill({ json: { session_id: rootId, items: [] } })
    if (url.pathname === `/api/v1/sessions/${childId}/history` && url.searchParams.get("projection") === "messages") {
      return route.fulfill({ json: { session_id: childId, projection: "messages", is_delta: false,
        truncated: false, total_message_count: 1,
        messages: [{ id: "selected-child-message", role: "assistant", content: "isolated selected child answer", created_at: at }],
      } })
    }
    return route.fallback()
  })
  return { observation, requests }
}
async function openInspector(page: Page) {
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  await page.locator("#right-workbench").getByRole("button", { name: /检查器.*查看当前会话/ }).click()
  return page.locator("[data-actor-snapshot-panel]")
}

test("normal tree refreshes keep Inspector and child side-chat content stationary", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "shared desktop right-pane regression")
  await prepare(page)
  let socket: WebSocketRoute | undefined
  const subscriptions: string[] = []
  await page.routeWebSocket(/.*/, (ws) => {
    socket = ws
    ws.onMessage((message) => {
      const value = frame(JSON.parse(String(message)))
      if (value.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (value.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
      if (value.type === "subscribe_tree") subscriptions.push(String(value.ch))
    })
  })
  let revision = 7
  let pendingRead = false
  let release: (() => void) | undefined
  const cursor = () => `at1-${"a".repeat(64)}-${revision}`
  await page.route(`**/api/v1/actors/${rootId}/snapshot?*`, async (route) => {
    if (pendingRead) await new Promise<void>((resolve) => { release = resolve })
    await route.fulfill({ json: actorSnapshotFixture(rootId, 128, cursor()) })
  })
  await page.goto(standaloneScenario.entryUrl)
  const panel = await openInspector(page)
  await expect(panel.getByRole("tree")).toBeVisible()
  const workbench = page.locator("#right-workbench")
  const tree = panel.getByRole("tree")
  const verifyRefresh = async (target: ReturnType<Page["locator"]>) => {
    await expect.poll(() => subscriptions.length).toBeGreaterThan(0)
    const before = await target.boundingBox()
    expect(before).not.toBeNull()
    pendingRead = true
    release = undefined
    revision += 1
    socket!.send(JSON.stringify({ ch: subscriptions.at(-1), seq: revision,
      control: { type: "actor_snapshot_required", reason: "changed", cursor: cursor() } }))
    await expect.poll(() => !!release).toBe(true)
    await expect(workbench.locator("[data-actor-gap]")).toHaveCount(0)
    const during = await target.boundingBox()
    expect(during?.y).toBe(before?.y)
    expect(during?.height).toBe(before?.height)
    pendingRead = false
    release!()
    await expect.poll(async () => (await target.boundingBox())?.y).toBe(before?.y)
    await expect(workbench.locator("[data-actor-gap]")).toHaveCount(0)
  }
  await verifyRefresh(tree)
  await page.screenshot({ path: testInfo.outputPath("actor-refresh-stable-inspector.png") })
  await panel.locator('[data-actor-id="actor-0"] [data-actor-toggle]').click()
  await panel.locator('[data-actor-id="actor-8"] [data-actor-toggle]').click()
  await panel.locator(`[data-actor-id="${childId}"]`).click()
  const side = workbench.locator("[data-subagent-transcript-pane] .overflow-y-auto")
  await expect(workbench.getByText("isolated selected child answer")).toBeVisible()
  await verifyRefresh(side)
  await page.screenshot({ path: testInfo.outputPath("actor-refresh-stable-side-chat.png") })
})

test("129 persistent actors render recursively without expanding the content subscription scope", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet-chromium", "desktop and phone acceptance")
  const { observation, requests } = await prepare(page)
  let reads = 0; let identity = snapshot.snapshot_id
  await page.route(`**/api/v1/actors/${rootId}/snapshot?*`, (route) => {
    reads += 1
    expect(route.request().method()).toBe("GET")
    expect(new URL(route.request().url()).searchParams.get("subtree_id")).toBe(rootId)
    return route.fulfill({ json: { ...snapshot, snapshot_id: identity } })
  })
  await page.goto(standaloneScenario.entryUrl)
  const panel = await openInspector(page)
  const tree = panel.getByRole("tree", { name: "代理会话结构" })
  await expect(tree).toBeVisible()
  await expect(panel.locator('[data-actor-id="actor-0"]')).toHaveAttribute("aria-label", /运行中，远端，健康状态未知/)
  await panel.locator('[data-actor-id="actor-0"] [data-actor-toggle]').click()
  await panel.locator('[data-actor-id="actor-8"] [data-actor-toggle]').click()
  await expect(panel.locator(`[data-actor-id="${childId}"]`)).toHaveAttribute("aria-level", "4")
  await expect(panel.locator("[data-actor-tree-virtual]")).toHaveJSProperty("offsetHeight", 129 * 64)
  expect(await panel.getByRole("treeitem").count()).toBeLessThan(30)
  expect(reads).toBe(1)
  expect(observation.clientFrames.some((value) => frame(value).type === "subscribe" && String(frame(value).ch).startsWith("actor.actor-"))).toBe(false)
  expect(requests.some((url) => /\/history\//.test(new URL(url).pathname) && !url.includes(rootId))).toBe(false)
  expect(requests.some((url) => /\/sessions\/actor-[^/]+\/history/.test(new URL(url).pathname))).toBe(false)
  expect(observation.clientFrames.some((value) => frame(value).type === "subscribe" && /^message\.actor-/.test(String(frame(value).ch)))).toBe(false)
  await page.screenshot({ path: testInfo.outputPath("actor-tree-depth-three.png") })

  await panel.locator(`[data-actor-id="${childId}"]`).click()
  const workbench = page.locator("#right-workbench")
  await expect(workbench.locator("[data-subagent-transcript-pane]")).toBeVisible()
  await expect(workbench.getByText("isolated selected child answer")).toBeVisible()
  await expect(workbench.getByRole("textbox", { name: "消息", exact: true })).toHaveCount(0)
  await expect.poll(() => observation.clientFrames.some((value) => frame(value).type === "subscribe" && frame(value).ch === `message.${childId}`)).toBe(true)
  await expect.poll(() => observation.clientFrames.some((value) => frame(value).type === "subscribe" && frame(value).ch === `actor.${childId}`)).toBe(true)
  expect(observation.clientFrames.filter((value) => frame(value).type === "subscribe" && frame(value).ch === `actor.${childId}`)).toHaveLength(1)
  expect(observation.clientFrames.some((value) => frame(value).type === "subscribe" && frame(value).ch === `agent.${childId}`)).toBe(false)
  expect(requests.some((url) => new URL(url).pathname === `/api/v1/history/${childId}`)).toBe(false)
  const projected = requests.filter((url) => new URL(url).pathname === `/api/v1/sessions/${childId}/history`)
  expect(projected.length).toBeGreaterThan(0)
  expect(projected.every((url) => new URL(url).searchParams.get("projection") === "messages")).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("actor-selected-message-projection.png") })

  await workbench.getByRole("tab", { name: "检查器" }).click()
  await expect(panel.locator(`[data-actor-id="${childId}"]`)).toHaveAttribute("aria-selected", "true")
  await expect.poll(() => observation.clientFrames.some((value) => frame(value).type === "unsubscribe" && frame(value).ch === `message.${childId}`)).toBe(true)
  identity = `as1-${"0".repeat(64)}`
  await panel.getByRole("button", { name: "刷新代理结构" }).click()
  await expect(panel).toHaveAttribute("aria-busy", "false")
  await expect(panel.locator(`[data-actor-id="${childId}"]`)).toHaveAttribute("aria-selected", "true")
  await panel.locator(`[data-actor-id="${rootId}"]`).click()
  await expect(panel.locator(`[data-actor-id="${rootId}"]`)).toHaveAttribute("aria-selected", "true")
  await workbench.getByRole("tab", { name: "并排会话" }).click()
  await expect(workbench.locator("[data-subagent-transcript-pane]")).toHaveCount(0)
  await expect(workbench.getByText("isolated selected child answer")).toHaveCount(0)
  await workbench.getByRole("tab", { name: "检查器" }).click()
  await expect(panel.locator(`[data-actor-id="${rootId}"]`)).toHaveAttribute("aria-selected", "true")
  expect(observation.webSocketUrls).toHaveLength(1)
  expect(observation.webSocketUrls[0]).toContain("/v2/stream")
  expect(observation.protocolErrors).toEqual([]); expect(observation.pageErrors).toEqual([])
  expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
})

test("child side chat follows automatic corrections and pauses only for upward reading", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "shared desktop scroll regression")
  await prepare(page)
  let socket: WebSocketRoute | undefined
  const subscriptions: string[] = []
  await page.routeWebSocket(/.*/, (ws) => {
    socket = ws
    ws.onMessage((raw) => {
      const value = frame(JSON.parse(String(raw)))
      if (value.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (value.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
      if (value.type === "subscribe") subscriptions.push(String(value.ch))
    })
  })
  await page.route(`**/api/v1/actors/${rootId}/snapshot?*`, (route) => route.fulfill({ json: snapshot }))
  await page.route(`**/api/v1/sessions/${childId}/history?*`, (route) => route.fulfill({ json: {
    session_id: childId, projection: "messages", is_delta: false, truncated: false, total_message_count: 1,
    messages: [{ id: "child-long-message", role: "assistant", content: "Child answer paragraph.\n\n".repeat(120), created_at: at }],
  } }))
  await page.goto(standaloneScenario.entryUrl)
  const panel = await openInspector(page)
  await panel.locator('[data-actor-id="actor-0"] [data-actor-toggle]').click()
  await panel.locator('[data-actor-id="actor-8"] [data-actor-toggle]').click()
  await panel.locator(`[data-actor-id="${childId}"]`).click()
  const workbench = page.locator("#right-workbench")
  const area = workbench.locator("[data-subagent-transcript-pane] .overflow-y-auto")
  const gap = () => area.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
  await expect(workbench.locator(".assistant-streamdown")).toContainText("Child answer paragraph.")
  await expect.poll(() => subscriptions.includes(`message.${childId}`)).toBe(true)
  await expect.poll(gap).toBeLessThanOrEqual(2)
  let version = 0
  let live = ""
  const grow = async () => {
    version += 1
    live += `Child update ${version}.\n\n` + "More child output.\n\n".repeat(12)
    socket!.send(JSON.stringify({ ch: `message.${childId}`, seq: version, event: {
      type: "snapshot", version, history_committed: false,
      messages: [{ id: "child-live-tail", content: live, created_at: at }],
    } }))
    await expect(workbench.locator(".assistant-streamdown").last()).toContainText(`Child update ${version}.`)
  }
  await area.evaluate((el) => { el.scrollTop -= 64 })
  await expect.poll(gap).toBeLessThanOrEqual(2)
  await grow()
  await expect.poll(gap).toBeLessThanOrEqual(2)
  await area.hover()
  await page.mouse.wheel(0, -250)
  const jump = workbench.getByRole("button", { name: "滚动到底部", exact: true })
  await expect(jump).toBeVisible()
  await grow()
  // Virtualized history may adjust its offset while measuring rows. It must
  // stay in paused reading rather than following the newly appended bottom.
  await expect(jump).toBeVisible()
  expect(await gap()).toBeGreaterThan(2)
  await jump.click()
  await expect.poll(gap).toBeLessThanOrEqual(2)
  await page.screenshot({ path: testInfo.outputPath("child-bottom-follow-restored.png") })
})

test("pending and budget-rejected snapshots never present a partial actor tree", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet-chromium", "desktop and phone acceptance")
  const { observation } = await prepare(page)
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  let blocked = true
  await page.route(`**/api/v1/actors/${rootId}/snapshot?*`, async (route) => {
    if (blocked) { await pending; return route.fulfill({ status: 413, json: { schema_version: 1, error: "budget_exceeded" } }) }
    return route.fulfill({ json: actorSnapshotFixture(rootId, 0) })
  })
  await page.goto(standaloneScenario.entryUrl)
  const panel = await openInspector(page)
  await expect(panel).toHaveAttribute("aria-busy", "true")
  await expect(panel.getByText("正在载入代理结构…")).toBeVisible()
  await expect(panel.getByRole("treeitem")).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("actor-snapshot-loading.png") })
  release()
  await expect(panel.getByRole("alert")).toContainText("超过当前读取上限")
  await expect(panel.getByRole("treeitem")).toHaveCount(0)
  await expect(panel.getByText("代理结构尚未确认。")).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("actor-snapshot-budget-error.png") })
  blocked = false
  await panel.getByRole("button", { name: "重试", exact: true }).click()
  await expect(panel.getByRole("treeitem")).toHaveCount(1)
  await expect(panel.getByRole("alert")).toHaveCount(0)
  expect(observation.pageErrors).toEqual([])
})
