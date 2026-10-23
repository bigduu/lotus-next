import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const chunk = /\/assets\/WorkflowRunsContent-[^/]+\.js$/

async function openRuns(page: Page) {
  await page.getByRole("banner").getByRole("button", { name: "更多", exact: true }).click()
  await page.getByRole("menuitem", { name: "编排运行", exact: true }).click()
  return page.getByRole("dialog", { name: "编排运行", exact: true })
}

for (const failChunk of [false, true]) {
  test(`Workflow Runs keeps a dismissable shell while its content ${failChunk ? "fails" : "loads slowly"}`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      localStorage.setItem("lotus_next_last_session", "all-surface-session")
    })
    const observation = await installArtifactRuntime(page, standaloneScenario)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let requests = 0
    await page.route(chunk, async (route) => {
      requests += 1
      await gate
      if (failChunk) await route.abort("failed")
      else await route.fallback()
    })
    await page.goto(standaloneScenario.entryUrl)
    await expect(page.getByRole("banner")).toContainText("All-surface acceptance")
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
    expect(requests).toBe(0)
    const dialog = await openRuns(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("status")).toBeVisible()
    const close = dialog.getByRole("button", { name: "关闭", exact: true })
    await expect(close).toBeFocused()
    await expect.poll(() => requests).toBe(1)
    if (failChunk) {
      release()
      await expect(dialog.getByRole("alert")).toBeVisible()
      await expect(close).toBeFocused()
      await close.click()
    } else {
      const loaded = page.waitForResponse((response) => chunk.test(new URL(response.url()).pathname))
      await close.press("Escape")
      await expect(dialog).toHaveCount(0)
      release()
      await (await loaded).finished()
      // A module arriving after dismissal must not start session reads.
      await page.locator("html").evaluate((element) => new Promise<void>((resolve) => {
        const view = element.ownerDocument.defaultView!
        view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve()))
      }))
    }
    await expect(dialog).toHaveCount(0)
    expect(observation.apiUrls.filter((url) => new URL(url).pathname.includes("/workflow-runs"))).toEqual([])
    expect(observation.pageErrors).toEqual([])
    expect(observation.errorResponses).toEqual([])
  })
}
