import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

type DialogKind = "alert" | "confirm" | "prompt"

test("desktop and tablet keep the shared browser frame while a person answers JavaScript dialogs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "phone-chromium", "The phone workbench has no browser")
  test.setTimeout(45_000)

  const picturePage = await page.context().newPage()
  await picturePage.setViewportSize({ width: 640, height: 480 })
  await picturePage.setContent("<body style='background:#d9e7ff'><main style='padding:60px;font:40px sans-serif'>Shared browser frame</main></body>")
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

  const browserPath = "/api/v1/browser/sessions/all-surface-session"
  let epoch = 7
  let frameSeq = 1
  let viewport = { width: 640, height: 480 }
  let dialog: null | {
    dialog_id: string; tab_id: string; page_epoch: number; url: string; type: DialogKind;
    message: string; message_truncated: boolean; default_value: string;
    default_value_truncated: boolean; expires_at_ms: number; status: "pending" | "expired";
  } = null
  const responses: Array<Record<string, unknown>> = []
  const blockedCalls: string[] = []
  let staleNextResponse = false
  const state = () => ({
    page_epoch: epoch, frame_seq: frameSeq, active_tab_id: "tab-a",
    tabs: [
      { tab_id: "tab-a", url: "https://example.test/", title: "Example", active: true },
      { tab_id: "tab-b", url: "https://background.test/question", title: "Background", active: false },
    ],
    url: "https://example.test/", title: "Example", viewport,
    can_go_back: false, can_go_forward: false, pending_dialog: dialog,
  })
  let dialogCount = 0
  const showDialog = (type: DialogKind, options: { defaultValue?: string; truncated?: boolean; status?: "pending" | "expired" } = {}) => {
    dialogCount += 1
    dialog = {
      dialog_id: dialogCount.toString(16).padStart(24, "0"), tab_id: "tab-a", page_epoch: epoch,
      url: "https://example.test/", type, message: `${type} from page`,
      message_truncated: false, default_value: options.defaultValue ?? "",
      default_value_truncated: options.truncated ?? false,
      expires_at_ms: Date.now() + 30_000, status: options.status ?? "pending",
    }
  }

  await page.route("**/api/v1/browser/sessions/all-surface-session**", async (route) => {
    const request = route.request()
    const address = new URL(request.url())
    const path = address.pathname
    const method = request.method()
    if (path === browserPath && (method === "PUT" || method === "GET")) return route.fulfill({ json: state() })
    if (path === `${browserPath}/frame` && method === "GET") {
      if (dialog) {
        blockedCalls.push("frame")
        return route.fulfill({ status: 409, json: { error: { code: "dialog_pending" } } })
      }
      if (Number(address.searchParams.get("after")) >= frameSeq) {
        await new Promise((resolve) => setTimeout(resolve, 90))
        if (dialog) return route.fulfill({ status: 409, json: { error: { code: "dialog_pending" } } })
        if (Number(address.searchParams.get("after")) >= frameSeq) return route.fulfill({ status: 204 })
      }
      return route.fulfill({
        body: jpeg, contentType: "image/jpeg",
        headers: {
          "X-Frame-Seq": String(frameSeq), "X-Page-Epoch": String(epoch),
          "X-Tab-Id": "tab-a", "X-Viewport-Width": String(viewport.width),
          "X-Viewport-Height": String(viewport.height),
        },
      })
    }
    if (path === `${browserPath}/dialog` && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>
      responses.push(body)
      if (staleNextResponse) {
        staleNextResponse = false
        dialog = null
        frameSeq += 1
        return route.fulfill({ status: 409, json: { error: { code: "stale_dialog" } } })
      }
      if (!dialog || body.dialog_id !== dialog.dialog_id || body.expected_epoch !== epoch) {
        return route.fulfill({ status: 409, json: { error: { code: "stale_dialog" } } })
      }
      dialog = null
      frameSeq += 1
      return route.fulfill({ json: state() })
    }
    if (path === `${browserPath}/viewport` && method === "POST") {
      if (dialog) {
        blockedCalls.push("viewport")
        return route.fulfill({ status: 409, json: { error: { code: "dialog_pending" } } })
      }
      const body = request.postDataJSON() as { width: number; height: number }
      viewport = { width: body.width, height: body.height }
      epoch += 1
      frameSeq += 1
      return route.fulfill({ json: state() })
    }
    if (dialog) blockedCalls.push(path.slice(browserPath.length))
    return route.fulfill({ status: dialog ? 409 : 404, json: { error: { code: dialog ? "dialog_pending" : "not_found" } } })
  })

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  const panel = page.getByRole("complementary", { name: "工作面板" })
  await panel.getByRole("tab", { name: "浏览器" }).click()
  const browser = panel.getByRole("region", { name: "内置浏览器" })
  const image = browser.getByAltText("网页画面")
  await expect(image).toBeVisible()
  const cachedFrame = await image.getAttribute("src")

  showDialog("alert")
  const modal = browser.getByRole("dialog", { name: "网页弹窗" })
  await expect(modal).toContainText("alert from page")
  await expect(image).toHaveAttribute("src", cachedFrame!)
  await expect(browser.getByRole("button", { name: "查看 DOM" })).toBeDisabled()
  await expect(browser.getByRole("button", { name: "保存网页截图" })).toBeDisabled()
  await expect(browser.getByRole("button", { name: "新建标签页" })).toBeDisabled()
  await expect(browser.getByRole("textbox", { name: "网页地址" })).toBeDisabled()
  const screenshotPath = testInfo.outputPath(`browser-alert-${testInfo.project.name}.png`)
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach(`browser-alert-${testInfo.project.name}`, { path: screenshotPath, contentType: "image/png" })
  const callsAtModal = blockedCalls.length
  await page.waitForTimeout(700)
  expect(blockedCalls.slice(callsAtModal)).toEqual([])
  await modal.getByRole("button", { name: "确定" }).click()
  await expect(modal).toHaveCount(0)
  expect(responses.at(-1)).toEqual({ dialog_id: "1".padStart(24, "0"), expected_epoch: epoch, accept: true })

  showDialog("confirm")
  dialog!.tab_id = "tab-b"
  dialog!.url = "https://background.test/question"
  await expect(modal).toContainText("confirm from page")
  await expect(modal).toContainText("来自 https://background.test")
  await expect(browser.getByRole("textbox", { name: "网页地址" })).toHaveValue("https://example.test/")
  const backgroundScreenshotPath = testInfo.outputPath(`browser-background-${testInfo.project.name}.png`)
  await page.screenshot({ path: backgroundScreenshotPath })
  await testInfo.attach(`browser-background-${testInfo.project.name}`, { path: backgroundScreenshotPath, contentType: "image/png" })
  await modal.getByRole("button", { name: "取消" }).click()
  await expect(modal).toHaveCount(0)
  expect(responses.at(-1)).toEqual({ dialog_id: "2".padStart(24, "0"), expected_epoch: epoch, accept: false })

  showDialog("prompt", { defaultValue: "displayed prefix", truncated: true })
  await expect(modal).toContainText("prompt from page")
  await expect(modal.getByRole("textbox", { name: "弹窗输入" })).toHaveValue("displayed prefix")
  await expect(modal).toContainText("保持不改将使用网页的完整默认值")
  await expect.poll(() => page.evaluate('document.activeElement?.getAttribute("aria-label")')).toBe("弹窗输入")
  const promptScreenshotPath = testInfo.outputPath(`browser-prompt-${testInfo.project.name}.png`)
  await page.screenshot({ path: promptScreenshotPath })
  await testInfo.attach(`browser-prompt-${testInfo.project.name}`, { path: promptScreenshotPath, contentType: "image/png" })
  await modal.getByRole("button", { name: "确定" }).click()
  await expect(modal).toHaveCount(0)
  expect(responses.at(-1)).toEqual({ dialog_id: "3".padStart(24, "0"), expected_epoch: epoch, accept: true })

  showDialog("prompt", { defaultValue: "edit me" })
  await expect(modal).toContainText("prompt from page")
  await modal.getByRole("textbox", { name: "弹窗输入" }).fill("draft answer")
  await expect(modal.getByRole("textbox", { name: "弹窗输入" })).toHaveValue("draft answer")
  await page.waitForTimeout(650) // More than one safe state poll with the same dialog identity.
  await expect(modal.getByRole("textbox", { name: "弹窗输入" })).toHaveValue("draft answer")
  await modal.getByRole("textbox", { name: "弹窗输入" }).fill("")
  await modal.getByRole("button", { name: "确定" }).click()
  await expect(modal).toHaveCount(0)
  expect(responses.at(-1)).toEqual({ dialog_id: "4".padStart(24, "0"), expected_epoch: epoch, accept: true, text: "" })

  showDialog("confirm", { status: "expired" })
  await expect(modal).toContainText("弹窗已过期")
  await expect(modal.getByRole("button", { name: "确定" })).toHaveCount(0)
  dialog = null // A model/host resolution is observed through the safe state polling path.
  await expect(modal).toHaveCount(0)

  showDialog("confirm")
  await expect(modal).toContainText("confirm from page")
  staleNextResponse = true
  await modal.getByRole("button", { name: "取消" }).click()
  await expect(modal).toHaveCount(0)
  await expect(browser.getByRole("alert")).toHaveCount(0)
  expect(observation.pageErrors).toEqual([])
})
