import type { FrameLocator, Page } from "@playwright/test"

/** Keep locators live across desktop-aside and narrow-modal breakpoints. */
export function workbenchPanel(surface: Page | FrameLocator) {
  return surface.getByRole("complementary", { name: "工作面板", exact: true })
    .or(surface.getByRole("dialog", { name: "工作面板", exact: true }))
}
