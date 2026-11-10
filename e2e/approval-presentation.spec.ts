import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const mainId = "all-surface-session"
const sideId = "approval-side"
const at = "2026-10-07T00:00:00.000Z"
const session = (id: string) => ({
  id, title: id === mainId ? "Approval main" : "Approval side", title_version: 1,
  kind: "root", pinned: false, parent_session_id: null, root_session_id: id, spawn_depth: 0,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: at, updated_at: at, last_activity_at: at, message_count: 0,
  is_running: false, last_run_status: "completed", permission_mode: "default", bypass_permissions: false,
  root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 0,
  root_mode_birth_token: "a".repeat(64),
})

async function prepare(page: Page, target: string, childApproval = false,
  compatibility?: { parentBlocked?: boolean; childBlocked?: boolean; parentQuestion?: boolean; rejectChildOnce?: "conflict" | "undelivered" }) {
  let childBlocked = compatibility?.childBlocked === true
  let rejectChildOnce = compatibility?.rejectChildOnce
  const report = (blocked: boolean) => ({ session_version: blocked ? 99 : 1, current_session_version: 1,
    status: blocked ? "conflict" : "compatible", history_readable: true, execution_allowed: !blocked,
    conflicts: blocked ? [{ code: "unsupported_session_version", message: "Fixture future version" }] : [] })
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, mainId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let generation = 1
  const decisions: unknown[] = []
  const receiptHistory: unknown[] = []
  const childDecisions: unknown[] = []
  let socket: WebSocketRoute | undefined
  const channels = new Set<string>()
  await page.routeWebSocket(/.*/, (ws) => {
    socket = ws
    ws.onMessage((message) => {
      const frame = JSON.parse(String(message)) as { type: string; ch?: string }
      if (frame.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch) channels.add(frame.ch)
    })
  })
  const pending = () => ({
    has_pending_question: true, interaction_kind: "permission",
    question: `Fixture approval ${generation}: allow this harmless command?`,
    options: ["Approve", "Deny", "Remember forever"], allow_custom: true,
    tool_call_id: `approval-${generation}`,
    permission_request: {
      session_id: target, request_id: `approval-${generation}`, request_generation: `generation-${generation}`,
      policy_revision: 7, tool_name: "Bash", permission_type: "execute_command", resource: "echo fixture",
      operation_summary: "Print a fixture message",
      allowed_decisions: generation === 1 ? ["allow_once", "allow_session", "deny_once", "allow_global"] : ["allow_once", "deny_once"],
      suggested_matchers: [{ id: "exact_resource", kind: "exact_resource" }],
    },
  })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === "/api/v1/sessions") {
      const sessions = [session(mainId), session(sideId)].map((item) => ({ ...item,
        is_running: childApproval && item.id === target,
      }))
      return route.fulfill({ json: { sessions, total: 2, limit: 200, offset: 0 } })
    }
    for (const id of [mainId, sideId]) {
      if (path === `/api/v1/sessions/${id}`) return route.fulfill({
        json: { session: { ...session(id), is_running: childApproval && id === target,
          ...(compatibility ? { execution_compatibility: report(id === target && compatibility.parentBlocked === true) } : {}) } }, headers: { ETag: '"1"' },
      })
      if (path === `/api/v1/history/${id}`) return route.fulfill({
        json: { session_id: id, messages: id === target ? receiptHistory : [] },
      })
      if (path === `/api/v1/task/${id}`) return route.fulfill({ json: { items: [] } })
      if (path === `/api/v1/actors/${id}/snapshot`) return route.fulfill({ json: actorSnapshotFixture(id, 0) })
      if (path === `/api/v1/respond/${id}/pending`) return route.fulfill({
        json: id === target && generation <= 2 && (!childApproval || compatibility?.parentQuestion === true) ? pending() : { has_pending_question: false },
      })
    }
    if (path === `/api/v1/sessions/${target}/permission-decisions`) {
      const decision = request.postDataJSON()
      decisions.push(decision)
      const receipt = { session_id: target, decision }
      receiptHistory.push({ id: "receipt-" + generation, role: "tool", tool_call_id: decision.request_id,
        created_at: at, content: "Fixture result", metadata: {
          permission_request: pending().permission_request, permission_decision_receipt: receipt,
        } })
      generation += 1
      return route.fulfill({ json: { success: true, replayed: false,
        receipt, auto_resume_status: "completed",
        resume: { success: true, auto_resume_status: "completed" },
      } })
    }
    if (path === "/api/v1/sessions/fixture-child") return route.fulfill({ json: {
      session: { ...session("fixture-child"), kind: "child", parent_session_id: target, root_session_id: target,
        execution_compatibility: report(childBlocked) },
    } })
    if (path === "/api/v1/child-approval/fixture-child") {
      childDecisions.push(request.postDataJSON())
      const rejection = rejectChildOnce
      rejectChildOnce = undefined
      if (rejection === "conflict") {
        childBlocked = true
        return route.fulfill({ status: 409, json: { session_id: "fixture-child",
          error: { code: "session_execution_incompatible" }, compatibility: report(true) } })
      }
      return route.fulfill({ json: { delivered: rejection !== "undelivered" } })
    }
    return route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  if (target === sideId) {
    await page.getByRole("button", { name: "打开侧边面板", exact: true }).click()
    const workbench = page.locator("#right-workbench")
    await workbench.getByRole("button", { name: /并排会话.*打开另一个会话/ }).click()
    await workbench.getByRole("combobox").filter({ hasText: "选择会话并排" }).click()
    await page.getByRole("option", { name: "Approval side", exact: true }).click()
  }
  return { observation, decisions, childDecisions, channels, setChildBlocked: (value: boolean) => { childBlocked = value },
    sendChildRequest: (requestId: string, seq: number) => socket!.send(JSON.stringify({
      ch: `agent.${target}`, seq, event: { type: "child_approval_requested", child_session_id: "fixture-child",
        request_id: requestId, tool_name: "Bash", permission: "execute_command", resource: "echo fixture child" },
    })),
  }
}

test("Supervisor shows the actual operation and decides the exact managed request from the chat card", async ({ page }, testInfo) => {
  const supervisorId = "bamboo-default-supervisor"
  const supervisor = { ...session(supervisorId), title: "Bodhi" }
  const worker = { ...session(sideId), title: "Sprint verification", supervisor_managed: true }
  const other = { ...session("other-approval"), title: "Unrelated deployment", supervisor_managed: true }
  const supervisorHistory = Array.from({ length: 24 }, (_, index) => ({
    id: "older-supervisor-message-" + index,
    role: index % 2 === 0 ? "user" : "assistant",
    content: [`Earlier Supervisor message ${index}`, "The previous task has a separate execution session."].join("\n\n"),
    created_at: at,
  }))
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let generation = 0, reads = 0, subscribed = false
  let otherPending = false
  let workerLinkReads: number | null = null
  let socket: WebSocketRoute | undefined
  const decisions: unknown[] = []
  await page.routeWebSocket(/.*/, (ws) => {
    socket = ws
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
      if (frame.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch === "feed") subscribed = true
    })
  })
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/api/v1/sessions") return route.fulfill({ json: {
      sessions: [supervisor, { ...worker, has_pending_question: generation > 0,
        last_run_status: generation > 0 ? "suspended" : "completed" },
      { ...other, has_pending_question: otherPending }], total: 3, limit: 200, offset: 0,
    } })
    if (path === "/api/v1/supervisor/default") return route.fulfill({ json: {
      session_id: supervisorId, incarnation_id: "550e8400-e29b-41d4-a716-446655440000", created: false,
    } })
    if (path === "/api/v1/supervisor/default/approvals") {
      reads += 1
      const shell = generation === 1
      const resource = shell ? "git status --short" : "/workspace/bamboo/review.md"
      const approvals = generation ? [{
        session_id: worker.id, created_at: at, title: worker.title,
        supervisor_handoff_at: shell ? null : at,
        pending: {
          has_pending_question: true, interaction_kind: "permission", question: "Approve the operation?",
          options: [], allow_custom: false, tool_call_id: "same-tool-call",
          tool_arguments: shell ? { cmd: resource, workdir: "/workspace/bamboo" } : { file_path: resource },
          permission_request: {
            session_id: worker.id, request_id: "same-tool-call", request_generation: "generation-" + generation,
            policy_revision: 7, tool_name: shell ? "exec_command" : "Write",
            permission_type: shell ? "execute_command" : "write_file", resource,
            operation_summary: (shell ? "Execute command: " : "Write file: ") + resource,
            allowed_decisions: shell ? ["allow_once", "deny_once"] : ["allow_once", "allow_session", "deny_once"],
            suggested_matchers: [{ id: "exact_resource", kind: "exact_resource" }],
          },
        },
      }] : []
      if (otherPending) approvals.push({
        session_id: other.id, created_at: at, title: other.title, supervisor_handoff_at: null,
        pending: {
          has_pending_question: true, interaction_kind: "permission", question: "Deploy the fixture?",
          options: [], allow_custom: false, tool_call_id: "deploy-once",
          tool_arguments: { cmd: "deploy fixture", workdir: "/workspace/other" },
          permission_request: { session_id: other.id, request_id: "deploy-once", request_generation: "deploy-generation",
            policy_revision: 7, tool_name: "exec_command", permission_type: "execute_command",
            resource: "deploy fixture", operation_summary: "Deploy fixture", allowed_decisions: ["allow_once", "deny_once"],
            suggested_matchers: [] },
        },
      })
      return route.fulfill({ json: { approvals } })
    }
    if (path === "/api/v1/sessions/" + supervisorId) return route.fulfill({ json: { session: supervisor } })
    if (path === "/api/v1/sessions/" + worker.id) {
      const replaced = workerLinkReads !== null && ++workerLinkReads > 1
      return route.fulfill({ json: { session: { ...worker, created_at: replaced ? "2026-10-08T00:00:00.000Z" : at } } })
    }
    if (path === "/api/v1/history/" + supervisorId) return route.fulfill({
      json: { session_id: supervisorId, messages: supervisorHistory },
    })
    if (path === "/api/v1/history/" + worker.id) return route.fulfill({ json: {
      session_id: worker.id, messages: [{ id: "sprint-request", role: "user", content: "Verify the Sprint plan", created_at: at }],
    } })
    if (path === "/api/v1/respond/" + supervisorId + "/pending") return route.fulfill({ json: { has_pending_question: false } })
    if (path === "/api/v1/respond/" + worker.id + "/pending") return route.fulfill({ json: { has_pending_question: false } })
    if (path === "/api/v1/sessions/" + worker.id + "/permission-decisions") {
      const decision = route.request().postDataJSON()
      decisions.push(decision)
      if (generation === 1) {
        generation = 2
        return route.fulfill({ status: 409, json: { error: "Request changed" } })
      }
      generation = 0
      return route.fulfill({ json: { success: true, replayed: false,
        receipt: { session_id: worker.id, decision }, auto_resume_status: "started",
        resume: { success: true, auto_resume_status: "started" },
      } })
    }
    return route.fallback()
  })

  await page.goto(standaloneScenario.entryUrl)
  const openSupervisor = async () => {
    if (testInfo.project.name === "phone-chromium") {
      await page.getByRole("button", { name: "菜单", exact: true }).click()
    }
    await page.locator("aside").first().getByRole("button", { name: "Bodhi", exact: true }).click()
  }
  await openSupervisor()
  await expect.poll(() => subscribed && reads > 0).toBe(true)
  await expect(page.locator("[data-virtual-history]")).toBeVisible()
  generation = 1
  otherPending = true
  socket!.send(JSON.stringify({ ch: "feed", seq: 1, event: {
    seq: 1, ts: at, session_id: worker.id, event: { type: "need_clarification" },
  } }))
  const timeline = page.locator("[data-message-list-content]")
  const card = timeline.getByRole("article", { name: worker.title, exact: true })
  const otherCard = timeline.getByRole("article", { name: other.title, exact: true })
  await expect(card).toContainText("git status --short")
  await expect(card).toContainText("/workspace/bamboo")
  await expect(card.locator("xpath=..")).toHaveAttribute("data-history-entry-key", /^timeline-/)
  await expect(card).not.toContainText("起可交给 Supervisor 处理")
  await expect(otherCard).toContainText("deploy fixture")
  await expect(page.locator("[data-composer-region] [data-approval-presentation]")).toHaveCount(0)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const composer = page.getByRole("textbox", { name: "消息", exact: true })
  await composer.fill("独立的新任务草稿")
  await expect(composer).toBeFocused()
  const workerLink = card.getByRole("button", { name: worker.title, exact: true })
  await workerLink.click()
  await expect(page.getByText("Verify the Sprint plan", { exact: true })).toBeVisible()
  await openSupervisor()
  await expect(card).toBeVisible()
  workerLinkReads = 0
  await workerLink.click()
  await expect(card.getByRole("alert")).toBeVisible()
  await expect(page.getByText("Verify the Sprint plan", { exact: true })).toHaveCount(0)
  expect(workerLinkReads).toBe(2)
  workerLinkReads = null
  await card.getByRole("button", { name: "仅本次允许", exact: true }).click()
  await expect(card.getByRole("alert").filter({ hasText: "请刷新请求后重新确认" })).toBeVisible()
  await expect(card.getByRole("button", { name: "仅本次允许", exact: true })).toBeDisabled()
  await card.getByRole("button", { name: "刷新请求", exact: true }).click()
  await expect(card).toContainText("/workspace/bamboo/review.md")
  await expect(card).toContainText("起可交给 Supervisor 处理")
  await card.getByRole("button", { name: "本会话临时允许此资源", exact: true }).click()
  await expect(card).toContainText("已记录本会话的临时授权 · 会话已继续")
  await expect(card.getByRole("button", { name: "仅本次拒绝", exact: true })).toHaveCount(0)
  await expect(otherCard.getByRole("button", { name: "仅本次允许", exact: true })).toBeEnabled()
  await testInfo.attach("supervisor-approvals-in-timeline", { body: await page.screenshot(), contentType: "image/png" })
  expect(decisions).toEqual([
    { request_id: "same-tool-call", request_generation: "generation-1", expected_policy_revision: 7, decision: "allow_once" },
    { request_id: "same-tool-call", request_generation: "generation-2", expected_policy_revision: 7,
      decision: "allow_session", matcher_id: "exact_resource" },
  ])
  expect(observation.pageErrors).toEqual([])
})

for (const target of [mainId, sideId]) {
  test(`shared typed approval in ${target === mainId ? "main" : "side"} chat ignores held Enter across requests`, async ({ page }, testInfo) => {
    test.skip(target === sideId && testInfo.project.name !== "desktop-chromium", "desktop interactive side pane")
    const fixture = await prepare(page, target)
    const timeline = page.locator("[data-message-list-content]")
    const card = timeline.locator("[data-approval-presentation]").filter({ hasText: /Fixture approval/ })
    const allow = card.getByRole("button", { name: "仅本次允许", exact: true })
    const allowForSession = card.getByRole("button", { name: "本会话临时允许此命令（跨工作目录）", exact: true })
    await expect(card).toContainText("Fixture approval 1")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(card.locator("textarea")).toHaveCount(0)
    await expect(card.getByRole("button")).toHaveCount(4)
    await page.screenshot({ path: testInfo.outputPath(`approval-${target}-${testInfo.project.name}.png`), animations: "disabled" })
    const pane = page.locator(`[data-session-drop-target="${target === sideId ? "secondary" : "main"}"]`)
    await pane.getByRole("textbox", { name: "消息", exact: true }).focus()
    await page.keyboard.down("Enter")
    await allowForSession.focus()
    await page.keyboard.down("Enter")
    await page.keyboard.down("Enter")
    expect(fixture.decisions).toEqual([])
    await page.keyboard.up("Enter")
    await page.keyboard.down("Enter")
    await expect(card).toContainText("Fixture approval 2")
    await expect(allowForSession).toHaveCount(0)
    await allow.focus()
    await page.keyboard.down("Enter")
    await page.keyboard.up("Enter")
    expect(fixture.decisions).toEqual([{ request_id: "approval-1", request_generation: "generation-1",
      expected_policy_revision: 7, decision: "allow_session", matcher_id: "exact_resource" }])
    await card.getByRole("button", { name: "仅本次拒绝", exact: true }).click()
    await expect(card).toHaveCount(0)
    await expect(timeline.getByText("已拒绝 · 会话已继续", { exact: true })).toBeVisible()
    expect(fixture.decisions).toHaveLength(2)
    if (target === mainId) {
      await page.reload({ waitUntil: "domcontentloaded" })
      await expect(timeline.getByText("已记录本会话的临时授权", { exact: true })).toBeVisible()
      await expect(timeline.getByText("已记录拒绝", { exact: true })).toBeVisible()
      await expect(timeline.getByRole("button", { name: "本会话临时允许此命令（跨工作目录）", exact: true })).toHaveCount(0)
    }
    expect(fixture.observation.pageErrors).toEqual([])
    expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  })
}

test("live child approval adapter uses the shared card and keeps its boolean response", async ({ page }, testInfo) => {
  const fixture = await prepare(page, mainId, true)
  await expect.poll(() => fixture.channels.has(`agent.${mainId}`)).toBe(true)
  fixture.sendChildRequest("child-request-1", 1)
  const card = page.locator("[data-approval-presentation]")
  await expect(card).toContainText("子代理请求授权")
  await expect(card).toContainText("echo fixture child")
  await expect(page.locator("[data-message-list-content]").locator("[data-approval-presentation]")).toHaveCount(1)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath(`child-approval-${testInfo.project.name}.png`), animations: "disabled" })
  await page.keyboard.down("Enter")
  await card.getByRole("button", { name: "批准", exact: true }).focus()
  await page.keyboard.down("Enter")
  expect(fixture.childDecisions).toEqual([])
  await page.keyboard.up("Enter")
  await card.getByRole("button", { name: "批准", exact: true }).press("Enter")
  await expect.poll(() => fixture.childDecisions).toEqual([{ request_id: "child-request-1", approved: true }])
  await expect(card).toHaveCount(0)
  expect(fixture.observation.pageErrors).toEqual([])
})


test("approval compatibility is scoped to the Child despite a parent compatibility conflict", async ({ page }, testInfo) => {
  const fixture = await prepare(page, mainId, true, { parentBlocked: true })
  await expect.poll(() => fixture.channels.has(`agent.${mainId}`)).toBe(true)
  fixture.sendChildRequest("child-parent-conflict", 1)
  const card = page.locator("[data-approval-presentation]")
  await expect(card).toContainText("子代理请求授权")
  await expect(page.locator('[data-session-execution-blocked="true"]')).toHaveCount(1)
  expect(fixture.childDecisions).toEqual([]); expect(fixture.decisions).toEqual([])
  await page.screenshot({ path: testInfo.outputPath(`child-parent-conflict-${testInfo.project.name}.png`), animations: "disabled" })
  await card.getByRole("button", { name: "拒绝", exact: true }).click()
  await expect.poll(() => fixture.childDecisions).toEqual([{ request_id: "child-parent-conflict", approved: false }])
  expect(fixture.decisions).toEqual([])
  expect(fixture.observation.pageErrors).toEqual([])
})

test("approval compatibility waits for the Child's explicit conflict recovery without auto-answer", async ({ page }, testInfo) => {
  const fixture = await prepare(page, mainId, true, { childBlocked: true })
  await expect.poll(() => fixture.channels.has(`agent.${mainId}`)).toBe(true)
  fixture.sendChildRequest("child-own-conflict", 1)
  const region = page.getByRole("region", { name: "子代理请求授权", exact: true })
  await expect(region.locator('[data-session-execution-blocked="true"]')).toBeVisible()
  const composer = page.getByRole("textbox", { name: "消息", exact: true }).first()
  expect((await composer.boundingBox())?.width ?? 0).toBeGreaterThan(page.viewportSize()!.width / 2)
  await page.screenshot({ path: testInfo.outputPath(`child-conflict-layout-${testInfo.project.name}.png`), animations: "disabled" })
  await expect(page.locator("[data-approval-presentation]")).toHaveCount(0)
  expect(fixture.childDecisions).toEqual([])
  fixture.setChildBlocked(false)
  await region.getByRole("button", { name: "重新核对兼容性", exact: true }).click()
  const card = page.locator("[data-approval-presentation]")
  await expect(card).toContainText("子代理请求授权")
  expect(fixture.childDecisions).toEqual([])
  await page.screenshot({ path: testInfo.outputPath(`child-own-recovered-${testInfo.project.name}.png`), animations: "disabled" })
  await card.getByRole("button", { name: "批准", exact: true }).click()
  await expect.poll(() => fixture.childDecisions).toEqual([{ request_id: "child-own-conflict", approved: true }])
  expect(fixture.decisions).toEqual([])
  expect(fixture.observation.pageErrors).toEqual([])
})


test("approval compatibility retains a genuine parent question during a Child conflict", async ({ page }, testInfo) => {
  const fixture = await prepare(page, mainId, true, { childBlocked: true, parentQuestion: true })
  await expect.poll(() => fixture.channels.has(`agent.${mainId}`)).toBe(true)
  fixture.sendChildRequest("child-blocked-parent-still-pending", 1)
  // The live parent modal aria-hides the background Child notice.
  await expect(page.locator('section[aria-label="子代理请求授权"] [data-session-execution-blocked="true"]')).toHaveCount(1)
  const card = page.locator("[data-approval-presentation]")
  await expect(card).toContainText("Fixture approval 1")
  expect(fixture.childDecisions).toEqual([]); expect(fixture.decisions).toEqual([])
  await page.screenshot({ path: testInfo.outputPath(`parent-question-child-conflict-${testInfo.project.name}.png`), animations: "disabled" })
  await card.getByRole("button", { name: "仅本次拒绝", exact: true }).click()
  await expect.poll(() => fixture.decisions).toEqual([{ request_id: "approval-1", request_generation: "generation-1",
    expected_policy_revision: 7, decision: "deny_once" }])
  expect(fixture.childDecisions).toEqual([])
  expect(fixture.observation.pageErrors).toEqual([])
})


test("child approval submit refusal retains the request through explicit compatibility recovery", async ({ page }, info) => {
  const fixture = await prepare(page, mainId, true, { rejectChildOnce: "conflict" })
  await expect.poll(() => fixture.channels.has(`agent.${mainId}`)).toBe(true)
  fixture.sendChildRequest("child-submit-refusal", 1)
  const card = page.locator("[data-approval-presentation]")
  await expect(card).toContainText("子代理请求授权")
  await card.getByRole("button", { name: "批准", exact: true }).click()
  const region = page.getByRole("region", { name: "子代理请求授权", exact: true })
  await expect(region.locator('[data-session-execution-blocked="true"]')).toBeVisible()
  await expect(card).toHaveCount(0)
  expect(fixture.childDecisions).toEqual([{ request_id: "child-submit-refusal", approved: true }])
  expect(fixture.decisions).toEqual([])
  await page.screenshot({ path: info.outputPath(`child-submit-conflict-${info.project.name}.png`), animations: "disabled" })
  fixture.setChildBlocked(false)
  await region.getByRole("button", { name: "重新核对兼容性", exact: true }).click()
  await expect(card).toContainText("子代理请求授权")
  expect(fixture.childDecisions).toHaveLength(1)
  await card.getByRole("button", { name: "拒绝", exact: true }).click()
  await expect(card).toHaveCount(0)
  expect(fixture.childDecisions).toEqual([{ request_id: "child-submit-refusal", approved: true },
    { request_id: "child-submit-refusal", approved: false }])
  expect(fixture.observation.pageErrors).toEqual([])
})

test("child approval unconfirmed delivery stays visible until an explicit Human retry", async ({ page }, info) => {
  const fixture = await prepare(page, mainId, true, { rejectChildOnce: "undelivered" })
  await expect.poll(() => fixture.channels.has(`agent.${mainId}`)).toBe(true)
  fixture.sendChildRequest("child-unconfirmed", 1)
  const card = page.locator("[data-approval-presentation]")
  await expect(card).toContainText("子代理请求授权")
  await card.getByRole("button", { name: "批准", exact: true }).click()
  await expect(card.getByRole("alert")).toContainText("提交结果尚未确认")
  await expect(card.getByRole("button", { name: "拒绝", exact: true })).toBeEnabled()
  expect(fixture.childDecisions).toEqual([{ request_id: "child-unconfirmed", approved: true }])
  expect(fixture.decisions).toEqual([])
  await page.screenshot({ path: info.outputPath(`child-approval-unconfirmed-${info.project.name}.png`), animations: "disabled" })
  await card.getByRole("button", { name: "拒绝", exact: true }).click()
  await expect(card).toHaveCount(0)
  expect(fixture.childDecisions).toEqual([{ request_id: "child-unconfirmed", approved: true },
    { request_id: "child-unconfirmed", approved: false }])
  expect(fixture.observation.pageErrors).toEqual([])
})
