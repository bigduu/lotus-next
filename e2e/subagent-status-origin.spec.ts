import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const rootId = "all-surface-session", at = "2026-10-16T00:00:00Z"
const cursor = (revision: number) => `at1-${"a".repeat(64)}-${revision}`
const user = (id: string) => ({ id, role: "user", content: id, created_at: at })
const spawn = (id: string, childId: string, compact = false) => [{
  id, role: "assistant", content: "", created_at: at,
  tool_calls: [{ id, function: { name: "sub_agent", arguments: JSON.stringify(compact
    ? { intent: "chat", message: "Bounded assignment" }
    : { action: "create", title: childId }) } }],
}, { id: `${id}-result`, role: "tool", tool_call_id: id, content: JSON.stringify(compact
  ? { actor_id: childId } : { child_session_id: childId, parent_session_id: rootId }), tool_success: true, created_at: at }]

async function fixture(page: Page) {
  await page.addInitScript((id) => { localStorage.setItem("bodhi_onboarded_v1", "1"); localStorage.setItem("lotus_next_last_session", id) }, rootId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  // Observe requests even when this fixture fulfills them before the fallback runtime.
  const requests: string[] = []
  page.on("request", (request) => requests.push(request.url()))
  const snapshot = actorSnapshotFixture(rootId, 3, cursor(1))
  for (const [index, status] of (["succeeded", "failed", "cancelled"] as const).entries()) {
    Object.assign(snapshot.nodes[index + 1], {
      logical_state: status === "failed" ? "failed" : "cold",
      revision: { session_metadata_version: 7, actor_directory_revision: 2 },
      activation: { activation_id: `${String(index + 1).repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, attempt: 1, status },
    })
  }
  const rows = snapshot.nodes.map((node) => ({ id: node.actor_id, title: node.title, title_version: 1,
    kind: node.role, parent_session_id: node.parent_actor_id, root_session_id: rootId, spawn_depth: node.depth,
    pinned: false, model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: at, updated_at: at, last_activity_at: at, message_count: 1, has_attachments: false,
    is_running: true, last_run_status: "completed", permission_mode: "default", bypass_permissions: false,
    subagent_count: node.role === "root" ? 3 : 0,
    ...(node.role === "root" ? { root_orchestration_only: true, thinking_mode: "ultra", root_mode_transition_epoch: 1, root_mode_birth_token: "a".repeat(64) } : {}),
  }))
  const history: unknown[] = [user("First turn"), ...spawn("create-1", "actor-0"), ...spawn("create-2", "actor-1", true),
    { id: "answer-1", role: "assistant", content: "First turn answer", created_at: at },
    user("Second turn"), ...spawn("create-3", "actor-2")]
  let socket: WebSocketRoute | undefined, sockets = 0, sequence = 0, reads = 0, denied = false
  let treeChannel: string | undefined, treeCursor: string | undefined
  const channels = new Set<string>()
  await page.routeWebSocket(/.*/, (ws) => {
    socket = ws; sockets += 1
    ws.onMessage((message) => {
      const frame = JSON.parse(String(message))
      if (frame.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe") channels.add(frame.ch)
      if (frame.type === "subscribe_tree") {
        treeChannel = frame.ch
        treeCursor = frame.cursor
        ws.send(JSON.stringify({ ch: frame.ch, seq: Number(snapshot.stream_cursor!.split("-").at(-1)), control: { type: "actor_snapshot_required", reason: "initial", cursor: snapshot.stream_cursor } }))
      }
    })
  })
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === `/api/v1/actors/${rootId}/snapshot`) {
      reads += 1
      return denied ? route.fulfill({ status: 403, json: { error: { type: "forbidden", message: "denied fixture" } } }) : route.fulfill({ json: snapshot })
    }
    if (path === "/api/v1/sessions") {
      const kind = new URL(route.request().url()).searchParams.get("kind")
      const sessions = rows.filter((row) => !kind || row.kind === kind)
      return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
    }
    const row = rows.find((item) => path === `/api/v1/sessions/${item.id}`)
    if (row) return route.fulfill({ json: { session: row } })
    if (path === `/api/v1/history/${rootId}`) return route.fulfill({ json: { session_id: rootId, messages: history } })
    const child = rows.slice(1).find((item) => path === `/api/v1/history/${item.id}` || path === `/api/v1/sessions/${item.id}/history`)
    if (child) return route.fulfill({ json: { session_id: child.id, projection: "messages", is_delta: false,
      truncated: false, total_message_count: 1,
      messages: [{ id: "child-transcript", role: "assistant", content: "Child transcript", created_at: at }],
    } })
    if (path === "/api/v1/runs/active") return route.fulfill({ json: { sessions: rows[0].is_running
      ? [{ session_id: rootId, run_id: "fixture-parent", started_at: at, round_count: 1, last_critical_events: [], running_child_session_ids: rows.slice(1).map((row) => row.id) }] : [] } })
    return route.fallback()
  })
  return { snapshot, history, observation, channels, requests,
    get reads() { return reads }, get sockets() { return sockets },
    get treeSubscribed() { return treeChannel !== undefined },
    get treeCursor() { return treeCursor },
    setDenied(value: boolean) { denied = value },
    finishRun() { rows[0].is_running = false },
    emit(event: object) { socket!.send(JSON.stringify({ ch: `agent.${rootId}`, seq: ++sequence, event })) },
    refresh(reason = "changed") { socket!.send(JSON.stringify({ ch: treeChannel, seq: Number(snapshot.stream_cursor!.split("-").at(-1)), control: { type: "actor_snapshot_required", reason, cursor: snapshot.stream_cursor } })) },
    reconnect() { socket!.close() },
  }
}

test("saved terminal states survive unordered legacy events and reconnect without completing a newer activation", async ({ page }, testInfo) => {
  const state = await fixture(page)
  await page.goto(standaloneScenario.entryUrl)
  const card = (id: string) => page.locator(`[data-subagent-id="${id}"]`).first()
  await expect(card("actor-0")).toHaveAttribute("data-subagent-status", "done")
  await expect(card("actor-1")).toHaveAttribute("data-subagent-status", "error")
  await expect(card("actor-2")).toHaveAttribute("data-subagent-status", "cancelled")
  // The finished first turn folds its spawn records behind the turn divider;
  // open that fold before exercising the nested subagent disclosure.
  const turnDivider = page.locator("[data-turn-toggle]").first()
  await expect(turnDivider).toHaveAttribute("aria-expanded", "false")
  await turnDivider.focus(); await turnDivider.press("Enter")
  await expect(turnDivider).toHaveAttribute("aria-expanded", "true")
  const toggle = card("actor-0").locator("[data-subagent-toggle]")
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await toggle.focus(); await toggle.press("Enter")
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(card("actor-0").locator("[data-subagent-details]")).toBeVisible()
  await expect.poll(() => state.channels.has(`agent.${rootId}`)).toBe(true)
  const node = state.snapshot.nodes[1]
  Object.assign(node, { logical_state: "active", revision: { session_metadata_version: 8, actor_directory_revision: 3 },
    activation: { activation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", attempt: 2, status: "running" } })
  state.snapshot.stream_cursor = cursor(2); state.refresh()
  await expect(card("actor-0")).toHaveAttribute("data-subagent-status", "running")
  const beforeOldEvents = state.reads
  for (const status of ["completed", "cancelled", "error", "completed"]) state.emit({ type: "sub_agent_completed", parent_session_id: rootId, child_session_id: "actor-0", status })
  await expect.poll(() => state.reads).toBeGreaterThan(beforeOldEvents)
  await expect(card("actor-0")).toHaveAttribute("data-subagent-status", "running")
  const beforeReconnect = state.reads
  state.reconnect()
  await expect.poll(() => state.sockets).toBeGreaterThan(1)
  await expect.poll(() => state.reads).toBeGreaterThan(beforeReconnect)
  await expect(card("actor-0")).toHaveAttribute("data-subagent-status", "running")
  Object.assign(node, { logical_state: "cold", activation: { ...node.activation!, status: "succeeded" } })
  node.revision.session_metadata_version += 1; state.snapshot.stream_cursor = cursor(3); state.refresh()
  await expect(card("actor-0")).toHaveAttribute("data-subagent-status", "done")
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await toggle.focus(); await toggle.press("Space")
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(card("actor-0").locator("[data-subagent-details]")).toBeHidden()
  await expect(card("actor-2").locator("[data-subagent-toggle]")).toContainText("已取消")
  await expect(card("actor-2").locator("[data-subagent-toggle]")).not.toContainText("失败")
  await page.screenshot({ path: testInfo.outputPath("subagent-terminal-states.png"), animations: "disabled" })
  expect(state.observation.pageErrors).toEqual([])
  expect(state.observation.httpRequests.some(({ method, url }) => method === "POST" && /execute|dispatch/.test(new URL(url).pathname))).toBe(false)
})

test("a tree gap leaves running transcript cards and the subagent tree stationary until a covering read", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "The transcript and subagent tree must be visible together")
  const state = await fixture(page)
  const running = [state.snapshot.nodes[1], state.snapshot.nodes[3]]
  for (const node of running) {
    node.logical_state = "active"
    node.activation!.status = "running"
  }
  state.history.unshift(...Array.from({ length: 12 }, (_, index) => user(`Earlier turn ${index}`)))

  let heldReads = 0
  let waitForSnapshot: Promise<void> | undefined
  await page.route(`**/api/v1/actors/${rootId}/snapshot?*`, async (route) => {
    if (waitForSnapshot) {
      heldReads += 1
      await waitForSnapshot
    }
    await route.fulfill({ json: state.snapshot })
  })

  await page.goto(standaloneScenario.entryUrl)
  await page.getByRole("button", { name: "查看子代理树", exact: true }).click()
  const pane = page.locator("[data-subagents-pane]")
  const treeRow = pane.locator('[data-actor-id="actor-0"]')
  await expect(treeRow.locator("[data-actor-status]")).toHaveAttribute("data-actor-status", "running")

  const viewport = page.locator("[data-chat-body] [data-history-viewport]")
  const first = viewport.locator('[data-subagent-id="actor-0"]')
  const second = viewport.locator('[data-subagent-id="actor-2"]')
  const anchor = viewport.getByText("Second turn", { exact: true })
  await viewport.locator('[data-history-entry-key="collapsed-turn-answer-1"] [data-turn-toggle]').click()
  await expect(first).toHaveAttribute("data-subagent-status", "running")
  await expect(second).toHaveAttribute("data-subagent-status", "running")
  await first.locator("[data-subagent-toggle]").click()
  await expect(first).toBeInViewport()
  await expect(second).toBeInViewport()
  await expect(anchor).toBeInViewport()
  await expect.poll(() => state.treeSubscribed).toBe(true)
  await page.evaluate(async () => { await document.fonts.ready })
  await page.screenshot({ path: testInfo.outputPath("subagent-refresh-before.png"), animations: "disabled" })

  const elements = {
    viewport: await viewport.elementHandle(), first: await first.elementHandle(), second: await second.elementHandle(),
    anchor: await anchor.elementHandle(), treeRow: await treeRow.elementHandle(),
    treeScroll: await pane.locator("[data-actor-tree-scroll]").elementHandle(),
  }
  const frameProbe = await page.evaluateHandle(({ viewport, first, second, anchor, treeRow, treeScroll }) => {
    const round = (value: number) => Math.round(value)
    const sample = () => ({
      cards: [first, second].map((card) => ({
        connected: card.isConnected,
        status: card.getAttribute("data-subagent-status"),
        top: round(card.getBoundingClientRect().top),
        height: round(card.getBoundingClientRect().height),
      })),
      anchorConnected: anchor.isConnected,
      anchorTop: round(anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top),
      transcriptScroll: round(viewport.scrollTop),
      distanceFromBottom: round(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop),
      treeConnected: treeRow.isConnected,
      treeTop: round(treeRow.getBoundingClientRect().top),
      treeHeight: round(treeRow.getBoundingClientRect().height),
      treeViewportHeight: round(treeScroll.getBoundingClientRect().height),
      treeScroll: round(treeScroll.scrollTop),
    })
    const frames = [sample()]
    let nextFrame: number
    const collect = () => {
      frames.push(sample())
      nextFrame = requestAnimationFrame(collect)
    }
    nextFrame = requestAnimationFrame(collect)
    return { frames, stop: () => cancelAnimationFrame(nextFrame) }
  }, elements)
  const frameCount = () => frameProbe.evaluate(({ frames }) => frames.length)
  await expect.poll(frameCount).toBeGreaterThanOrEqual(2)
  const { before, startIndex } = await frameProbe.evaluate(({ frames }) => ({ before: frames.at(-1)!, startIndex: frames.length }))
  expect(before.transcriptScroll).toBeGreaterThan(0)
  expect(before.cards.every((card) => card.connected && card.status === "running" && card.height > 0)).toBe(true)

  let releaseSnapshot!: () => void
  waitForSnapshot = new Promise<void>((resolve) => { releaseSnapshot = resolve })
  try {
    state.snapshot.stream_cursor = cursor(2)
    state.refresh("gap")
    await expect.poll(() => heldReads).toBeGreaterThanOrEqual(2)
    await expect(pane.locator("[data-actor-gap]")).toBeVisible()
    await expect.poll(frameCount).toBeGreaterThanOrEqual(startIndex + 6)
    await expect(page.locator("[data-subagent-error]")).toBeVisible()
    const noticeIndex = await frameCount()
    await expect.poll(frameCount).toBeGreaterThanOrEqual(noticeIndex + 6)
    await page.screenshot({ path: testInfo.outputPath("subagent-refresh-held.png"), animations: "disabled" })
    const during = await frameProbe.evaluate(({ frames }, start) => frames.slice(start), startIndex)
    const firstChange = during.find((frame) => JSON.stringify(frame) !== JSON.stringify(before))
    expect(firstChange ?? before).toEqual(before)
    await expect(first.locator("[data-subagent-toggle]")).toHaveAttribute("aria-expanded", "true")
  } finally {
    running[0].logical_state = "cold"
    running[0].activation!.status = "succeeded"
    running[0].revision.actor_directory_revision = 3
    waitForSnapshot = undefined
    releaseSnapshot()
    await frameProbe.evaluate(({ stop }) => stop())
  }

  await expect(first).toHaveAttribute("data-subagent-status", "done")
  await expect(second).toHaveAttribute("data-subagent-status", "running")
  await expect(first.locator("[data-subagent-toggle]")).toHaveAttribute("aria-expanded", "true")
  await expect(pane.locator("[data-actor-gap]")).toHaveCount(0)
  await expect(treeRow.locator("[data-actor-status]")).toHaveAttribute("data-actor-status", "completed")
  await page.screenshot({ path: testInfo.outputPath("subagent-refresh-recovered.png"), animations: "disabled" })
  expect(state.observation.pageErrors).toEqual([])
})

test("repeated subagent refreshes preserve scrolled historical messages with the workbench closed", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Main transcript desktop reading regression")
  const state = await fixture(page)
  const child = state.snapshot.nodes[3]
  child.logical_state = "active"
  child.activation!.status = "running"
  const detail = "A saved observation from an earlier turn remains visible while the subagent works. "
  state.history.unshift(...Array.from({ length: 72 }, (_, index) => ({
    ...user(`earlier-reading-${index}`),
    content: `Earlier reading message ${index}${index % 3 === 0 ? `\n${detail.repeat(3 + index % 5).trim()}` : ""}`,
  })))

  let snapshotReads = 0
  let hold: Promise<void> | undefined
  await page.route(`**/api/v1/actors/${rootId}/snapshot?*`, async (route) => {
    snapshotReads += 1
    await hold
    await route.fulfill({ json: state.snapshot })
  })
  await page.goto(standaloneScenario.entryUrl)
  const workbench = page.locator("#right-workbench")
  const viewport = page.locator("[data-chat-body] [data-history-viewport]")
  const card = viewport.locator('[data-subagent-id="actor-2"]')
  await expect(workbench).toBeHidden()
  await expect(card).toHaveAttribute("data-subagent-status", "running")
  await expect.poll(() => state.treeCursor).toBe(cursor(1))
  await viewport.hover()
  await page.mouse.wheel(0, -1040)
  await expect(page.getByRole("button", { name: "滚动到底部", exact: true })).toBeVisible()
  const anchorText = await viewport.evaluate((element) => {
    const { top, bottom } = element.getBoundingClientRect()
    return [...element.querySelectorAll('[data-message-role="user"]')].find((message) => {
      const bounds = message.getBoundingClientRect()
      return message.textContent?.startsWith("Earlier reading message ") && bounds.top >= top + 40 && bounds.bottom <= bottom
    })?.textContent
  })
  expect(anchorText).toBeTruthy()
  const anchor = viewport.getByText(anchorText!, { exact: true })
  await expect(anchor).toBeInViewport()
  await page.evaluate(async () => { await document.fonts.ready })

  const trace = await page.evaluateHandle(({ viewport, anchor }) => {
    const sample = () => ({
      connected: anchor.isConnected,
      textTop: Math.round(anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top),
      scrollTop: Math.round(viewport.scrollTop),
      scrollHeight: viewport.scrollHeight,
      viewportHeight: viewport.clientHeight,
    })
    const samples = [sample()]
    let frame: number
    const collect = () => {
      samples.push(sample())
      frame = requestAnimationFrame(collect)
    }
    frame = requestAnimationFrame(collect)
    return { samples, stop: () => cancelAnimationFrame(frame) }
  }, { viewport: await viewport.elementHandle(), anchor: await anchor.elementHandle() })
  const frameCount = () => trace.evaluate(({ samples }) => samples.length)
  await expect.poll(frameCount).toBeGreaterThanOrEqual(6)
  const { baseline, startIndex } = await trace.evaluate(({ samples }) => ({ baseline: samples.at(-1)!, startIndex: samples.length }))
  expect(baseline.scrollTop).toBeGreaterThan(0)
  expect(baseline.scrollHeight - baseline.scrollTop - baseline.viewportHeight).toBeGreaterThan(500)

  const notice = page.locator("[data-subagent-error]")
  const noticeLayouts: Array<{ inTranscript: boolean; position: string }> = []
  const stopTrace = () => trace.evaluate(({ samples, stop }, start) => {
    stop()
    return samples.slice(start)
  }, startIndex)
  let during: Awaited<ReturnType<typeof stopTrace>>
  try {
    for (const revision of [2, 3, 4]) {
      const previousReads = snapshotReads
      let release!: () => void
      hold = new Promise<void>((resolve) => { release = resolve })
      try {
        state.snapshot.stream_cursor = cursor(revision)
        state.refresh("gap")
        await expect.poll(() => snapshotReads).toBeGreaterThan(previousReads)
        await expect(notice).toBeVisible()
        const noticeIndex = await frameCount()
        await expect.poll(frameCount).toBeGreaterThanOrEqual(noticeIndex + 6)
        noticeLayouts.push(await notice.evaluate((element) => ({
          inTranscript: !!element.closest("[data-history-viewport]"), position: getComputedStyle(element.parentElement!).position,
        })))
        if (revision === 2) await page.screenshot({ path: testInfo.outputPath("subagent-refresh-closed-held.png"), animations: "disabled" })
        await expect(workbench).toBeHidden()
      } finally {
        hold = undefined
        release()
      }
      await expect.poll(() => state.treeCursor).toBe(cursor(revision))
      await expect(notice).toHaveCount(0)
    }
  } finally {
    during = await stopTrace()
    await testInfo.attach("historical-message-refresh-frames", {
      body: JSON.stringify({ anchorText, baseline, during, noticeLayouts }), contentType: "application/json",
    })
  }
  const firstChange = during.find((frame) => JSON.stringify(frame) !== JSON.stringify(baseline))
  expect(firstChange ?? baseline).toEqual(baseline)
  expect(noticeLayouts).toEqual(Array(3).fill({ inTranscript: false, position: "absolute" }))
  await page.getByRole("button", { name: "滚动到底部", exact: true }).click()
  await expect(card).toHaveAttribute("data-subagent-status", "running")
  expect(state.observation.pageErrors).toEqual([])
})

test("new turns, status refreshes and reload keep old cards at their originating activity", async ({ page }, testInfo) => {
  const state = await fixture(page)
  await page.goto(standaloneScenario.entryUrl)
  const origin = (id: string) => page.locator(`[data-subagent-id="${id}"]`).first().evaluate((node) => node.closest("[data-history-entry-key]")?.getAttribute("data-history-entry-key"))
  // The finished first turn folds its middle behind the divider keyed by the
  // turn's summary; the spawn records and their cards live inside that fold.
  await expect.poll(() => origin("actor-0")).toBe("collapsed-turn-answer-1")
  await expect.poll(() => origin("actor-1")).toBe("collapsed-turn-answer-1")
  await expect.poll(() => origin("actor-2")).toBe("activity-create-3")
  // Reveal the folded middle before interacting with its cards.
  await page.locator('[data-history-entry-key="collapsed-turn-answer-1"] [data-turn-toggle]').click()
  const toggle = page.locator('[data-subagent-id="actor-0"] [data-subagent-toggle]').first()
  await toggle.click()
  const ids = await page.locator('[data-history-entry-key="collapsed-turn-answer-1"] [data-subagent-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-subagent-id")))
  state.history.push(user("Third turn"), { id: "tasks", role: "assistant", content: "", created_at: at,
    tool_calls: [{ id: "tasks", function: { name: "TaskList", arguments: "{}" } }] })
  await expect.poll(() => state.channels.has(`agent.${rootId}`)).toBe(true)
  state.emit({ type: "message_appended", session_id: rootId })
  await expect(page.getByText("Third turn", { exact: true })).toBeVisible()
  await expect.poll(() => origin("actor-0")).toBe("collapsed-turn-answer-1")
  expect(await page.locator('[data-history-entry-key="collapsed-turn-answer-1"] [data-subagent-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-subagent-id")))).toEqual(ids)
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await page.reload()
  // Like ordinary tool expansion, this choice belongs to the mounted conversation.
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect.poll(() => origin("actor-0")).toBe("collapsed-turn-answer-1")
  await expect.poll(() => origin("actor-2")).toBe("activity-create-3")
  await page.screenshot({ path: testInfo.outputPath("subagent-stable-turns.png"), animations: "disabled" })
  expect(state.observation.pageErrors).toEqual([])
})

test("a denied snapshot shows unconfirmed states and an explicit retry", async ({ page }) => {
  const state = await fixture(page); state.setDenied(true)
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.locator("[data-subagent-error]")).toBeVisible()
  await expect(page.locator('[data-subagent-id="actor-0"]').first()).toHaveAttribute("data-subagent-status", "unknown")
  state.setDenied(false)
  await page.getByRole("button", { name: "刷新代理状态" }).click()
  await expect(page.locator('[data-subagent-id="actor-0"]').first()).toHaveAttribute("data-subagent-status", "done")
  await expect(page.locator("[data-subagent-error]")).toHaveCount(0)
})

test("an expanded child follows its creating activity from live output to recorded history", async ({ page }) => {
  const state = await fixture(page)
  state.history.splice(1)
  await page.goto(standaloneScenario.entryUrl)
  const transcript = page.locator("[data-message-list-content]")
  await expect(transcript.getByText("First turn", { exact: true })).toBeVisible()
  await expect.poll(() => state.channels.has(`agent.${rootId}`)).toBe(true)

  const birthCall = "handoff-create"
  state.emit({ type: "tool_start", tool_call_id: birthCall, tool_name: "sub_agent", arguments: { action: "create" } })
  state.emit({ type: "tool_complete", tool_call_id: birthCall, result: { success: true, result: JSON.stringify({ child_session_id: "actor-0" }) } })
  state.emit({ type: "token", content: "Birth answer" })

  const card = transcript.locator('[data-subagent-id="actor-0"]')
  const toggle = card.locator("[data-subagent-toggle]")
  await expect(transcript.locator('[data-process-activity] + [data-subagent-group] [data-subagent-id="actor-0"]')).toBeVisible()
  await expect(transcript.locator('[data-history-entry-key] [data-subagent-id="actor-0"]')).toHaveCount(0)
  await expect(card).toHaveCount(1)
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(transcript.getByText("Birth answer", { exact: true })).toBeVisible()
  expect(await card.evaluate((node) => {
    const answer = [...node.closest("[data-message-list-content]")!.querySelectorAll('[data-message-role="assistant"]')]
      .find((body) => body.textContent === "Birth answer")
    return !!answer && !!(node.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING)
  })).toBe(true)

  state.history.push(...spawn(birthCall, "actor-0"), {
    id: "birth-summary", role: "assistant", phase: "final_answer", content: "Birth answer", created_at: at,
  })
  state.finishRun()
  state.emit({ type: "complete", content: "" })
  state.emit({ type: "message_appended", session_id: rootId })
  const fold = transcript.locator('[data-history-entry-key="collapsed-turn-birth-summary"]')
  await expect(fold.locator('[data-subagent-id="actor-0"]')).toHaveCount(1)
  await expect(card).toHaveCount(1)
  await fold.locator("[data-turn-toggle]").click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  const persistedCard = await card.elementHandle()

  const actor = state.snapshot.nodes[1]
  Object.assign(actor, { logical_state: "active", revision: { session_metadata_version: 8, actor_directory_revision: 3 },
    activation: { activation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", attempt: 2, status: "running" } })
  state.snapshot.stream_cursor = cursor(2)
  state.refresh()
  await expect(card).toHaveAttribute("data-subagent-status", "running")
  expect(await card.evaluate((element, original) => element === original, persistedCard)).toBe(true)
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await toggle.click()
  Object.assign(actor, { logical_state: "cold", activation: { ...actor.activation!, status: "cancelled" } })
  actor.revision.session_metadata_version += 1
  state.snapshot.stream_cursor = cursor(3)
  state.refresh()
  await expect(card).toHaveAttribute("data-subagent-status", "cancelled")
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(fold.locator('[data-subagent-id="actor-0"]')).toHaveCount(1)
  expect(state.observation.pageErrors).toEqual([])
})

test("child expansion survives virtual row removal and opens the original transcript only on demand", async ({ page }, testInfo) => {
  const state = await fixture(page)
  await page.goto(standaloneScenario.entryUrl)
  // Reveal the finished first turn's folded middle before using its cards.
  await page.locator("[data-turn-toggle]").first().click()
  const card = page.locator('[data-subagent-id="actor-0"]').first()
  const toggle = card.locator("[data-subagent-toggle]")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  const childReads = () => state.requests.filter((url) => ["/api/v1/history/actor-0", "/api/v1/sessions/actor-0/history"].includes(new URL(url).pathname)).length
  expect(childReads()).toBe(0)
  state.history.push(...Array.from({ length: 100 }, (_, index) => user(`Later turn ${index}: keep independent child choices`)))
  await expect.poll(() => state.channels.has(`agent.${rootId}`)).toBe(true)
  state.emit({ type: "message_appended", session_id: rootId })
  const content = page.locator("[data-message-list-content]")
  await expect(page.getByText("Later turn 99: keep independent child choices", { exact: true })).toBeAttached()
  await content.evaluate((node) => { node.parentElement!.scrollTop = node.parentElement!.scrollHeight })
  await expect(card).toHaveCount(0)
  // Release the existing bottom pin through actual reader input.
  await content.locator("..").hover({ position: { x: 32, y: 12 } })
  await page.mouse.wheel(0, -100000)
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(card.locator("[data-subagent-details]")).toBeVisible()
  expect(childReads()).toBe(0)
  const bounds = await toggle.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: testInfo.outputPath("subagent-expanded-stable.png"), animations: "disabled" })
  const mainHeading = page.locator('header[role="banner"] h1')
  const activeTitle = await mainHeading.textContent()
  await card.getByRole("button", { name: /打开 .* 的会话/ }).click()
  await expect(page.locator("#right-workbench").getByText("Child transcript", { exact: true })).toBeVisible()
  await expect(mainHeading).toHaveText(activeTitle!)
  expect(childReads()).toBeGreaterThan(0)
  expect(state.requests.some((url) => new URL(url).pathname === "/api/v1/history/actor-0")).toBe(false)
  expect(state.observation.pageErrors).toEqual([])
})

test("unknown origins stay unanchored and keyboard-expandable", async ({ page }, testInfo) => {
  const state = await fixture(page)
  state.history.splice(1, 2)
  await page.goto(standaloneScenario.entryUrl)
  const card = page.locator('[data-subagent-id="actor-0"]').first()
  await expect(card).toHaveAttribute("data-subagent-status", "done")
  expect(await card.evaluate((node) => node.closest("[data-history-entry-key]")?.getAttribute("data-history-entry-key") ?? null)).toBeNull()
  await expect(card.locator("..", { has: page.getByText("无法确认发起轮次。", { exact: true }) })).toBeVisible()
  const toggle = card.locator("[data-subagent-toggle]")
  await toggle.focus(); await toggle.press("Space")
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await page.screenshot({ path: testInfo.outputPath("subagent-unanchored-expanded.png"), animations: "disabled" })
  expect(state.observation.pageErrors).toEqual([])
})
