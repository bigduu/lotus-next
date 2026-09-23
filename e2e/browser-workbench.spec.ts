import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

test("browser workbench shares one session across human input, DOM, screenshot, and reopen", async ({ page }, testInfo) => {
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
  let url = "about:blank"
  let title = "Browser fixture"
  let viewport = { width: 640, height: 480 }
  let status = "Ready"
  let openCount = 0
  let closeCount = 0
  const inputs: Array<Record<string, unknown>> = []
  const browserPath = "/api/v1/browser/sessions/all-surface-session"
  const currentState = () => ({
    page_epoch: pageEpoch,
    frame_seq: frameSeq,
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
            "X-Viewport-Width": String(viewport.width),
            "X-Viewport-Height": String(viewport.height),
          },
        })
      }
      return
    }
    if (path === `${browserPath}/screenshot` && method === "GET") {
      await route.fulfill({ body: jpeg, contentType: "image/jpeg" })
      return
    }
    if (path === `${browserPath}/dom` && method === "GET") {
      await route.fulfill({ json: { page_epoch: pageEpoch, url, title, snapshot: `- button "Change status"\n- status: ${status}` } })
      return
    }
    if (method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>
      expect(body.expected_epoch).toBe(pageEpoch)
      if (path.endsWith("/navigate")) {
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
  await panel.getByRole("tab", { name: "浏览器" }).click()
  const browser = panel.getByRole("region", { name: "内置浏览器" })
  await expect(browser.getByAltText("网页画面")).toBeVisible()
  await expect.poll(() => viewport.width).not.toBe(640)
  await expect(browser.getByRole("button", { name: "查看 DOM" })).toBeEnabled()
  const address = browser.getByRole("textbox", { name: "网页地址" })
  await address.fill("example.test/fixture")
  await browser.getByRole("button", { name: "访问网页" }).click()
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
  await page.setViewportSize(testInfo.project.name === "phone-chromium"
    ? { width: 430, height: 780 }
    : { width: 680, height: 800 })
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
  await panel.getByRole("tab", { name: "浏览器" }).click()
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
})
