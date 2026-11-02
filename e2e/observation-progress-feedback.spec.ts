import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { currentPermission, exhaustedHistory, exhaustedMarker, legacyProgressQuestion, legacyQuestionId,
  legacyQuestionText, pairedProgressHistory, progressAt as at, progressSessionId as sid, unfinishedSummary } from "../src/test/fixtures/observationProgress.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

type Phase = "running" | "exhausted" | "legacy" | "permission"
async function prepare(page: Page, initial: Phase) {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", id)
  }, sid)
  const observation = await installArtifactRuntime(page, standaloneScenario, [], { bootstrapRequestState: "local_bypass" })
  let phase = initial, socket: WebSocketRoute | undefined, seq = 0, connections = 0, pendingReads = 0
  const channels = new Set<string>(), writes: { path: string; body: unknown }[] = []
  let history = initial === "running" ? pairedProgressHistory(0) : initial === "legacy" ? [
    ...pairedProgressHistory(1), { id: legacyQuestionId, role: "assistant" as const, content: legacyQuestionText,
      metadata: { runtime_kind: "observation_progress_pause" }, created_at: at },
  ] : exhaustedHistory()
  const session = () => ({ id: sid, title: "Progress feedback consumer", kind: "root", title_version: 1,
    root_session_id: sid, parent_session_id: null, spawn_depth: 0, pinned: false,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: at, updated_at: at, last_activity_at: at, message_count: history.length,
    permission_mode: "default", bypass_permissions: false, root_orchestration_only: false,
    thinking_mode: "standard", root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
    is_running: phase === "running", last_run_status: phase === "running" ? "running" : phase === "exhausted" ? "completed" : "suspended",
    has_pending_question: phase === "legacy" || phase === "permission",
    metadata: { "runtime.completion_reason": exhaustedMarker },
  })
  await page.routeWebSocket(/.*/, (ws) => {
    socket = ws; connections += 1
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
      if (frame.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch) channels.add(frame.ch)
    })
  })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== "GET") writes.push({ path, body: request.postData() ? request.postDataJSON() : null })
    if (path === "/api/v1/sessions") return route.fulfill({ json: { sessions: new URL(request.url()).searchParams.get("kind") === "child" ? [] : [session()], total: 1, limit: 200, offset: 0 } })
    if (path === `/api/v1/sessions/${sid}`) return route.fulfill({ json: { session: session() }, headers: { ETag: '"1"' } })
    if (path === `/api/v1/history/${sid}`) return route.fulfill({ json: { session_id: sid, messages: history } })
    if (path === `/api/v1/task/${sid}`) return route.fulfill({ json: { session_id: sid, items: [] } })
    if (path === `/api/v1/actors/${sid}/snapshot`) return route.fulfill({ json: actorSnapshotFixture(sid, 0) })
    if (path === `/api/v1/respond/${sid}/pending`) {
      pendingReads += 1
      return route.fulfill({ json: phase === "legacy" ? legacyProgressQuestion() : phase === "permission" ? currentPermission() : { has_pending_question: false } })
    }
    if (path === `/api/v1/respond/${sid}` && request.method() === "POST") {
      phase = request.postDataJSON().response === "Stop" ? "exhausted" : "running"
      return route.fulfill({ json: { success: true, auto_resume_status: phase === "exhausted" ? "completed" : "started" } })
    }
    if (path === `/api/v1/sessions/${sid}/permission-decisions` && request.method() === "POST") {
      phase = "exhausted"
      return route.fulfill({ json: { success: true, replayed: false,
        receipt: { session_id: sid, decision: request.postDataJSON() },
        auto_resume_status: "completed", resume: { success: true, auto_resume_status: "completed" } } })
    }
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("textbox", { name: "Messages", exact: true })).toBeAttached()
  return { observation, writes, channels, get connections() { return connections }, get pendingReads() { return pendingReads },
    setPhase(value: Phase) { phase = value; if (value === "permission") history = exhaustedHistory() },
    disconnect() { return socket!.close({ code: 1012, reason: "fixture in-place websocket reconnect" }) },
    emit(event: unknown) { socket!.send(JSON.stringify({ ch: `agent.${sid}`, seq: ++seq, event })) },
    exhaust() { phase = "exhausted"; history = exhaustedHistory() },
    terminal() { socket!.send(JSON.stringify({ ch: `agent.${sid}`, seq: ++seq, control: { type: "terminal" } })) },
    committedFeed() { socket!.send(JSON.stringify({ ch: "feed", seq: 1, event: { seq: 1, ts: at,
      session_id: sid, event: { type: "message_appended", session_id: sid, message_id: "runtime-unfinished-summary" } } })) },
  }
}

test("#2016 new feedback has no pending dialog and exhaustion renders one honest ordinary summary", async ({ page }, info) => {
  const f = await prepare(page, "running")
  await expect.poll(() => f.channels.has(`agent.${sid}`)).toBe(true)
  const stop = page.getByRole("button", { name: "Stop generation", exact: true })
  await expect(stop).toBeVisible()
  for (let index = 0; index < 6; index++) {
    f.emit({ type: "tool_start", tool_call_id: `read-${index}`, tool_name: "Read", arguments: { file_path: "/fixture/evidence.txt" } })
    f.emit({ type: "tool_complete", tool_call_id: `read-${index}`, result: { success: true, result: "Unchanged fixture evidence" } })
  }
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(f.writes).toEqual([])
  f.exhaust()
  f.emit({ type: "session_history_committed", session_id: sid })
  f.emit({ type: "complete" })
  f.terminal()
  await expect.poll(() => f.channels.has("feed")).toBe(true)
  f.committedFeed()
  await expect(page.getByText(unfinishedSummary, { exact: true })).toHaveCount(1)
  await expect(stop).toBeHidden()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  // The finished turn folds its evidence rounds behind one divider; the
  // summary stays in reading flow. Open the fold, then the process layer.
  const divider = page.locator("[data-turn-toggle]")
  await expect(divider).toHaveAttribute("aria-expanded", "false")
  await divider.click()
  await page.locator("[data-process-toggle]").first().click()
  await expect(page.locator("[data-tool-call-entry-toggle]")).toHaveCount(6)
  expect(f.writes).toEqual([])
  expect(f.pendingReads).toBeGreaterThan(0)
  expect(f.observation.pageErrors).toEqual([])
  await page.screenshot({ path: info.outputPath("exhausted-without-clarification.png"), animations: "disabled" })
})
for (const answer of ["Continue", "Stop", "Inspect different evidence"]) {
  test(`#2016 persisted progress question waits for explicit ${answer} and sends the guarded identity once`, async ({ page }, info) => {
    const f = await prepare(page, "legacy")
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(legacyQuestionText)
    await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
    expect(f.writes).toEqual([])
    if (answer === "Continue") await page.screenshot({ path: info.outputPath("persisted-progress-awaits-human.png"), animations: "disabled" })
    if (answer === "Continue" || answer === "Stop") await dialog.getByRole("button", { name: answer, exact: true }).click()
    else {
      await dialog.getByPlaceholder("Or type a custom response…", { exact: true }).fill(answer)
      await dialog.getByRole("button", { name: "Submit answer", exact: true }).click()
    }
    await expect(dialog).toHaveCount(0)
    expect(f.writes).toEqual([{ path: `/api/v1/respond/${sid}`, body: { response: answer, expected_tool_call_id: legacyQuestionId } }])
    expect(f.observation.pageErrors).toEqual([])
  })
}
test("#2016 reconnect reads canonical generation and exhaustion metadata cannot hide a true permission", async ({ page }, info) => {
  const f = await prepare(page, "legacy")
  await expect(page.getByRole("dialog")).toContainText(legacyQuestionText)
  expect(f.writes).toEqual([])
  const before = f.pendingReads
  f.setPhase("permission")
  await page.reload()
  const approval = page.locator("[data-approval-presentation]")
  await expect(approval).toContainText("Canonical permission generation 2")
  await expect(page.getByText(unfinishedSummary, { exact: true })).toHaveCount(1)
  await expect.poll(() => f.connections).toBeGreaterThanOrEqual(2)
  expect(f.pendingReads).toBeGreaterThan(before)
  await expect(approval.locator("textarea")).toHaveCount(0)
  await expect(approval.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0)
  await expect(approval).toBeFocused()
  await page.keyboard.press("Enter")
  expect(f.writes).toEqual([])
  await page.screenshot({ path: info.outputPath("canonical-permission-after-reconnect.png"), animations: "disabled" })
  await approval.getByRole("button", { name: "Deny once", exact: true }).click()
  await expect(approval).toHaveCount(0)
  expect(f.writes).toEqual([{ path: `/api/v1/sessions/${sid}/permission-decisions`, body: {
    request_id: "fixture-permission-2", request_generation: "opaque-generation-2", expected_policy_revision: 9, decision: "deny_once",
  } }])
  await page.reload()
  await expect.poll(() => f.pendingReads).toBeGreaterThan(before + 1)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(f.writes).toHaveLength(1)
  expect(f.observation.pageErrors).toEqual([])
})


test("#2016 in-place socket reconnect replaces stale progress with canonical permission then absence", async ({ page }, info) => {
  let navigations = 0
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations += 1 })
  const f = await prepare(page, "legacy")
  await expect(page.getByRole("dialog")).toContainText(legacyQuestionText)
  const before = f.pendingReads
  f.setPhase("permission")
  await f.disconnect()
  await expect.poll(() => f.connections).toBeGreaterThanOrEqual(2)
  const approval = page.locator("[data-approval-presentation]")
  await expect(approval).toContainText("Canonical permission generation 2")
  expect(f.pendingReads).toBeGreaterThan(before)
  expect(f.writes).toEqual([])
  await expect(approval.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0)
  await expect(approval.locator("textarea")).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("permission-after-in-place-reconnect.png"), animations: "disabled" })
  const confirmedReads = f.pendingReads
  f.setPhase("exhausted")
  await f.disconnect()
  await expect.poll(() => f.connections).toBeGreaterThanOrEqual(3)
  await expect.poll(() => f.pendingReads).toBeGreaterThan(confirmedReads)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByText(unfinishedSummary, { exact: true })).toBeVisible()
  expect(f.writes).toEqual([])
  expect(navigations).toBe(1)
  expect(f.observation.pageErrors).toEqual([])
  await page.screenshot({ path: info.outputPath("canonical-none-after-second-in-place-reconnect.png"), animations: "disabled" })
})
