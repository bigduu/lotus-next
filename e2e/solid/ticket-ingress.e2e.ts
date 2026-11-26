import { expect, test } from "@playwright/test"
import type { TicketScope, WorkView } from "../../src/services/tickets/types.js"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

test("Solid Supervisor references a Work question without answering it or recovering an unsubmitted reply", async ({ page, baseURL }) => {
  const id = "bamboo-default-supervisor"
  const entryUrl = new URL("/", baseURL).href
  const createdAt = "2026-10-05T00:00:00Z"
  const session = {
    id, title: "Supervisor", kind: "root", root_session_id: id, parent_session_id: null,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    is_running: false, thinking_mode: "ultra", root_orchestration_only: true,
    created_at: createdAt, updated_at: createdAt, root_mode_transition_epoch: 0,
    root_mode_birth_token: "a".repeat(64), permission_mode: "default",
  }
  const work: WorkView = {
    ticket: {
      id: "fixture-work", kind: "work", generation: 1, state: "blocked", updated_seq: 1,
      record_revision: 1, contract_revision: 1, archived: false,
      contract: { title: "Fixture Work", objective: "Keep the original question open", constraints: [], acceptance: [] },
      blocked: { reason: "waiting" }, active_assignment: null, current_submission: null, accepted_submission: null,
    },
    assignments: [], submissions: [], sections: ["assignments", "requests", "submissions"],
    requests: [{
      id: "fixture-question", work_id: "fixture-work", assignment_id: null, generation: 1,
      contract_revision: 1, prompt_revision: 1, updated_seq: 1, kind: { kind: "question" },
      prompt: "What should happen next?", status: "open", answer: null,
    }],
  }
  const stamp = { commit: "a".repeat(40), seq: 1, authority_epoch: 1 }
  const envelope = <T,>(data: T) => ({
    snapshot: stamp, index_seq: 1, coverage: "authoritative_scope" as const, truncated: false, omitted_count: 0, next_cursor: null, data,
  })
  const scope: TicketScope = {
    available: true, readable: true, health: "writable", mutation_enabled: true, dispatch_enabled: true,
    availability: { kind: "ready", reason_code: "scope_ready" }, can_initialize: false, initialization: null,
    binding: { scope_id: "supervisor/fixture", supervisor_session_id: id, binding_revision: 1 },
    overview: envelope({ ticket_count: 1, work_count: 1, states: { blocked: 1 }, open_questions: 1, open_approvals: 0, needs_acceptance: 0 }),
    capabilities: {
      ticket_scope_v1: true, multi_pending_v1: true, precise_request_response_v1: true,
      semantic_messages_v1: true, message_references_v1: true,
    },
  }
  await page.addInitScript(({ id, port }) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
    Object.assign(window, {
      __TAURI_INTERNALS__: { invoke: async () => null },
      __BAMBOO_BACKEND_PORT__: port,
    })
  }, { id, port: Number(new URL(entryUrl).port) })
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true, sessionId: id })
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({ json: { sessions: [session], total: 1, limit: 200, offset: 0 } }))
  await page.route(`**/api/v1/sessions/${id}`, (route) => route.fulfill({ json: { session }, headers: { ETag: '"1"' } }))
  await page.route("**/api/v1/tickets/scope", (route) => route.fulfill({ json: scope }))
  await page.route("**/api/v1/tickets/search", (route) => route.fulfill({ json: envelope([{ id: work.ticket.id, kind: "work" }]) }))
  await page.route("**/api/v1/tickets/inspect", (route) => route.fulfill({ json: envelope([work]) }))
  await page.route("**/api/v1/tickets/changes", (route) => route.fulfill({ json: envelope([]) }))
  const messages: Array<Record<string, unknown>> = []
  let executions = 0
  let decisions = 0
  await page.route("**/api/v1/tickets/requests/respond", (route) => {
    decisions += 1
    return route.fulfill({ status: 422, json: { error: "No decision expected" } })
  })
  await page.route("**/api/v1/chat", (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    const body = route.request().postDataJSON()
    messages.push(body)
    return route.fulfill({ json: { session_id: id, message_id: body.message_id, ingress_seq: 1, status: "success" } })
  })
  await page.route(`**/api/v1/execute/${id}`, (route) => {
    executions += 1
    return route.fulfill({ json: { session_id: id, status: "started", run_id: "fixture-work-run" } })
  })
  await page.goto(entryUrl)
  const referenceQuestion = async () => {
    const status = page.getByTestId("ticket-work-status")
    await expect(status).toContainText("1 项工作")
    await status.click()
    await page.getByTestId("supervisor-overview").getByRole("button", { name: "查看全部工作", exact: true }).click()
    const overview = page.getByTestId("ticket-work-overview")
    await expect(overview).toContainText(work.ticket.contract.title)
    await overview.getByRole("button", { name: "在普通输入中引用此请求" }).click()
    await expect(page.getByTestId("ticket-reference")).toContainText(work.ticket.contract.title)
  }
  const composer = page.getByRole("textbox", { name: "消息", exact: true })
  await referenceQuestion()
  await composer.fill("Unsubmitted Work reply")
  await expect(composer).toContainText("Unsubmitted Work reply")
  await page.reload()
  await expect(page.getByTestId("ticket-work-status")).toContainText("1 项工作")
  await expect(composer).toBeVisible()
  await expect(composer).not.toContainText("Unsubmitted Work reply")
  expect(messages).toEqual([])

  await referenceQuestion()
  await composer.fill("Please describe this question")
  await expect(page.getByRole("button", { name: "发送消息" })).toBeEnabled()
  await composer.press("Enter")
  await expect.poll(() => executions).toBe(1)
  expect(messages).toEqual([expect.objectContaining({
    session_id: id, message: "Please describe this question", thread_id: work.ticket.id,
    in_reply_to: work.requests[0]!.id, message_id: expect.any(String),
  })])
  expect(decisions).toBe(0)
  await expect(composer).not.toContainText("Please describe this question")
  expect(observation.pageErrors).toEqual([])
  expect(observation.protocolErrors).toEqual([])
})
