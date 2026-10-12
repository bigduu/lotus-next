import { expect, test } from "@playwright/test";
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js";
import { closeSettings, selectSettingsCategory, settingsSurface } from "./support/settingsNavigation.ts";

test("real-lane Settings helpers navigate the built page and responsive categories", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1");
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN");
  });
  const observation = await installArtifactRuntime(page, standaloneScenario);
  await page.route("**/api/v1/mcp/servers", (route) => route.fulfill({ json: { servers: [] } }));
  await page.goto(standaloneScenario.entryUrl);
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(composer).toBeVisible();
  await expect(
    page.getByRole("button", { name: "模型与推理强度", exact: true })
      .getByText("fixture-model", { exact: true }),
  ).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page.getByRole("button", { name: "菜单", exact: true }).click();
  }
  await page.getByRole("button", { name: "系统设置", exact: true }).click();
  const settings = settingsSurface(page);
  await expect(settings).toBeVisible();
  await expect(settingsSurface(page, "dialog")).toHaveCount(0);
  await expect(composer).toBeHidden();
  await expect(settings.locator("#settings-category")).toBeVisible({
    visible: (page.viewportSize()?.width ?? 0) < 768,
  });
  await selectSettingsCategory(settings, "providers", "提供方");
  await expect(settings.getByRole("heading", { name: "提供方", exact: true })).toBeVisible();
  await expect(settings.getByRole("combobox", { name: "对话(必填)模型", exact: true })).toHaveValue("fixture-model");
  await settings.getByRole("button", { name: "新增", exact: true }).click();
  const providerType = settings.getByRole("combobox", { name: "提供方类型", exact: true });
  await providerType.click();
  const selectContent = page.locator('[data-slot="select-content"]');
  await expect(selectContent).toBeVisible();
  await page.getByRole("option", { name: "OpenAI", exact: true }).click();
  await expect(providerType).toHaveText("OpenAI");
  await expect(selectContent).toHaveCount(0);
  await settings.getByRole("button", { name: "取消", exact: true }).click();
  await selectSettingsCategory(settings, "mcp", "MCP");
  await expect(settings.getByRole("heading", { name: "MCP", exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "导入 JSON", exact: true })).toBeEnabled();
  await selectSettingsCategory(settings, "general", "通用");
  await expect(settings.getByRole("heading", { name: "通用", exact: true })).toBeVisible();
  await closeSettings(settings);
  await expect(composer).toBeVisible();
  expect(observation.errorResponses).toEqual([]);
  expect(observation.pageErrors).toEqual([]);
});

// This is a DOM contract check for the explicitly supported old modal layout,
// not evidence that a historical package passed real-Bamboo acceptance.
test("published baseline Settings helper retains the explicit modal contract", async ({ page }) => {
  await page.setContent(`
    <div role="dialog" aria-labelledby="settings-title">
      <h2 id="settings-title">系统设置</h2>
      <button type="button" onclick="this.closest('[role=dialog]').remove()">关闭设置</button>
    </div>
  `);
  await expect(settingsSurface(page)).toHaveCount(0);
  const settings = settingsSurface(page, "dialog");
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("heading", { name: "系统设置", exact: true })).toBeVisible();
  await closeSettings(settings, "dialog");
});
