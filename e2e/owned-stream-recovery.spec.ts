import { expect, test, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

for (const outcome of ["interrupted", "suspended", "resumed"] as const) {
  test(`an owned run recovers without terminal frames (${outcome})`, async ({ page }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
    const observation = await installArtifactRuntime(page, standaloneScenario)
    let socket: WebSocketRoute | undefined
    let subscribed = false
    let subscriptions = 0
    let admissions = 0
    let executions = 0
    let sequence = 0
    await page.routeWebSocket(/.*/, (webSocket) => {
      socket = webSocket
      webSocket.onMessage((raw) => {
        const frame = JSON.parse(String(raw)) as { type?: string; ch?: string }
        if (frame.type === "hello") webSocket.send(JSON.stringify({ type: "welcome" }))
        if (frame.type === "ping") webSocket.send(JSON.stringify({ type: "pong" }))
        if (frame.type === "subscribe" && frame.ch === "agent.all-surface-session") {
          subscribed = true
          subscriptions++
        }
      })
    })
    const session = {
      id: "all-surface-session", title: "Missing terminal recovery", title_version: 1,
      kind: "root", root_session_id: "all-surface-session", parent_session_id: null,
      model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
      created_at: "2026-10-09T00:00:00Z", updated_at: "2026-10-09T00:00:00Z",
      last_activity_at: "2026-10-09T00:00:00Z", message_count: 0,
      is_running: false, last_run_status: "completed", has_pending_question: false,
      running_child_count: 0,
      permission_mode: "default", root_orchestration_only: false, thinking_mode: "standard",
      root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64), reasoning_effort: "medium",
    }
    const history: unknown[] = []
    await page.route("**/api/v1/sessions?*", (route) => route.fulfill({
      json: { sessions: [session], total: 1, limit: 200, offset: 0 },
    }))
    await page.route("**/api/v1/sessions/all-surface-session", (route) => route.fulfill({ json: { session }, headers: { ETag: '"1"' } }))
    await page.route("**/api/v1/history/all-surface-session", (route) => route.fulfill({
      json: { session_id: session.id, messages: history },
    }))
    await page.route("**/api/v1/task/all-surface-session", (route) => route.fulfill({
      json: { session_id: session.id, items: [] },
    }))
    await page.route("**/api/v1/chat", (route) => {
      admissions++
      session.is_running = true
      const id = `user-${admissions}`
      history.push({ id, role: "user", content: route.request().postDataJSON().message, created_at: session.updated_at })
      return route.fulfill({ json: { session_id: session.id, status: "success", message_id: id } })
    })
    await page.route("**/api/v1/execute/all-surface-session", (route) => {
      executions++
      return route.fulfill({ json: { session_id: session.id, status: "started", run_id: `run-${executions}` } })
    })
    await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
    const input = page.getByRole("textbox", { name: "消息", exact: true })
    await expect(input).toBeVisible()
    await expect(page.getByRole("combobox", { name: "权限模式", exact: true })).toBeEnabled()
    await input.fill("检查工作树状态")
    await page.getByRole("button", { name: "发送消息", exact: true }).click()
    await expect.poll(() => subscribed).toBe(true)
    const stop = page.getByRole("button", { name: "停止生成", exact: true })
    await expect(stop).toBeVisible()
    socket!.send(JSON.stringify({ ch: `agent.${session.id}`, seq: ++sequence,
      event: { type: "token", content: "正在检查，尚未完成。" } }))
    await expect(page.locator(".assistant-streamdown")).toContainText("尚未完成")

    // Neither scenario publishes a semantic terminal or a terminal control.
    session.is_running = false
    if (outcome !== "interrupted") {
      session.last_run_status = "suspended"
      session.running_child_count = 1
      history.push({ id: "waiting-reply", role: "assistant", content: "正在检查，尚未完成。", created_at: session.updated_at })
    }
    await expect(stop).toBeHidden({ timeout: 15_000 })
    if (outcome === "interrupted") await expect(page.getByRole("alert")).toContainText("消息已发送，但生成中断")
    else await expect(page.getByRole("alert")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeVisible()
    await expect(page.getByText("检查工作树状态", { exact: true })).toBeVisible()
    await expect(page.locator('[data-assistant-typewriter-caret-target="true"]')).toHaveCount(0)
    if (outcome !== "interrupted") await expect(page.locator(".assistant-streamdown")).toContainText("正在检查，尚未完成。")
    await testInfo.attach(`owned-run-${outcome}`, {
      body: await page.screenshot({ path: testInfo.outputPath(`owned-run-${outcome}.png`) }),
      contentType: "image/png",
    })

    if (outcome === "suspended") {
      await input.fill("进展如何？")
      await page.getByRole("button", { name: "发送消息", exact: true }).click()
      await expect.poll(() => admissions).toBe(2)
      await expect.poll(() => executions).toBe(2)
      await expect(stop).toBeVisible()
    } else if (outcome === "resumed") {
      session.is_running = true
      socket!.send(JSON.stringify({ ch: "feed", seq: 1, event: {
        seq: 1, ts: session.updated_at, session_id: session.id,
        event: { type: "execution_started", run_id: "background-resume", session_id: session.id },
      } }))
      await expect.poll(() => subscriptions).toBe(2)
      socket!.send(JSON.stringify({ ch: `agent.${session.id}`, seq: ++sequence,
        event: { type: "token", content: "后台代理已返回，继续处理结果。" } }))
      await expect(page.locator(".assistant-streamdown").last()).toContainText("后台代理已返回，继续处理结果。")
      expect(executions).toBe(1)
      expect(admissions).toBe(1)
    }
    expect(observation.pageErrors).toEqual([])
    expect(observation.httpRequests.some(({ method, url }) => method === "POST" && new URL(url).pathname.includes("/stop/"))).toBe(false)
  })
}
