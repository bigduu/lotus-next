import { expect, test, type Page } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

// Synthetic HTTP and WebSocket responses only; no provider or user data is used.
const sid = "all-surface-session", at = "2026-10-27T00:00:00Z", originalRun = "synthetic-original-run"
type Options = { supported?: boolean; abortConfirmation?: boolean; refuseConfirmation?: boolean; expires?: number; error?: boolean }
async function fixture(page: Page, options: Options = {}) {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", id)
  }, sid)
  const runtime = await installArtifactRuntime(page, standaloneScenario, [], { bootstrapRequestState: "local_bypass" })
  let supported = options.supported !== false, reads = 0, activeRun: string | null = null, offer = true
  const cancelledRuns: string[] = []
  const writes: { path: string; body: unknown; run: string | undefined }[] = []
  const session = { id: sid, title: "Synthetic connection retry", kind: "root", title_version: 1,
    root_session_id: sid, parent_session_id: null, spawn_depth: 0, pinned: false,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: at, updated_at: at, last_activity_at: at, message_count: 2, workspace_path: "/workspace/synthetic",
    permission_mode: "default", bypass_permissions: false, is_running: false,
    last_run_status: options.error ? "error" : "completed", last_run_error: options.error ? "Synthetic connection error" : null,
    subagent_count: 0, root_orchestration_only: false, thinking_mode: "standard",
    root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64) }
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname
    if (req.method() !== "GET") writes.push({ path, body: req.postData() ? req.postDataJSON() : null, run: req.headers()["bamboo-run-id"] })
    if (path === "/api/v1/execute/defaults") {
      reads++
      return route.fulfill({ json: { upstream_retry: { supported_modes: ["bounded", "until_cancelled"], default_mode: "bounded" },
        ...(supported ? { live_bootstrap_resume: { protocol_version: 1, offer_timeout_ms: 600000,
          waiting_endpoint: "execute/{session_id}/retry", continue_run_header: "Bamboo-Run-Id", initial_opt_in_field: "live_bootstrap_resume" } } : {}) } })
    }
    if (path === "/api/v1/sessions") return route.fulfill({ json: { sessions: new URL(req.url()).searchParams.get("kind") === "child" ? [] : [session], total: 1, limit: 200, offset: 0 } })
    if (path === `/api/v1/sessions/${sid}`) return route.fulfill({ json: { session: { ...session,
      execution_compatibility: { session_version: 2, current_session_version: 2, status: "compatible", history_readable: true, execution_allowed: true, conflicts: [] } } }, headers: { ETag: '"1"' } })
    if (path === `/api/v1/history/${sid}`) return route.fulfill({ json: { session_id: sid, messages: [
      { id: "original-user", role: "user", content: "One saved instruction", created_at: at },
      { id: "original-assistant", role: "assistant", content: "Earlier completed reply", created_at: at }] } })
    if (path === `/api/v1/actors/${sid}/snapshot`) return route.fulfill({ json: actorSnapshotFixture(sid, 0) })
    if (path === `/api/v1/task/${sid}`) return route.fulfill({ json: { session_id: sid, items: [] } })
    if (path === `/api/v1/respond/${sid}/pending`) return route.fulfill({ json: { has_pending_question: false } })
    if (path === "/api/v1/chat" && req.method() === "POST") return route.fulfill({ json: { session_id: sid, message_id: "synthetic-user", status: "success" } })
    if (path === `/api/v1/execute/${sid}/retry` && req.method() === "GET") return route.fulfill({ json: activeRun && offer
      ? { session_id: sid, run_id: activeRun, status: "retry_waiting", expires_in_ms: options.expires ?? 300000, confirming: false }
      : { session_id: sid, status: "unavailable" } })
    if (path === `/api/v1/execute/${sid}` && req.method() === "POST") {
      const run = req.headers()["bamboo-run-id"]
      if (!run) {
        activeRun = originalRun; session.is_running = true; session.last_run_status = "running"
        return route.fulfill({ status: 202, json: { session_id: sid, status: "started", run_id: activeRun, events_url: `/api/v1/events/${sid}` } })
      }
      if (run !== activeRun) return route.fulfill({ status: 409, json: { session_id: sid, error: { code: "retry_state_changed" } } })
      if (options.refuseConfirmation) {
        offer = false
        return route.fulfill({ status: 409, json: { session_id: sid, error: { type: "api_error", code: "retry_resume_not_prepared", message: "synthetic private server detail" } } })
      }
      if (options.abortConfirmation) return route.abort("failed")
      offer = false
      return route.fulfill({ json: { session_id: sid, run_id: activeRun, status: "retry_continuing", events_url: `/api/v1/events/${sid}` } })
    }
    if (path === `/api/v1/stop/${sid}` && req.method() === "POST") {
      if (req.headers()["bamboo-run-id"] !== activeRun) return route.fulfill({ status: 409, json: { error: "Stale run identity" } })
      cancelledRuns.push(activeRun!); session.last_run_status = "cancelled"; session.is_running = false
      return route.fulfill({ json: { success: true, session_id: sid, run_id: activeRun } })
    }
    if (req.method() !== "GET") return route.fulfill({ status: 409, json: { error: "Unexpected write rejected by fixture" } })
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByText("Earlier completed reply", { exact: true })).toBeVisible()
  await expect.poll(() => reads).toBeGreaterThan(0)
  const start = async () => {
    const input = page.getByRole("textbox", { name: "Messages", exact: true }).first()
    await input.fill("Synthetic follow-up")
    await page.getByRole("button", { name: "Send message", exact: true }).click()
    await expect.poll(() => writes.filter((entry) => entry.path === `/api/v1/execute/${sid}`).length).toBe(1)
  }
  return { runtime, writes, cancelledRuns, start, get reads() { return reads },
    withdraw() { supported = false }, replaceRun(id: string) { activeRun = id } }
}
const action = (page: Page) => page.getByRole("button", { name: "Retry connection until stopped", exact: true })
const executeWrites = <T extends { path: string }>(entries: T[]) => entries.filter((entry) => entry.path === `/api/v1/execute/${sid}`)

for (const width of [1440, 390, 320]) test(`confirms and Stops the original waiting run at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  const f = await fixture(page); await f.start()
  await expect(action(page)).toBeEnabled()
  const waitingStop = await page.getByRole("status").getByRole("button", { name: "Stop generation", exact: true }).boundingBox()
  expect(waitingStop).not.toBeNull()
  expect(waitingStop!.x + waitingStop!.width).toBeLessThanOrEqual(width)
  await page.screenshot({ path: info.outputPath(`live-waiting-${width}.png`), animations: "disabled" })
  expect(executeWrites(f.writes)[0]).toMatchObject({ body: { live_bootstrap_resume: true } })
  await action(page).click()
  await expect(page.getByText("Continuous connection retries were requested for this run.", { exact: false })).toBeVisible()
  expect(executeWrites(f.writes)).toHaveLength(2)
  expect(executeWrites(f.writes)[1]).toEqual({ path: `/api/v1/execute/${sid}`, body: { upstream_retry: { mode: "until_cancelled" } }, run: originalRun })
  await expect(page.getByText("Earlier completed reply", { exact: true })).toBeVisible()
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", width)
  await page.screenshot({ path: info.outputPath(`live-continued-${width}.png`), animations: "disabled" })
  await page.getByRole("status").getByRole("button", { name: "Stop generation", exact: true }).click()
  await expect.poll(() => f.cancelledRuns).toEqual([originalRun])
  expect(f.writes.at(-1)).toEqual({ path: `/api/v1/stop/${sid}`, body: null, run: originalRun })
  expect(f.writes.filter((entry) => entry.path === "/api/v1/chat")).toHaveLength(1)
  expect(f.runtime.clientFrames.filter((frame) => !!frame && typeof frame === "object" && "type" in frame && frame.type === "stop")).toEqual([])
  expect(f.runtime.pageErrors).toEqual([])
})
test("a reloaded pane cannot stop a successor with the old run receipt", async ({ page }) => {
  const f = await fixture(page); await f.start(); await expect(action(page)).toBeEnabled(); await action(page).click()
  await expect(page.getByText("Continuous connection retries were requested for this run.", { exact: false })).toBeVisible()
  f.replaceRun("synthetic-successor-run"); await page.reload()
  await expect(page.getByText("Earlier completed reply", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Stop generation", exact: true }).click()
  await expect.poll(() => f.writes.filter((entry) => entry.path === `/api/v1/stop/${sid}`).length).toBe(1)
  expect(f.writes.at(-1)).toEqual({ path: `/api/v1/stop/${sid}`, body: null, run: originalRun })
  expect(f.cancelledRuns).toEqual([])
})
test("a tab without the original receipt does not guess a run identity", async ({ page }) => {
  const f = await fixture(page); await f.start(); await expect(action(page)).toBeEnabled()
  await page.evaluate(() => sessionStorage.clear()); await page.reload()
  await expect(page.getByText("This tab cannot safely control the retry", { exact: false })).toBeVisible()
  await expect(action(page)).toHaveCount(0)
  expect(executeWrites(f.writes)).toHaveLength(1); expect(f.cancelledRuns).toEqual([])
})
test("a lost confirmation remains unconfirmed after reload and is not replayed", async ({ page }) => {
  const f = await fixture(page, { abortConfirmation: true }); await f.start(); await expect(action(page)).toBeEnabled(); await action(page).click()
  await expect(page.getByText("The continuation result is unconfirmed.", { exact: false })).toBeVisible()
  await page.reload()
  await expect(page.getByText("The continuation result is unconfirmed.", { exact: false })).toBeVisible()
  await expect(action(page)).toHaveCount(0); expect(executeWrites(f.writes)).toHaveLength(2)
})
test("a scoped refusal does not claim a continuation or expose backend detail", async ({ page }) => {
  const f = await fixture(page, { refuseConfirmation: true }); await f.start(); await expect(action(page)).toBeEnabled(); await action(page).click()
  await expect(page.getByText("The retry offer is no longer available.", { exact: false })).toBeVisible()
  await expect(page.getByText("synthetic private server detail", { exact: true })).toHaveCount(0)
  await expect(action(page)).toHaveCount(0); expect(executeWrites(f.writes)).toHaveLength(2)
})
test("an expired offer cannot be confirmed", async ({ page }) => {
  const f = await fixture(page, { expires: 0 }); await f.start()
  await expect(page.getByText("The connection retry offer expired.", { exact: false })).toBeVisible()
  await expect(action(page)).toHaveCount(0); expect(executeWrites(f.writes)).toHaveLength(1)
})
test("an older producer does not expose live retry or opt in its initial run", async ({ page }) => {
  const f = await fixture(page, { supported: false, error: true })
  await expect(page.getByRole("button", { name: "Retry generation", exact: true })).toBeVisible()
  await expect(action(page)).toHaveCount(0); await f.start()
  expect(executeWrites(f.writes)[0].body).not.toHaveProperty("live_bootstrap_resume")
  await expect(action(page)).toHaveCount(0)
})
test("withdrawn live capability prevents a confirmation write", async ({ page }) => {
  const f = await fixture(page); await f.start(); await expect(action(page)).toBeEnabled(); f.withdraw(); await action(page).click()
  await expect(page.getByText("The retry offer is no longer available.", { exact: false })).toBeVisible()
  expect(executeWrites(f.writes)).toHaveLength(1)
})
