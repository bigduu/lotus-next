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

async function prepare(page: Page, target: string, childApproval = false) {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, mainId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let generation = 1
  const decisions: unknown[] = []
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
      operation_summary: "Print a fixture message", allowed_decisions: ["allow_once", "deny_once", "allow_global"],
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
        json: { session: { ...session(id), is_running: childApproval && id === target } }, headers: { ETag: '"1"' },
      })
      if (path === `/api/v1/history/${id}`) return route.fulfill({ json: { session_id: id, messages: [] } })
      if (path === `/api/v1/task/${id}`) return route.fulfill({ json: { items: [] } })
      if (path === `/api/v1/actors/${id}/snapshot`) return route.fulfill({ json: actorSnapshotFixture(id, 0) })
      if (path === `/api/v1/respond/${id}/pending`) return route.fulfill({
        json: id === target && generation <= 2 && !childApproval ? pending() : { has_pending_question: false },
      })
    }
    if (path === `/api/v1/sessions/${target}/permission-decisions`) {
      const decision = request.postDataJSON()
      decisions.push(decision)
      generation += 1
      return route.fulfill({ json: { success: true, replayed: false,
        receipt: { session_id: target, decision }, auto_resume_status: "completed",
        resume: { success: true, auto_resume_status: "completed" },
      } })
    }
    if (path === "/api/v1/child-approval/fixture-child") {
      childDecisions.push(request.postDataJSON())
      return route.fulfill({ json: { success: true } })
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
  return { observation, decisions, childDecisions, channels,
    sendChildRequest: (requestId: string, seq: number) => socket!.send(JSON.stringify({
      ch: `agent.${target}`, seq, event: { type: "child_approval_requested", child_session_id: "fixture-child",
        request_id: requestId, tool_name: "Bash", permission: "execute_command", resource: "echo fixture child" },
    })),
  }
}

for (const target of [mainId, sideId]) {
  test(`shared typed approval in ${target === mainId ? "main" : "side"} chat ignores held Enter across requests`, async ({ page }, testInfo) => {
    test.skip(target === sideId && testInfo.project.name !== "desktop-chromium", "desktop interactive side pane")
    const fixture = await prepare(page, target)
    const card = page.locator("[data-approval-presentation]")
    const allow = card.getByRole("button", { name: "仅本次允许", exact: true })
    await expect(card).toContainText("Fixture approval 1")
    await expect(card).toBeFocused()
    await expect(card.locator("textarea")).toHaveCount(0)
    await expect(card.getByRole("button")).toHaveCount(3)
    await page.screenshot({ path: testInfo.outputPath(`approval-${target}-${testInfo.project.name}.png`), animations: "disabled" })
    await page.keyboard.down("Enter")
    await allow.focus()
    await page.keyboard.down("Enter")
    await page.keyboard.down("Enter")
    expect(fixture.decisions).toEqual([])
    await page.keyboard.up("Enter")
    await page.keyboard.down("Enter")
    await expect(card).toContainText("Fixture approval 2")
    await expect(card).toBeFocused()
    await allow.focus()
    await page.keyboard.down("Enter")
    await page.keyboard.up("Enter")
    expect(fixture.decisions).toEqual([{ request_id: "approval-1", request_generation: "generation-1",
      expected_policy_revision: 7, decision: "allow_once" }])
    await card.getByRole("button", { name: "仅本次拒绝", exact: true }).click()
    await expect(card).toHaveCount(0)
    expect(fixture.decisions).toHaveLength(2)
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
  await expect(card).toBeFocused()
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
