import { expect, test } from "@playwright/test"
import {
  installArtifactRuntime,
  standaloneScenario,
} from "./support/artifactRuntime.js"
import { modelEffortPicker, selectEffort } from "./support/modelEffortPicker.js"
import { closeSettings, selectSettingsCategory, settingsSurface } from "./support/settingsNavigation.js"

const providerSnapshot = {
  default_provider_instance_id: "fixture-provider",
  instances: [
    {
      id: "fixture-provider",
      type: "openai",
      label: "Fixture provider",
      enabled: true,
      config: {
        model: "fixture-model",
        // Deliberately differs from the Chat-role setting below. The composer
        // must mirror the role selection, not resolve this instance fallback.
        reasoning_effort: "medium",
      },
    },
  ],
  defaults: {
    chat: {
      provider: "fixture-provider",
      model: "fixture-model",
      reasoning_effort: "max",
    },
  },
  features: { provider_model_ref: true },
}

test("new conversation mirrors the Chat reasoning setting instead of stale Medium state", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop settings workflow")

  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("chat_input_reasoning_last_used_v1", "medium")
    localStorage.setItem(
      "chat_input_reasoning_by_session_v1",
      JSON.stringify({ "": "medium", __new_chat_pane2__: "medium" }),
    )
  })
  const observation = await installArtifactRuntime(page, standaloneScenario, [], {
    providerInstancesResponse: providerSnapshot,
  })

  await page.goto(standaloneScenario.entryUrl)

  // Existing sessions retain their own durable reasoning value.
  const composerReasoning = modelEffortPicker(page)
  await expect(composerReasoning).toContainText("中")

  await page.getByRole("button", { name: "系统设置", exact: true }).click()
  await page.getByRole("button", { name: "提供方", exact: true }).click()
  await expect(
    page.getByRole("combobox", { name: "对话(必填)推理强度", exact: true }),
  ).toContainText("最大")
  await page.getByRole("button", { name: "返回聊天", exact: true }).click()

  await page.getByRole("button", { name: "新建会话", exact: true }).click()
  await expect(composerReasoning).toContainText("最大")

  const input = page.getByRole("textbox", { name: "消息", exact: true })
  await input.fill("typing must not reset the configured effort")
  await expect(composerReasoning).toContainText("最大")

  // Auto and Off are separate, selectable states.
  await selectEffort(page, "关闭")
  await expect(composerReasoning).toContainText("关闭")
  await selectEffort(page, "自动")
  await expect(composerReasoning).toContainText("自动")

  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})

test("Chat preferences save Ultra orchestration and keep the model effort on new chat requests", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const snapshot = {
    ...providerSnapshot,
    features: { ...providerSnapshot.features, chat_ultra_by_default: false },
  }
  const observation = await installArtifactRuntime(page, standaloneScenario, [], { providerInstancesResponse: snapshot })
  const writes: Record<string, unknown>[] = []
  const chats: Record<string, unknown>[] = []
  await page.route("**/api/v1/bamboo/config", (route) => {
    const request = route.request()
    if (request.method() === "POST") {
      const patch = request.postDataJSON()
      writes.push(patch)
      Object.assign(snapshot.features, patch.features)
    }
    return route.fulfill({ json: { features: snapshot.features } })
  })
  await page.route("**/api/v1/chat", (route) => {
    chats.push(route.request().postDataJSON())
    return route.fulfill({ json: { session_id: "all-surface-session", status: "success" } })
  })
  await page.route("**/api/v1/execute/all-surface-session", (route) =>
    route.fulfill({ json: { status: "started", session_id: "all-surface-session" } }))
  const openMenuOnPhone = async () => {
    if ((page.viewportSize()?.width ?? 0) < 768) {
      await page.getByRole("button", { name: "菜单", exact: true }).click()
    }
  }
  await page.goto(standaloneScenario.entryUrl)
  const picker = modelEffortPicker(page)
  await expect(picker).toContainText("中")
  await openMenuOnPhone()
  await page.getByRole("button", { name: "系统设置", exact: true }).click()
  const settings = settingsSurface(page)
  await selectSettingsCategory(settings, "providers", "提供方")
  const chatEffort = settings.getByRole("combobox", { name: "对话(必填)推理强度", exact: true })
  await expect(chatEffort).toHaveText("最大")
  await chatEffort.click()
  await page.getByRole("option", { name: "Ultra", exact: true }).click()
  await expect(settings.getByText("新聊天以模型支持的最高推理档运行，并主动把独立工作分给 SubAgent。", { exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "保存偏好", exact: true }).click()
  await expect(settings.getByText("已保存", { exact: true })).toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({
    features: { chat_ultra_by_default: true },
    defaults: { chat: providerSnapshot.defaults.chat },
  })
  await settings.screenshot({ path: testInfo.outputPath("chat-ultra-preference.png") })
  await closeSettings(settings)
  await expect(picker).toContainText("中")
  await openMenuOnPhone()
  await page.getByRole("button", { name: "新建会话", exact: true }).click()
  await expect(picker).toContainText("Ultra")
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("Review the fixture")
  await page.getByRole("button", { name: "发送消息", exact: true }).click()
  await expect.poll(() => chats.length).toBe(1)
  expect(chats[0]).toMatchObject({
    thinking_mode: "ultra",
    root_orchestration_only: true,
    reasoning_effort: "max",
    model_ref: { model: "fixture-model", provider: "fixture-provider" },
  })
  expect(observation.pageErrors).toEqual([])
})
