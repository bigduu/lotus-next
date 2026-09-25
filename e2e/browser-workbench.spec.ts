import { devices, expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

test("browser workbench shares one session across human input, DOM, screenshot, and reopen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "phone-chromium", "The phone workbench does not expose the browser")
  const picturePage = await page.context().newPage()
  await picturePage.setViewportSize({ width: 640, height: 480 })
  await picturePage.setContent("<main style='font:32px sans-serif;padding:40px'><h1>Browser fixture</h1><button>Change status</button></main>")
  const jpeg = await picturePage.screenshot({ type: "jpeg", quality: 70 })
  await picturePage.close()

  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  await page.route("**/api/v1/task/all-surface-session", (route) =>
    route.fulfill({ json: { session_id: "all-surface-session", title: null, items: [] } }),
  )

  let pageEpoch = 1
  let frameSeq = 1
  let url = ""
  let title = ""
  let hasTab = false
  let viewport = { width: 640, height: 480 }
  let status = "Ready"
  let openCount = 0
  let closeCount = 0
  const inputs: Array<Record<string, unknown>> = []
  const browserPath = "/api/v1/browser/sessions/all-surface-session"
  const currentState = () => ({
    page_epoch: pageEpoch,
    frame_seq: frameSeq,
    active_tab_id: hasTab ? "tab-a" : null,
    tabs: hasTab ? [{ tab_id: "tab-a", url, title, active: true }] : [],
    url,
    title,
    viewport,
    can_go_back: false,
    can_go_forward: false,
  })

  await page.route("**/api/v1/browser/sessions/all-surface-session**", async (route) => {
    const request = route.request()
    const address = new URL(request.url())
    const path = address.pathname
    const method = request.method()
    if (path === browserPath && method === "PUT") {
      openCount += 1
      await route.fulfill({ json: currentState() })
      return
    }
    if (path === browserPath && method === "DELETE") {
      closeCount += 1
      await route.fulfill({ status: 204 })
      return
    }
    if (path === browserPath && method === "GET") {
      await route.fulfill({ json: currentState() })
      return
    }
    if (path === `${browserPath}/frame` && method === "GET") {
      if (!hasTab) return route.fulfill({ status: 204 })
      if (Number(address.searchParams.get("after")) >= frameSeq) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        await route.fulfill({ status: 204 })
      } else {
        await route.fulfill({
          body: jpeg,
          contentType: "image/jpeg",
          headers: {
            "X-Frame-Seq": String(frameSeq),
            "X-Page-Epoch": String(pageEpoch),
            "X-Tab-Id": "tab-a",
            "X-Viewport-Width": String(viewport.width),
            "X-Viewport-Height": String(viewport.height),
          },
        })
      }
      return
    }
    if (path === `${browserPath}/screenshot` && method === "GET") {
      await route.fulfill({ body: jpeg, contentType: "image/jpeg", headers: { "X-Page-Epoch": String(pageEpoch), "X-Tab-Id": "tab-a" } })
      return
    }
    if (path === `${browserPath}/dom` && method === "GET") {
      await route.fulfill({ json: { page_epoch: pageEpoch, active_tab_id: "tab-a", url, title, snapshot: `- button "Change status"\n- status: ${status}` } })
      return
    }
    if (method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>
      expect(body.expected_epoch).toBe(pageEpoch)
      if (path.endsWith("/tabs")) {
        expect(hasTab).toBe(false)
        hasTab = true
        url = String(body.url)
        title = "Browser fixture"
        pageEpoch += 1
        frameSeq += 1
      } else if (path.endsWith("/navigate")) {
        url = String(body.url)
        pageEpoch += 1
        frameSeq += 1
      } else if (path.endsWith("/viewport")) {
        viewport = { width: Number(body.width), height: Number(body.height) }
        pageEpoch += 1
        frameSeq += 1
      } else if (path.endsWith("/input")) {
        inputs.push(body)
        if (body.kind === "click") status = "Clicked"
        frameSeq += 1
      }
      await route.fulfill({ json: currentState() })
      return
    }
    await route.fulfill({ status: 404, json: { error: "unknown browser route" } })
  })

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  const panel = page.getByRole("complementary", { name: "工作面板" })
  await expect(panel.getByText("还没有打开内容")).toBeVisible()
  await expect(panel.getByRole("tab")).toHaveCount(0)
  const emptyScreenshot = testInfo.outputPath(`empty-workbench-${testInfo.project.name}.png`)
  await page.screenshot({ path: emptyScreenshot })
  await testInfo.attach(`empty-workbench-${testInfo.project.name}`, {
    path: emptyScreenshot,
    contentType: "image/png",
  })
  await panel.getByRole("button", { name: /浏览器.*输入网址后打开/ }).click()
  const browser = panel.getByRole("region", { name: "内置浏览器" })
  await expect(browser.getByText("还没有打开网页")).toBeVisible()
  await expect(panel.getByRole("tab", { name: /浏览器标签页/ })).toHaveCount(0)
  const entryScreenshot = testInfo.outputPath(`browser-entry-${testInfo.project.name}.png`)
  await page.screenshot({ path: entryScreenshot })
  await testInfo.attach(`browser-entry-${testInfo.project.name}`, {
    path: entryScreenshot,
    contentType: "image/png",
  })
  if (testInfo.project.name === "tablet-chromium") {
    await testInfo.attach("820px-tablet-browser", {
      body: await page.screenshot(),
      contentType: "image/png",
    })
  }
  const address = browser.getByRole("textbox", { name: "网页地址" })
  await address.fill("example.test/fixture")
  await browser.getByRole("button", { name: "打开", exact: true }).click()
  await expect(panel.getByRole("tab", { name: "浏览器标签页 1：Browser fixture" })).toHaveAttribute("aria-selected", "true")
  await expect.poll(() => viewport.width).not.toBe(640)
  await expect(address).toHaveValue("https://example.test/fixture")
  await expect(browser.getByRole("button", { name: "查看 DOM" })).toBeEnabled()
  await expect(browser.getByAltText("网页画面")).toBeVisible()
  await browser.getByAltText("网页画面").click()
  await expect.poll(() => inputs.some((input) => input.kind === "click")).toBe(true)
  await expect(browser.getByRole("button", { name: "查看 DOM" })).toBeEnabled()
  await browser.getByRole("button", { name: "查看 DOM" }).click()
  await expect(browser.getByLabel("DOM 快照", { exact: true })).toContainText("Clicked")

  const downloadPromise = page.waitForEvent("download")
  await browser.getByRole("button", { name: "保存网页截图" }).click()
  expect((await downloadPromise).suggestedFilename()).toMatch(/^browser-screenshot-\d+\.jpg$/)
  await browser.getByRole("button", { name: "关闭 DOM 快照" }).click()

  const image = browser.getByAltText("网页画面")
  const oldFrameUrl = await image.getAttribute("src")
  const previousViewport = viewport.width
  await page.setViewportSize(testInfo.project.name === "tablet-chromium"
    ? { width: 1280, height: 800 }
    : { width: 1000, height: 800 })
  await expect.poll(() => viewport.width).not.toBe(previousViewport)
  await expect.poll(async () => {
    const source = await image.getAttribute("src").catch(() => null)
    return source && source !== oldFrameUrl ? source : null
  }).not.toBeNull()
  await image.click()
  await expect.poll(() => inputs.filter((input) => input.kind === "click").length).toBe(2)
  expect(inputs.at(-1)?.expected_epoch).toBe(pageEpoch)
  await image.hover()
  await page.mouse.wheel(0, 240)
  await expect.poll(() => inputs.some((input) => input.kind === "scroll")).toBe(true)

  await panel.getByRole("button", { name: "收起工作面板" }).click()
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  await panel.getByRole("tab", { name: "浏览器标签页 1：Browser fixture" }).click()
  await expect(browser.getByRole("textbox", { name: "网页地址" })).toHaveValue("https://example.test/fixture")
  expect(openCount).toBeGreaterThanOrEqual(2)
  expect(closeCount).toBe(0)
  const overflow = await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  expect(observation.pageErrors).toEqual([])
  await testInfo.attach(`browser-workbench-${testInfo.project.name}`, {
    body: await page.screenshot(),
    contentType: "image/png",
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(panel.getByRole("tab", { name: /浏览器标签页/ })).toHaveCount(0)
  await expect(panel.getByRole("region", { name: "内置浏览器" })).toHaveCount(0)
  await expect(panel.getByText("还没有打开内容")).toBeVisible()
})

test("legacy tabless browser opens its page and keeps a URL draft during model navigation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Legacy browser compatibility")
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  await page.route("**/api/v1/task/all-surface-session", (route) =>
    route.fulfill({ json: { session_id: "all-surface-session", title: null, items: [] } }),
  )
  const browserPath = "/api/v1/browser/sessions/all-surface-session"
  let url = "about:blank"
  let epoch = 1
  let viewport = { width: 320, height: 240 }
  let viewportCalls = 0
  let sawAgentUrl = false
  const navigations: string[] = []
  const state = () => ({
    page_epoch: epoch, frame_seq: epoch, url, title: url,
    viewport, can_go_back: false, can_go_forward: false,
  })
  await page.route("**/api/v1/browser/sessions/all-surface-session**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === browserPath && request.method() === "GET") {
      if (url === "https://agent.test/") sawAgentUrl = true
      return route.fulfill({ json: state() })
    }
    if (path === browserPath && request.method() === "PUT") return route.fulfill({ json: state() })
    if (path === `${browserPath}/frame`) {
      await new Promise((resolve) => setTimeout(resolve, 80))
      return route.fulfill({ status: 204 })
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>
      expect(body.expected_epoch).toBe(epoch)
      if (path === `${browserPath}/navigate`) {
        url = String(body.url)
        navigations.push(url)
      } else if (path === `${browserPath}/viewport`) {
        viewport = { width: Number(body.width), height: Number(body.height) }
        viewportCalls += 1
      } else {
        return route.fulfill({ status: 404 })
      }
      epoch += 1
      return route.fulfill({ json: state() })
    }
    return route.fulfill({ status: 404 })
  })

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  const panel = page.getByRole("complementary", { name: "工作面板" })
  await panel.getByRole("button", { name: /浏览器.*输入网址后打开/ }).click()
  const browser = panel.getByRole("region", { name: "内置浏览器" })
  const address = browser.getByRole("textbox", { name: "网页地址" })
  await expect(browser.getByText("还没有打开网页")).toBeVisible()
  await address.fill("draft.test/new")
  url = "https://agent.test/"
  epoch += 1
  await expect.poll(() => sawAgentUrl).toBe(true)
  await expect(address).toHaveValue("draft.test/new")
  await browser.getByRole("button", { name: "打开", exact: true }).click()
  await expect(browser.getByRole("button", { name: "刷新网页" })).toBeVisible()
  await expect(address).toHaveValue("https://draft.test/new")
  await expect.poll(() => viewportCalls).toBeGreaterThan(0)
  await expect(panel.getByRole("tab", { name: /浏览器标签页/ })).toHaveCount(0)
  expect(navigations).toEqual(["https://draft.test/new"])
  await panel.getByRole("button", { name: "打开工作面板标签页" }).click()
  await page.getByRole("menuitem", { name: "检查器" }).click()
  await panel.getByRole("button", { name: "关闭检查器标签页" }).click()
  await expect(panel.getByText("还没有打开内容")).toBeVisible()
  await panel.getByRole("button", { name: /浏览器.*输入网址后打开/ }).click()
  await expect(browser.getByRole("button", { name: "刷新网页" })).toBeVisible()
  await expect(address).toHaveValue("https://draft.test/new")
  expect(navigations).toEqual(["https://draft.test/new"])
  expect(observation.pageErrors).toEqual([])
})

test("workbench tabs follow human commands and an agent-opened popup on desktop and tablet", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "phone-chromium", "The phone workbench does not expose the browser")
  const picturePage = await page.context().newPage()
  await picturePage.setViewportSize({ width: 640, height: 480 })
  const pictures: Record<string, Buffer> = {}
  for (const tabId of ["tab-a", "tab-b", "tab-c"]) {
    await picturePage.setContent(`<body style="margin:0;background:#e7f0ff;color:#123"><main style="font:48px sans-serif;padding:60px">${tabId}</main></body>`)
    pictures[tabId] = await picturePage.screenshot({ type: "jpeg", quality: 70 })
  }
  await picturePage.close()

  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  await page.route("**/api/v1/task/all-surface-session", (route) =>
    route.fulfill({ json: { session_id: "all-surface-session", title: null, items: [] } }),
  )

  const browserPath = "/api/v1/browser/sessions/all-surface-session"
  const tabs = [{ tab_id: "tab-a", url: "https://a.test/", title: "Alpha", active: true }]
  let activeTabId = "tab-a"
  let pageEpoch = 1
  let frameSeq = 1
  const viewport = { width: 640, height: 480 }
  const state = () => {
    const active = tabs.find((tab) => tab.tab_id === activeTabId)!
    return {
      page_epoch: pageEpoch,
      frame_seq: frameSeq,
      active_tab_id: activeTabId,
      tabs: tabs.map((tab) => ({ ...tab, active: tab.tab_id === activeTabId })),
      url: active.url,
      title: active.title,
      viewport,
      can_go_back: false,
      can_go_forward: false,
    }
  }
  const switchTo = (tabId: string) => {
    activeTabId = tabId
    pageEpoch += 1
    frameSeq += 1
  }
  await page.route("**/api/v1/browser/sessions/all-surface-session**", async (route) => {
    const request = route.request()
    const address = new URL(request.url())
    const path = address.pathname
    const method = request.method()
    if (path === browserPath && method === "PUT") return route.fulfill({ json: state() })
    if (path === browserPath && method === "GET") return route.fulfill({ json: state() })
    if (path === `${browserPath}/frame` && method === "GET") {
      if (Number(address.searchParams.get("after")) >= frameSeq) {
        await new Promise((resolve) => setTimeout(resolve, 80))
        if (Number(address.searchParams.get("after")) >= frameSeq) return route.fulfill({ status: 204 })
      }
      return route.fulfill({
        body: pictures[activeTabId], contentType: "image/jpeg",
        headers: {
          "X-Frame-Seq": String(frameSeq), "X-Page-Epoch": String(pageEpoch),
          "X-Tab-Id": activeTabId, "X-Viewport-Width": String(viewport.width),
          "X-Viewport-Height": String(viewport.height),
        },
      })
    }
    if (path === `${browserPath}/dom` && method === "GET") {
      return route.fulfill({ json: { page_epoch: pageEpoch, active_tab_id: activeTabId, url: state().url, title: state().title, snapshot: `- heading: ${activeTabId}` } })
    }
    if (path === `${browserPath}/screenshot` && method === "GET") {
      return route.fulfill({ body: pictures[activeTabId], contentType: "image/jpeg", headers: { "X-Page-Epoch": String(pageEpoch), "X-Tab-Id": activeTabId } })
    }
    if (method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>
      if (body.expected_epoch !== pageEpoch) {
        return route.fulfill({ status: 409, json: { error: "browser page changed" } })
      }
      if (path === `${browserPath}/tabs`) {
        expect(body.url).toBe("https://b.test/")
        tabs.push({ tab_id: "tab-b", url: "https://b.test/", title: "Beta", active: false })
        switchTo("tab-b")
      } else if (path === `${browserPath}/tabs/activate`) {
        switchTo(String(body.tab_id))
      } else if (path === `${browserPath}/tabs/close`) {
        const index = tabs.findIndex((tab) => tab.tab_id === body.tab_id)
        expect(index).toBeGreaterThanOrEqual(0)
        const wasActive = activeTabId === body.tab_id
        tabs.splice(index, 1)
        if (wasActive) switchTo(tabs.at(-1)!.tab_id)
      } else if (path === `${browserPath}/viewport`) {
        viewport.width = Number(body.width)
        viewport.height = Number(body.height)
        pageEpoch += 1
        frameSeq += 1
      }
      return route.fulfill({ json: state() })
    }
    return route.fulfill({ status: 404 })
  })

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  const panel = page.getByRole("complementary", { name: "工作面板" })
  await panel.getByRole("button", { name: /浏览器.*输入网址后打开/ }).click()
  await panel.getByRole("tab", { name: "浏览器标签页 1：Alpha" }).click()
  const browser = panel.getByRole("region", { name: "内置浏览器" })
  const image = browser.getByAltText("网页画面")
  await expect(browser.getByRole("navigation", { name: "浏览器标签列表" })).toHaveCount(0)
  await expect(image).toBeVisible()
  const firstImage = await image.getAttribute("src")
  await panel.getByRole("button", { name: "打开工作面板标签页" }).click()
  await page.getByRole("menuitem", { name: "浏览器" }).click()
  await expect(browser.getByText("打开新网页")).toBeVisible()
  await browser.getByRole("textbox", { name: "网页地址" }).fill("https://b.test/")
  await browser.getByRole("button", { name: "打开", exact: true }).click()
  await expect(panel.getByRole("tab", { name: "浏览器标签页 2：Beta" })).toHaveAttribute("aria-selected", "true")
  await expect(browser.getByRole("textbox", { name: "网页地址" })).toHaveValue("https://b.test/")
  await expect.poll(() => image.getAttribute("src")).not.toBe(firstImage)
  await panel.getByRole("tab", { name: "浏览器标签页 1：Alpha" }).click()
  await expect(browser.getByRole("textbox", { name: "网页地址" })).toHaveValue("https://a.test/")

  // A model-opened popup changes Bamboo authority without a Lotus command.
  tabs.push({ tab_id: "tab-c", url: "https://c.test/", title: "Popup", active: false })
  switchTo("tab-c")
  await expect(panel.getByRole("tab", { name: "浏览器标签页 3：Popup" })).toHaveAttribute("aria-selected", "true")
  await expect(browser.getByRole("textbox", { name: "网页地址" })).toHaveValue("https://c.test/")
  await browser.getByRole("button", { name: "查看 DOM" }).click()
  await expect(browser.getByLabel("DOM 快照", { exact: true })).toContainText("tab-c")
  await browser.getByRole("button", { name: "关闭 DOM 快照" }).click()
  const downloadPromise = page.waitForEvent("download")
  await browser.getByRole("button", { name: "保存网页截图" }).click()
  const download = await downloadPromise
  expect(await readFile(await download.path())).toEqual(pictures["tab-c"])
  await panel.getByRole("button", { name: "关闭浏览器标签页 3：Popup" }).click()
  await expect(panel.getByRole("tab", { name: "浏览器标签页 2：Beta" })).toHaveAttribute("aria-selected", "true")
  await expect(image).toBeVisible()

  await panel.getByRole("button", { name: "打开工作面板标签页" }).click()
  await page.getByRole("menuitem", { name: "检查器" }).click()
  const tablist = panel.getByRole("tablist", { name: "工作面板标签页" })
  const order = () => tablist.locator('[role="tab"]').allTextContents()
  await expect.poll(order).toEqual(["检查器", "Alpha", "Beta"])
  const betaHandle = panel.getByRole("button", { name: "调整Beta标签页顺序" })
  await betaHandle.focus()
  await betaHandle.press("Alt+ArrowLeft")
  await betaHandle.press("Alt+ArrowLeft")
  await expect.poll(order).toEqual(["Beta", "检查器", "Alpha"])
  await expect(panel.getByRole("tab", { name: "检查器" })).toHaveAttribute("aria-selected", "true")
  await panel.getByRole("button", { name: "调整Alpha标签页顺序" }).dragTo(betaHandle)
  await expect.poll(order).toEqual(["Alpha", "Beta", "检查器"])
  const reorderedScreenshot = testInfo.outputPath(`reordered-workbench-${testInfo.project.name}.png`)
  await page.screenshot({ path: reorderedScreenshot })
  await testInfo.attach(`reordered-workbench-${testInfo.project.name}`, { path: reorderedScreenshot, contentType: "image/png" })
  await panel.getByRole("tab", { name: "浏览器标签页 2：Beta" }).click()
  await expect(browser.getByRole("textbox", { name: "网页地址" })).toHaveValue("https://b.test/")
  await panel.getByRole("button", { name: "关闭检查器标签页" }).click()
  await expect.poll(order).toEqual(["Alpha", "Beta"])
  await expect(panel.getByRole("tab", { name: "浏览器标签页 2：Beta" })).toHaveAttribute("aria-selected", "true")
  await betaHandle.focus()
  await betaHandle.press("Space")
  await betaHandle.press("Escape")
  await expect.poll(order).toEqual(["Alpha", "Beta"])
  await panel.getByRole("button", { name: "收起工作面板" }).click()
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  await expect.poll(order).toEqual(["Alpha", "Beta"])
  expect(observation.pageErrors).toEqual([])
  const tabsScreenshot = testInfo.outputPath(`browser-top-tabs-${testInfo.project.name}.png`)
  await page.screenshot({ path: tabsScreenshot })
  await testInfo.attach(`browser-tabs-${testInfo.project.name}`, { path: tabsScreenshot, contentType: "image/png" })
  if (testInfo.project.name === "tablet-chromium") {
    for (let index = 3; index <= 8; index++) {
      const tabId = `extra-${index}`
      tabs.push({ tab_id: tabId, url: `https://${index}.test/`, title: `Extra ${index}`, active: false })
      pictures[tabId] = pictures["tab-b"]
    }
    switchTo("extra-8")
    const lastTab = panel.getByRole("tab", { name: "浏览器标签页 8：Extra 8" })
    await expect(lastTab).toHaveAttribute("aria-selected", "true")
    await expect.poll(async () => {
      const list = await tablist.boundingBox()
      const active = await lastTab.boundingBox()
      return Boolean(list && active && active.x >= list.x && active.x + active.width <= list.x + list.width + 1)
    }).toBe(true)
    const overflow = await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  }
})

test("phone workbench has no browser entry or browser session requests", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone-chromium", "Phone-only browser visibility check")

  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  await page.route("**/api/v1/task/all-surface-session", (route) =>
    route.fulfill({ json: { session_id: "all-surface-session", title: null, items: [] } }),
  )
  let browserRequests = 0
  await page.route("**/api/v1/browser/**", (route) => {
    browserRequests += 1
    return route.abort()
  })

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  const panel = page.getByRole("complementary", { name: "工作面板" })
  await expect(panel.getByRole("tab", { name: "浏览器" })).toHaveCount(0)
  await expect(panel.getByRole("region", { name: "内置浏览器" })).toHaveCount(0)
  expect(browserRequests).toBe(0)
  await page.setViewportSize({ width: 915, height: 412 })
  await expect(panel.getByRole("tab", { name: "浏览器" })).toHaveCount(0)
  await expect(panel.getByRole("region", { name: "内置浏览器" })).toHaveCount(0)
  await page.waitForTimeout(200)
  expect(browserRequests).toBe(0)
  const landscapeScreenshot = testInfo.outputPath("pixel-landscape-workbench-no-browser.png")
  await page.screenshot({ path: landscapeScreenshot })
  await testInfo.attach("pixel-landscape-workbench-no-browser", {
    path: landscapeScreenshot,
    contentType: "image/png",
  })
  await page.setViewportSize({ width: 412, height: 915 })
  await expect(panel.getByRole("tab", { name: "浏览器" })).toHaveCount(0)
  expect(browserRequests).toBe(0)
  expect(observation.pageErrors).toEqual([])
  const screenshotPath = testInfo.outputPath("phone-workbench-no-browser.png")
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach("phone-workbench-no-browser", { path: screenshotPath, contentType: "image/png" })
})

test("iPhone landscape workbench has no browser entry or browser session requests", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "phone-chromium", "Phone-only browser visibility check")
  const device = devices["iPhone 15 Pro Max"]
  const context = await browser.newContext({
    userAgent: device.userAgent,
    viewport: { width: 932, height: 430 },
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
  })
  try {
    const page = await context.newPage()
    await page.addInitScript(() => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      localStorage.setItem("lotus_next_last_session", "all-surface-session")
    })
    const observation = await installArtifactRuntime(page, standaloneScenario)
    await page.route("**/api/v1/task/all-surface-session", (route) =>
      route.fulfill({ json: { session_id: "all-surface-session", title: null, items: [] } }),
    )
    let browserRequests = 0
    await page.route("**/api/v1/browser/**", (route) => {
      browserRequests += 1
      return route.abort()
    })

    await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开侧边面板" }).click()
    const panel = page.getByRole("complementary", { name: "工作面板" })
    await expect(panel.getByRole("tab", { name: "浏览器" })).toHaveCount(0)
    await expect(panel.getByRole("region", { name: "内置浏览器" })).toHaveCount(0)
    await page.waitForTimeout(200)
    expect(browserRequests).toBe(0)
    expect(observation.pageErrors).toEqual([])
    const screenshotPath = testInfo.outputPath("iphone-landscape-workbench-no-browser.png")
    await page.screenshot({ path: screenshotPath })
    await testInfo.attach("iphone-landscape-workbench-no-browser", {
      path: screenshotPath,
      contentType: "image/png",
    })
  } finally {
    await context.close()
  }
})
