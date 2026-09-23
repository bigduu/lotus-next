import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile } from "node:fs/promises"
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test"

const execFileAsync = promisify(execFile)
const fixtureOrigin = "http://127.0.0.1:18080"
const fixtureUrl = (tab: "alpha" | "beta" | "popup") => `${fixtureOrigin}/browser-tabs-fixture?tab=${tab}`

type BrowserState = {
  page_epoch: number
  active_tab_id: string
  url: string
  tabs: Array<{ tab_id: string; url: string; title: string; active: boolean }>
}

const requiredEnv = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing real Bamboo environment: ${name}`)
  return value
}

const browserPath = (sessionId: string) => `/api/v1/browser/sessions/${encodeURIComponent(sessionId)}`

const setTestSessionAutoPermission = async (baseUrl: string, sessionId: string) => {
  const url = new URL(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, baseUrl)
  const before = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5_000) })
  expect(before.status).toBe(200)
  const prior = await before.json() as { session: { id: string; permission_mode: string } }
  expect(prior.session).toMatchObject({ id: sessionId, permission_mode: "default" })
  const etag = before.headers.get("etag")
  expect(etag).toMatch(/^"\d+"$/)

  // These two isolated acceptance sessions have no interactive approval UI for
  // the direct root-tool request below. Keep the product's default untouched.
  const changed = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json", "if-match": etag! },
    body: JSON.stringify({ permission_mode: "auto" }),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  })
  expect(changed.status).toBe(200)
  const written = await changed.json() as { session: { id: string; permission_mode: string } }
  expect(written.session).toMatchObject({ id: sessionId, permission_mode: "auto" })

  const readBack = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5_000) })
  expect(readBack.status).toBe(200)
  const persisted = await readBack.json() as { session: { id: string; permission_mode: string } }
  expect(persisted.session).toMatchObject({ id: sessionId, permission_mode: "auto" })
}

const readState = async (baseUrl: string, sessionId: string): Promise<BrowserState> => {
  const response = await fetch(new URL(browserPath(sessionId), baseUrl), { signal: AbortSignal.timeout(5_000) })
  expect(response.status).toBe(200)
  const state = await response.json() as BrowserState
  expect(typeof state.active_tab_id).toBe("string")
  expect(state.tabs.filter((tab) => tab.active).map((tab) => tab.tab_id)).toEqual([state.active_tab_id])
  return state
}

const readSettledState = async (baseUrl: string, sessionId: string, url: string): Promise<BrowserState> => {
  let settled: BrowserState | null = null
  await expect.poll(async () => {
    const before = await readState(baseUrl, sessionId)
    await new Promise((resolve) => setTimeout(resolve, 250))
    const after = await readState(baseUrl, sessionId)
    if (after.url !== url || before.page_epoch !== after.page_epoch || before.active_tab_id !== after.active_tab_id) return false
    settled = after
    return true
  }).toBe(true)
  return settled!
}

const assertActiveReads = async (baseUrl: string, sessionId: string, expected: BrowserState, title: string) => {
  const path = browserPath(sessionId)
  const domResponse = await fetch(new URL(`${path}/dom`, baseUrl), { signal: AbortSignal.timeout(10_000) })
  expect(domResponse.status).toBe(200)
  const dom = await domResponse.json() as { page_epoch: number; active_tab_id: string; url: string; snapshot: string }
  expect(dom).toMatchObject({ page_epoch: expected.page_epoch, active_tab_id: expected.active_tab_id, url: expected.url })
  expect(dom.snapshot).toContain(title)

  const screenshotResponse = await fetch(new URL(`${path}/screenshot`, baseUrl), { signal: AbortSignal.timeout(10_000) })
  expect(screenshotResponse.status).toBe(200)
  expect(screenshotResponse.headers.get("x-tab-id")).toBe(expected.active_tab_id)
  expect(screenshotResponse.headers.get("x-page-epoch")).toBe(String(expected.page_epoch))
  const screenshot = Buffer.from(await screenshotResponse.arrayBuffer())
  expect(screenshot.length).toBeGreaterThan(1_000)
  expect(screenshot.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))

  await expect.poll(async () => {
    const response = await fetch(new URL(`${path}/frame?after=0&wait_ms=250`, baseUrl), { signal: AbortSignal.timeout(5_000) })
    await response.arrayBuffer()
    return {
      status: response.status,
      tab: response.headers.get("x-tab-id"),
      epoch: response.headers.get("x-page-epoch"),
    }
  }).toEqual({ status: 200, tab: expected.active_tab_id, epoch: String(expected.page_epoch) })
  return screenshot
}

const executeBrowser = async (baseUrl: string, sessionId: string, args: Record<string, unknown>) => {
  const response = await fetch(new URL("/api/v1/tools/execute", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tool_name: "browser",
      session_id: sessionId,
      parameters: Object.entries(args).map(([name, value]) => ({ name, value: JSON.stringify(value) })),
    }),
    signal: AbortSignal.timeout(20_000),
  })
  expect(response.status).toBe(200)
  const outer = await response.json() as { result: string }
  const result = JSON.parse(outer.result) as { success: boolean; result: string }
  expect(result.success).toBe(true)
  return result
}

const installSessionEntry = async (context: BrowserContext, baseUrl: string, sessionId: string) => {
  await context.addInitScript(({ origin, selectedSessionId }) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.removeItem("copilot_backend_base_url")
    localStorage.setItem("lotus_next_backend_endpoint_v1", origin)
    localStorage.setItem("lotus_next_last_session", selectedSessionId)
  }, { origin: new URL(baseUrl).origin, selectedSessionId: sessionId })
}

const assertBundledBrowserRuntime = async (testInfo: TestInfo) => {
  const containerId = requiredEnv("LOTUS_REAL_BAMBOO_CONTAINER_ID")
  const probe = `const fs=require('node:fs');const p=require('/usr/local/libexec/bamboo-browser/node_modules/playwright-core');const meta=require('/usr/local/libexec/bamboo-browser/node_modules/playwright-core/package.json');const browsers=require('/usr/local/libexec/bamboo-browser/node_modules/playwright-core/browsers.json').browsers;const shell=browsers.find(b=>b.name==='chromium-headless-shell');const host=process.env.BAMBOO_BROWSER_HOST_SCRIPT;fs.accessSync(host,fs.constants.R_OK);fs.accessSync('/opt/ms-playwright/chromium_headless_shell-'+shell.revision,fs.constants.R_OK|fs.constants.X_OK);(async()=>{const browser=await p.chromium.launch({headless:true});const version=browser.version();await browser.close();process.stdout.write(JSON.stringify({node:process.version,playwright:meta.version,chromium:version,revision:shell.revision,host}));})().catch(e=>{console.error(e);process.exitCode=1})`
  const { stdout } = await execFileAsync("docker", ["exec", "--user", "10001", containerId, "/usr/local/bin/node", "-e", probe], { timeout: 20_000 })
  const runtime = JSON.parse(stdout) as { node: string; playwright: string; chromium: string; revision: string; host: string }
  expect(runtime).toEqual({
    node: "v24.21.0",
    playwright: "1.62.1",
    chromium: "151.0.7922.34",
    revision: "1234",
    host: "/usr/local/libexec/bamboo-browser/host.cjs",
  })
  await testInfo.attach("bundled-browser-runtime", { body: JSON.stringify(runtime, null, 2), contentType: "application/json" })
}

const exerciseSurface = async (
  browser: Browser,
  testInfo: TestInfo,
  label: "desktop" | "phone",
  sessionId: string,
) => {
  const baseUrl = requiredEnv("LOTUS_REAL_BAMBOO_BASE_URL")
  await setTestSessionAutoPermission(baseUrl, sessionId)
  const context = await browser.newContext({
    viewport: label === "desktop" ? { width: 1440, height: 900 } : { width: 390, height: 844 },
    isMobile: label === "phone",
    hasTouch: label === "phone",
    colorScheme: "dark",
    locale: "zh-CN",
    acceptDownloads: true,
  })
  try {
    await installSessionEntry(context, baseUrl, sessionId)
    const page: Page = await context.newPage()
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "打开侧边面板" }).click()
    const panel = page.getByRole("complementary", { name: "工作面板" })
    await panel.getByRole("tab", { name: "浏览器" }).click()
    const pane = panel.getByRole("region", { name: "内置浏览器" })
    const address = pane.getByRole("textbox", { name: "网页地址" })
    const picture = pane.getByAltText("网页画面")
    await expect(picture).toBeVisible()

    await address.fill(fixtureUrl("alpha"))
    await pane.getByRole("button", { name: "访问网页" }).click()
    await expect(address).toHaveValue(fixtureUrl("alpha"))
    const alpha = await readSettledState(baseUrl, sessionId, fixtureUrl("alpha"))
    expect(alpha.url).toBe(fixtureUrl("alpha"))
    expect(alpha.tabs).toHaveLength(1)
    const alphaScreenshot = await assertActiveReads(baseUrl, sessionId, alpha, "Alpha fixture")
    const alphaFrameUrl = await picture.getAttribute("src")

    await pane.getByRole("button", { name: "新建标签页" }).click()
    await expect(pane.getByRole("navigation", { name: "浏览器标签列表" }).getByRole("button", { name: /切换到标签页 2/ })).toHaveAttribute("aria-current", "page")
    await address.fill(fixtureUrl("beta"))
    await pane.getByRole("button", { name: "访问网页" }).click()
    await expect(address).toHaveValue(fixtureUrl("beta"))
    const beta = await readSettledState(baseUrl, sessionId, fixtureUrl("beta"))
    expect(beta.tabs).toHaveLength(2)
    expect(beta.active_tab_id).not.toBe(alpha.active_tab_id)
    const betaScreenshot = await assertActiveReads(baseUrl, sessionId, beta, "Beta fixture")
    expect(betaScreenshot).not.toEqual(alphaScreenshot)
    await expect.poll(() => picture.getAttribute("src")).not.toBe(alphaFrameUrl)

    await pane.getByRole("button", { name: "查看 DOM" }).click()
    await expect(pane.getByLabel("DOM 快照", { exact: true })).toContainText("Beta fixture")
    await pane.getByRole("button", { name: "切换到标签页 1：Alpha fixture" }).click()
    await expect(address).toHaveValue(fixtureUrl("alpha"))
    await expect(pane.getByLabel("DOM 快照", { exact: true })).toHaveCount(0)
    const switched = await readSettledState(baseUrl, sessionId, fixtureUrl("alpha"))
    expect(switched.active_tab_id).toBe(alpha.active_tab_id)
    await assertActiveReads(baseUrl, sessionId, switched, "Alpha fixture")

    await pane.getByRole("button", { name: "查看 DOM" }).click()
    await expect(pane.getByLabel("DOM 快照", { exact: true })).toContainText("Alpha fixture")
    await executeBrowser(baseUrl, sessionId, { action: "click", selector: "#popup", expected_epoch: switched.page_epoch })
    await expect(pane.getByLabel("DOM 快照", { exact: true })).toHaveCount(0)
    await expect(pane.getByRole("button", { name: "切换到标签页 3：Popup fixture" })).toHaveAttribute("aria-current", "page")
    await expect(address).toHaveValue(fixtureUrl("popup"))
    const popup = await readSettledState(baseUrl, sessionId, fixtureUrl("popup"))
    expect(popup.tabs).toHaveLength(3)
    expect(popup.active_tab_id).not.toBe(switched.active_tab_id)
    const popupScreenshot = await assertActiveReads(baseUrl, sessionId, popup, "Popup fixture")
    await expect(picture).toBeVisible()

    const downloadPromise = page.waitForEvent("download")
    await pane.getByRole("button", { name: "保存网页截图" }).click()
    const download = await downloadPromise
    expect(await readFile(await download.path())).toEqual(popupScreenshot)
    await expect(picture).toBeVisible()
    await testInfo.attach(`real-bamboo-tabs-${label}`, { body: await page.screenshot(), contentType: "image/png" })

    await pane.getByRole("button", { name: "关闭标签页 3：Popup fixture" }).click()
    await expect(pane.getByRole("button", { name: "切换到标签页 2：Beta fixture" })).toHaveAttribute("aria-current", "page")
    await pane.getByRole("button", { name: "关闭标签页 2：Beta fixture" }).click()
    await expect(pane.getByRole("button", { name: "切换到标签页 1：Alpha fixture" })).toHaveAttribute("aria-current", "page")
    const remaining = await readState(baseUrl, sessionId)
    expect(remaining.tabs).toHaveLength(1)
    expect(remaining.active_tab_id).toBe(alpha.active_tab_id)
  } finally {
    await context.close()
  }
}

test("real Bamboo shared browser tabs stay aligned across human and model control on desktop and phone", async ({ browser }, testInfo) => {
  await assertBundledBrowserRuntime(testInfo)
  await exerciseSurface(browser, testInfo, "desktop", requiredEnv("LOTUS_REAL_BAMBOO_UI_SESSION_ID"))
  await exerciseSurface(browser, testInfo, "phone", requiredEnv("LOTUS_REAL_BAMBOO_OTHER_PROJECT_SESSION_ID"))
})
