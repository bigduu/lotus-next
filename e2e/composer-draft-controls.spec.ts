import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { expectComposerText, revealComposerSettings } from "./support/composer.js"
import type { ProjectManifest } from "../src/services/project/types.js"

const at = "2026-10-15T00:00:00Z"
const sessionId = "all-surface-session"
const project: ProjectManifest = {
  id: "project-a", name: "Zenith", status: "active", revision: 1, resource_revision: 1,
  schema_version: 3, project_path: "/repo/zenith", project_path_status: "configured",
  workspace_bindings: [], workspace_count: 1, created_at: at, updated_at: at,
}

const messages = (page: Page) => page.getByRole("textbox", { name: "消息", exact: true })

async function enterBlankChat(page: Page) {
  await page.goto(standaloneScenario.entryUrl)
  await expect(messages(page)).toBeVisible()
  const openSidebar = page.getByRole("button", { name: "菜单", exact: true })
  const create = page.getByRole("button", { name: "新建会话", exact: true })
  if (await openSidebar.isVisible()) {
    const bounds = await create.boundingBox()
    if (!bounds || bounds.x < 0) await openSidebar.click()
  }
  await create.click()
  await expect(page.getByRole("heading", { name: "开始新任务", exact: true })).toBeVisible()
  await revealComposerSettings(page)
}

async function fixture(page: Page, projectsAvailable = true) {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
    localStorage.setItem("lotus_next_last_session", id)
  }, sessionId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  await page.route("**/api/v1/projects", (route) => projectsAvailable
    ? route.fulfill({ json: { projects: [project, { ...project, id: "archived", name: "Archived", status: "archived" }] } })
    : route.fulfill({ status: 404, json: { error: "Not found" } }))
  await page.route(`**/api/v1/projects/${project.id}`, (route) => route.fulfill({ json: project }))
  await page.route(`**/api/v1/projects/${project.id}/worktrees**`, (route) => route.fulfill({
    json: { project_id: project.id, default_root: null, repositories: [{ path: project.project_path, error: null, worktrees: [] }] },
  }))
  return observation
}

test("switches the next chat's Project without changing the draft or manually picking its workspace", async ({ page }) => {
  const observed = await fixture(page)
  const chats: Array<Record<string, unknown>> = []
  await page.route("**/api/v1/chat", (route) => {
    chats.push(route.request().postDataJSON())
    return route.fulfill({ json: { session_id: sessionId, status: "success", message_id: "new-project-user" } })
  })
  await page.route(`**/api/v1/execute/${sessionId}`, (route) => route.fulfill({
    json: { session_id: sessionId, status: "started", events_url: "/v2/stream", run_id: "new-project-run" },
  }))
  await enterBlankChat(page)
  const workspaces = page.getByRole("button", { name: "选择工作目录", exact: true })
  const editor = messages(page)
  await expect(workspaces).toBeVisible()
  await editor.fill("Keep this exact draft")
  await revealComposerSettings(page)
  const choose = page.getByRole("button", { name: "选择项目", exact: true })
  await choose.click()
  await expect(page.getByRole("menuitem", { name: "Archived", exact: true })).toHaveCount(0)
  await page.getByRole("menuitem", { name: project.name, exact: true }).click()
  const selected = page.getByRole("button", { name: project.name, exact: true }).and(page.locator('[data-slot="dropdown-menu-trigger"]'))
  await expect(selected).toBeVisible()
  await expect(workspaces).toHaveCount(0)
  const worktree = page.locator("[data-new-chat-worktree-control]")
  await expect(worktree).toBeVisible()
  expect(await worktree.evaluate((node) => node.previousElementSibling?.getAttribute("data-slot"))).toBe("dropdown-menu-trigger")
  await expectComposerText(editor, "Keep this exact draft")
  await selected.click()
  await page.getByRole("menuitem", { name: "不指定项目", exact: true }).click()
  await expect(workspaces).toBeVisible()
  await choose.click()
  await page.getByRole("menuitem", { name: project.name, exact: true }).click()
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chats).toEqual([expect.objectContaining({
    message: "Keep this exact draft", project_id: project.id, workspace_path: project.project_path,
  })])
  await expect(selected).toHaveCount(0)
  await expect(worktree).toHaveCount(0)
  expect(observed.pageErrors).toEqual([])
  expect(observed.errorResponses).toEqual([])
})

test("hides only Project selection when the backend has no Projects API", async ({ page }) => {
  const observed = await fixture(page, false)
  await enterBlankChat(page)
  await expect.poll(() => observed.errorResponses).toContain(`404 ${standaloneScenario.origin}/api/v1/projects`)
  await expect(page.getByRole("button", { name: "选择项目", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "选择工作目录", exact: true })).toBeVisible()
  expect(observed.pageErrors).toEqual([])
})

test("opens the saved default prompt preset once and restores focus after Escape", async ({ page }) => {
  const observed = await fixture(page)
  await page.route("**/api/v1/prompt-presets", (route) => route.fulfill({
    json: { prompts: [{ id: "general_assistant", name: "Bodhi", content: "Default Bodhi prompt", is_default: true }] },
  }))
  await enterBlankChat(page)
  const column = page.locator("[data-composer-column]")
  const compact = await column.getAttribute("data-composer-compact") === "true"
  const trigger = page.getByRole("button", { name: "Bodhi", exact: true })
  await expect(trigger).toBeVisible()
  await trigger.press("Enter")
  await expect(page.getByRole("menuitem")).toHaveText(["Bodhi"])
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menuitem")).toHaveCount(0)
  if (compact) await expect(page.getByRole("dialog", { name: "更多" })).toBeVisible()
  await expect(trigger).toBeFocused()
  await expectComposerText(messages(page), "")
  expect(observed.pageErrors).toEqual([])
  expect(observed.errorResponses).toEqual([])
})

test("keeps compact More when cancelling Worktree and closes it before opening the workspace picker", async ({ page }) => {
  const observed = await fixture(page)
  await page.route("**/api/v1/workspace/suggestions", (route) => route.fulfill({ json: { suggestions: [] } }))
  await page.route("**/api/v1/workspace/recent**", (route) => route.fulfill({ json: [] }))
  await enterBlankChat(page)
  const editor = messages(page)
  await editor.fill("Preserve this draft through both workspace dialogs")
  const column = page.locator("[data-composer-column]")
  await column.evaluate((element) => { element.style.maxWidth = "420px" })
  await expect(column).toHaveAttribute("data-composer-compact", "true")
  await revealComposerSettings(page)

  const more = page.getByRole("dialog", { name: "更多", exact: true })
  await more.getByRole("button", { name: "选择项目", exact: true }).click()
  await page.getByRole("menuitem", { name: project.name, exact: true }).click()
  const worktree = more.getByRole("button", { name: "会话工作区", exact: true })
  await expect(more.locator("[data-composer-secondary-controls]").getByRole("button", { name: "会话工作区" })).toBeVisible()
  await worktree.click()
  const worktreeDialog = page.getByRole("dialog", { name: "会话工作区", exact: true })
  await expect(worktreeDialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(worktreeDialog).toHaveCount(0)
  await expect(more).toBeVisible()
  await expect(worktree).toBeFocused()

  await more.getByRole("button", { name: project.name, exact: true }).click()
  await page.getByRole("menuitem", { name: "不指定项目", exact: true }).click()
  await more.getByRole("button", { name: "选择工作目录", exact: true }).click()
  const workspaceDialog = page.getByRole("dialog", { name: "选择工作目录", exact: true })
  await expect(more).toHaveCount(0)
  await expect(workspaceDialog).toBeVisible()
  await expect(workspaceDialog.getByRole("textbox")).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(workspaceDialog).toHaveCount(0)
  await expectComposerText(editor, "Preserve this draft through both workspace dialogs")
  expect(observed.httpRequests.filter(({ method, url }) => method !== "GET" && ["chat", "execute", "workspace", "projects"].includes(new URL(url).pathname.split("/")[3]))).toEqual([])
  expect(observed.pageErrors).toEqual([])
  expect(observed.errorResponses).toEqual([])
})
