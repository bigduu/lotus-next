import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario, embeddedScenario, secureRemoteScenario } from "./support/artifactRuntime.js"

for (const scenario of [standaloneScenario, embeddedScenario, secureRemoteScenario]) {
  test(`${scenario.name}: guidance survives reload, can be withdrawn, and goal recovery is explicit`, async ({ page }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
    const observation = await installArtifactRuntime(page, scenario)
    const session = {
      id: "all-surface-session", title: "All-surface acceptance", title_version: 1,
      kind: "root", root_session_id: "all-surface-session", parent_session_id: null,
      model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
      created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z", last_activity_at: "2026-09-07T00:00:00Z",
      message_count: 0, is_running: true, last_run_status: "running", has_pending_question: false,
      permission_mode: "default", gold_config: { enabled: true, goal: "完成验收", auto_continue_enabled: true,
        ...(scenario.name === "secure-remote" ? { recovery: { max_attempts: 2, max_elapsed_seconds: 120 } } : {}),
      },
    }
    await page.route("**/api/v1/task/all-surface-session", (route) => route.fulfill({ json: { session_id: "all-surface-session", items: [] } }))
    let queue: Array<{ id: string; text: string; created_at: string }> = []
    let goalPatch: unknown
    await page.route("**/api/v1/sessions", (route) => route.fulfill({ json: { sessions: [session] } }))
    await page.route("**/api/v1/sessions/all-surface-session", async (route) => {
      if (route.request().method() === "PATCH") {
        goalPatch = route.request().postDataJSON()
        await route.fulfill({ json: {} })
      } else await route.fulfill({ json: { session }, headers: { ETag: '"1"' } })
    })
    await page.route("**/api/v1/sessions/all-surface-session/guidance", async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { id: string; text: string }
        queue.push({ ...body, created_at: new Date().toISOString() })
        await route.fulfill({ status: 202, json: { id: body.id, activation_pending: false } })
      } else await route.fulfill({ json: { messages: queue } })
    })
    await page.route("**/api/v1/sessions/all-surface-session/guidance/*", async (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1)
      queue = queue.filter((message) => message.id !== id)
      await route.fulfill({ status: 204 })
    })
    await page.goto(scenario.entryUrl, { waitUntil: "domcontentloaded" })
    const surface = scenario.embedded ? page.frameLocator('iframe[title="Lotus Next embedded surface"]') : page
    const input = surface.getByRole("textbox", { name: "指导内容" })
    await expect(input).toBeVisible()
    await expect(surface.getByRole("button", { name: "停止生成", exact: true })).toBeVisible()
    await input.fill("保留已有内容，并补充验证结果。")
    await surface.getByRole("button", { name: "发送指导", exact: true }).click()
    await expect(input).toHaveValue("")
    await expect(surface.getByText("待应用：保留已有内容，并补充验证结果。", { exact: true })).toBeVisible()
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(surface.getByText("待应用：保留已有内容，并补充验证结果。", { exact: true })).toBeVisible()
    await surface.getByRole("button", { name: "撤回", exact: true }).click()
    await expect(surface.getByText("待应用：保留已有内容，并补充验证结果。", { exact: true })).toHaveCount(0)
    await surface.getByRole("button", { name: "检查器", exact: true }).click()
    const goal = surface.locator("section").filter({ has: surface.getByText("目标", { exact: true }) })
    await goal.getByRole("button", { name: "编辑", exact: true }).click()
    await goal.getByRole("checkbox", { name: "无输出超时后尝试恢复" }).check()
    await goal.getByRole("button", { name: "保存", exact: true }).click()
    await expect.poll(() => goalPatch).toMatchObject({ gold_config: { recovery: scenario.name === "secure-remote"
      ? { max_attempts: 2, max_elapsed_seconds: 120 }
      : { max_attempts: 3, max_elapsed_seconds: 900 } } })
    await testInfo.attach("guidance-goal-layout", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" })
    expect(observation.pageErrors).toEqual([])
    expect(observation.errorResponses).toEqual([])
  })
}
