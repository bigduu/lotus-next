import { expect, type Locator, type Page } from "@playwright/test"

/** Reveal only the process layer; tool details keep their own collapsed state. */
export async function openProcessActivities(scope: Page | Locator) {
  const toggles = scope.locator("[data-process-toggle]")
  await expect(toggles.first()).toBeVisible()
  for (let index = 0; index < await toggles.count(); index += 1) {
    const toggle = toggles.nth(index)
    if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click()
  }
}
