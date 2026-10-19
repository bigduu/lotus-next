import { expect, test, type Page } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sid = "all-surface-session", at = "2026-10-19T03:00:00Z"
type Mode = "compatible" | "legacy" | "missing" | "version-conflict" | "state-conflict" | "read-error" | "submit-refusal" | "execute-refusal"
const report = (mode: Mode) => ({ session_version: mode === "legacy" || mode === "state-conflict" ? null : mode === "version-conflict" ? 99 : 1,
  current_session_version: 1, status: mode === "legacy" ? "legacy_compatible" : mode.endsWith("conflict") ? "conflict" : "compatible",
  history_readable: true, execution_allowed: !mode.endsWith("conflict"), conflicts: mode.endsWith("conflict") ? [{
    code: mode === "state-conflict" ? "unsupported_runtime_state_version" : "unsupported_session_version",
    message: mode === "state-conflict" ? "Unsupported retained runtime format" : "Unsupported declared behavior version",
  }] : [] })

async function fixture(page: Page, initial: Mode) {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", id)
  }, sid)
  const runtime = await installArtifactRuntime(page, standaloneScenario, [], { bootstrapRequestState: "local_bypass" })
  let mode = initial
  const writes: { path: string; body: unknown }[] = []
  const saved: { id: string; role: string; content: string; created_at: string }[] = [
    { id: "legacy-user", role: "user", content: "Existing history remains readable", created_at: at },
    { id: "legacy-assistant", role: "assistant", content: "Existing result stays available", created_at: at },
  ]
  const session = { id: sid, title: "Session compatibility fixture", kind: "root", title_version: 1,
    root_session_id: sid, parent_session_id: null, spawn_depth: 0, pinned: false,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: at, updated_at: at, last_activity_at: at, message_count: 2,
    workspace_path: "/workspace/lotus-next", permission_mode: "default", bypass_permissions: false,
    is_running: false, last_run_status: "completed", subagent_count: 0,
    root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 0,
    root_mode_birth_token: "a".repeat(64) }
  const refusal = () => ({ session_id: sid, error: { type: "conflict", code: "session_execution_incompatible", message: "Execution compatibility conflict" },
    compatibility: report("version-conflict") })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== "GET") writes.push({ path, body: request.postData() ? request.postDataJSON() : null })
    if (path === "/api/v1/sessions") return route.fulfill({ json: { sessions: new URL(request.url()).searchParams.get("kind") === "child" ? [] : [session], total: 1, limit: 200, offset: 0 } })
    if (path === `/api/v1/sessions/${sid}`) {
      if (mode === "read-error") return route.fulfill({ status: 503, json: { error: "Fixture detail unavailable" } })
      return route.fulfill({ json: { session: { ...session, ...(mode === "missing" ? {} : { execution_compatibility: report(mode) }) } }, headers: { ETag: '"1"' } })
    }
    if (path === `/api/v1/history/${sid}`) return route.fulfill({ json: { session_id: sid, messages: saved } })
    if (path === `/api/v1/actors/${sid}/snapshot`) return route.fulfill({ json: actorSnapshotFixture(sid, 0) })
    if (path === `/api/v1/task/${sid}`) return route.fulfill({ json: { session_id: sid, items: [] } })
    if (path === `/api/v1/respond/${sid}/pending`) return route.fulfill({ json: { has_pending_question: false } })
    if (path === "/api/v1/chat" && request.method() === "POST") {
      if (mode === "submit-refusal") { mode = "version-conflict"; return route.fulfill({ status: 409, json: refusal() }) }
      saved.push({ id: "accepted-continuation", role: "user", content: request.postDataJSON().message, created_at: at })
      return route.fulfill({ status: 201, json: { session_id: sid, message_id: "accepted-continuation", ingress_seq: 1, status: "success" } })
    }
    if (path === `/api/v1/execute/${sid}`) {
      if (mode === "execute-refusal") { mode = "version-conflict"; return route.fulfill({ status: 409, json: refusal() }) }
      return route.fulfill({ json: { status: "started", session_id: sid } })
    }
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByText("Existing history remains readable", { exact: true })).toBeVisible()
  const input = page.getByRole("textbox", { name: "Messages", exact: true }).first()
  await expect(input).toBeVisible()
  return { runtime, writes, input, setMode(value: Mode) { mode = value },
    count(path: string) { return writes.filter((entry) => entry.path === path).length } }
}

for (const [mode, copy] of [["compatible", "This session is compatible"], ["legacy", "Legacy session: compatible"],
  ["missing", "Legacy session: no compatibility report"], ["read-error", "Compatibility could not be checked"]] as const) {
  test(`compatibility fixture: ${mode} stays usable without replacement or migration`, async ({ page }) => {
    const f = await fixture(page, mode)
    await expect(page.getByText(copy, { exact: false }).first()).toBeVisible()
    await expect(page.locator('[data-session-execution-blocked="true"]')).toHaveCount(0)
    await f.input.fill("Continue the existing session")
    await page.getByRole("button", { name: "Send message", exact: true }).click()
    await expect.poll(() => f.count("/api/v1/chat")).toBe(1)
    await expect.poll(() => f.count(`/api/v1/execute/${sid}`)).toBe(1)
    expect(f.writes.find((entry) => entry.path === "/api/v1/chat")!.body).toMatchObject({ session_id: sid, message: "Continue the existing session" })
    expect(f.count("/api/v1/sessions")).toBe(0)
    expect(f.runtime.pageErrors).toEqual([])
  })
}
for (const mode of ["version-conflict", "state-conflict"] as const) {
  test(`compatibility fixture: ${mode} blocks execution while preserving history and draft`, async ({ page }, info) => {
    const f = await fixture(page, mode)
    await expect(page.locator('[data-session-execution-blocked="true"]')).toBeVisible()
    await expect(page.getByText("Existing result stays available", { exact: true })).toBeVisible()
    await f.input.fill("Keep this unsent draft")
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled()
    await f.input.press("Enter")
    await expect(f.input).toHaveText("Keep this unsent draft")
    expect(f.writes).toEqual([])
    expect(f.runtime.pageErrors).toEqual([])
    await page.screenshot({ path: info.outputPath(`${mode}-readable-history.png`), animations: "disabled" })
  })
}
test("compatibility fixture: typed submit conflict retains draft and only an explicit reread allows another send", async ({ page }, info) => {
  const f = await fixture(page, "submit-refusal")
  await expect(page.getByText("This session is compatible", { exact: false })).toBeVisible()
  await f.input.fill("Keep the exact reviewed instruction")
  await page.getByRole("button", { name: "Send message", exact: true }).click()
  await expect(page.locator('[data-session-execution-blocked="true"]')).toBeVisible()
  await expect(f.input).toHaveText("Keep the exact reviewed instruction")
  expect(f.count("/api/v1/chat")).toBe(1); expect(f.count(`/api/v1/execute/${sid}`)).toBe(0)
  await page.screenshot({ path: info.outputPath("typed-conflict-draft-retained.png"), animations: "disabled" })
  f.setMode("legacy")
  await page.getByRole("button", { name: "Check compatibility again", exact: true }).click()
  await expect(page.locator('[data-session-execution-blocked="true"]')).toHaveCount(0)
  expect(f.count("/api/v1/chat")).toBe(1)
  await page.getByRole("button", { name: "Send message", exact: true }).click()
  await expect.poll(() => f.count(`/api/v1/execute/${sid}`)).toBe(1)
  expect(f.count("/api/v1/chat")).toBe(2)
  expect(f.count("/api/v1/sessions")).toBe(0)
  expect(f.runtime.pageErrors).toEqual([])
})
test("compatibility fixture: typed execute refusal preserves the acknowledged message without replay", async ({ page }) => {
  const f = await fixture(page, "execute-refusal")
  await expect(page.getByText("This session is compatible", { exact: false })).toBeVisible()
  await f.input.fill("This message is saved before execution refusal")
  await page.getByRole("button", { name: "Send message", exact: true }).click()
  await expect(page.locator('[data-session-execution-blocked="true"]')).toBeVisible()
  await expect(page.getByText("This message is saved before execution refusal", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Existing history remains readable", { exact: true })).toBeVisible()
  expect(f.count("/api/v1/chat")).toBe(1); expect(f.count(`/api/v1/execute/${sid}`)).toBe(1)
  expect(f.runtime.pageErrors).toEqual([])
})
