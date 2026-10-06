import { expectComposerText } from "./support/composer.js"
import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import type { TicketSnapshot, WorkView } from "../src/services/tickets/types.js"

test("Supervisor floating overview opens focused Work details and preserves drafts, results and exact decisions", async ({ page }, testInfo) => {
  const supervisor = "bamboo-default-supervisor"
  const opaque = "63f417ee-0828-41b6-a40d-21f0ac37cf96"
  const hash = "a".repeat(64)
  const stamp = { seq: 10, authority_epoch: 1, commit: "fixture-10" }
  const views: WorkView[] = ["A", "B", "C"].map((id) => ({
    ticket: { id, kind: "work", state: "blocked", generation: 1, record_revision: 2, contract_revision: 1,
      updated_seq: 5, archived: false, contract: { title: "报告" + id, objective: "独立报告", constraints: [], acceptance: ["证据"] },
      blocked: { reason: "等待用户" }, active_assignment: "assignment-" + id, current_submission: null, accepted_submission: null },
    requests: [{ id: "q-" + id, work_id: id, assignment_id: "assignment-" + id, generation: 1,
      contract_revision: 1, prompt_revision: 1, updated_seq: 5, kind: { kind: "question" }, prompt: "颜色？", status: "open", answer: null }],
    submissions: [],
  }))
  const scopeOverview = { snapshot: stamp, index_seq: 10, coverage: "authoritative_scope", truncated: false, omitted_count: 0, next_cursor: null,
    data: { ticket_count: 3, work_count: 3, states: { blocked: 2, accepted: 1 }, open_questions: 1, open_approvals: 1, needs_acceptance: 0 } }
  const snapshot: TicketSnapshot = { snapshot: stamp, views, complete: true, scope: {
    available: true, mutation_enabled: true, dispatch_enabled: true, health: "writable",
    binding: { scope_id: "scope", supervisor_session_id: supervisor, binding_revision: 1 }, overview: scopeOverview,
    capabilities: { ticket_scope_v1: true, multi_pending_v1: true, precise_request_response_v1: true, message_references_v1: true, semantic_messages_v1: true },
  } }
  const [question, approval, completed] = snapshot.views
  approval.requests[0].kind = { kind: "approval", fingerprint: "exact-fingerprint", action: {
    kind: "file_write", target: "README.md", amount: null, data_hash: "b".repeat(64), permissions: ["Write"], risk: "修改共享文档",
  } }
  approval.requests[0].prompt = "允许更新 README 吗？"
  completed.requests = []; completed.ticket.state = "accepted"; completed.ticket.blocked = null
  completed.ticket.accepted_submission = opaque
  completed.ticket.contract.title = "代码交付"
  completed.ticket.contract.objective = "Read /private/internal/worktree/answer.rs"
  completed.submissions = [{ id: opaque, work_id: completed.ticket.id, generation: 1, contract_revision: 1,
    stale: false, updated_seq: 10, artifacts: [{ uri: "managed:result.rs", sha256: hash }], evidence: [`canonical Child ${opaque}; sha256 ${hash}`] }]
  Object.assign(snapshot.scope.overview.data, { work_count: 3, ticket_count: 3, open_questions: 1, open_approvals: 1, needs_acceptance: 0 })
  const decisions: unknown[] = []
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, supervisor)
  await installArtifactRuntime(page, standaloneScenario)
  const session = { id: supervisor, title: "Supervisor", title_version: 1, kind: "root", root_session_id: supervisor,
    parent_session_id: null, spawn_depth: 0, pinned: false, model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z", message_count: 0, is_running: false }
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    const envelope = (data: unknown) => ({ ...snapshot.scope.overview, data })
    if (path === "/api/v1/sessions" && request.method() === "GET") await route.fulfill({ json: { sessions: [session], total: 1, limit: 200, offset: 0 } })
    else if (path === `/api/v1/sessions/${supervisor}`) await route.fulfill({ json: request.method() === "GET" ? { session } : {} })
    else if (path === `/api/v1/history/${supervisor}`) await route.fulfill({ json: { session_id: supervisor, messages: [] } })
    else if (path === `/api/v1/respond/${supervisor}/pending`) await route.fulfill({ json: { has_pending_question: false } })
    else if (path === "/api/v1/tickets/scope") await route.fulfill({ json: snapshot.scope })
    else if (path === "/api/v1/tickets/search") await route.fulfill({ json: envelope(snapshot.views.map((v) => ({ id: v.ticket.id, kind: "work" }))) })
    else if (path === "/api/v1/tickets/inspect") await route.fulfill({ json: envelope(snapshot.views.filter((v) => request.postDataJSON().ids.includes(v.ticket.id))) })
    else if (path === "/api/v1/tickets/changes") await route.fulfill({ json: envelope([]) })
    else if (path === `/api/v1/tickets/artifacts/${hash}`) await route.fulfill({ body: "pub fn answer() -> u8 { 42 }\n", contentType: "text/plain" })
    else if (path === "/api/v1/tickets/requests/respond") {
      const command = request.postDataJSON(); decisions.push(command)
      await route.fulfill({ json: { operation_id: command.operation_id, committed_seq: command.expected_seq + 1 } })
    } else await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  const status = page.getByTestId("ticket-work-status")
  await expect(status).toContainText("3 项工作")
  await expect(status).toContainText("2 项待处理")
  await expect(page.getByTestId("ticket-work-overview")).toHaveCount(0)
  const popover = page.getByTestId("supervisor-overview")
  const openAll = async () => {
    await status.click()
    await popover.getByRole("button", { name: "查看全部工作", exact: true }).click()
  }
  const composer = page.locator("[data-composer-region] [data-composer-editor]").first()
  await composer.fill("保留我的输入")
  await status.click()
  await expect(popover).toBeVisible()
  await expect(popover).toContainText("最近工作")
  await expect(popover).toContainText("交付成果")
  await expect(popover).toContainText("代码交付")
  const floatingText = await popover.innerText()
  expect(floatingText).not.toContain(opaque); expect(floatingText).not.toContain(hash); expect(floatingText).not.toContain("/private/internal")
  const box = await popover.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await page.screenshot({ path: testInfo.outputPath("supervisor-floating-overview.png") })
  await page.keyboard.press("Escape")
  await expect(popover).toHaveCount(0)
  await expect(status).toBeFocused()
  await expectComposerText(composer, "保留我的输入")
  await status.click()
  await popover.getByRole("button", { name: /报告A/ }).click()
  const workbench = page.locator("#right-workbench")
  const overview = workbench.getByTestId("ticket-work-overview")
  await expect(overview).toBeVisible()
  await expect(overview.getByText("代码交付", { exact: true })).toBeHidden()
  await expect(overview).toBeFocused()
  await expectComposerText(composer, "保留我的输入")
  const text = await overview.innerText()
  expect(text).not.toContain(opaque); expect(text).not.toContain(hash); expect(text).not.toContain("/private/internal")
  const input = overview.getByRole("textbox", { name: "回答 报告A" })
  await input.fill("蓝色")
  await workbench.getByRole("button", { name: "收起工作面板", exact: true }).click()
  await expect(workbench).toBeHidden()
  await status.click()
  await popover.getByRole("button", { name: /代码交付.*读取成果 1/ }).click()
  await expect(overview.getByText("代码交付", { exact: true })).toBeVisible()
  await expect(input).toBeHidden()
  await overview.getByRole("button", { name: "所有工作", exact: true }).click()
  await expect(input).toHaveValue("蓝色")
  await workbench.getByRole("button", { name: "打开工作面板标签页" }).click()
  await page.getByRole("menuitem", { name: /检查器/ }).click()
  await workbench.getByRole("tab", { name: "工作", exact: true }).click()
  await expect(input).toHaveValue("蓝色")
  const approvalCard = page.getByTestId(`ticket-request-${approval.requests[0].id}`)
  await expect(approvalCard).toContainText("README.md")
  await expect(approvalCard).toContainText("修改共享文档")
  await approvalCard.getByRole("button", { name: "批准此动作", exact: true }).click()
  await expect.poll(() => decisions.length).toBe(1)
  expect(decisions[0]).toMatchObject({ target: { request_id: approval.requests[0].id, work_id: approval.ticket.id },
    decision: { kind: "approval", fingerprint: "exact-fingerprint", approve: true } })
  const downloadEvent = page.waitForEvent("download")
  await overview.getByRole("button", { name: "读取成果 1", exact: true }).click()
  const download = await downloadEvent
  expect(await readFile((await download.path())!, "utf8")).toBe("pub fn answer() -> u8 { 42 }\n")
  await page.screenshot({ path: testInfo.outputPath("supervisor-compact-work.png") })
  const delivery = overview.locator("section").filter({ has: page.getByText("代码交付", { exact: true }) })
  await delivery.getByText("提交诊断", { exact: true }).click()
  await expect(overview.getByText(`canonical Child ${opaque}; sha256 ${hash}`, { exact: true })).toBeVisible()
  await delivery.getByText("提交诊断", { exact: true }).click()
  await overview.getByTestId(`ticket-request-${question.requests[0].id}`).locator("..").getByRole("button", { name: "在普通输入中引用此请求" }).click()
  if (testInfo.project.name !== "desktop-chromium") await expect(workbench).toBeHidden()
  await expect(page.getByTestId("ticket-reference")).toContainText("报告A")
  await expect(page.locator("[data-composer-region] [data-composer-editor]").first()).toBeFocused()
  await openAll()
  await expect(input).toHaveValue("蓝色")
})
