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

test("shows startup progress until Bamboo confirms or refuses the saved message", async ({ page }) => {
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
  await page.route("**/api/v1/chat", (route) => {
    saves++
    const { message_id, session_id } = route.request().postDataJSON()
    expect(session_id).toBe(sessionId)
    expect(message_id).toBeTruthy()
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
  try {
    await page.getByRole("textbox", { name: "消息", exact: true }).fill("Prepare a report")
    await page.getByRole("button", { name: "发送消息", exact: true }).click()
    await expect(progress).toBeVisible()
    await expect(error).toHaveCount(0)
    await expect(retry).toHaveCount(0)

    refuse()
    await expect(progress).toHaveCount(0)
    await expect(error).toBeVisible()
    await retry.click()
    await expect(progress).toBeVisible()
    await expect(error).toHaveCount(0)
    await expect(retry).toHaveCount(0)

    confirm()
    await expect(progress).toHaveCount(0)
    await expect(error).toHaveCount(0)
    await expect(retry).toHaveCount(0)
    expect(saves).toBe(1)
    expect(starts).toBe(2)
  } finally {
    refuse()
    confirm()
  }
})
