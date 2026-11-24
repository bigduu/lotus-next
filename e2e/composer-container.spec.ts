import { expect, test, type Locator } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

test("narrow composer uses its container and preserves drafts across More and resize", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  await page.goto(standaloneScenario.entryUrl)
  const column = page.locator("[data-composer-column]")
  const editor = page.getByRole("textbox", { name: "Messages", exact: true })
  // The initial new-chat editor is replaced when bootstrap restores the session.
  // Type into the restored session, not its transient empty draft key.
  await expect(page.getByRole("banner")).toContainText("All-surface acceptance")
  await expect(column.locator('[data-variant="composer"]')
    .getByRole("combobox", { name: "Permission mode", exact: true })).toBeEnabled()
  await editor.fill("Keep this unsent draft")
  await expect(editor).toHaveText("Keep this unsent draft")
  const originalEditor = await editor.elementHandle()
  await column.evaluate((element) => { (element as unknown as { style: { width: string } }).style.width = "440px" })
  await expect(column).toHaveAttribute("data-composer-compact", "true")
  const more = column.getByRole("button", { name: "More", exact: true })
  await expect(more).toBeVisible()
  await expect(column.getByRole("combobox", { name: "Permission mode", exact: true })).toBeVisible()
  await expect(column.getByTestId("model-effort-picker")).toBeVisible()
  const surface = column.locator("[data-composer-surface]")
  await expect(surface.getByRole("button", { name: "Send message", exact: true })).toBeEnabled()
  await expect(surface.getByRole("combobox", { name: "Permission mode", exact: true })).toBeVisible()
  await expect(surface.getByTestId("model-effort-picker")).toBeVisible()
  await expect(surface.getByRole("button", { name: "Add images", exact: true })).toHaveCount(0)
  await more.focus()
  await page.keyboard.press("Enter")
  const settings = page.getByRole("dialog", { name: "More", exact: true })
  await expect(settings).toBeVisible()
  await expect(settings.getByRole("button", { name: "Add images", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(settings).toHaveCount(0)
  await expect(more).toBeFocused()
  await expect(editor).toHaveText("Keep this unsent draft")
  await more.click()
  await column.evaluate((element) => { (element as unknown as { style: { width: string } }).style.width = "900px" })
  await expect(column).toHaveAttribute("data-composer-compact", "false")
  await expect(settings).toHaveCount(0)
  await expect(editor).toBeFocused()
  expect(await editor.evaluate((element, previous) => element === previous, originalEditor)).toBe(true)
  await expect(editor).toHaveText("Keep this unsent draft")
  await expect(column.getByRole("button", { name: "Add images", exact: true })).toBeVisible()
  expect(observation.pageErrors).toEqual([])
})

async function expectReachable(control: Locator, ratio = 1) {
  await expect(control).toBeInViewport({ ratio })
  await expect.poll(() => control.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const target = element.ownerDocument.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return element.contains(target)
  })).toBe(true)
}

test("short windows keep the editor and Send reachable with multiple image attachments", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "explicit 390×320 short-window viewport")
  const sessionId = "all-surface-session"
  await page.setViewportSize({ width: 390, height: 320 })
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
  }, sessionId)
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const submissions: unknown[] = []
  await page.route("**/api/v1/chat", (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    submissions.push(route.request().postDataJSON())
    return route.fulfill({ json: { session_id: sessionId, status: "success" } })
  })
  await page.route(`**/api/v1/execute/${sessionId}`, (route) =>
    route.fulfill({ json: { session_id: sessionId, status: "started", run_id: "short-composer-run" } }))
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.getByRole("banner")).toContainText("All-surface acceptance")
  const composer = page.locator("[data-composer-column]")
  const editor = composer.getByRole("textbox", { name: "Messages", exact: true })
  const send = composer.getByRole("button", { name: "Send message", exact: true })
  const colors = ["#1d4ed8", "#166534", "#991b1b", "#6b21a8", "#92400e"]
  const images = await page.evaluate((palette) => {
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 64
    const context = canvas.getContext("2d")!
    context.font = "bold 36px sans-serif"
    context.textAlign = "center"
    context.textBaseline = "middle"
    return palette.map((color, index) => {
      context.fillStyle = color
      context.fillRect(0, 0, 64, 64)
      context.fillStyle = "white"
      context.fillText(String(index + 1), 32, 32)
      return canvas.toDataURL("image/png").split(",")[1]
    })
  }, colors)
  const files = images.map((image, index) => ({
    name: `image-${index + 1}.png`, mimeType: "image/png", buffer: Buffer.from(image, "base64"),
  }))
  await composer.locator('input[type="file"]').setInputFiles(files)
  await expect(composer.getByRole("img")).toHaveCount(files.length)
  await expect(send).toBeEnabled()
  await expectReachable(send)
  await expectReachable(editor)
  const draft = [
    "Review the layout", "Check the thumbnails", "Check the toolbar", "Keep the editor visible", "Send the remaining images",
  ].join("\n")
  await editor.fill(draft)
  await expectReachable(editor)
  await expectReachable(send)

  const screenshot = info.outputPath("short-composer-attachments.png")
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await info.attach("Short composer with five attachments", { path: screenshot, contentType: "image/png" })
  const lastPreview = composer.getByRole("button", { name: "image-5.png", exact: true })
  const lastRemove = composer.getByRole("button", { name: "Remove image", exact: true }).last()
  await editor.focus()
  await page.keyboard.press("Shift+Tab")
  await expect(lastRemove).toBeFocused()
  await expectReachable(lastRemove)
  await page.keyboard.press("Shift+Tab")
  await expect(lastPreview).toBeFocused()
  await expectReachable(lastPreview, 0.95)
  const scrolledScreenshot = info.outputPath("short-composer-attachment-five.png")
  await page.screenshot({ path: scrolledScreenshot, animations: "disabled" })
  await info.attach("Fifth attachment reached by keyboard", { path: scrolledScreenshot, contentType: "image/png" })
  const source = await lastPreview.locator("img").getAttribute("src")
  await page.keyboard.press("Enter")
  const preview = page.getByRole("dialog", { name: "Close preview", exact: true })
  await expect(preview.locator("img")).toHaveAttribute("src", source!)
  await preview.getByRole("button", { name: "Close preview", exact: true }).click()
  await expect(preview).toBeHidden()
  await lastRemove.click()
  await expect(lastPreview).toHaveCount(0)
  await expect(composer.getByRole("img")).toHaveCount(files.length - 1)
  await expectReachable(send)
  await send.click()
  await expect.poll(() => submissions).toEqual([expect.objectContaining({
    session_id: sessionId,
    message: draft,
    images: files.slice(0, -1).map(({ name }) => expect.objectContaining({ name })),
  })])
  expect(observation.pageErrors).toEqual([])
})
