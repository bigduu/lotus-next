import { expect, type Locator, type Page } from "@playwright/test";

export type SettingsLayout = "page" | "dialog";

// The pinned published baseline uses a modal; current builds must use a page.
// Callers choose the known artifact contract, never an arbitrary fallback.
export const settingsSurface = (
  page: Page,
  layout: SettingsLayout = "page",
): Locator => page.getByRole(layout === "page" ? "main" : "dialog", {
  name: "系统设置",
  exact: true,
});

export const selectSettingsCategory = async (
  settings: Locator,
  id: string,
  label: string,
): Promise<void> => {
  const categories = settings.locator("#settings-category");
  await categories.waitFor({ state: "attached" });
  if (await categories.isVisible()) await categories.selectOption(id);
  else await settings.getByRole("button", { name: label, exact: true }).click();
};

export const closeSettings = async (
  settings: Locator,
  layout: SettingsLayout = "page",
): Promise<void> => {
  await settings.getByRole("button", {
    name: layout === "page" ? "返回聊天" : "关闭设置",
    exact: true,
  }).click();
  await expect(settings).toHaveCount(0);
};
