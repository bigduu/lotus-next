import { expect, test } from "@playwright/test";

const preview = "/solid-preview.html";

test("reads the existing theme preference and follows system appearance on demand", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("copilot_ui_theme_v1")) {
      localStorage.setItem("copilot_ui_theme_v1", "light");
    }
  });
  await page.goto(preview);

  const root = page.locator("html");
  const light = page.getByRole("button", { name: "浅色", exact: true });
  const dark = page.getByRole("button", { name: "深色", exact: true });
  const system = page.getByRole("button", { name: "跟随系统" });
  await expect(light).toHaveAttribute("aria-pressed", "true");
  await expect(root).not.toHaveClass(/\bdark\b/);

  await dark.click();
  await expect(root).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(dark).toHaveAttribute("aria-pressed", "true");

  await system.click();
  await expect(system).toHaveAttribute("aria-pressed", "true");
  await expect(root).toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).not.toHaveClass(/\bdark\b/);
});

test("submits Markdown using the Solid Tiptap editor", async ({ page }) => {
  await page.goto(preview);
  const composer = page.locator("[data-composer-editor]");
  await expect(composer).toHaveAttribute("contenteditable", "true");
  await composer.fill("**从输入框渲染**\n\n- 使用全角中文");
  await composer.press("Enter");

  await expect(page.locator("strong", { hasText: "从输入框渲染" })).toBeVisible();
  await expect(page.locator("li", { hasText: "使用全角中文" })).toBeVisible();
  await expect(composer).not.toContainText("从输入框渲染");
});

test("keeps nested select options accessible and restores focus through both layers", async ({ page }) => {
  await page.goto(preview);
  const trigger = page.getByRole("button", { name: "Open preferences dialog" });
  const dialog = page.getByRole("dialog", { name: "Workspace preferences" });
  await trigger.click();
  const select = dialog.locator("[data-slot=select-trigger]");
  const list = dialog.getByRole("listbox");
  await select.click();
  await expect(list).toBeVisible();
  await expect(list.getByRole("option", { name: "Public" })).toHaveAttribute("aria-disabled", "true");

  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(select).toBeFocused();

  await select.click();
  await expect(list).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("Shared");
  await expect(select).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
