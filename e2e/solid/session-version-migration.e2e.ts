import { expect, test, type Page } from "@playwright/test"
import type { SessionVersionMigrationRequest } from "../../src/services/chat/sessionVersionMigration"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"
import { expectComposerText } from "../support/composer.js"

const id = "all-surface-session"
const now = "2026-10-25T00:00:00Z"
const title = "Retained migration session"
const birth = "d".repeat(64)
const before = "a".repeat(64)
const after = "b".repeat(64)
const endpoint = `/api/v1/sessions/${id}/version-migration`
const pendingIntent = {
  operation_id: "131cdeaf-4b8c-4815-a813-1697a2688bfa", birth_token: birth,
  expected_session_version: null, expected_metadata_version: 5, expected_snapshot_sha256: before,
} satisfies SessionVersionMigrationRequest
const history = [
  { id: "retained-user", role: "user", content: "Keep the original workspace and project context", created_at: now },
  { id: "retained-assistant", role: "assistant", content: "Retained result: use the existing configuration", created_at: now },
]
type Mode = "success" | "uncertain-post" | "uncertain-readback" | "cold-pending" | "conflict" | "replacement" | "current" | "busy" | "unsupported"
const panel = (page: Page) => page.getByTestId("session-version-migration")
const start = (page: Page) => panel(page).getByRole("button", { name: "Migrate to the current version", exact: true })
const recover = (page: Page) => panel(page).getByRole("button", { name: "Confirm migration result", exact: true })
const refresh = (page: Page) => panel(page).getByRole("button", { name: "Refresh migration state", exact: true })
const input = (page: Page) => page.getByRole("textbox", { name: "Messages", exact: true }).first()
const send = (page: Page) => page.getByRole("button", { name: "Send message", exact: true })
const blocked = (page: Page) => page.locator('[data-session-execution-blocked="true"]')
const done = "Migration verified. Your session history and settings are retained."
const unconfirmed = "The migration result is not confirmed. Check the same request before starting another migration."

async function fixture(page: Page, baseURL: string | undefined, mode: Mode) {
  const entry = new URL("/", baseURL)
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", id)
  }, id)
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: entry.origin, entryUrl: entry.href,
  }, [], { bootstrapRequestState: "local_bypass", serveStaticFromLocalServer: true })
  const session = {
    id, title, kind: "root", title_version: 1, root_session_id: id, parent_session_id: null, pinned: false,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    reasoning_effort: "medium", workspace_path: "/workspace/original-project", permission_mode: "default",
    created_at: now, updated_at: now, last_activity_at: now, message_count: history.length,
    is_running: false, last_run_status: "completed", subagent_count: 0,
    root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 0, root_mode_birth_token: birth,
  }
  let migrated = mode === "current"
  let detailUnavailable = mode === "cold-pending"
  let pending: SessionVersionMigrationRequest | null = detailUnavailable ? pendingIntent : null
  let reads = 0
  let commits = 0
  let held = 0
  let permissionRevision = 1
  const permissionWrites: Array<{ mode: string; ifMatch: string }> = []
  let release!: () => void
  const readbackGate = new Promise<void>((resolve) => { release = resolve })
  const posts: SessionVersionMigrationRequest[] = []
  const mutations: Array<{ path: string; body: unknown }> = []
  const events: string[] = []
  const conflict = () => mode === "conflict" && migrated
  const version = () => conflict() ? 99 : migrated ? 2 : null
  const token = () => mode === "replacement" && migrated ? "e".repeat(64) : birth
  const compatibility = () => ({
    session_version: version(), current_session_version: 2,
    status: conflict() ? "conflict" : migrated ? "compatible" : "legacy_compatible",
    history_readable: true, execution_allowed: !conflict(),
    conflicts: conflict() ? [{ code: "unsupported_session_version", message: "A future version was observed" }] : [],
  })
  const detail = () => ({ ...session, root_mode_birth_token: token(), session_version: version(), execution_compatibility: compatibility() })

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    if (method !== "GET" && /^\/api\/v1\/(sessions|history|chat|execute)(?:\/|$)/.test(path)) {
      mutations.push({ path, body: request.postData() ? request.postDataJSON() : null })
    }
    if (path === endpoint && method === "GET") {
      reads += 1
      if (mode === "unsupported") return route.fulfill({ status: 404, json: { error: "Unsupported route" } })
      const blockers = pending ? [{ code: "migration_pending", message: "A saved migration needs confirmation" }]
        : mode === "busy" ? [{ code: "session_busy", message: "An existing operation blocks migration" }]
          : conflict() ? [{ code: "unsupported_session_version", message: "A future version blocks migration" }]
            : migrated ? [{ code: "already_current", message: "Already current" }] : []
      return route.fulfill({ json: {
        session_id: id, birth_token: token(), session_version: version(), current_session_version: 2,
        metadata_version: migrated ? 6 : 5, snapshot_sha256: migrated ? after : before,
        eligible: blockers.length === 0, blockers, ...(pending ? { pending_operation: pending } : {}),
      } })
    }
    if (path === endpoint && method === "POST") {
      const body = request.postDataJSON() as SessionVersionMigrationRequest
      const { operation_id, ...proof } = body
      posts.push(body)
      expect(proof).toEqual({
        birth_token: birth, expected_session_version: null, expected_metadata_version: 5, expected_snapshot_sha256: before,
      })
      expect(operation_id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
      if (pending) expect(body).toEqual(pending)
      if (mode === "uncertain-post" && posts.length === 1) {
        pending = body
        return route.fulfill({ status: 503, json: { code: "migration_outcome_unconfirmed" } })
      }
      if (!migrated) commits += 1
      migrated = true
      pending = null
      if (mode === "uncertain-readback" && posts.length === 1) detailUnavailable = true
      events.push("receipt")
      return route.fulfill({ json: {
        status: "committed", operation_id, session_id: id, source_version: null, target_version: 2,
        before_sha256: before, after_sha256: after, birth_token: birth,
      } })
    }
    if (path === "/api/v1/sessions" && method === "GET") {
      const sessions = url.searchParams.get("kind") === "child" ? [] : [detail()]
      return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
    }
    if (path === `/api/v1/sessions/${id}` && method === "GET") {
      if (mode === "success" && migrated) {
        held += 1
        await readbackGate
      }
      if (detailUnavailable) return route.fulfill({ status: 503, json: { error: "Canonical detail unavailable" } })
      events.push(migrated ? "canonical-current" : "canonical-legacy")
      return route.fulfill({ json: { session: detail() }, headers: { ETag: `"${permissionRevision}"` } })
    }
    if (path === `/api/v1/sessions/${id}` && method === "PATCH") {
      const body = request.postDataJSON() as { permission_mode: string }
      const ifMatch = request.headers()["if-match"]
      expect(ifMatch).toBe(`"${permissionRevision}"`)
      expect(Object.keys(body)).toEqual(["permission_mode"])
      permissionWrites.push({ mode: body.permission_mode, ifMatch })
      session.permission_mode = body.permission_mode
      permissionRevision += 1
      return route.fulfill({ json: { session: detail() }, headers: { ETag: `"${permissionRevision}"` } })
    }
    if (path === `/api/v1/history/${id}` && method === "GET") return route.fulfill({ json: { session_id: id, messages: history } })
    if (path === "/api/v1/chat" && method === "POST") return route.fulfill({ status: 201, json: {
      session_id: id, message_id: "continued", ingress_seq: 1, status: "success",
    } })
    if (path === `/api/v1/execute/${id}` && method === "POST") {
      return route.fulfill({ json: { status: "started", session_id: id, run_id: "legacy-continuation" } })
    }
    return route.fallback()
  })
  await page.goto(entry.href)
  await retained(page)
  return {
    observation, posts, mutations, events, session, permissionWrites,
    get reads() { return reads }, get commits() { return commits }, get held() { return held },
    allowDetail() { detailUnavailable = false }, release() { release() },
  }
}

async function retained(page: Page) {
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible()
  for (const message of history) await expect(page.getByText(message.content, { exact: true })).toBeVisible()
}

test("publishes success only after a matching receipt and current canonical readback", async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL, "success")
  try {
    await expect(start(page)).toBeEnabled()
    await input(page).fill("Keep this unsent draft")
    expect(f.posts).toEqual([])
    await start(page).evaluate((element) => {
      const button = element as HTMLButtonElement
      button.click()
      button.click()
    })
    await expect.poll(() => f.held).toBeGreaterThan(0)
    await expect(panel(page)).not.toContainText(done)
    await expect(panel(page).getByRole("button", { name: "Migrating…", exact: true })).toBeDisabled()
    expect(f.posts).toHaveLength(1)
  } finally { f.release() }
  await expect(panel(page)).toHaveCount(0)
  await expect(blocked(page)).toHaveCount(0)
  await retained(page)
  await expectComposerText(input(page), "Keep this unsent draft")
  expect(f.events.lastIndexOf("canonical-current")).toBeGreaterThan(f.events.indexOf("receipt"))
  expect(f.mutations).toEqual([{ path: endpoint, body: f.posts[0] }])
  expect(f.commits).toBe(1)
  expect(f.observation.pageErrors).toEqual([])
})

for (const mode of ["uncertain-post", "uncertain-readback"] as const) {
  test(`${mode} read-only refresh preserves the frozen intent and recovery requires explicit confirmation`, async ({ page, baseURL }) => {
    const f = await fixture(page, baseURL, mode)
    await start(page).click()
    await expect(panel(page)).toContainText(unconfirmed)
    await expect(panel(page)).not.toContainText(done)
    const original = f.posts[0]
    const reads = f.reads
    await refresh(page).click()
    await expect.poll(() => f.reads).toBeGreaterThan(reads)
    await expect(recover(page)).toBeEnabled()
    expect(f.posts).toEqual([original])
    f.allowDetail()
    await recover(page).click()
    await expect(panel(page)).toHaveCount(0)
    await retained(page)
    expect(f.posts).toEqual([original, original])
    expect(f.commits).toBe(1)
    expect(f.observation.pageErrors).toEqual([])
  })
}

test("cold read failure discovers only Bamboo’s exact pending operation after a deliberate refresh", async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL, "cold-pending")
  await expect(page.getByText(/Compatibility could not be checked/)).toBeVisible()
  expect(f.reads).toBe(0)
  await refresh(page).click()
  await expect(recover(page)).toBeVisible()
  expect(f.posts).toEqual([])
  await page.reload()
  await expect(page.getByText(/Compatibility could not be checked/)).toBeVisible()
  await expect(recover(page)).toHaveCount(0)
  expect(f.reads).toBe(1)
  await refresh(page).click()
  await expect(recover(page)).toBeEnabled()
  await expect(start(page)).toHaveCount(0)
  f.allowDetail()
  await recover(page).click()
  await expect(panel(page)).toHaveCount(0)
  await retained(page)
  expect(f.posts).toEqual([pendingIntent])
  expect(f.observation.pageErrors).toEqual([])
})

for (const mode of ["conflict", "replacement"] as const) {
  test(`${mode} canonical identity keeps the exact receipt unconfirmed`, async ({ page, baseURL }) => {
    const f = await fixture(page, baseURL, mode)
    await input(page).fill("Keep this unsent draft")
    await start(page).click()
    await expect(panel(page)).toContainText(unconfirmed)
    await expect(panel(page)).not.toContainText(done)
    await expect(recover(page)).toBeEnabled()
    if (mode === "conflict") {
      await expect(blocked(page)).toBeVisible()
      await expect(send(page)).toBeDisabled()
      await input(page).press("Enter")
    } else {
      await expect(blocked(page)).toHaveCount(0)
      await expect(send(page)).toBeEnabled()
    }
    await expectComposerText(input(page), "Keep this unsent draft")
    expect(f.posts).toHaveLength(1)
    const original = f.posts[0]
    expect(f.mutations).toEqual([{ path: endpoint, body: original }])
    if (mode === "conflict") {
      await refresh(page).click()
      await expect(recover(page)).toBeEnabled()
      expect(f.posts).toEqual([original])
      await recover(page).click()
      await expect(recover(page)).toBeEnabled()
      await expect(blocked(page)).toBeVisible()
      await expect(send(page)).toBeDisabled()
      expect(f.posts).toEqual([original, original])
    }
    expect(f.observation.pageErrors).toEqual([])
  })
}

for (const mode of ["current", "busy", "unsupported"] as const) {
  test(`${mode} does not offer new migration or replay and leaves compatible chat continuation usable`, async ({ page, baseURL }) => {
    const f = await fixture(page, baseURL, mode)
    if (mode === "current") {
      expect(f.reads).toBe(0)
      const permission = page.locator('[data-slot="select-trigger"][aria-label="Permission mode"]')
      await expect(permission).toHaveText("Default")
      await permission.click()
      await page.getByRole("option", { name: "Auto", exact: true }).click()
      await page.getByRole("dialog", { name: "Enable Auto for this session?", exact: true })
        .getByRole("button", { name: "Enable Auto", exact: true }).click()
      await expect(permission).toHaveText("Auto")
      await permission.click()
      await page.getByRole("option", { name: "Default", exact: true }).click()
      await expect(permission).toHaveText("Default")
      expect(f.permissionWrites).toEqual([{ mode: "auto", ifMatch: '"1"' }, { mode: "default", ifMatch: '"2"' }])
      expect(f.reads).toBe(0)
    } else await expect.poll(() => f.reads).toBeGreaterThan(0)
    if (mode === "busy") {
      await panel(page).getByText("Migration is temporarily unavailable", { exact: true }).click()
      await expect(panel(page)).toContainText("An existing operation blocks migration")
    } else await expect(panel(page)).toHaveCount(0)
    await expect(start(page)).toHaveCount(0)
    await expect(recover(page)).toHaveCount(0)
    await expect(blocked(page)).toHaveCount(0)
    const priorWrites = f.mutations.length
    await input(page).fill("Continue this compatible session")
    await send(page).click()
    await expect.poll(() => f.mutations.slice(priorWrites).map((entry) => entry.path)).toEqual(["/api/v1/chat", `/api/v1/execute/${id}`])
    expect(f.mutations[priorWrites].body).toMatchObject({ session_id: id, message: "Continue this compatible session",
      model: f.session.model, model_ref: f.session.model_ref })
    expect(f.posts).toEqual([])
    if (mode === "current") expect(f.reads).toBe(0)
    expect(f.observation.pageErrors).toEqual([])
  })
}
