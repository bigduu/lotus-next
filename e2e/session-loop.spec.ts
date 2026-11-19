import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { expectComposerText } from "./support/composer.js"

test("manages a loop from a busy chat without posting or queuing a turn", async ({ page }) => {
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
      state: stopped ? "stopped" : "scheduled",
      next_fire_at: stopped ? null : "2026-11-19T13:00:00Z",
      last_run_status: "failed",
    } } })
  })

  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner")).toContainText("Loop controls")
  const activeTurnStop = page.getByRole("button", { name: "停止生成", exact: true })
  await expect(activeTurnStop).toBeVisible()
  const input = page.getByRole("textbox", { name: "消息", exact: true })
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
  expect(controls).toEqual([
    { action: "start", interval_seconds: 300, prompt: "检查部署" },
    { action: "start", interval_seconds: 300, prompt: "检查部署" },
    "status",
    { action: "stop" },
  ])
  expect(posts).toEqual([endpoint, endpoint, endpoint])
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([`404 ${standaloneScenario.origin}${endpoint}`])
})
