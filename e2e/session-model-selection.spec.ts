import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

test("an existing session saves its model before the next request", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop composer workflow")
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const session = {
    id: "all-surface-session", title: "Model selection", kind: "root", title_version: 1,
    root_session_id: "all-surface-session", parent_session_id: null, spawn_depth: 0,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-25T00:00:00Z", updated_at: "2026-09-25T00:00:00Z",
    last_activity_at: "2026-09-25T00:00:00Z", message_count: 0, has_attachments: false,
    is_running: false, last_run_status: "completed", permission_mode: "default",
  }
  const descriptor = (model: string) => ({
    reference: { provider: "fixture-provider", model }, display_name: model,
    provider_display_name: "Fixture provider",
    capabilities: { supports_tools: true, supports_vision: false, supports_reasoning: true },
  })
  const models = [descriptor("fixture-model"), descriptor("grok-4.7")]
  await page.route("**/api/v1/bamboo/provider-catalog/fetch-models", (route) =>
    route.fulfill({ json: { fetched: [{ provider: "fixture-provider", models }] } }),
  )
  await page.route("**/api/v1/bamboo/provider-catalog", (route) =>
    route.fulfill({ json: { providers: [], models } }),
  )
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({
    json: { sessions: [session], total: 1, limit: 200, offset: 0 },
  }))
  const patches: Array<Record<string, unknown>> = []
  let releasePatch!: () => void
  const patchGate = new Promise<void>((resolve) => { releasePatch = resolve })
  await page.route("**/api/v1/sessions/all-surface-session", async (route) => {
    if (route.request().method() === "PATCH") {
      patches.push(route.request().postDataJSON() as Record<string, unknown>)
      await patchGate
      session.model = "grok-4.7"
      session.model_ref = { provider: "fixture-provider", model: "grok-4.7" }
    }
    await route.fulfill({ json: { session }, headers: { ETag: '"2"' } })
  })
  const chatRequests: Array<Record<string, unknown>> = []
  const executeRequests: Array<Record<string, unknown>> = []
  await page.route("**/api/v1/chat", async (route) => {
    chatRequests.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ json: { session_id: session.id, status: "success" } })
  })
  await page.route("**/api/v1/execute/all-surface-session", async (route) => {
    executeRequests.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ json: { status: "started", session_id: session.id } })
  })

  try {
    await page.goto(standaloneScenario.entryUrl)
    const currentModel = page.locator('button[data-slot="popover-trigger"]').filter({ hasText: "fixture-model" })
    await expect(currentModel).toBeVisible()
    await currentModel.click()
    await page.getByRole("searchbox", { name: "搜索模型" }).fill("grok")
    await page.locator("[data-model-option]").filter({ hasText: "grok-4.7" }).click()

    await expect.poll(() => patches.length).toBe(1)
    expect(patches[0]).toMatchObject({
      model: "grok-4.7", provider: "fixture-provider",
      model_ref: { provider: "fixture-provider", model: "grok-4.7" },
    })
    await expect(currentModel).toBeDisabled()
    expect(chatRequests).toHaveLength(0)

    releasePatch()
    await expect(page.locator('button[data-slot="popover-trigger"]').filter({ hasText: "grok-4.7" })).toBeEnabled()
    await page.getByRole("textbox", { name: "消息", exact: true }).fill("Continue with the selected model")
    await page.getByRole("button", { name: "发送消息", exact: true }).click()
    await expect.poll(() => chatRequests.length).toBe(1)
    await expect.poll(() => executeRequests.length).toBe(1)
    expect(chatRequests[0]).toMatchObject({
      session_id: session.id, model: "grok-4.7",
      model_ref: { provider: "fixture-provider", model: "grok-4.7" },
    })
    expect(executeRequests[0]).toMatchObject({
      model: "grok-4.7", model_ref: { provider: "fixture-provider", model: "grok-4.7" },
    })
    await testInfo.attach("session-model-selected", {
      body: await page.screenshot(), contentType: "image/png",
    })
    expect(observation.pageErrors).toEqual([])
    expect(observation.errorResponses).toEqual([])
  } finally {
    releasePatch()
  }
})
