import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

test("Solid project section edits retain the draft across a canonical revision conflict", async ({ page, baseURL, isMobile }) => {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript(() => {
    localStorage.setItem("lotus.sidebar.grouping-mode.v1", "project")
    localStorage.setItem("bodhi_onboarded_v1", "1")
  })
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  const project = {
    id: "solid-sections", name: "Fixture sections", status: "active", revision: 3, resource_revision: 1,
    schema_version: 3, project_path: "/fixture/project", project_path_status: "configured", workspace_count: 1,
    created_at: "2026-11-07T00:00:00Z", updated_at: "2026-11-07T00:00:00Z", workspace_bindings: [],
    sidebar: { sections: [{ id: "section-existing", name: "Existing section" }], session_sections: {}, hidden_legacy: false },
  }
  const writerRevisions: string[] = []
  await page.route("**/api/v1/projects", (route) => route.fulfill({ json: { projects: [project] } }))
  await page.route(`**/api/v1/projects/${project.id}`, async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: project })
    expect(route.request().method()).toBe("PATCH")
    writerRevisions.push(route.request().headers()["if-match"])
    if (project.revision === 3) {
      project.revision = 4
      project.sidebar.sections.push({ id: "section-external", name: "Other window section" })
      return route.fulfill({ status: 412, json: { error: "Fixture revision conflict" } })
    }
    project.revision += 1
    project.sidebar = route.request().postDataJSON().sidebar
    return route.fulfill({ json: project })
  })

  await page.goto(entryUrl)
  if (isMobile) await page.getByRole("button", { name: "菜单", exact: true }).click()
  const projectMenu = page.getByRole("button", { name: "Fixture sections 项目操作", exact: true })
  await projectMenu.click()
  await page.getByRole("menuitem", { name: "创建分区", exact: true }).click()
  const creator = page.getByRole("dialog", { name: "创建分区 · Fixture sections", exact: true })
  const name = creator.getByRole("textbox", { name: "分区名称", exact: true })
  await name.fill("My new section")
  await creator.getByRole("button", { name: "创建", exact: true }).click()
  await expect(creator.getByRole("alert")).toBeVisible()
  await expect(name).toHaveValue("My new section")
  await creator.getByRole("button", { name: "创建", exact: true }).click()
  await expect(creator).toBeHidden()
  await expect(page.locator('[data-section-project="solid-sections"]')
    .getByRole("button", { name: /^My new section(?:\s|$)/ })).toBeVisible()
  expect(project.sidebar.sections.map((section) => section.name)).toEqual(["Existing section", "Other window section", "My new section"])
  expect(writerRevisions).toEqual(['"3"', '"4"'])
  expect(observation.pageErrors).toEqual([])
})

test("Solid main chat accepts the dragged sidebar root from its canonical project", async ({ page, baseURL, isMobile }) => {
  test.skip(isMobile, "HTML drag and drop uses a mouse. The sidebar also has touch and keyboard navigation.")
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  const primary = { id: "all-surface-session", title: "Initial chat", kind: "root", created_at: "2026-11-08T00:00:00Z", message_count: 0, is_running: false }
  const secondary = { ...primary, id: "drop-target-session", title: "Dragged chat", project_id: "fixture-project", created_at: "2026-11-07T00:00:00Z" }
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({ json: { sessions: [primary, secondary], total: 2, limit: 200, offset: 0 } }))
  await page.route(`**/api/v1/sessions/${primary.id}`, (route) => route.fulfill({ json: { session: primary } }))
  await page.route(`**/api/v1/sessions/${secondary.id}`, (route) => route.fulfill({ json: { session: secondary } }))
  await page.route(`**/api/v1/history/${secondary.id}**`, (route) => route.fulfill({ json: { session_id: secondary.id, messages: [] } }))
  await page.goto(entryUrl)
  const banner = page.getByRole("banner")
  await expect(banner).toContainText(primary.title)
  const target = page.locator('[data-session-drop-target="main"]')
  const payload = await page.evaluateHandle((id) => {
    const transfer = new DataTransfer()
    transfer.setData("application/x-lotus-sidebar-session", JSON.stringify({ sessionId: id, projectId: "unrelated" }))
    return transfer
  }, secondary.id)
  await target.dispatchEvent("drop", { dataTransfer: payload })
  await expect(banner).toContainText(primary.title)
  const drag = page.getByRole("button", { name: secondary.title, exact: true })
  await drag.dragTo(target, { targetPosition: { x: 28, y: 96 } })
  await expect(banner).toContainText(secondary.title)
  expect(observation.pageErrors).toEqual([])
})
