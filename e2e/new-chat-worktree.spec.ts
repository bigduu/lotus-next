import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { expectComposerText, revealComposerSettings } from "./support/composer.js"
import type { PatchProjectRequest, ProjectManifest, ProjectSidebar } from "../src/services/project/types.js"

// Built frontend + fixture API only. This verifies request ordering and UI
// lifecycle, not real Git/filesystem behavior or model execution.
const root = "/Volumes/External/worktrees"
const target = `${root}/first-chat`
const selection = { repository: "/repo/zenith", root, name: "first-chat", branch: "chat/first-chat" }
const sectionInZenith = { id: "section:00000000-0000-4000-8000-0000000000a1", name: "Section chat" }

async function install(page: Page, mode: "success" | "bind-conflict" | "uncertain" | "delayed" | "chat-delayed" = "success",
  options: { section?: { id: string; name: string }; projectDefault?: boolean; defaultRoot?: string | null } = {}) {
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
    // Only the section-scoped regression needs durable sidebar state; every
    // other case keeps the original sectionless manifest.
    ...(options.section ? { sidebar: { sections: [options.section], session_sections: {}, hidden_legacy: false } } : {}),
    new_chat_worktree: options.projectDefault,
  }
  const creates: unknown[] = []
  const bindings: Array<{ body: unknown; revision: string | undefined }> = []
  const chats: Array<Record<string, unknown>> = []
  const executes: unknown[] = []
  const order: string[] = []
  const sidebarWrites: ProjectSidebar[] = []
  const preferenceWrites: Array<{ enabled: boolean; revision: string | undefined }> = []
  const sourceLookups: string[] = []
  const destination = options.defaultRoot === undefined ? root : options.defaultRoot
  let releaseCreate = () => {}
  const createGate = new Promise<void>((resolve) => { releaseCreate = resolve })
  let releaseChat = () => {}
  const chatGate = new Promise<void>((resolve) => { releaseChat = resolve })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (path === "/api/v1/projects") return route.fulfill({ json: { projects: [project] } })
    if (path === "/api/v1/worktrees/preferences") return route.fulfill({ json: { default_root: destination } })
    if (path === "/api/v1/projects/project-a") {
      if (request.method() === "PATCH") {
        // Durable section assignment writes land here, not in composer state.
        const body = request.postDataJSON() as PatchProjectRequest
        if (body.sidebar) {
          sidebarWrites.push(structuredClone(body.sidebar))
          project = { ...project, sidebar: structuredClone(body.sidebar), revision: project.revision + 1 }
        }
        if (typeof body.new_chat_worktree === "boolean") {
          preferenceWrites.push({ enabled: body.new_chat_worktree, revision: request.headers()["if-match"] })
          project = { ...project, new_chat_worktree: body.new_chat_worktree, revision: project.revision + 1 }
        }
        return route.fulfill({ json: project, headers: { ETag: `"${project.revision}"` } })
      }
      // Match the real server's omission of an empty binding list.
      return route.fulfill({ json: { ...project, workspace_bindings: project.workspace_bindings.length ? project.workspace_bindings : undefined } })
    }
    if (path === "/api/v1/projects/project-a/worktrees") {
      if (request.method() === "POST") {
        const create = request.postDataJSON() as { root: string; name: string }
        creates.push(create)
        order.push("create")
        if (mode === "uncertain") return route.fulfill({ status: 400, json: { error: "checkout failed after branch registration" } })
        if (mode === "delayed") await createGate
        return route.fulfill({ status: 201, json: { path: `${create.root}/${create.name}` } })
      }
      if (url.searchParams.get("sources_only") === "true") sourceLookups.push(project.id)
      return route.fulfill({ json: { project_id: project.id, default_root: destination,
        repositories: [{ path: "/repo/zenith", error: null, worktrees: [] }] } })
    }
    if (path === "/api/v1/projects/project-a/workspaces") {
      const binding = request.postDataJSON() as { path: string }
      bindings.push({ body: binding, revision: request.headers()["if-match"] })
      order.push("bind")
      if (mode === "bind-conflict" && bindings.length === 1) {
        project = { ...project, revision: 2 }
        return route.fulfill({ status: 412, json: { error: "Project revision changed" } })
      }
      project = { ...project, revision: project.revision + 1, workspace_count: 2, workspace_bindings: [binding] }
      return route.fulfill({ json: project })
    }
    if (path === "/api/v1/chat") {
      chats.push(request.postDataJSON())
      order.push("chat")
      if (mode === "chat-delayed") await chatGate
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
  return { observation, creates, bindings, chats, executes, order, sidebarWrites, preferenceWrites, sourceLookups, releaseCreate, releaseChat }
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

/** Same prepared worktree, but reached from a section header's own 新建 action. */
async function configureInSection(page: Page) {
  await revealSidebar(page)
  const groupToggle = page.getByRole("button", { name: "切换为项目视图", exact: true })
  if (await groupToggle.isVisible()) await groupToggle.click()
  await page.getByRole("button", { name: `在 ${sectionInZenith.name} 中新建会话`, exact: true }).click()
  await expect(page.getByRole("heading", { name: "开始新任务", exact: true })).toBeVisible()
  await revealComposerSettings(page)
  await page.getByRole("button", { name: "会话工作区", exact: true }).click()
  await page.getByRole("button", { name: "新建 worktree", exact: true }).click()
  await page.getByLabel("目标根目录", { exact: true }).fill(root)
  await page.getByLabel("文件夹名称", { exact: true }).fill(selection.name)
  await page.getByLabel("新分支", { exact: true }).fill(selection.branch)
  await expect(page.locator("[data-worktree-target]")).toHaveText(target)
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
  expect(state.sidebarWrites).toEqual([])
  expect(state.observation.pageErrors).toEqual([])
})

test("an in-flight worktree keeps the submitted draft and attachments separate from new edits", async ({ page }) => {
  const state = await install(page, "delayed")
  await configure(page)
  await closeSettings(page)
  const editor = page.getByRole("textbox", { name: "消息", exact: true })
  const image = (name: string) => ({
    name, mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jEboAAAAASUVORK5CYII=", "base64"),
  })
  const picker = page.locator('input[type="file"]')
  await picker.setInputFiles(image("before.png"))
  await expect(page.getByRole("img", { name: "before.png" })).toBeVisible()
  await submit(page, "Frozen first request")
  await expect.poll(() => state.creates.length).toBe(1)
  await editor.press("Enter")
  expect(state.chats).toEqual([])
  await editor.fill("A newer draft")
  await picker.setInputFiles(image("after.png"))
  await expect(page.getByRole("img", { name: "after.png" })).toBeVisible()
  state.releaseCreate()
  await expect.poll(() => state.executes.length).toBe(1)
  expect(state.creates).toEqual([selection])
  expect(state.bindings).toEqual([{ body: { path: target }, revision: '"1"' }])
  expect(state.chats).toEqual([expect.objectContaining({
    message: "Frozen first request", workspace_path: target,
    images: [expect.objectContaining({ name: "before.png" })],
  })])
  await expectComposerText(editor, "A newer draft")
  const composer = editor.locator('xpath=ancestor::*[@data-composer-surface][1]')
  await expect(composer.getByRole("img", { name: "before.png" })).toBeVisible()
  await expect(composer.getByRole("img", { name: "after.png" })).toBeVisible()
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

test("the saved Project default creates and binds a worktree on first send after reloading", async ({ page }, info) => {
  const state = await install(page, "success", { projectDefault: false })
  await revealSidebar(page)
  await page.getByRole("button", { name: "Worktree 管理", exact: true }).click()
  const toggle = page.getByRole("switch", { name: "新会话默认使用 Worktree", exact: true })
  await expect(toggle).toHaveAttribute("aria-checked", "false")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-checked", "true")
  expect(state.preferenceWrites).toEqual([{ enabled: true, revision: '"1"' }])
  await page.screenshot({ path: info.outputPath("project-new-chat-worktree-default.png"), animations: "disabled" })

  await page.reload()
  await newProjectChat(page)
  await revealComposerSettings(page)
  await expect(page.getByRole("button", { name: "会话工作区", exact: true })).toContainText("新建 worktree")
  expect(state.creates).toEqual([])
  if (await page.getByRole("dialog", { name: "更多", exact: true }).isVisible()) await page.keyboard.press("Escape")
  await submit(page)
  await expect.poll(() => state.executes.length).toBe(1)
  expect(state.order).toEqual(["create", "bind", "chat", "execute"])
  expect(state.sourceLookups).toEqual(["project-a"])
  const create = state.creates[0] as { name: string; branch: string }
  expect(create).toMatchObject({ repository: "/repo/zenith", root, name: expect.stringMatching(/^chat-\d{8}-[a-z0-9]{6}$/) })
  expect(create.branch).toBe(`chat/${create.name}`)
  const checkout = `${root}/${create.name}`
  expect(state.bindings).toEqual([{ body: { path: checkout }, revision: '"2"' }])
  expect(state.chats[0]).toMatchObject({ project_id: "project-a", workspace_path: checkout })
  expect(state.observation.pageErrors).toEqual([])
})

test("an unresolved Project default preserves the draft and lets the user opt out for that chat", async ({ page }) => {
  const state = await install(page, "success", { projectDefault: true, defaultRoot: null })
  await newProjectChat(page)
  const message = "This draft survives missing Worktree configuration"
  await submit(page, message)
  await expect(page.getByText(/请在 Worktree 管理中保存目标根目录/).first()).toBeVisible()
  await expectComposerText(page.getByRole("textbox", { name: "消息", exact: true }), message)
  expect(state.order).toEqual([])

  await dismissErrorNotice(page)
  await revealComposerSettings(page)
  await page.getByRole("button", { name: "会话工作区", exact: true }).click()
  await page.getByRole("button", { name: "当前工作区", exact: true }).click()
  await closeSettings(page)
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => state.executes.length).toBe(1)
  expect(state.creates).toEqual([])
  expect(state.preferenceWrites).toEqual([])
  expect(state.chats[0]).toMatchObject({ project_id: "project-a", workspace_path: "/repo/zenith", message })
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

test("a section-scoped new chat keeps its durable assignment when leaving during a pending acknowledgement", async ({ page }) => {
  const state = await install(page, "chat-delayed", { section: sectionInZenith })
  await configureInSection(page)
  await closeSettings(page)
  await submit(page, "Assign this section chat before leaving")
  // The acknowledgement is held open, so the session exists but the composer
  // has not been told yet.
  await expect.poll(() => state.chats.length).toBe(1)
  expect(state.chats[0]).toMatchObject({ project_id: "project-a", workspace_path: target })
  await revealSidebar(page)
  await page.getByRole("button", { name: /All-surface acceptance/ }).first().click()
  state.releaseChat()
  // The assignment is durable project metadata for a session that already
  // exists, so it must outlive the abandoned composer's navigation.
  await expect.poll(() => state.sidebarWrites.length).toBe(1)
  expect(state.sidebarWrites.at(-1)!.session_sections["all-surface-session"]).toBe(sectionInZenith.id)
  expect(state.sidebarWrites.at(-1)!.sections).toEqual([sectionInZenith])
  // ...while the stale-navigation guard still suppresses composer-level writes:
  // the abandoned draft is neither cleared into nor moved onto this session.
  await expectComposerText(page.getByRole("textbox", { name: "消息", exact: true }), "")
  expect(state.observation.pageErrors).toEqual([])
})
