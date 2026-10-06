import { expect, type Locator, type Page } from "@playwright/test"

const labels = ["自动", "关闭", "低", "中", "高", "极高", "最大", "Ultra · 编排"]

export const modelEffortPicker = (page: Page) => page.getByTestId("model-effort-picker")

/** Select one discrete position through the native range's pointer interaction. */
export async function selectEffort(page: Page, label: string, trigger = modelEffortPicker(page)) {
  const slider = page.getByRole("slider", { name: "推理强度", exact: true })
  if (await trigger.getAttribute("aria-expanded") !== "true") {
    await expect(slider).not.toBeVisible()
    await trigger.click()
  }
  await expect(slider).toBeEnabled()
  if (label === "自动") {
    await page.getByRole("button", { name: "恢复自动推理", exact: true }).click()
  } else {
    await clickEffortPosition(slider, labels.indexOf(label))
  }
  await page.keyboard.press("Escape")
  await expect(slider).not.toBeVisible()
}

export async function clickEffortPosition(slider: Locator, index: number) {
  const max = Number(await slider.getAttribute("max"))
  expect(index).toBeGreaterThanOrEqual(0)
  expect(index).toBeLessThanOrEqual(max)
  const box = await slider.boundingBox()
  if (!box) throw new Error("Reasoning slider has no visible bounds")
  // Native range thumbs are inset from the element edges. The wide discrete
  // intervals keep this click centered on the intended position.
  await slider.click({ position: { x: 10 + (box.width - 20) * index / max, y: box.height / 2 } })
}
