import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "all-surface-session"
const childId = "root-mode-child"
const birthToken = "a".repeat(64)
const at = "2026-09-26T00:00:00.000Z"
const rootSession = {
  id: sessionId, title: "Root mode acceptance", title_version: 1, kind: "root", pinned: false,
  root_session_id: sessionId, parent_session_id: null, spawn_depth: 0,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: at, updated_at: at, last_activity_at: at, message_count: 0,
  has_attachments: false, is_running: false, last_run_status: "completed",
  permission_mode: "default", bypass_permissions: false, subagent_count: 0,
}
type Receipt = {
  status: "committed" | "fenced" | "rejected_incompatible"
  operation_id: string; expected_epoch: number; resulting_epoch: number
  enabled_at_completion: boolean; root_tool_authority_revision: number
}

test("creation and message-free Root switches survive reload and typed rejection", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet-chromium", "desktop and phone cover the responsive composer")
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let created = false; let durable = false; let epoch = 0; let rejectEnable = false
  const chats: Array<Record<string, unknown>> = []
  const operations: Array<Record<string, unknown>> = []
  const receipts = new Map<string, Receipt>()
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({
    json: { sessions: created ? [rootSession] : [], total: created ? 1 : 0, limit: 200, offset: 0 },
  }))
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => route.fulfill({ json: { session: {
    ...rootSession, root_orchestration_only: durable, root_mode_transition_epoch: epoch, root_mode_birth_token: birthToken,
  } } }))
  await page.route(`**/api/v1/task/${sessionId}`, (route) => route.fulfill({ json: { session_id: sessionId, items: [] } }))
  await page.route("**/api/v1/chat", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>; chats.push(body)
    if (body.session_id) expect(body.root_orchestration_only).toBeUndefined()
    else { created = true; durable = body.root_orchestration_only === true }
    return route.fulfill({ json: { session_id: sessionId, status: "success" } })
  })
  await page.route(`**/api/v1/sessions/${sessionId}/root-mode-operations/**`, (route) => {
    const path = new URL(route.request().url()).pathname.split("/")
    const recovering = path.at(-1) === "recover"
    const id = decodeURIComponent(path.at(recovering ? -2 : -1)!)
    const body = route.request().postDataJSON() as { birth_token: string; expected_epoch: number; enabled: boolean }
    expect(body.birth_token).toBe(birthToken)
    if (recovering) return route.fulfill({ json: receipts.get(id) })
    expect(body.expected_epoch).toBe(epoch); expect(id.startsWith(`${epoch}:`)).toBe(true)
    operations.push(body)
    const rejected = rejectEnable && body.enabled
    rejectEnable = false
    if (!rejected) durable = body.enabled
    const receipt: Receipt = { status: rejected ? "rejected_incompatible" : "committed", operation_id: id,
      expected_epoch: epoch, resulting_epoch: ++epoch, enabled_at_completion: durable, root_tool_authority_revision: epoch }
    receipts.set(id, receipt)
    return rejected ? route.fulfill({ status: 409, json: { error: {
      code: "root_orchestration_incompatible_mode", message: "Exit legacy PlanMode before enabling Root mode",
    } } }) : route.fulfill({ json: receipt })
  })
  await page.route(`**/api/v1/execute/${sessionId}`, (route) => route.fulfill({ json: { status: "started", session_id: sessionId } }))

  await page.goto(standaloneScenario.entryUrl)
  const mode = page.getByRole("checkbox", { name: "Root 仅编排模式" })
  const composer = page.getByRole("textbox", { name: "消息", exact: true })
  await expect(mode).toBeVisible(); await mode.focus(); await page.keyboard.press("Space")
  await expect(mode).toBeChecked()
  await page.getByRole("button", { name: "查看 Root 仅编排说明" }).click()
  await expect(page.getByText(/Root 负责任务编排、子代理进度和纠偏/)).toBeVisible()
  await page.keyboard.press("Escape")
  await composer.fill("delegate bounded work")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chats.length).toBe(1)
  expect(chats[0].root_orchestration_only).toBe(true); expect(chats[0].session_id).toBeUndefined()
  await page.reload(); await expect(mode).toBeChecked()
  await expect(page.getByRole("status").filter({ hasText: "服务器已启用" })).toBeVisible()

  await mode.click()
  await expect.poll(() => operations.length).toBe(1)
  await expect(page.getByRole("status").filter({ hasText: "服务器已关闭" })).toBeVisible()
  expect(chats).toHaveLength(1)
  await composer.fill("return to direct execution")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chats.length).toBe(2)
  expect(chats[1]).toMatchObject({ session_id: sessionId }); expect(chats[1].root_orchestration_only).toBeUndefined()
  await page.reload(); await expect(mode).not.toBeChecked()

  rejectEnable = true; await mode.click()
  await expect.poll(() => operations.length).toBe(2)
  await expect(page.getByText(/Bamboo 已拒绝本次 Root 模式切换/)).toBeVisible()
  await expect(mode).not.toBeChecked(); expect(chats).toHaveLength(2)
  await mode.click()
  await expect.poll(() => operations.length).toBe(3)
  await expect(page.getByRole("status").filter({ hasText: "服务器已启用" })).toBeVisible()
  await page.reload(); await expect(mode).toBeChecked()
  expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  const screenshot = testInfo.outputPath("root-mode-after-reload.png")
  await page.screenshot({ path: screenshot })
  await testInfo.attach("root-mode-after-reload", { path: screenshot, contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
})

test("restored Child composer exposes a read-only Root mode control", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "session restore boundary")
  await page.addInitScript((id) => { localStorage.setItem("bodhi_onboarded_v1", "1"); localStorage.setItem("lotus_next_last_session", id) }, childId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const parent = { ...rootSession, subagent_count: 1 }
  const child = { ...rootSession, id: childId, title: "Review child", kind: "child",
    root_session_id: sessionId, parent_session_id: sessionId, spawn_depth: 1 }
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === "GET" && url.pathname === "/api/v1/sessions") {
      const sessions = url.searchParams.get("kind") === "child" ? [child] : [parent]
      return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}`) return route.fulfill({ json: { session: parent } })
    if (url.pathname === `/api/v1/sessions/${childId}`) return route.fulfill({ json: { session: child } })
    if (url.pathname === `/api/v1/history/${childId}`) return route.fulfill({ json: { session_id: childId, messages: [] } })
    if (url.pathname === `/api/v1/respond/${childId}/pending`) return route.fulfill({ json: { has_pending_question: false } })
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("checkbox", { name: "Root 仅编排模式" })).toBeDisabled()
  await expect(page.getByRole("status").filter({ hasText: "仅 Root 可设置" })).toBeVisible()
  expect(observation.pageErrors).toEqual([])
})

test("a timed-out mode operation recovers after reload without chat replay", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet-chromium", "desktop and phone cover responsive recovery")
  await page.addInitScript((id) => { localStorage.setItem("bodhi_onboarded_v1", "1"); localStorage.setItem("lotus_next_last_session", id) }, sessionId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let durable = true; let epoch = 0; let terminal: Receipt | null = null
  let selects = 0; let recoveries = 0; let chats = 0; let executes = 0
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({ json: { sessions: [rootSession], total: 1, limit: 200, offset: 0 } }))
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => route.fulfill({ json: { session: {
    ...rootSession, root_orchestration_only: durable, root_mode_transition_epoch: epoch, root_mode_birth_token: birthToken,
  } } }))
  await page.route(`**/api/v1/task/${sessionId}`, (route) => route.fulfill({ json: { session_id: sessionId, items: [] } }))
  await page.route(`**/api/v1/sessions/${sessionId}/root-mode-operations/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.split("/")
    const recovering = path.at(-1) === "recover"
    const id = decodeURIComponent(path.at(recovering ? -2 : -1)!)
    const body = route.request().postDataJSON() as Record<string, unknown>
    expect(body).toEqual({ birth_token: birthToken, expected_epoch: 0, enabled: false })
    if (recovering) {
      recoveries += 1
      return terminal ? route.fulfill({ json: terminal }) : route.fulfill({ status: 503,
        json: { error: { code: "root_mode_outcome_unconfirmed", message: "Retry recovery" } } })
    }
    selects += 1; await route.abort("timedout")
    setTimeout(() => {
      durable = false; epoch = 1
      terminal = { status: "committed", operation_id: id, expected_epoch: 0, resulting_epoch: 1,
        enabled_at_completion: false, root_tool_authority_revision: 2 }
    }, 250)
  })
  await page.route("**/api/v1/chat", (route) => {
    chats += 1; expect(route.request().postDataJSON().root_orchestration_only).toBeUndefined()
    return route.fulfill({ json: { session_id: sessionId, status: "success" } })
  })
  await page.route(`**/api/v1/execute/${sessionId}`, (route) => {
    executes += 1; return route.fulfill({ json: { status: "started", session_id: sessionId } })
  })
  await page.goto(standaloneScenario.entryUrl)
  const mode = page.getByRole("checkbox", { name: "Root 仅编排模式" })
  const composer = page.getByRole("textbox", { name: "消息", exact: true })
  await expect(mode).toBeChecked(); await mode.click()
  await expect(page.getByRole("status").filter({ hasText: "权限结果未知" })).toBeVisible()
  await expect(mode).toBeDisabled(); await expect(page.getByRole("button", { name: "恢复切换" })).toBeVisible()
  await composer.fill("keep draft while recovering")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect(composer).toHaveValue("keep draft while recovering")
  expect(chats).toBe(0); expect(executes).toBe(0)
  const uncertainScreenshot = testInfo.outputPath("root-mode-uncertain.png")
  await page.screenshot({ path: uncertainScreenshot })
  await testInfo.attach("root-mode-uncertain", { path: uncertainScreenshot, contentType: "image/png" })
  await expect.poll(() => terminal !== null).toBe(true)
  await page.reload()
  await expect(page.getByRole("status").filter({ hasText: "服务器已关闭" })).toBeVisible()
  await expect(mode).toBeEnabled(); expect(selects).toBe(1); expect(recoveries).toBeGreaterThanOrEqual(2)
  expect(chats).toBe(0); expect(executes).toBe(0)
  await composer.fill("continue after terminal recovery")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chats).toBe(1); await expect.poll(() => executes).toBe(1)
  expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  const recoveredScreenshot = testInfo.outputPath("root-mode-recovered-after-reload.png")
  await page.screenshot({ path: recoveredScreenshot })
  await testInfo.attach("root-mode-recovered-after-reload", { path: recoveredScreenshot, contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
})

test("every concurrent pending operation needs its own terminal recovery", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "multi-operation persistence boundary")
  const ids = ["0:12345678-1234-1234-1234-123456789abc", "0:87654321-4321-4321-4321-cba987654321"]
  await page.addInitScript(({ sessionId, birthToken, ids }) => {
    localStorage.setItem("bodhi_onboarded_v1", "1"); localStorage.setItem("lotus_next_last_session", sessionId)
    for (const operationId of ids) {
      localStorage.setItem(`lotus-next.root-mode-operation.v2.${sessionId}.${operationId}`, JSON.stringify({
        version: 2, operationId, expectedEpoch: 0, birthToken, enabled: false,
      }))
    }
  }, { sessionId, birthToken, ids })
  await installArtifactRuntime(page, standaloneScenario)
  let recoveries = 0; let mutations = 0; let firstOperationId = ""
  let releaseSecond: (() => void) | null = null
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => route.fulfill({ json: { session: {
    ...rootSession, root_orchestration_only: true, root_mode_transition_epoch: 1, root_mode_birth_token: birthToken,
  } } }))
  await page.route(`**/api/v1/sessions/${sessionId}/root-mode-operations/**`, async (route) => {
    const segments = new URL(route.request().url()).pathname.split("/")
    expect(segments.at(-1)).toBe("recover")
    const operationId = decodeURIComponent(segments.at(-2)!)
    expect(route.request().postDataJSON()).toEqual({ birth_token: birthToken, expected_epoch: 0, enabled: false })
    recoveries += 1
    expect(ids).toContain(operationId)
    if (recoveries === 1) {
      firstOperationId = operationId
      return route.fulfill({ json: {
        status: "fenced", operation_id: operationId, expected_epoch: 0, resulting_epoch: 1,
        enabled_at_completion: true, root_tool_authority_revision: 1,
      } })
    }
    expect(operationId).not.toBe(firstOperationId)
    await new Promise<void>((resolve) => { releaseSecond = resolve })
    return route.fulfill({ json: { status: "fenced_by_successor", operation_id: operationId,
      expected_epoch: 0, current_epoch: 1, current_enabled: true, root_tool_authority_revision: 1 } })
  })
  await page.route("**/api/v1/chat", (route) => { mutations += 1; return route.abort() })
  await page.route(`**/api/v1/execute/${sessionId}`, (route) => { mutations += 1; return route.abort() })
  await page.goto(standaloneScenario.entryUrl)
  await expect.poll(() => recoveries).toBe(2)
  const mode = page.getByRole("checkbox", { name: "Root 仅编排模式" })
  await expect(mode).toBeDisabled()
  expect(await page.evaluate((id) => Object.keys(localStorage).filter((key) => key.startsWith(`lotus-next.root-mode-operation.v2.${id}.`)), sessionId))
    .toEqual([`lotus-next.root-mode-operation.v2.${sessionId}.${ids.find((id) => id !== firstOperationId)}`])
  const composer = page.getByRole("textbox", { name: "消息", exact: true })
  await composer.fill("wait for both operation proofs")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect(composer).toHaveValue("wait for both operation proofs"); expect(mutations).toBe(0)
  releaseSecond!()
  await expect(page.getByRole("status").filter({ hasText: "服务器已启用" })).toBeVisible()
  await expect(mode).toBeEnabled(); await expect(mode).toBeChecked()
  expect(await page.evaluate((id) => Object.keys(localStorage).filter((key) => key.startsWith(`lotus-next.root-mode-operation.v2.${id}.`)), sessionId)).toEqual([])
  expect(mutations).toBe(0)
})

test("a legacy combined-chat marker remains fail closed", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "legacy migration boundary")
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1"); localStorage.setItem("lotus_next_last_session", id)
    localStorage.setItem(`lotus-next.root-mode-transition.v1.${id}`, JSON.stringify({ id: "legacy", requested: false }))
  }, sessionId)
  await installArtifactRuntime(page, standaloneScenario)
  let mutations = 0
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => route.fulfill({ json: { session: {
    ...rootSession, root_orchestration_only: true, root_mode_transition_epoch: 0, root_mode_birth_token: birthToken,
  } } }))
  await page.route("**/api/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (route.request().method() === "POST" && (pathname === "/api/v1/chat"
      || pathname === `/api/v1/execute/${sessionId}` || pathname.includes("/root-mode-operations/"))) {
      mutations += 1; return route.abort()
    }
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByText(/旧版聊天模式切换没有可恢复的请求身份/)).toBeVisible()
  await expect(page.getByRole("checkbox", { name: "Root 仅编排模式" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "恢复切换" })).toHaveCount(0)
  const composer = page.getByRole("textbox", { name: "消息", exact: true })
  await composer.fill("blocked legacy request"); await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect(composer).toHaveValue("blocked legacy request"); expect(mutations).toBe(0)
})
