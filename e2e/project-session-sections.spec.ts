import { expect, test, type Locator, type Page, type WebSocketRoute } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import type { PatchProjectRequest, ProjectManifest, ProjectSidebar } from "../src/services/project/types.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const preferenceKey = "lotus.sidebar.project-sections.v1"
const alphaId = "project-alpha"
const betaId = "project-beta"
const alphaEmpty = "section:00000000-0000-4000-8000-000000000001"
const alphaInvestigation = "section:00000000-0000-4000-8000-000000000002"
const betaEmpty = "section:00000000-0000-4000-8000-000000000003"
const at = "2026-10-06T00:00:00.000Z"
type Preferences = {
  version: number
  projects: Record<string, {
    sections: { id: string; name: string }[]
    sessionSections: Record<string, string | null>
    hiddenLegacy: boolean
  }>
}

const initialPreferences: Preferences = {
  version: 1,
  projects: {
    [alphaId]: {
      sections: [{ id: alphaEmpty, name: "Empty target" }, { id: alphaInvestigation, name: "Investigations" }],
      // Preserve an explicit old legacy assignment without giving implicit
      // sessions a default section; Beta has no assignment and stays unsectioned.
      sessionSections: { "all-surface-session": "legacy", "alpha-unsectioned": null, "alpha-search": alphaInvestigation }, hiddenLegacy: false,
    },
    [betaId]: { sections: [{ id: betaEmpty, name: "Empty target" }], sessionSections: {}, hiddenLegacy: false },
  },
}

const projects: ProjectManifest[] = [[alphaId, "Project Alpha"], [betaId, "Project Beta"]].map(([id, name]) => ({
  id, name, section: "lotus", status: "active", revision: 1, resource_revision: 1,
  project_path: `/workspace/${id}`, project_path_status: "configured", workspace_count: 1,
  schema_version: 3, workspace_bindings: [], created_at: at, updated_at: at,
}))

const sessions = [
  ["all-surface-session", "Alpha current", alphaId],
  ["alpha-unsectioned", "Alpha movable", alphaId],
  ["alpha-search", "Alpha searchable investigation", alphaId],
  ["beta-session", "Beta independent", betaId],
].map(([id, title, projectId]) => ({
  id, title, project_id: projectId, title_version: 1, kind: "root", pinned: false,
  root_session_id: id, parent_session_id: null, spawn_depth: 0,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: at, updated_at: at, last_activity_at: at, message_count: 0,
  has_attachments: false, is_running: false, last_run_status: "completed",
  has_pending_question: false, running_child_count: 0, subagent_count: 0,
  permission_mode: "default", bypass_permissions: false,
  root_orchestration_only: false, thinking_mode: "standard", reasoning_effort: "medium",
  root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
}))

const toSidebar = (preference: Preferences["projects"][string]): ProjectSidebar => ({
  sections: structuredClone(preference.sections), session_sections: { ...preference.sessionSections }, hidden_legacy: preference.hiddenLegacy,
})
const emptySidebar = (): ProjectSidebar => ({ sections: [], session_sections: {}, hidden_legacy: false })
type ProjectWrite = { projectId: string; revision: string | undefined; body: PatchProjectRequest; status: number }

function sectionBackend(initialSidebar: "saved" | "empty" | "uninitialized" = "saved") {
  return {
    projects: Object.fromEntries(projects.map((project) => [project.id, {
      ...structuredClone(project), sidebar: initialSidebar === "uninitialized" ? null : initialSidebar === "empty" ? emptySidebar() : toSidebar(initialPreferences.projects[project.id]!),
    }])) as Record<string, ProjectManifest>,
    sessions: sessions.map((item) => ({ ...item, parent_session_id: item.parent_session_id as string | null })),
    writes: [] as ProjectWrite[],
    failNextPatch: null as number | null,
  }
}
type SectionBackend = ReturnType<typeof sectionBackend>

async function installSectionFixture(page: Page, options: {
  backend?: SectionBackend; initialSidebar?: "saved" | "empty" | "uninitialized"; legacyPreferences?: Preferences
} = {}) {
  const backend = options.backend ?? sectionBackend(options.initialSidebar)
  await page.addInitScript(({ key, preferences }) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus.sidebar.grouping-mode.v1", "project")
    if (localStorage.getItem("lotus_next_last_session") === null) localStorage.setItem("lotus_next_last_session", "all-surface-session")
    // Seed only the first load: acknowledged migration must stay cleared on reload.
    if (preferences && localStorage.getItem("section-fixture-legacy-seeded") === null) {
      localStorage.setItem(key, JSON.stringify(preferences))
      localStorage.setItem("section-fixture-legacy-seeded", "1")
    }
  }, { key: preferenceKey, preferences: options.legacyPreferences ?? null })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const projectWrites = backend.writes
  const fixtureSessions = backend.sessions
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (path === "/api/v1/projects") return route.fulfill({ json: { projects: Object.values(backend.projects) } })
    const project = Object.values(backend.projects).find((item) => path === `/api/v1/projects/${item.id}`)
    if (project) {
      if (request.method() === "PATCH") {
        const body = request.postDataJSON() as PatchProjectRequest
        const revision = request.headers()["if-match"]
        const write: ProjectWrite = { projectId: project.id, revision, body, status: 200 }
        projectWrites.push(write)
        if (backend.failNextPatch !== null) {
          write.status = backend.failNextPatch
          backend.failNextPatch = null
          return route.fulfill({ status: write.status, json: { error: "Fixture save failed" } })
        }
        if (revision !== `"${project.revision}"`) {
          write.status = 412
          return route.fulfill({ status: 412, json: { error: "Project revision changed" } })
        }
        let sidebar = body.sidebar
        if (body.import_sidebar) {
          // A second client's stale import cannot overwrite the initialized snapshot.
          if (project.sidebar !== null) {
            write.status = 409
            return route.fulfill({ status: 409, json: { error: "Sidebar already initialized" } })
          }
          const imported = structuredClone(body.import_sidebar)
          imported.session_sections = Object.fromEntries(Object.entries(imported.session_sections).filter(([id]) =>
            fixtureSessions.some((session) => session.id === id && session.project_id === project.id && session.kind === "root" && session.parent_session_id === null),
          ))
          sidebar = imported
        }
        if (!sidebar) {
          write.status = 400
          return route.fulfill({ status: 400, json: { error: "Missing sidebar snapshot" } })
        }
        const allowed = new Set([...(project.section && !sidebar.hidden_legacy ? ["legacy"] : []), ...sidebar.sections.map((section) => section.id)])
        const valid = Object.entries(sidebar.session_sections).every(([id, sectionId]) =>
          fixtureSessions.some((session) => session.id === id && session.project_id === project.id && session.kind === "root" && session.parent_session_id === null)
          && (sectionId === null || allowed.has(sectionId)),
        )
        if (!valid) {
          write.status = 400
          return route.fulfill({ status: 400, json: { error: "Invalid sidebar assignment" } })
        }
        const saved = { ...project, sidebar: structuredClone(sidebar), revision: project.revision + 1 }
        backend.projects[project.id] = saved
        return route.fulfill({ json: saved, headers: { ETag: `"${saved.revision}"` } })
      }
      return route.fulfill({ json: project, headers: { ETag: `"${project.revision}"` } })
    }
    const resources = Object.values(backend.projects).find((item) => path === `/api/v1/projects/${item.id}/resources`)
    if (resources) return route.fulfill({ json: { project_id: resources.id, resource_revision: 1, resources: [] } })
    if (path === "/api/v1/sessions") {
      const kind = url.searchParams.get("kind")
      const root = url.searchParams.get("root_session_id")
      const selected = fixtureSessions.filter((item) => (!kind || item.kind === kind) && (!root || item.root_session_id === root))
      return route.fulfill({ json: { sessions: selected, total: selected.length, limit: 200, offset: 0 } })
    }
    const session = fixtureSessions.find((item) => path === `/api/v1/sessions/${item.id}`)
    if (session) return route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
    const history = fixtureSessions.find((item) => path === `/api/v1/history/${item.id}`)
    if (history) return route.fulfill({ json: { session_id: history.id, messages: [] } })
    const actor = fixtureSessions.find((item) => path === `/api/v1/actors/${item.id}/snapshot`)
    if (actor) return route.fulfill({ json: actorSnapshotFixture(actor.id, 0) })
    if (fixtureSessions.some((item) => path === `/api/v1/task/${item.id}`)) return route.fulfill({ json: { items: [] } })
    if (fixtureSessions.some((item) => path === `/api/v1/respond/${item.id}/pending`)) return route.fulfill({ json: { has_pending_question: false } })
    await route.fallback()
  })
  return { observation, projectWrites, fixtureSessions, backend }
}

const project = (page: Page, id: string) => page.locator(`[data-sidebar-project="${id}"]`)
const section = (scope: Locator, id: string) => scope.locator(`[data-section-id="${id}"]`)
const row = (scope: Locator, id: string) => scope.locator(`[data-sidebar-session="${id}"]`)
const disclosure = (scope: Locator) => scope.locator("button[aria-expanded]:not([aria-haspopup])").first()
const readPreferences = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{"version":1,"projects":{}}') as Preferences, preferenceKey)
const assignment = (backend: SectionBackend, projectId: string, sessionId: string) => backend.projects[projectId]?.sidebar?.session_sections[sessionId]

async function openSidebar(page: Page, phone: boolean) {
  if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await expect(project(page, alphaId)).toBeVisible()
}

async function moveByMenu(page: Page, sessionRow: Locator, target: string) {
  await sessionRow.getByRole("button", { name: "会话操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "移动到分区…", exact: true }).click()
  const destinations = page.getByRole("menu", { name: "移动到分区…", exact: true })
  await expect(destinations).toBeVisible()
  await destinations.getByRole("menuitem", { name: target, exact: true }).click()
}

test("creating a section leaves existing and newly arrived sessions unsectioned until explicitly moved", async ({ page }, testInfo) => {
  const { observation, projectWrites, fixtureSessions, backend } = await installSectionFixture(page, { initialSidebar: "empty" })
  let socket: WebSocketRoute | undefined
  let feedSubscriptions = 0
  await page.routeWebSocket(/.*/, (webSocket) => {
    socket = webSocket
    webSocket.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
      if (frame.type === "hello") webSocket.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") webSocket.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch === "feed") feedSubscriptions += 1
    })
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  const phone = testInfo.project.name === "phone-chromium"
  await openSidebar(page, phone)
  const alpha = project(page, alphaId)
  const beta = project(page, betaId)
  expect(await page.evaluate((key) => localStorage.getItem(key), preferenceKey)).toBe(null)
  for (const id of ["all-surface-session", "alpha-unsectioned", "alpha-search"]) {
    await expect(row(section(alpha, "none"), id)).toBeVisible()
  }
  await expect(row(section(beta, "none"), "beta-session")).toBeVisible()
  await expect(section(alpha, "legacy").locator("[data-sidebar-session]")).toHaveCount(0)
  await expect(section(beta, "legacy").locator("[data-sidebar-session]")).toHaveCount(0)

  await alpha.getByRole("button", { name: "Project Alpha 项目操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "创建分区", exact: true }).click()
  const create = page.getByRole("dialog", { name: "创建分区 · Project Alpha", exact: true })
  await create.getByRole("textbox", { name: "分区名称", exact: true }).fill("Fresh section")
  await create.getByRole("button", { name: "创建", exact: true }).click()
  const fresh = alpha.locator('[data-project-section="Fresh section"]')
  await expect(fresh).toContainText("0 个会话")
  await expect(fresh.locator("[data-sidebar-session]")).toHaveCount(0)
  const freshId = await fresh.getAttribute("data-section-id")
  for (const id of ["all-surface-session", "alpha-unsectioned", "alpha-search"]) {
    await expect(row(section(alpha, "none"), id)).toBeVisible()
  }
  expect(backend.projects[alphaId].sidebar!.session_sections).toEqual({})

  // A canonical backend creation notification refreshes the actual sidebar;
  // a new session must not inherit either the legacy or newest custom section.
  const newId = "alpha-newly-created"
  const newAt = "2026-10-06T00:01:00.000Z"
  fixtureSessions.push({ ...fixtureSessions[0]!, id: newId, root_session_id: newId, title: "Alpha new unsectioned", created_at: newAt, updated_at: newAt, last_activity_at: newAt })
  await expect.poll(() => feedSubscriptions).toBe(1)
  socket!.send(JSON.stringify({
    ch: "feed", seq: 1,
    event: { seq: 1, ts: newAt, session_id: newId, event: { type: "session_created", session_id: newId } },
  }))
  await expect(row(section(alpha, "none"), newId)).toBeVisible()
  await expect(fresh).toContainText("0 个会话")
  await expect(fresh.locator("[data-sidebar-session]")).toHaveCount(0)
  await expect(section(alpha, "legacy").locator("[data-sidebar-session]")).toHaveCount(0)
  expect(assignment(backend, alphaId, newId)).toBeUndefined()
  const emptyScreenshot = testInfo.outputPath("new-section-empty-default-none.png")
  await page.screenshot({ path: emptyScreenshot, animations: "disabled" })
  await testInfo.attach("New section stays empty while existing and new sessions remain unsectioned", { path: emptyScreenshot, contentType: "image/png" })

  await moveByMenu(page, row(alpha, "alpha-unsectioned"), "Fresh section")
  await expect(row(fresh, "alpha-unsectioned")).toBeVisible()
  await expect.poll(() => assignment(backend, alphaId, "alpha-unsectioned")).toBe(freshId)
  await moveByMenu(page, row(alpha, newId), "lotus")
  await expect(row(section(alpha, "legacy"), newId)).toBeVisible()
  await expect.poll(() => assignment(backend, alphaId, newId)).toBe("legacy")
  await page.reload()
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  await openSidebar(page, phone)
  await expect(row(fresh, "alpha-unsectioned")).toBeVisible()
  await expect(row(section(alpha, "legacy"), newId)).toBeVisible()
  await expect(row(section(alpha, "none"), "all-surface-session")).toBeVisible()
  await expect(row(section(alpha, "none"), "alpha-search")).toBeVisible()
  await expect(row(section(beta, "none"), "beta-session")).toBeVisible()
  expect(projectWrites.map(({ projectId, revision, status }) => ({ projectId, revision, status }))).toEqual([
    { projectId: alphaId, revision: '"1"', status: 200 },
    { projectId: alphaId, revision: '"2"', status: 200 },
    { projectId: alphaId, revision: '"3"', status: 200 },
  ])
  expect(await readPreferences(page)).toEqual({ version: 1, projects: {} })
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
})

test("named sections stay inside their project and menu moves persist in the backend", async ({ page }, testInfo) => {
  const { observation, projectWrites, backend } = await installSectionFixture(page)
  const initialBeta = structuredClone(backend.projects[betaId])
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  const phone = testInfo.project.name === "phone-chromium"
  await openSidebar(page, phone)
  const alpha = project(page, alphaId)
  const beta = project(page, betaId)
  await expect(section(alpha, "legacy")).toHaveAttribute("data-project-section", "lotus")
  await expect(section(beta, "legacy")).toHaveAttribute("data-project-section", "lotus")
  await expect(row(section(alpha, "legacy"), "all-surface-session")).toBeVisible()
  await expect(row(section(beta, "none"), "beta-session")).toBeVisible()
  await expect(section(beta, "legacy").locator("[data-sidebar-session]")).toHaveCount(0)
  expect(assignment(backend, betaId, "beta-session")).toBeUndefined()
  await expect(row(section(alpha, "none"), "alpha-unsectioned")).toBeVisible()
  expect(await alpha.evaluate((element) => element.closest("[data-project-section]") === null)).toBe(true)
  expect(await beta.evaluate((element) => element.closest("[data-project-section]") === null)).toBe(true)

  await alpha.getByRole("button", { name: "Project Alpha 项目操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "创建分区", exact: true }).click()
  const create = page.getByRole("dialog", { name: "创建分区 · Project Alpha", exact: true })
  await expect(create).toContainText("分区和会话归属会保存到服务端")
  await create.getByRole("textbox", { name: "分区名称", exact: true }).fill("Research")
  await create.getByRole("button", { name: "创建", exact: true }).click()
  await expect(create).toBeHidden()
  const research = alpha.locator('[data-project-section="Research"]')
  await expect(research).toContainText("拖动会话到这里")
  await expect(beta.locator('[data-project-section="Research"]')).toHaveCount(0)
  const researchId = await research.getAttribute("data-section-id")
  expect(researchId).toMatch(/^section:/)
  await moveByMenu(page, row(alpha, "alpha-unsectioned"), "Research")
  await expect(row(research, "alpha-unsectioned")).toBeVisible()
  await expect.poll(() => assignment(backend, alphaId, "alpha-unsectioned")).toBe(researchId)
  await expect(row(section(beta, "none"), "beta-session")).toBeVisible()
  expect(backend.projects[betaId]).toEqual(initialBeta)
  const groupedScreenshot = testInfo.outputPath("project-session-sections.png")
  await page.screenshot({ path: groupedScreenshot, animations: "disabled" })
  await testInfo.attach("Projects containing server-persisted sections", { path: groupedScreenshot, contentType: "image/png" })

  await page.reload()
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  await openSidebar(page, phone)
  await expect(row(research, "alpha-unsectioned")).toBeVisible()
  await expect(row(alpha, "alpha-unsectioned")).toHaveAttribute("data-session-project", alphaId)
  await moveByMenu(page, row(alpha, "alpha-unsectioned"), "无分区")
  await expect(row(section(alpha, "none"), "alpha-unsectioned")).toBeVisible()
  await expect.poll(() => assignment(backend, alphaId, "alpha-unsectioned")).toBe(null)
  // Removing an occupied section keeps the conversation in its canonical
  // project and records an explicit cleared assignment.
  await moveByMenu(page, row(alpha, "alpha-unsectioned"), "Research")
  await alpha.getByRole("button", { name: "Project Alpha 项目操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "管理分区", exact: true }).click()
  const manage = page.getByRole("dialog", { name: "管理分区 · Project Alpha", exact: true })
  await manage.getByRole("button", { name: "移除分区 Research", exact: true }).click()
  await expect.poll(() => assignment(backend, alphaId, "alpha-unsectioned")).toBe(null)
  await manage.getByRole("button", { name: "取消", exact: true }).click()
  await expect(research).toHaveCount(0)
  await expect(row(section(alpha, "none"), "alpha-unsectioned")).toBeVisible()
  await expect(row(section(beta, "none"), "beta-session")).toBeVisible()
  await alpha.getByRole("button", { name: "Project Alpha 项目操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "管理分区", exact: true }).click()
  await manage.getByRole("button", { name: "移除分区 lotus", exact: true }).click()
  await manage.getByRole("button", { name: "取消", exact: true }).click()
  await expect(section(alpha, "legacy")).toHaveCount(0)
  await expect(row(section(alpha, "none"), "all-surface-session")).toBeVisible()
  await expect(row(section(beta, "none"), "beta-session")).toBeVisible()
  await expect(section(beta, "legacy")).toBeVisible()
  expect(backend.projects[alphaId].sidebar!.hidden_legacy).toBe(true)
  expect(backend.projects[betaId]).toEqual(initialBeta)
  await page.reload()
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  await openSidebar(page, phone)
  await expect(section(alpha, "legacy")).toHaveCount(0)
  await expect(row(section(alpha, "none"), "all-surface-session")).toBeVisible()
  await expect(row(section(beta, "none"), "beta-session")).toBeVisible()
  await expect(section(beta, "legacy").locator("[data-sidebar-session]")).toHaveCount(0)
  expect(projectWrites.map((write) => write.revision)).toEqual(['"1"', '"2"', '"3"', '"4"', '"5"', '"6"'])
  expect(projectWrites.every((write) => write.projectId === alphaId && write.status === 200 && Object.keys(write.body).join() === "sidebar")).toBe(true)
  expect(await readPreferences(page)).toEqual({ version: 1, projects: {} })
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
  const removedScreenshot = testInfo.outputPath("project-session-sections-after-removal.png")
  await page.screenshot({ path: removedScreenshot, animations: "disabled" })
  await testInfo.attach("Sessions retained after section removal", { path: removedScreenshot, contentType: "image/png" })
})

test("desktop drag accepts an empty section and rejects cross-project and forged identities", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "native pointer drag on desktop; menus cover touch viewports")
  const { observation, projectWrites, backend } = await installSectionFixture(page)
  await page.goto(standaloneScenario.entryUrl)
  await openSidebar(page, false)
  const alpha = project(page, alphaId)
  const beta = project(page, betaId)
  const empty = section(alpha, alphaEmpty)
  await expect(empty).toContainText("拖动会话到这里")
  const movable = row(alpha, "alpha-unsectioned")
  await expect(movable).toHaveAttribute("draggable", "true")
  await movable.dragTo(empty)
  await expect(row(empty, "alpha-unsectioned")).toBeVisible()
  await expect.poll(() => assignment(backend, alphaId, "alpha-unsectioned")).toBe(alphaEmpty)
  const beforeCrossProject = structuredClone(backend.projects)
  await row(beta, "beta-session").dragTo(empty)
  await expect(row(section(beta, "none"), "beta-session")).toBeVisible()
  expect(backend.projects).toEqual(beforeCrossProject)
  // Check canonical session ownership as well as the declared drag project.
  await empty.evaluate((element, payload) => {
    const browser = element.ownerDocument.defaultView!
    const transfer = new browser.DataTransfer()
    transfer.setData("application/x-lotus-sidebar-session", JSON.stringify(payload))
    element.dispatchEvent(new browser.DragEvent("drop", { bubbles: true, dataTransfer: transfer }))
  }, { projectId: alphaId, sessionId: "beta-session" })
  await empty.evaluate((element) => new Promise<void>((resolve) => {
    const browser = element.ownerDocument.defaultView!
    browser.requestAnimationFrame(() => browser.requestAnimationFrame(() => resolve()))
  }))
  expect(backend.projects).toEqual(beforeCrossProject)
  await expect(row(section(beta, "none"), "beta-session")).toBeVisible()
  await expect(row(empty, "beta-session")).toHaveCount(0)
  await page.reload()
  await expect(row(section(project(page, alphaId), alphaEmpty), "alpha-unsectioned")).toBeVisible()
  await expect(row(section(project(page, betaId), "none"), "beta-session")).toBeVisible()
  expect(projectWrites).toHaveLength(1)
  expect(projectWrites[0]).toMatchObject({ projectId: alphaId, revision: '"1"', status: 200 })
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
})

test("legacy device sections import once and discard missing, foreign and child assignments", async ({ page }, testInfo) => {
  const backend = sectionBackend("uninitialized")
  backend.sessions.push({ ...backend.sessions[0]!, id: "alpha-child", title: "Hidden child", kind: "child", parent_session_id: "all-surface-session", spawn_depth: 1 })
  const legacyPreferences = structuredClone(initialPreferences)
  Object.assign(legacyPreferences.projects[alphaId].sessionSections, {
    "missing-session": alphaEmpty, "beta-session": alphaEmpty, "alpha-child": alphaEmpty,
  })
  const { observation, projectWrites } = await installSectionFixture(page, { backend, legacyPreferences })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  const phone = testInfo.project.name === "phone-chromium"
  await openSidebar(page, phone)
  await expect.poll(() => backend.projects[alphaId].sidebar).toEqual(toSidebar(initialPreferences.projects[alphaId]))
  await expect.poll(() => backend.projects[betaId].sidebar).toEqual(toSidebar(initialPreferences.projects[betaId]))
  await expect.poll(() => readPreferences(page)).toEqual({ version: 1, projects: {} })
  await expect(row(section(project(page, alphaId), "legacy"), "all-surface-session")).toBeVisible()
  await expect(row(section(project(page, alphaId), alphaInvestigation), "alpha-search")).toBeVisible()
  await expect(row(section(project(page, betaId), "none"), "beta-session")).toBeVisible()
  expect(projectWrites).toHaveLength(2)
  expect(projectWrites.every((write) => write.revision === '"1"' && write.status === 200 && Object.keys(write.body).join() === "import_sidebar")).toBe(true)
  expect(projectWrites.find((write) => write.projectId === alphaId)!.body.import_sidebar!.session_sections).toMatchObject({
    "missing-session": alphaEmpty, "beta-session": alphaEmpty, "alpha-child": alphaEmpty,
  })
  await page.reload()
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  await openSidebar(page, phone)
  await expect(row(section(project(page, alphaId), "legacy"), "all-surface-session")).toBeVisible()
  expect(projectWrites).toHaveLength(2)
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
})

test("server sections survive cleared storage and a clean browser, and stale local data cannot restore a deleted section", async ({ page, browser }, testInfo) => {
  const { observation, projectWrites, backend } = await installSectionFixture(page)
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  const phone = testInfo.project.name === "phone-chromium"
  await openSidebar(page, phone)
  const alpha = project(page, alphaId)
  await alpha.getByRole("button", { name: "Project Alpha 项目操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "管理分区", exact: true }).click()
  const manage = page.getByRole("dialog", { name: "管理分区 · Project Alpha", exact: true })
  await manage.getByRole("button", { name: "移除分区 Empty target", exact: true }).click()
  await expect(manage.getByRole("button", { name: "移除分区 Empty target", exact: true })).toHaveCount(0)
  await manage.getByRole("button", { name: "取消", exact: true }).click()
  await moveByMenu(page, row(alpha, "alpha-unsectioned"), "Investigations")
  await expect(row(section(alpha, alphaInvestigation), "alpha-unsectioned")).toBeVisible()
  expect(projectWrites).toHaveLength(2)

  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  await openSidebar(page, phone)
  await expect(section(alpha, alphaEmpty)).toHaveCount(0)
  await expect(row(section(alpha, alphaInvestigation), "alpha-unsectioned")).toBeVisible()
  expect(await readPreferences(page)).toEqual({ version: 1, projects: {} })

  const cleanContext = await browser.newContext({
    viewport: page.viewportSize() ?? undefined,
    isMobile: phone, hasTouch: phone || testInfo.project.name === "tablet-chromium",
    colorScheme: "dark", locale: "zh-CN",
  })
  try {
    const cleanPage = await cleanContext.newPage()
    const clean = await installSectionFixture(cleanPage, { backend })
    await cleanPage.goto(standaloneScenario.entryUrl)
    await expect(cleanPage.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
    await openSidebar(cleanPage, phone)
    const cleanAlpha = project(cleanPage, alphaId)
    await expect(section(cleanAlpha, alphaEmpty)).toHaveCount(0)
    await expect(row(section(cleanAlpha, alphaInvestigation), "alpha-unsectioned")).toBeVisible()
    expect(await readPreferences(cleanPage)).toEqual({ version: 1, projects: {} })
    expect(projectWrites).toHaveLength(2)
    expect(clean.observation.pageErrors).toEqual([])
    expect(clean.observation.consoleErrors).toEqual([])
    const screenshot = testInfo.outputPath("server-sections-clean-browser.png")
    await cleanPage.screenshot({ path: screenshot, animations: "disabled" })
    await testInfo.attach("Server sections restored in a browser without local preferences", { path: screenshot, contentType: "image/png" })
  } finally {
    await cleanContext.close()
  }

  await page.evaluate(({ key, preferences }) => localStorage.setItem(key, JSON.stringify(preferences)), { key: preferenceKey, preferences: initialPreferences })
  await page.reload()
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  await openSidebar(page, phone)
  await expect(section(alpha, alphaEmpty)).toHaveCount(0)
  await expect(row(section(alpha, alphaInvestigation), "alpha-unsectioned")).toBeVisible()
  expect(await readPreferences(page)).toEqual(initialPreferences)
  expect(projectWrites).toHaveLength(2)
  expect(backend.projects[alphaId].sidebar!.sections.map((item) => item.id)).toEqual([alphaInvestigation])
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
})

test("failed and conflicting section creation retains the draft until the server confirms a retry", async ({ page }, testInfo) => {
  const { observation, projectWrites, backend } = await installSectionFixture(page, { initialSidebar: "empty" })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  const phone = testInfo.project.name === "phone-chromium"
  await openSidebar(page, phone)
  const alpha = project(page, alphaId)
  await alpha.getByRole("button", { name: "Project Alpha 项目操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "创建分区", exact: true }).click()
  const create = page.getByRole("dialog", { name: "创建分区 · Project Alpha", exact: true })
  const name = create.getByRole("textbox", { name: "分区名称", exact: true })
  await name.fill("Research")
  backend.failNextPatch = 503
  await create.getByRole("button", { name: "创建", exact: true }).click()
  await expect(create.getByRole("alert")).toContainText("分区未保存")
  await expect(name).toHaveValue("Research")
  await expect(alpha.locator('[data-project-section="Research"]')).toHaveCount(0)
  expect(backend.projects[alphaId].revision).toBe(1)
  expect(backend.projects[alphaId].sidebar).toEqual(emptySidebar())

  // A different browser wins the same Project revision while this draft is open.
  const winnerId = "section:00000000-0000-4000-8000-000000000004"
  backend.projects[alphaId] = { ...backend.projects[alphaId], revision: 2, sidebar: {
    sections: [{ id: winnerId, name: "Other browser" }], session_sections: {}, hidden_legacy: false,
  } }
  await create.getByRole("button", { name: "创建", exact: true }).click()
  await expect(create.getByRole("alert")).toContainText("已在其他客户端更新")
  await expect(name).toHaveValue("Research")
  await expect(alpha.locator('[data-project-section="Research"]')).toHaveCount(0)
  await expect(section(alpha, winnerId)).toContainText("Other browser")
  expect(backend.projects[alphaId].sidebar!.sections).toEqual([{ id: winnerId, name: "Other browser" }])
  const screenshot = testInfo.outputPath("section-save-conflict-retains-draft.png")
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach("Conflicting save keeps the draft for an explicit retry", { path: screenshot, contentType: "image/png" })

  await create.getByRole("button", { name: "创建", exact: true }).click()
  await expect(create).toBeHidden()
  await expect(alpha.locator('[data-project-section="Research"]')).toContainText("0 个会话")
  expect(backend.projects[alphaId].sidebar!.sections.map((item) => item.name)).toEqual(["Other browser", "Research"])
  expect(projectWrites.map(({ revision, status }) => ({ revision, status }))).toEqual([
    { revision: '"1"', status: 503 }, { revision: '"1"', status: 412 }, { revision: '"2"', status: 200 },
  ])
  expect(await readPreferences(page)).toEqual({ version: 1, projects: {} })
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors.every((message) => /status of (503|412)/.test(message))).toBe(true)
  expect(observation.errorResponses.map((response) => response.split(" ")[0])).toEqual(["503", "412"])
})

test("search reveals folded project sections and selecting a result reveals its active path", async ({ page }, testInfo) => {
  const { observation } = await installSectionFixture(page)
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  const phone = testInfo.project.name === "phone-chromium"
  await openSidebar(page, phone)
  const alpha = project(page, alphaId)
  const investigation = section(alpha, alphaInvestigation)
  const target = row(alpha, "alpha-search")
  await expect(target).toBeVisible()
  await disclosure(investigation).focus()
  await disclosure(investigation).press("Space")
  await expect(disclosure(investigation)).toHaveAttribute("aria-expanded", "false")
  await expect(target).toHaveCount(0)
  await disclosure(alpha).click()
  await expect(disclosure(alpha)).toHaveAttribute("aria-expanded", "false")
  const search = page.locator("aside").getByPlaceholder("搜索会话")
  await search.fill("Alpha searchable")
  await expect(target).toBeVisible()
  await search.fill("")
  await expect(disclosure(alpha)).toHaveAttribute("aria-expanded", "false")
  await expect(target).toHaveCount(0)
  await search.fill("Alpha searchable")
  await target.getByRole("button", { name: "Alpha searchable investigation", exact: true }).click()
  await expect(page.locator("header").getByText("Alpha searchable investigation", { exact: true })).toBeVisible()
  if (phone) await openSidebar(page, true)
  await search.fill("")
  await expect(disclosure(alpha)).toHaveAttribute("aria-expanded", "true")
  await expect(disclosure(investigation)).toHaveAttribute("aria-expanded", "true")
  await expect(target).toBeVisible()
  await expect(target).toHaveAttribute("data-session-project", alphaId)
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
})
