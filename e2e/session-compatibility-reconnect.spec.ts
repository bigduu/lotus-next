import { expect, test, type WebSocketRoute } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

test("#2077 in-place websocket recovery rereads compatibility and never replays the draft", async ({ page }, info) => {
  const id = "all-surface-session", at = "2026-10-19T08:00:00Z"
  await page.addInitScript((sid) => {
    localStorage.setItem("bodhi_onboarded_v1", "1"); localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", sid)
  }, id)
  const observation = await installArtifactRuntime(page, standaloneScenario, [], { bootstrapRequestState: "local_bypass" })
  let status: "compatible" | "conflict" | "legacy_compatible" = "compatible"
  let socket: WebSocketRoute | undefined, connections = 0, navigations = 0, detailReads = 0
  const writes: { path: string; body: unknown }[] = []
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations += 1 })
  await page.routeWebSocket(/.*/, (ws) => {
    socket = ws; connections += 1
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string }
      if (frame.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
    })
  })
  const session = { id, title: "Compatibility reconnect", kind: "root", title_version: 1, pinned: false,
    root_session_id: id, parent_session_id: null, spawn_depth: 0, model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" }, created_at: at, updated_at: at,
    last_activity_at: at, message_count: 1, is_running: false, last_run_status: "completed", has_pending_question: false,
    permission_mode: "default", bypass_permissions: false, thinking_mode: "standard", root_orchestration_only: false,
    root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64) }
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== "GET") writes.push({ path, body: request.postData() ? request.postDataJSON() : null })
    if (path === "/api/v1/sessions") return route.fulfill({ json: { sessions: new URL(request.url()).searchParams.get("kind") === "child" ? [] : [session], total: 1, limit: 200, offset: 0 } })
    if (path === `/api/v1/sessions/${id}`) {
      detailReads += 1
      return route.fulfill({ json: { session: { ...session, execution_compatibility: {
        session_version: status === "legacy_compatible" ? null : status === "conflict" ? 99 : 1,
        current_session_version: 1, status, history_readable: true, execution_allowed: status !== "conflict",
        conflicts: status === "conflict" ? [{ code: "unsupported_session_version", message: "Canonical conflict discovered after reconnect" }] : [],
      } } }, headers: { ETag: '"1"' } })
    }
    if (path === `/api/v1/history/${id}`) return route.fulfill({ json: { session_id: id, messages: [
      { id: "existing-result", role: "assistant", content: "Retained compatibility transcript", created_at: at },
    ] } })
    if (path === `/api/v1/respond/${id}/pending`) return route.fulfill({ json: { has_pending_question: false } })
    if (path === `/api/v1/task/${id}`) return route.fulfill({ json: { items: [] } })
    if (path === `/api/v1/actors/${id}/snapshot`) return route.fulfill({ json: actorSnapshotFixture(id, 0) })
    if (path === "/api/v1/chat") return route.fulfill({ status: 201, json: { status: "success", session_id: id, message_id: "explicit-new-input" } })
    if (path === `/api/v1/execute/${id}`) return route.fulfill({ json: { status: "started", session_id: id } })
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByText("This session is compatible", { exact: false })).toBeVisible()
  const input = page.getByRole("textbox", { name: "Messages", exact: true })
  await input.fill("Keep this draft through reconnects")
  const before = detailReads
  status = "conflict"
  await socket!.close({ code: 1012, reason: "fixture reconnect with a new canonical report" })
  await expect.poll(() => connections).toBeGreaterThanOrEqual(2)
  await expect(page.locator('[data-session-execution-blocked="true"]')).toBeVisible()
  expect(detailReads).toBeGreaterThan(before)
  await expect(input).toHaveText("Keep this draft through reconnects")
  await expect(page.getByText("Retained compatibility transcript", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled()
  expect(writes).toEqual([])
  await page.screenshot({ path: info.outputPath("conflict-after-in-place-reconnect.png"), animations: "disabled" })
  status = "legacy_compatible"
  await socket!.close({ code: 1012, reason: "fixture reconnect after explicit server recovery" })
  await expect.poll(() => connections).toBeGreaterThanOrEqual(3)
  await expect(page.getByText("Legacy session: compatible", { exact: false })).toBeVisible()
  await expect(input).toHaveText("Keep this draft through reconnects")
  expect(writes).toEqual([]); expect(navigations).toBe(1)
  await page.getByRole("button", { name: "Send message", exact: true }).click()
  await expect.poll(() => writes.filter((x) => x.path === `/api/v1/execute/${id}`).length).toBe(1)
  expect(writes.map((x) => x.path)).toEqual(["/api/v1/chat", `/api/v1/execute/${id}`])
  expect(writes[0].body).toMatchObject({ session_id: id, message: "Keep this draft through reconnects" })
  expect(observation.pageErrors).toEqual([])
})
