import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

const root = "all-surface-session"
const other = "environment-other-session"
const at = "2026-11-23T00:00:00Z"
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9EoAAAAASUVORK5CYII=", "base64")
const summary = (id: string, title: string, workspace: string) => ({
  id, title, kind: "root", title_version: 1, root_session_id: id, created_at: at, updated_at: at, last_activity_at: at,
  is_running: false, last_run_status: "completed", permission_mode: "default", workspace_path: workspace,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  root_orchestration_only: false, thinking_mode: "standard", root_mode_birth_token: "a".repeat(64),
  root_mode_transition_epoch: 1, session_version: 2, subagent_count: 0,
  execution_compatibility: { status: "compatible", session_version: 2, current_session_version: 2, execution_allowed: true, history_readable: true, conflicts: [] },
  placement: { kind: "local", host: "fixture" },
})
const first = summary(root, "Environment fixture", "/fixture/main")
const second = summary(other, "Other environment", "/fixture/other")
const card = (page: Page) => page.getByRole("region", { name: "Environment", exact: true })
const floating = (page: Page) => page.locator("[data-environment-floating]")
const open = (page: Page) => page.getByRole("button", { name: "Open Environment", exact: true })
const close = (page: Page) => page.getByRole("button", { name: "Collapse Environment", exact: true })

async function installFixture(page: Page, baseURL: string | undefined, older?: Promise<void>) {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", id)
  }, root)
  const observed = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  await page.route((url) => url.pathname === "/api/v1/sessions", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind")
    const sessions = kind === "child" ? [] : [first, second]
    return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
  })
  for (const session of [first, second]) {
    await page.route(`**/api/v1/sessions/${session.id}`, (route) => route.fulfill({ json: { session }, headers: { ETag: '"1"' } }))
  }
  const calls: Array<string | null> = []
  const rows = Array.from({ length: older ? 105 : 1 }, (_, index) => {
    const entry = { id: `environment-row-${index}`, role: "user", content: `Environment message ${index}`, created_at: at }
    if (older && index === 0) return { ...entry, content_parts: [
      { type: "image_url", image_url: { url: `bamboo-attachment://${root}/archived.png` } },
    ] }
    if (older && index === 1) return { ...entry, role: "assistant", content: "", tool_calls: [
      { id: "archived-edit", type: "function", function: { name: "Edit", arguments: "{}" } },
    ] }
    if (older && index === 2) return { ...entry, role: "tool", tool_call_id: "archived-edit", tool_success: true, content: JSON.stringify({
      operation: "edit", file_path: "/fixture/main/archived.ts",
      diff: { unified: "--- a\n+++ b\n@@ -1 +1 @@\n-before\n+after" },
    }) }
    return entry
  })
  await page.route(`**/api/v1/sessions/${root}/attachments/archived.png`, (route) =>
    route.fulfill({ contentType: "image/png", body: png }))
  await page.route((url) => url.pathname === `/api/v1/history/${root}`, async (route) => {
    const before = new URL(route.request().url()).searchParams.get("before_message_id")
    calls.push(before)
    if (!older) return route.fulfill({ json: { session_id: root, messages: rows } })
    if (before) await older
    return route.fulfill({ json: {
      session_id: root, messages: before ? rows.slice(0, 5) : rows.slice(5), is_delta: false,
      history_start_index: before ? 0 : 5, total_message_count: 105, next_before_message_id: before ? null : "environment/5",
    } })
  })
  await page.route((url) => url.pathname === `/api/v1/history/${other}`, (route) =>
    route.fulfill({ json: { session_id: other, messages: [{ id: "other-row", role: "user", content: "Other session message", created_at: at }] } }))
  await page.goto(entryUrl)
  await expect(page.getByRole("heading", { name: first.title, exact: true })).toBeVisible()
  return { calls, observed }
}

async function selectSession(page: Page, title: string, mobile: boolean) {
  if (mobile) await page.getByRole("button", { name: "Menu", exact: true }).click()
  await page.getByRole("button", { name: title, exact: true }).click()
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible()
}

const inset = (page: Page) => page.locator("[data-chat-layout] > [data-chat-body]").evaluate((element) =>
  parseFloat(getComputedStyle(element).paddingInlineEnd))

test("Environment follows the actual pane width, session visit and workbench visibility", async ({ page, baseURL, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 1900, height: 900 })
  const { observed } = await installFixture(page, baseURL)
  if (isMobile) {
    await expect(open(page)).toBeVisible()
  } else {
    await expect(close(page)).toBeVisible()
    await expect.poll(() => inset(page)).toBe(332)
    await close(page).click()
    await page.setViewportSize({ width: 1400, height: 900 })
  }
  await expect(open(page)).toHaveAttribute("aria-expanded", "false")
  await open(page).click()
  await expect(card(page)).toBeVisible()
  await expect(card(page).getByText("main", { exact: true })).toBeVisible()
  await expect.poll(() => inset(page)).toBe(0)
  if (!isMobile) {
    await page.setViewportSize({ width: 1900, height: 900 })
    await expect.poll(() => inset(page)).toBe(332)
  }

  await page.getByRole("button", { name: "Open side panel", exact: true }).click()
  const workbench = page.locator("#right-workbench")
  await expect(workbench).toBeVisible()
  await expect(floating(page)).toHaveAttribute("data-state", "closed")
  await workbench.getByRole("button", { name: "Collapse workbench", exact: true }).click()
  await expect(card(page)).toBeVisible()
  if (!isMobile) await close(page).click()

  await selectSession(page, second.title, isMobile)
  if (isMobile) {
    await expect(open(page)).toHaveAttribute("aria-expanded", "false")
    await open(page).click()
  }
  await expect(card(page).getByText("other", { exact: true })).toBeVisible()
  await selectSession(page, first.title, isMobile)
  if (isMobile) {
    await expect(open(page)).toHaveAttribute("aria-expanded", "false")
    await open(page).click()
  }
  await expect(card(page).getByText("main", { exact: true })).toBeVisible()

  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "draft-environment.png", mimeType: "image/png", buffer: png })
  const draftPreview = card(page).getByRole("button", { name: "Preview draft-environment.png", exact: true })
  await expect(draftPreview).toBeVisible()
  await draftPreview.click()
  await expect(page.getByRole("dialog", { name: "Close preview", exact: true })).toBeVisible()
  expect(observed.pageErrors).toEqual([])
})

test("loads earlier sources on demand and shares one prefix with Review without expanding the transcript", async ({ page, baseURL, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 1900, height: 900 })
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const { calls, observed } = await installFixture(page, baseURL, pending)
  const changes = card(page).getByRole("button", { name: /^Changes/ })
  await expect(page.getByText("Environment message 104", { exact: true })).toBeVisible()
  try {
    expect(calls.filter(Boolean)).toEqual([])
    if (isMobile) await open(page).click()
    else {
      await expect(changes).toHaveText("Changes")
      await card(page).getByRole("button", { name: "Load earlier sources", exact: true }).click()
    }
    await expect(card(page).getByText("Loading earlier conversation history…", { exact: true })).toBeVisible()
    await expect(changes).toHaveText("Changes")
    await expect.poll(() => calls.filter(Boolean)).toEqual(["environment/5"])
  } finally { release() }

  await expect(card(page).getByRole("button", { name: "Preview attachment-archived.png", exact: true })).toBeVisible()
  await expect(changes).toContainText("1 changed file")
  await changes.click()
  const review = page.locator("#right-workbench").getByRole("tabpanel", { name: "Review", exact: true })
  await expect(review.getByText("archived.ts", { exact: false }).first()).toBeVisible()
  expect(calls.filter(Boolean)).toEqual(["environment/5"])
  await expect(page.getByText("Environment message 0", { exact: true })).toHaveCount(0)
  expect(observed.pageErrors).toEqual([])
})
