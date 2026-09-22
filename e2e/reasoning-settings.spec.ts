import { expect, test } from "@playwright/test"
import {
  installArtifactRuntime,
  standaloneScenario,
} from "./support/artifactRuntime.js"

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
  const composerReasoning = page.getByRole("button", { name: "推理强度", exact: true })
  await expect(composerReasoning).toContainText("中")

  await page.getByRole("button", { name: "系统设置", exact: true }).click()
  await page.getByRole("button", { name: "提供方", exact: true }).click()
  await expect(
    page.getByRole("combobox", { name: "对话(必填)推理强度", exact: true }),
  ).toContainText("最大")
  await page.getByRole("button", { name: "关闭设置", exact: true }).click()

  await page.getByRole("button", { name: "新建会话", exact: true }).click()
  await expect(composerReasoning).toContainText("最大")

  const input = page.getByRole("textbox", { name: "消息", exact: true })
  await input.fill("typing must not reset the configured effort")
  await expect(composerReasoning).toContainText("最大")

  // Auto and Off are separate, selectable states.
  await composerReasoning.click()
  await page.getByRole("menuitem", { name: "关闭", exact: true }).click()
  await expect(composerReasoning).toContainText("关闭")
  await composerReasoning.click()
  await page.getByRole("menuitem", { name: "自动", exact: true }).click()
  await expect(composerReasoning).toContainText("自动")

  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
