import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { expectComposerText } from "./support/composer.js"

test("compacts from the composer without posting a turn and preserves failed drafts", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const sessionId = "all-surface-session"
  const endpoint = `/api/v1/sessions/${sessionId}/compact`
  await page.route("**/api/v1/commands", (route) => route.fulfill({ json: { commands: [] } }))
  const posts: string[] = []
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname
    if (request.method() === "POST" && pathname.startsWith("/api/v1/")) posts.push(pathname)
  })
  let compactCalls = 0
  let confirm: () => void = () => {}
  const confirmation = new Promise<void>((resolve) => { confirm = resolve })
  await page.route(`**${endpoint}`, async (route) => {
    compactCalls += 1
    if (compactCalls === 1) {
      await route.fulfill({ status: 404, json: { error: "Not found" } })
      return
    }
    if (compactCalls === 2) {
      await route.fulfill({ status: 422, json: { error: {
        code: "context_summary_empty", type: "api_error",
        message: "The model returned no summary. Lower the reasoning effort for the model used for context compression, then try again.",
      } } })
      return
    }
    await confirmation
    await route.fulfill({ json: {
      session_id: sessionId, status: "compacted", usage_before_percent: 73.2, usage_after_percent: 24,
      token_usage: { total_tokens: 24000, max_context_tokens: 100000, system_tokens: 1000, summary_tokens: 1000,
        window_tokens: 22000, budget_limit: 96000, truncation_occurred: false, segments_removed: 0 },
    } })
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner")).toContainText("All-surface acceptance")
  const input = page.getByRole("textbox", { name: "消息", exact: true })
  const command = page.getByRole("button", { name: /^\/compact(?:\s|$)/ })
  await input.fill("/co")
  await expect(command).toBeEnabled()
  if (testInfo.project.name === "desktop-chromium") {
    const path = testInfo.outputPath("compact-command-menu.png")
    await page.screenshot({ path })
    await testInfo.attach("compact-command-menu", { path, contentType: "image/png" })
  }

  // A failed menu action keeps the full command available for retry.
  await command.click()
  const error = page.getByRole("alert").filter({ hasText: "会话不可用，或当前 Bamboo 版本暂不支持 /compact。" })
  await expect(error).toBeVisible()
  await expectComposerText(input, "/compact")
  expect(posts).toEqual([endpoint])
  await error.locator("../..").getByRole("button", { name: "关闭", exact: true }).click()

  await input.press("Enter")
  const emptySummary = page.getByRole("alert").filter({ hasText: "本次未能压缩上下文。聊天记录已保留。" })
  await expect(emptySummary).toBeVisible()
  await expect(emptySummary).not.toContainText("Lower the reasoning effort")
  await expectComposerText(input, "/compact")
  expect(posts).toEqual([endpoint, endpoint])
  await emptySummary.locator("../..").getByRole("button", { name: "关闭", exact: true }).click()

  // Enter retries the dedicated operation with the preserved command.
  try {
    await input.press("Enter")
    await expect(page.getByText("正在压缩上下文…")).toBeVisible()
    await expect(input).toHaveAttribute("aria-busy", "true")
  } finally {
    confirm()
  }
  await expectComposerText(input, "")
  await expect(page.getByText("已压缩上下文，估算占用从 73.2% 降至 24%。")).toBeVisible()
  await expect(page.getByRole("button", { name: "上下文用量", exact: true })).toHaveAttribute("title", /24%/)
  await expect(input).toHaveAttribute("aria-busy", "false")
  expect(posts).toEqual([endpoint, endpoint, endpoint])
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([
    `404 ${standaloneScenario.origin}${endpoint}`,
    `422 ${standaloneScenario.origin}${endpoint}`,
  ])
})

test("recovers live compression and only shows an applied strategy from a saved result", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario, [], {
    sessionFeatures: ["session_compaction_status"],
  })

  const sessionId = "all-surface-session"
  const previous = { id: "previous", strategy: "summary" }
  const saved = { id: "attempt", strategy: "message_summary" }
  const progress = {
    id: "attempt", strategy: "message_summary", phase: "summarizing", part: 2, total: 4, elapsed_ms: 38000,
  }
  let active: typeof progress | null = progress
  let applied = previous
  await page.route(`**/api/v1/sessions/${sessionId}/compact`, async (route) => {
    expect(route.request().method()).toBe("GET")
    await route.fulfill({ json: { session_id: sessionId, configured_strategy: "message_summary", active, applied } })
  })
  const notice = page.getByTestId("context-compression-notice")
  const oldStrategy = "上次压缩采用完整对话摘要"
  const newStrategy = "上次压缩采用消息正文摘要"

  await page.goto(standaloneScenario.entryUrl)
  await expect(notice).toContainText("正在生成摘要，第 2/4 段")
  await expect(notice).toContainText("已等待 38 秒")
  await expect(notice).toContainText(oldStrategy)
  await expect(notice).toContainText("本次压缩采用消息正文摘要")
  await expect(notice).not.toContainText(newStrategy)
  if (testInfo.project.name === "desktop-chromium") {
    const path = testInfo.outputPath("compression-progress.png")
    await page.screenshot({ path })
    await testInfo.attach("compression-progress", { path, contentType: "image/png" })
  }

  active = null
  await page.reload()
  await expect(notice).toContainText(oldStrategy)
  await expect(notice).not.toContainText("正在生成摘要")
  await expect(notice).toContainText("下次压缩将使用消息正文摘要")
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveAttribute("aria-busy", "false")

  active = progress
  await page.reload()
  await expect(notice).toContainText("正在生成摘要，第 2/4 段")
  active = null
  applied = saved
  await expect(notice).toContainText(newStrategy)
  await expect(notice).not.toContainText("下次压缩将使用")

  await page.reload()
  await expect(notice).toContainText(newStrategy)
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
