import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const source = "中文 English **重点**\n\n```txt\nline 1\t  \n```\n\n[文档](https://example.com/guide)\n末尾  "

for (const theme of ["light", "dark"] as const) {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`chat copy confirms then restores in ${theme}/${reducedMotion}`, async ({ page, context }, testInfo) => {
      test.skip(testInfo.project.name === "tablet-chromium", "desktop and phone cover the two action layouts")
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: standaloneScenario.origin })
      await page.emulateMedia({ colorScheme: theme, reducedMotion })
      await page.addInitScript((mode) => {
        localStorage.setItem("bodhi_onboarded_v1", "1")
        localStorage.setItem("lotus_next_last_session", "all-surface-session")
        localStorage.setItem("copilot_ui_theme_v1", mode)
      }, theme)
      const observation = await installArtifactRuntime(page, standaloneScenario, [{
        id: "copy-feedback-source",
        role: "assistant",
        content: source,
        created_at: "2026-10-22T00:00:00Z",
      }])
      await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
      const actions = page.locator('[data-message-actions="copy-feedback-source"]')
      const more = actions.getByRole("button", { name: "更多消息操作", exact: true })
      const copy = actions.getByRole("button", { name: "复制", exact: true })
      const mobile = testInfo.project.name === "phone-chromium"
      await expect(actions).toHaveAttribute("data-copy-state", "idle")
      const originalActions = await actions.elementHandle()
      const activateCopy = async (repeat = false) => {
        if (mobile) {
          await more.click()
          await page.getByRole("menuitem", { name: "复制", exact: true }).press("Enter")
          await expect(page.getByRole("menu")).toHaveCount(0)
          await expect(more).toBeFocused()
        } else {
          await copy.focus()
          await copy.press(repeat ? "Space" : "Enter")
          await expect(copy).toBeFocused()
        }
      }
      await activateCopy()
      await expect(actions).toHaveAttribute("data-copy-state", "copied")
      await expect.poll(() => page.evaluate("navigator.clipboard.readText()")).toBe(source)
      await expect(actions.getByRole("status")).toHaveText("已复制")
      const confirmation = actions.locator('[data-copy-confirmation="true"]:visible')
      await expect(confirmation).toHaveCount(1)
      await expect(confirmation).toHaveCSS("animation-name", reducedMotion === "reduce" ? "none" : "confirmation-rebound")
      if (reducedMotion === "reduce") await expect(confirmation).toHaveCSS("transform", "none")

      await activateCopy(true)
      await expect(actions).toHaveAttribute("data-copy-state", "copied")
      expect(await actions.evaluate((element, original) => element === original, originalActions)).toBe(true)
      await expect.poll(() => page.evaluate("navigator.clipboard.readText()")).toBe(source)
      const screenshot = testInfo.outputPath(`copy-feedback-${theme}-${reducedMotion}.png`)
      await page.screenshot({ path: screenshot, animations: "disabled" })
      await testInfo.attach("Copy confirmation", { path: screenshot, contentType: "image/png" })
      await expect(actions).toHaveAttribute("data-copy-state", "idle", { timeout: 4000 })
      await expect(actions.locator('[data-copy-confirmation="true"]')).toHaveCount(0)
      await expect(mobile ? more : copy).toBeFocused()
      expect(observation.pageErrors).toEqual([])
      expect(observation.consoleErrors).toEqual([])
      expect(observation.errorResponses).toEqual([])
    })
  }
}

test("chat copy preserves selection and focus through fallback failure and retry", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "fallback focus and retry acceptance")
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: () => Promise.reject(new Error("fixture clipboard denied")),
    } })
  })
  const observation = await installArtifactRuntime(page, standaloneScenario, [{
    id: "copy-failure-source", role: "assistant", content: "原文 English", created_at: "2026-10-22T00:00:00Z",
  }])
  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  const actions = page.locator('[data-message-actions="copy-failure-source"]')
  const copy = actions.getByRole("button", { name: "复制", exact: true })
  const transcript = page.getByText("原文 English", { exact: true })
  await copy.evaluate((button) => {
    Object.defineProperty(button.ownerDocument, "execCommand", { configurable: true, value: () => false })
  })
  await copy.focus()
  const selectedBefore = await transcript.evaluate((element) => {
    const document = element.ownerDocument
    const selection = document.getSelection()
    const range = document.createRange()
    range.selectNodeContents(element)
    selection?.removeAllRanges()
    selection?.addRange(range)
    return selection?.toString() ?? ""
  })
  expect(selectedBefore).toBe("原文 English")
  await expect(copy).toBeFocused()
  const selectedText = () => transcript.evaluate((element) => element.ownerDocument.getSelection()?.toString() ?? "")
  await copy.press("Enter")
  await expect(actions.getByRole("alert")).toHaveText("复制失败")
  await expect(actions).toHaveAttribute("data-copy-state", "error")
  await expect(copy).toBeFocused()
  expect(await selectedText()).toBe(selectedBefore)
  await expect(transcript).toHaveText("原文 English")
  await expect(page.locator('textarea[readonly]')).toHaveCount(0)
  await expect(actions.locator('[data-copy-confirmation="true"]')).toHaveCount(0)
  await copy.evaluate((button) => {
    Object.defineProperty(button.ownerDocument, "execCommand", { configurable: true, value: () => true })
  })
  await copy.press("Space")
  await expect(actions).toHaveAttribute("data-copy-state", "copied")
  await expect(actions.getByRole("alert")).toHaveCount(0)
  await expect(copy).toBeFocused()
  expect(await selectedText()).toBe(selectedBefore)
  await expect(transcript).toHaveText("原文 English")
  await expect(page.locator('textarea[readonly]')).toHaveCount(0)
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
})

test("chat copy leaves a newer caret chosen by the restored control's focus handler", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "collapsed selection ownership during fallback")
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: () => Promise.reject(new Error("fixture clipboard denied")),
    } })
  })
  const observation = await installArtifactRuntime(page, standaloneScenario, [{
    id: "copy-caret-source", role: "assistant", content: "原文 English", created_at: "2026-10-22T00:00:00Z",
  }])
  await page.goto(standaloneScenario.entryUrl)
  const actions = page.locator('[data-message-actions="copy-caret-source"]')
  const copy = actions.getByRole("button", { name: "复制", exact: true })
  await copy.focus()
  await copy.evaluate((button) => {
    const document = button.ownerDocument
    const text = document.querySelector(".assistant-streamdown p")!.firstChild!
    const selection = document.getSelection()!
    selection.setBaseAndExtent(text, 0, text, text.textContent!.length)
    button.addEventListener("focus", () => selection.collapse(text, 2), { once: true })
    Object.defineProperty(document, "execCommand", { configurable: true, value: () => true })
  })
  await copy.press("Enter")
  await expect(actions).toHaveAttribute("data-copy-state", "copied")
  await expect(copy).toBeFocused()
  expect(await copy.evaluate((button) => {
    const document = button.ownerDocument
    const selection = document.getSelection()!
    return { collapsed: selection.isCollapsed, offset: selection.anchorOffset,
      originalNode: selection.anchorNode === document.querySelector(".assistant-streamdown p")!.firstChild }
  })).toEqual({ collapsed: true, offset: 2, originalNode: true })
  await expect(page.locator('textarea[readonly]')).toHaveCount(0)
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
})
