import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

test("Stop is a primary realtime control and never enters the message queue", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const session = {
    id: "all-surface-session",
    title: "Immediate Stop acceptance",
    title_version: 1,
    kind: "root",
    root_session_id: "all-surface-session",
    parent_session_id: null,
    model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-19T00:00:00Z",
    updated_at: "2026-09-19T00:00:00Z",
    last_activity_at: "2026-09-19T00:00:00Z",
    message_count: 0,
    is_running: true,
    last_run_status: "running",
    has_pending_question: false,
    permission_mode: "default",
  }

  await page.route("**/api/v1/bamboo/permission/default-session-mode", (route) =>
    route.fulfill({
      json: {
        mode: "default",
        revision: 1,
        loaded_at: "2026-09-19T00:00:00Z",
        status: "ready",
      },
    }),
  )
  await page.route("**/api/v1/sessions?*", (route) =>
    route.fulfill({ json: { sessions: [session], total: 1, limit: 200, offset: 0 } }),
  )
  await page.route("**/api/v1/sessions/all-surface-session", (route) =>
    route.fulfill({ json: { session }, headers: { ETag: '"1"' } }),
  )
  await page.route("**/api/v1/task/all-surface-session", (route) =>
    route.fulfill({ json: { session_id: "all-surface-session", items: [] } }),
  )

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  const stop = page.getByRole("button", { name: "停止生成", exact: true })
  await expect(stop).toBeVisible()

  const input = page.getByRole("textbox", { name: "消息", exact: true })
  await input.fill("这条消息只用于同时显示发送与停止控件")
  const queue = page.getByRole("button", { name: "加入队列", exact: true })
  await expect(queue).toBeVisible()

  const [stopBackground, queueBackground, squareFill] = await Promise.all([
    stop.evaluate(
      (element) => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor,
    ),
    queue.evaluate(
      (element) => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor,
    ),
    stop
      .locator("svg")
      .evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).fill),
  ])
  expect(stopBackground).toBe(queueBackground)
  expect(squareFill).toBe("rgb(255, 255, 255)")
  await testInfo.attach("solid-primary-stop", {
    body: await page.screenshot(),
    contentType: "image/png",
  })

  await stop.click()
  await expect(stop).toBeHidden()
  await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeVisible()
  await expect(input).toHaveValue("这条消息只用于同时显示发送与停止控件")
  await expect.poll(() => observation.clientFrames).toContainEqual({
    type: "stop",
    session_id: "all-surface-session",
  })
  expect(
    observation.httpRequests.some(
      ({ method, url }) => method === "POST" && new URL(url).pathname.includes("/api/v1/stop/"),
    ),
  ).toBe(false)
})
