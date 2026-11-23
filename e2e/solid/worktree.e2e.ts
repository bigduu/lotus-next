import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

test("Solid Lotus prepares a project worktree before sending the first message", async ({ page, baseURL, isMobile }) => {
  const entryUrl = new URL("/", baseURL).href
  const project = {
    id: "project-solid",
    name: "Solid worktree acceptance",
    status: "active",
    revision: 3,
    resource_revision: 1,
    project_path: "/fixture/repo",
    project_path_status: "configured",
    workspace_count: 1,
    created_at: "2026-09-07T00:00:00Z",
    updated_at: "2026-09-07T00:00:00Z",
    schema_version: 3,
    new_chat_worktree: true,
    workspace_bindings: [],
    sidebar: { sections: [], session_sections: {}, hidden_legacy: false },
  }
  const path = "/fixture/trees/first-chat"
  const events: Array<{ operation: string; body: unknown }> = []
  await page.addInitScript(() => {
    localStorage.setItem("lotus.sidebar.grouping-mode.v1", "project")
    localStorage.setItem("bodhi_onboarded_v1", "1")
  })
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  await page.route("**/api/v1/projects", (route) => route.fulfill({ json: { projects: [project] } }))
  await page.route(`**/api/v1/projects/${project.id}`, (route) => route.fulfill({ json: project }))
  await page.route(`**/api/v1/projects/${project.id}/worktrees**`, async (route) => {
    const request = route.request()
    if (request.method() === "GET") {
      return route.fulfill({ json: {
        project_id: project.id, default_root: "/fixture/trees",
        repositories: [{ path: project.project_path, worktrees: [] }],
      } })
    }
    events.push({ operation: "prepare", body: request.postDataJSON() })
    await route.fulfill({ json: { path } })
  })
  await page.route(`**/api/v1/projects/${project.id}/workspaces`, (route) => {
    expect(route.request().headers()["if-match"]).toBe('"3"')
    events.push({ operation: "bind", body: route.request().postDataJSON() })
    return route.fulfill({ json: { ...project, revision: 4, workspace_count: 2, workspace_bindings: [{ path }] } })
  })
  await page.route("**/api/v1/chat", (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    events.push({ operation: "send", body: route.request().postDataJSON() })
    return route.fulfill({ json: { session_id: "solid-worktree-session", status: "success" } })
  })
  await page.route("**/api/v1/execute/solid-worktree-session", (route) => route.fulfill({
    json: { session_id: "solid-worktree-session", status: "started", run_id: "solid-worktree-run" },
  }))

  await page.goto(entryUrl)
  if (isMobile) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await page.getByRole("button", { name: `在 ${project.name} 中新建会话`, exact: true }).click()
  const workspace = page.getByRole("button", { name: "会话工作区", exact: true })
  const more = page.locator("[data-composer-surface]").getByRole("button", { name: "更多", exact: true })
  const openedMore = !await workspace.isVisible()
  if (openedMore) await more.click()
  await expect(workspace).toHaveText(/新建 worktree/)
  await workspace.click()
  await expect(page.getByText(/此项目默认使用新建 worktree/)).toBeVisible()
  await page.keyboard.press("Escape")
  if (openedMore && await more.getAttribute("aria-expanded") === "true") await page.keyboard.press("Escape")
  expect(events).toEqual([])

  const composer = page.getByRole("textbox", { name: "消息", exact: true })
  await composer.fill("Create a worktree first")
  await expect(page.getByRole("button", { name: "发送消息" })).toBeEnabled()
  await composer.press("Enter")
  await expect.poll(() => events).toEqual([
    { operation: "prepare", body: expect.objectContaining({ repository: project.project_path, root: "/fixture/trees" }) },
    { operation: "bind", body: { path } },
    { operation: "send", body: expect.objectContaining({
      message: "Create a worktree first", project_id: project.id, workspace_path: path,
    }) },
  ])
  expect(observation.pageErrors).toEqual([])
  expect(observation.protocolErrors).toEqual([])
})
