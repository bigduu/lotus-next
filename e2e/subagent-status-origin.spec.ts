import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const rootId = "all-surface-session", at = "2026-10-16T00:00:00Z"
const cursor = (revision: number) => `at1-${"a".repeat(64)}-${revision}`
const user = (id: string) => ({ id, role: "user", content: id, created_at: at })
const spawn = (id: string, childId: string) => [{
  id, role: "assistant", content: "", created_at: at,
  tool_calls: [{ id, function: { name: "sub_agent", arguments: JSON.stringify({ action: "create", title: childId }) } }],
}, { id: `${id}-result`, role: "tool", tool_call_id: id, content: JSON.stringify({ child_session_id: childId, parent_session_id: rootId }), tool_success: true, created_at: at }]

async function fixture(page: Page) {
  await page.addInitScript((id) => { localStorage.setItem("bodhi_onboarded_v1", "1"); localStorage.setItem("lotus_next_last_session", id) }, rootId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
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
  const history: unknown[] = [user("First turn"), ...spawn("create-1", "actor-0"), ...spawn("create-2", "actor-1"),
    { id: "answer-1", role: "assistant", content: "First turn answer", created_at: at },
    user("Second turn"), ...spawn("create-3", "actor-2")]
  let socket: WebSocketRoute | undefined, sockets = 0, sequence = 0, reads = 0, denied = false
  let treeChannel: string | undefined
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
    if (path === "/api/v1/runs/active") return route.fulfill({ json: { sessions: [{ session_id: rootId, run_id: "fixture-parent", started_at: at, round_count: 1, last_critical_events: [], running_child_session_ids: rows.slice(1).map((row) => row.id) }] } })
    return route.fallback()
  })
  return { snapshot, history, observation, channels,
    get reads() { return reads }, get sockets() { return sockets },
    setDenied(value: boolean) { denied = value },
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

test("new turns, status refreshes and reload keep old cards at their originating activity", async ({ page }, testInfo) => {
  const state = await fixture(page)
  await page.goto(standaloneScenario.entryUrl)
  const origin = (id: string) => page.locator(`[data-subagent-id="${id}"]`).first().evaluate((node) => node.closest("[data-history-entry-key]")?.getAttribute("data-history-entry-key"))
  await expect.poll(() => origin("actor-0")).toBe("activity-create-1")
  await expect.poll(() => origin("actor-1")).toBe("activity-create-1")
  await expect.poll(() => origin("actor-2")).toBe("activity-create-3")
  const toggle = page.locator('[data-subagent-id="actor-0"] [data-subagent-toggle]').first()
  await toggle.click()
  const ids = await page.locator('[data-history-entry-key="activity-create-1"] [data-subagent-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-subagent-id")))
  state.history.push(user("Third turn"), { id: "tasks", role: "assistant", content: "", created_at: at,
    tool_calls: [{ id: "tasks", function: { name: "TaskList", arguments: "{}" } }] })
  await expect.poll(() => state.channels.has(`agent.${rootId}`)).toBe(true)
  state.emit({ type: "message_appended", session_id: rootId })
  await expect(page.getByText("Third turn", { exact: true })).toBeVisible()
  await expect.poll(() => origin("actor-0")).toBe("activity-create-1")
  expect(await page.locator('[data-history-entry-key="activity-create-1"] [data-subagent-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-subagent-id")))).toEqual(ids)
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await page.reload()
  // Like ordinary tool expansion, this choice belongs to the mounted conversation.
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect.poll(() => origin("actor-0")).toBe("activity-create-1")
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

test("child expansion survives virtual row removal and opens the original transcript only on demand", async ({ page }, testInfo) => {
  const state = await fixture(page)
  await page.goto(standaloneScenario.entryUrl)
  const card = page.locator('[data-subagent-id="actor-0"]').first()
  const toggle = card.locator("[data-subagent-toggle]")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  const childReads = () => state.observation.httpRequests.filter(({ url }) => ["/api/v1/history/actor-0", "/api/v1/sessions/actor-0/history"].includes(new URL(url).pathname)).length
  expect(childReads()).toBe(0)
  state.history.push(...Array.from({ length: 100 }, (_, index) => user(`Later turn ${index}: keep independent child choices`)))
  await expect.poll(() => state.channels.has(`agent.${rootId}`)).toBe(true)
  state.emit({ type: "message_appended", session_id: rootId })
  const content = page.locator("[data-message-list-content]")
  await expect(page.getByText("Later turn 99: keep independent child choices", { exact: true })).toBeAttached()
  await content.evaluate((node) => { node.parentElement!.scrollTop = node.parentElement!.scrollHeight })
  await expect(card).toHaveCount(0)
  // Release the existing bottom pin through actual reader input.
  await content.locator("..").hover({ position: { x: 12, y: 12 } })
  await page.mouse.wheel(0, -100000)
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(card.locator("[data-subagent-details]")).toBeVisible()
  expect(childReads()).toBe(0)
  const bounds = await toggle.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: testInfo.outputPath("subagent-expanded-stable.png"), animations: "disabled" })
  await card.getByRole("button", { name: /打开 .* 的会话/ }).click()
  await expect(page.getByText("Child transcript", { exact: true })).toBeVisible()
  expect(childReads()).toBeGreaterThan(0)
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
