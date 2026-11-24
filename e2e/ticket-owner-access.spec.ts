import { expect, test } from "@playwright/test"
import { ticketSnapshot } from "../src/services/tickets/testFixtures.js"
import { installArtifactRuntime, secureRemoteScenario, standaloneScenario } from "./support/artifactRuntime.js"
import { expectComposerText } from "./support/composer.js"

for (const requestState of ["unauthenticated", "local_bypass", "authenticated"] as const) {
  test(`ticket negotiation respects admitted ${requestState} access on the built artifact`, async ({ page }) => {
    const scenario = requestState === "local_bypass" ? standaloneScenario : secureRemoteScenario
    await page.addInitScript(() => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      localStorage.setItem("lotus_next_last_session", "all-surface-session")
    })
    const observation = await installArtifactRuntime(page, scenario, [], { bootstrapRequestState: requestState })
    const sessionId = "all-surface-session"
    const text = "ordinary chat remains available"
    const chats: Array<Record<string, unknown>> = []
    const requestUrls: string[] = []
    const ticketRequests: string[] = []
    const executions: string[] = []
    page.on("request", (request) => {
      requestUrls.push(request.url())
      if (new URL(request.url()).pathname.startsWith("/api/v1/tickets/")) ticketRequests.push(request.url())
    })
    // A remote open bootstrap is not owner admission. Keep the actual 403
    // boundary so an accidental negotiation cannot look like an absent scope.
    if (requestState === "unauthenticated") {
      await page.route("**/api/v1/tickets/**", (route) => route.fulfill({ status: 403, json: { error: "owner access required" } }))
    }
    let acknowledge!: () => void
    const acknowledgement = new Promise<void>((resolve) => { acknowledge = resolve })
    await page.route("**/api/v1/chat", async (route) => {
      expect(route.request().method()).toBe("POST")
      chats.push(route.request().postDataJSON() as Record<string, unknown>)
      await acknowledgement
      await route.fulfill({ json: { session_id: sessionId, message_id: "ordinary-chat-ack", status: "success" } })
    })
    await page.route(`**/api/v1/execute/${sessionId}`, (route) => {
      expect(route.request().method()).toBe("POST")
      executions.push(route.request().url())
      return route.fulfill({ json: { status: "started", session_id: sessionId } })
    })
    await page.route(`**/api/v1/task/${sessionId}`, (route) => route.fulfill({ json: { session_id: sessionId, items: [] } }))
    await page.goto(scenario.entryUrl, { waitUntil: "domcontentloaded" })
    const composer = page.getByRole("textbox", { name: "消息", exact: true })
    await expect(composer).toBeVisible()
    await expect(page.locator("header").getByText("All-surface acceptance", { exact: true })).toBeVisible()
    await composer.fill(text)
    const send = page.getByRole("button", { name: "发送消息", exact: true })
    await expect(send).toBeEnabled()
    if (requestState !== "unauthenticated") {
      await expect.poll(() => observation.httpRequests.filter((request) =>
        new URL(request.url).pathname === "/api/v1/tickets/scope").length).toBeGreaterThan(0)
    }
    try {
      await send.click()
      await expect.poll(() => chats.length).toBe(1)
      expect(chats[0]).toMatchObject({ session_id: sessionId, message: text })
      await expectComposerText(composer, text)
      await expect(composer).toHaveAttribute("aria-busy", "true")
      expect(executions).toEqual([])
      await composer.press("Enter")
      expect(chats).toHaveLength(1)
    } finally {
      acknowledge()
    }
    await expectComposerText(composer, "")
    await expect(composer).toHaveAttribute("aria-busy", "false")
    await expect.poll(() => executions.length).toBe(1)
    // History is still empty: the admitted message remains visible while its
    // acknowledged message ID has not appeared in canonical history yet.
    await expect(page.locator('[data-message-role="user"]')).toHaveText(text)
    // Observe a full existing ticket polling interval, including focus/online.
    await page.evaluate(() => {
      const events = globalThis as unknown as { dispatchEvent(event: Event): boolean }
      events.dispatchEvent(new Event("focus"))
      events.dispatchEvent(new Event("online"))
    })
    await page.waitForTimeout(2_800)
    if (requestState === "unauthenticated") {
      expect(ticketRequests).toEqual([])
    }
    expect(ticketRequests.every((url) => new URL(url).pathname === "/api/v1/tickets/scope")).toBe(true)
    expect(chats).toHaveLength(1)
    expect(executions).toHaveLength(1)
    expect(requestUrls.every((url) => new URL(url).origin === scenario.origin)).toBe(true)
    expect(observation.webSocketUrls).toEqual([`${scenario.origin.replace(/^http/, "ws")}/v2/stream`])
    expect(observation.protocolErrors).toEqual([])
    expect(observation.bootstrapDocuments).toHaveLength(1)
    expect(observation.errorResponses).toEqual([])
    expect(observation.failedRequests).toEqual([])
    expect(observation.pageErrors).toEqual([])
    expect(observation.consoleErrors).toEqual([])
  })
}

test("clears the saved message before startup settles and preserves the next draft through activation recovery", async ({ page }, testInfo) => {
  const sessionId = "bamboo-default-supervisor"
  await page.addInitScript((sessionId) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", sessionId)
  }, sessionId)
  await installArtifactRuntime(page, standaloneScenario, [], { bootstrapRequestState: "local_bypass", sessionId })
  const { scope } = ticketSnapshot()
  scope.binding.supervisor_session_id = sessionId
  scope.overview.data = { ticket_count: 0, work_count: 0, states: {}, open_questions: 0, open_approvals: 0, needs_acceptance: 0 }
  await page.route("**/api/v1/tickets/scope", (route) => route.fulfill({ json: scope }))
  await page.route("**/api/v1/tickets/{search,changes}", (route) => route.fulfill({ json: { ...scope.overview, data: [] } }))

  let saves = 0
  let acknowledge!: () => void
  const acknowledgement = new Promise<void>((resolve) => { acknowledge = resolve })
  await page.route("**/api/v1/chat", async (route) => {
    saves++
    const { message_id, session_id } = route.request().postDataJSON()
    expect(session_id).toBe(sessionId)
    expect(message_id).toBeTruthy()
    await acknowledgement
    return route.fulfill({ json: { session_id, message_id, ingress_seq: 1, status: "queued" } })
  })

  let refuse!: () => void
  let confirm!: () => void
  const refusal = new Promise<void>((resolve) => { refuse = resolve })
  const confirmation = new Promise<void>((resolve) => { confirm = resolve })
  let starts = 0
  await page.route(`**/api/v1/execute/${sessionId}`, async (route) => {
    starts++
    if (starts === 1) {
      await refusal
      await route.fulfill({ status: 503, json: { error: "Activation unavailable" } })
      return
    }
    await confirmation
    await route.fulfill({ status: 202, json: { session_id: sessionId, status: "started" } })
  })

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ticket-work-status")).toBeVisible()
  const progress = page.getByRole("status").filter({ hasText: /^正在启动$/ })
  const error = page.getByRole("alert").filter({ hasText: "消息已保存，启动尚未确认" })
  const retry = page.getByRole("button", { name: "重试启动", exact: true })
  const composer = page.getByRole("textbox", { name: "消息", exact: true })
  try {
    await composer.fill("Prepare a report")
    await page.getByRole("button", { name: "发送消息", exact: true }).click()
    await expect.poll(() => saves).toBe(1)
    await expectComposerText(composer, "Prepare a report")
    await expect(composer).toHaveAttribute("aria-busy", "true")
    expect(starts).toBe(0)
    acknowledge()
    await expect(progress).toBeVisible()
    await expect.poll(() => starts).toBe(1)
    await expectComposerText(composer, "")
    await expect(composer).toHaveAttribute("aria-busy", "true")
    await expect(error).toHaveCount(0)
    await expect(retry).toHaveCount(0)
    await testInfo.attach("saved-message-cleared-during-startup", { body: await page.screenshot(), contentType: "image/png" })
    await composer.fill("Keep this next instruction")
    await composer.press("Enter")
    expect(saves).toBe(1)

    refuse()
    await expect(progress).toHaveCount(0)
    await expect(error).toBeVisible()
    await expectComposerText(composer, "Keep this next instruction")
    await retry.click()
    await expect(progress).toBeVisible()
    await expect(error).toHaveCount(0)
    await expect(retry).toHaveCount(0)
    await expectComposerText(composer, "Keep this next instruction")

    confirm()
    await expect(progress).toHaveCount(0)
    await expect(error).toHaveCount(0)
    await expect(retry).toHaveCount(0)
    await expectComposerText(composer, "Keep this next instruction")
    await expect(composer).toHaveAttribute("aria-busy", "false")
    expect(saves).toBe(1)
    expect(starts).toBe(2)
  } finally {
    acknowledge()
    refuse()
    confirm()
  }
})

test("Enter saves semantic ingress during an existing run without opening the legacy guidance queue", async ({ page }) => {
  const id = "bamboo-default-supervisor"
  await page.addInitScript((sessionId) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", sessionId)
  }, id)
  const runtime = await installArtifactRuntime(page, standaloneScenario, [], { bootstrapRequestState: "local_bypass", sessionId: id })
  const { scope } = ticketSnapshot()
  scope.binding.supervisor_session_id = id
  await page.route("**/api/v1/tickets/scope", (route) => route.fulfill({ json: scope }))
  await page.route("**/api/v1/tickets/{search,changes}", (route) => route.fulfill({ json: { ...scope.overview, data: [] } }))
  const session = {
    id, title: "Running Supervisor", kind: "root", root_session_id: id, parent_session_id: null,
    title_version: 1, model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-10-15T00:00:00Z", updated_at: "2026-10-15T00:00:00Z",
    is_running: true, last_run_status: "running", root_orchestration_only: false, thinking_mode: "standard",
    root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64), permission_mode: "default",
  }
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({
    json: { sessions: new URL(route.request().url()).searchParams.get("kind") === "child" ? [] : [session], total: 1, limit: 200, offset: 0 },
  }))
  await page.route(`**/api/v1/sessions/${id}`, (route) => route.fulfill({ json: { session }, headers: { ETag: '"1"' } }))
  const posts: Array<{ session_id: string; message_id: string; message: string; correlation_id: string }> = []
  await page.route("**/api/v1/chat", (route) => {
    const request = route.request().postDataJSON() as (typeof posts)[number]
    posts.push(request)
    return route.fulfill({ json: { session_id: id, message_id: request.message_id, ingress_seq: 1, status: "queued" } })
  })
  await page.route(`**/api/v1/execute/${id}`, (route) => route.fulfill({ json: { session_id: id, status: "already_running" } }))
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner")).toContainText(session.title)
  await expect(page.getByTestId("ticket-work-status")).toBeVisible()
  const editor = page.getByRole("textbox", { name: "消息", exact: true })
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeEnabled()
  await editor.fill("A second ticket instruction during generation")
  await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled()
  await expect(page.getByRole("combobox", { name: "发送时机", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "加入队列", exact: true })).toHaveCount(0)
  await editor.press("Enter")
  await expect.poll(() => posts).toEqual([expect.objectContaining({
    session_id: id, message: "A second ticket instruction during generation", message_id: expect.any(String),
  })])
  expect(posts[0].correlation_id).toBe(posts[0].message_id)
  await expectComposerText(editor, "")
  await expect(editor).toHaveAttribute("aria-busy", "false")
  expect(runtime.httpRequests.filter(({ method, url }) => method === "POST" && new URL(url).pathname.endsWith("/guidance"))).toEqual([])
  expect(runtime.pageErrors).toEqual([])
})
