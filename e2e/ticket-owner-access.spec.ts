import { expect, test } from "@playwright/test"
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
