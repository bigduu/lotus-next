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
    const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    let queue: Array<{ id: string; text: string; created_at: string; mode: string; images: string[] }> = []
    let queuedImages: Array<{ base64: string }> = []
    await page.route("**/api/v1/sessions/all-surface-session/attachments/*", (route) => route.fulfill({ body: pixel, contentType: "image/png" }))
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
        const body = route.request().postDataJSON() as { id: string; text: string; mode: string; images: Array<{ base64: string }> }
        queuedImages = body.images
        queue.push({ ...body, images: body.images.map((_image, index) => `image-${index}`), created_at: new Date().toISOString() })
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
    const input = surface.getByRole("textbox", { name: "消息", exact: true })
    const pending = surface.getByLabel("待发送队列", { exact: true })
    await expect(input).toBeVisible()
    await expect(pending).toHaveCount(0)
    await expect(surface.getByRole("button", { name: "停止生成", exact: true })).toBeVisible()
    await expect(surface.getByRole("textbox", { name: "指导内容" })).toHaveCount(0)
    await surface.getByRole("combobox", { name: "发送时机" }).selectOption("after_run")
    await surface.locator('input[type="file"]').setInputFiles({ name: "queued.png", mimeType: "image/png", buffer: pixel })
    await expect(surface.getByAltText("queued.png", { exact: true })).toBeVisible()
    await input.fill("保留已有内容，并补充验证结果。")
    await surface.getByRole("button", { name: "加入队列", exact: true }).click()
    await expect(input).toHaveValue("")
    expect(queue[0]?.mode).toBe("after_run")
    expect(queuedImages[0]?.base64).toBe(pixel.toString("base64"))
    await expect(surface.getByAltText("queued.png", { exact: true })).toHaveCount(0)
    await surface.getByText("待发 1", { exact: true }).click()
    await expect(surface.getByText("保留已有内容，并补充验证结果。", { exact: true })).toBeVisible()
    await expect(surface.getByAltText("待发图片 1")).toBeVisible()
    const pendingBox = await pending.boundingBox()
    const inputBox = await input.boundingBox()
    expect(pendingBox!.y + pendingBox!.height).toBeLessThanOrEqual(inputBox!.y)
    const messageArea = surface.locator("div.min-h-0.flex-1.overflow-y-auto").last()
    const messageBox = await messageArea.boundingBox()
    expect(messageBox!.height).toBeGreaterThan(100)
    expect(messageBox!.y + messageBox!.height).toBeLessThanOrEqual(pendingBox!.y)
    await testInfo.attach("pending-above-composer", { body: await page.screenshot(), contentType: "image/png" })
    await page.reload({ waitUntil: "domcontentloaded" })
    await surface.getByText("待发 1", { exact: true }).click()
    await expect(surface.getByText("保留已有内容，并补充验证结果。", { exact: true })).toBeVisible()
    await expect(surface.getByAltText("待发图片 1")).toBeVisible()
    await surface.getByRole("button", { name: "撤回", exact: true }).click()
    await expect(surface.getByText("保留已有内容，并补充验证结果。", { exact: true })).toHaveCount(0)
    await expect(pending).toHaveCount(0)
    await surface.locator('input[type="file"]').setInputFiles({ name: "only-image.png", mimeType: "image/png", buffer: pixel })
    await surface.getByRole("combobox", { name: "发送时机" }).selectOption("after_round")
    await surface.getByRole("button", { name: "加入队列", exact: true }).click()
    await expect.poll(() => queue.length).toBe(1)
    expect(queue[0].text).toBe("")
    expect(queue[0].mode).toBe("after_round")
    await surface.getByText("待发 1", { exact: true }).click()
    await expect(surface.getByAltText("待发图片 1")).toBeVisible()
    await surface.getByRole("button", { name: "撤回", exact: true }).click()
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
