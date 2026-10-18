import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
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
    submissions: [], sections: ["assignments", "requests", "submissions"],
    assignments: [{ id: "assignment-" + id, work_id: id, generation: 1, contract_revision: 1,
      state: "blocked", runtime: { session_id: "work-session-" + id, run_id: "run-" + id } }],
  }))
  const scopeOverview = { snapshot: stamp, index_seq: 10, coverage: "authoritative_scope", truncated: false, omitted_count: 0, next_cursor: null,
    data: { ticket_count: 3, work_count: 3, states: { blocked: 2, accepted: 1 }, open_questions: 1, open_approvals: 1, needs_acceptance: 0 } }
  const snapshot: TicketSnapshot = { snapshot: stamp, views, complete: true, scope: {
    available: true, mutation_enabled: true, dispatch_enabled: true, health: "writable",
    binding: { scope_id: "scope", supervisor_session_id: supervisor, binding_revision: 1 }, overview: scopeOverview,
    capabilities: { ticket_scope_v1: true, multi_pending_v1: true, precise_request_response_v1: true, message_references_v1: true, semantic_messages_v1: true },
  } }
  const [question, approval, completed] = snapshot.views
  question.ticket.contract.objective = "核对报告结论并等待用户选择颜色"
  approval.requests[0].kind = { kind: "approval", fingerprint: "exact-fingerprint", action: {
    kind: "file_write", target: "README.md", amount: null, data_hash: "b".repeat(64), permissions: ["Write"], risk: "修改共享文档",
  } }
  approval.requests[0].prompt = "允许更新 README 吗？"
  completed.requests = []; completed.ticket.state = "accepted"; completed.ticket.blocked = null
  completed.ticket.active_assignment = null
  completed.assignments![0].state = "submitted"; completed.assignments![0].process_stopped = true
  completed.ticket.accepted_submission = opaque
  completed.ticket.contract.title = "代码交付"
  completed.ticket.contract.objective = "Read /private/internal/worktree/answer.rs"
  completed.submissions = [{ id: opaque, assignment_id: "assignment-C", work_id: completed.ticket.id, generation: 1, contract_revision: 1,
    stale: false, updated_seq: 10, artifacts: [{ uri: "managed:result.rs", sha256: hash }], evidence: [`canonical Child ${opaque}; sha256 ${hash}`] }]
  Object.assign(snapshot.scope.overview.data, { work_count: 3, ticket_count: 3, open_questions: 1, open_approvals: 1, needs_acceptance: 0 })
  const decisions: unknown[] = []
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, supervisor)
  const observation = await installArtifactRuntime(page, standaloneScenario, [], { bootstrapRequestState: "local_bypass" })
  const childId = "supervisor-child"
  const actor = actorSnapshotFixture(supervisor, 1, `at1-${"a".repeat(64)}-7`)
  Object.assign(actor.nodes[1], { actor_id: childId, title: "核对证据", logical_state: "cold",
    activation: { activation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", attempt: 1, status: "succeeded" } })
  const history = [
    { id: "sup-user", role: "user", content: "核对交付证据", created_at: "2026-10-05T00:00:00Z" },
    { id: "sup-create", role: "assistant", content: "", created_at: "2026-10-05T00:00:01Z", tool_calls: [
      { id: "sup-create-call", function: { name: "sub_agent", arguments: JSON.stringify({ action: "create", title: "核对证据" }) } }] },
    { id: "sup-created", role: "tool", tool_call_id: "sup-create-call", tool_success: true,
      content: JSON.stringify({ child_session_id: childId, parent_session_id: supervisor }), created_at: "2026-10-05T00:00:02Z" },
    { id: "sup-answer", role: "assistant", content: "已核对证据", created_at: "2026-10-05T00:00:03Z" },
    { id: "sup-later", role: "user", content: "查看工作进展", created_at: "2026-10-05T00:00:04Z" },
    { id: "sup-task-list", role: "assistant", content: "", created_at: "2026-10-05T00:00:05Z", tool_calls: [
      { id: "task-list", function: { name: "TaskList", arguments: "{}" } }] },
  ]
  const session = { id: supervisor, title: "Supervisor", title_version: 1, kind: "root", root_session_id: supervisor,
    parent_session_id: null, spawn_depth: 0, pinned: false, model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z", message_count: 0, is_running: false,
    root_orchestration_only: true, thinking_mode: "ultra", root_tool_authority_revision: 1,
    root_mode_transition_epoch: 1, root_mode_birth_token: "a".repeat(64), subagent_count: 1 }
  const child = { id: childId, title: "核对证据", title_version: 1, kind: "child", parent_session_id: supervisor,
    root_session_id: supervisor, spawn_depth: 1, pinned: false, subagent_count: 0, is_running: true, last_run_status: "completed",
    model: "fixture-model", model_ref: session.model_ref, created_at: session.created_at, updated_at: session.updated_at, message_count: 0 }
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    const envelope = (data: unknown) => ({ ...snapshot.scope.overview, data })
    if (path === "/api/v1/sessions" && request.method() === "GET") {
      const kind = new URL(request.url()).searchParams.get("kind")
      const sessions = [session, child].filter((row) => !kind || row.kind === kind)
      await route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
    }
    else if (path === `/api/v1/actors/${supervisor}/snapshot`) await route.fulfill({ json: actor })
    else if (path === `/api/v1/sessions/${childId}`) await route.fulfill({ json: { session: child } })
    else if (path === `/api/v1/sessions/${supervisor}`) await route.fulfill({ json: request.method() === "GET" ? { session } : {} })
    else if (path === `/api/v1/history/${supervisor}`) await route.fulfill({ json: { session_id: supervisor, messages: history } })
    else if (path === `/api/v1/respond/${supervisor}/pending`) await route.fulfill({ json: { has_pending_question: false } })
    else if (path === "/api/v1/tickets/scope") await route.fulfill({ json: snapshot.scope })
    else if (path === "/api/v1/tickets/search") await route.fulfill({ json: envelope(snapshot.views.map((v) => ({ id: v.ticket.id, kind: "work" }))) })
    else if (path === "/api/v1/tickets/inspect") {
      expect(request.postDataJSON().sections).toEqual(["assignments", "requests", "submissions"])
      await route.fulfill({ json: envelope(snapshot.views.filter((v) => request.postDataJSON().ids.includes(v.ticket.id))) })
    }
    else if (path === "/api/v1/tickets/changes") await route.fulfill({ json: envelope([]) })
    else if (path === `/api/v1/tickets/artifacts/${hash}`) await route.fulfill({ body: "pub fn answer() -> u8 { 42 }\n", contentType: "text/plain" })
    else if (path === "/api/v1/tickets/requests/respond") {
      const command = request.postDataJSON(); decisions.push(command)
      await route.fulfill({ json: { operation_id: command.operation_id, committed_seq: command.expected_seq + 1 } })
    } else await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  const childCard = page.locator(`[data-subagent-id="${childId}"]`).first()
  await expect(childCard).toHaveAttribute("data-subagent-status", "done")
  const childToggle = childCard.locator("[data-subagent-toggle]")
  await childToggle.click()
  await expect(childToggle).toHaveAttribute("aria-expanded", "true")
  const childOrigin = () => childCard.evaluate((node) => node.closest("[data-history-entry-key]")?.getAttribute("data-history-entry-key"))
  await expect.poll(childOrigin).toBe("activity-sup-create")
  const status = page.getByTestId("ticket-work-status")
  await expect(status).toContainText("3 项工作")
  await expect(status).toContainText("2 项待处理")
  await expect(page.getByTestId("ticket-work-overview")).toHaveCount(0)
  expect(observation.staticUrls.some((url) => /TicketWorkPanel-.*\.js/.test(url))).toBe(false)
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
  expect(observation.staticUrls.some((url) => /TicketWorkPanel-.*\.js/.test(url))).toBe(true)
  await expect(overview.getByText("代码交付", { exact: true })).toBeHidden()
  await expect(overview).toBeFocused()
  await expectComposerText(composer, "保留我的输入")
  await expect(overview).toContainText(question.ticket.contract.objective)
  await expect(overview).toContainText("work-session-A")
  await expect(overview).toContainText("最近快照中的执行状态")
  await expect(overview).toContainText("跨会话长程控制暂不可用")
  await expect(childCard).toHaveAttribute("data-subagent-status", "done")
  await expect(childToggle).toHaveAttribute("aria-expanded", "true")
  await expect.poll(childOrigin).toBe("activity-sup-create")
  await expect(overview.getByRole("button", { name: /启动循环|修改循环|停止循环/ })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("supervisor-managed-execution.png") })
  const text = await overview.innerText()
  expect(text).not.toContain(opaque); expect(text).not.toContain(hash); expect(text).not.toContain("/private/internal")
  const input = overview.getByRole("textbox", { name: "回答 报告A" })
  await input.fill("蓝色")
  await workbench.getByRole("button", { name: "收起工作面板", exact: true }).click()
  await expect(workbench).toBeHidden()
  await status.click()
  await popover.getByRole("button", { name: /代码交付.*读取成果 1/ }).click()
  await expect(overview.getByText("代码交付", { exact: true })).toBeVisible()
  await expect(overview).toContainText("work-session-C")
  await expect(overview).toContainText("执行进程已确认结束")
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
