import { expect, test, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

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

test("Solid Supervisor inbox anchors deduplicated approvals and decides only the reviewed revision", async ({ page, baseURL, isMobile }) => {
  const entryUrl = new URL("/", baseURL).href
  const supervisorId = "bamboo-default-supervisor"
  const supervisor = { ...session(supervisorId), title: "Bodhi" }
  const worker = { ...session(sideId), title: "Sprint verification", supervisor_managed: true }
  const other = { ...session("other-approval"), title: "Unrelated deployment", supervisor_managed: true }
  const supervisorHistory = Array.from({ length: 6 }, (_, index) => ({
    id: "older-supervisor-message-" + index,
    role: index % 2 === 0 ? "user" : "assistant",
    content: [`Earlier Supervisor message ${index}`, "The previous task has a separate execution session."].join("\n\n"),
    created_at: at,
  }))
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, worker.id)
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  let generation = 0, reads = 0, subscribed = false
  let otherPending = false
  let readStatus = 404
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
      if (readStatus !== 200) return route.fulfill({ status: readStatus, json: { error: "Fixture approval endpoint" } })
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
            policy_revision: shell ? 7 : 8, tool_name: shell ? "exec_command" : "Write",
            permission_type: shell ? "execute_command" : "write_file", resource,
            operation_summary: (shell ? "Execute command: " : "Write file: ") + resource,
            allowed_decisions: shell ? ["allow_once", "deny_once"] : ["allow_once", "allow_session", "deny_once"],
            suggested_matchers: [{ id: "exact_resource", kind: "exact_resource" }],
          },
        },
      }] : []
      if (approvals[0]) approvals.push(structuredClone(approvals[0]))
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

  await page.goto(entryUrl)
  await expect(page.getByRole("heading", { name: worker.title, exact: true })).toBeVisible()
  expect(reads).toBe(0)
  const openSupervisor = async () => {
    if (isMobile) {
      await page.getByRole("button", { name: "菜单", exact: true }).click()
    }
    await page.locator("aside").first().getByRole("button", { name: "Bodhi", exact: true }).click()
  }
  await openSupervisor()
  await expect.poll(() => subscribed && reads > 0).toBe(true)
  await expect(page.locator("[data-virtual-history]")).toBeVisible()
  await expect(page.locator("[data-supervisor-approval-error]")).toHaveCount(0)
  generation = 1
  otherPending = true
  readStatus = 503
  socket!.send(JSON.stringify({ ch: "feed", seq: 1, event: {
    seq: 1, ts: at, session_id: worker.id, event: { type: "need_clarification" },
  } }))
  const timeline = page.locator("[data-chat-body]")
  const failedRead = timeline.locator("[data-supervisor-approval-error]")
  await expect(failedRead).toContainText("无法读取待审批请求。")
  readStatus = 200
  await failedRead.getByRole("button", { name: "刷新请求", exact: true }).click()
  const card = timeline.getByRole("article", { name: worker.title, exact: true })
  const otherCard = timeline.getByRole("article", { name: other.title, exact: true })
  await expect(card).toHaveCount(1)
  const cardRow = card.locator("xpath=ancestor::*[@data-history-entry-key][1]")
  await expect(cardRow).toHaveAttribute("data-history-entry-key", /^timeline-/)
  const anchorRow = cardRow.locator(
    "xpath=preceding-sibling::*[@data-history-entry-key and not(starts-with(@data-history-entry-key, 'timeline-'))][1]",
  )
  await expect(anchorRow.locator(`[data-message-row="${supervisorHistory.at(-1)!.id}"]`)).toHaveCount(1)
  await expect(card).toContainText("git status --short")
  await expect(card).toContainText("/workspace/bamboo")
  await expect(card).not.toContainText("起可交给 Supervisor 处理")
  await expect(otherCard).toContainText("deploy fixture")
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
  expect(decisions).toEqual([
    { request_id: "same-tool-call", request_generation: "generation-1", expected_policy_revision: 7, decision: "allow_once" },
    { request_id: "same-tool-call", request_generation: "generation-2", expected_policy_revision: 8,
      decision: "allow_session", matcher_id: "exact_resource" },
  ])
  expect(observation.pageErrors).toEqual([])
})
