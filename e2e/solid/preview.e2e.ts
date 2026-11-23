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
