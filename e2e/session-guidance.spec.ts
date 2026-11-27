import { workbenchPanel } from "./support/workbench.js"
import { expectComposerText } from "./support/composer.js"
import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario, embeddedScenario, secureRemoteScenario } from "./support/artifactRuntime.js"

for (const scenario of [standaloneScenario, embeddedScenario, secureRemoteScenario]) {
  test(`${scenario.name}: guidance survives reload, can be withdrawn, and goal recovery is explicit`, async ({ page }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
    const observation = await installArtifactRuntime(page, scenario)
    const session = {
      id: "all-surface-session", title: "All-surface acceptance", title_version: 1,
      kind: "root", root_session_id: "all-surface-session", parent_session_id: null,
      root_orchestration_only: false, thinking_mode: "standard",
      root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
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
    await page.route("**/api/v1/sessions?*", (route) => route.fulfill({
      json: { sessions: [session], total: 1, limit: 200, offset: 0 },
    }))
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
    const queuedMessage = surface.locator("[data-queued-guidance]")
    const draftImage = surface.locator("[data-composer-attachments]").getByAltText("queued.png", { exact: true })
    await expect(input).toBeVisible()
    await expect(pending).toHaveCount(0)
    await expect(surface.getByRole("button", { name: "停止生成", exact: true })).toBeVisible()
    await expect(surface.getByRole("textbox", { name: "指导内容" })).toHaveCount(0)
    await surface.getByRole("combobox", { name: "发送时机" }).selectOption("after_run")
    await surface.locator('input[type="file"]').setInputFiles({ name: "queued.png", mimeType: "image/png", buffer: pixel })
    await expect(draftImage).toBeVisible()
    await input.fill("保留已有内容，并补充验证结果。")
    await surface.getByRole("button", { name: "加入队列", exact: true }).click()
    await expectComposerText(input, "")
    expect(queue[0]?.mode).toBe("after_run")
    expect(queuedImages[0]?.base64).toBe(pixel.toString("base64"))
    await expect(draftImage).toHaveCount(0)
    await expect(queuedMessage.getByText("保留已有内容，并补充验证结果。", { exact: true })).toBeVisible()
    await expect(queuedMessage.getByAltText("queued.png", { exact: true })).toBeVisible()
    await pending.locator("summary").click()
    await expect(pending.getByText("保留已有内容，并补充验证结果。", { exact: true })).toBeVisible()
    await expect(pending.getByAltText("待发图片 1")).toBeVisible()
    const pendingBox = await pending.boundingBox()
    const inputBox = await input.boundingBox()
    expect(pendingBox!.y + pendingBox!.height).toBeLessThanOrEqual(inputBox!.y)
    const messageArea = surface.locator("div.min-h-0.flex-1.overflow-y-auto").last()
    const messageBox = await messageArea.boundingBox()
    expect(messageBox!.height).toBeGreaterThan(100)
    expect(messageBox!.y + messageBox!.height).toBeLessThanOrEqual(pendingBox!.y)
    await testInfo.attach("pending-above-composer", { body: await page.screenshot(), contentType: "image/png" })
    await page.reload({ waitUntil: "domcontentloaded" })
    await pending.locator("summary").click()
    await expect(pending.getByText("保留已有内容，并补充验证结果。", { exact: true })).toBeVisible()
    await expect(pending.getByAltText("待发图片 1")).toBeVisible()
    await expect(queuedMessage.getByText("保留已有内容，并补充验证结果。", { exact: true })).toBeVisible()
    await surface.getByRole("button", { name: "撤回", exact: true }).click()
    await expect(pending).toHaveCount(0)
    await expect(queuedMessage).toHaveCount(0)
    await expect(surface.getByText("未能撤回，消息可能已经开始应用。", { exact: true })).toHaveCount(0)
    await expect(surface.getByText("保留已有内容，并补充验证结果。", { exact: true })).toHaveCount(0)
    await surface.locator('input[type="file"]').setInputFiles({ name: "only-image.png", mimeType: "image/png", buffer: pixel })
    await surface.getByRole("combobox", { name: "发送时机" }).selectOption("after_round")
    await surface.getByRole("button", { name: "加入队列", exact: true }).click()
    await expect.poll(() => queue.length).toBe(1)
    expect(queue[0].text).toBe("")
    expect(queue[0].mode).toBe("after_round")
    await pending.locator("summary").click()
    await expect(pending.getByAltText("待发图片 1")).toBeVisible()
    await expect(queuedMessage.getByAltText("only-image.png", { exact: true })).toBeVisible()
    await surface.getByRole("button", { name: "撤回", exact: true }).click()
    await expect(pending).toHaveCount(0)
    await expect(surface.getByText("未能撤回，消息可能已经开始应用。", { exact: true })).toHaveCount(0)
    await surface.getByRole("button", { name: "打开侧边面板", exact: true }).click()
    await workbenchPanel(surface).getByRole("button", { name: /检查器.*查看当前会话/ }).click()
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

test("keeps queued text and images after an unconfirmed reply and clears them only after the same request is acknowledged", async ({ page }) => {
  const id = "all-surface-session"
  await page.addInitScript((sessionId) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", sessionId)
  }, id)
  const runtime = await installArtifactRuntime(page, standaloneScenario)
  const session = {
    id, title: "Guidance receipt", kind: "root", root_session_id: id, parent_session_id: null, title_version: 1,
    root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z",
    permission_mode: "default", is_running: true, last_run_status: "running",
  }
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({
    json: { sessions: new URL(route.request().url()).searchParams.get("kind") === "child" ? [] : [session], total: 1, limit: 200, offset: 0 },
  }))
  await page.route(`**/api/v1/sessions/${id}`, (route) => route.fulfill({ json: { session }, headers: { ETag: '"1"' } }))
  const requests: Array<{ id: string; text: string; mode: string; images: Array<{ base64: string; type: string; name: string }> }> = []
  await page.route(`**/api/v1/sessions/${id}/guidance`, (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { messages: [] } })
    const body = route.request().postDataJSON() as (typeof requests)[number]
    requests.push(body)
    const receipt = requests.length === 1 ? "unrelated-receipt" : body.id
    return route.fulfill({ status: 202, json: { id: receipt, activation_pending: false } })
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner")).toContainText(session.title)
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeEnabled()
  const editor = page.getByRole("textbox", { name: "消息", exact: true })
  await editor.fill("请结合图片继续")
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
  await page.locator('input[type="file"]').setInputFiles({ name: "retry.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") })
  const preview = page.locator("[data-composer-attachments]").getByAltText("retry.png", { exact: true })
  await expect(preview).toBeVisible()
  const queue = page.getByRole("button", { name: "加入队列", exact: true })
  await queue.click()
  const alert = page.getByRole("alert").filter({ hasText: "未能确认发送" })
  await expect(alert).toBeVisible()
  await expectComposerText(editor, "请结合图片继续")
  await expect(preview).toBeVisible()
  expect(requests).toEqual([expect.objectContaining({
    id: expect.any(String), text: "请结合图片继续", mode: "after_round",
    images: [expect.objectContaining({ name: "retry.png", type: "image/png", base64 })],
  })])

  await queue.click()
  await expect.poll(() => requests).toEqual([requests[0], requests[0]])
  await expectComposerText(editor, "")
  await expect(preview).toHaveCount(0)
  await expect(page.locator("[data-queued-guidance]").getByAltText("retry.png", { exact: true })).toBeVisible()
  await expect(alert).toHaveCount(0)
  expect(runtime.httpRequests.filter(({ method, url }) => method === "POST"
    && ["chat", "execute"].includes(new URL(url).pathname.split("/")[3]))).toEqual([])
  expect(runtime.pageErrors).toEqual([])
})
