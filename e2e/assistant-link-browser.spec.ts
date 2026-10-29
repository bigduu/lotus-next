import { workbenchPanel } from "./support/workbench.js"
import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const linkedUrl = "https://github.com/bigduu/lotus-next/issues/180"
const browserPath = "/api/v1/browser/sessions/all-surface-session"

test("assistant link can be copied or opened as a new top-level browser tab", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop link-to-browser regression")

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: standaloneScenario.origin,
  })
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario, [{
    id: "assistant-link",
    role: "assistant",
    content: `[Open issue](${linkedUrl})`,
    created_at: "2026-09-25T00:00:00Z",
  }])

  const tabs: Array<{ tab_id: string; url: string; title: string; active: boolean }> = []
  let activeTabId: string | null = null
  let pageEpoch = 1
  let frameSeq = 1
  let pendingDialog = false
  let holdNavigation = false
  let releaseNavigation: (() => void) | null = null
  const dialogId = "1".padStart(24, "0")
  const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = []
  const state = () => {
    const active = tabs.find((tab) => tab.tab_id === activeTabId)
    return {
      page_epoch: pageEpoch,
      frame_seq: frameSeq,
      active_tab_id: activeTabId,
      tabs: tabs.map((tab) => ({ ...tab, active: tab.tab_id === activeTabId })),
      url: active?.url ?? "",
      title: active?.title ?? "",
      viewport: { width: 640, height: 480 },
      can_go_back: false,
      can_go_forward: false,
      pending_dialog: pendingDialog ? {
        dialog_id: dialogId, tab_id: activeTabId, page_epoch: pageEpoch,
        url: linkedUrl, type: "alert", message: "Confirm navigation",
        message_truncated: false, default_value: "", default_value_truncated: false,
        expires_at_ms: Date.now() + 30_000, status: "pending",
      } : null,
    }
  }
  await page.route("**/api/v1/browser/sessions/all-surface-session**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    const body = method === "POST" ? request.postDataJSON() as Record<string, unknown> : undefined
    calls.push({ method, path, ...(body ? { body } : {}) })

    if (path === browserPath && (method === "PUT" || method === "GET")) {
      return route.fulfill({ json: state() })
    }
    if (path === `${browserPath}/frame` && method === "GET") {
      if (pendingDialog) return route.fulfill({ status: 409, json: { error: { code: "dialog_pending" } } })
      await new Promise((resolve) => setTimeout(resolve, 80))
      return route.fulfill({ status: 204 })
    }
    if (method === "POST") {
      expect(body?.expected_epoch).toBe(pageEpoch)
      if (path === `${browserPath}/dialog`) {
        expect(body?.dialog_id).toBe(dialogId)
        pendingDialog = false
        frameSeq += 1
        return route.fulfill({ json: state() })
      }
      if (path === `${browserPath}/navigate` && holdNavigation) {
        await new Promise<void>((resolve) => { releaseNavigation = resolve })
        holdNavigation = false
        pendingDialog = true
        pageEpoch += 1
        frameSeq += 1
        return route.fulfill({ json: state() })
      }
      if (path === `${browserPath}/tabs`) {
        expect(body?.url).toBe(linkedUrl)
        activeTabId = `tab-${String.fromCharCode(97 + tabs.length)}`
        tabs.push({ tab_id: activeTabId, url: linkedUrl, title: "Linked issue", active: true })
      } else if (path !== `${browserPath}/viewport`) {
        return route.fulfill({ status: 404 })
      }
      pageEpoch += 1
      frameSeq += 1
      return route.fulfill({ json: state() })
    }
    return route.fulfill({ status: 404 })
  })

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  const link = page.locator('[data-streamdown="link"]', { hasText: "Open issue" })
  await expect(link).toBeVisible()

  await link.click()
  const dialog = page.getByRole("dialog", { name: "打开外部链接？" })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "复制链接" }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => {
    const clipboard = (navigator as Navigator & { clipboard: { readText(): Promise<string> } }).clipboard
    return clipboard.readText()
  })).toBe(linkedUrl)

  await link.click()
  await dialog.getByRole("button", { name: "打开链接" }).click()
  const inAppOption = page.getByRole("menuitem", { name: "在应用内打开" })
  await expect(inAppOption).toBeVisible()
  await expect(page.locator('[data-slot="dropdown-menu-content"]')).toHaveCSS("opacity", "1")
  const dropdownScreenshot = testInfo.outputPath("assistant-link-open-dropdown.png")
  await page.screenshot({ path: dropdownScreenshot })
  await testInfo.attach("assistant-link-open-dropdown", { path: dropdownScreenshot, contentType: "image/png" })
  await inAppOption.click()
  await expect(dialog).toHaveCount(0)

  const panel = workbenchPanel(page)
  await expect(panel).toBeVisible()
  await expect(panel.getByRole("tab", { name: "浏览器标签页 1：Linked issue" })).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByRole("tab", { name: /浏览器标签页/ })).toHaveCount(1)
  await expect(panel.getByRole("region", { name: "内置浏览器" }).getByRole("textbox", { name: "网页地址" })).toHaveValue(linkedUrl)
  await expect(panel.getByRole("region", { name: "内置浏览器" }).getByRole("navigation", { name: "浏览器标签列表" })).toHaveCount(0)

  const mutations = calls.filter((call) => call.method === "POST" && (call.path === `${browserPath}/tabs` || call.path === `${browserPath}/navigate`))
  expect(mutations.map((call) => call.path)).toEqual([`${browserPath}/tabs`])
  expect(mutations[0]?.body?.url).toBe(linkedUrl)
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
  const browserScreenshot = testInfo.outputPath("assistant-link-in-app-browser.png")
  await page.screenshot({ path: browserScreenshot })
  await testInfo.attach("assistant-link-in-app-browser", { path: browserScreenshot, contentType: "image/png" })

  pendingDialog = true
  const browser = panel.getByRole("region", { name: "内置浏览器" })
  const pageDialog = browser.getByRole("dialog", { name: "网页弹窗" })
  await expect(pageDialog).toContainText("Confirm navigation")
  await link.click()
  await dialog.getByRole("button", { name: "打开链接" }).click()
  await inAppOption.click()
  await expect(pageDialog).toBeVisible()
  expect(calls.filter((call) => call.method === "POST" && call.path === `${browserPath}/tabs`)).toHaveLength(1)
  await pageDialog.getByRole("button", { name: "确定" }).click()
  await expect(panel.getByRole("tab", { name: "浏览器标签页 2：Linked issue" })).toHaveAttribute("aria-selected", "true")
  expect(calls.filter((call) => call.method === "POST" && call.path === `${browserPath}/tabs`)).toHaveLength(2)

  // A link request queued behind another browser action survives if that
  // action raises a dialog before the link's tab creation can run.
  holdNavigation = true
  await browser.getByRole("textbox", { name: "网页地址" }).fill("https://race.test/")
  await browser.getByRole("button", { name: "访问网页" }).click()
  await expect.poll(() => Boolean(releaseNavigation)).toBe(true)
  await link.click()
  await dialog.getByRole("button", { name: "打开链接" }).click()
  await inAppOption.click()
  const resumeNavigation = releaseNavigation as (() => void) | null
  resumeNavigation?.()
  await expect(pageDialog).toBeVisible()
  expect(calls.filter((call) => call.method === "POST" && call.path === `${browserPath}/tabs`)).toHaveLength(2)
  await pageDialog.getByRole("button", { name: "确定" }).click()
  await expect(panel.getByRole("tab", { name: "浏览器标签页 3：Linked issue" })).toHaveAttribute("aria-selected", "true")
  expect(calls.filter((call) => call.method === "POST" && call.path === `${browserPath}/tabs`)).toHaveLength(3)
  expect(observation.pageErrors).toEqual([])
})

test("an in-app link waits for an in-flight browser close and opens in the reopened scope", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop link-to-browser regression")
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario, [{
    id: "assistant-link", role: "assistant", content: `[Open issue](${linkedUrl})`, created_at: "2026-09-25T00:00:00Z",
  }])
  const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = []
  let open = false, epoch = 1
  let tabs: Array<{ tab_id: string; url: string; title: string; active: boolean }> = []
  let releaseClose: (() => void) | undefined
  const state = () => ({
    profile_mode: "shared", storage_shared: true, page_epoch: epoch, frame_seq: 0,
    active_tab_id: tabs.find((tab) => tab.active)?.tab_id ?? null, tabs,
    url: tabs.find((tab) => tab.active)?.url ?? "", title: tabs.find((tab) => tab.active)?.title ?? "",
    viewport: { width: 640, height: 480 }, can_go_back: false, can_go_forward: false,
  })
  await page.route("**/api/v1/browser/sessions/all-surface-session**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : undefined
    calls.push({ method, path, ...(body ? { body } : {}) })
    if (path === browserPath && method === "DELETE") {
      await new Promise<void>((resolve) => { releaseClose = resolve })
      open = false
      return route.fulfill({ status: 204 })
    }
    if (path === browserPath && method === "PUT") {
      expect(body ?? {}).toEqual({})
      open = true; epoch += 1
      tabs = [{ tab_id: `initial-${epoch}`, url: "about:blank", title: "Initial page", active: true }]
      return route.fulfill({ json: state() })
    }
    if (!open) return route.fulfill({ status: 404, json: { error: { code: "browser_not_open", type: "browser_error", message: "closed" } } })
    if (path === browserPath && method === "GET") return route.fulfill({ json: state() })
    if (path === `${browserPath}/frame` && method === "GET") {
      await new Promise((resolve) => setTimeout(resolve, 80))
      return route.fulfill({ status: 204 })
    }
    if (method === "POST" && path === `${browserPath}/tabs`) {
      expect(body?.url).toBe(linkedUrl)
      expect(body?.expected_epoch).toBe(epoch)
      tabs = tabs.map((tab) => ({ ...tab, active: false }))
      tabs.push({ tab_id: `linked-${epoch}`, url: linkedUrl, title: "Linked issue", active: true })
      epoch += 1
      return route.fulfill({ json: state() })
    }
    if (method === "POST" && path === `${browserPath}/viewport`) return route.fulfill({ json: state() })
    return route.fulfill({ status: 404 })
  })

  try {
    await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开侧边面板" }).click()
    const panel = workbenchPanel(page)
    await panel.getByRole("button", { name: /浏览器.*输入网址后打开/ }).click()
    const browser = panel.getByRole("region", { name: "内置浏览器" })
    await expect(browser.getByText("当前模式：共享账户")).toBeAttached()
    if ((await browser.locator("details").getAttribute("open")) === null) await browser.locator("summary").click()
    await browser.getByRole("button", { name: "关闭当前聊天浏览器" }).click()
    await expect.poll(() => Boolean(releaseClose)).toBe(true)

    await page.locator('[data-streamdown="link"]', { hasText: "Open issue" }).click()
    const dialog = page.getByRole("dialog", { name: "打开外部链接？" })
    await dialog.getByRole("button", { name: "打开链接" }).click()
    await page.getByRole("menuitem", { name: "在应用内打开" }).click()
    await expect(dialog).toHaveCount(0)
    await page.waitForTimeout(200)
    expect(calls.filter((call) => call.method === "POST" && call.path === `${browserPath}/tabs`)).toHaveLength(0)
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1)

    releaseClose?.()
    await expect(panel.getByRole("tab", { name: /Linked issue/ })).toHaveAttribute("aria-selected", "true")
    expect(calls.filter((call) => call.path === browserPath && ["PUT", "DELETE"].includes(call.method)).map((call) => call.method)).toEqual(["PUT", "DELETE", "PUT"])
    expect(calls.filter((call) => call.method === "POST" && call.path === `${browserPath}/tabs`)).toHaveLength(1)
    expect(observation.pageErrors).toEqual([])
  } finally {
    releaseClose?.()
  }
})
