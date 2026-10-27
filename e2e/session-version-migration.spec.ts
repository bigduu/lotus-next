import { expect, test, type Page, type TestInfo } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

// Built production UI against a controlled HTTP endpoint. Backend persistence
// and real model execution are verified separately by Bamboo acceptance.
const sid = "all-surface-session", at = "2026-10-25T00:00:00Z"
const birth = "d".repeat(64), before = "a".repeat(64), after = "b".repeat(64)
const endpoint = `/api/v1/sessions/${sid}/version-migration`
type Mode = "success" | "uncertain-post" | "uncertain-readback" | "cold-pending" | "busy" | "unsupported" | "canonical-conflict" | "current"
interface Intent {
  operation_id: string; birth_token: string; expected_session_version: null
  expected_metadata_version: number; expected_snapshot_sha256: string
}
const pendingIntent: Intent = { operation_id: "131cdeaf-4b8c-4815-a813-1697a2688bfa", birth_token: birth,
  expected_session_version: null, expected_metadata_version: 5, expected_snapshot_sha256: before }

async function fixture(page: Page, mode: Mode) {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", id)
  }, sid)
  const runtime = await installArtifactRuntime(page, standaloneScenario, [], { bootstrapRequestState: "local_bypass" })
  const session = { id: sid, title: "Retained migration session", kind: "root", title_version: 1,
    root_session_id: sid, parent_session_id: null, spawn_depth: 0, pinned: false,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    reasoning_effort: "medium", workspace_path: "/workspace/original-project", permission_mode: "default", bypass_permissions: false,
    created_at: at, updated_at: at, last_activity_at: at, message_count: 2, has_attachments: false,
    is_running: false, last_run_status: "completed", subagent_count: 0,
    root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 0, root_mode_birth_token: birth }
  const history = [
    { id: "retained-user", role: "user", content: "Keep the original workspace and project context", created_at: at },
    { id: "retained-assistant", role: "assistant", content: "Retained result: use the existing configuration", created_at: at },
  ]
  let migrated = mode === "current", detailUnavailable = mode === "cold-pending", holdReadback = false
  let pending: Intent | null = mode === "cold-pending" ? pendingIntent : null
  let assessReads = 0, readbacksHeld = 0, commits = 0
  let releaseReadback!: () => void
  const readbackGate = new Promise<void>((resolve) => { releaseReadback = resolve })
  const posts: Intent[] = [], sessionWrites: { path: string; body: unknown }[] = []
  const events: string[] = []
  const conflicting = () => mode === "canonical-conflict" && migrated
  const retainedVersion = () => conflicting() ? 99 : migrated ? 2 : null
  const compatibility = () => ({ session_version: retainedVersion(), current_session_version: 2,
    status: conflicting() ? "conflict" : migrated ? "compatible" : "legacy_compatible", history_readable: true,
    execution_allowed: !conflicting(), conflicts: conflicting() ? [{ code: "unsupported_session_version", message: "A future version appeared after the receipt" }] : [] })
  const canonical = () => ({ session: { ...session, session_version: retainedVersion(), execution_compatibility: compatibility() } })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() !== "GET" && /^\/api\/v1\/(sessions|history|chat|execute)(?:\/|$)/.test(path)) {
      sessionWrites.push({ path, body: request.postData() ? request.postDataJSON() : null })
    }
    if (path === endpoint && request.method() === "GET") {
      assessReads += 1
      if (mode === "unsupported") return route.fulfill({ status: 404, json: { error: "Unsupported route" } })
      const blockers = pending ? [{ code: "migration_pending", message: "A saved migration needs confirmation" }]
        : mode === "busy" ? [{ code: "session_busy", message: "An existing operation blocks migration" }]
          : conflicting() ? [{ code: "unsupported_session_version", message: "A future version blocks new migration" }]
          : migrated ? [{ code: "already_current", message: "Already current" }] : []
      return route.fulfill({ json: { session_id: sid, birth_token: birth, session_version: retainedVersion(),
        current_session_version: 2, metadata_version: conflicting() ? 7 : migrated ? 6 : 5,
        snapshot_sha256: conflicting() ? "c".repeat(64) : migrated ? after : before,
        eligible: !blockers.length, blockers, ...(pending ? { pending_operation: pending } : {}) } })
    }
    if (path === endpoint && request.method() === "POST") {
      const body = request.postDataJSON() as Intent
      posts.push(body); events.push("migration-post")
      expect(Object.keys(body).sort()).toEqual(["birth_token", "expected_metadata_version", "expected_session_version", "expected_snapshot_sha256", "operation_id"])
      expect(body).toMatchObject({ birth_token: birth, expected_session_version: null, expected_metadata_version: 5, expected_snapshot_sha256: before })
      expect(body.operation_id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
      if (pending) expect(body).toEqual(pending)
      if (posts.length > 1) expect(body).toEqual(posts[0])
      if (mode === "uncertain-post" && posts.length === 1) {
        pending = body
        return route.fulfill({ status: 503, json: { code: "migration_outcome_unconfirmed" } })
      }
      if (!migrated) { migrated = true; commits += 1 }
      pending = null
      if (mode === "success") holdReadback = true
      if (mode === "uncertain-readback" && posts.length === 1) detailUnavailable = true
      events.push("matching-receipt")
      return route.fulfill({ json: { status: "committed", operation_id: body.operation_id, session_id: sid,
        source_version: null, target_version: 2, before_sha256: before, after_sha256: after, birth_token: birth } })
    }
    if (path === "/api/v1/sessions" && request.method() === "GET") {
      const rows = url.searchParams.get("kind") === "child" ? [] : [session]
      return route.fulfill({ json: { sessions: rows, total: rows.length, limit: 200, offset: 0 } })
    }
    if (path === `/api/v1/sessions/${sid}` && request.method() === "GET") {
      if (holdReadback) { readbacksHeld += 1; await readbackGate }
      if (detailUnavailable) return route.fulfill({ status: 503, json: { error: "Canonical detail unavailable" } })
      events.push(migrated ? "current-detail" : "legacy-detail")
      return route.fulfill({ json: canonical(), headers: { ETag: '"1"' } })
    }
    if (path === `/api/v1/sessions/${sid}` && request.method() === "PATCH") {
      Object.assign(session, request.postDataJSON())
      return route.fulfill({ json: canonical(), headers: { ETag: '"1"' } })
    }
    if (path === `/api/v1/history/${sid}` && request.method() === "GET") return route.fulfill({ json: { session_id: sid, messages: history } })
    if (path === `/api/v1/actors/${sid}/snapshot`) return route.fulfill({ json: actorSnapshotFixture(sid, 0) })
    if (path === `/api/v1/task/${sid}`) return route.fulfill({ json: { session_id: sid, items: [] } })
    if (path === `/api/v1/respond/${sid}/pending`) return route.fulfill({ json: { has_pending_question: false } })
    if (path === "/api/v1/chat" && request.method() === "POST") return route.fulfill({ status: 201,
      json: { session_id: sid, message_id: "continuation", ingress_seq: 1, status: "success" } })
    if (path === `/api/v1/execute/${sid}` && request.method() === "POST") return route.fulfill({ json: { status: "started", session_id: sid } })
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByText(history[0].content, { exact: true })).toBeVisible()
  return { runtime, posts, sessionWrites, events, session,
    get assessReads() { return assessReads }, get readbacksHeld() { return readbacksHeld }, get commits() { return commits },
    allowDetail() { detailUnavailable = false },
    releaseReadback() { holdReadback = false; releaseReadback() } }
}
const migration = (page: Page) => page.getByTestId("session-version-migration")
const start = (page: Page) => page.getByRole("button", { name: "Migrate to the current version", exact: true })
const recover = (page: Page) => page.getByRole("button", { name: "Confirm migration result", exact: true })
const completed = "Migration verified. Your session history and settings are retained."
const unconfirmed = "The migration result is not confirmed. Check the same request before starting another migration."

async function retained(page: Page) {
  await expect(page.getByRole("banner")).toContainText("Retained migration session")
  await expect(page.getByText("Keep the original workspace and project context", { exact: true })).toBeVisible()
  await expect(page.getByText("Retained result: use the existing configuration", { exact: true })).toBeVisible()
  await expect(page.getByTestId("model-effort-picker")).toContainText(/fixture.model/i)
  await expect(page.getByRole("combobox", { name: "Permission mode", exact: true })).toHaveText("Default")
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", page.viewportSize()!.width)
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, animations: "disabled" })
  await info.attach(name, { path, contentType: "image/png" })
}

test("explicit legacy migration confirms one matching receipt and canonical readback while retaining the existing session", async ({ page }, info) => {
  const f = await fixture(page, "success")
  try {
    await expect(start(page)).toBeVisible()
    await retained(page)
    const input = page.getByRole("textbox", { name: "Messages", exact: true }).first()
    await input.fill("Keep this unsent instruction and its context")
    expect(f.posts).toEqual([])
    await start(page).click()
    await expect.poll(() => f.readbacksHeld).toBeGreaterThan(0)
    await expect(migration(page)).not.toContainText(completed)
    await expect(migration(page).getByRole("button", { name: "Migrating…", exact: true })).toBeDisabled()
    expect(f.posts).toHaveLength(1)
    f.releaseReadback()
    await expect.poll(() => f.events.lastIndexOf("current-detail")).toBeGreaterThan(f.events.indexOf("matching-receipt"))
    await expect(page.locator("[data-session-execution-blocked]")).toHaveCount(0)
    await retained(page)
    await expect(input).toHaveText("Keep this unsent instruction and its context")
    expect(f.sessionWrites).toEqual([{ path: endpoint, body: f.posts[0] }])
    expect(f.commits).toBe(1)
    expect(f.events.lastIndexOf("current-detail")).toBeGreaterThan(f.events.indexOf("matching-receipt"))
    await screenshot(page, info, "session-migration-verified")
    await page.getByRole("button", { name: "Open side panel", exact: true }).click()
    const workbench = page.locator("#right-workbench")
    await workbench.getByRole("button", { name: /Inspector.*View current session/ }).click()
    await expect(workbench.locator(`[title="${f.session.workspace_path}"]`)).toHaveText(f.session.workspace_path)
    await expect(workbench.locator(`[data-actor-id="${sid}"]`)).toHaveAttribute("aria-selected", "true")
    await screenshot(page, info, "session-migration-preserved-workspace")
    expect(f.sessionWrites).toEqual([{ path: endpoint, body: f.posts[0] }])
    expect(f.runtime.pageErrors).toEqual([])
    await info.attach("migration-wire", { body: JSON.stringify({ posts: f.posts, sessionWrites: f.sessionWrites, events: f.events }), contentType: "application/json" })
  } finally { f.releaseReadback() }
})

for (const mode of ["uncertain-post", "uncertain-readback"] as const) {
  test(`${mode} retains the exact UUID and payload until explicit recovery without automatic replay`, async ({ page }, info) => {
    const f = await fixture(page, mode)
    await start(page).click()
    await expect(migration(page)).toContainText(unconfirmed)
    await expect(migration(page)).not.toContainText(completed)
    expect(f.posts).toHaveLength(1)
    const original = structuredClone(f.posts[0])
    const reads = f.assessReads
    await migration(page).getByRole("button", { name: "Refresh migration state", exact: true }).click()
    await expect.poll(() => f.assessReads).toBeGreaterThan(reads)
    await expect(recover(page)).toBeEnabled()
    await expect(migration(page)).toContainText(unconfirmed)
    expect(f.posts).toHaveLength(1)
    await screenshot(page, info, `session-migration-${mode}`)
    f.allowDetail()
    await recover(page).click()
    await expect.poll(() => f.commits).toBe(1)
    await expect(migration(page)).toHaveCount(0)
    await expect(page.locator("[data-session-execution-blocked]")).toHaveCount(0)
    expect(f.posts).toEqual([original, original])
    expect(f.commits).toBe(1)
    expect(f.sessionWrites).toEqual([{ path: endpoint, body: original }, { path: endpoint, body: original }])
    await retained(page)
    expect(f.runtime.pageErrors).toEqual([])
  })
}

test("cold refresh recovers only the server's pending operation even when session detail is unavailable", async ({ page }, info) => {
  const f = await fixture(page, "cold-pending")
  expect(f.assessReads).toBe(0)
  await migration(page).getByRole("button", { name: "Refresh migration state", exact: true }).click()
  await expect(recover(page)).toBeVisible()
  expect(f.posts).toEqual([])
  await page.reload()
  await expect(page.getByText("Compatibility could not be checked", { exact: false })).toBeVisible()
  const reads = f.assessReads
  await expect(recover(page)).toHaveCount(0)
  await migration(page).getByRole("button", { name: "Refresh migration state", exact: true }).click()
  await expect.poll(() => f.assessReads).toBeGreaterThan(reads)
  await expect(recover(page)).toBeVisible()
  await expect(start(page)).toHaveCount(0)
  expect(f.posts).toEqual([])
  await screenshot(page, info, "session-migration-cold-pending")
  f.allowDetail()
  await recover(page).click()
  await expect(page.locator("[data-session-execution-blocked]")).toHaveCount(0)
  expect(f.posts).toEqual([pendingIntent])
  await expect(page.getByText("Compatibility could not be checked", { exact: false })).toHaveCount(0)
  expect(f.commits).toBe(1)
  expect(f.runtime.pageErrors).toEqual([])
})

test("current Sessions change permission modes without automatically probing migration authority", async ({ page }, info) => {
  const f = await fixture(page, "current")
  await retained(page)
  await expect(page.locator("[data-session-execution-blocked]")).toHaveCount(0)
  expect(f.assessReads).toBe(0)
  const permission = page.getByRole("combobox", { name: "Permission mode", exact: true })
  await expect(permission).toHaveText("Default")
  await permission.click()
  await page.getByRole("option", { name: "Auto", exact: true }).click()
  await page.getByRole("dialog", { name: "Enable Auto for this session?", exact: true })
    .getByRole("button", { name: "Enable Auto", exact: true }).click()
  await expect(permission).toHaveText("Auto")
  await permission.click()
  await page.getByRole("option", { name: "Default", exact: true }).click()
  await expect.poll(() => f.session.permission_mode).toBe("default")
  await expect(permission).toHaveText("Default")
  await expect(page.getByRole("button", { name: "Check compatibility again", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Refresh migration state", exact: true })).toHaveCount(0)
  expect(f.assessReads).toBe(0)
  expect(f.posts).toEqual([])
  await expect(migration(page)).toHaveCount(0)
  await expect(start(page)).toHaveCount(0)
  await expect(recover(page)).toHaveCount(0)
  expect(f.assessReads).toBe(0)
  expect(f.posts).toEqual([])
  expect(f.runtime.pageErrors).toEqual([])
  await screenshot(page, info, "session-migration-current-hidden")
})

test("canonical conflict after a matching receipt blocks the Composer and preserves only explicit recovery", async ({ page }, info) => {
  const f = await fixture(page, "canonical-conflict")
  const input = page.getByRole("textbox", { name: "Messages", exact: true }).first()
  const draft = "Keep this unsent instruction after the canonical conflict"
  await input.fill(draft)
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled()
  await start(page).click()
  await expect(migration(page)).toContainText(unconfirmed)
  await expect(page.locator('[data-session-execution-blocked="true"]')).toBeVisible()
  await expect(page.getByText("Compatibility could not be checked", { exact: false })).toHaveCount(0)
  await expect(migration(page)).not.toContainText(completed)
  await expect(start(page)).toHaveCount(0)
  await expect(recover(page)).toBeEnabled()
  expect(f.posts).toHaveLength(1)
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled()
  await input.press("Enter")
  await expect(input).toHaveText(draft)
  expect(f.sessionWrites).toEqual([{ path: endpoint, body: f.posts[0] }])
  const original = structuredClone(f.posts[0]), reads = f.assessReads
  await migration(page).getByRole("button", { name: "Refresh migration state", exact: true }).click()
  await expect.poll(() => f.assessReads).toBeGreaterThan(reads)
  await expect(recover(page)).toBeEnabled()
  await expect(start(page)).toHaveCount(0)
  expect(f.posts).toHaveLength(1)
  await recover(page).click()
  await expect.poll(() => f.posts.length).toBe(2)
  await expect(migration(page)).toContainText(unconfirmed)
  await expect(recover(page)).toBeEnabled()
  expect(f.posts).toEqual([original, original])
  expect(f.sessionWrites).toEqual([{ path: endpoint, body: original }, { path: endpoint, body: original }])
  await expect(page.locator('[data-session-execution-blocked="true"]')).toBeVisible()
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled()
  await expect(input).toHaveText(draft)
  expect(f.runtime.pageErrors).toEqual([])
  await screenshot(page, info, "session-migration-canonical-conflict")
})

for (const mode of ["busy", "unsupported"] as const) {
  test(`${mode} never offers migration permission and leaves compatible legacy continuation usable`, async ({ page }, info) => {
    const f = await fixture(page, mode)
    await expect.poll(() => f.assessReads).toBeGreaterThan(0)
    if (mode === "busy") {
      await expect(migration(page)).toContainText("Migration is temporarily unavailable")
      await migration(page).getByText("Migration is temporarily unavailable", { exact: true }).click()
      await expect(migration(page)).toContainText("An existing operation blocks migration")
    } else await expect(migration(page)).toHaveCount(0)
    await expect(start(page)).toHaveCount(0)
    await expect(recover(page)).toHaveCount(0)
    await retained(page)
    await expect(page.locator('[data-session-execution-blocked="true"]')).toHaveCount(0)
    expect(f.posts).toEqual([])
    await screenshot(page, info, `session-migration-${mode}`)
    await page.getByRole("textbox", { name: "Messages", exact: true }).first().fill("Continue the original compatible session")
    await page.getByRole("button", { name: "Send message", exact: true }).click()
    await expect.poll(() => f.sessionWrites.filter((entry) => entry.path === `/api/v1/execute/${sid}`).length).toBe(1)
    expect(f.sessionWrites.map((entry) => entry.path)).toEqual(["/api/v1/chat", `/api/v1/execute/${sid}`])
    expect(f.sessionWrites[0].body).toMatchObject({ session_id: sid, message: "Continue the original compatible session",
      model: f.session.model, model_ref: f.session.model_ref })
    expect(f.posts).toEqual([])
    expect(f.runtime.pageErrors).toEqual([])
  })
}
