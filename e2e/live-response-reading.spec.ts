import { expect, test, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

test("home-to-chat follows streaming and late layout, pauses for reading, and reconnects", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop scrolling regression")
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  let socket: WebSocketRoute | undefined
  let subscribed = false
  let seq = 0
  await page.routeWebSocket(/.*/, (ws) => {
    socket = ws
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw))
      if (frame.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch === "agent.all-surface-session") subscribed = true
    })
  })
  const session = { id: "all-surface-session", title: "Live reading", kind: "root", model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" }, created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z", permission_mode: "default", is_running: false }
  await page.route("**/api/v1/sessions", (route) => route.fulfill({ json: { sessions: [session] } }))
  await page.route("**/api/v1/sessions/all-surface-session", (route) => route.fulfill({ json: { session } }))
  await page.route("**/api/v1/chat", (route) => route.fulfill({ json: { session_id: session.id, status: "success" } }))
  await page.route("**/api/v1/execute/all-surface-session", (route) => route.fulfill({ json: { status: "started", session_id: session.id } }))
  await page.route("**/api/v1/task/all-surface-session", (route) => route.fulfill({ json: { session_id: session.id, items: [] } }))
  await page.goto(standaloneScenario.entryUrl)
  const area = page.locator("div.min-h-0.flex-1.overflow-y-auto").last()
  const input = page.getByRole("textbox", { name: "消息", exact: true })
  await expect(input).toBeVisible()
  await page.getByText("Live reading", { exact: true }).first().waitFor()
  await page.getByRole("button", { name: "新建", exact: true }).click()
  await expect(page.getByRole("heading", { name: "开始新任务", exact: true })).toBeVisible()
  // Home has no message elements; submission mounts them later.
  await expect(page.getByText("开始一段新对话", { exact: true })).toHaveCount(0)
  await input.fill("Please give a long response")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => subscribed).toBe(true)
  const emit = (type: string, content: string) => socket!.send(JSON.stringify({ ch: `agent.${session.id}`, seq: ++seq, event: { type, content } }))
  emit("reasoning_token", "Detailed reasoning.\n".repeat(100))
  const reasoning = page.getByRole("button", { name: "思考中…", exact: true })
  await expect(reasoning).toHaveAttribute("aria-expanded", "false")
  await reasoning.click()
  const region = page.getByRole("region", { name: "正在生成的思考过程" })
  await expect(region).toBeVisible()
  expect((await region.boundingBox())!.height).toBeLessThanOrEqual(128)
  await reasoning.click()
  const gap = () => area.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
  for (let i = 0; i < 4; i++) {
    emit("token", `Part ${i}\n\n` + "A readable paragraph of output.\n\n".repeat(14))
    await expect(page.locator(".assistant-streamdown")).toContainText(`Part ${i}`)
    await expect.poll(gap).toBeLessThanOrEqual(2)
  }
  await area.hover()
  await page.mouse.wheel(0, -250)
  const jump = page.getByRole("button", { name: "滚动到底部", exact: true })
  await expect(jump).toBeVisible()
  const pausedTop = await area.evaluate((el) => el.scrollTop)
  emit("token", "More output while paused.\n\n".repeat(20))
  await expect(page.locator(".assistant-streamdown")).toContainText("More output while paused.")
  expect(await area.evaluate((el) => el.scrollTop)).toBeCloseTo(pausedTop, 0)
  await jump.click()
  await expect.poll(gap).toBeLessThanOrEqual(2)
  emit("token", "Following restored.\n\n".repeat(20))
  await expect(page.locator(".assistant-streamdown")).toContainText("Following restored.")
  await expect.poll(gap).toBeLessThanOrEqual(2)
  // Simulate late intrinsic content growth independent of React/token commits.
  await area.evaluate((el) => {
    const image = el.ownerDocument.createElement("div")
    image.setAttribute("data-late-layout", "true")
    image.style.height = "350px"
    el.firstElementChild!.append(image)
  })
  await expect.poll(gap).toBeLessThanOrEqual(2)
  // Multiline composer height reduces the available viewport while pinned.
  await input.fill("A line\n".repeat(8))
  await expect.poll(gap).toBeLessThanOrEqual(2)
  await page.route("**/api/v1/history/all-surface-session", (route) => route.fulfill({ json: {
    session_id: session.id,
    messages: [{ id: "completed", role: "assistant", content: "Completed answer.\n\n".repeat(80), reasoning: "Saved reasoning.\n".repeat(80), created_at: "2026-09-07T00:00:00Z" }],
  } }))
  emit("complete", "")
  socket!.send(JSON.stringify({ ch: `agent.${session.id}`, seq: ++seq, control: { type: "terminal" } }))
  await expect(reasoning).toHaveCount(0)
  await expect(page.locator(".assistant-streamdown")).toContainText("Completed answer.")
  await expect.poll(gap).toBeLessThanOrEqual(2)
  const savedReasoning = page.getByRole("button", { name: "思考过程", exact: true })
  await expect(savedReasoning).toHaveAttribute("aria-expanded", "false")
  await testInfo.attach("live-reading-following", { body: await page.screenshot(), contentType: "image/png" })
  await page.getByRole("button", { name: "新建", exact: true }).click()
  await expect(reasoning).toHaveCount(0)
  await page.getByText("Live reading", { exact: true }).first().click()
  await expect(input).toBeVisible()
  await area.evaluate((el) => { const content = el.firstElementChild!; const block = el.ownerDocument.createElement("div"); block.style.height = "1800px"; content.append(block) })
  await expect.poll(gap).toBeLessThanOrEqual(2)
  expect(observation.pageErrors).toEqual([])
})
