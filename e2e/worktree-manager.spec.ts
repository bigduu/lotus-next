import { revealComposerSettings } from "./support/composer.js"
import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import type { ProjectManifest } from "../src/services/project/types.js"

// Built frontend against fixture API responses. Real Git/path safety is covered
// separately in Bamboo's git.rs tests; this test never runs a model or git hook.
test("selects a child repository, creates a checkout, and opens Project-owned and external workspaces", async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let project: ProjectManifest = { id: "project-a", name: "Zenith", status: "active", revision: 1, resource_revision: 1,
    schema_version: 3, project_path: "/repo", project_path_status: "configured", workspace_bindings: [], workspace_count: 1,
    created_at: "2026-10-15T00:00:00Z", updated_at: "2026-10-15T00:00:00Z" }
  const preferences = { default_root: "/Volumes/External/worktrees", project_roots: {} as Record<string, string> }
  const repositories = [
    { path: "/repo/zenith", error: null, warnings: ["Repository discovery reached its depth limit"], worktrees: [{
      path: "/repo/zenith", branch: "main", head: "a".repeat(40), dirty: true,
      error: null, locked: false, prunable: false, occupied: true, project_owned: true,
      sessions: [{ id: "all-surface-session", title: "Existing session", active: true }],
    }] },
    { path: "/repo/tools", error: null, worktrees: [{
      path: "/repo/tools", branch: "main", head: "c".repeat(40), dirty: false,
      error: null, locked: false, prunable: false, occupied: false, project_owned: true, sessions: [],
    }] },
  ]
  const creates: unknown[] = []
  const bindings: unknown[] = []
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === "/api/v1/projects") return route.fulfill({ json: { projects: [project] } })
    if (path === "/api/v1/projects/project-a") {
      // Bamboo omits an empty workspace_bindings array in its real GET JSON.
      return route.fulfill({ json: { ...project, workspace_bindings: project.workspace_bindings.length ? project.workspace_bindings : undefined } })
    }
    if (path === "/api/v1/worktrees/preferences") {
      if (request.method() === "PUT") {
        const body = request.postDataJSON()
        if (body.project_id) {
          if (body.root) preferences.project_roots![body.project_id] = body.root
          else delete preferences.project_roots![body.project_id]
        } else preferences.default_root = body.root
      }
      return route.fulfill({ json: preferences })
    }
    if (path === "/api/v1/projects/project-a/worktrees") {
      if (request.method() === "POST") {
        const body = request.postDataJSON()
        creates.push(body)
        const target = `${body.root}/${body.name}`
        repositories.find((repository) => repository.path === body.repository)!.worktrees.push({
          path: target, branch: body.branch, head: "b".repeat(40), dirty: false,
          error: null, locked: false, prunable: false, occupied: false, project_owned: false, sessions: [],
        })
        return route.fulfill({ status: 201, json: { path: target } })
      }
      return route.fulfill({ json: { project_id: project.id, default_root: preferences.project_roots![project.id] ?? preferences.default_root,
        repositories } })
    }
    if (path === "/api/v1/projects/project-a/workspaces") {
      bindings.push(request.postDataJSON())
      if (request.postDataJSON().path.startsWith("/repo/")) {
        return route.fulfill({ status: 400, json: { error: { message: "Overlapping Project workspace" } } })
      }
      expect(request.headers()["if-match"]).toBe('"1"')
      project = { ...project, revision: 2, workspace_count: 2, workspace_bindings: [request.postDataJSON()] }
      return route.fulfill({ json: project })
    }
    await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  const entry = page.getByRole("button", { name: "Worktree 管理", exact: true })
  const openManager = async () => {
    const bounds = await entry.boundingBox()
    if (!bounds || bounds.x < 0 || bounds.x + bounds.width > (page.viewportSize()?.width ?? Infinity)) {
      await page.getByRole("button", { name: "菜单", exact: true }).click()
    }
    await entry.click()
  }
  await openManager()
  const dialog = page.getByRole("dialog", { name: "Worktree 管理", exact: true })
  await expect(dialog.getByRole("article", { name: "/repo/zenith", exact: true })).toContainText("有未提交修改")
  await expect(dialog.getByText("Repository discovery reached its depth limit", { exact: true })).toBeVisible()
  await dialog.getByRole("article", { name: "/repo/tools", exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath("project-child-repositories.png"), fullPage: true, animations: "disabled" })
  await dialog.getByRole("article", { name: "/repo/zenith", exact: true }).getByRole("button", { name: "打开并新建会话", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(bindings).toEqual([])
  expect(project.project_path).toBe("/repo")
  await openManager()
  await dialog.getByLabel("源仓库", { exact: true }).selectOption("/repo/tools")
  await dialog.getByLabel("项目 worktree 根目录", { exact: true }).fill("/Volumes/Project/worktrees")
  await dialog.getByRole("button", { name: "保存", exact: true }).nth(1).click()
  await expect(dialog.getByLabel("本次创建的根目录", { exact: true })).toHaveValue("/Volumes/Project/worktrees")
  await dialog.getByLabel("本次创建的根目录", { exact: true }).fill("/Volumes/OneOff/worktrees")
  await dialog.getByLabel("目录名", { exact: true }).fill("task")
  await dialog.getByLabel("从当前 HEAD 创建新分支", { exact: true }).fill("feature/task")
  await dialog.getByRole("button", { name: "创建 worktree", exact: true }).click()
  const target = "/Volumes/OneOff/worktrees/task"
  const checkout = dialog.getByRole("article", { name: target, exact: true })
  await expect(checkout).toContainText("干净")
  expect(creates).toEqual([{ repository: "/repo/tools", root: "/Volumes/OneOff/worktrees", name: "task", branch: "feature/task" }])
  await expect(dialog.getByLabel("源仓库", { exact: true })).toHaveValue("/repo/tools")
  expect(preferences.project_roots!["project-a"]).toBe("/Volumes/Project/worktrees")
  expect(project.project_path).toBe("/repo")
  await page.screenshot({ path: info.outputPath("worktree-manager.png"), fullPage: true, animations: "disabled" })
  await checkout.getByRole("button", { name: "打开并新建会话", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(bindings).toEqual([{ path: target }])
  await revealComposerSettings(page)
  await expect(page.getByRole("button", { name: "task", exact: true }).and(page.getByTitle(target, { exact: true }))).toBeVisible()
  await expect(page.getByRole("button", { name: "会话工作区", exact: true })).toContainText("当前工作区")
  expect(observation.pageErrors).toEqual([])
})
