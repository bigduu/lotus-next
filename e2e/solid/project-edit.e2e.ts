import { expect, test, type Page } from "@playwright/test"
import type { ProjectManifest } from "../../src/services/project"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

const fixture: ProjectManifest = {
  id: "fixture-project-edit", name: "Fixture project", status: "active", revision: 3, resource_revision: 5,
  schema_version: 3, project_path: "/fixture/project", project_path_status: "configured", workspace_count: 2, description: null,
  created_at: "2026-11-07T00:00:00Z", updated_at: "2026-11-07T00:00:00Z",
  workspace_bindings: [{ path: "/fixture/old" }], sidebar: { sections: [], session_sections: {}, hidden_legacy: false },
}
const preferenceKey = "lotus_active_project_v1"

type Mutation = { method: string; path: string; revision: string | undefined; body: unknown }
async function projectFixture(page: Page, baseURL: string | undefined) {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript(({ key, id }) => {
    localStorage.setItem("lotus.sidebar.grouping-mode.v1", "project")
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem(key, JSON.stringify({ projectId: id }))
  }, { key: preferenceKey, id: fixture.id })
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  let current = structuredClone(fixture)
  let invalidPath: string | null = null
  let conflict = false
  const validation: string[] = [], mutations: Mutation[] = []
  await page.route("**/api/v1/projects", (route) => route.fulfill({ json: { projects: [current] } }))
  await page.route("**/api/v1/workspace/validate", (route) => {
    const { path } = route.request().postDataJSON()
    validation.push(path)
    return route.fulfill({ json: { path, is_valid: path !== invalidPath, error_message: path === invalidPath ? "Fixture directory is invalid" : null } })
  })
  await page.route(`**/api/v1/projects/${fixture.id}**`, (route) => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    if (method === "GET") return route.fulfill({ json: current })
    const body = request.postDataJSON()
    const revision = request.headers()["if-match"]
    mutations.push({ method, path, revision, body })
    if (conflict && path.endsWith("/workspaces")) {
      conflict = false
      current = { ...current, workspace_bindings: [...current.workspace_bindings, { path: "/fixture/external" }],
        workspace_count: current.workspace_count + 1, revision: current.revision + 1, resource_revision: current.resource_revision + 1 }
      return route.fulfill({ status: 412, json: { message: "Fixture external update" } })
    }
    expect(revision).toBe(`"${current.revision}"`)
    if (method === "PATCH") current = { ...current, ...body, revision: current.revision + 1 }
    else if (path.endsWith("/workspaces")) {
      const workspace_bindings = method === "DELETE" ? current.workspace_bindings.filter((entry) => entry.path !== body.path)
        : [...current.workspace_bindings, body]
      current = { ...current, workspace_bindings, workspace_count: workspace_bindings.length + 1, revision: current.revision + 1,
        resource_revision: current.resource_revision + 1 }
    } else if (path.endsWith("/archive")) current = { ...current, status: "archived", revision: current.revision + 1 }
    return route.fulfill({ json: current })
  })
  return { entryUrl, observation, validation, mutations, invalidate: (path: string | null) => { invalidPath = path }, conflict: () => { conflict = true } }
}

async function openProjectEditor(page: Page, name: string) {
  await page.getByRole("button", { name: `${name} 项目操作`, exact: true }).click()
  await page.getByRole("menuitem", { name: "编辑项目", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "编辑项目", exact: true })
  await expect(editor.getByRole("textbox", { name: "项目名称", exact: true })).toHaveValue(name)
  return editor
}

test("Solid project editing validates all directories, saves by revision, and archives with confirmation", async ({ page, baseURL, isMobile }) => {
  const host = await projectFixture(page, baseURL)
  await page.goto(host.entryUrl)
  if (isMobile) await page.getByRole("button", { name: "菜单", exact: true }).click()
  const editor = await openProjectEditor(page, fixture.name)
  await expect(editor.getByRole("button", { name: "选择项目主目录", exact: true })).toHaveCount(0)
  const name = editor.getByRole("textbox", { name: "项目名称", exact: true })
  await name.fill("Fixture revised")
  await editor.getByRole("textbox", { name: "项目主目录", exact: true }).fill("/fixture/new-root/")
  await editor.getByRole("button", { name: "移除源目录 /fixture/old", exact: true }).click()
  const additional = editor.getByRole("textbox", { name: "新增源目录", exact: true })
  await additional.fill("/fixture/new-binding/")
  await additional.press("Enter")
  await expect(editor.getByText("/fixture/new-binding", { exact: true })).toBeVisible()
  const save = editor.getByRole("button", { name: "保存", exact: true })
  host.invalidate("/fixture/new-binding")
  await save.click()
  await expect(editor.getByRole("alert")).toHaveText("Fixture directory is invalid")
  expect(host.validation.sort()).toEqual(["/fixture/new-binding", "/fixture/new-root"])
  expect(host.mutations).toEqual([])
  host.invalidate(null)
  await save.click()
  await expect(editor).toBeHidden()
  const prefix = `/api/v1/projects/${fixture.id}`
  expect(host.mutations).toEqual([
    { method: "PATCH", path: prefix, revision: '"3"', body: { name: "Fixture revised", project_path: "/fixture/new-root" } },
    { method: "DELETE", path: `${prefix}/workspaces`, revision: '"4"', body: { path: "/fixture/old" } },
    { method: "POST", path: `${prefix}/workspaces`, revision: '"5"', body: { path: "/fixture/new-binding" } },
  ])
  await openProjectEditor(page, "Fixture revised")
  await editor.getByRole("textbox", { name: "项目名称", exact: true }).fill("Unsaved edit")
  await editor.getByRole("button", { name: "移除本地项目", exact: true }).click()
  const confirmation = page.getByRole("dialog", { name: "移除“Fixture revised”？", exact: true })
  await expect(confirmation.getByText("现有会话和项目数据不会删除", { exact: false })).toBeVisible()
  await confirmation.getByRole("button", { name: "取消", exact: true }).click()
  await expect(editor.getByRole("textbox", { name: "项目名称", exact: true })).toHaveValue("Unsaved edit")
  expect(host.mutations).toHaveLength(3)
  await editor.getByRole("button", { name: "移除本地项目", exact: true }).click()
  await confirmation.getByRole("button", { name: "移除项目", exact: true }).click()
  await expect(confirmation).toBeHidden()
  expect(host.mutations.at(-1)).toEqual({ method: "POST", path: `${prefix}/archive`, revision: '"6"', body: {} })
  expect(await page.evaluate((key) => localStorage.getItem(key), preferenceKey)).toBeNull()
  expect(host.observation.pageErrors).toEqual([])
})

test("Solid project editing stops a partially applied save on a binding conflict", async ({ page, baseURL, isMobile }) => {
  const host = await projectFixture(page, baseURL)
  await page.goto(host.entryUrl)
  if (isMobile) await page.getByRole("button", { name: "菜单", exact: true }).click()
  const editor = await openProjectEditor(page, fixture.name)
  const name = editor.getByRole("textbox", { name: "项目名称", exact: true })
  await name.fill("Committed rename")
  await editor.getByRole("button", { name: "移除源目录 /fixture/old", exact: true }).click()
  const additional = editor.getByRole("textbox", { name: "新增源目录", exact: true })
  await additional.fill("/fixture/pending")
  await additional.press("Enter")
  host.conflict()
  await editor.getByRole("button", { name: "保存", exact: true }).click()
  await expect(editor.getByRole("alert")).toHaveText("项目刚被其他操作修改，请关闭后重试")
  await expect(name).toHaveValue("Committed rename")
  await expect(editor.getByText("/fixture/pending", { exact: true })).toBeVisible()
  expect(host.mutations.map(({ method, revision }) => [method, revision])).toEqual([["PATCH", '"3"'], ["DELETE", '"4"']])
  await editor.getByRole("button", { name: "取消", exact: true }).click()
  await openProjectEditor(page, "Committed rename")
  await expect(editor.getByText("/fixture/external", { exact: true })).toBeVisible()
  await expect(editor.getByText("/fixture/old", { exact: true })).toBeVisible()
  await expect(editor.getByText("/fixture/pending", { exact: true })).toHaveCount(0)
  expect(host.observation.pageErrors).toEqual([])
})
