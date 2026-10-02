import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "all-surface-session"
const birth = "b".repeat(64)
const at = "2026-09-26T00:00:00.000Z"
const session = { id: sessionId, title: "Typed Workflow acceptance", kind: "root", title_version: 1, pinned: false,
  root_session_id: sessionId, parent_session_id: null, spawn_depth: 0,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: at, updated_at: at, last_activity_at: at, message_count: 0, has_attachments: false,
  is_running: false, last_run_status: "completed", permission_mode: "default", bypass_permissions: false, subagent_count: 0 }
const entry = { id: "review/exact", name: "Bounded review", description: "Review only the selected files", kind: "instruction",
  source: "workspace", revision: 7, status: "valid", winner: true, invocation_policy: { explicit: true },
  argument_schema: { type: "object", required: ["target"], properties: { target: { type: "string" } }, additionalProperties: false } }
async function openCatalog(page: import("@playwright/test").Page) {
  // Wait for the restored session to own the composer draft before typing.
  // Otherwise the new-chat draft can be replaced by the session draft on hydration.
  await expect(page.locator('[data-variant="composer"][aria-label="会话权限"]')).toBeVisible()
  const message = page.getByRole("textbox", { name: "消息", exact: true })
  await message.fill("/workflow")
  await expect(message).toHaveValue("/workflow")
  await page.getByRole("button", { name: /\/目录工作流.*目录选择/ }).click()
  await expect(page.getByRole("combobox", { name: "目录中的 Workflow" })).toBeVisible()
  await expect(message).toHaveValue("")
}

test("exact Workflow survives Root conflict then succeeds after explicit mode disable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet-chromium", "desktop and phone acceptance")
  await page.addInitScript((id) => { localStorage.setItem("bodhi_onboarded_v1", "1"); localStorage.setItem("lotus_next_last_session", id) }, sessionId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let ordinary: string | undefined; let enabled = true; let epoch = 0; let catalogReads = 0; let detailReads = 0
  const chats: Array<Record<string, unknown>> = []; const modes: Array<Record<string, unknown>> = []
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON(); expect(body).toEqual({ clear_reasoning_effort: true }); ordinary = undefined
      return route.fulfill({ json: {} })
    }
    detailReads += 1
    return route.fulfill({ json: { session: { ...session, reasoning_effort: ordinary, thinking_mode: enabled ? "ultra" : "standard", root_orchestration_only: enabled, root_mode_transition_epoch: epoch, root_mode_birth_token: birth } } })
  })
  await page.route("**/api/v1/bamboo/workflow-catalog?*", (route) => {
    expect(new URL(route.request().url()).searchParams.get("session_id")).toBe(sessionId); catalogReads += 1
    return route.fulfill({ json: { revision: 100, entries: [entry, { ...entry, id: "run", name: "Deploy orchestration", kind: "orchestration" }] } })
  })
  await page.route("**/api/v1/chat", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>; chats.push(body)
    expect(body.root_orchestration_only).toBeUndefined()
    expect(body.workflow_selection).toEqual({ id: entry.id, source: "workspace", revision: 7, args: { target: "src/scope.ts" } })
    expect(body.message).toBe("Review this exact file only")
    return enabled ? route.fulfill({ status: 409, json: { error: { type: "api_error", code: "root_orchestration_incompatible_mode", message: "Disable Root orchestration-only mode before selecting a Workflow" } } })
      : route.fulfill({ json: { session_id: sessionId, status: "success" } })
  })
  await page.route(`**/api/v1/sessions/${sessionId}/root-mode-operations/*`, (route) => {
    const input = route.request().postDataJSON() as Record<string, unknown>; modes.push(input)
    expect(input).toEqual({ birth_token: birth, expected_epoch: epoch, enabled: false, thinking_mode: "standard" })
    const operationId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)!)
    const expected = epoch; epoch += 1; enabled = false
    return route.fulfill({ json: { status: "committed", operation_id: operationId, expected_epoch: expected,
      resulting_epoch: epoch, enabled_at_completion: false, thinking_mode_at_completion: "standard", root_tool_authority_revision: epoch } })
  })
  await page.route(`**/api/v1/execute/${sessionId}`, (route) => route.fulfill({ json: { status: "started", session_id: sessionId } }))
  await page.goto(standaloneScenario.entryUrl)
  const mode = page.getByRole("button", { name: "推理强度" })
  const message = page.getByRole("textbox", { name: "消息", exact: true })
  await expect(mode).toContainText("Ultra"); expect(catalogReads).toBe(0)
  await expect(page.getByRole("button", { name: "选择目录工作流", exact: true })).toHaveCount(0)
  await openCatalog(page)
  const picker = page.getByRole("combobox", { name: "目录中的 Workflow" })
  await expect(picker).toBeVisible()
  await expect(picker.locator('option[value="1"]')).toHaveAttribute("disabled", "")
  await picker.selectOption("0")
  await expect(page.locator("[data-workflow-selection]")).toHaveCount(0)
  await page.getByRole("button", { name: "工作流 · Bounded review" }).click()
  await message.fill("Review this exact file only")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  expect(chats).toHaveLength(0)
  const args = page.getByRole("textbox", { name: "Workflow 参数（JSON）" })
  await message.fill("/goal")
  await expect(page.getByRole("button", { name: /\/goal.*指令/ })).toBeVisible()
  await args.fill('{"target":"src/scope.ts"}')
  await expect(page.getByRole("button", { name: /\/goal.*指令/ })).toHaveCount(0)
  await message.fill("Review this exact file only")
  const before = detailReads
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect(page.locator("[data-workflow-selection]").getByRole("alert")).toContainText("root_orchestration_incompatible_mode")
  await expect.poll(() => detailReads).toBeGreaterThan(before)
  await expect(mode).toContainText("Ultra"); expect(modes).toHaveLength(0)
  await expect(message).toHaveValue("Review this exact file only"); await expect(args).toHaveValue('{"target":"src/scope.ts"}')
  const conflict = testInfo.outputPath("typed-workflow-root-conflict.png")
  await page.screenshot({ path: conflict }); await testInfo.attach("typed-workflow-root-conflict", { path: conflict, contentType: "image/png" })
  await mode.click(); await page.getByRole("menuitem", { name: "自动", exact: true }).click(); await expect(mode).not.toContainText("Ultra")
  await expect(page.getByRole("status").filter({ hasText: "服务器已确认普通模式" })).toBeVisible()
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chats.length).toBe(2)
  await expect(message).toHaveValue(""); expect(modes).toHaveLength(1)
  await page.reload(); await expect(mode).not.toContainText("Ultra")
  await expect(page.getByRole("status").filter({ hasText: "服务器已确认普通模式" })).toBeVisible()
  await expect(page.getByRole("button", { name: "选择目录工作流", exact: true })).toHaveCount(0)
  await expect(args).toHaveCount(0)
  expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  const recovered = testInfo.outputPath("typed-workflow-after-reload.png")
  await page.screenshot({ path: recovered }); await testInfo.attach("typed-workflow-after-reload", { path: recovered, contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
})

test("stale catalog retains old exact selection until reselected and text expansion stays explicit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet-chromium", "desktop and phone acceptance")
  await page.addInitScript((id) => { localStorage.setItem("bodhi_onboarded_v1", "1"); localStorage.setItem("lotus_next_last_session", id) }, sessionId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let revision = 7; let detailReads = 0
  const chats: Array<Record<string, unknown>> = []
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => {
    detailReads += 1
    return route.fulfill({ json: { session: { ...session, root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 0, root_mode_birth_token: birth } } })
  })
  await page.route("**/api/v1/bamboo/workflow-catalog?*", (route) => route.fulfill({ json: { revision: 100, entries: [{ ...entry, revision }] } }))
  await page.route("**/api/v1/commands", (route) => route.fulfill({ json: { total: 1, commands: [{ id: "workflow-legacy", name: "legacy", display_name: "legacy", description: "Expand legacy text", type: "workflow", metadata: null }] } }))
  await page.route("**/api/v1/commands/workflow/legacy", (route) => route.fulfill({ json: { id: "workflow-legacy", name: "legacy", content: "Legacy markdown instructions", type: "workflow" } }))
  await page.route("**/api/v1/chat", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>; chats.push(body)
    const selection = body.workflow_selection as { revision: number } | undefined
    return selection?.revision === 7 ? route.fulfill({ status: 409, json: { error: { code: "workflow_revision_mismatch", message: "selected workflow revision changed; refresh the catalog" } } })
      : route.fulfill({ json: { session_id: sessionId, status: "success" } })
  })
  await page.route(`**/api/v1/execute/${sessionId}`, (route) => route.fulfill({ json: { status: "started", session_id: sessionId } }))
  await page.goto(standaloneScenario.entryUrl)
  const message = page.getByRole("textbox", { name: "消息", exact: true })
  await openCatalog(page)
  const picker = page.getByRole("combobox", { name: "目录中的 Workflow" }); await picker.selectOption("0")
  await page.getByRole("button", { name: "工作流 · Bounded review" }).click()
  const args = page.getByRole("textbox", { name: "Workflow 参数（JSON）" })
  await args.fill('{"target":"src"}')
  revision = 8; await openCatalog(page)
  await page.getByRole("button", { name: "刷新 Workflow 目录", exact: true }).click()
  await expect(picker.locator('option[value="0"]')).toContainText("r8")
  await expect(page.locator("[data-workflow-selection]")).toContainText("workspace · r7")
  await message.fill("keep stale task")
  const before = detailReads
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect(page.locator("[data-workflow-selection]").getByRole("alert")).toContainText("workflow_revision_mismatch")
  await expect.poll(() => detailReads).toBeGreaterThan(before)
  await expect(message).toHaveValue("keep stale task"); await expect(args).toHaveValue('{"target":"src"}')
  expect(chats[0].workflow_selection).toEqual({ id: entry.id, source: "workspace", revision: 7, args: { target: "src" } })
  const stale = testInfo.outputPath("typed-workflow-stale-selection.png")
  await page.screenshot({ path: stale }); await testInfo.attach("typed-workflow-stale-selection", { path: stale, contentType: "image/png" })
  await picker.selectOption("0")
  await page.getByRole("button", { name: "工作流 · Bounded review" }).click()
  await args.fill('{"target":"src"}')
  await message.fill("keep stale task")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chats.length).toBe(2)
  expect(chats[1].workflow_selection).toEqual({ id: entry.id, source: "workspace", revision: 8, args: { target: "src" } })
  await page.reload(); await expect(args).toHaveCount(0)
  await expect(page.getByRole("status").filter({ hasText: "服务器已确认普通模式" })).toBeVisible()
  await message.fill("/legacy")
  await page.getByRole("button", { name: /\/legacy.*文本展开/ }).click()
  await expect(page.getByText("文本展开 /legacy", { exact: true })).toBeVisible()
  await message.fill("extra input")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chats.length).toBe(3)
  expect(chats[2].workflow_selection).toBeUndefined()
  expect(chats[2].message).toBe("Legacy markdown instructions\n\nextra input")
  expect(observation.pageErrors).toEqual([])
})
