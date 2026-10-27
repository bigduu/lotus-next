import { expect, type Locator, type Page } from "@playwright/test"

/** A legacy404 permits a user-explicit default open, not a guessed mode. */
export async function openClosedBrowserAtServiceDefault(page: Page, pane: Locator, sessionId: string) {
  await expect(pane.getByText("当前聊天浏览器已关闭", { exact: true })).toBeVisible()
  await expect(pane.getByRole("combobox", { name: "下次打开的模式", exact: true })).toHaveCount(0)
  const sessionPath = `/api/v1/browser/sessions/${encodeURIComponent(sessionId)}`
  const [response] = await Promise.all([
    page.waitForResponse((response) =>
      new URL(response.url()).pathname === sessionPath && response.request().method() === "PUT"),
    pane.getByRole("button", { name: "按当前服务默认设置打开", exact: true }).click(),
  ])
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON()).toEqual({})
}

/** Linux/Windows Bamboo17 requires the user's explicit clean intent. */
export async function openClosedBrowserExplicitlyClean(page: Page, pane: Locator, sessionId: string) {
  await expect(pane.getByText("当前聊天浏览器已关闭", { exact: true })).toBeVisible()
  await expect(pane.getByRole("combobox", { name: "下次打开的模式", exact: true })).toHaveCount(0)
  const sessionPath = `/api/v1/browser/sessions/${encodeURIComponent(sessionId)}`
  const [response] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === sessionPath && response.request().method() === "PUT"),
    pane.getByRole("button", { name: "以干净会话打开", exact: true }).click(),
  ])
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON()).toEqual({ profile_mode: "clean" })
  expect(await response.json()).toMatchObject({ profile_mode: "clean", storage_shared: false })
}
