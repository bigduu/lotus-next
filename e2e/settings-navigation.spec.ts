import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js";
import { closeSettings, selectSettingsCategory, settingsSurface } from "./support/settingsNavigation.ts";

for (const outcome of ["slow", "failed"] as const) {
  test(`the Settings page keeps a usable frame during a ${outcome} feature import`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("bodhi_onboarded_v1", "1");
      localStorage.setItem("lotus_ui_locale_v1", "zh-CN");
    });
    const observation = await installArtifactRuntime(page, standaloneScenario);
    const assets = JSON.parse(readFileSync("dist/asset-manifest.json", "utf8")) as Record<string, { file: string; isDynamicEntry?: boolean }>;
    const settingsAsset = assets["src/solid/settings/SettingsPage.tsx"];
    expect(settingsAsset?.isDynamicEntry).toBe(true);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve });
    let requested = 0;
    let navigations = 0;
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations += 1 });
    await page.route(`**/${settingsAsset.file}`, async (route) => {
      requested += 1;
      await held;
      if (outcome === "failed") await route.abort("failed");
      else await route.fallback();
    });
    const open = async () => {
      if ((page.viewportSize()?.width ?? 0) < 768) {
        await page.getByRole("button", { name: "菜单", exact: true }).click();
      }
      await page.getByRole("button", { name: "系统设置", exact: true }).click();
    };
    const settings = settingsSurface(page);
    try {
      await page.goto(standaloneScenario.entryUrl);
      await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible();
      expect(requested).toBe(0);
      await open();
      const title = settings.getByRole("heading", { name: "系统设置", exact: true });
      await expect(title).toBeFocused();
      await expect(settings.getByRole("status")).toContainText("正在加载设置");
      await expect.poll(() => requested).toBe(1);
      const originalTitle = await title.elementHandle();
      release();
      if (outcome === "failed") {
        await expect(settings.getByRole("alert")).toContainText("设置加载失败");
        await closeSettings(settings);
        await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible();
      } else {
        await expect(settings.getByRole("heading", { name: "通用", exact: true })).toBeVisible();
        expect(await title.evaluate((current, original) => current === original, originalTitle)).toBe(true);
        await selectSettingsCategory(settings, "providers", "提供方");
        await closeSettings(settings);
        await open();
        await expect(settings.getByRole("heading", { name: "提供方", exact: true })).toBeVisible();
      }
      expect(requested).toBe(1);
      expect(navigations).toBe(1);
      expect(observation.pageErrors).toEqual([]);
    } finally {
      release();
    }
  });
}

test("real-lane Settings helpers navigate the built page and responsive categories", async ({ page }, testInfo) => {
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
  const categoryOptions = await settings.locator("#settings-category option").evaluateAll((options) =>
    options.map((option) => option.getAttribute("value")));
  expect(new Set(categoryOptions).size).toBe(categoryOptions.length);
  expect(categoryOptions).toEqual(expect.arrayContaining(["retry", "model-limits", "providers"]));
  expect(categoryOptions).not.toContain("workflows");
  await expect(settings.locator("nav.settings-nav").getByRole("button", { name: "网络重试", includeHidden: true })).toHaveCount(1);
  await expect(settings.getByRole("button", { name: /^(Workflow|Workflow[s]|工作流)$/ })).toHaveCount(0);
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
  if (testInfo.project.name === "desktop-chromium") {
    await testInfo.attach("settings-categories", {
      body: await settings.screenshot(),
      contentType: "image/png",
    });
  }
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

test("Tailscale settings connect, require a password, and manage the private address", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1");
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN");
  });
  const observation = await installArtifactRuntime(page, standaloneScenario);
  const address = "https://bamboo.example.ts.net:8443/";
  let connected = false;
  let passwordSet = false;
  let enabled = false;
  const actions: string[] = [];
  await page.route("**/api/v1/bamboo/tailscale", (route) => {
    let loginRequested = false;
    if (route.request().method() === "POST") {
      const { action } = route.request().postDataJSON();
      actions.push(action);
      if (action === "connect") loginRequested = true;
      if (action === "enable") enabled = true;
      if (action === "disable") enabled = false;
    }
    const state = !connected ? "login_required" : !passwordSet ? "password_required" : enabled ? "active" : "ready";
    return route.fulfill({ json: {
      state,
      enabled,
      tailnet: connected ? "example.ts.net" : null,
      url: enabled ? address : null,
      action_url: loginRequested && !connected ? "https://login.tailscale.com/a/test-fixture" : null,
    } });
  });
  await page.route("**/api/v1/bamboo/access/status", (route) => route.fulfill({ json: {
    password_enabled: passwordSet, local_bypass: true, requires_password: false, revision: passwordSet ? 8 : 7,
  } }));
  await page.route("**/api/v1/bamboo/access/password", (route) => {
    expect(route.request().postDataJSON()).toEqual({ expected_revision: 7, new_password: "fixture-password" });
    passwordSet = true;
    return route.fulfill({ json: { success: true, password_enabled: true, revision: 8 } });
  });

  await page.goto(standaloneScenario.entryUrl);
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page.getByRole("button", { name: "菜单", exact: true }).click();
  }
  await page.getByRole("button", { name: "系统设置", exact: true }).click();
  const settings = settingsSurface(page);
  await selectSettingsCategory(settings, "system", "系统");
  const section = settings.getByRole("region", { name: "Tailscale 远程访问" });
  await section.getByRole("button", { name: "连接这台电脑" }).click();
  await expect(section.getByRole("link", { name: "登录 Tailscale" }))
    .toHaveAttribute("href", "https://login.tailscale.com/a/test-fixture");
  await page.waitForResponse((response) => response.url().endsWith("/api/v1/bamboo/tailscale")
    && response.request().method() === "GET");
  await expect(section.getByRole("link", { name: "登录 Tailscale" }))
    .toHaveAttribute("href", "https://login.tailscale.com/a/test-fixture");
  connected = true;
  await section.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(section.getByText("请先在下方设置 Bamboo 访问密码", { exact: false })).toBeVisible();
  await expect(section.getByRole("button", { name: "开启远程访问" })).toHaveCount(0);

  await settings.getByLabel(/^设置密码/).fill("fixture-password");
  await settings.getByLabel(/^确认密码/).fill("fixture-password");
  await settings.getByRole("button", { name: "启用密码", exact: true }).click();
  await section.getByRole("button", { name: "开启远程访问" }).click();
  await expect(section.getByRole("link", { name: address })).toHaveAttribute("href", address);
  await expect(section.getByRole("button", { name: "复制地址" })).toBeVisible();
  await settings.getByRole("button", { name: "关闭密码", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "关闭访问密码" });
  await expect(confirm.getByText(/Tailscale 分享会暂停/)).toBeVisible();
  await confirm.getByRole("button", { name: "取消" }).click();
  if (testInfo.project.name !== "tablet-chromium") {
    await testInfo.attach("Tailscale remote access", { body: await section.screenshot(), contentType: "image/png" });
  }
  await section.getByRole("button", { name: "关闭远程访问" }).click();
  await expect(section.getByRole("link", { name: address })).toHaveCount(0);
  await expect(section.getByRole("button", { name: "开启远程访问" })).toBeEnabled();
  expect(actions).toEqual(["connect", "enable", "disable"]);
  expect(observation.errorResponses).toEqual([]);
  expect(observation.pageErrors).toEqual([]);
});

test("maximum output preserves automatic, unlimited, and fixed limits", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1");
    localStorage.setItem("lotus_ui_locale_v1", "zh-CN");
    localStorage.setItem("zenith.usedModels.v1", JSON.stringify(["observed-model"]));
  });
  const observation = await installArtifactRuntime(page, standaloneScenario);
  const fixed = {
    model_pattern: "fixture-model",
    max_context_tokens: 256_000,
    max_output_tokens: 32_000,
  };
  let modelLimits = [{ ...fixed }];
  await page.route("**/api/v1/bamboo/model-limits/defaults", (route) => route.fulfill({
    json: {
      supports_unlimited_output: true,
      model_limits: [{ max_context_tokens: 1_000_000, max_output_tokens: 64_000, safety_margin: 10_000 }],
    },
  }));
  await page.route("**/api/v1/bamboo/config", (route) => {
    if (route.request().method() === "POST") {
      modelLimits = route.request().postDataJSON().model_limits;
    }
    return route.fulfill({ json: { proxy_auth_mode: "auto", model_limits: modelLimits } });
  });
  await page.goto(standaloneScenario.entryUrl);
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page.getByRole("button", { name: "菜单", exact: true }).click();
  }
  await page.getByRole("button", { name: "系统设置", exact: true }).click();
  const settings = settingsSurface(page);
  await selectSettingsCategory(settings, "model-limits", "模型限额");
  const output = settings.getByRole("combobox", { name: "fixture-model 最大输出" });
  const expandOutput = settings.getByRole("button", { name: "展开fixture-model 最大输出选项" });
  const save = settings.getByRole("button", { name: "保存", exact: true });
  const observedRow = settings.getByRole("row").filter({ hasText: "observed-model" });
  const observedContext = observedRow.getByRole("combobox", { name: "observed-model 上下文窗口" });
  const observedOutput = observedRow.getByRole("combobox", { name: "observed-model 最大输出" });

  await expect(settings.getByText(/兼容回退/)).toContainText("64K");
  await expect(output).toHaveValue("32K");
  await expect(observedRow.getByText("跟随默认")).toBeVisible();
  await expect(observedContext).toBeDisabled();
  await expect(observedContext).toHaveValue("1M（回退值）");
  await expect(observedOutput).toBeDisabled();
  await expect(observedOutput).toHaveValue("");
  await expect(observedOutput).toHaveAttribute("placeholder", "自动");
  if (testInfo.project.name === "desktop-chromium") {
    await testInfo.attach("Model limits with automatic and fixed rows", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  }

  await observedRow.getByRole("button", { name: "自定义", exact: true }).click();
  await expect(observedContext).toHaveValue("1M");
  await observedContext.fill("128K");
  await save.click();
  await expect(settings.getByText("已保存", { exact: true })).toBeVisible();
  const automatic = {
    model_pattern: "observed-model",
    max_context_tokens: 128_000,
    max_output_tokens: null,
  };
  expect(modelLimits).toEqual([fixed, automatic]);

  await expandOutput.click();
  const unlimited = page.getByRole("option", { name: /^不限/ });
  await expect(unlimited).toBeVisible();
  if (testInfo.project.name === "desktop-chromium") {
    await testInfo.attach("Unlimited maximum output option", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  }
  await unlimited.click();
  await expect(output).toHaveValue("不限");
  await save.click();
  await expect(settings.getByText("已保存", { exact: true })).toBeVisible();
  expect(modelLimits).toEqual([{ ...fixed, max_output_tokens: null, unlimited_output: true }, automatic]);

  await selectSettingsCategory(settings, "general", "通用");
  await selectSettingsCategory(settings, "model-limits", "模型限额");
  await expect(output).toHaveValue("不限");
  await expandOutput.click();
  await page.getByRole("option", { name: /^32K/ }).click();
  await save.click();
  await expect(settings.getByText("已保存", { exact: true })).toBeVisible();
  expect(modelLimits).toEqual([fixed, automatic]);
  expect(observation.errorResponses).toEqual([]);
  expect(observation.pageErrors).toEqual([]);
});
