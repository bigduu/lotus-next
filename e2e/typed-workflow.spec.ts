import { expect, test, type Page, type TestInfo } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "all-surface-session"
const birth = "b".repeat(64)
const at = "2026-09-26T00:00:00.000Z"
const session = { id: sessionId, title: "Workflow selection preview", kind: "root", title_version: 1, pinned: false,
  root_session_id: sessionId, parent_session_id: null, spawn_depth: 0,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: at, updated_at: at, last_activity_at: at, message_count: 0, has_attachments: false,
  workspace_path: "/workspace/lotus-next", project_id: "workflow-preview",
  is_running: false, last_run_status: "completed", permission_mode: "default", bypass_permissions: false, subagent_count: 0 }
const entry = { id: "review/exact", name: "Bounded review", description: "Review only the selected files", kind: "instruction",
  source: "workspace", revision: 7, status: "valid", winner: true, invocation_policy: { explicit: true },
  argument_schema: { type: "object", required: ["target"], properties: { target: { type: "string" } }, additionalProperties: false } }
const message = (page: Page) => page.getByRole("textbox", { name: "消息", exact: true }).first()
const chip = (page: Page) => page.locator("[data-composer-surface] [data-workflow-chip]").first()
const args = (page: Page) => page.getByRole("textbox", { name: "Workflow 参数（JSON）" })
const picker = (page: Page) => page.getByRole("dialog", { name: "目录工作流 · 本条消息" })
async function ready(page: Page) {
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.locator('[data-variant="composer"][aria-label="会话权限"]').first()).toBeVisible()
}
async function openCatalog(page: Page) {
  await page.getByRole("button", { name: "打开目录工作流", exact: true }).first().click()
  await expect(picker(page).getByLabel("目录中的 Workflow")).toBeVisible()
}
async function editArgs(page: Page, value: string) {
  await chip(page).getByRole("button", { name: /编辑目录工作流/ }).click()
  await args(page).fill(value)
  await picker(page).getByRole("button", { name: "关闭工作流目录", exact: true }).click()
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, animations: "disabled" })
  await info.attach(name, { path, contentType: "image/png" })
}
async function setup(page: Page, ultra = false) {
  await page.addInitScript((id) => { localStorage.setItem("bodhi_onboarded_v1", "1"); localStorage.setItem("lotus_next_last_session", id) }, sessionId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({ json: { sessions: [session], total: 1, limit: 200, offset: 0 } }))
  const project = { id: "workflow-preview", name: "Lotus Next", status: "active", revision: 1,
    project_path: "/workspace/lotus-next", project_path_status: "configured", created_at: at, updated_at: at }
  await page.route("**/api/v1/projects?*", (route) => route.fulfill({ json: { projects: [project] } }))
  await page.route("**/api/v1/projects", (route) => route.fulfill({ json: { projects: [project] } }))
  await page.route("**/api/v1/projects/workflow-preview", (route) => route.fulfill({ json: { project } }))
  const state = { ultra, epoch: 0, revision: 7, catalogReads: 0, detailReads: 0 }
  const chats: Array<Record<string, unknown>> = []
  const modes: Array<Record<string, unknown>> = []
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => {
    if (route.request().method() === "PATCH") return route.fulfill({ json: {} })
    state.detailReads++
    return route.fulfill({ json: { session: { ...session, thinking_mode: state.ultra ? "ultra" : "standard", root_orchestration_only: state.ultra,
      root_mode_transition_epoch: state.epoch, root_mode_birth_token: birth } }, headers: { ETag: '"1"' } })
  })
  await page.route("**/api/v1/bamboo/workflow-catalog?*", (route) => {
    expect(new URL(route.request().url()).searchParams.get("session_id")).toBe(sessionId); state.catalogReads++
    return route.fulfill({ json: { revision: 100, entries: [{ ...entry, revision: state.revision }, { ...entry, id: "run", name: "Deploy orchestration", kind: "orchestration" }] } })
  })
  await page.route("**/api/v1/commands", (route) => route.fulfill({ json: { total: 1, commands: [{ id: "workflow-legacy", name: "legacy", display_name: "legacy", description: "Expand legacy text", type: "workflow", metadata: null }] } }))
  await page.route("**/api/v1/commands/workflow/legacy", (route) => route.fulfill({ json: { id: "workflow-legacy", name: "legacy", content: "Legacy markdown instructions", type: "workflow" } }))
  await page.route(`**/api/v1/execute/${sessionId}`, (route) => route.fulfill({ json: { status: "started", session_id: sessionId } }))
  await page.route(`**/api/v1/sessions/${sessionId}/root-mode-operations/*`, (route) => {
    const input = route.request().postDataJSON(); modes.push(input)
    expect(input).toEqual({ birth_token: birth, expected_epoch: state.epoch, enabled: false, thinking_mode: "standard" })
    const operationId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)!)
    const expected = state.epoch; state.epoch++; state.ultra = false
    return route.fulfill({ json: { status: "committed", operation_id: operationId, expected_epoch: expected,
      resulting_epoch: state.epoch, enabled_at_completion: false, thinking_mode_at_completion: "standard", root_tool_authority_revision: state.epoch } })
  })
  return { observation, state, chats, modes }
}

test("exact Workflow survives Root conflict then succeeds after explicit mode disable", async ({ page }, info) => {
  test.skip(info.project.name === "tablet-chromium", "desktop and phone acceptance")
  const { observation, state, chats, modes } = await setup(page, true)
  await page.route("**/api/v1/chat", (route) => {
    const body = route.request().postDataJSON(); chats.push(body)
    expect(body.root_orchestration_only).toBeUndefined()
    expect(body.project_id).toBeUndefined()
    expect(body.workflow_selection).toEqual({ id: entry.id, source: "workspace", revision: 7, args: { target: "src/scope.ts" } })
    expect(body.message).toBe("Review this exact file only")
    return state.ultra ? route.fulfill({ status: 409, json: { error: { code: "root_orchestration_incompatible_mode", message: "Disable Root orchestration-only mode before selecting a Workflow" } } })
      : route.fulfill({ json: { session_id: sessionId, status: "success" } })
  })
  await ready(page)
  const mode = page.getByRole("button", { name: "推理强度" })
  await expect(mode).toContainText("Ultra"); expect(state.catalogReads).toBe(0)
  await openCatalog(page)
  await expect(picker(page).getByRole("button", { name: /Deploy orchestration/ })).toBeDisabled()
  await picker(page).getByRole("button", { name: /Bounded review workspace/ }).click()
  await expect(picker(page)).toHaveCount(0)
  await expect(chip(page)).toContainText("本条消息")
  await message(page).fill("Review this exact file only")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  expect(chats).toHaveLength(0)
  await expect(chip(page).getByRole("alert")).toContainText("target")
  await editArgs(page, '{"target":"src/scope.ts"}')
  const before = state.detailReads
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect(chip(page).getByRole("alert")).toContainText("root_orchestration_incompatible_mode")
  await expect.poll(() => state.detailReads).toBeGreaterThan(before)
  await expect(mode).toContainText("Ultra"); expect(modes).toHaveLength(0)
  await expect(message(page)).toHaveValue("Review this exact file only")
  await screenshot(page, info, "workflow-root-conflict")
  await chip(page).getByRole("button", { name: /编辑目录工作流/ }).click()
  await expect(args(page)).toHaveValue('{"target":"src/scope.ts"}')
  await picker(page).getByRole("button", { name: "关闭工作流目录", exact: true }).click()
  await mode.click(); await page.getByRole("menuitem", { name: "自动", exact: true }).click()
  await expect(mode).not.toContainText("Ultra")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chats.length).toBe(2)
  await expect(message(page)).toHaveValue(""); expect(modes).toHaveLength(1)
  await page.reload(); await expect(mode).not.toContainText("Ultra")
  await expect(chip(page)).toHaveCount(0)
  expect(await page.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
  expect(observation.pageErrors).toEqual([])
})

test("stale catalog retains old exact selection until reselected and text expansion stays explicit", async ({ page }, info) => {
  test.skip(info.project.name === "tablet-chromium", "desktop and phone acceptance")
  const { observation, state, chats } = await setup(page)
  await page.route("**/api/v1/chat", (route) => {
    const body = route.request().postDataJSON(); chats.push(body)
    return body.workflow_selection?.revision === 7 ? route.fulfill({ status: 409, json: { error: { code: "workflow_revision_mismatch", message: "selected workflow revision changed; refresh the catalog" } } })
      : route.fulfill({ json: { session_id: sessionId, status: "success" } })
  })
  await ready(page)
  await message(page).fill("/Bounded")
  await page.getByRole("button", { name: /\/Bounded review workspace · r7/ }).click()
  await args(page).fill('{"target":"src"}')
  state.revision = 8
  await picker(page).getByRole("button", { name: "刷新", exact: true }).click()
  await expect(picker(page).getByRole("button", { name: /Bounded review workspace · r8/ })).toBeVisible()
  await expect(page.locator("[data-workflow-selection]")).toContainText("workspace · r7")
  await picker(page).getByRole("button", { name: "关闭工作流目录", exact: true }).click()
  await message(page).fill("keep stale task")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect(chip(page).getByRole("alert")).toContainText("workflow_revision_mismatch")
  expect(chats[0].workflow_selection).toEqual({ id: entry.id, source: "workspace", revision: 7, args: { target: "src" } })
  await screenshot(page, info, "workflow-stale-selection")
  await chip(page).getByRole("button", { name: /编辑目录工作流/ }).click()
  await expect(args(page)).toHaveValue('{"target":"src"}')
  await picker(page).getByRole("button", { name: /Bounded review workspace · r8/ }).click()
  await editArgs(page, '{"target":"src"}')
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chats.length).toBe(2)
  expect(chats[1].workflow_selection).toEqual({ id: entry.id, source: "workspace", revision: 8, args: { target: "src" } })
  await page.reload()
  await expect(page.locator('[data-variant="composer"][aria-label="会话权限"]')).toBeVisible()
  await expect(chip(page)).toHaveCount(0)
  await message(page).fill("/legacy")
  await page.getByRole("button", { name: /\/legacy.*文本展开/ }).click()
  await message(page).fill("extra input")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chats.length).toBe(3)
  expect(chats[2].workflow_selection).toBeUndefined()
  expect(chats[2].message).toBe("Legacy markdown instructions\n\nextra input")
  expect(observation.pageErrors).toEqual([])
})

test("Environment and slash selection share a message chip with IME, removal, and delayed ACK protection", async ({ page }, info) => {
  const { observation, chats } = await setup(page)
  let acknowledge = () => {}
  const ack = new Promise<void>((resolve) => { acknowledge = resolve })
  await page.route("**/api/v1/chat", async (route) => {
    chats.push(route.request().postDataJSON()); await ack
    await route.fulfill({ json: { session_id: sessionId, status: "success" } })
  })
  await ready(page)
  // Narrow layouts still expose the same Environment entry via its launcher.
  const environment = page.locator("[data-environment-card]")
  if (!(await environment.isVisible())) await page.getByRole("button", { name: "打开 Environment", exact: true }).click()
  await environment.getByRole("button", { name: "选择目录工作流，本条消息", exact: true }).click()
  await picker(page).getByRole("button", { name: /Bounded review workspace/ }).click()
  await expect(environment).toContainText("Bounded review")
  await expect(chip(page)).toContainText("Bounded review")
  expect(chats).toHaveLength(0)
  await page.getByRole("button", { name: "收起 Environment", exact: true }).click()
  await editArgs(page, '{"target":"src"}')
  await message(page).fill("请检查所选文件，并给出可执行的建议。")
  await screenshot(page, info, "workflow-chip-environment-hidden")
  await chip(page).getByRole("button", { name: "移除目录工作流", exact: true }).click()
  await expect(chip(page)).toHaveCount(0)
  await page.getByRole("button", { name: "撤销移除", exact: true }).click()
  await expect(chip(page)).toContainText("Bounded review")
  await page.getByRole("button", { name: "打开 Environment", exact: true }).click()
  await expect(environment).toContainText("Bounded review")
  await screenshot(page, info, "workflow-environment-and-chip")
  await page.getByRole("button", { name: "收起 Environment", exact: true }).click()
  await message(page).fill("/")
  await expect(page.getByText("目录工作流 · 本条消息", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("文本展开工作流", { exact: true })).toBeVisible()
  await screenshot(page, info, "workflow-slash-groups")
  await message(page).fill("/Bounded")
  const option = page.getByRole("button", { name: /\/Bounded review workspace/ })
  await expect(option).toBeVisible()
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    await message(page).dispatchEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...composition })
  }
  await expect(message(page)).toHaveValue("/Bounded"); expect(chats).toHaveLength(0)
  await message(page).press("Enter")
  await expect(args(page)).toBeVisible()
  await args(page).fill('{"target":"src"}')
  await args(page).press("End"); await args(page).press("Enter")
  await expect(args(page)).toHaveValue('{"target":"src"}\n')
  expect(chats).toHaveLength(0)
  await picker(page).getByRole("button", { name: "关闭工作流目录", exact: true }).click()
  await message(page).fill("frozen request")
  try {
    await message(page).press("Enter")
    await expect.poll(() => chats.length).toBe(1)
    await expect(chip(page).getByRole("button", { name: "移除目录工作流", exact: true })).toBeDisabled()
    await message(page).fill("newer unsent draft")
  } finally { acknowledge() }
  await expect(message(page)).toHaveAttribute("aria-busy", "false")
  await expect(message(page)).toHaveValue("newer unsent draft")
  await expect(chip(page)).toHaveCount(0)
  expect(chats[0].message).toBe("frozen request")
  expect(chats[0].workflow_selection).toEqual({ id: entry.id, source: "workspace", revision: 7, args: { target: "src" } })
  expect(chats[0].root_orchestration_only).toBeUndefined()
  expect(chats[0].project_id).toBeUndefined()
  expect(observation.pageErrors).toEqual([])
  expect(await page.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
})

test("two panes keep catalog choices and keyboard focus isolated", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "desktop split-pane acceptance")
  const { observation } = await setup(page)
  const sideId = "side-workflow"
  const side = { ...session, id: sideId, root_session_id: sideId, title: "Side workflow",
    root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 0, root_mode_birth_token: birth }
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({ json: { sessions: [session, side], total: 2, limit: 200, offset: 0 } }))
  await page.route(`**/api/v1/sessions/${sideId}`, (route) => route.fulfill({ json: { session: side }, headers: { ETag: '"1"' } }))
  await page.route(`**/api/v1/history/${sideId}`, (route) => route.fulfill({ json: { session_id: sideId, messages: [] } }))
  await page.route(`**/api/v1/task/${sideId}`, (route) => route.fulfill({ json: { session_id: sideId, items: [] } }))
  await page.route("**/api/v1/bamboo/workflow-catalog?*", (route) => {
    const isSide = new URL(route.request().url()).searchParams.get("session_id") === sideId
    return route.fulfill({ json: { revision: 1, entries: [{ ...entry, name: isSide ? "Side review" : entry.name, argument_schema: { type: "object" } }] } })
  })
  const chats: unknown[] = []
  await page.route("**/api/v1/chat", (route) => { chats.push(route.request().postDataJSON()); return route.fulfill({ status: 500, json: {} }) })
  await ready(page)
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  const workbench = page.locator("#right-workbench")
  await workbench.getByRole("button", { name: "打开工作面板标签页" }).click()
  await page.getByRole("menuitem", { name: "并排会话" }).click()
  await workbench.getByRole("combobox").filter({ hasText: "选择会话并排" }).click()
  await page.getByRole("option", { name: "Side workflow", exact: true }).click()
  const inputs = page.getByRole("textbox", { name: "消息", exact: true })
  await expect(inputs).toHaveCount(2)
  await inputs.nth(0).fill("/Bounded")
  await inputs.nth(1).fill("/Side")
  await expect(page.getByRole("button", { name: /\/Side review workspace/ })).toBeVisible()
  await inputs.nth(1).press("Enter")
  await expect(inputs.nth(1)).toHaveValue("")
  await expect(inputs.nth(0)).toHaveValue("/Bounded")
  await expect(workbench.locator("[data-workflow-chip]")).toContainText("Side review")
  await inputs.nth(0).press("Enter")
  await expect(inputs.nth(0)).toHaveValue("")
  await expect(page.locator("[data-workflow-chip]")).toHaveCount(2)
  await workbench.getByRole("button", { name: /编辑目录工作流 Side review/ }).click()
  await expect(args(page)).toBeVisible()
  await inputs.nth(0).click()
  await expect(inputs.nth(0)).toBeFocused()
  await expect(args(page)).toHaveCount(0)
  await workbench.getByRole("button", { name: "移除目录工作流", exact: true }).click()
  await expect(workbench.locator("[data-workflow-chip]")).toHaveCount(0)
  await expect(page.locator("[data-workflow-chip]")).toContainText("Bounded review")
  expect(chats).toHaveLength(0)
  expect(observation.pageErrors).toEqual([])
  await screenshot(page, info, "workflow-two-panes")
})
