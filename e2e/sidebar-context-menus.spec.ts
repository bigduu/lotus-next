import { expect, test, type Locator, type Page } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const mainId = "all-surface-session"
const sessionId = "context-menu-session"
const supervisorId = "bamboo-default-supervisor"
const projectId = "context-menu-project"
const sectionId = "section:00000000-0000-4000-8000-000000000001"
const at = "2026-10-11T00:00:00.000Z"
const projectName = "Context project"
const sectionName = "Research"
const titles = ["Current session", "Context session", "Supervisor"]
const sessions = [mainId, sessionId, supervisorId].map((id, index) => ({
  id, kind: "root", title: titles[index], title_version: 1, pinned: false,
  root_session_id: id, parent_session_id: null, spawn_depth: 0,
  project_id: id === supervisorId ? null : projectId,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: at, updated_at: at, last_activity_at: at, message_count: 0, has_attachments: false,
  is_running: false, has_pending_question: false, last_run_status: "completed",
  permission_mode: "default", bypass_permissions: false, root_orchestration_only: false,
  thinking_mode: "standard", root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
}))
const project = {
  id: projectId, name: projectName, status: "active", revision: 1, resource_revision: 1, schema_version: 3,
  created_at: at, updated_at: at, project_path: "/workspace/context-menus", project_path_status: "configured",
  workspace_count: 1, workspace_bindings: [],
  sidebar: { sections: [{ id: sectionId, name: sectionName }], session_sections: { [sessionId]: sectionId }, hidden_legacy: false },
}

const labels = {
  newSectionSession: `在 ${sectionName} 中新建会话`,
  manageSections: "管理分区",
  renameSession: "重命名",
  renameSupervisor: "重命名统筹助手",
}

function sidebarItems(page: Page) {
  const sidebar = page.locator("aside")
  const projectGroup = sidebar.locator(`[data-sidebar-project="${projectId}"]`)
  const section = projectGroup.locator(`[data-section-id="${sectionId}"]`)
  const row = section.locator(`[data-sidebar-session="${sessionId}"]`)
  const supervisor = sidebar.getByRole("button", { name: "Supervisor", exact: true })
  return {
    session: {
      origin: row.getByRole("button", { name: titles[1], exact: true }),
      trigger: row.locator('button[aria-haspopup="menu"]'),
    },
    project: {
      origin: projectGroup.locator("button[aria-controls]:not([aria-haspopup])").first(),
      trigger: projectGroup.getByRole("button", { name: `${projectName} 项目操作`, exact: true }),
    },
    section: {
      origin: section.locator("[data-sidebar-section-header]"),
      trigger: section.getByRole("button", { name: labels.manageSections, exact: true }),
    },
    supervisor: {
      origin: supervisor,
      trigger: supervisor.locator("xpath=..").locator('button[aria-haspopup="menu"]'),
    },
  }
}

const noActivation = async (page: Page) => {
  const items = sidebarItems(page)
  await expect(page.locator(`[data-sidebar-session="${mainId}"] [aria-current="page"]`)).toBeVisible()
  await expect(items.project.origin).toHaveAttribute("aria-expanded", "true")
  await expect(items.section.origin).toHaveAttribute("aria-expanded", "true")
  await expect(page.getByRole("dialog")).toHaveCount(0)
}

async function openContext(origin: Locator, gesture: "right click" | "ContextMenu" | "Shift+F10" = "right click") {
  await origin.focus()
  if (gesture === "right click") await origin.click({ button: "right" })
  else await origin.press(gesture)
}

async function dismiss(page: Page, menu: Locator) {
  await page.keyboard.press("Escape")
  await expect(menu).toHaveCount(0)
}

const menuActions = async (menu: Locator) => (await menu.getByRole("menuitem").allTextContents())
  .map((label) => label.trim())

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Desktop sidebar context gestures and focus")
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus.sidebar.grouping-mode.v1", "project")
    localStorage.setItem("lotus_next_last_session", id)
  }, mainId)
  await installArtifactRuntime(page, standaloneScenario)
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (path === "/api/v1/projects") return route.fulfill({ json: { projects: [project] } })
    if (path === `/api/v1/projects/${projectId}`) {
      return route.fulfill({ json: project, headers: { ETag: '"1"' } })
    }
    if (path === "/api/v1/sessions") {
      const listed = url.searchParams.get("kind") === "child" ? [] : sessions
      return route.fulfill({ json: { sessions: listed, total: listed.length, limit: 200, offset: 0 } })
    }
    const session = sessions.find(({ id }) => path === `/api/v1/sessions/${id}`)
    if (session) return route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
    const actor = sessions.find(({ id }) => path === `/api/v1/actors/${id}/snapshot`)
    if (actor) return route.fulfill({ json: actorSnapshotFixture(actor.id, 0) })
    if (sessions.some(({ id }) => path === `/api/v1/respond/${id}/pending`)) {
      return route.fulfill({ json: { has_pending_question: false } })
    }
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await noActivation(page)
})

for (const name of ["session", "project", "section", "supervisor"] as const) {
  for (const gesture of ["right click", "ContextMenu", "Shift+F10"] as const) {
    test(`${name} opens from ${gesture} without activating the row and restores focus`, async ({ page }) => {
      const { origin } = sidebarItems(page)[name]
      const menu = page.getByRole("menu")
      await openContext(origin, gesture)
      await expect(menu).toBeVisible()
      await expect(menu.getByRole("menuitem").first()).toBeVisible()
      await noActivation(page)
      await dismiss(page, menu)
      await expect(origin).toBeFocused()
    })
  }
  test(`${name} offers identical context and explicit action menus`, async ({ page }) => {
    const { origin, trigger } = sidebarItems(page)[name]
    const menu = page.getByRole("menu")
    await openContext(origin)
    await expect(menu).toBeVisible()
    const contextual = await menuActions(menu)
    expect(contextual.length).toBeGreaterThan(0)
    await dismiss(page, menu)
    await trigger.press("ArrowDown")
    await expect(menu).toBeVisible()
    expect(await menuActions(menu)).toEqual(contextual)
  })
}

test("session rename keeps the inline input selectable and its native context menu", async ({ page }) => {
  const { session } = sidebarItems(page)
  await expect(session.origin.locator("xpath=..")).toHaveClass(/select-none/)
  await openContext(session.origin)
  await page.getByRole("menuitem", { name: labels.renameSession, exact: true }).click()
  const input = page.locator("aside").getByRole("textbox", { name: labels.renameSession, exact: true })
  await expect(input).toBeVisible()
  expect(await input.evaluate((element) => element.closest(".select-none"))).toBeNull()
  await input.click({ button: "right" })
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(page.locator(`[data-sidebar-session="${mainId}"] [aria-current="page"]`)).toBeVisible()
})

test("section management opens the existing project section dialog", async ({ page }) => {
  await openContext(sidebarItems(page).section.origin)
  await page.getByRole("menuitem", { name: labels.manageSections, exact: true }).click()
  await expect(page.getByRole("dialog", { name: `${labels.manageSections} · ${projectName}`, exact: true })).toBeVisible()
})

test("section header starts a new session directly and its menu offers the same action", async ({ page }) => {
  const add = page.locator("aside").getByRole("button", { name: labels.newSectionSession, exact: true })
  const menu = page.getByRole("menu")
  await add.click()
  await expect(page.locator(`[data-sidebar-session="${mainId}"] [aria-current="page"]`)).toHaveCount(0)
  await expect(menu).toHaveCount(0)
  await openContext(add)
  await expect(menu.getByRole("menuitem", { name: labels.newSectionSession, exact: true })).toBeVisible()
  await expect(menu.getByRole("menuitem", { name: labels.manageSections, exact: true })).toBeVisible()
})

test("Supervisor dropdown focuses and activates its first action from the keyboard", async ({ page }) => {
  const { supervisor } = sidebarItems(page)
  const menu = page.getByRole("menu")
  await supervisor.trigger.press("ArrowDown")
  const first = menu.getByRole("menuitem", { name: labels.renameSupervisor, exact: true })
  await expect(first).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(menu).toHaveCount(0)
  await expect(page.getByRole("dialog", { name: labels.renameSupervisor, exact: true })).toBeVisible()
})

test("Supervisor keeps rename, managed sessions, Project scope and clear actions", async ({ page }) => {
  await openContext(sidebarItems(page).supervisor.origin)
  const menu = page.getByRole("menu")
  await expect(menu.getByRole("menuitem")).toHaveText([
    labels.renameSupervisor, "管理会话", "Supervisor Project 范围", "清除会话消息",
  ])
  await menu.getByRole("menuitem", { name: labels.renameSupervisor, exact: true }).click()
  const dialog = page.getByRole("dialog", { name: labels.renameSupervisor, exact: true })
  await expect(dialog).toBeVisible()
  expect(await dialog.getByRole("textbox").evaluate((element) => element.closest(".select-none"))).toBeNull()
  await expect(page.locator(`[data-sidebar-session="${mainId}"] [aria-current="page"]`)).toBeVisible()
})
