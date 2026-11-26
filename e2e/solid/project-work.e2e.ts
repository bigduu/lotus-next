import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

test("Solid Project Work has visible sidebar entries in both groupings and reads the scoped board on demand", async ({ page, baseURL, isMobile }, info) => {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript(() => {
    localStorage.setItem("lotus.sidebar.grouping-mode.v1", "project")
    localStorage.setItem("bodhi_onboarded_v1", "1")
  })
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  const project = {
    id: "solid-board", name: "Fixture project", status: "active", revision: 3, resource_revision: 1,
    schema_version: 3, project_path: "/fixture/project", project_path_status: "configured", workspace_count: 1,
    created_at: "2026-11-07T00:00:00Z", updated_at: "2026-11-07T00:00:00Z", workspace_bindings: [],
    sidebar: { sections: [], session_sections: {}, hidden_legacy: false },
  }
  const snapshot = { commit: "fixture-board-cursor", seq: 10, authority_epoch: 1 }
  const envelope = { snapshot, index_seq: 10, coverage: "authoritative_scope", truncated: false, omitted_count: 0, next_cursor: null }
  const rows = [
    { id: "fixture-testing", state: "submitted", title: "Verify this work", stage: "testing" },
    { id: "fixture-cancelled", state: "cancelled", title: "Stopped experiment", stage: null },
  ].map(({ id, state, title, stage }) => ({
    ticket: {
      id, scope_id: "fixture-work-scope", kind: "work", state, generation: 1, record_revision: 1, contract_revision: 1,
      updated_seq: 9, archived: false, contract: { title, objective: "Board scope fixture", constraints: [], acceptance: [] },
      active_assignment: null, current_submission: null, accepted_submission: null, depends_on: [],
    },
    stage, context: null, adopted_context: null,
  }))
  const boardQueries: unknown[] = []
  await page.route("**/api/v1/projects", (route) => route.fulfill({ json: { projects: [project] } }))
  await page.route(`**/api/v1/projects/${project.id}`, (route) => route.fulfill({ json: project }))
  await page.route("**/api/v1/tickets/sprints/list", (route) => route.fulfill({ status: 404, json: { error: "Legacy fixture" } }))
  await page.route("**/api/v1/tickets/project-board", (route) => {
    const body = route.request().postDataJSON()
    boardQueries.push(body)
    return route.fulfill({ json: { ...envelope, data: {
      project_id: project.id, counts: { todo: 0, doing: 0, testing: 1, done: 0, blocked: 0, cancelled: 1, total: 2 },
      rows: body.include_cancelled ? rows : rows.slice(0, 1),
    } } })
  })
  await page.route("**/api/v1/tickets/inspect", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ ids: ["fixture-testing"], fixed_commit: snapshot.commit })
    return route.fulfill({ json: { ...envelope, data: [{ ticket: rows[0].ticket, requests: [], submissions: [], assignments: [] }] } })
  })

  await page.goto(entryUrl)
  if (isMobile) await page.getByRole("button", { name: "菜单", exact: true }).click()
  const projectRow = page.locator(`[data-sidebar-project="${project.id}"]`)
  const disclosure = projectRow.locator("button[aria-controls]").first()
  const shortcut = projectRow.getByRole("button", { name: "Fixture project 看板", exact: true })
  await expect(shortcut).toBeVisible()
  await disclosure.click()
  await expect(disclosure).toHaveAttribute("aria-expanded", "false")
  await expect(shortcut).toHaveText("看板")
  await expect(shortcut).toBeVisible()
  await info.attach("project-board-sidebar-entry", { body: await page.screenshot(), contentType: "image/png" })
  expect(boardQueries).toEqual([])
  await shortcut.click()
  const board = page.getByRole("dialog", { name: "项目工作 · Fixture project" })
  await expect(board.getByRole("button", { name: "看板", exact: true })).toHaveAttribute("aria-pressed", "true")
  const card = board.getByRole("region", { name: "待验收", exact: true }).getByRole("button", { name: /Verify this work/ })
  await expect(card).toBeVisible()
  await card.click()
  await expect(board.getByText("Board scope fixture", { exact: true }).first()).toBeVisible()
  await board.getByRole("checkbox", { name: "显示已取消" }).check()
  await expect(board.getByText("Stopped experiment", { exact: true })).toBeVisible()
  expect(boardQueries).toEqual([false, true].map((include_cancelled) => expect.objectContaining({
    project_id: project.id, include_cancelled, include_archived: false,
  })))
  await page.keyboard.press("Escape")
  await expect(board).toBeHidden()
  await expect(shortcut).toBeFocused()
  await page.getByRole("button", { name: "切换为最近视图" }).click()
  const chooser = page.getByRole("button", { name: "项目看板", exact: true })
  await expect(chooser).toBeVisible()
  expect(boardQueries).toHaveLength(2)
  await chooser.click()
  await page.getByRole("menuitem", { name: project.name, exact: true }).click()
  await expect(card).toBeVisible()
  expect(boardQueries.at(-1)).toMatchObject({ project_id: project.id, include_cancelled: false })
  await page.keyboard.press("Escape")
  await expect(board).toBeHidden()
  await expect(chooser).toBeFocused()
  expect(observation.pageErrors).toEqual([])
})
