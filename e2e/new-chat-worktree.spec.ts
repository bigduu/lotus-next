import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { expectComposerText, revealComposerSettings } from "./support/composer.js"
import type { ProjectManifest } from "../src/services/project/types.js"

// Built frontend + fixture API only. This verifies request ordering and UI
// lifecycle, not real Git/filesystem behavior or model execution.
const root = "/Volumes/External/worktrees"
const target = `${root}/first-chat`
const selection = { repository: "/repo/zenith", root, name: "first-chat", branch: "chat/first-chat" }

async function install(page: Page, mode: "success" | "bind-conflict" | "uncertain" | "delayed" = "success") {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let project: ProjectManifest = {
    id: "project-a", name: "Zenith", status: "active", revision: 1, resource_revision: 1,
    schema_version: 3, project_path: "/repo/zenith", project_path_status: "configured",
    workspace_bindings: [], workspace_count: 1,
    created_at: "2026-10-15T00:00:00Z", updated_at: "2026-10-15T00:00:00Z",
  }
  const creates: unknown[] = []
  const bindings: Array<{ body: unknown; revision: string | undefined }> = []
  const chats: Array<Record<string, unknown>> = []
  const executes: unknown[] = []
  const order: string[] = []
  let releaseCreate = () => {}
  const createGate = new Promise<void>((resolve) => { releaseCreate = resolve })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === "/api/v1/projects") return route.fulfill({ json: { projects: [project] } })
    if (path === "/api/v1/projects/project-a") {
      // Match the real server's omission of an empty binding list.
      return route.fulfill({ json: { ...project, workspace_bindings: project.workspace_bindings.length ? project.workspace_bindings : undefined } })
    }
    if (path === "/api/v1/projects/project-a/worktrees") {
      if (request.method() === "POST") {
        creates.push(request.postDataJSON())
        order.push("create")
        if (mode === "uncertain") return route.fulfill({ status: 400, json: { error: "checkout failed after branch registration" } })
        if (mode === "delayed") await createGate
        return route.fulfill({ status: 201, json: { path: target } })
      }
      return route.fulfill({ json: { project_id: project.id, default_root: root,
        repositories: [{ path: "/repo/zenith", error: null, worktrees: [] }] } })
    }
    if (path === "/api/v1/projects/project-a/workspaces") {
      bindings.push({ body: request.postDataJSON(), revision: request.headers()["if-match"] })
      order.push("bind")
      if (mode === "bind-conflict" && bindings.length === 1) {
        project = { ...project, revision: 2 }
        return route.fulfill({ status: 412, json: { error: "Project revision changed" } })
      }
      project = { ...project, revision: project.revision + 1, workspace_count: 2, workspace_bindings: [{ path: target }] }
      return route.fulfill({ json: project })
    }
    if (path === "/api/v1/chat") {
      chats.push(request.postDataJSON())
      order.push("chat")
      return route.fulfill({ json: { session_id: "all-surface-session", status: "success" } })
    }
    if (path === "/api/v1/execute/all-surface-session") {
      executes.push(request.postDataJSON())
      order.push("execute")
      return route.fulfill({ json: { session_id: "all-surface-session", status: "started" } })
    }
    await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  return { observation, creates, bindings, chats, executes, order, releaseCreate }
}

async function revealSidebar(page: Page) {
  const entry = page.getByRole("button", { name: "新建会话", exact: true })
  const bounds = await entry.boundingBox()
  if (!bounds || bounds.x < 0 || bounds.x + bounds.width > (page.viewportSize()?.width ?? Infinity)) {
    await page.getByRole("button", { name: "菜单", exact: true }).click()
  }
}

async function newProjectChat(page: Page) {
  await revealSidebar(page)
  const groupToggle = page.getByRole("button", { name: "切换为项目视图", exact: true })
  if (await groupToggle.isVisible()) await groupToggle.click()
  await page.getByRole("button", { name: "在 Zenith 中新建会话", exact: true }).click()
  await expect(page.getByRole("heading", { name: "开始新任务", exact: true })).toBeVisible()
}

async function configure(page: Page) {
  await newProjectChat(page)
  await revealComposerSettings(page)
  await page.getByRole("button", { name: "会话工作区", exact: true }).click()
  await page.getByRole("button", { name: "新建 worktree", exact: true }).click()
  await page.getByLabel("目标根目录", { exact: true }).fill(root)
  await page.getByLabel("文件夹名称", { exact: true }).fill(selection.name)
  await page.getByLabel("新分支", { exact: true }).fill(selection.branch)
  await expect(page.getByLabel("来源检出目录", { exact: true })).toHaveValue(selection.repository)
  await expect(page.locator("[data-worktree-target]")).toHaveText(target)
  const dialog = page.getByRole("dialog", { name: "会话工作区", exact: true })
  const bounds = await dialog.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? Infinity) + 1)
}

async function closeSettings(page: Page) {
  await page.keyboard.press("Escape")
  if (await page.getByRole("dialog", { name: "更多", exact: true }).isVisible()) await page.keyboard.press("Escape")
}

async function dismissErrorNotice(page: Page) {
  const notice = page.locator(".surface-fade").filter({ has: page.getByRole("alert") })
  await expect(notice).toBeVisible()
  await notice.getByRole("button", { name: "关闭", exact: true }).click()
}

async function submit(page: Page, text = "Implement this in an isolated checkout") {
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(text)
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
}

test("new-chat mode is draft-only, then creates, binds and sends the explicit worktree", async ({ page }, info) => {
  const state = await install(page)
  await configure(page)
  expect(state.creates).toEqual([])
  expect(state.bindings).toEqual([])
  expect(state.chats).toEqual([])
  await page.screenshot({ path: info.outputPath("new-chat-worktree-config.png"), fullPage: true, animations: "disabled" })
  await closeSettings(page)
  await submit(page)
  await expect.poll(() => state.executes.length).toBe(1)
  expect(state.creates).toEqual([selection])
  expect(state.bindings).toEqual([{ body: { path: target }, revision: '"1"' }])
  expect(state.chats).toHaveLength(1)
  expect(state.chats[0]).toMatchObject({ project_id: "project-a", workspace_path: target })
  expect(state.chats[0].session_id).toBeUndefined()
  expect(state.order).toEqual(["create", "bind", "chat", "execute"])
  expect(state.observation.pageErrors).toEqual([])
})

test("binding conflict preserves the draft and reuses the created directory with fresh CAS", async ({ page }) => {
  const state = await install(page, "bind-conflict")
  await configure(page)
  await closeSettings(page)
  await submit(page, "Keep my draft after binding fails")
  await expect.poll(() => state.bindings.length).toBe(1)
  await expectComposerText(page.getByRole("textbox", { name: "消息", exact: true }), "Keep my draft after binding fails")
  await dismissErrorNotice(page)
  await revealComposerSettings(page)
  await expect(page.locator("[data-new-chat-worktree-control]")).toContainText("Worktree 准备失败")
  await page.getByRole("button", { name: "会话工作区", exact: true }).click()
  await expect(page.getByLabel("文件夹名称", { exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "当前工作区", exact: true })).toBeDisabled()
  await closeSettings(page)
  expect(state.chats).toEqual([])
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => state.executes.length).toBe(1)
  expect(state.creates).toEqual([selection])
  expect(state.bindings.map((entry) => entry.revision)).toEqual(['"1"', '"2"'])
  expect(state.chats[0]).toMatchObject({ workspace_path: target })
  expect(state.observation.pageErrors).toEqual([])
})

test("even HTTP 400 after create locks the intent and never replays or falls back", async ({ page }) => {
  const state = await install(page, "uncertain")
  await configure(page)
  await closeSettings(page)
  await submit(page, "Never resend an uncertain worktree creation")
  await dismissErrorNotice(page)
  await revealComposerSettings(page)
  await expect(page.locator("[data-new-chat-worktree-control]")).toContainText("Worktree 创建可能已部分完成")
  await page.getByRole("button", { name: "会话工作区", exact: true }).click()
  await expect(page.getByLabel("文件夹名称", { exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "当前工作区", exact: true })).toBeDisabled()
  await closeSettings(page)
  await expectComposerText(page.getByRole("textbox", { name: "消息", exact: true }), "Never resend an uncertain worktree creation")
  // Depending on presentation the submit action is disabled or re-checks the
  // ledger; pressing Enter must not dispatch a second POST in either case.
  await page.getByRole("textbox", { name: "消息", exact: true }).press("Enter")
  await expect.poll(() => state.creates.length).toBe(1)
  expect(state.bindings).toEqual([])
  expect(state.chats).toEqual([])
  expect(state.observation.pageErrors).toEqual([])
})

test("current workspace remains the default and sends without worktree side effects", async ({ page }) => {
  const state = await install(page)
  await newProjectChat(page)
  await revealComposerSettings(page)
  await expect(page.getByRole("button", { name: "会话工作区", exact: true })).toContainText("当前工作区")
  if (await page.getByRole("dialog", { name: "更多", exact: true }).isVisible()) await page.keyboard.press("Escape")
  await submit(page, "Keep using the Project workspace")
  await expect.poll(() => state.executes.length).toBe(1)
  expect(state.creates).toEqual([])
  expect(state.bindings).toEqual([])
  expect(state.chats[0]).toMatchObject({ project_id: "project-a", workspace_path: "/repo/zenith" })
  expect(state.observation.pageErrors).toEqual([])
})

test("leaving while create is in flight stops stale binding and sending", async ({ page }) => {
  const state = await install(page, "delayed")
  await configure(page)
  await closeSettings(page)
  await submit(page, "Do not send this into another conversation")
  await expect.poll(() => state.creates.length).toBe(1)
  await revealSidebar(page)
  await page.getByRole("button", { name: /All-surface acceptance/ }).first().click()
  const response = page.waitForResponse((res) => res.url().endsWith("/projects/project-a/worktrees") && res.request().method() === "POST")
  state.releaseCreate()
  await response
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  // Return to a new draft after the response; the abandoned continuation must
  // not resume merely because currentSessionId becomes null again.
  await newProjectChat(page)
  await revealComposerSettings(page)
  await expect(page.getByRole("button", { name: "会话工作区", exact: true })).toContainText("当前工作区")
  expect(state.creates).toEqual([selection])
  expect(state.bindings).toEqual([])
  expect(state.chats).toEqual([])
  expect(state.executes).toEqual([])
  expect(state.observation.pageErrors).toEqual([])
})
