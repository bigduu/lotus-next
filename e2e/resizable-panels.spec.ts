import { expect, test, type Locator, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sidebarKey = "lotus_next_sidebar_w"
const workbenchKey = "lotus_next_inspector_w"
const panelWidth = (panel: Locator) => panel.evaluate((element) => element.getBoundingClientRect().width)
const preference = (page: Page, key: string) => page.evaluate((storageKey) => localStorage.getItem(storageKey), key)

async function openPanels(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  await page.goto(standaloneScenario.entryUrl)
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  await expect(page.locator("#right-workbench")).toBeVisible()
  return observation
}

test("keyboard separators keep pixel limits and restore preferences across narrow and wide layouts", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop keyboard acceptance")
  await page.setViewportSize({ width: 2400, height: 1000 })
  const observation = await openPanels(page)
  const sidebar = page.locator("#sidebar-panel")
  const workbench = page.locator("#right-workbench")
  const sidebarHandle = page.getByRole("separator", { name: "调整侧栏宽度" })
  const workbenchHandle = page.getByRole("separator", { name: "调整工作面板宽度" })
  await sidebarHandle.focus()
  await expect(sidebarHandle).toHaveAttribute("aria-controls", "sidebar-panel")
  await sidebarHandle.press("Home")
  await expect.poll(() => panelWidth(sidebar)).toBeCloseTo(220, 0)
  await sidebarHandle.press("End")
  await expect.poll(() => panelWidth(sidebar)).toBeCloseTo(420, 0)
  await expect.poll(() => preference(page, sidebarKey)).toBe("420")

  await workbenchHandle.press("End")
  await expect.poll(() => panelWidth(workbench)).toBeCloseTo(360, 0)
  await workbenchHandle.press("Home")
  const saved = Number(await preference(page, workbenchKey))
  expect(saved).toBeGreaterThan(1200)
  await expect.poll(() => panelWidth(workbench)).toBeCloseTo(saved, 0)
  await expect.poll(() => panelWidth(page.locator("#chat-panel"))).toBeGreaterThanOrEqual(359)
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect.poll(() => panelWidth(workbench)).toBeLessThan(saved)
  await workbenchHandle.click()
  expect(Number(await preference(page, workbenchKey))).toBe(saved)
  await page.setViewportSize({ width: 2400, height: 1000 })
  await expect.poll(() => panelWidth(workbench)).toBeCloseTo(saved, 0)
  await page.reload()
  await expect.poll(() => panelWidth(workbench)).toBeCloseTo(saved, 0)

  // A temporary tablet clamp must retain the user's 420px sidebar preference.
  await page.setViewportSize({ width: 768, height: 900 })
  await expect.poll(() => panelWidth(sidebar)).toBeLessThan(420)
  await expect.poll(() => panelWidth(page.locator("#chat-panel"))).toBeGreaterThanOrEqual(359)
  expect(await preference(page, sidebarKey)).toBe("420")
  await page.setViewportSize({ width: 900, height: 900 })
  await expect.poll(() => panelWidth(sidebar)).toBeCloseTo(420, 0)
  await page.setViewportSize({ width: 2400, height: 1000 })
  await expect.poll(() => panelWidth(sidebar)).toBeCloseTo(420, 0)
  expect(observation.pageErrors).toEqual([])
  await testInfo.attach("keyboard-preferences-restored", { body: await page.screenshot(), contentType: "image/png" })
})

test("Escape, pointer cancellation, and global dialogs discard an unfinished resize", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop interrupted gesture acceptance")
  const observation = await openPanels(page)
  const handle = page.getByRole("separator", { name: "调整工作面板宽度" })
  const panel = page.locator("#right-workbench")
  const initial = await panelWidth(panel)
  const stored = await preference(page, workbenchKey)
  const startDrag = async () => {
    const box = (await handle.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x - 100, box.y + box.height / 2, { steps: 4 })
    await expect.poll(() => panelWidth(panel)).toBeGreaterThan(initial + 50)
  }
  await startDrag()
  await page.keyboard.press("Escape")
  await page.mouse.up()
  await expect.poll(() => panelWidth(panel)).toBeCloseTo(initial, 0)
  expect(await preference(page, workbenchKey)).toBe(stored)

  await startDrag()
  await handle.evaluate((element) => element.releasePointerCapture(1))
  await page.mouse.move(100, 100)
  await page.mouse.up()
  await expect.poll(() => panelWidth(panel)).toBeCloseTo(initial, 0)
  expect(await preference(page, workbenchKey)).toBe(stored)

  await startDrag()
  await handle.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" })
  await page.mouse.up()
  await expect.poll(() => panelWidth(panel)).toBeCloseTo(initial, 0)
  expect(await preference(page, workbenchKey)).toBe(stored)

  await startDrag()
  await page.evaluate("window.dispatchEvent(new Event('blur'))")
  await page.mouse.move(100, 100)
  await page.mouse.up()
  await expect.poll(() => panelWidth(panel)).toBeCloseTo(initial, 0)
  expect(await preference(page, workbenchKey)).toBe(stored)

  await startDrag()
  await page.keyboard.press("Control+k")
  await page.mouse.up()
  await page.keyboard.press("Escape")
  await expect.poll(() => panelWidth(panel)).toBeCloseTo(initial, 0)
  expect(await preference(page, workbenchKey)).toBe(stored)

  await startDrag()
  await page.getByRole("button", { name: "新建会话", exact: true }).evaluate((button) => button.click())
  await page.mouse.move(100, 100)
  await page.mouse.up()
  expect(await preference(page, workbenchKey)).toBe(stored)
  await page.getByRole("button", { name: "All-surface acceptance", exact: true }).click()
  await expect.poll(() => panelWidth(panel)).toBeCloseTo(initial, 0)
  expect(observation.pageErrors).toEqual([])
})

test("touch resizing persists its completed width and mobile overlays keep editor identity", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "tablet-chromium", "Touch-capable Chromium acceptance")
  await page.setViewportSize({ width: 1440, height: 1000 })
  const observation = await openPanels(page)
  const handle = page.getByRole("separator", { name: "调整侧栏宽度" })
  const box = (await handle.boundingBox())!
  const session = await page.context().newCDPSession(page)
  const touch = (x: number) => [{ x, y: box.y + box.height / 2, id: 7 }]
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch(box.x) })
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touch(box.x + 30) })
  // Unrelated pointer events must not finish the real CDP touch gesture.
  await handle.dispatchEvent("pointerup", { pointerId: 999, pointerType: "touch" })
  await handle.dispatchEvent("pointercancel", { pointerId: 999, pointerType: "touch" })
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touch(box.x + 65) })
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await expect.poll(() => panelWidth(page.locator("#sidebar-panel"))).toBeGreaterThan(330)
  const saved = Number(await preference(page, sidebarKey))
  expect(saved).toBeGreaterThan(330)
  await expect(page.locator("#chat-panels")).toHaveCSS("touch-action", "auto")
  // A real horizontal overflow surface inside the panel must still swipe.
  await page.locator("#chat-panel").evaluate((panel) => {
    const scroller = panel.ownerDocument.createElement("div")
    scroller.id = "touch-overflow-fixture"
    scroller.style.cssText = "position:fixed;left:460px;top:200px;width:240px;height:70px;overflow:auto;z-index:10"
    const content = panel.ownerDocument.createElement("pre")
    content.style.cssText = "width:1000px;height:40px;margin:0"
    content.textContent = "A horizontally scrolling code/table surface. ".repeat(20)
    scroller.appendChild(content)
    panel.appendChild(scroller)
  })
  const overflow = page.locator("#touch-overflow-fixture")
  const scrollBox = (await overflow.boundingBox())!
  const point = (x: number) => [{ x, y: scrollBox.y + scrollBox.height / 2, id: 9 }]
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(scrollBox.x + 210) })
  for (let step = 1; step <= 6; step++) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(scrollBox.x + 210 - step * 28) })
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await expect.poll(() => overflow.evaluate((element) => element.scrollLeft)).toBeGreaterThan(50)
  await overflow.evaluate((element) => element.remove())
  await session.detach()

  // DOM identity proves the responsive transition did not remount the composer.
  const editor = page.getByRole("textbox", { name: "消息", exact: true }).first()
  await editor.fill("分栏恢复草稿")
  await editor.evaluate((element) => element.setAttribute("data-resize-retained", "true"))
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole("separator")).toHaveCount(0)
  await expect(page.locator("#right-workbench")).toHaveAttribute("aria-modal", "true")
  await page.keyboard.press("Escape")
  await expect(page.locator('[data-resize-retained="true"]')).toContainText("分栏恢复草稿")
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect.poll(() => panelWidth(page.locator("#sidebar-panel"))).toBeCloseTo(saved, 0)
  await expect(page.locator('[data-resize-retained="true"]')).toContainText("分栏恢复草稿")
  expect(observation.pageErrors).toEqual([])
  await testInfo.attach("touch-restored-layout", { body: await page.screenshot(), contentType: "image/png" })
})
