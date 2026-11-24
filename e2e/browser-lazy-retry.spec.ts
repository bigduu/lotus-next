import { expect, test } from "@playwright/test"
import { artifactFileForSource, installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { workbenchPanel } from "./support/workbench.js"

test("Browser retries a failed view chunk in place without changing the remote session", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "one built chunk recovery case")
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  await installArtifactRuntime(page, standaloneScenario)
  const [original, alternate] = await Promise.all([
    artifactFileForSource("src/solid/workbench/browser/BrowserPane.tsx"),
    artifactFileForSource("src/solid/workbench/browser/BrowserPane.tsx?browser-retry"),
  ])
  expect(alternate).not.toBe(original)
  const assetRequests: string[] = []
  const browserRequests: { method: string; path: string }[] = []
  let navigations = 0
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations += 1 })
  await page.route("**/assets/BrowserPane-*.js", (route) => {
    const requested = new URL(route.request().url()).pathname.slice(1)
    assetRequests.push(requested)
    return requested === original ? route.abort("failed") : route.fallback()
  })
  await page.route("**/api/v1/browser/sessions/all-surface-session**", (route) => {
    const { pathname: path } = new URL(route.request().url())
    const method = route.request().method()
    browserRequests.push({ method, path })
    if (method !== "GET" || path.endsWith("/frame")) return route.fulfill({ status: 405 })
    return route.fulfill({ json: {
      page_epoch: 2, frame_seq: 0, active_tab_id: null, tabs: [], url: "", title: "",
      viewport: { width: 640, height: 480 }, can_go_back: false, can_go_forward: false,
    } })
  })

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("button", { name: "All-surface acceptance", exact: true })).toHaveAttribute("aria-current", "page")
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  const panel = workbenchPanel(page)
  await expect(panel.getByText("还没有打开内容")).toBeVisible()
  expect(assetRequests).toEqual([])
  expect(browserRequests).toEqual([])
  await panel.getByRole("button", { name: /浏览器.*输入网址后打开/ }).click()
  await expect(panel.getByRole("alert").filter({ hasText: "浏览器面板加载失败" })).toBeVisible()
  expect(assetRequests).toEqual([original])
  expect(navigations).toBe(1)
  await panel.getByRole("button", { name: "重试", exact: true }).click()
  await expect(panel.getByText("还没有打开网页")).toBeVisible()
  expect(assetRequests).toEqual([original, alternate])
  expect(navigations).toBe(1)
  expect(browserRequests).not.toEqual([])
  expect(browserRequests.every(({ method, path }) => method === "GET" && !path.endsWith("/frame"))).toBe(true)
})
