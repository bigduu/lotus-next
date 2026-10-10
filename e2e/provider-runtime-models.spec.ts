import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const openProviders = async (page: Page) => {
  const settings = page.getByRole("button", { name: "系统设置", exact: true })
  const bounds = await settings.boundingBox()
  if (!bounds || bounds.x < 0 || bounds.x + bounds.width > (page.viewportSize()?.width ?? Infinity)) {
    await page.getByRole("button", { name: "菜单", exact: true }).click()
  }
  await settings.click()
  const categories = page.locator("#settings-category")
  await categories.waitFor({ state: "attached" })
  if (await categories.isVisible()) await categories.selectOption("providers")
  else await page.getByRole("button", { name: "提供方", exact: true }).click()
}

// Stateful HTTP fixtures verify the UI contract; backend admission has separate Rust coverage.
test("discovery requires explicit admission and preserves custom models after reload", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const custom = "relay-custom/model-without-upstream-entry"
  const chosen = "relay-usable-model"
  const excluded = "relay-unavailable-model"
  const otherOnly = "other-provider-only"
  const instance = {
    id: "fixture-provider", type: "openai", label: "Relay provider", enabled: true,
    config: { model: "fixture-model", api_key: "****...****", runtime_models: ["fixture-model"] },
  }
  const other = {
    id: "other-provider", type: "openai", label: "Other provider", enabled: true,
    config: { model: otherOnly, runtime_models: [otherOnly] },
  }
  const descriptor = (provider: string, model: string) => ({
    reference: { provider, model }, display_name: model, provider_display_name: provider,
    capabilities: { supports_tools: true, supports_vision: false, supports_reasoning: false },
  })
  const candidates = [chosen, excluded, ...Array.from({ length: 120 }, (_, i) => `relay-candidate-${i}`)]
  const writes: Array<Record<string, unknown>> = []
  let discoveries = 0
  await page.route("**/api/v1/bamboo/settings/provider-instances", (route) => route.fulfill({ json: {
    default_provider_instance_id: instance.id, instances: [instance, other],
    defaults: { chat: { provider: instance.id, model: "fixture-model" } },
    features: { provider_model_ref: true },
  } }))
  await page.route("**/api/v1/bamboo/settings/provider-instances/fixture-provider", async (route) => {
    expect(route.request().method()).toBe("PUT")
    const patch = route.request().postDataJSON() as Record<string, unknown>
    writes.push(patch)
    instance.config = { ...instance.config, ...(patch.config as typeof instance.config) }
    await route.fulfill({ json: instance })
  })
  await page.route("**/api/v1/bamboo/provider-catalog", (route) => route.fulfill({ json: {
    providers: [], models: [
      ...instance.config.runtime_models.map((model) => descriptor(instance.id, model)),
      descriptor(other.id, otherOnly),
    ],
  } }))
  await page.route("**/api/v1/bamboo/provider-catalog/fetch-models", (route) => {
    discoveries += 1
    expect(route.request().postDataJSON()).toEqual({ provider: instance.id })
    return route.fulfill({ json: { fetched: [{ provider: instance.id,
      models: [...candidates.map((model) => descriptor(instance.id, model)), descriptor(other.id, otherOnly)],
    }] } })
  })

  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  expect(discoveries, "normal chat must read runtime models without discovering upstream").toBe(0)
  await openProviders(page)
  const row = page.locator("li").filter({ hasText: "Relay provider" }).first()
  await row.getByRole("button", { name: "拉取模型列表", exact: true }).click()
  const editor = page.getByTestId("runtime-models-editor")
  await expect(editor).toBeVisible()
  await expect(editor.getByRole("checkbox", { name: chosen, exact: true })).not.toBeChecked()
  await expect(editor.getByRole("checkbox", { name: excluded, exact: true })).not.toBeChecked()
  await expect(editor.getByRole("checkbox", { name: otherOnly, exact: true })).toHaveCount(0)
  expect(writes).toHaveLength(0)
  expect(instance.config.runtime_models).toEqual(["fixture-model"])
  await editor.getByRole("checkbox", { name: chosen, exact: true }).check()
  await editor.getByRole("textbox", { name: "自定义模型 ID", exact: true }).fill(custom)
  await editor.getByRole("button", { name: "添加模型", exact: true }).click()
  await expect(editor.getByRole("checkbox", { name: custom, exact: true })).toBeChecked()
  await expect(editor.getByRole("combobox", { name: `${chosen} 的 Vision 支持`, exact: true })).toHaveValue("true")
  await expect(editor.getByRole("combobox", { name: `${custom} 的 Vision 支持`, exact: true })).toHaveValue("true")
  await editor.getByRole("combobox", { name: `${chosen} 的 Vision 支持`, exact: true }).selectOption("true")
  await editor.getByRole("combobox", { name: `${custom} 的 Vision 支持`, exact: true }).selectOption("false")

  await editor.getByRole("searchbox", { name: "搜索候选模型", exact: true }).fill("usable")
  await expect(editor.getByRole("checkbox", { name: chosen, exact: true })).toBeVisible()
  await editor.getByRole("searchbox", { name: "搜索候选模型", exact: true }).fill("")
  const screenshot = testInfo.outputPath(`runtime-model-selection-${testInfo.project.name}.png`)
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach("runtime-model-selection", { path: screenshot, contentType: "image/png" })
  await editor.locator("xpath=ancestor::li[1]").getByRole("button", { name: "保存", exact: true }).click()
  await expect(editor).toHaveCount(0)
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ config: { runtime_models: ["fixture-model", chosen, custom] } })
  expect(writes[0]).toMatchObject({ config: { model_capabilities: {
    [chosen]: { supports_vision: true }, [custom]: { supports_vision: false },
  } } })

  await row.getByRole("button", { name: "编辑", exact: true }).click()
  await expect(editor.getByRole("combobox", { name: `${chosen} 的 Vision 支持`, exact: true })).toHaveValue("true")
  await expect(editor.getByRole("combobox", { name: `${custom} 的 Vision 支持`, exact: true })).toHaveValue("false")
  await editor.locator("xpath=ancestor::li[1]").getByRole("button", { name: "取消", exact: true }).click()
  await page.getByRole("button", { name: "返回聊天", exact: true }).click()
  const modelButton = page.getByTestId("model-effort-picker")
  await modelButton.click()
  await page.getByTestId("model-picker-model").click()
  await expect(page.locator("[data-model-option]").filter({ hasText: chosen })).toBeVisible()
  await expect(page.locator("[data-model-option]").filter({ hasText: custom })).toBeVisible()
  await expect(page.locator("[data-model-option]").filter({ hasText: excluded })).toHaveCount(0)
  await expect(page.locator("[data-model-option]").filter({ hasText: otherOnly })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await page.reload()
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  await openProviders(page)
  await row.getByRole("button", { name: "编辑", exact: true }).click()
  await expect(editor.getByRole("checkbox", { name: custom, exact: true })).toBeChecked()
  await expect(editor.getByRole("checkbox", { name: chosen, exact: true })).toBeChecked()
  await expect(editor.getByRole("checkbox", { name: excluded, exact: true })).toHaveCount(0)
  expect(discoveries).toBe(1)
  expect(observation.pageErrors).toEqual([])
  const fits = await page.evaluate(() => {
    const browser = globalThis as unknown as {
      document: { documentElement: { scrollWidth: number } }; innerWidth: number
    }
    return browser.document.documentElement.scrollWidth <= browser.innerWidth + 1
  })
  expect(fits, "selection must fit the viewport").toBe(true)
})

for (const typedDefault of [true, false]) {
  test(`a fresh chat sends its saved custom model with ${typedDefault ? "a Chat preference" : "instance-only defaults"}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "desktop new-chat submission contract")
    await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
    const custom = "relay-custom/offline-alias"
    const observation = await installArtifactRuntime(page, standaloneScenario, [], {
      providerInstancesResponse: {
        default_provider_instance_id: "fixture-provider",
        instances: [{ id: "fixture-provider", type: "openai", label: "Relay provider", enabled: true,
          config: { model: "fixture-model", runtime_models: ["fixture-model", custom] } }],
        defaults: typedDefault ? { chat: { provider: "fixture-provider", model: "fixture-model" } } : null,
        features: { provider_model_ref: typedDefault },
      },
    })
    // No custom-model metadata is needed to use the independently saved admission.
    const chatRequests: Array<Record<string, unknown>> = []
    const executeRequests: Array<Record<string, unknown>> = []
    await page.route("**/api/v1/chat", async (route) => {
      chatRequests.push(route.request().postDataJSON() as Record<string, unknown>)
      await route.fulfill({ json: { session_id: "all-surface-session", status: "success" } })
    })
    await page.route("**/api/v1/execute/all-surface-session", async (route) => {
      executeRequests.push(route.request().postDataJSON() as Record<string, unknown>)
      await route.fulfill({ json: { status: "started", session_id: "all-surface-session" } })
    })
    await page.goto(standaloneScenario.entryUrl)
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "新建会话", exact: true }).click()
    await expect(page.getByRole("heading", { name: "开始新任务", exact: true })).toBeVisible()
    await page.getByTestId("model-effort-picker").click()
    await page.getByTestId("model-picker-model").click()
    await page.locator("[data-model-option]").filter({ hasText: custom }).click()
    await page.getByRole("textbox", { name: "消息", exact: true }).fill("Use my selected custom relay model")
    await page.getByRole("button", { name: "发送消息", exact: true }).click()
    await expect.poll(() => chatRequests.length).toBe(1)
    await expect.poll(() => executeRequests.length).toBe(1)
    expect(chatRequests[0].session_id).toBeUndefined()
    for (const request of [chatRequests[0], executeRequests[0]]) {
      expect(request).toMatchObject({
        model: custom, model_ref: { provider: "fixture-provider", model: custom },
      })
    }
    expect(observation.httpRequests.some((request) => request.url.endsWith("/provider-catalog/fetch-models"))).toBe(false)
    expect(observation.pageErrors).toEqual([])
    expect(observation.errorResponses).toEqual([])
  })
}
