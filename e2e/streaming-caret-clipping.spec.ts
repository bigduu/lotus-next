import { expect, test, type Locator, type Page, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { installResizeDiagnostics } from "./support/resizeDiagnostics.js"

const SESSION_ID = "all-surface-session"

async function expectCaretPaint(page: Page, target: Locator, painted: boolean) {
  const measure = () => target.evaluate((element) => {
    const browser = element.ownerDocument.defaultView!
    const rect = element.getBoundingClientRect()
    const style = browser.getComputedStyle(element)
    return {
      fragments: element.getClientRects().length,
      display: style.display,
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    }
  })
  await expect(async () => {
    const geometry = await measure()
    expect(geometry.fragments).toBe(1)
    expect(geometry.display).toBe("inline-block")
    // Compare the exact caret pixels with the inline box hidden.
    // Bounding boxes alone cannot prove that overflow or clip-path clipped paint.
    const viewport = page.viewportSize()!
    const x = Math.max(0, Math.floor(geometry.x))
    const y = Math.max(0, Math.floor(geometry.y))
    const clip = {
      x, y,
      width: Math.min(viewport.width - x, Math.ceil(geometry.width) + 1),
      height: Math.min(viewport.height - y, Math.ceil(geometry.height) + 1),
    }
    expect(clip.width).toBeGreaterThan(0)
    expect(clip.height).toBeGreaterThan(0)
    const before = await page.screenshot({ clip, animations: "disabled" })
    const hidden = await page.addStyleTag({ content: '[data-assistant-streaming-caret] { visibility: hidden !important; }' })
    let withoutCaret: Buffer
    try {
      withoutCaret = await page.screenshot({ clip, animations: "disabled" })
    } finally {
      await hidden.evaluate((element) => element.remove())
    }
    // ResizeObserver and sticky following can settle after a layout mutation.
    // Only compare paint when both captures used the caret's actual coordinates.
    expect(await measure()).toEqual(geometry)
    expect(before.equals(withoutCaret)).toBe(!painted)
  }).toPass({ timeout: 8_000 })
}

async function startCaretFixture(page: Page, history: readonly unknown[] = []) {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario, history)
  let socket: WebSocketRoute | undefined
  let subscribed = false
  let seq = 0
  let running = false
  await page.routeWebSocket(/.*/, (ws) => {
    socket = ws
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw))
      if (frame.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
      if (frame.type === "subscribe" && frame.ch === `agent.${SESSION_ID}`) subscribed = true
    })
  })
  await page.route("**/api/v1/chat", (route) => route.fulfill({ json: { session_id: SESSION_ID, status: "success" } }))
  await page.route(`**/api/v1/execute/${SESSION_ID}`, (route) => {
    running = true
    return route.fulfill({ json: { status: "started", session_id: SESSION_ID } })
  })
  await page.goto(standaloneScenario.entryUrl)
  const input = page.getByRole("textbox", { name: "消息", exact: true })
  await expect(input).toBeVisible()
  // Keep canonical metadata while reporting the fixture runner's real phase.
  const { session } = await page.evaluate(async (id) =>
    (await fetch(`/api/v1/sessions/${id}`)).json(), SESSION_ID) as { session: Record<string, unknown> }
  await page.route(`**/api/v1/sessions/${SESSION_ID}`, (route) => route.fulfill({
    json: { session: { ...session, is_running: running } },
  }))
  await input.fill("Show the streaming caret fixture")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => subscribed).toBe(true)
  const emit = (type: string, value = "") => socket!.send(JSON.stringify({
    ch: `agent.${SESSION_ID}`, seq: ++seq, event: { type, content: value },
  }))
  const terminal = () => {
    running = false
    socket!.send(JSON.stringify({ ch: `agent.${SESSION_ID}`, seq: ++seq, control: { type: "terminal" } }))
  }
  return { observation, input, emit, terminal }
}

test("streaming caret obeys transcript clipping and follows local layout in a browser fixture", async ({ page }, testInfo) => {
  await installResizeDiagnostics(page)
  // This tests the production artifact with a controlled transport, not a
  // native Bamboo/Bodhi session. Reduced motion makes pixel checks deterministic.
  await page.emulateMedia({ reducedMotion: "reduce" })
  const { observation, input, emit, terminal } = await startCaretFixture(page,
    Array.from({ length: 12 }, (_, index) => ({
      id: `history-${index}`,
      role: index % 2 ? "assistant" : "user",
      content: `History ${index}. ` + "A measured history paragraph. ".repeat(12),
      created_at: "2026-10-09T00:00:00Z",
    })))
  const content = "Streaming paragraph with enough text to wrap in narrow panes.\n\n".repeat(30) + "最后一行"
  emit("token", content)
  const target = page.locator('.assistant-streamdown > [data-assistant-reveal-block]:last-child [data-assistant-streaming-caret]')
  const area = page.locator("[data-message-list-content]").locator("..")
  await expect(target).toBeVisible()
  await expectCaretPaint(page, target, true)

  // Pause following with a real reader gesture. The last glyph moves behind
  // the composer, where a body-level fixed overlay used to remain visible.
  await area.hover()
  await page.mouse.wheel(0, -100)
  const jump = page.getByRole("button", { name: "滚动到底部", exact: true })
  await expect(jump).toBeVisible()
  await expect.poll(async () => {
    const glyph = await target.boundingBox()
    const viewport = await area.boundingBox()
    return glyph!.y >= viewport!.y + viewport!.height
  }).toBe(true)
  await expectCaretPaint(page, target, false)
  await testInfo.attach("caret-clipped-above-composer-fixture", {
    body: await page.screenshot({ path: testInfo.outputPath("caret-clipped-above-composer-fixture.png") }),
    contentType: "image/png",
  })
  await jump.click()
  await expectCaretPaint(page, target, true)

  expect(await page.locator('[data-assistant-typewriter-caret="true"]').count()).toBe(0)
  expect(await target.evaluate((element) => ({
    insideTranscript: !!element.closest("[data-message-list-content]"),
    insideMessageSurface: !!element.closest('[data-message-role="assistant"]'),
    children: element.childNodes.length,
  }))).toEqual({ insideTranscript: true, insideMessageSurface: true, children: 0 })

  // A taller composer resizes the transcript without a window resize.
  await input.fill("A taller composer line\n".repeat(8))
  await expectCaretPaint(page, target, true)
  const beforeLateLayout = await target.boundingBox()
  await target.evaluate((element) => {
    const root = element.closest(".assistant-streamdown") as typeof element
    root.style.paddingLeft = "37px"
    const block = root.firstElementChild as typeof element
    block.style.paddingBottom = "91px"
  })
  await expectCaretPaint(page, target, true)
  expect(await target.boundingBox()).not.toEqual(beforeLateLayout)

  // A clip inside Markdown must also apply, even though the glyph's screen
  // coordinates and the outer transcript viewport do not change.
  await target.evaluate((element) => {
    const paragraph = element.closest("p")! as typeof element
    paragraph.style.clipPath = "inset(0 0 100% 0)"
  })
  await expectCaretPaint(page, target, false)
  await target.evaluate((element) => {
    const paragraph = element.closest("p")! as typeof element
    paragraph.style.clipPath = ""
  })
  await expectCaretPaint(page, target, true)

  // Direction changes use the glyph's inline end without JS repositioning.
  await target.evaluate((element) => element.closest(".assistant-streamdown")!.setAttribute("dir", "rtl"))
  await expectCaretPaint(page, target, true)
  await target.evaluate((element) => element.closest(".assistant-streamdown")!.setAttribute("dir", "auto"))
  await expectCaretPaint(page, target, true)

  const initialViewport = page.viewportSize()!
  await page.setViewportSize({ width: Math.max(360, initialViewport.width - 140), height: initialViewport.height })
  await expectCaretPaint(page, target, true)
  await testInfo.attach("caret-restored-after-layout-fixture", {
    body: await page.screenshot({ path: testInfo.outputPath("caret-restored-after-layout-fixture.png") }),
    contentType: "image/png",
  })

  await page.route(`**/api/v1/history/${SESSION_ID}`, (route) => route.fulfill({ json: {
    session_id: SESSION_ID,
    messages: [{ id: "completed", role: "assistant", content, created_at: "2026-10-09T00:00:00Z" }],
  } }))
  emit("complete")
  terminal()
  await expect(target).toHaveCount(0)
  expect(observation.pageErrors).toEqual([])
  expect(await page.evaluate(() => (globalThis as unknown as { __resizeDiagnostics: { errors: unknown[] } }).__resizeDiagnostics.errors)).toEqual([])
})


test("inline caret wraps with CJK and Latin chunks at narrow widths", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  const { observation, emit, terminal } = await startCaretFixture(page)
  const target = page.locator('.assistant-streamdown > [data-assistant-reveal-block]:last-child [data-assistant-streaming-caret]')
  emit("token", "你好")
  await expect(target).toBeVisible()
  emit("token", "世界")
  await expect(target).toBeVisible()
  await target.evaluate((element) => {
    const paragraph = element.closest("p")! as typeof element
    paragraph.style.maxWidth = "19px"
  })
  await expectCaretPaint(page, target, true)
  // Chunk boundaries do not become no-wrap boxes. The empty caret box may
  // move to the next line naturally, while remaining inside the paragraph.
  emit("token", "\n\nwrap text ")
  const finalChunk = page.locator(".assistant-streamdown [data-assistant-reveal-chunk]").last()
  await expect(finalChunk).toHaveText("wrap text")
  await expect(target).toBeVisible()
  await target.evaluate((element) => {
    const paragraph = element.closest("p")! as typeof element
    paragraph.style.maxWidth = "9px"
  })
  await expectCaretPaint(page, target, true)
  await testInfo.attach("caret-animated-narrow-lines-fixture", {
    body: await page.screenshot({ animations: "disabled", path: testInfo.outputPath("caret-animated-narrow-lines-fixture.png") }),
    contentType: "image/png",
  })
  await page.route(`**/api/v1/history/${SESSION_ID}`, (route) => route.fulfill({ json: {
    session_id: SESSION_ID,
    messages: [{ id: "completed", role: "assistant", content: "你好世界\n\nwrap text ", created_at: "2026-10-09T00:00:00Z" }],
  } }))
  emit("complete")
  terminal()
  await expect(target).toHaveCount(0)
  expect(observation.pageErrors).toEqual([])
})

for (const theme of ["light", "dark"] as const) {
  test(`CJK chunk reveal preserves selection and settles prose in ${theme}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "paired-theme stream and prose evidence")
    await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: theme })
    await page.addInitScript((mode) => localStorage.setItem("copilot_ui_theme_v1", mode), theme)
    const { observation, emit, terminal } = await startCaretFixture(page)
    const active = page.locator(".assistant-streamdown-streaming")
    const prefix = "中文正文".repeat(8)
    emit("token", prefix)
    await expect(active).toHaveText(prefix)
    await page.evaluate(() => {
      const state = { starts: 0 }
      Object.assign(globalThis, { __proseReveal: state })
      document.addEventListener("animationstart", (event) => {
        if (event.animationName === "assistant-prose-reveal") state.starts += 1
      })
    })
    emit("token", "选中内容")
    const tail = active.locator("[data-assistant-reveal-chunk]").last()
    await expect(tail).toHaveText("选中内容")
    await expect.poll(() => page.evaluate(() =>
      (globalThis as unknown as { __proseReveal: { starts: number } }).__proseReveal.starts)).toBe(1)
    await tail.evaluate((element) => {
      const range = document.createRange()
      range.setStart(element.firstChild!, 0)
      range.setEnd(element.firstChild!, 2)
      document.getSelection()!.removeAllRanges()
      document.getSelection()!.addRange(range)
    })
    emit("token", "继续追加")
    await expect(tail).toHaveText("选中内容继续追加")
    expect(await page.evaluate(() => document.getSelection()!.toString())).toBe("选中")
    expect(await page.evaluate(() =>
      (globalThis as unknown as { __proseReveal: { starts: number } }).__proseReveal.starts)).toBe(1)
    await page.evaluate(() => document.getSelection()!.removeAllRanges())

    const additional = " English prose 最后一行不会添加不可见字符。".repeat(20)
    emit("token", additional)
    const source = prefix + "选中内容继续追加" + additional
    await expect(active).toHaveText(source)
    expect(await active.locator("[data-assistant-reveal-chunk]").count()).toBeLessThanOrEqual(
      Math.ceil(Array.from(source).length / 32),
    )
    expect(await active.locator("[data-sd-animate]").count()).toBe(0)
    for (const mode of ["reduced", "vdi"] as const) {
      await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" })
      await page.evaluate((safe) => document.body.setAttribute("data-vdi-safe", String(safe)), mode === "vdi")
      const paint = await active.locator("[data-assistant-reveal]").first().evaluate((node) => {
        const style = getComputedStyle(node)
        return { animation: style.animationName, filter: style.filter, transform: style.transform }
      })
      expect(paint).toEqual({ animation: "none", filter: "none", transform: "none" })
    }
    await page.setViewportSize({ width: 390, height: 900 })
    expect(await active.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
    await page.route(`**/api/v1/history/${SESSION_ID}`, (route) => route.fulfill({ json: {
      session_id: SESSION_ID,
      messages: [{ id: "completed", role: "assistant", content: source, created_at: "2026-10-09T00:00:00Z" }],
    } }))
    emit("complete")
    terminal()
    const settled = page.locator(".assistant-streamdown").filter({ hasText: prefix })
    await expect(settled).toBeVisible()
    await expect(settled.locator("[data-assistant-reveal-chunk]")).toHaveCount(0)
    expect(await settled.evaluate((node) => node.textContent!.includes("\u00a0"))).toBe(false)
    expect(await settled.locator("p").evaluate((node) => getComputedStyle(node).textWrapStyle)).toBe("pretty")
    await testInfo.attach(`stream-prose-${theme}-390`, {
      body: await page.screenshot({ fullPage: true }), contentType: "image/png",
    })
    expect(observation.pageErrors).toEqual([])
    expect(observation.consoleErrors).toEqual([])
  })
}
