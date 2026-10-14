import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { modelEffortPicker, selectEffort } from "./support/modelEffortPicker.js"
import { expectComposerText } from "./support/composer.js"

const supervisor = "bamboo-default-supervisor"
const incarnation = "11111111-1111-4111-8111-111111111111"
const birth = "a".repeat(64)
const legacyReason = "authority_unavailable: existing Supervisor needs explicit attach/import; no automatic takeover"

async function fixture(page: Page, initial: string) {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, supervisor)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const snapshot = { scope: {
    available: true, mutation_enabled: true, dispatch_enabled: true, health: "writable",
    binding: { scope_id: "supervisor/" + incarnation, supervisor_session_id: supervisor, binding_revision: 1 },
    capabilities: { ticket_scope_v1: true, multi_pending_v1: true, precise_request_response_v1: true, semantic_messages_v1: true, message_references_v1: true },
    overview: { snapshot: { seq: 0, authority_epoch: 1, commit: "fixture-empty" }, index_seq: 0,
      coverage: "authoritative_scope", truncated: false, omitted_count: 0, next_cursor: null,
      data: { ticket_count: 0, work_count: 0, states: {}, open_questions: 0, open_approvals: 0, needs_acceptance: 0 } },
  } }
  let current = initial, ultra = true, epoch = 1
  let bindingRevision = initial.startsWith("v1-") ? 41 : 1
  let storedRevision = bindingRevision
  let initializeOutcome = "created"
  const initializeCalls: unknown[] = []
  let initializationHold: Promise<void> | null = null
  let canonicalHold: Promise<void> | null = null
  const scopeV1 = () => {
    const ready = current === "v1-ready" || current === "v1-read-only"
    const cause = !ultra ? ["forbidden", "supervisor_mode_required"]
      : ready && storedRevision !== bindingRevision ? ["forbidden", "scope_binding_mismatch"]
      : current === "v1-disabled" ? ["disabled", "ticket_mutation_disabled"]
      : current === "v1-stale" ? ["forbidden", "scope_binding_mismatch"]
      : current === "v1-recovery" ? ["error", "scope_requires_recovery"]
      : current === "v1-io" ? ["error", "scope_io_error"]
      : current === "v1-identity" ? ["forbidden", "supervisor_identity_mismatch"]
      : ready ? ["ready", "scope_ready"] : ["uninitialized", "scope_uninitialized"]
    const readable = cause[0] === "ready"
    const canInitialize = current === "v1-uninitialized" && ultra
    return { ...(readable ? snapshot.scope : {}), available: readable, readable,
      reason: readable ? undefined : "v1 fixture service detail",
      availability: { kind: cause[0], reason_code: cause[1] },
      mutation_enabled: current !== "v1-disabled" && current !== "v1-read-only", dispatch_enabled: current !== "v1-read-only",
      capabilities: { ...snapshot.scope.capabilities, scope_initialize_v1: current !== "v1-no-capability" },
      ...(readable ? { binding: { ...snapshot.scope.binding, binding_revision: storedRevision } } : {}),
      can_initialize: canInitialize,
      initialization: canInitialize ? { supervisor_session_id: supervisor, incarnation_id: incarnation, binding_revision: bindingRevision } : null,
    }
  }
  let ordinary: string | null = "high"
  const ordinaryPatches: unknown[] = []
  const writes: string[] = []
  const session = () => ({ id: supervisor, title: "Supervisor", title_version: 1, kind: "root", root_session_id: supervisor,
    parent_session_id: null, spawn_depth: 0, pinned: false, model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" }, created_at: "2026-10-05T00:00:00Z",
    updated_at: "2026-10-05T00:00:00Z", message_count: 0, is_running: false, root_orchestration_only: ultra,
    thinking_mode: ultra ? "ultra" : "standard", root_tool_authority_revision: bindingRevision, root_mode_transition_epoch: epoch,
    root_mode_birth_token: birth, reasoning_effort: ordinary })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== "GET") writes.push(path)
    if (path === "/api/v1/sessions" && request.method() === "GET") return route.fulfill({ json: { sessions: [session()], total: 1, limit: 200, offset: 0 } })
    if (path === `/api/v1/sessions/${supervisor}`) {
      if (request.method() === "PATCH") {
        const patch = request.postDataJSON(); ordinaryPatches.push(patch)
        expect(patch).toEqual({ clear_reasoning_effort: true }); ordinary = null
      }
      return route.fulfill({ json: request.method() === "GET" ? { session: session() } : {} })
    }
    if (path === `/api/v1/history/${supervisor}`) return route.fulfill({ json: { session_id: supervisor, messages: [] } })
    if (path === `/api/v1/respond/${supervisor}/pending`) return route.fulfill({ json: { has_pending_question: false } })
    if (path === "/api/v1/tickets/initialize") {
      const command = request.postDataJSON(); initializeCalls.push(command)
      expect(request.method()).toBe("POST")
      expect(command).toEqual({ supervisor_session_id: supervisor, incarnation_id: incarnation, binding_revision: bindingRevision })
      if (initializationHold) await initializationHold
      if (!ultra || command.binding_revision !== bindingRevision) return route.fulfill({ status: 409,
        json: { error: "scope binding changed", code: "scope_binding_mismatch", scope: scopeV1() } })
      if (initializeOutcome === "denied") {
        current = "forbidden"
        return route.fulfill({ status: 403, json: { error: "owner initialization denied" } })
      }
      if (["recovery", "stale", "disabled"].includes(initializeOutcome)) {
        current = "v1-" + initializeOutcome
        const code = initializeOutcome === "recovery" ? "scope_requires_recovery"
          : initializeOutcome === "stale" ? "scope_binding_mismatch" : "ticket_mutation_disabled"
        return route.fulfill({ status: initializeOutcome === "disabled" ? 503 : 409,
          json: { error: "explicit initialization refusal", code, scope: scopeV1() } })
      }
      current = initializeOutcome === "conflict" ? "v1-read-only" : "v1-ready"; storedRevision = bindingRevision
      if (["conflict", "stale-readable"].includes(initializeOutcome)) return route.fulfill({ status: 409,
        json: { error: "another owner initialized this scope", code: initializeOutcome === "conflict" ? "initialization_conflict" : "scope_binding_mismatch", scope: scopeV1() } })
      if (initializeOutcome === "unknown") return route.abort("failed")
      return route.fulfill({ json: { created: initializeOutcome === "malformed" ? "yes" : initializeOutcome !== "existing", scope: scopeV1() } })
    }
    if (path === "/api/v1/tickets/scope") {
      if (current.startsWith("v1-")) {
        if (current === "v1-ready" && canonicalHold) await canonicalHold
        return route.fulfill({ json: scopeV1() })
      }
      if (current === "forbidden" || current === "error") return route.fulfill({ status: current === "forbidden" ? 403 : 503, json: { error: { type: "api_error", message: "availability fixture failure" } } })
      if (current === "unsupported") return route.fulfill({ status: 404, json: { error: "unsupported endpoint" } })
      if (current === "uninitialized" || current === "disabled") return route.fulfill({ json: { available: false,
        reason: current === "uninitialized" ? legacyReason : "authority_unavailable: Ticket mutation feature is disabled",
        mutation_enabled: current !== "disabled", dispatch_enabled: false } })
      return route.fulfill({ json: { ...snapshot.scope, binding: { ...snapshot.scope.binding, supervisor_session_id: current === "unbound" ? "other-session" : supervisor },
        mutation_enabled: current !== "read-only", dispatch_enabled: current !== "read-only" } })
    }
    if (path === "/api/v1/tickets/search" || path === "/api/v1/tickets/changes") return route.fulfill({ json: { ...snapshot.scope.overview, data: [] } })
    if (path.includes(`/sessions/${supervisor}/root-mode-operations/`)) {
      const body = request.postDataJSON() as { enabled: boolean; expected_epoch: number }
      expect(body.expected_epoch).toBe(epoch); ultra = body.enabled
      bindingRevision += 1
      const operation = decodeURIComponent(path.split("/").at(-1)!)
      return route.fulfill({ json: { status: "committed", operation_id: operation, expected_epoch: epoch, resulting_epoch: ++epoch,
        enabled_at_completion: ultra, thinking_mode_at_completion: ultra ? "ultra" : "standard", root_tool_authority_revision: bindingRevision } })
    }
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  return { observation, writes, ordinaryPatches, initializeCalls, setStatus: (next: string) => { current = next },
    setInitializeOutcome: (next: string) => { initializeOutcome = next },
    holdInitialization: () => { let release!: () => void; initializationHold = new Promise((resolve) => { release = resolve }); return release },
    holdCanonicalRead: () => { let release!: () => void; canonicalHold = new Promise((resolve) => { release = resolve }); return release },
  }
}

async function openWork(page: Page) {
  await page.locator('button[aria-controls="right-workbench"]').click()
  const workbench = page.locator("#right-workbench")
  await workbench.getByRole("button", { name: "打开工作面板标签页", exact: true }).click()
  await page.getByRole("menuitem", { name: "工作", exact: true }).click()
  await expect(page.getByRole("menu")).toHaveCount(0)
  return workbench
}

for (const [status, message] of [
  ["uninitialized", "此 Supervisor 尚未初始化工作范围"], ["disabled", "此服务尚未启用工作功能"],
  ["unbound", "工作面板未绑定到此会话"], ["unsupported", "此服务未提供工作面板所需能力"],
  ["forbidden", "查看工作需要已验证的所有者访问权限"], ["error", "无法确认工作面板状态"],
] as const) {
  test(`Supervisor Work ${status} retains cause and explicitly re-reads a ready empty scope`, async ({ page }, testInfo) => {
    const runtime = await fixture(page, status)
    const picker = modelEffortPicker(page)
    await expect(picker).toContainText("Ultra")
    const composer = page.getByRole("textbox", { name: "消息", exact: true })
    await composer.fill("保留我的任务草稿")
    const workbench = await openWork(page)
    const availability = workbench.getByTestId("ticket-work-availability")
    await expect(availability).toContainText(message)
    await expect(workbench).not.toContainText("当前 Supervisor 暂不支持工作面板")
    if (["uninitialized", "disabled", "forbidden", "error", "unsupported"].includes(status)) {
      await availability.getByText("服务详情", { exact: true }).click()
      if (status === "uninitialized") await expect(availability).toContainText(legacyReason)
    }
    await page.screenshot({ path: testInfo.outputPath(`work-${status}.png`) })
    runtime.setStatus("ready")
    await availability.getByRole("button", { name: "重新读取", exact: true }).click()
    await expect(workbench.getByTestId("ticket-work-overview")).toContainText("此工作范围还没有记录工作")
    if (status === "uninitialized") await page.screenshot({ path: testInfo.outputPath("work-empty-after-check.png") })
    await workbench.getByRole("button", { name: "收起工作面板", exact: true }).click()
    await expectComposerText(composer, "保留我的任务草稿")
    expect(runtime.writes.every((path) => ["/api/v1/tickets/search", "/api/v1/tickets/changes"].includes(path))).toBe(true)
    expect(runtime.observation.pageErrors).toEqual([])
  })
}

test("Supervisor Work remains uninitialized across Ultra exit/entry and keeps the task draft", async ({ page }, testInfo) => {
  const runtime = await fixture(page, "uninitialized")
  await expect(modelEffortPicker(page)).toContainText("Ultra")
  const composer = page.getByRole("textbox", { name: "消息", exact: true })
  await composer.fill("模式切换保留草稿")
  await expectComposerText(composer, "模式切换保留草稿")
  const workbench = await openWork(page)
  await expect(workbench).toContainText("此 Supervisor 尚未初始化工作范围")
  await workbench.getByRole("button", { name: "收起工作面板", exact: true }).click()
  await selectEffort(page, "自动")
  await expect(modelEffortPicker(page)).not.toContainText("Ultra")
  await selectEffort(page, "Ultra · 编排")
  await expect(modelEffortPicker(page)).toContainText("Ultra")
  await expectComposerText(composer, "模式切换保留草稿")
  await page.locator('button[aria-controls="right-workbench"]').click()
  await expect(workbench).toContainText("此 Supervisor 尚未初始化工作范围")
  await page.screenshot({ path: testInfo.outputPath("work-uninitialized-after-mode-switch.png") })
  expect(runtime.writes.filter((path) => !path.includes("root-mode-operations"))).toEqual([`/api/v1/sessions/${supervisor}`])
  expect(runtime.ordinaryPatches).toEqual([{ clear_reasoning_effort: true }])
  expect(runtime.observation.pageErrors).toEqual([])
})

test("an initialized disabled scope remains readable with no write actions", async ({ page }) => {
  await fixture(page, "read-only")
  const workbench = await openWork(page)
  await expect(workbench).toContainText("此服务已禁用工作变更")
  await expect(workbench).toContainText("此服务已禁用工作派发")
  await expect(workbench).toContainText("此工作范围还没有记录工作")
})

for (const outcome of ["created", "existing"] as const) {
  test(`v1 explicit initialization ${outcome} waits for canonical ready without extra fields or replay`, async ({ page }, testInfo) => {
    const runtime = await fixture(page, "v1-uninitialized")
    runtime.setInitializeOutcome(outcome)
    const releaseInitialize = runtime.holdInitialization(), releaseRead = runtime.holdCanonicalRead()
    await expect(modelEffortPicker(page)).toContainText("Ultra")
    const composer = page.getByRole("textbox", { name: "消息", exact: true })
    await composer.fill("显式初始化保留草稿")
    const workbench = await openWork(page)
    await expect(workbench).toContainText("不导入或关联已有历史")
    const button = workbench.getByRole("button", { name: "初始化空工作范围", exact: true })
    if (outcome === "created") await page.screenshot({ path: testInfo.outputPath("work-v1-initialization-offered.png") })
    await button.click()
    await expect(workbench.getByRole("button", { name: "正在初始化工作…", exact: true })).toBeDisabled()
    await expect.poll(() => runtime.initializeCalls.length).toBe(1)
    releaseInitialize()
    await expect(workbench.getByTestId("ticket-work-overview")).toHaveCount(0)
    await expect(workbench.getByRole("button", { name: "正在初始化工作…", exact: true })).toBeDisabled()
    releaseRead()
    await expect(workbench).toContainText("此工作范围还没有记录工作")
    if (outcome === "created") await page.screenshot({ path: testInfo.outputPath("work-v1-initialized-empty.png") })
    expect(runtime.initializeCalls).toEqual([{ supervisor_session_id: supervisor, incarnation_id: incarnation, binding_revision: 41 }])
    expect(runtime.writes.every((path) => ["/api/v1/tickets/initialize", "/api/v1/tickets/search", "/api/v1/tickets/changes"].includes(path))).toBe(true)
    await workbench.getByRole("button", { name: "收起工作面板", exact: true }).click()
    await expectComposerText(composer, "显式初始化保留草稿")
    expect(runtime.observation.pageErrors).toEqual([])
  })
}

for (const [outcome, message, readable] of [
  ["conflict", "初始化期间工作范围已变化", true], ["stale-readable", "初始化期间工作范围已变化", true],
  ["recovery", "已有工作存储需要审阅后恢复", false],
  ["stale", "已有工作绑定与当前身份或版本不匹配", false], ["disabled", "此服务尚未启用工作功能", false],
  ["denied", "查看工作需要已验证的所有者访问权限", false],
  ["unknown", "无法确认初始化响应", true], ["malformed", "无法确认初始化响应", true],
] as const) {
  test(`v1 initialization ${outcome} preserves refusal and reads canonical state without replay`, async ({ page }) => {
    const runtime = await fixture(page, "v1-uninitialized"); runtime.setInitializeOutcome(outcome)
    const workbench = await openWork(page)
    await workbench.getByRole("button", { name: "初始化空工作范围", exact: true }).click()
    await expect(workbench).toContainText(message)
    if (readable) {
      await expect(workbench).toContainText("此工作范围还没有记录工作")
      await expect(workbench).not.toContainText("离线恢复流程")
    }
    else await expect(workbench.getByTestId("ticket-work-overview")).toHaveCount(0)
    if (outcome === "conflict") {
      await expect(workbench).toContainText("此服务已禁用工作变更")
      await expect(workbench).toContainText("此服务已禁用工作派发")
    }
    await expect(workbench.getByRole("button", { name: "初始化空工作范围", exact: true })).toHaveCount(0)
    expect(runtime.initializeCalls).toHaveLength(1)
    expect(runtime.writes.filter((path) => !["/api/v1/tickets/search", "/api/v1/tickets/changes"].includes(path))).toEqual(["/api/v1/tickets/initialize"])
    expect(runtime.observation.pageErrors).toEqual([])
  })
}

for (const status of ["v1-no-capability", "v1-uninitialized-ineligible"] as const) {
  test(`v1 ${status} never exposes an initialization action`, async ({ page }) => {
    const runtime = await fixture(page, status)
    const workbench = await openWork(page)
    await expect(workbench).toContainText("服务尚未提供可执行的空范围初始化条件")
    await expect(workbench.getByRole("button", { name: "初始化空工作范围", exact: true })).toHaveCount(0)
    expect(runtime.initializeCalls).toEqual([])
  })
}

test("v1 mode switching re-reads eligibility and leaves initialized old binding for reviewed recovery", async ({ page }, testInfo) => {
  const runtime = await fixture(page, "v1-uninitialized")
  await expect(modelEffortPicker(page)).toContainText("Ultra")
  const workbench = await openWork(page)
  await expect(workbench.getByRole("button", { name: "初始化空工作范围", exact: true })).toBeEnabled()
  await workbench.getByRole("button", { name: "收起工作面板", exact: true }).click()
  await selectEffort(page, "自动")
  await expect(modelEffortPicker(page)).not.toContainText("Ultra")
  await page.locator('button[aria-controls="right-workbench"]').click()
  await expect(workbench).toContainText("此工作范围需要 Supervisor 使用 Ultra 模式")
  await expect(workbench.getByRole("button", { name: "初始化空工作范围", exact: true })).toHaveCount(0)
  await workbench.getByRole("button", { name: "收起工作面板", exact: true }).click()
  await selectEffort(page, "Ultra · 编排")
  await expect(modelEffortPicker(page)).toContainText("Ultra")
  await page.locator('button[aria-controls="right-workbench"]').click()
  await workbench.getByRole("button", { name: "初始化空工作范围", exact: true }).click()
  await expect(workbench).toContainText("此工作范围还没有记录工作")
  expect(runtime.initializeCalls).toEqual([{ supervisor_session_id: supervisor, incarnation_id: incarnation, binding_revision: 43 }])
  await workbench.getByRole("button", { name: "收起工作面板", exact: true }).click()
  await selectEffort(page, "自动"); await expect(modelEffortPicker(page)).not.toContainText("Ultra")
  await selectEffort(page, "Ultra · 编排"); await expect(modelEffortPicker(page)).toContainText("Ultra")
  await page.locator('button[aria-controls="right-workbench"]').click()
  await expect(workbench).toContainText("已有工作绑定与当前身份或版本不匹配")
  await expect(workbench).toContainText("离线恢复流程")
  await page.screenshot({ path: testInfo.outputPath("work-v1-old-binding.png") })
  await expect(workbench.getByRole("button", { name: "初始化空工作范围", exact: true })).toHaveCount(0)
  expect(runtime.initializeCalls).toHaveLength(1)
  expect(runtime.observation.pageErrors).toEqual([])
})
