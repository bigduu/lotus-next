import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

// Regression: a finished turn folds behind its divider while the entry count can
// stay unchanged (activity-*/message-* → collapsed-turn-*). react-virtual keeps
// stale per-key sizes for earlier indexes, so a long report rendered at a 220px
// estimate let every later row land inside it (rows overlapping, the reading
// flow broken). MessageList now re-measures every mounted row whenever the
// entry key sequence changes in any way.
const sessionId = "all-surface-session"
const at = (second: number) => `2026-10-06T00:${String(Math.floor(second / 60)).padStart(2, "0")}:${String(second % 60).padStart(2, "0")}.000Z`

function makeSession() {
  return {
    id: sessionId, title: "Turn fold measurement regression", title_version: 1, kind: "root",
    parent_session_id: null, root_session_id: sessionId, spawn_depth: 0,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: at(0), updated_at: at(200), last_activity_at: at(200), message_count: 4,
    subagent_count: 0, is_running: false, last_run_status: "completed", permission_mode: "default",
    bypass_permissions: false, root_orchestration_only: false, thinking_mode: "standard",
    reasoning_effort: "medium", root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
  }
}

function reportBody(index: number): string {
  const rows = Array.from({ length: 6 }, (_, r) => `| PR #${index}${r} | 注释 +${20 + r} | claim \`new-cur-${r}\` 说明文字 |`).join("\n")
  return [
    `## 交付总结 ${index}`, "", "收到, 4 个注释 PR 先过 review 再实现。",
    "", "| 类型 | 内容 | 备注 |", "| --- | --- | --- |", rows,
    "", "当前状态:", "", "| 项 | 状态 |", "| --- | --- |", "| #2434 | 已触发 |",
  ].join("\n")
}

const initialHistory = [
  { id: "u1", role: "user", content: "整理 4 个拆分 Issue", created_at: at(0) },
  { id: "c1", role: "assistant", content: "", created_at: at(1),
    tool_calls: [{ id: "t1", function: { name: "Read", arguments: JSON.stringify({ file_path: "/tmp/a.md" }) } }] },
  { id: "r1", role: "tool", tool_call_id: "t1", content: "Read complete.", created_at: at(2) },
  { id: "m1", role: "assistant", content: reportBody(1), created_at: at(3) },
  { id: "final1", role: "assistant", content: reportBody(2), created_at: at(4) },
]

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const session = makeSession()
  const observation = await installArtifactRuntime(page, standaloneScenario, initialHistory)
  const history = [...initialHistory]
  let socket: WebSocketRoute | undefined
  let sequence = 0
  let subscriptions = 0
  await page.routeWebSocket(/.*/, (webSocket) => {
    socket = webSocket
    webSocket.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
      if (frame.type === "hello") webSocket.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") webSocket.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch === `agent.${sessionId}`) subscriptions += 1
    })
  })
  await page.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === "/api/v1/sessions") {
      const children = new URL(route.request().url()).searchParams.get("kind") === "child"
      return route.fulfill({ json: { sessions: children ? [] : [session], total: children ? 0 : 1, limit: 200, offset: 0 } })
    }
    if (pathname === `/api/v1/sessions/${sessionId}`) return route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
    if (pathname === `/api/v1/history/${sessionId}`) return route.fulfill({ json: { session_id: sessionId, messages: history } })
    if (pathname === "/api/v1/chat") {
      history.push({ id: "u2", role: "user", content: route.request().postDataJSON().message, created_at: at(60) })
      session.is_running = true; session.last_run_status = "running"
      return route.fulfill({ json: { session_id: sessionId, status: "success", message_id: "u2" } })
    }
    if (pathname === `/api/v1/execute/${sessionId}`) return route.fulfill({ json: { status: "started", session_id: sessionId } })
    if (pathname === `/api/v1/task/${sessionId}`) return route.fulfill({ json: { session_id: sessionId, items: [] } })
    await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  return {
    observation,
    emit: (event: Record<string, unknown>) => socket!.send(JSON.stringify({ ch: `agent.${sessionId}`, seq: ++sequence, event })),
    get subscriptions() { return subscriptions },
    // The owning connection dies without terminal frames; the session list poll
    // then reports not-running and the UI concludes generation was interrupted.
    interrupt: () => { session.is_running = false; session.last_run_status = "stopped" },
  }
}

type RowGeometry = Array<{ key: string; top: number; bottom: number }>

test("a folded turn never lets later rows overlap the long final report", async ({ page }) => {
  const state = await setup(page)
  const transcript = page.locator("[data-message-list-content]").first()
  await expect(transcript).toContainText("交付总结 2")

  await page.getByRole("textbox", { name: "消息", exact: true }).fill("触发 review")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => state.subscriptions).toBe(1)

  // Live reasoning + a tool, then stream a long report and interrupt mid-run.
  state.emit({ type: "reasoning_token", content: "先检查 4 个 PR 的状态。" })
  state.emit({ type: "tool_start", tool_call_id: "t2", tool_name: "Grep", arguments: { pattern: "fold" } })
  state.emit({ type: "tool_complete", tool_call_id: "t2", result: { success: true, result: "Grep done." } })
  for (const chunk of (reportBody(4) + "\n\n" + reportBody(5)).match(/[\s\S]{1,40}/g) ?? []) {
    state.emit({ type: "token", content: chunk })
  }
  await expect(transcript.locator('[data-message-role="assistant"]').last()).toContainText("交付总结 5")

  state.interrupt()
  await expect(page.getByRole("alert")).toContainText("消息已发送，但生成中断", { timeout: 15_000 })

  // Rows must never interleave, both immediately and after measurement settles.
  const readRows = () => page.evaluate(
    "[...document.querySelectorAll('[data-history-entry-key]')].map((el) => ({ key: el.getAttribute('data-history-entry-key') ?? '', top: Math.round(el.getBoundingClientRect().top), bottom: Math.round(el.getBoundingClientRect().bottom) }))",
  )
  const expectNoOverlap = async () => {
    const rows = (await readRows()) as RowGeometry
    expect(rows.length).toBeGreaterThan(1)
    const sorted = [...rows].sort((a, b) => a.top - b.top)
    for (let index = 1; index < sorted.length; index += 1) {
      expect(
        sorted[index]!.top,
        `row ${sorted[index]!.key} must not overlap ${sorted[index - 1]!.key}`,
      ).toBeGreaterThanOrEqual(sorted[index - 1]!.bottom - 2)
    }
  }
  await expectNoOverlap()
  await page.waitForTimeout(1_500)
  await expectNoOverlap()
  await page.waitForTimeout(1_500)
  await expectNoOverlap()

  expect(state.observation.pageErrors).toEqual([])
  expect(state.observation.consoleErrors).toEqual([])
})
