import { installResizeDiagnostics } from "./support/resizeDiagnostics.js"
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

// Synthetic strict public DTOs exercise the built production hook/transport.
// This is successor-activation UI acceptance, not a second real Host execution.
const activationA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const activationB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const treeCursor = (revision: number) => `at1-${"a".repeat(64)}-${revision}`
function activationSnapshot(activationId: string, attempt: number,
  status: "reserved" | "running" | "succeeded", revision: number) {
  const value = actorSnapshotFixture(rootId, 128, treeCursor(revision))
  return { ...value, snapshot_id: `as1-${revision.toString(16).padStart(64, "0")}`,
    nodes: value.nodes.map((node) => node.actor_id !== childId ? node : {
      ...node, logical_state: status === "succeeded" ? "cold" : "active", placement_class: "remote",
      revision: { ...node.revision, actor_directory_revision: revision },
      activation: { activation_id: activationId, attempt, status },
    }),
  }
}
const actorEvent = (activationId: string, attempt: number, seq: number) => ({
  ch: `actor.${childId}`, seq, event: {
    type: "actor_changed", actor_id: childId, root_actor_id: rootId, parent_actor_id: "actor-8",
    activation_id: activationId, attempt, event_id: `ae1-${seq.toString(16).padStart(64, "0")}`, class: "lifecycle",
  },
})

// Every physical interest has one owner in this UI: Inspector and child preview
// are mutually exclusive. Shared simultaneous consumers remain transport-unit
// coverage; do not invent a production mount just to manufacture that state.
function expectBoundedInterests(frames: unknown[], channel: string, finalBalance: number) {
  let balance = 0
  for (const raw of frames) {
    const value = frame(raw)
    if (value.ch !== channel) continue
    if (value.type === "subscribe" || value.type === "subscribe_tree") balance += 1
    if (value.type === "unsubscribe") balance -= 1
    expect(balance, `one physical interest for ${channel}`).toBeGreaterThanOrEqual(0)
    expect(balance, `one physical interest for ${channel}`).toBeLessThanOrEqual(1)
  }
  expect(balance, `remaining interests for ${channel}`).toBe(finalBalance)
}

test("selected Child follows successor activation and fences late frames across Root and close navigation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet-chromium", "desktop and phone acceptance")
  const { observation, requests } = await prepare(page)
  let socket: WebSocketRoute | undefined
  const serverFrames: unknown[] = []
  await page.routeWebSocket(/.*/, (ws) => {
    socket = ws
    observation.webSocketUrls.push(ws.url())
    ws.onMessage((raw) => {
      const value = frame(JSON.parse(String(raw)))
      observation.clientFrames.push(value)
      if (value.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (value.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
    })
  })
  // Observe delivery without replacing the production onmessage handler. The
  // test still uses the routed socket and the built v2Stream/hook unmodified.
  await page.addInitScript(() => {
    type Socket = { addEventListener: (type: string, listener: (event: { data: string }) => void) => void }
    const browser = globalThis as unknown as {
      WebSocket: new (url: string, protocols?: string | string[]) => Socket
      __actorAcceptanceFrames: string[]
    }
    browser.__actorAcceptanceFrames = []
    const OriginalWebSocket = browser.WebSocket
    browser.WebSocket = class extends OriginalWebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols)
        this.addEventListener("message", (event) => browser.__actorAcceptanceFrames.push(event.data))
      }
    }
  })
  const receivedFrames = () => page.evaluate(() => (globalThis as unknown as {
    __actorAcceptanceFrames: string[]
  }).__actorAcceptanceFrames)
  const send = async (value: unknown) => {
    serverFrames.push(value)
    const payload = JSON.stringify(value)
    const occurrence = serverFrames.filter((item) => JSON.stringify(item) === payload).length
    socket!.send(payload)
    await expect.poll(async () => (await receivedFrames()).filter((item) => item === payload).length,
      { message: "the exact routed frame reached the production socket" }).toBe(occurrence)
  }
  const sent = (type: string, ch: string) => observation.clientFrames.filter((raw) => frame(raw).type === type && frame(raw).ch === ch)
  const actor = `actor.${childId}`, tree = `tree.${rootId}`, message = `message.${childId}`
  const reads = () => requests.filter((url) => new URL(url).pathname === `/api/v1/actors/${rootId}/snapshot`).length
  let current = activationSnapshot(activationA, 1, "running", 7)
  const snapshots: ReturnType<typeof activationSnapshot>[] = []
  await page.route(`**/api/v1/actors/${rootId}/snapshot?*`, (route) => {
    snapshots.push(current)
    return route.fulfill({ json: current })
  })
  // After an explicit receive receipt, socket dispatch and hook invalidation
  // are synchronous/microtask-based. Drain two browser turns before asserting no
  // HTTP read; a stable label alone would miss an unnecessary stale refresh.
  const settleFrames = () => page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
  try {
    await page.goto(standaloneScenario.entryUrl)
    const panel = await openInspector(page)
    await panel.locator('[data-actor-id="actor-0"] [data-actor-toggle]').click()
    await panel.locator('[data-actor-id="actor-8"] [data-actor-toggle]').click()
    const selected = panel.locator(`[data-actor-id="${childId}"]`)
    await expect(selected).toHaveAttribute("aria-label", /运行中，远端/)
    await selected.click()
    const workbench = page.locator("#right-workbench")
    await expect(workbench.getByText("isolated selected child answer")).toBeVisible()
    await expect.poll(() => sent("subscribe", actor).length).toBe(1)
    await expect.poll(() => sent("subscribe", message).length).toBe(1)
    await workbench.getByRole("tab", { name: "检查器", exact: true }).click()
    await expect(selected).toHaveAttribute("aria-selected", "true")
    await expect.poll(() => sent("subscribe", actor).length).toBe(2)
    await expect.poll(() => sent("unsubscribe", actor).length).toBe(1)
    await expect.poll(() => sent("unsubscribe", message).length).toBe(1)
    await expect(panel).toHaveAttribute("aria-busy", "false")

    // Establish the numeric Actor cursor before any event. Tree cursors are a
    // separate authority and must not fabricate an Actor replay position.
    let before = reads()
    await send({ ch: actor, seq: 1, control: { type: "actor_snapshot_required", reason: "initial", cursor: 1 } })
    await expect.poll(reads).toBe(before + 1)
    await expect(panel).toHaveAttribute("aria-busy", "false")
    await expect(workbench.locator("[data-actor-gap]")).toHaveCount(0)

    // A committed tree snapshot installs B for the same persistent Child.
    current = activationSnapshot(activationB, 2, "reserved", 8)
    before = reads()
    await send({ ch: tree, seq: 8, control: { type: "actor_snapshot_required", reason: "changed", cursor: current.stream_cursor } })
    await expect.poll(reads).toBe(before + 1)
    await expect(selected).toHaveAttribute("aria-label", /排队中，远端/)
    await expect(selected).toHaveAttribute("aria-selected", "true")
    expect(snapshots.at(-1)!.nodes.find((node) => node.actor_id === childId)!.activation).toEqual({
      activation_id: activationB, attempt: 2, status: "reserved",
    })
    expect(sent("subscribe", actor)).toHaveLength(2)

    before = reads()
    await send(actorEvent(activationA, 1, 2))
    await settleFrames()
    expect(reads(), "late A must not invalidate the already-authorized B snapshot").toBe(before)
    await expect(selected).toHaveAttribute("aria-label", /排队中，远端/)
    await expect(workbench.locator("[data-actor-gap]")).toHaveCount(0)

    current = activationSnapshot(activationB, 2, "running", 9)
    await send(actorEvent(activationB, 2, 3))
    await expect.poll(reads).toBe(before + 1)
    await expect(selected).toHaveAttribute("aria-label", /运行中，远端/)
    await expect(panel).toHaveAttribute("aria-busy", "false")
    before = reads()
    await send(actorEvent(activationB, 2, 3))
    await settleFrames()
    expect(reads(), "duplicate B must not invalidate the snapshot again").toBe(before)
    await expect(selected).toHaveAttribute("aria-label", /运行中，远端/)
    await expect(workbench.locator("[data-actor-gap]")).toHaveCount(0)

    current = activationSnapshot(activationB, 2, "succeeded", 10)
    await send(actorEvent(activationB, 2, 4))
    await expect.poll(reads).toBe(before + 1)
    await expect(selected).toHaveAttribute("aria-label", /已完成，远端/)
    await expect(selected).toHaveAttribute("aria-selected", "true")
    expect(snapshots.at(-1)!.nodes.find((node) => node.actor_id === childId)!.activation).toEqual({
      activation_id: activationB, attempt: 2, status: "succeeded",
    })
    await page.screenshot({ path: testInfo.outputPath("actor-successor-b-completed.png") })

    before = reads()
    await send({ ch: actor, seq: 5, control: { type: "actor_snapshot_required", reason: "gap", cursor: 5 } })
    const gap = panel.locator(`[data-actor-gap="transport_gap"][data-actor-gap-origin="${childId}"]`)
    await expect(gap).toBeVisible()
    await expect.poll(reads).toBe(before + 1)
    await expect(panel).toHaveAttribute("aria-busy", "false")
    await panel.getByRole("button", { name: "刷新代理结构" }).click()
    await expect.poll(reads).toBe(before + 2)
    await expect(panel).toHaveAttribute("aria-busy", "false")
    await expect(gap, "successful B snapshots cannot repair retained Actor replay loss").toBeVisible()

    await panel.locator(`[data-actor-id="${rootId}"]`).click()
    await expect(panel.locator(`[data-actor-id="${rootId}"]`)).toHaveAttribute("aria-selected", "true")
    await expect.poll(() => sent("unsubscribe", actor).length).toBe(2)
    before = reads()
    await send(actorEvent(activationB, 2, 6))
    await settleFrames()
    expect(reads(), "departed Child frames must not refresh the selected Root").toBe(before)
    await expect(gap, "Root selection must preserve the Child gap origin").toBeVisible()
    await expect(workbench.locator("[data-subagent-transcript-pane]")).toHaveCount(0)

    await workbench.getByRole("button", { name: "收起工作面板", exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect.poll(() => sent("unsubscribe", tree).length).toBe(sent("subscribe_tree", tree).length)
    before = reads()
    await send(actorEvent(activationB, 2, 7))
    await send({ ch: tree, seq: 11, control: { type: "actor_snapshot_required", reason: "gap", cursor: treeCursor(11) } })
    await settleFrames()
    expect(reads(), "closed Inspector must ignore late Actor and tree callbacks").toBe(before)
    for (const channel of [actor, message, tree, `actor.${rootId}`]) expectBoundedInterests(observation.clientFrames, channel, 0)
    expect(sent("subscribe", actor)).toHaveLength(2)
    expect(sent("subscribe", message)).toHaveLength(1)
    expect(sent("subscribe", `agent.${childId}`)).toHaveLength(0)
    expect(observation.webSocketUrls).toHaveLength(1)
    expect(observation.webSocketUrls[0]).toContain("/v2/stream")
    expect(observation.pageErrors).toEqual([])
  } finally {
    await testInfo.attach("actor-successor-public-wire-receipts", {
      body: JSON.stringify({ clientFrames: observation.clientFrames, serverFrames,
        receivedFrames: (await receivedFrames()).map((item) => JSON.parse(item)), snapshots,
        snapshotRequests: requests.filter((url) => new URL(url).pathname === `/api/v1/actors/${rootId}/snapshot`) }, null, 2),
      contentType: "application/json",
    })
  }
})

test("child side chat follows automatic corrections and pauses only for upward reading", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "shared desktop scroll regression")
  await installResizeDiagnostics(page)
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
  expect(await page.evaluate(() => (globalThis as unknown as { __resizeDiagnostics: { errors: unknown[] } }).__resizeDiagnostics.errors)).toEqual([])
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
