import { expect, test, type Locator, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { expectComposerText } from "./support/composer.js"

type FixtureSideChat = {
  id: string
  model: { provider: string; model: string }
  preview: string
  turns: Array<{ id: string; message: string; quote: { message_id: string; text: string }; answer: string; status: string }>
}

async function selectSourceText(source: Locator, quote: string) {
  await source.evaluate((node, selectedText) => {
    const document = node.ownerDocument
    const walker = document.createTreeWalker(node, document.defaultView!.NodeFilter.SHOW_TEXT)
    let text = walker.nextNode()
    while (text && !text.textContent?.includes(selectedText)) text = walker.nextNode()
    if (!text?.textContent) throw new Error("Quote text missing")
    const start = text.textContent.indexOf(selectedText)
    document.getSelection()!.setBaseAndExtent(text, start, text, start + selectedText.length)
  }, quote)
}

test("selecting a Side Chat quote keeps user and assistant text in place", async ({ page }, testInfo) => {
  const quote = "lockfile mismatch"
  const content = `${"这段文字会自动换行，方便检查选中前后的排版。 ".repeat(8)}Bamboo reported a ${quote} during the build.`
  const messages = (["user", "assistant"] as const).map((role) => ({
    id: `selection-${role}`, role, content, created_at: "2026-09-03T00:00:01Z",
  }))
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  await installArtifactRuntime(page, standaloneScenario, messages, { sessionFeatures: ["session_side_chat"] })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("button", { name: "打开侧聊", exact: true })).toBeVisible()

  const viewport = page.locator("[data-chat-body] [data-history-viewport]")
  const bottomGap = () => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)
  await expect(viewport).not.toHaveAttribute("aria-busy", "true")
  await expect.poll(bottomGap).toBeLessThanOrEqual(2)
  if (await viewport.evaluate((node) => node.scrollTop > 2)) {
    // A reader scrolls up before selecting older text while the chat follows the latest message.
    await viewport.hover()
    await page.mouse.wheel(0, -64)
    await expect(page.getByRole("button", { name: "滚动到底部", exact: true })).toBeVisible()
    await expect.poll(bottomGap).toBeGreaterThan(2)
  }

  for (const { id, role } of messages) {
    const row = page.locator(`[data-message-row="${id}"]`)
    const body = row.locator(`[data-message-role="${role}"]`)
    const source = role === "assistant" ? body.locator(".assistant-streamdown p") : body.getByText(content, { exact: true })
    const ask = row.getByRole("button", { name: "在侧聊中提问", exact: true })
    await expect(source).toHaveText(content)
    await source.scrollIntoViewIfNeeded()
    await expect(source).toBeInViewport({ ratio: 0.98 })
    await expect(ask).toHaveCount(0)
    const layout = () => source.evaluate(async (node) => {
      const scrollport = node.closest("[data-history-viewport]")!
      const view = node.ownerDocument.defaultView!
      await new Promise<void>((resolve) => view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve())))
      const range = node.ownerDocument.createRange()
      range.selectNodeContents(node)
      const geometry = ({ x, y, width, height }: DOMRect) => [x, y, width, height]
      return {
        scrollTop: scrollport.scrollTop,
        bounds: geometry(node.getBoundingClientRect()),
        lines: Array.from(range.getClientRects(), geometry),
      }
    })
    const before = await layout()
    expect(before.lines.length).toBeGreaterThan(1)
    await selectSourceText(source, quote)
    await expect(ask).toBeVisible()
    expect(await source.evaluate((node) => node.ownerDocument.getSelection()?.toString())).toBe(quote)
    expect(await layout(), `${role} layout while text is selected`).toEqual(before)
    if (role === "assistant" && testInfo.project.name === "desktop-chromium") {
      await testInfo.attach("Selected message and Side Chat action", {
        body: await page.screenshot({ animations: "disabled" }), contentType: "image/png",
      })
    }

    await source.evaluate((node) => node.ownerDocument.getSelection()?.removeAllRanges())
    await expect(ask).toHaveCount(0)
    expect(await layout(), `${role} layout after clearing the selection`).toEqual(before)
  }
})

test("asks from a selection, stops only the side turn, and restores the side transcript", async ({ page }, testInfo) => {
  const source = "all-surface-session"
  const rootMessage = "root-build-report"
  const sourceText = "Bamboo reported a lockfile mismatch during the build."
  const sideChannel = "agent.side-chat/" + source
  const prefix = "/api/v1/sessions/" + source + "/side-chat"
  let socket: WebSocketRoute | undefined
  let channel: string | undefined
  let sequence = 0
  let generation = "a".repeat(64)
  let state: FixtureSideChat | null = null
  let delayedRead: Promise<void> | undefined
  const pauseReads = () => {
    let release = () => {}
    delayedRead = new Promise<void>((resolve) => { release = resolve })
    return () => { delayedRead = undefined; release() }
  }
  const saveDraft = (value: object) => page.locator("body").evaluate((node, data) => {
    const view = node.ownerDocument.defaultView!
    const scope = Object.keys(view.localStorage).find((key) => key.startsWith("lotus-next.workbench.v1:")
      && key.endsWith(":" + data.source))
    if (!scope) throw new Error("The source workbench is not persisted")
    view.sessionStorage.setItem(scope + ":side-chat-draft", JSON.stringify(data.value))
  }, { source, value })
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
  await page.route("**" + prefix, async (route) => {
    await delayedRead
    await route.fulfill({ json: { source_generation: generation, side_chat: state } })
  })
  await page.route("**" + prefix + "/turns", async (route) => {
    const request = route.request().postDataJSON()
    expect(request.source_generation).toBe(generation)
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
    await route.fulfill({ status: 202, json: { source_generation: generation, side_chat: state } })
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
  const sourceBody = page.locator('[data-message-row="' + rootMessage + '"] [data-message-role]')
  // A range into the temporary Markdown fallback is removed with that DOM.
  const sourceParagraph = sourceBody.locator(".assistant-streamdown p")
  await expect(sourceParagraph).toHaveText(sourceText)
  await expect(page.getByRole("button", { name: "打开侧聊", exact: true })).toBeVisible()
  await main.fill("主会话已有草稿")
  await expectComposerText(main, "主会话已有草稿")
  await selectSourceText(sourceParagraph, "lockfile mismatch")
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
  // Reopening before an authoritative read preserves the delivery ID.
  const oldChatId = state!.id
  await saveDraft({
    text: turn.message, chatId: oldChatId, sourceGeneration: generation,
    pending: { id: turn.id, source_generation: generation, expected_chat_id: oldChatId, previous_turn_id: null },
  })
  const resumeReads = pauseReads()
  await page.reload()
  await page.getByRole("button", { name: "打开侧聊", exact: true }).click()
  await expect(question).toHaveValue(turn.message)
  resumeReads()
  await expect(question).toHaveValue("")
  await expect(panel.getByText(turn.answer)).toBeVisible()

  // A deferred /side intent survives a source clear while its initial read is
  // pending. Its old source quote and exact send identity cannot move forward.
  await page.getByRole("button", { name: "关闭侧聊标签页", exact: true }).click()
  await page.getByRole("button", { name: "收起工作面板", exact: true }).click()
  await saveDraft({
    text: "清空前草稿", chatId: oldChatId, sourceGeneration: generation, quote: turn.quote,
    pending: { id: turn.id, source_generation: generation, expected_chat_id: oldChatId, previous_turn_id: null },
  })
  generation = "b".repeat(64)
  state = null
  const readClearedSource = pauseReads()
  await main.fill("/side 清空后的新问题")
  await main.press("Enter")
  await expect(question).toHaveValue("清空前草稿")
  readClearedSource()
  await expect(question).toHaveValue("清空前草稿\n\n清空后的新问题")
  await expect(panel.getByRole("button", { name: "定位到主会话原文" })).toHaveCount(0)

  expect(writes).toEqual([prefix + "/turns", expect.stringMatching(new RegExp("^" + prefix + "/runs/[^/]+/stop$")), prefix + "/turns"])
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})

test("reveals a loaded source while the main transcript follows the bottom", async ({ page }) => {
  const source = "all-surface-session"
  const quote = { message_id: "source-message", text: "An earlier build failed." }
  const messages = [
    { id: quote.message_id, role: "user", content: quote.text, created_at: "2026-09-03T00:00:00Z" },
    ...Array.from({ length: 39 }, (_, index) => ({
      id: "newer-" + index,
      role: index % 2 === 0 ? "assistant" : "user",
      content: "Later build message " + index,
      created_at: new Date(Date.UTC(2026, 8, 3, 0, 1, index)).toISOString(),
    })),
  ]
  const sideChat: FixtureSideChat = {
    id: "side-fixture",
    model: { provider: "fixture", model: "fixture-model" },
    preview: "",
    turns: [{ id: "side-turn", message: "What failed?", quote, answer: "A build failed.", status: "completed" }],
  }

  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  await installArtifactRuntime(page, standaloneScenario, [], { sessionFeatures: ["session_side_chat"] })
  await page.route("**/api/v1/history/" + source + "*", (route) => route.fulfill({ json: { session_id: source, messages } }))
  await page.route("**/api/v1/sessions/" + source + "/side-chat", (route) =>
    route.fulfill({ json: { source_generation: "a".repeat(64), side_chat: sideChat } }),
  )
  await page.goto(standaloneScenario.entryUrl)
  const earlierMessage = page.locator('[data-message-row="' + quote.message_id + '"]')
  const latestMessage = page.locator('[data-message-row="newer-38"]')
  const bottomButton = page.locator("[data-scroll-to-bottom-anchor] button")
  await expect(latestMessage).toBeInViewport()
  await expect(earlierMessage).not.toBeInViewport()
  await expect(bottomButton).toHaveCount(0)

  await page.getByRole("button", { name: "打开侧聊", exact: true }).click()
  await page.getByRole("button", { name: "定位到主会话原文", exact: true }).click()
  await expect(bottomButton).toBeVisible()
  await expect(earlierMessage).toBeInViewport()
  await expect(latestMessage).not.toBeInViewport()
})
