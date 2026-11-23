import { expect, test, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { expectComposerText } from "./support/composer.js"
type FixtureSideChat = {
  id: string
  model: { provider: string; model: string }
  preview: string
  turns: Array<{ id: string; message: string; quote: { message_id: string; text: string }; answer: string; status: string }>
}

test("asks from a selection, stops only the side turn, and restores the side transcript", async ({ page }, testInfo) => {
  const source = "all-surface-session"
  const rootMessage = "root-build-report"
  const sourceText = "Bamboo reported a lockfile mismatch during the build."
  const sideChannel = "agent.side-chat/" + source
  const prefix = "/api/v1/sessions/" + source + "/side-chat"
  let socket: WebSocketRoute | undefined
  let channel: string | undefined
  let sequence = 0
  let state: FixtureSideChat | null = null
  const writes: string[] = []

  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario, [], { sessionFeatures: ["session_side_chat"] })
  await page.routeWebSocket(/\/v2\/stream(?:\?|$)/, (ws) => {
    socket = ws
    channel = undefined
    sequence = 0
    ws.onMessage((raw) => {
      const frame = JSON.parse(raw.toString())
      if (frame.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch === sideChannel) {
        channel = frame.ch
        update({ type: "side_chat_changed" })
      }
      if (frame.type === "unsubscribe" && frame.ch === sideChannel) channel = undefined
    })
  })
  function update(event: object) {
    if (socket && channel) socket.send(JSON.stringify({ ch: channel, seq: ++sequence, event }))
  }

  await page.route("**/api/v1/history/" + source + "*", (route) => route.fulfill({ json: {
    session_id: source,
    messages: [{ id: rootMessage, role: "assistant", content: sourceText, created_at: "2026-09-03T00:00:01Z" }],
  } }))
  await page.route("**" + prefix, (route) => route.fulfill({ json: { side_chat: state } }))
  await page.route("**" + prefix + "/turns", async (route) => {
    const request = route.request().postDataJSON()
    const previous = state?.turns.at(-1)
    expect(request.expected_chat_id).toBe(state?.id ?? null)
    expect(request.previous_turn_id).toBe(previous?.id ?? null)
    if (!previous) {
      expect(request.message).toBe("为什么会有这个报错？")
      expect(request.quote).toEqual({ message_id: rootMessage, text: "lockfile mismatch" })
    } else {
      expect(request.message).toBeUndefined()
      expect(previous.status).toBe("stopped")
    }
    state = {
      id: "side-fixture",
      model: { provider: "fixture", model: "fixture-model" },
      preview: "",
      turns: [{
        id: request.id, message: previous?.message ?? request.message, quote: previous?.quote ?? request.quote,
        answer: "", status: "running",
      }],
    }
    await route.fulfill({ status: 202, json: { side_chat: state } })
    update({ type: "side_chat_changed" })
  })
  await page.route("**" + prefix + "/runs/*/stop", async (route) => {
    const current = state?.turns.at(-1)
    if (!state || !current) throw new Error("A side chat turn must be running")
    expect(new URL(route.request().url()).pathname).toBe(prefix + "/runs/" + current.id + "/stop")
    expect(route.request().postDataJSON()).toEqual({ chat_id: state.id })
    current.status = "stopped"
    await route.fulfill({ status: 204 })
    update({ type: "side_chat_changed" })
  })
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(new URL(request.url()).pathname)
  })

  await page.goto(standaloneScenario.entryUrl)
  const main = page.getByRole("textbox", { name: "消息", exact: true })
  await main.fill("主会话已有草稿")
  const sourceBody = page.locator('[data-message-row="' + rootMessage + '"] [data-message-role]')
  await expect(sourceBody).toContainText(sourceText)
  await sourceBody.evaluate((node) => {
    const document = node.ownerDocument
    const walker = document.createTreeWalker(node, document.defaultView!.NodeFilter.SHOW_TEXT)
    let text = walker.nextNode()
    while (text && !text.textContent?.includes("lockfile mismatch")) text = walker.nextNode()
    if (!text) throw new Error("Quote text missing")
    const start = text.textContent!.indexOf("lockfile mismatch")
    const range = document.createRange()
    range.setStart(text, start)
    range.setEnd(text, start + "lockfile mismatch".length)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
  })
  await page.getByRole("button", { name: "在侧聊中提问", exact: true }).click()
  const panel = page.getByRole("region", { name: "侧聊", exact: true })
  const question = panel.getByRole("textbox", { name: "在侧聊中提问…" })
  await expect(panel.getByRole("button", { name: "定位到主会话原文" })).toHaveText("lockfile mismatch")
  await question.fill("为什么会有这个报错？")
  await panel.getByRole("button", { name: "发送到侧聊" }).click()
  await expect(panel.getByRole("button", { name: "停止侧聊" })).toBeEnabled()
  await expect.poll(() => channel).toBe(sideChannel)
  update({ type: "side_chat_progress", chat_id: state!.id, run_id: state!.turns[0].id, text: "先检查 Cargo.lock…" })
  await expect(panel.getByText("先检查 Cargo.lock…")).toBeVisible()
  await panel.getByRole("button", { name: "停止侧聊" }).click()
  await expect(panel.getByRole("article")).toContainText("已停止")
  await panel.getByRole("button", { name: "重试", exact: true }).click()
  await expect(panel.getByRole("button", { name: "停止侧聊" })).toBeVisible()

  const turn = state!.turns[0]
  turn.status = "completed"
  turn.answer = "Cargo.lock 和 Cargo.toml 不一致。"
  update({ type: "side_chat_changed" })
  await expect(panel.getByText(turn.answer)).toBeVisible()
  if (testInfo.project.name === "desktop-chromium") {
    const path = testInfo.outputPath("side-chat.png")
    await page.screenshot({ path })
    await testInfo.attach("side-chat", { path, contentType: "image/png" })
  }
  await panel.getByRole("button", { name: "引用到主输入框" }).click()
  await expectComposerText(main, "主会话已有草稿\n\n> Cargo.lock 和 Cargo.toml 不一致。")

  // Side history comes from Bamboo; an unsent side draft survives a page reload.
  await page.getByRole("button", { name: "打开侧聊", exact: true }).click()
  await question.fill("如何核实？")
  await page.reload()
  await expect(panel.getByText(turn.answer)).toBeVisible()
  await expect(question).toHaveValue("如何核实？")
  await page.getByRole("button", { name: "收起工作面板", exact: true }).click()
  await main.fill("/side 有什么影响？")
  await main.press("Enter")
  await expect(question).toHaveValue("如何核实？\n\n有什么影响？")
  await page.getByRole("button", { name: "收起工作面板", exact: true }).click()
  await expectComposerText(main, "")
  expect(writes).toEqual([prefix + "/turns", expect.stringMatching(new RegExp("^" + prefix + "/runs/[^/]+/stop$")), prefix + "/turns"])
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
