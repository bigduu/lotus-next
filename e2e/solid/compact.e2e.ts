import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"
import { expectComposerText } from "../support/composer.js"

const sessionId = "all-surface-session"
const endpoint = `/api/v1/sessions/${sessionId}/compact`
const editor = (page: Page) => page.getByRole("textbox", { name: "Messages", exact: true })
const command = (page: Page) => page.getByRole("option", { name: /^\/compact(?:\s|$)/ })
const progress = (page: Page) => page.getByTestId("context-compression-notice")
const usage = {
  total_tokens: 24_000, max_context_tokens: 100_000, system_tokens: 1_000, summary_tokens: 1_000,
  window_tokens: 22_000, budget_limit: 96_000, truncation_occurred: false, segments_removed: 0,
}

async function fixture(page: Page, baseURL: string | undefined, status = false) {
  const entry = new URL("/", baseURL)
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", id)
  }, sessionId)
  const observed = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: entry.origin, entryUrl: entry.href,
  }, [], { serveStaticFromLocalServer: true, sessionFeatures: status ? ["session_compaction_status"] : [] })
  const mutations: string[] = []
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname
    if (request.method() === "POST" && pathname.startsWith("/api/v1/")) mutations.push(pathname)
  })
  const open = async () => {
    await page.goto(entry.href)
    await expect(page.getByRole("heading", { name: "All-surface acceptance", exact: true })).toBeVisible()
  }
  return { open, observed, mutations }
}

test("compacts only through the dedicated endpoint, keeps refused drafts, and updates the context meter on receipt", async ({ page, baseURL }) => {
  const { open, observed, mutations } = await fixture(page, baseURL)
  let count = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route(`**${endpoint}`, async (route) => {
    expect(route.request().method()).toBe("POST")
    count += 1
    if (count === 1) return route.fulfill({ status: 404, json: { error: "Not found" } })
    if (count === 2) return route.fulfill({ status: 422, json: { error: {
      code: "context_summary_empty", message: "private diagnostic fixture",
    } } })
    await gate
    return route.fulfill({ json: {
      session_id: sessionId, status: "compacted", usage_before_percent: 73.2, usage_after_percent: 24, token_usage: usage,
    } })
  })

  await open()
  const input = editor(page)
  await input.fill("/co")
  await expect(command(page)).toBeEnabled()
  await command(page).click()
  const notFound = page.getByRole("alert").filter({ hasText: "its Bamboo version does not support /compact" })
  await expect(notFound).toBeVisible()
  await expectComposerText(input, "/compact")
  await notFound.getByRole("button", { name: "Close", exact: true }).click()

  await input.press("Enter")
  const empty = page.getByRole("alert").filter({ hasText: "Your conversation history was preserved." })
  await expect(empty).toBeVisible()
  await expect(empty).not.toContainText("private diagnostic fixture")
  await expectComposerText(input, "/compact")
  await empty.getByRole("button", { name: "Close", exact: true }).click()

  try {
    await input.press("Enter")
    await expect(progress(page)).toHaveText("Compacting context…")
    await expect(input).toHaveAttribute("aria-busy", "true")
    await input.press("Enter")
    expect(mutations).toEqual([endpoint, endpoint, endpoint])
  } finally { release() }
  await expectComposerText(input, "")
  await expect(page.getByText("Context compacted. Estimated usage 73.2% → 24%.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Context usage", exact: true })).toHaveAttribute("title", /24%/)
  await expect(input).toHaveAttribute("aria-busy", "false")
  expect(mutations).toEqual([endpoint, endpoint, endpoint])
  expect(observed.pageErrors).toEqual([])
})

test("recovers advertised progress and distinguishes a configured strategy from the last applied strategy", async ({ page, baseURL }) => {
  const { open, observed, mutations } = await fixture(page, baseURL, true)
  const preparing = {
    id: "attempt", strategy: "message_summary", phase: "summarizing", part: 2, total: 4, elapsed_ms: 38_000,
  }
  let active: typeof preparing | null = preparing
  let applied = { id: "previous", strategy: "summary" }
  await page.route(`**${endpoint}`, (route) => {
    expect(route.request().method()).toBe("GET")
    return route.fulfill({ json: { session_id: sessionId, configured_strategy: "message_summary", active, applied } })
  })

  const notice = progress(page)
  await open()
  await expect(notice).toContainText("Generating summary part 2 of 4…")
  await expect(notice).toContainText("Elapsed 38s")
  await expect(notice).toContainText("Last applied strategy Full conversation summary")
  await expect(notice).toContainText("This compaction uses Message text summary.")
  await expect(notice).not.toContainText("Last applied strategy Message text summary")
  active = null
  await page.reload()
  await expect(notice).toContainText("Next compaction will use Message text summary.")
  await expect(notice).not.toContainText("Generating summary")
  await expect(editor(page)).toHaveAttribute("aria-busy", "false")

  active = preparing
  await page.reload()
  await expect(notice).toContainText("Generating summary part 2 of 4…")
  active = null
  applied = { id: "attempt", strategy: "message_summary" }
  await expect(notice).toContainText("Last applied strategy Message text summary")
  await expect(notice).not.toContainText("Next compaction")
  await page.reload()
  await expect(notice).toContainText("Last applied strategy Message text summary")
  expect(mutations).toEqual([])
  expect(observed.pageErrors).toEqual([])
})

test("blocks an attached draft and preserves edits made while a valid compact receipt was pending", async ({ page, baseURL }) => {
  const { open, observed, mutations } = await fixture(page, baseURL)
  let finish!: () => void
  const gate = new Promise<void>((resolve) => { finish = resolve })
  await page.route(`**${endpoint}`, async (route) => {
    expect(route.request().method()).toBe("POST")
    await gate
    return route.fulfill({ json: { session_id: sessionId, status: "unchanged" } })
  })
  await open()
  const input = editor(page)
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: "fixture.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9EoAAAAASUVORK5CYII=", "base64"),
  })
  await input.fill("/compact")
  await expect(command(page)).toBeDisabled()
  await expect(command(page)).toContainText("Use /compact by itself.")
  await input.press("Enter")
  expect(mutations).toEqual([])

  await page.getByRole("button", { name: "Remove image", exact: true }).click()
  try {
    await input.press("Enter")
    await expect(progress(page)).toHaveText("Compacting context…")
    await input.fill("Keep this newer draft")
    await expectComposerText(input, "Keep this newer draft")
    expect(mutations).toEqual([endpoint])
  } finally { finish() }
  await expect(page.getByText("Context unchanged. There was nothing eligible to compact.", { exact: true })).toBeVisible()
  await expectComposerText(input, "Keep this newer draft")
  expect(mutations).toEqual([endpoint])
  expect(observed.pageErrors).toEqual([])
})

test("keeps compact unavailable while the root is suspended awaiting children", async ({ page, baseURL }) => {
  const { open, observed, mutations } = await fixture(page, baseURL)
  const at = "2026-09-03T00:00:00.000Z"
  const suspended = {
    id: sessionId, root_session_id: sessionId, kind: "root", title: "All-surface acceptance", title_version: 1,
    session_version: 2, created_at: at, updated_at: at, last_activity_at: at, is_running: false,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    thinking_mode: "standard", root_orchestration_only: false, root_mode_transition_epoch: 1,
    root_mode_birth_token: "a".repeat(64), permission_mode: "default",
    last_run_status: "suspended", activity: "waiting_children", running_child_count: 1,
    execution_compatibility: { status: "compatible", session_version: 2, current_session_version: 2, execution_allowed: true, history_readable: true, conflicts: [] },
  }
  await page.route((url) => url.pathname === "/api/v1/sessions", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind")
    const sessions = kind === "child" ? [] : [suspended]
    return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
  })
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => route.fulfill({ json: { session: suspended }, headers: { ETag: '"1"' } }))
  await open()
  const input = editor(page)
  await input.fill("/compact")
  await expect(command(page)).toBeDisabled()
  await expect(command(page)).toContainText("Wait for the session to become idle before compacting.")
  await input.press("Enter")
  await expect(page.getByRole("status").filter({ hasText: "Wait for the session to become idle before compacting." })).toBeVisible()
  await expectComposerText(input, "/compact")
  expect(mutations).toEqual([])
  expect(observed.pageErrors).toEqual([])
})
