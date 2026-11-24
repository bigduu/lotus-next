import { expect, test, type Page } from "@playwright/test"
import { ticketSnapshot } from "../src/services/tickets/testFixtures.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const id = "bamboo-default-supervisor"
const ordinaryId = "ordinary-root"
const ordinaryTitle = "Other session"
const title = "Supervisor focus fixture"
const timestamp = "2026-10-05T00:00:00Z"
const supervisor = {
  id, title, kind: "root", title_version: 1, root_session_id: id, parent_session_id: null,
  is_running: false, last_run_status: "completed", spawn_depth: 0,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: timestamp, updated_at: timestamp, permission_mode: "default",
  root_orchestration_only: true, thinking_mode: "ultra",
  root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
}

async function install(page: Page, session: Omit<typeof supervisor, "parent_session_id"> & { parent_session_id: string | null }) {
  const ordinary = { ...supervisor, id: ordinaryId, title: ordinaryTitle, root_session_id: ordinaryId }
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, session.id)
  const observation = await installArtifactRuntime(page, standaloneScenario, [], { sessionId: session.id })
  const { scope, views } = ticketSnapshot()
  scope.binding.supervisor_session_id = session.id
  await page.route("**/api/v1/sessions?*", (route) => {
    const child = new URL(route.request().url()).searchParams.get("kind") === "child"
    const sessions = [session, ordinary].filter((entry) => (entry.kind === "child") === child)
    return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
  })
  for (const entry of [session, ordinary]) {
    await page.route(`**/api/v1/sessions/${entry.id}`, (route) =>
      route.fulfill({ json: { session: entry }, headers: { ETag: '"1"' } }))
    await page.route(`**/api/v1/history/${entry.id}`, (route) =>
      route.fulfill({ json: { session_id: entry.id, messages: [] } }))
    await page.route(`**/api/v1/respond/${entry.id}/pending`, (route) =>
      route.fulfill({ json: { has_pending_question: false } }))
  }
  await page.route("**/api/v1/supervisor/default", (route) =>
    route.fulfill({ json: { session_id: id, incarnation_id: "fixture-incarnation" } }))
  await page.route("**/api/v1/supervisor/default/approvals", (route) => route.fulfill({ json: { approvals: [] } }))
  await page.route("**/api/v1/tickets/scope", (route) => route.fulfill({ json: scope }))
  await page.route("**/api/v1/tickets/search", (route) => route.fulfill({ json: {
    ...scope.overview, data: views.map(({ ticket }) => ({ id: ticket.id, kind: ticket.kind })),
  } }))
  await page.route("**/api/v1/tickets/inspect", (route) => route.fulfill({ json: { ...scope.overview, data: views } }))
  await page.route("**/api/v1/tickets/changes", (route) => route.fulfill({ json: { ...scope.overview, data: [] } }))
  return observation
}

for (const outcome of ["ready", "new pointer", "session navigation", "hidden page"] as const) {
  test(`lazy Work overview respects ${outcome}`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "desktop Workbench focus path")
    const observation = await install(page, supervisor)
    let release!: () => void
    const waitForRelease = new Promise<void>((resolve) => { release = resolve })
    let requests = 0
    await page.route("**/assets/TicketWorkPanel-*.js", async (route) => {
      requests += 1
      await waitForRelease
      await route.fallback()
    })
    await page.goto(standaloneScenario.entryUrl)
    const button = page.getByTestId("ticket-work-status")
    const overview = page.getByTestId("ticket-work-overview")
    const settings = page.locator('[data-slot="settings-page"]')
    const heading = page.getByRole("heading", { name: title, exact: true })
    const selectSession = async (name: string) => {
      await page.locator("aside").getByRole("button", { name, exact: true }).click()
      await expect(page.getByRole("banner")).toContainText(name)
    }
    await expect(button).toContainText("5 项工作")
    expect(requests).toBe(0)
    await button.click()
    try {
      await page.getByRole("button", { name: "查看全部工作", exact: true }).click()
      await expect.poll(() => requests).toBe(1)
      await expect(overview).toHaveCount(0)
      if (outcome === "new pointer") await heading.click()
      if (outcome === "session navigation") {
        await selectSession(ordinaryTitle)
        await selectSession(title)
      }
      if (outcome === "hidden page") {
        await page.keyboard.press("Control+k")
        const search = page.getByPlaceholder("搜索会话或操作…")
        await search.fill("系统设置")
        await search.press("Enter")
        await expect(settings).toBeVisible()
      }
    } finally {
      release()
    }
    if (outcome === "hidden page") {
      await settings.getByRole("button", { name: "返回聊天", exact: true }).click()
      await expect(settings).toBeHidden()
    }
    await expect(overview).toBeVisible()
    if (outcome === "ready") await expect(overview).toBeFocused()
    else await expect(overview).not.toBeFocused()
    expect(observation.pageErrors).toEqual([])
  })
}

for (const [name, session] of [
  ["ordinary title", { ...supervisor, id: "ordinary-titled", root_session_id: "ordinary-titled" }],
  ["builtin child", { ...supervisor, kind: "child", parent_session_id: ordinaryId, root_session_id: ordinaryId, spawn_depth: 1 }],
  ["builtin ID with a parent", { ...supervisor, parent_session_id: ordinaryId }],
] as const) {
  test(`Work controls require the actual Supervisor identity: ${name}`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "one canonical identity check per fixture")
    await install(page, session)
    await page.goto(standaloneScenario.entryUrl)
    // The reserved builtin ID cannot restore as a Child. The ordinary Root
    // becomes the initial conversation in that fixture.
    await expect(page.getByRole("banner")).toContainText(session.kind === "child" ? ordinaryTitle : title)
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
    await expect(page.getByTestId("ticket-work-status")).toHaveCount(0)
  })
}
