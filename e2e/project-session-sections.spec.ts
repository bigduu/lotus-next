import { expect, test, type Locator, type Page, type WebSocketRoute } from "@playwright/test"
import { closeSettings, selectSettingsCategory, settingsSurface } from "./support/settingsNavigation.ts"
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

const handle = (scope: Locator, kind: "session" | "section", id: string) => scope.locator(`[data-sidebar-drag-handle="${kind}:${id}"]:not([inert])`)
const targetHeader = (target: Locator) => target.locator("[data-sidebar-section-header]").first()
async function pointerDrop(page: Page, source: Locator, target: Locator, reject = false) {
  await source.scrollIntoViewIfNeeded()
  const start = (await source.boundingBox())!
  const end = (await target.boundingBox())!
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2 + 8)
  await expect(source).toHaveAttribute("data-sidebar-dragging", "true")
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 })
  if (!reject) await expect(target.locator("xpath=ancestor-or-self::*[@data-sidebar-drop-target][1]")).toHaveAttribute("data-drop-active", "true")
  await page.mouse.up()
}

async function keyboardPickup(page: Page, source: Locator) {
  await expect(source).toBeVisible()
  await expect(source).toBeEnabled()
  await expect(source).not.toHaveAttribute("data-dnd-dragging", "true")
  await source.focus()
  await page.keyboard.press("Space")
  await expect(source).toHaveAttribute("data-sidebar-dragging", "true")
}
async function keyboardDrop(page: Page, source: Locator, target: Locator, before = false) {
  await expect(source).toBeVisible()
  await expect(source).toBeEnabled()
  const start = (await source.boundingBox())!
  const end = (await target.boundingBox())!
  await keyboardPickup(page, source)
  const destinationY = end.y + end.height * (before ? 0.25 : 0.5)
  const steps = Math.round((destinationY - start.y - start.height / 2) / 10)
  for (let index = 0; index < Math.abs(steps); index += 1) await page.keyboard.press(steps < 0 ? "ArrowUp" : "ArrowDown")
  await expect(target.locator("xpath=ancestor-or-self::*[@data-sidebar-drop-target][1]")).toHaveAttribute("data-drop-active", "true")
  await page.keyboard.press("Space")
}

async function sidebarGeometryFrames(scope: Locator, sessionId: string, count: number) {
  return scope.evaluate(async (projectElement, { sessionId, count }) => {
    const browser = projectElement.ownerDocument.defaultView!
    const sidebar = projectElement.closest("aside")!
    const list = projectElement.closest(".overflow-y-auto")!
    const measure = (element: { getBoundingClientRect(): { x: number; y: number; width: number; height: number } }) => {
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height }
    }
    const samples = []
    for (let frame = 0; frame < count; frame += 1) {
      await new Promise<void>((resolve) => browser.requestAnimationFrame(() => resolve()))
      const source = projectElement.querySelector(`[data-sidebar-session="${sessionId}"]`)!
      samples.push({
        rects: {
          source: measure(source),
          label: measure(source.querySelector("button")!),
          peer: measure(projectElement.querySelector('[data-sidebar-session="alpha-search"]')!),
          header: measure(projectElement.querySelector("[data-project-drop]")!),
        },
        scrollTop: list.scrollTop,
        feedbackElements: sidebar.querySelectorAll("[data-dnd-dragging], [data-dnd-placeholder]").length,
      })
    }
    return samples
  }, { sessionId, count })
}

type SidebarGeometry = Awaited<ReturnType<typeof sidebarGeometryFrames>>[number]
function expectStableSidebarGeometry(samples: SidebarGeometry[], baseline: SidebarGeometry) {
  for (const sample of samples) {
    for (const key of ["source", "label", "peer", "header"] as const) {
      for (const dimension of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(sample.rects[key][dimension] - baseline.rects[key][dimension]), `${key}.${dimension}`).toBeLessThanOrEqual(0.5)
      }
    }
    expect(Math.abs(sample.scrollTop - baseline.scrollTop)).toBeLessThanOrEqual(0.5)
    expect(sample.feedbackElements).toBe(0)
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const gesture of ["pointer", "keyboard"] as const) {
    test(`sidebar release stays still during a pending ${gesture} move in ${theme}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop-chromium", "paired-theme desktop release geometry")
      await page.emulateMedia({ colorScheme: theme, reducedMotion: gesture === "keyboard" ? "reduce" : "no-preference" })
      await page.addInitScript((mode) => localStorage.setItem("copilot_ui_theme_v1", mode), theme)
      const { observation, projectWrites, backend } = await installSectionFixture(page)
      let release!: () => void
      const pending = new Promise<void>((resolve) => { release = resolve })
      let pendingRequests = 0
      await page.route(`**/api/v1/projects/${alphaId}`, async (route) => {
        if (route.request().method() === "PATCH") { pendingRequests += 1; await pending }
        await route.fallback()
      })
      try {
        await page.goto(standaloneScenario.entryUrl)
        await openSidebar(page, false)
        expect(await page.locator("html").evaluate((element) => element.classList.contains("dark"))).toBe(theme === "dark")
        await expect(page.locator("aside").getByText("Bodhi", { exact: true })).toHaveCSS("font-weight", theme === "dark" ? "500" : "600")
        const alpha = project(page, alphaId)
        const source = handle(alpha, "session", "alpha-unsectioned")
        await expect(source).toBeVisible()
        await source.scrollIntoViewIfNeeded()
        const sourceElement = await source.elementHandle()
        const [before] = await sidebarGeometryFrames(alpha, "alpha-unsectioned", 1)
        const destination = targetHeader(section(alpha, alphaEmpty))
        if (gesture === "pointer") await pointerDrop(page, source, destination)
        else await keyboardDrop(page, source, destination)
        await expect.poll(() => pendingRequests).toBe(1)
        await expect(alpha).toHaveAttribute("aria-busy", "true")
        await expect(source).toHaveCount(1)
        await expect(source).toBeDisabled()
        expect(await sourceElement!.evaluate((element) => element.isConnected)).toBe(true)
        await expect(handle(alpha, "session", "alpha-search")).toBeDisabled()
        await expect(handle(project(page, betaId), "session", "beta-session")).toBeEnabled()
        expect(assignment(backend, alphaId, "alpha-unsectioned")).toBe(null)
        const pendingFrames = await sidebarGeometryFrames(alpha, "alpha-unsectioned", 12)
        expectStableSidebarGeometry(pendingFrames, before)
        const saving = page.locator("aside").getByRole("status").filter({ hasText: "正在保存分区" })
        await expect(saving).toBeVisible()
        expect(await saving.evaluate((element) => !!element.closest(".overflow-y-auto"))).toBe(false)
        await testInfo.attach(`sidebar-pending-${gesture}-${theme}`, { body: await page.screenshot(), contentType: "image/png" })
        release()
        await expect(row(section(alpha, alphaEmpty), "alpha-unsectioned")).toBeVisible()
        await expect(alpha).toHaveAttribute("aria-busy", "false")
        await expect(source).toBeEnabled()
        if (gesture === "keyboard") await expect(source).toBeFocused()
        const committedFrames = await sidebarGeometryFrames(alpha, "alpha-unsectioned", 12)
        expectStableSidebarGeometry(committedFrames, committedFrames[0])
        expect(projectWrites).toHaveLength(1)
        expect(projectWrites[0]).toMatchObject({ projectId: alphaId, revision: '"1"', status: 200 })
        await expect(saving).toHaveCount(0)
        await testInfo.attach(`sidebar-release-geometry-${gesture}-${theme}`, {
          body: JSON.stringify({ before, pendingFrames, committedFrames }), contentType: "application/json",
        })
        expect(observation.pageErrors).toEqual([])
        expect(observation.consoleErrors).toEqual([])
      } finally {
        release()
      }
    })
  }
}

test("internal pointer drag accepts empty sections and rejects cross-project and forged native identities", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "pointer acceptance; touch and keyboard have independent cases")
  const { observation, projectWrites, backend } = await installSectionFixture(page)
  await page.goto(standaloneScenario.entryUrl)
  await openSidebar(page, false)
  const alpha = project(page, alphaId)
  const beta = project(page, betaId)
  const empty = section(alpha, alphaEmpty)
  await expect(empty).toContainText("拖动会话到这里")
  const movable = row(alpha, "alpha-unsectioned")
  await expect(movable).toHaveAttribute("draggable", "true")
  await pointerDrop(page, handle(alpha, "session", "alpha-unsectioned"), targetHeader(empty))
  await expect(row(empty, "alpha-unsectioned")).toBeVisible()
  await expect.poll(() => assignment(backend, alphaId, "alpha-unsectioned")).toBe(alphaEmpty)
  const beforeCrossProject = structuredClone(backend.projects)
  await pointerDrop(page, handle(beta, "session", "beta-session"), targetHeader(empty), true)
  await expect(row(section(beta, "none"), "beta-session")).toBeVisible()
  expect(backend.projects).toEqual(beforeCrossProject)
  await empty.evaluate((element, payload) => {
    const browser = element.ownerDocument.defaultView!
    const transfer = new browser.DataTransfer()
    transfer.setData("application/x-lotus-sidebar-session", JSON.stringify(payload))
    element.dispatchEvent(new browser.DragEvent("drop", { bubbles: true, dataTransfer: transfer }))
  }, { projectId: alphaId, sessionId: "beta-session" })
  expect(backend.projects).toEqual(beforeCrossProject)
  await expect(row(empty, "beta-session")).toHaveCount(0)
  await page.reload()
  await expect(row(section(project(page, alphaId), alphaEmpty), "alpha-unsectioned")).toBeVisible()
  expect(projectWrites).toHaveLength(1)
  expect(projectWrites[0]).toMatchObject({ projectId: alphaId, revision: '"1"', status: 200 })
  const external = row(section(project(page, alphaId), alphaEmpty), "alpha-unsectioned")
  await external.getByRole("button", { name: "Alpha movable", exact: true }).dragTo(page.locator('[data-chat-body="true"][data-session-drop-target="main"]'))
  await expect(external.getByRole("button", { name: "Alpha movable", exact: true })).toHaveAttribute("aria-current", "page")
  await expect(external).toHaveAttribute("data-session-project", alphaId)
  expect(projectWrites).toHaveLength(1)
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
})

test("loading the project drag chunk exposes readable inert rows before editable ownership is ready", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "delayed desktop code loading")
  const { observation, projectWrites } = await installSectionFixture(page)
  await page.addInitScript(() => localStorage.setItem("lotus.sidebar.grouping-mode.v1", "date"))
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  let requested = false
  await page.route("**/assets/SidebarProjectDrag-*.js", async (route) => {
    requested = true
    await pending
    await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  const switcher = page.getByRole("button", { name: "切换为项目视图", exact: true })
  await switcher.click()
  await expect.poll(() => requested).toBe(true)
  const loading = page.locator('aside [inert][aria-busy="true"]')
  await expect(loading).toContainText("Alpha movable")
  await loading.locator('[data-sidebar-session="alpha-unsectioned"] button').first().click({ force: true })
  await expect(page.locator('[data-sidebar-session="all-surface-session"] [aria-current="page"]')).toBeVisible()
  await loading.locator('[data-sidebar-session="alpha-unsectioned"] button[aria-haspopup="menu"]').click({ force: true })
  await expect(page.getByRole("menu")).toHaveCount(0)
  release()
  await expect(loading).toHaveCount(0)
  const movable = row(project(page, alphaId), "alpha-unsectioned")
  await expect(handle(project(page, alphaId), "session", "alpha-unsectioned")).toBeVisible()
  await movable.getByRole("button", { name: "会话操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click()
  const draft = project(page, alphaId).locator('input:not([placeholder])')
  await draft.fill("Retained rename draft")
  await expect(draft).toHaveValue("Retained rename draft")
  await expect(draft).toBeFocused()
  await draft.press("Escape")
  expect(projectWrites).toHaveLength(0)
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
})

test("keyboard internal moves restore connected focus and section order survives reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop keyboard fixture")
  const { observation, backend, projectWrites } = await installSectionFixture(page)
  await page.goto(standaloneScenario.entryUrl)
  await openSidebar(page, false)
  const alpha = project(page, alphaId)
  await keyboardDrop(page, handle(alpha, "session", "alpha-unsectioned"), targetHeader(section(alpha, alphaEmpty)))
  await expect(row(section(alpha, alphaEmpty), "alpha-unsectioned")).toBeVisible()
  await expect(handle(alpha, "session", "alpha-unsectioned")).toBeFocused()
  await keyboardDrop(page, handle(alpha, "section", alphaInvestigation), targetHeader(section(alpha, alphaEmpty)), true)
  await expect.poll(() => backend.projects[alphaId].sidebar!.sections.map((item) => item.id)).toEqual([alphaInvestigation, alphaEmpty])
  expect(projectWrites).toHaveLength(2)
  await page.reload()
  await expect(project(page, alphaId).locator("[data-section-id]").nth(1)).toHaveAttribute("data-section-id", alphaInvestigation)
  await page.screenshot({ path: testInfo.outputPath("internal-keyboard-order.png"), animations: "disabled" })
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
})

test("internal drag cancels during initialization, navigation, search and global dialogs without stale listeners", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop interruption fixture")
  const { observation, projectWrites } = await installSectionFixture(page)
  await page.goto(standaloneScenario.entryUrl)
  await openSidebar(page, false)
  const alpha = project(page, alphaId)
  const source = handle(alpha, "session", "alpha-unsectioned")
  await source.focus()
  await page.keyboard.press("Space")
  await page.keyboard.press("Escape")
  await expect(source).not.toHaveAttribute("data-sidebar-dragging", "true")
  await keyboardPickup(page, source)
  await page.keyboard.press("Shift+F10")
  await expect(page.getByRole("menu")).toBeVisible()
  await expect(source).not.toHaveAttribute("data-sidebar-dragging", "true")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toHaveCount(0)
  await keyboardPickup(page, source)
  await page.keyboard.press("Meta+k")
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(source).not.toHaveAttribute("data-sidebar-dragging", "true")
  await page.keyboard.press("Escape")
  await keyboardPickup(page, source)
  await row(alpha, "alpha-search").locator("button").first().click()
  await expect(source).not.toHaveAttribute("data-sidebar-dragging", "true")
  await keyboardPickup(page, source)
  await page.getByPlaceholder("搜索会话").fill("Alpha")
  await expect(source).toHaveCount(0)
  await page.getByPlaceholder("搜索会话").fill("")
  await expect(source).toBeVisible()
  expect(projectWrites).toHaveLength(0)
  await keyboardDrop(page, source, targetHeader(section(alpha, alphaEmpty)))
  await expect(projectWrites).toHaveLength(1)
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
})

test("a confirmed internal move does not reclaim focus after the user navigates during its pending save", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "pending-save focus ownership")
  const { observation, projectWrites } = await installSectionFixture(page)
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  let waiting = false
  await page.route(`**/api/v1/projects/${alphaId}`, async (route) => {
    if (route.request().method() === "PATCH") { waiting = true; await pending }
    await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await openSidebar(page, false)
  const alpha = project(page, alphaId)
  await keyboardDrop(page, handle(alpha, "session", "alpha-unsectioned"), targetHeader(section(alpha, alphaEmpty)))
  await expect.poll(() => waiting).toBe(true)
  await row(project(page, betaId), "beta-session").getByRole("button", { name: "Beta independent", exact: true }).click()
  const composer = page.getByRole("textbox", { name: "消息", exact: true })
  await composer.fill("New session draft")
  release()
  await expect(row(section(alpha, alphaEmpty), "alpha-unsectioned")).toBeVisible()
  await expect(composer).toBeFocused()
  await expect(composer).toHaveText("New session draft")
  await expect(row(project(page, betaId), "beta-session").locator('[aria-current="page"]')).toBeVisible()
  expect(projectWrites).toHaveLength(1)
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
})

test("viewport resize and Settings page opening cancel held internal moves without committing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop resize and hidden-chat-shell fixture")
  const { observation, projectWrites } = await installSectionFixture(page)
  await page.route("**/api/v1/mcp/servers", (route) => route.fulfill({ json: { servers: [] } }))
  await page.goto(standaloneScenario.entryUrl)
  await openSidebar(page, false)
  const alpha = project(page, alphaId)
  const source = handle(alpha, "session", "alpha-unsectioned")
  const destination = targetHeader(section(alpha, alphaEmpty))
  const position = async () => {
    const start = (await source.boundingBox())!
    const end = (await destination.boundingBox())!
    await keyboardPickup(page, source)
    const steps = Math.round((end.y + end.height / 2 - start.y - start.height / 2) / 10)
    for (let index = 0; index < Math.abs(steps); index += 1) await page.keyboard.press(steps < 0 ? "ArrowUp" : "ArrowDown")
    await expect(section(alpha, alphaEmpty)).toHaveAttribute("data-drop-active", "true")
  }
  await position()
  await page.setViewportSize({ width: 1360, height: 900 })
  await expect(source).not.toHaveAttribute("data-sidebar-dragging", "true")
  expect(projectWrites).toHaveLength(0)
  await position()
  await page.getByRole("button", { name: "系统设置", exact: true }).click()
  const settings = settingsSurface(page)
  await expect(settings).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.locator('[data-slot="chat-shell"]')).toHaveAttribute("inert", "")
  await selectSettingsCategory(settings, "providers", "提供方")
  await settings.getByRole("button", { name: "新增", exact: true }).click()
  const input = settings.getByRole("textbox").first()
  await input.fill("Settings draft")
  await input.press("Space")
  await input.press("x")
  await expect(input).toHaveValue("Settings draft x")
  expect(projectWrites).toHaveLength(0)
  await settings.getByRole("button", { name: "取消", exact: true }).click()
  await closeSettings(settings)
  await expect(source).toBeVisible()
  await keyboardDrop(page, source, destination)
  await expect(row(section(alpha, alphaEmpty), "alpha-unsectioned")).toBeVisible()
  expect(projectWrites).toHaveLength(1)
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
})

test("internal moves keep failures and revision conflicts uncommitted until explicit retry", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop persistence fixture")
  const { observation, backend, projectWrites } = await installSectionFixture(page)
  await page.goto(standaloneScenario.entryUrl)
  await openSidebar(page, false)
  const alpha = project(page, alphaId)
  const source = handle(alpha, "session", "alpha-unsectioned")
  const destination = targetHeader(section(alpha, alphaEmpty))
  backend.failNextPatch = 503
  await keyboardDrop(page, source, destination)
  await expect(alpha.getByRole("alert")).toHaveCount(0)
  await expect(page.getByRole("alert")).toContainText("分区未保存")
  expect(assignment(backend, alphaId, "alpha-unsectioned")).toBe(null)
  await keyboardDrop(page, source, destination)
  await expect.poll(() => assignment(backend, alphaId, "alpha-unsectioned")).toBe(alphaEmpty)
  backend.projects[alphaId].revision += 1
  const otherSource = handle(alpha, "session", "alpha-search")
  await keyboardDrop(page, otherSource, destination)
  await expect(page.getByRole("alert")).toContainText("已在其他客户端更新")
  expect(assignment(backend, alphaId, "alpha-search")).toBe(alphaInvestigation)
  await keyboardDrop(page, otherSource, destination)
  await expect.poll(() => assignment(backend, alphaId, "alpha-search")).toBe(alphaEmpty)
  expect(projectWrites.map((write) => write.status)).toEqual([503, 200, 412, 200])
  expect(observation.pageErrors).toEqual([])
})

test("touch internal handles move a session without selecting it or changing its Project", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop-chromium", "touch-enabled tablet and phone fixture")
  const { observation, backend, projectWrites } = await installSectionFixture(page)
  await page.goto(standaloneScenario.entryUrl)
  await openSidebar(page, testInfo.project.name === "phone-chromium")
  const alpha = project(page, alphaId)
  const source = handle(alpha, "session", "alpha-unsectioned")
  await source.scrollIntoViewIfNeeded()
  const start = (await source.boundingBox())!
  const end = (await targetHeader(section(alpha, alphaEmpty)).boundingBox())!
  const session = await page.context().newCDPSession(page)
  const point = (x: number, y: number) => [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }]
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(start.x + start.width / 2, start.y + start.height / 2) })
  // dnd-kit 0.5 uses a 250ms stationary hold before activating touch drags.
  await expect(source).toHaveAttribute("data-sidebar-dragging", "true")
  for (let step = 1; step <= 10; step += 1) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(start.x + start.width / 2 + (end.x + end.width / 2 - start.x - start.width / 2) * step / 10, start.y + start.height / 2 + (end.y + end.height / 2 - start.y - start.height / 2) * step / 10) })
  await expect(section(alpha, alphaEmpty)).toHaveAttribute("data-drop-active", "true")
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await expect(row(section(alpha, alphaEmpty), "alpha-unsectioned")).toBeVisible()
  expect(assignment(backend, alphaId, "alpha-unsectioned")).toBe(alphaEmpty)
  expect(projectWrites).toHaveLength(1)
  await expect(row(alpha, "all-surface-session").locator('[aria-current="page"]')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("internal-touch-move.png"), animations: "disabled" })
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
  const search = page.locator("aside").filter({ has: page.getByPlaceholder("搜索会话", { exact: true }) }).getByPlaceholder("搜索会话")
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
