import { expect, test, type Page } from "@playwright/test"
import { currentUserManagedSessionsFixture, currentUserScopeFixture } from "../../src/services/supervisorScope/testFixtures"
import { actorSnapshotFixture } from "../../src/test/fixtures/actorSnapshot.js"
import { artifactFileForSource, installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

const supervisor = "bamboo-default-supervisor"
const ordinary = "inspector-root"
const createdAt = "2026-10-27T00:00:00Z"
const summary = (id: string, title: string) => ({
  id, title, title_version: 1, kind: "root", root_session_id: id, parent_session_id: null, spawn_depth: 0, project_id: null, pinned: false,
  model: "inspector-fixture-model", model_ref: { provider: "fixture-provider", model: "inspector-fixture-model" },
  created_at: createdAt, updated_at: createdAt, last_activity_at: createdAt, message_count: 0, is_running: false, has_pending_question: false,
  has_attachments: false, subagent_count: 0, root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 0,
  root_mode_birth_token: "a".repeat(64), permission_mode: "default", bypass_permissions: false,
  workspace: "/fixture/inspector",
  token_usage: { system_tokens: 5, summary_tokens: 10, window_tokens: 10, total_tokens: 25, max_context_tokens: 100,
    budget_limit: 100, truncation_occurred: false, segments_removed: 0,
    provider_prompt_usage: { input_tokens: 10, cache_creation_input_tokens: 10, cache_read_input_tokens: 80 } },
})

async function prepare(page: Page, baseURL: string | undefined, sourceId: string) {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, sourceId)
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  const observed = currentUserManagedSessionsFixture()
  const directory = { ...observed, sessions: observed.sessions.slice(0, 1) }
  const target = directory.sessions[0]!.current_user_target!
  const sessions = [summary(sourceId, "Inspector source"), summary(target.session_id, "Managed target")]
  let replaceAfterHistory = false
  const snapshots: string[] = [], directoryQueries: string[] = [], scopeRequests: string[] = [], boundReads: unknown[] = [], unboundTargetReads: string[] = []
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (path === "/api/v1/sessions") {
      const rows = url.searchParams.get("kind") === "child" ? [] : sessions
      return route.fulfill({ json: { sessions: rows, total: rows.length, limit: 100, offset: 0 } })
    }
    const selected = sessions.find((session) => path === `/api/v1/sessions/${session.id}`)
    if (selected) return route.fulfill({ json: { session: selected } })
    const actor = sessions.find((session) => path === `/api/v1/actors/${session.id}/snapshot`)
    if (actor) { snapshots.push(actor.id); return route.fulfill({ json: actorSnapshotFixture(actor.id, 0) }) }
    if (path === `/api/v1/task/${sourceId}`) return route.fulfill({ json: {
      session_id: sourceId, title: "Fixture plan", items: [{ id: "fixture-task", status: "completed", description: "Verified fixture task", depends_on: [] }],
    } })
    if (path === "/api/v1/supervisor/default/sessions") {
      directoryQueries.push(url.search)
      const changed = replaceAfterHistory && boundReads.length > 0 && url.searchParams.has("query")
      return route.fulfill({ json: changed ? { ...directory,
        sessions: directory.sessions.map((link) => ({ ...link, current_user_target: { ...link.current_user_target, authority_sha256: "f".repeat(64) } })),
      } : directory })
    }
    if (path === "/api/v1/supervisor/default/scope") {
      scopeRequests.push(request.method())
      return route.fulfill({ json: currentUserScopeFixture() })
    }
    if (path === `/api/v1/supervisor/default/sessions/${target.session_id}/history`) {
      boundReads.push(request.postDataJSON())
      return route.fulfill({ json: {
        session_id: target.session_id, supervisor: directory.scope.supervisor, current_user_target: target,
        history_snapshot_source: "durable", bound_token_usage: null,
        messages: [{ id: "bound-entry", role: "assistant", content: "Verified bound history", created_at: createdAt }],
      } })
    }
    if (path === `/api/v1/history/${target.session_id}` || path === `/api/v1/sessions/${target.session_id}/history`) unboundTargetReads.push(path)
    return route.fallback()
  })
  await page.goto(entryUrl)
  await expect(page.getByRole("heading", { name: "Inspector source", exact: true })).toBeVisible()
  return { observation, directory, target, snapshots, directoryQueries, scopeRequests, boundReads, unboundTargetReads,
    replaceTarget: () => { replaceAfterHistory = true } }
}

async function openInspector(page: Page) {
  await page.locator('button[aria-controls="right-workbench"]').click()
  const workbench = page.locator("#right-workbench")
  const tab = workbench.getByRole("tab", { name: "检查器", exact: true })
  if (await tab.count()) await tab.click()
  else {
    await workbench.getByRole("button", { name: "打开工作面板标签页" }).click()
    await workbench.getByRole("menuitem", { name: "检查器", exact: true }).click()
  }
  const inspector = workbench.locator("[data-inspector]")
  await expect(inspector).toBeVisible()
  return inspector
}

test("Solid Inspector reads the ordinary actor tree on demand and shows task and cache facts", async ({ page, baseURL }) => {
  const fixture = await prepare(page, baseURL, ordinary)
  expect(fixture.snapshots).toEqual([])
  const inspector = await openInspector(page)
  await expect(inspector.getByRole("tree")).toBeVisible()
  await expect(inspector.getByText("Verified fixture task", { exact: true })).toBeVisible()
  expect(fixture.snapshots).toContain(ordinary)
  expect(fixture.directoryQueries).toEqual([])
  await inspector.getByText("高级信息", { exact: true }).click()
  await expect(inspector.getByText("inspector-fixture-model", { exact: true })).toBeVisible()
  await expect(inspector.locator("[data-context-usage-details]")).toContainText("25%")
  await expect(inspector.locator("[data-prefix-cache-details]")).toContainText("80%")
  expect(fixture.observation.pageErrors).toEqual([])
})

for (const replaced of [false, true]) {
  test(`Solid Supervisor Inspector ${replaced ? "discards a replaced target" : "opens verified bound history"}`, async ({ page, baseURL }) => {
    const fixture = await prepare(page, baseURL, supervisor)
    expect(fixture.directoryQueries).toEqual([])
    const inspector = await openInspector(page)
    const panel = inspector.getByTestId("supervisor-managed-panel")
    const row = panel.locator(`[data-managed-session="${fixture.target.session_id}"]`)
    await expect(row.getByText("Managed target", { exact: true })).toBeVisible()
    await expect(inspector.getByTestId("supervisor-auxiliary-agents")).not.toHaveAttribute("open", "")
    expect(fixture.snapshots).toEqual([])
    expect(fixture.boundReads).toEqual([])
    if (replaced) fixture.replaceTarget()
    await row.getByRole("button", { name: "打开", exact: true }).click()
    if (replaced) {
      await expect(panel.getByRole("alert")).toContainText("无法打开此会话")
      await page.getByRole("button", { name: "收起工作面板", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Inspector source", exact: true })).toBeVisible()
      await expect(page.getByText("Verified bound history", { exact: true })).toBeHidden()
    } else {
      await expect(page.getByRole("heading", { name: "Managed target", exact: true })).toBeVisible()
      const collapse = page.getByRole("button", { name: "收起工作面板", exact: true })
      if (await collapse.isVisible()) await collapse.click()
      await expect(page.getByText("Verified bound history", { exact: true })).toBeVisible()
    }
    expect(fixture.boundReads).toEqual([{ supervisor: fixture.directory.scope.supervisor, target: fixture.target, query: { limit: 100 } }])
    expect(fixture.directoryQueries.filter((query) => query.includes(`query=${fixture.target.session_id}`))).toHaveLength(2)
    expect(fixture.unboundTargetReads).toEqual([])
    expect(fixture.observation.pageErrors).toEqual([])
  })
}

test("Solid Supervisor Inspector loads current-user scope and auxiliary actors only when opened", async ({ page, baseURL }) => {
  const fixture = await prepare(page, baseURL, supervisor)
  const inspector = await openInspector(page)
  const panel = inspector.getByTestId("supervisor-managed-panel")
  await expect(panel.getByText("Managed target", { exact: true })).toBeVisible()
  const browse = panel.getByRole("button", { name: "浏览 Session", exact: true })
  await browse.click()
  const directory = page.getByRole("dialog", { name: "受管会话", exact: true })
  await expect(directory).toBeVisible()
  const scopeTrigger = directory.getByRole("button", { name: "Supervisor 管理", exact: true })
  await scopeTrigger.click()
  const scope = page.getByRole("dialog", { name: "Supervisor 管理", exact: true })
  await expect(scope.getByTestId("current-user-management")).toBeVisible()
  expect(fixture.scopeRequests).toEqual(["GET"])
  await scope.getByRole("button", { name: "关闭", exact: true }).last().click()
  await expect(scope).toBeHidden()
  await expect(directory).toBeVisible()
  await expect(scopeTrigger).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(directory).toBeHidden()
  await expect(browse).toBeFocused()
  const auxiliary = inspector.getByTestId("supervisor-auxiliary-agents")
  expect(fixture.snapshots).toEqual([])
  await auxiliary.locator("summary").click()
  await expect(auxiliary.getByRole("tree")).toBeVisible()
  expect(fixture.snapshots).toContain(supervisor)
  expect(fixture.observation.pageErrors).toEqual([])
})

test("Supervisor directory chunk recovers in place while the Inspector stays usable", async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "One built Supervisor directory chunk recovery case")
  const source = "src/solid/workbench/inspector/SupervisorManagedSessions.tsx"
  const [original, alternate] = await Promise.all([
    artifactFileForSource(source),
    artifactFileForSource(`${source}?supervisor-sessions-retry`),
  ])
  expect(original).not.toBe(alternate)
  const fixture = await prepare(page, baseURL, supervisor)
  const hold = Promise.withResolvers<void>()
  const requests: string[] = []
  let navigations = 0
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations += 1 })
  await page.route("**/assets/SupervisorManagedSessions-*.js", async (route) => {
    const asset = new URL(route.request().url()).pathname.slice(1)
    requests.push(asset)
    if (asset === original) {
      await hold.promise
      return route.abort("failed")
    }
    return route.fallback()
  })
  try {
    const inspector = await openInspector(page)
    const task = inspector.getByText("Verified fixture task", { exact: true })
    await expect(task).toBeVisible()
    await expect(inspector.getByRole("status")).toBeVisible()
    await expect.poll(() => requests).toEqual([original])
    expect(fixture.directoryQueries).toEqual([])
    hold.resolve()
    const alert = inspector.getByRole("alert")
    await expect(alert).toBeVisible()
    await expect(task).toBeVisible()
    await alert.getByRole("button", { name: "重试", exact: true }).click()
    await expect(inspector.getByTestId("supervisor-managed-panel").getByText("Managed target", { exact: true })).toBeVisible()
    await expect(task).toBeVisible()
    expect(requests).toEqual([original, alternate])
    expect(fixture.directoryQueries).toEqual([""])
    expect(fixture.boundReads).toEqual([])
    expect(navigations).toBe(0)
    expect(fixture.observation.pageErrors).toEqual([])
  } finally {
    hold.resolve()
  }
})
