import { expect, type Locator, type Page } from "@playwright/test"

/** Switch to clean explicitly, whether the default opened shared or was refused. */
export async function openClosedBrowserExplicitlyClean(page: Page, pane: Locator, sessionId: string) {
  const closed = pane.getByText("当前聊天浏览器已关闭", { exact: true })
  const shared = pane.getByText("当前模式：共享账户", { exact: true })
  await expect(closed.or(shared)).toBeAttached()
  if (await shared.count()) {
    if ((await pane.locator("details").getAttribute("open")) === null) await pane.locator("summary").click()
    await pane.getByRole("combobox", { name: "下次打开的模式" }).selectOption("clean")
    await pane.getByRole("button", { name: "关闭当前聊天浏览器", exact: true }).click()
    await expect(closed).toBeVisible()
  }
  const sessionPath = `/api/v1/browser/sessions/${encodeURIComponent(sessionId)}`
  const openClean = pane.getByRole("button", { name: "以干净会话打开", exact: true })
  const openSelected = pane.getByRole("button", { name: "打开浏览器", exact: true })
  const [response] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === sessionPath && response.request().method() === "PUT"),
    (await openClean.count() ? openClean : openSelected).click(),
  ])
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON()).toEqual({ profile_mode: "clean" })
  expect(await response.json()).toMatchObject({ profile_mode: "clean", storage_shared: false })
}
