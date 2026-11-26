import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { expectComposerText } from "./support/composer.js"

test("manages a loop from a busy chat without posting or queuing a turn", async ({ page }, testInfo) => {
  const sessionId = "all-surface-session"
  const endpoint = `/api/v1/sessions/${sessionId}/loop`
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, sessionId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const session = {
    id: sessionId, title: "Loop controls", title_version: 1,
    kind: "root", root_session_id: sessionId, parent_session_id: null, spawn_depth: 0,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-11-19T00:00:00Z", updated_at: "2026-11-19T00:00:00Z", message_count: 0,
    is_running: true, last_run_status: "running", has_pending_question: false, running_child_count: 0,
    placement: { kind: "local", host: "fixture" }, permission_mode: "default",
    root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 0,
    root_mode_birth_token: "a".repeat(64),
  }
  await page.route("**/api/v1/sessions?*", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind")
    const sessions = kind === "child" ? [] : [session]
    return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
  })
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) =>
    route.fulfill({ json: { session }, headers: { ETag: '"1"' } }))
  await page.route("**/api/v1/commands", (route) => route.fulfill({ json: { commands: [] } }))

  const posts: string[] = []
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === "POST" && path.startsWith("/api/v1/")) posts.push(path)
  })
  const controls: unknown[] = []
  await page.route(`**${endpoint}`, (route) => {
    const request = route.request()
    const command = request.method() === "GET" ? null : request.postDataJSON() as { action: string }
    controls.push(command ?? "status")
    if (controls.length === 1) return route.fulfill({ status: 404, json: { error: "Not found" } })
    const stopped = command?.action === "stop"
    return route.fulfill({ json: { session_id: sessionId, loop: {
      mode: command?.action === "start_adaptive" ? "adaptive" : "fixed",
      state: stopped ? "stopped" : "scheduled",
      next_fire_at: stopped ? null : "2026-11-19T13:00:00Z",
      last_run_status: command?.action === "start_adaptive" ? null : "failed",
    } } })
  })

  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner")).toContainText("Loop controls")
  const activeTurnStop = page.getByRole("button", { name: "停止生成", exact: true })
  await expect(activeTurnStop).toBeVisible()
  const input = page.getByRole("textbox", { name: "消息", exact: true })
  const loopOption = page.getByRole("option", { name: /^\/loop\s/ })
  await input.fill("/")
  await expect(loopOption).toBeVisible()
  await input.fill("/lo")
  await expect(loopOption).toBeEnabled()
  await expect(loopOption).toHaveAttribute("aria-selected", "true")
  await input.press("Enter")
  await expectComposerText(input, "/loop ")
  await expect(input).toBeFocused()
  await expect(loopOption).toHaveCount(0)
  expect(controls).toEqual([])
  expect(posts).toEqual([])

  const naturalPrompt = "/loop 每隔五分钟检查构建"
  await page.keyboard.insertText("每隔五分钟检查构建")
  await expectComposerText(input, naturalPrompt)
  await input.press("Enter")
  await expect(page.getByText("请等当前轮次结束后再发送循环请求。草稿已保留。")).toBeVisible()
  await expectComposerText(input, naturalPrompt)
  expect(posts).toEqual([])

  await input.fill("/loop 5m 检查部署")
  await input.press("Enter")
  await expect(page.getByText("会话不可用，或当前 Bamboo 版本暂不支持 /loop。")).toBeVisible()
  await expectComposerText(input, "/loop 5m 检查部署")

  await input.press("Enter")
  await expect(page.getByText("已安排循环任务。")).toBeVisible()
  await expectComposerText(input, "")

  await input.fill("/loop status")
  await input.press("Enter")
  await expectComposerText(input, "")
  await expect(page.getByText(/下次运行时间 .+ · 上次运行 失败/)).toBeVisible()

  await input.fill("/loop stop")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect(page.getByText("循环已停止。")).toBeVisible()
  await expect(activeTurnStop).toBeVisible()

  await input.fill("/loop 检查构建有无变化")
  await input.press("Enter")
  await expect(page.getByText(/已安排自动间隔循环。 下次运行时间 .+/)).toBeVisible()
  await expectComposerText(input, "")
  await expect(activeTurnStop).toBeVisible()
  const screenshot = testInfo.outputPath("adaptive-loop-notice.png")
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach("Adaptive loop scheduled during an active turn", { path: screenshot, contentType: "image/png" })
  expect(controls).toEqual([
    { action: "start", interval_seconds: 300, prompt: "检查部署" },
    { action: "start", interval_seconds: 300, prompt: "检查部署" },
    "status",
    { action: "stop" },
    { action: "start_adaptive", prompt: "检查构建有无变化" },
  ])
  expect(posts).toEqual([endpoint, endpoint, endpoint, endpoint])
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([`404 ${standaloneScenario.origin}${endpoint}`])
})

test("sends a natural loop prompt unchanged after confirming support in an idle chat", async ({ page }) => {
  const sessionId = "all-surface-session"
  const prompt = "/loop 每隔五分钟检查构建"
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, sessionId)
  const observation = await installArtifactRuntime(page, standaloneScenario)

  const requests: string[] = []
  await page.route(`**/api/v1/sessions/${sessionId}/loop`, (route) => {
    expect(route.request().method()).toBe("GET")
    requests.push("loop status")
    return route.fulfill({ json: { session_id: sessionId, loop: null } })
  })
  await page.route("**/api/v1/chat", (route) => {
    expect(route.request().method()).toBe("POST")
    expect(route.request().postDataJSON()).toMatchObject({ session_id: sessionId, message: prompt })
    requests.push("chat")
    return route.fulfill({ json: { session_id: sessionId, message_id: "spoken-loop-user", status: "success" } })
  })
  await page.route(`**/api/v1/execute/${sessionId}`, (route) => {
    expect(route.request().method()).toBe("POST")
    requests.push("execute")
    return route.fulfill({ json: { session_id: sessionId, status: "started", run_id: "spoken-loop-run", events_url: "/v2/stream" } })
  })

  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("heading", { name: "All-surface acceptance", exact: true })).toBeVisible()
  const input = page.getByRole("textbox", { name: "消息", exact: true })
  await input.fill("/loop")
  await page.getByRole("option", { name: /^\/loop\s/ }).click()
  await expectComposerText(input, "/loop ")
  expect(requests).toEqual([])
  await page.keyboard.insertText("每隔五分钟检查构建")
  await expectComposerText(input, prompt)
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => requests).toEqual(["loop status", "chat", "execute"])
  await expectComposerText(input, "")
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
